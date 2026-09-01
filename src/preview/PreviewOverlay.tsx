// Preview overlay (modal). Plays the real runtime on a chosen device in BOTH
// portrait and landscape, scaled to fit the stage (no clipping). Scope control
// runs the whole flow, a single scene, or a selected series. "Sync" mirrors real
// input from one orientation into the other so they play in lockstep (the runtime
// is deterministic — same seed → same result).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project } from '../../runtime/scene'
import type { AssetMap } from '../../runtime/types'
import { loadDevices, saveDevices, type Device } from '../devices'
import { getEditLocale } from '../locale'
import { previewNowMs } from '../uiState'
import { useEditorState } from '../store'
import { Icon, LayoutGrid, Play, RotateCcw, SCENE_KIND_ICON, Smartphone, X } from '../icons'
import { Checkbox } from '../ui'

function DeviceView(props: {
  project: Project
  assets: AssetMap
  playKey: number
  w: number
  h: number
  label: string
  scale: number
  framed: boolean
  iframeRef: React.RefObject<HTMLIFrameElement>
}): JSX.Element {
  const { project, assets, playKey, w, h, label, scale, framed, iframeRef } = props
  const ready = useRef(false)
  const post = (): void => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'pa:play', project, assets, locale: getEditLocale(), previewNow: previewNowMs() }, '*')
  }
  useEffect(() => {
    if (ready.current) post()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, assets, playKey, w, h])
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.source === iframeRef.current?.contentWindow && (e.data as { type?: string })?.type === 'pa:ready') {
        ready.current = true
        post()
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const portrait = h >= w
  const shell = (
    <div className="device-shell" style={{ width: w * scale, height: h * scale }}>
      <iframe ref={iframeRef} title={label} onLoad={post} style={{ width: w, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }} src="./runtime-frame.html" />
    </div>
  )
  return (
    <div className="device-view">
      {framed ? <div className={'device-bezel' + (portrait ? ' portrait' : ' landscape')}>{shell}</div> : shell}
      <span className="device-label">
        {label} · {w}×{h}
      </span>
    </div>
  )
}

