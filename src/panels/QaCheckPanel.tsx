// QA checker workspace. Compares the CREATED playable (the current project, an
// uploaded MIP/SIP .html, or a screenshot) against the ORIGINAL Figma mockup
// image — either merged in ONE screen (mockup ghosted over the playable with an
// opacity slider) or as TWO screens side by side. A pipette samples the SAME
// spot on both sources and reports whether the colors match, and "Find diffs"
// runs a pixel diff that highlights and numbers the regions that differ.
//
// Reading pixels out of the playable iframe needs the desktop app (its data:
// origin blocks canvas readback, so we capture through Electron). In the
// browser those tools fall back to the native EyeDropper / a screenshot upload.

import { useEffect, useRef, useState } from 'react'
import { canCapture, captureRect, htmlToDataUrl, importHtml, importImage, readImageFile } from '../bridge'
import type { Device } from '../devices'
import { getEditLocale } from '../locale'
import { diffImages, motionMask, samplePixel, colorDelta, type Bitmap, type DiffRegion, type DiffResult } from '../qa/imageDiff'
import { useEditorState } from '../store'
import { Checkbox } from '../ui'
import { Icon, Columns2, ImageIcon, Layers, Pipette, Play, RotateCcw, ScanSearch, Upload, X } from '../icons'

type CreatedSource =
  | { kind: 'project' }
  | { kind: 'html'; name: string; src: string }
  | { kind: 'image'; name: string; src: string }

interface PickedColor {
  hex: string
  r: number
  g: number
  b: number
}
interface PickResult {
  fx: number
  fy: number
  created: PickedColor | null
  original: PickedColor | null
}

interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>
}

const THRESHOLDS = [
  { value: '0.06', label: 'Strict' },
  { value: '0.12', label: 'Normal' },
  { value: '0.25', label: 'Loose' },
] as const

// QA compare targets: the two sizes creative is checked against. Landscape is
// the Rotate button; anything else via the W/H fields or the drag grip.
const QA_DEVICES: Device[] = [
  { id: 'iphonese', label: 'iPhone SE', w: 375, h: 667 },
  { id: 'tablet', label: 'Tablet', w: 820, h: 1180 },
]

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Rasterize an image src (data URL) to a w×h RGBA bitmap (stretched, so both
 * sources share one compare space regardless of export resolution). */
function bitmapFromSrc(src: string, w: number, h: number): Promise<Bitmap | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return resolve(null)
      ctx.drawImage(img, 0, 0, w, h)
      resolve({ data: ctx.getImageData(0, 0, w, h).data, width: w, height: h })
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

const nextFrames = (n: number): Promise<void> => new Promise((resolve) => {
  const step = (left: number): void => {
    if (left <= 0) resolve()
    else requestAnimationFrame(() => step(left - 1))
  }
  step(n)
})

const hexToRgb = (hex: string): PickedColor => {
  const n = parseInt(hex.slice(1), 16)
  return { hex, r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** Diff mask layer. Own component so the SAME mask can paint into independent
 * canvases on both screens (a shared ref would only reach the last one). */
function MaskCanvas(props: { mask: Bitmap }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = props.mask.width
    c.height = props.mask.height
    // copy → a plain-ArrayBuffer view (ImageData rejects ArrayBufferLike)
    c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(props.mask.data), props.mask.width, props.mask.height), 0, 0)
  }, [props.mask])
  return <canvas ref={ref} className="qac-mask" />
}

/** Live playable running the CURRENT editor project (pa:play handshake, same as
 * the Preview overlay). */
function ProjectFrame(props: { w: number; h: number; playKey: number; iframeRef: React.RefObject<HTMLIFrameElement> }): JSX.Element {
  const { project, assets } = useEditorState()
  const ready = useRef(false)
  const post = (): void => {
    props.iframeRef.current?.contentWindow?.postMessage({ type: 'pa:play', project, assets, locale: getEditLocale() }, '*')
  }
  useEffect(() => {
    if (ready.current) post()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, assets, props.playKey, props.w, props.h])
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.source === props.iframeRef.current?.contentWindow && (e.data as { type?: string })?.type === 'pa:ready') {
        ready.current = true
        post()
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <iframe ref={props.iframeRef} title="Created playable" onLoad={post} style={{ width: props.w, height: props.h, border: 0 }} src="./runtime-frame.html" />
}

