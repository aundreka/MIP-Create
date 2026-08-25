// Remove background — the wand from removeBg.ts with a live preview in front of it.
//
// The preview runs on a downscaled copy so dragging a slider stays interactive; only
// Apply pays for the full-resolution pass. Applying never overwrites the source: it
// adds a NEW image asset (marked with `origin`) and repoints the element at it, so
// "Restore original" in the Inspector is always one click away.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, Pipette, RotateCcw, X } from '../icons'
import { Slider, Toggle } from '../ui'
import { addAsset, getState, patchElement, useEditorState } from '../store'
import { loadImagePixels, pixelsToDataUrl, removeBackgroundFromSrc, removedBackgroundCopy, type RemoveBgOptions, type RemoveBgPoint } from '../removeBg'

const PREVIEW_MAX = 900 // longest side of the copy the live preview works on

/** `${base}_nobg`, with a counter when that id is already taken. */
function cutoutId(base: string, taken: Record<string, unknown>): string {
  const stem = base.replace(/_nobg\d*$/, '') || 'image'
  let id = `${stem}_nobg`
  for (let n = 2; taken[id]; n++) id = `${stem}_nobg${n}`
  return id
}

export function RemoveBgModal(props: { elementId: string; assetId: string; onClose: () => void }): JSX.Element {
  const state = useEditorState()
  const asset = state.assets[props.assetId]
  const [tolerance, setTolerance] = useState(18)
  const [softness, setSoftness] = useState(10)
  const [featherPx, setFeatherPx] = useState(1)
  const [contiguous, setContiguous] = useState(true)
  const [seeds, setSeeds] = useState<RemoveBgPoint[]>([])
  const [compare, setCompare] = useState(false)
  const [base, setBase] = useState<ImageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removed, setRemoved] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const opts = useMemo<RemoveBgOptions>(() => ({ tolerance, softness, featherPx, contiguous, seeds }), [tolerance, softness, featherPx, contiguous, seeds])

  // Decode once — every parameter change re-runs the wand over this copy.
  useEffect(() => {
    let alive = true
    setError(null)
    if (!asset?.src) return
    void loadImagePixels(asset.src, PREVIEW_MAX)
      .then((pixels) => {
        if (alive) setBase(pixels)
      })
      .catch(() => {
        if (alive) setError('This image could not be read for editing.')
      })
    return () => {
      alive = false
    }
  }, [asset?.src])

  // Repaint the preview, one frame behind the slider so a drag never blocks on a pass.
  useEffect(() => {
    if (!base) return
    const canvas = canvasRef.current
    if (!canvas) return
    const timer = setTimeout(() => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = base.width
      canvas.height = base.height
      if (compare) {
        ctx.putImageData(base, 0, 0)
        return
      }
      const out = removedBackgroundCopy(base, opts)
      ctx.putImageData(out.pixels, 0, 0)
      setRemoved(out.removed)
    }, 60)
    return () => clearTimeout(timer)
  }, [base, opts, compare])

  // Clicking the preview adds a background colour to sample. Stored as a 0-1 fraction
  // so the picks survive the jump from the preview copy to the full-size apply.
  const pick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    setSeeds((prev) => [...prev, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }])
  }

  const apply = async (): Promise<void> => {
    if (!asset?.src) return
    setBusy(true)
    setError(null)
    try {
      const out = await removeBackgroundFromSrc(asset.src, opts)
      if (!out.removed) {
        setError('Nothing matched — raise the tolerance, or click the background to sample its colour.')
        return
      }
      const id = cutoutId(props.assetId, getState().assets)
      addAsset(id, { src: out.src, w: out.w, h: out.h, origin: props.assetId })
      patchElement(props.elementId, { assetId: id })
      props.onClose()
    } catch {
      setError('The cut-out could not be created.')
    } finally {
      setBusy(false)
    }
  }

  // Straight to the library without touching the element — for building a cut-out to
  // reuse elsewhere (a container's inner image, a game slot) rather than swapping this one.
  const saveCopy = async (): Promise<void> => {
    if (!base) return
    setBusy(true)
    try {
      const out = removedBackgroundCopy(base, opts)
      const id = cutoutId(props.assetId, getState().assets)
      addAsset(id, { src: pixelsToDataUrl(out.pixels), w: out.pixels.width, h: out.pixels.height, origin: props.assetId })
      props.onClose()
    } finally {
      setBusy(false)
    }
  }

  const reset = (): void => {
    setTolerance(18)
    setSoftness(10)
    setFeatherPx(1)
    setContiguous(true)
    setSeeds([])
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className="modal modal-lg rmbg-modal" role="dialog" aria-modal="true" aria-label="Remove background">
        <div className="modal-bar">
          <Icon icon={Pipette} size={16} />
          <strong className="modal-title">Remove background</strong>
          <span className="spacer" />
          <button onClick={props.onClose} title="Close">
            <Icon icon={X} size={14} />
          </button>
        </div>
        <div className="modal-body rmbg-body">
          <div className="rmbg-stage">
            {!asset?.src ? (
              <div className="hint pad">This element has no image.</div>
            ) : !base && !error ? (
              <div className="hint pad">Reading image…</div>
            ) : (
              <canvas ref={canvasRef} className="rmbg-canvas" onClick={pick} title="Click a background area to sample its colour" />
            )}
          </div>
          <div className="rmbg-side">
            <Slider label="Tolerance" value={tolerance} min={0} max={100} onChange={setTolerance} />
            <Slider label="Edge softness" value={softness} min={0} max={40} onChange={setSoftness} />
            <Slider label="Feather" value={featherPx} min={0} max={6} onChange={setFeatherPx} suffix="px" />
            <Toggle label="Only the connected area" checked={contiguous} onChange={setContiguous} />
            <Toggle label="Show original" checked={compare} onChange={setCompare} />
            <div className="hint pad">
              {seeds.length
                ? `Sampling ${seeds.length} picked colour${seeds.length === 1 ? '' : 's'}.`
                : 'Sampling the four corners. Click the image to pick the background colour instead.'}{' '}
              <b>Only the connected area</b> keeps a white shirt when the backdrop is white; turn it off to cut one flat colour everywhere.
            </div>
            {seeds.length > 0 && (
              <button className="wide" onClick={() => setSeeds([])}>
                Clear picked colours
              </button>
            )}
            <button className="wide" onClick={reset}>
              <Icon icon={RotateCcw} size={13} /> Reset settings
            </button>
            {removed != null && !compare && !error && (
              <div className="hint pad">
                {removed
                  ? `Cutting ${Math.round((removed / ((base?.width ?? 1) * (base?.height ?? 1))) * 100)}% of the picture.`
                  : 'Nothing matches yet — raise the tolerance or pick a colour.'}
              </div>
            )}
            {error && <div className="hint pad warn">{error}</div>}
          </div>
        </div>
        <div className="rmbg-foot">
          <span className="hint">The original image is kept — you can restore it from the Image panel.</span>
          <span className="spacer" />
          <button onClick={props.onClose}>Cancel</button>
          <button disabled={!base || busy} onClick={() => void saveCopy()}>
            Save as new image
          </button>
          <button className="primary" disabled={!base || busy} onClick={() => void apply()}>
            {busy ? 'Working…' : 'Apply to element'}
          </button>
        </div>
      </div>
    </div>
  )
}