export function PreviewOverlay(props: { onClose: () => void; initialScene?: string | null }): JSX.Element {
  const { project, assets } = useEditorState()
  const [devices, setDevices] = useState<Device[]>(() => loadDevices())
  const [sel, setSel] = useState<string>(() => loadDevices()[0]?.id ?? 'phone')
  const device = devices.find((d) => d.id === sel) ?? devices[0]

  const [picked, setPicked] = useState<string[]>(() => (props.initialScene ? [props.initialScene] : []))
  const [playKey, setPlayKey] = useState(1)
  const [framed, setFramed] = useState(true)
  const [sync, setSync] = useState(true)

  const pRef = useRef<HTMLIFrameElement>(null)
  const lRef = useRef<HTMLIFrameElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 900, h: 520 })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Measure the stage so both devices scale to fit (no clipping).
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setStage({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Mirror real pointer input between the two device iframes. Because the runtime
  // is deterministic (fixed RNG seed) both instances hold identical state, so the
  // mirror is done by ELEMENT id + the tap's fraction within that element — which
  // is layout-independent, so the same logical element/cell responds in both
  // orientations (mapping by raw screen position would miss, since portrait and
  // landscape lay elements out differently). Real interaction still works directly;
  // this only replays it into the other orientation. `mirroring` blocks feedback.
  useEffect(() => {
    if (!sync) return
    const cleanups: Array<() => void> = []
    let mirroring = false

    const closestId = (el: Element | null): HTMLElement | null => {
      let n: Element | null = el
      while (n && !(n as HTMLElement).dataset?.id) n = n.parentElement
      return (n as HTMLElement) ?? null
    }

    const injectInto = (iframe: HTMLIFrameElement | null, id: string, efx: number, efy: number, type: string): void => {
      const win = iframe?.contentWindow as (Window & { PointerEvent: typeof PointerEvent; MouseEvent: typeof MouseEvent }) | null
      const doc = iframe?.contentDocument
      if (!win || !doc) return
      let target: HTMLElement | null = null
      try {
        target = doc.querySelector(`[data-id="${CSS.escape(id)}"]`)
      } catch {
        target = null
      }
      if (!target) return
      const r = target.getBoundingClientRect()
      const x = r.left + efx * r.width
      const y = r.top + efy * r.height
      const el = doc.elementFromPoint(x, y) ?? target
      const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: win, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }
      mirroring = true
      try {
        el.dispatchEvent(new win.PointerEvent(type, init))
        const mm = type === 'pointerdown' ? 'mousedown' : type === 'pointerup' ? 'mouseup' : 'mousemove'
        el.dispatchEvent(new win.MouseEvent(mm, init))
        if (type === 'pointerup') el.dispatchEvent(new win.MouseEvent('click', init))
      } catch {
        /* ignore */
      } finally {
        mirroring = false
      }
    }

    const attach = (src: HTMLIFrameElement | null, dst: HTMLIFrameElement | null): void => {
      const doc = src?.contentDocument
      if (!doc) return
      const handler = (e: Event): void => {
        if (mirroring) return
        const pe = e as PointerEvent
        const idEl = closestId(doc.elementFromPoint(pe.clientX, pe.clientY))
        if (!idEl?.dataset.id) return
        const r = idEl.getBoundingClientRect()
        const efx = r.width ? (pe.clientX - r.left) / r.width : 0.5
        const efy = r.height ? (pe.clientY - r.top) / r.height : 0.5
        injectInto(dst, idEl.dataset.id, efx, efy, e.type)
      }
      const types = ['pointerdown', 'pointermove', 'pointerup']
      types.forEach((t) => doc.addEventListener(t, handler, true))
      cleanups.push(() => types.forEach((t) => doc.removeEventListener(t, handler, true)))
    }

    // Attach only once BOTH iframes have actually rendered the runtime (.pa-root),
    // so we never bind to the initial about:blank document (which would silently
    // kill that direction once the iframe navigates).
    let tries = 0
    let timer = 0
    const ready = (f: HTMLIFrameElement | null): boolean => !!f?.contentDocument?.querySelector('.pa-root')
    const tryAttach = (): void => {
      if (ready(pRef.current) && ready(lRef.current)) {
        attach(pRef.current, lRef.current)
        attach(lRef.current, pRef.current)
      } else if (tries++ < 60) {
        timer = window.setTimeout(tryAttach, 150)
      }
    }
    timer = window.setTimeout(tryAttach, 200)
    return () => {
      window.clearTimeout(timer)
      cleanups.forEach((c) => c())
    }
  }, [sync, playKey])

  const updateDim = (key: 'w' | 'h', val: number): void => {
    const next = devices.map((d) => (d.id === device.id ? { ...d, [key]: Math.max(120, Math.round(val)) } : d))
    setDevices(next)
    saveDevices(next)
  }

  const togglePick = (id: string): void => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
    setPlayKey((k) => k + 1)
  }
  const playAll = (): void => {
    setPicked([])
    setPlayKey((k) => k + 1)
  }

  const effProject = useMemo<Project>(() => {
    if (!picked.length) return project
    const set = new Set(picked)
    const scenes = project.scenes
      .filter((s) => set.has(s.id))
      .map((s) => {
        const advance = { ...s.advance }
        if (advance.to && !set.has(advance.to)) delete advance.to
        return { ...s, advance }
      })
    return { ...project, scenes, startSceneId: scenes[0]?.id ?? project.startSceneId }
  }, [project, picked])

  // Fit both devices side by side within the measured stage.
  const bezPW = framed ? 22 : 2
  const bezPH = framed ? 34 : 2
  const bezLW = framed ? 34 : 2
  const bezLH = framed ? 22 : 2
  const availW = stage.w - 32 - 26 - bezPW - bezLW
  const availH = stage.h - 32 - 26 - Math.max(bezPH, bezLH)
  const scale = Math.max(0.05, Math.min(1, availW / (device.w + device.h), availH / Math.max(device.h, device.w)))

  return (
    <div className="preview-overlay" onClick={props.onClose}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preview-bar">
          <strong>Preview</strong>
          <span className="seg">
            {devices.map((d) => (
              <button key={d.id} className={d.id === sel ? 'on' : ''} onClick={() => setSel(d.id)}>
                {d.label}
              </button>
            ))}
          </span>
          <span className="dims">
            <label>
              W <input type="number" value={device.w} onChange={(e) => updateDim('w', Number(e.target.value))} />
            </label>
            <label>
              H <input type="number" value={device.h} onChange={(e) => updateDim('h', Number(e.target.value))} />
            </label>
          </span>
          <Checkbox
            checked={framed}
            onChange={setFramed}
            label={
              <>
                <Icon icon={Smartphone} size={14} /> Frame
              </>
            }
          />
          <Checkbox checked={sync} onChange={setSync} label="Sync" title="Mirror interaction across portrait & landscape" />
          <span className="spacer" />
          <button onClick={props.onClose}>
            <Icon icon={X} size={14} /> Close
          </button>
        </div>

        <div className="preview-scope">
          <span className="scope-label">Play:</span>
          <button className={'scope-chip' + (picked.length === 0 ? ' on' : '')} onClick={playAll} title="Run the whole ad start to finish">
            <Icon icon={Play} size={13} /> Whole flow
          </button>
          {project.scenes.map((s, i) => (
            <button
              key={s.id}
              className={'scope-chip' + (picked.includes(s.id) ? ' on' : '')}
              onClick={() => togglePick(s.id)}
              title="Click to play just this scene; pick several to play a series"
            >
              <Icon icon={SCENE_KIND_ICON[s.kind ?? 'custom'] ?? LayoutGrid} size={13} /> {i + 1}. {s.name}
            </button>
          ))}
          <button className="scope-replay" onClick={() => setPlayKey((k) => k + 1)} title="Restart playback">
            <Icon icon={RotateCcw} size={13} /> Replay
          </button>
        </div>
        <div className="scope-hint">
          {picked.length === 0
            ? 'Playing the whole ad from the start scene. Click a scene to preview just it (pick several for a sequence).'
            : `Previewing ${picked.length === 1 ? 'one scene' : picked.length + ' scenes'} in order. Click “Whole flow” to play the full ad.`}
        </div>

        <div className="preview-stage" ref={stageRef}>
          <DeviceView project={effProject} assets={assets} playKey={playKey} w={device.w} h={device.h} label="Portrait" scale={scale} framed={framed} iframeRef={pRef} />
          <DeviceView project={effProject} assets={assets} playKey={playKey} w={device.h} h={device.w} label="Landscape" scale={scale} framed={framed} iframeRef={lRef} />
        </div>
      </div>
    </div>
  )
}