export function QaCheckPanel(props: { onClose: () => void }): JSX.Element {
  const devices = QA_DEVICES
  const [dim, setDim] = useState({ w: QA_DEVICES[0].w, h: QA_DEVICES[0].h })
  const [created, setCreated] = useState<CreatedSource>({ kind: 'project' })
  const [original, setOriginal] = useState<{ name: string; src: string } | null>(null)
  const [mode, setMode] = useState<'overlay' | 'split'>('split')
  const [opacity, setOpacity] = useState(0.5)
  const [pick, setPick] = useState(false)
  const [hover, setHover] = useState<{ fx: number; fy: number } | null>(null)
  const [picked, setPicked] = useState<PickResult | null>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [animZones, setAnimZones] = useState<DiffRegion[] | null>(null)
  const [ignoreAnim, setIgnoreAnim] = useState(true)
  const [diffBusy, setDiffBusy] = useState(false)
  const [focusRegion, setFocusRegion] = useState(-1)
  const [threshold, setThreshold] = useState<string>('0.12')
  const [shooting, setShooting] = useState(false) // hides overlays while capturing
  const [dragging, setDragging] = useState(false) // a file is being dragged over the modal
  const [msg, setMsg] = useState('')
  const [playKey, setPlayKey] = useState(1)

  const stageRef = useRef<HTMLDivElement>(null)
  const createdZoomRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [stage, setStage] = useState({ w: 900, h: 520 })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setStage({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // A stale diff is misleading once the compare space changes.
  useEffect(() => {
    setDiff(null)
    setAnimZones(null)
    setFocusRegion(-1)
    setPicked(null)
  }, [dim.w, dim.h, created, original, mode])

  const pickHtml = async (): Promise<void> => {
    const f = await importHtml()
    if (f) setCreated({ kind: 'html', name: f.name, src: f.src })
  }
  const pickShot = async (): Promise<void> => {
    const f = await importImage()
    if (f) setCreated({ kind: 'image', name: f.name, src: f.src })
  }
  const pickOriginal = async (): Promise<void> => {
    const f = await importImage()
    if (f) setOriginal({ name: f.name, src: f.src })
  }

  // Drag & drop straight onto a screen: .html → the playable; an image → the
  // mockup on the Original screen (or in merged mode), a screenshot of the
  // playable on the Created screen.
  const dropFile = async (f: File, side: 'created' | 'original'): Promise<void> => {
    if (/\.html?$/i.test(f.name) || f.type === 'text/html') {
      setCreated({ kind: 'html', name: f.name, src: htmlToDataUrl(await f.text()) })
    } else if (f.type.startsWith('image/')) {
      const img = await readImageFile(f)
      if (!img) return
      if (side === 'original' || mode === 'overlay') setOriginal({ name: f.name, src: img.src })
      else setCreated({ kind: 'image', name: f.name, src: img.src })
    }
  }
  const onZoneDrop = (side: 'created' | 'original') => (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void dropFile(f, side)
  }
  const dropZone = (side: 'created' | 'original'): JSX.Element | false =>
    dragging && (
      <div className="qac-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={onZoneDrop(side)}>
        <Icon icon={Upload} size={20} />
        <span>{side === 'original' ? 'Drop Figma image' : mode === 'overlay' ? 'Drop .html or mockup image' : 'Drop .html or screenshot'}</span>
      </div>
    )

  /** Rasterize the CREATED side into the w×h compare space. Live iframes go
   * through the Electron window capture (overlays hidden for the shot). */
  const captureCreated = async (): Promise<Bitmap | null> => {
    if (created.kind === 'image') return bitmapFromSrc(created.src, dim.w, dim.h)
    const zoom = createdZoomRef.current
    if (!zoom || !canCapture) return null
    setShooting(true)
    await nextFrames(3)
    const r = zoom.getBoundingClientRect() // visual (scaled) rect, no shell border
    const url = await captureRect({ x: r.x, y: r.y, width: r.width, height: r.height })
    setShooting(false)
    return url ? bitmapFromSrc(url, dim.w, dim.h) : null
  }

  const liveCaptureBlocked = created.kind !== 'image' && !canCapture

  const runDiff = async (): Promise<void> => {
    if (!original) {
      setMsg('Upload the Figma mockup image first.')
      return
    }
    if (liveCaptureBlocked) {
      setMsg('Auto-diff on a live playable needs the desktop app — or upload a screenshot of the MIP instead.')
      return
    }
    setDiffBusy(true)
    setMsg('')
    try {
      const a = await captureCreated()
      if (!a) {
        setMsg('Could not capture the created side.')
        return
      }
      // Animation pass: a second capture a beat later; whatever moved between
      // the two frames (pulsing CTA, timer, particles) is excluded from the
      // score and flagged as an "animated" zone instead of a mismatch.
      let ignore: Uint8Array | undefined
      let zones: DiffRegion[] = []
      if (ignoreAnim && created.kind !== 'image') {
        await sleep(420)
        const a2 = await captureCreated()
        if (a2) {
          const motion = motionMask(a, a2)
          if (motion.pixels) {
            ignore = motion.mask
            zones = motion.regions
          }
        }
      }
      const b = await bitmapFromSrc(original.src, dim.w, dim.h)
      if (!b) {
        setMsg('Could not read the mockup image.')
        return
      }
      const result = diffImages(a, b, Number(threshold), 24, ignore)
      setDiff(result)
      setAnimZones(zones.length ? zones : null)
      setFocusRegion(-1)
      setMsg(result.regions.length ? '' : 'No differences above the threshold — looks like a match.')
    } finally {
      setDiffBusy(false)
    }
  }

  const sampleAt = async (fx: number, fy: number): Promise<void> => {
    let createdColor: PickedColor | null = null
    if (created.kind === 'image' || canCapture) {
      const bmp = await captureCreated()
      const px = bmp && samplePixel(bmp, fx * dim.w, fy * dim.h)
      if (px) createdColor = { hex: px.hex, r: px.r, g: px.g, b: px.b }
    } else {
      // Browser fallback: native eyedropper — user picks the spot on the
      // created screen by hand.
      const ED = (window as { EyeDropper?: new () => EyeDropperLike }).EyeDropper
      if (ED) {
        try {
          createdColor = hexToRgb((await new ED().open()).sRGBHex)
        } catch {
          /* cancelled */
        }
      } else {
        setMsg('Sampling a live playable needs the desktop app (or a browser with the EyeDropper API).')
      }
    }
    let originalColor: PickedColor | null = null
    if (original) {
      const bmp = await bitmapFromSrc(original.src, dim.w, dim.h)
      const px = bmp && samplePixel(bmp, fx * dim.w, fy * dim.h)
      if (px) originalColor = { hex: px.hex, r: px.r, g: px.g, b: px.b }
    }
    setPicked({ fx, fy, created: createdColor, original: originalColor })
  }

  const onPickMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover({ fx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), fy: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) })
  }
  const onPickClick = (e: React.PointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    void sampleAt(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))
  }

  // Corner grip: drag to resize the compare space freely (portrait ↔ landscape).
  const onGrip = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const start = { ...dim }
    const sc = scale || 1
    const move = (ev: PointerEvent): void => {
      setDim({ w: Math.max(120, Math.round(start.w + (ev.clientX - startX) / sc)), h: Math.max(120, Math.round(start.h + (ev.clientY - startY) / sc)) })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const pickDelta = picked?.created && picked.original ? colorDelta(picked.created.r, picked.created.g, picked.created.b, 255, picked.original.r, picked.original.g, picked.original.b, 255) : null
  const verdict = pickDelta == null ? null : pickDelta < 0.004 ? 'Match' : pickDelta < 0.03 ? 'Close' : 'Different'

  const screens = mode === 'split' ? 2 : 1
  const availW = stage.w - 32 - (screens - 1) * 26
  const availH = stage.h - 32 - 26
  const scale = Math.max(0.05, Math.min(1, availW / (dim.w * screens), availH / dim.h))

  const crosshair = (p: { fx: number; fy: number } | null, cls: string): JSX.Element | null =>
    p && (
      <div className={'qac-cross ' + cls} style={{ left: `${p.fx * 100}%`, top: `${p.fy * 100}%` }}>
        <i className="h" />
        <i className="v" />
      </div>
    )

  const diffLayer = diff && !shooting && (
    <>
      <MaskCanvas mask={diff.mask} />
      {animZones?.map((rg, i) => (
        <div key={'anim' + i} className="qac-anim" style={{ left: `${(rg.x / dim.w) * 100}%`, top: `${(rg.y / dim.h) * 100}%`, width: `${(rg.w / dim.w) * 100}%`, height: `${(rg.h / dim.h) * 100}%` }} title="Animated area (pulsing CTA, timer, …) — excluded from the accuracy score">
          <span>animated</span>
        </div>
      ))}
      {diff.regions.map((rg, i) => (
        <div
          key={i}
          className={'qac-region' + (focusRegion === i ? ' focus' : '')}
          style={{ left: `${(rg.x / dim.w) * 100}%`, top: `${(rg.y / dim.h) * 100}%`, width: `${(rg.w / dim.w) * 100}%`, height: `${(rg.h / dim.h) * 100}%` }}
        >
          <span>{i + 1}</span>
        </div>
      ))}
    </>
  )

  const pickCatcher = pick && (
    <div className="qac-catch" onPointerMove={onPickMove} onPointerLeave={() => setHover(null)} onPointerDown={onPickClick}>
      {!shooting && crosshair(hover, 'hover')}
      {!shooting && crosshair(picked, 'set')}
    </div>
  )

  const createdView = (
    <div className="device-view">
      <div className="device-shell qac-layers" style={{ width: dim.w * scale, height: dim.h * scale }}>
        <div className="qac-zoom" ref={createdZoomRef} style={{ width: dim.w, height: dim.h, transform: `scale(${scale})` }}>
          {created.kind === 'project' && <ProjectFrame w={dim.w} h={dim.h} playKey={playKey} iframeRef={iframeRef} />}
          {created.kind === 'html' && <iframe key={playKey} ref={iframeRef} title="Uploaded playable" style={{ width: dim.w, height: dim.h, border: 0 }} src={created.src} />}
          {created.kind === 'image' && <img alt="Created screenshot" src={created.src} style={{ width: dim.w, height: dim.h, objectFit: 'fill' }} />}
        </div>
        {mode === 'overlay' && original && !shooting && <img alt="Figma mockup overlay" className="qac-ghost" src={original.src} style={{ opacity }} />}
        {diffLayer}
        {pickCatcher}
        {dropZone('created')}
        {!shooting && <div className="qac-grip" onPointerDown={onGrip} title="Drag to resize freely" />}
      </div>
      <span className="device-label">
        {created.kind === 'project' ? 'Created · current project' : `Created · ${created.name}`} · {dim.w}×{dim.h}
      </span>
    </div>
  )

  const originalView = mode === 'split' && (
    <div className="device-view">
      <div className="device-shell qac-layers" style={{ width: dim.w * scale, height: dim.h * scale }}>
        {original ? (
          <img alt="Figma mockup" src={original.src} style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
        ) : (
          <button className="qac-drop" onClick={() => void pickOriginal()}>
            <Icon icon={ImageIcon} size={22} />
            Upload the Figma mockup
          </button>
        )}
        {diffLayer}
        {pickCatcher}
        {dropZone('original')}
      </div>
      <span className="device-label">{original ? `Original · ${original.name}` : 'Original · none yet'} · {dim.w}×{dim.h}</span>
    </div>
  )

  return (
    <div className="preview-overlay" onClick={props.onClose}>
      <div
        className="preview-modal qac-modal"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault()
          if (e.dataTransfer.types.includes('Files')) setDragging(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault() // a miss outside a zone must not navigate the app
          setDragging(false)
        }}
      >
        <div className="preview-bar">
          <strong>QA checker</strong>
          <span className="seg">
            <button className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')} title="Created and original side by side">
              <Icon icon={Columns2} size={13} /> Two screens
            </button>
            <button className={mode === 'overlay' ? 'on' : ''} onClick={() => setMode('overlay')} title="Mockup ghosted over the playable">
              <Icon icon={Layers} size={13} /> Merged
            </button>
          </span>
          {mode === 'overlay' && (
            <label className="qac-opacity" title="Slide left to see the playable, right to see the Figma mockup">
              <span className="qac-end">Playable</span>
              <input type="range" min={0} max={100} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} />
              <span className="qac-end">Mockup</span>
              <span className="qac-pct">{Math.round(opacity * 100)}%</span>
            </label>
          )}
          <span className="seg">
            {devices.map((d) => (
              <button key={d.id} className={dim.w === d.w && dim.h === d.h ? 'on' : dim.w === d.h && dim.h === d.w ? 'on' : ''} onClick={() => setDim({ w: d.w, h: d.h })}>
                {d.label}
              </button>
            ))}
          </span>
          <span className="dims">
            <label>
              W <input type="number" value={dim.w} onChange={(e) => setDim((d) => ({ ...d, w: Math.max(120, Math.round(Number(e.target.value) || 0)) }))} />
            </label>
            <label>
              H <input type="number" value={dim.h} onChange={(e) => setDim((d) => ({ ...d, h: Math.max(120, Math.round(Number(e.target.value) || 0)) }))} />
            </label>
          </span>
          <button onClick={() => setDim((d) => ({ w: d.h, h: d.w }))} title="Rotate portrait ↔ landscape">
            <Icon icon={RotateCcw} size={14} /> Rotate
          </button>
          <span className="spacer" />
          <button onClick={props.onClose}>
            <Icon icon={X} size={14} /> Close
          </button>
        </div>

        <div className="qac-toolbar">
          <span className="scope-label">Created:</span>
          <span className="seg">
            <button className={created.kind === 'project' ? 'on' : ''} onClick={() => setCreated({ kind: 'project' })} title="The project open in the editor">
              Current project
            </button>
            <button className={created.kind === 'html' ? 'on' : ''} onClick={() => void pickHtml()} title="Upload a built MIP / SIP .html">
              <Icon icon={Upload} size={13} /> MIP / SIP HTML…
            </button>
            <button className={created.kind === 'image' ? 'on' : ''} onClick={() => void pickShot()} title="Upload a screenshot of the playable">
              <Icon icon={ImageIcon} size={13} /> Screenshot…
            </button>
          </span>
          <span className="scope-label">Original:</span>
          <button className={'scope-chip' + (original ? ' on' : '')} onClick={() => void pickOriginal()} title="Upload the Figma mockup export (PNG/JPG)">
            <Icon icon={ImageIcon} size={13} /> {original ? original.name : 'Figma image…'}
          </button>
          <span className="spacer" />
          <button className={'scope-chip' + (pick ? ' on' : '')} onClick={() => { setPick((v) => !v); setMsg('') }} title="Click a spot to sample the color from BOTH sources">
            <Icon icon={Pipette} size={13} /> Pick color
          </button>
          {created.kind !== 'image' && (
            <Checkbox checked={ignoreAnim} onChange={setIgnoreAnim} label="Ignore animation" title="Capture twice and exclude whatever moves (pulsing CTA, timers) from the diff & accuracy score" />
          )}
          <select className="qac-thresh" value={threshold} onChange={(e) => setThreshold(e.target.value)} title="Diff sensitivity">
            {THRESHOLDS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <button className="scope-chip" disabled={diffBusy || !original || liveCaptureBlocked} onClick={() => void runDiff()} title={liveCaptureBlocked ? 'Needs the desktop app (or a screenshot source)' : 'Auto-detect visual differences'}>
            <Icon icon={ScanSearch} size={13} /> {diffBusy ? 'Comparing…' : 'Find diffs'}
          </button>
          {created.kind !== 'image' && (
            <button className="scope-replay" onClick={() => setPlayKey((k) => k + 1)} title="Restart the playable">
              <Icon icon={Play} size={13} /> Replay
            </button>
          )}
        </div>

        <div className="preview-stage qac-stage" ref={stageRef}>
          {createdView}
          {originalView}
        </div>

        {(picked || diff || msg) && (
        <div className="qac-foot">
          {picked && (
            <span className="qac-pickinfo">
              <span className="qac-swatch" style={{ background: picked.created?.hex ?? 'transparent' }} />
              {picked.created?.hex ?? '—'}
              <span className="qac-vs">vs</span>
              <span className="qac-swatch" style={{ background: picked.original?.hex ?? 'transparent' }} />
              {picked.original?.hex ?? '—'}
              {verdict && <strong className={'qac-verdict ' + verdict.toLowerCase()}>{verdict}</strong>}
              <span className="hint">at {Math.round(picked.fx * dim.w)}, {Math.round(picked.fy * dim.h)}</span>
            </span>
          )}
          {diff && (
            <span className="qac-diffinfo">
              <strong className={'qac-score ' + (100 - diff.pct >= 99 ? 'good' : 100 - diff.pct >= 95 ? 'ok' : 'bad')} title="Share of pixels matching the mockup at the current sensitivity (animated zones excluded)">
                Accuracy {(100 - diff.pct).toFixed(1)}%
              </strong>
              <strong>{diff.regions.length}</strong> region{diff.regions.length === 1 ? '' : 's'} · {diff.pct.toFixed(2)}% of pixels differ
              {animZones && (
                <span className="qac-animnote" title="Detected motion between two captures — not counted against accuracy">
                  · {animZones.length} animated zone{animZones.length === 1 ? '' : 's'} ignored
                </span>
              )}
              {diff.regions.slice(0, 10).map((rg, i) => (
                <button key={i} className={'scope-chip' + (focusRegion === i ? ' on' : '')} onMouseEnter={() => setFocusRegion(i)} onMouseLeave={() => setFocusRegion(-1)} onClick={() => setFocusRegion(i)}>
                  {i + 1} · {rg.pixels.toLocaleString()}px
                </button>
              ))}
              <button className="scope-chip" onClick={() => { setDiff(null); setAnimZones(null) }}>clear</button>
              <span className="qac-legend">
                <i className="mis" /> differs from mockup
                {animZones && (
                  <>
                    <i className="anim" /> animated · ignored
                  </>
                )}
              </span>
            </span>
          )}
          {msg && <span className="qac-msg">{msg}</span>}
        </div>
        )}
      </div>
    </div>
  )
}
