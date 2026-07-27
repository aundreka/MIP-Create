// The scene timeline — a video-editor style track panel under the canvas.
//
// One lane per element in the active scene (top layer first, like the layer list).
// An element with `timing` draws a CLIP you can drag to move, or trim from either
// edge; its entrance/exit animations are drawn as ramps at the clip ends so you can
// see the fade/slide eating into the visible time. An element without timing draws a
// flat "always on" bar until you give it a clip.
//
// The playhead drives the canvas: the position is published through src/timeline.ts,
// EditorCanvas forwards it to the active scene's iframe, and the runtime puts every
// timed element into the state it would have at that instant — entrance and exit
// animations included, frozen on the matching frame (see StageHandle.seekTimeline).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SceneElement } from '../../runtime/scene'
import { beginTransaction, endTransaction, patchElement, patchSceneDef, selectWithGroups, useEditorState } from '../store'
import { clipEnd, setTimeline, timelineLength, useTimeline } from '../timeline'
import { ChevronRight, Icon, Pause, Play, Repeat, SkipBack } from '../icons'

const LABEL_W = 138 // px reserved for the element-name column
const SNAP_PX = 7 // pointer distance within which a drag snaps to a guide time
const MIN_CLIP_MS = 100
const DEFAULT_CLIP_MS = 2000

/** Ruler step that keeps labels at least ~64px apart at the current scale. */
function tickStep(pxPerMs: number): number {
  for (const step of [100, 200, 250, 500, 1000, 2000, 5000, 10000, 30000]) {
    if (step * pxPerMs >= 64) return step
  }
  return 60000
}

function fmt(ms: number): string {
  const t = Math.max(0, ms)
  const s = Math.floor(t / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${Math.floor((t % 1000) / 100)}`
}

/** Total ms an animation phase occupies — mirrors anim.ts phaseTotalMs for the ramp widths. */
function phaseMs(el: SceneElement, phase: 'entrance' | 'exit'): number {
  const a = el.animations
  if (!a) return 0
  const specs = [a[phase], ...(a[phase === 'entrance' ? 'entranceExtra' : 'exitExtra'] ?? [])].filter(Boolean)
  if (!specs.length) return 0
  return Math.max(0, ...specs.map((s) => (s!.delayMs || 0) + s!.durationMs))
}

type Drag =
  | { mode: 'move' | 'in' | 'out'; id: string; startX: number; inMs: number; durMs: number | null }
  | { mode: 'scrub' }
  | null

export function Timeline(): JSX.Element {
  const { project, activeSceneId, selectedIds } = useEditorState()
  const tl = useTimeline()
  const sd = project.scenes.find((s) => s.id === activeSceneId)
  const lengthMs = timelineLength(sd)

  // Playback position is kept LOCAL while running: pushing 60 updates a second into
  // the shared store would re-render the whole canvas column. The store only learns
  // the position when playback stops or the user scrubs — which is also exactly when
  // the canvas needs a new frame.
  const [liveMs, setLiveMs] = useState(tl.ms)
  const [loop, setLoop] = useState(false)
  const [laneW, setLaneW] = useState(600)
  const lanesRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag>(null)
  const loopRef = useRef(loop)
  loopRef.current = loop

  useEffect(() => {
    if (!tl.playing) setLiveMs(tl.ms)
  }, [tl.ms, tl.playing])

  // Measure the lane column so time↔px conversion tracks panel resizes and the
  // dock panels being dragged, not just the initial mount.
  useLayoutEffect(() => {
    const node = lanesRef.current
    if (!node) return
    const measure = (): void => setLaneW(Math.max(80, node.clientWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [tl.open])

  const pxPerMs = laneW / lengthMs
  const toMs = useCallback(
    (clientX: number): number => {
      const r = lanesRef.current?.getBoundingClientRect()
      if (!r) return 0
      return Math.max(0, Math.min(lengthMs, (clientX - r.left) / pxPerMs))
    },
    [lengthMs, pxPerMs],
  )

  // ---- playback -------------------------------------------------------------
  useEffect(() => {
    if (!tl.playing) return
    let raf = 0
    const origin = performance.now() - tl.ms
    const step = (now: number): void => {
      const t = now - origin
      if (t >= lengthMs) {
        if (loopRef.current) {
          setLiveMs(0)
          setTimeline({ ms: 0, playing: true }) // re-arms the runtime timeline from the top
          return
        }
        setLiveMs(lengthMs)
        setTimeline({ ms: lengthMs, playing: false })
        return
      }
      setLiveMs(t)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [tl.playing, tl.ms, lengthMs])

  const play = (): void => {
    const from = liveMs >= lengthMs - 1 ? 0 : liveMs
    setLiveMs(from)
    setTimeline({ ms: from, playing: true })
  }
  const pause = (): void => setTimeline({ ms: liveMs, playing: false })
  const rewind = (): void => {
    setLiveMs(0)
    setTimeline({ ms: 0, playing: false })
  }
  const seekTo = (ms: number): void => {
    setLiveMs(ms)
    setTimeline({ ms, playing: false })
  }

  // ---- elements + snap guides ----------------------------------------------
  const rows = useMemo(() => [...(sd?.elements ?? [])].sort((a, b) => b.zIndex - a.zIndex), [sd])

  /** Times a dragged edge snaps to: the ruler ends, the playhead, and every OTHER clip's edges. */
  const guidesFor = useCallback(
    (skipId: string): number[] => {
      const g = [0, lengthMs, liveMs]
      for (const el of rows) {
        if (el.id === skipId || !el.timing) continue
        g.push(Math.max(0, el.timing.inMs || 0))
        const end = clipEnd(el)
        if (end != null) g.push(end)
      }
      return g
    },
    [rows, lengthMs, liveMs],
  )
  const snap = useCallback(
    (ms: number, guides: number[]): number => {
      const tol = SNAP_PX / pxPerMs
      let best = ms
      let bestD = tol
      for (const g of guides) {
        const d = Math.abs(g - ms)
        if (d < bestD) {
          bestD = d
          best = g
        }
      }
      return Math.round(best)
    },
    [pxPerMs],
  )

  // ---- clip editing ---------------------------------------------------------
  const startClipDrag = (e: React.PointerEvent, el: SceneElement, mode: 'move' | 'in' | 'out'): void => {
    if (!el.timing) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    beginTransaction()
    drag.current = {
      mode,
      id: el.id,
      startX: e.clientX,
      inMs: Math.max(0, el.timing.inMs || 0),
      durMs: el.timing.durationMs != null && el.timing.durationMs > 0 ? el.timing.durationMs : null,
    }
    if (!selectedIds.includes(el.id)) selectWithGroups(el.id, false)
  }

  const onClipMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d || d.mode === 'scrub') return
    const dMs = (e.clientX - d.startX) / pxPerMs
    const guides = guidesFor(d.id)
    const openEnd = d.durMs == null

    if (d.mode === 'move') {
      const inMs = Math.max(0, snap(d.inMs + dMs, guides))
      patchElement(d.id, { timing: { inMs, durationMs: d.durMs ?? undefined } })
      return
    }
    if (d.mode === 'in') {
      // Trimming the head holds the tail still, so the clip's OUT point doesn't drift.
      const outMs = openEnd ? null : d.inMs + (d.durMs as number)
      const inMs = Math.max(0, Math.min(snap(d.inMs + dMs, guides), (outMs ?? lengthMs) - MIN_CLIP_MS))
      patchElement(d.id, { timing: { inMs, durationMs: outMs == null ? undefined : outMs - inMs } })
      return
    }
    // 'out' — trim the tail; dragging past the ruler end reopens the clip ("until scene ends")
    const rawOut = snap((openEnd ? lengthMs : d.inMs + (d.durMs as number)) + dMs, guides)
    if (rawOut >= lengthMs) {
      patchElement(d.id, { timing: { inMs: d.inMs, durationMs: undefined } })
      return
    }
    patchElement(d.id, { timing: { inMs: d.inMs, durationMs: Math.max(MIN_CLIP_MS, rawOut - d.inMs) } })
  }

  const endDrag = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.mode !== 'scrub') endTransaction()
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released (capture lost on element re-render) */
    }
  }

  const addClip = (el: SceneElement, atMs?: number): void => {
    const inMs = Math.round(Math.max(0, atMs ?? liveMs))
    patchElement(el.id, { timing: { inMs, durationMs: Math.max(MIN_CLIP_MS, Math.min(DEFAULT_CLIP_MS, lengthMs - inMs)) } })
  }

  // ---- ruler scrubbing ------------------------------------------------------
  const onRulerDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { mode: 'scrub' }
    if (tl.playing) setTimeline({ ms: toMs(e.clientX), playing: false })
    seekTo(toMs(e.clientX))
  }
  const onRulerMove = (e: React.PointerEvent): void => {
    if (drag.current?.mode !== 'scrub') return
    seekTo(toMs(e.clientX))
  }

  // Space toggles playback while the panel has focus — the canvas uses Space for
  // panning, so this stays scoped to the timeline's own subtree.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== ' ' && e.key !== 'Spacebar') return
    e.preventDefault()
    if (tl.playing) pause()
    else play()
  }

  const step = tickStep(pxPerMs)
  const ticks: number[] = []
  for (let t = 0; t <= lengthMs + 1; t += step) ticks.push(t)
  const timedCount = rows.filter((e) => e.timing).length

  if (!tl.open) {
    return (
      <div className="tl tl-collapsed">
        <button className="tl-toggle" onClick={() => setTimeline({ open: true })} title="Show the scene timeline">
          <Icon icon={ChevronRight} size={13} className="tl-chevron" />
          <span>Timeline</span>
          {timedCount > 0 && <span className="tl-count">{timedCount}</span>}
        </button>
      </div>
    )
  }

  return (
    <div className="tl" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="tl-bar">
        <button className="tl-toggle" onClick={() => setTimeline({ open: false, playing: false })} title="Hide the timeline">
          <Icon icon={ChevronRight} size={13} className="tl-chevron open" />
          <span>Timeline</span>
        </button>
        <button className="tl-btn" onClick={rewind} title="Back to start">
          <Icon icon={SkipBack} size={13} />
        </button>
        <button className="tl-btn tl-play" onClick={() => (tl.playing ? pause() : play())} title={tl.playing ? 'Pause (Space)' : 'Play (Space)'}>
          <Icon icon={tl.playing ? Pause : Play} size={13} />
        </button>
        <button className={'tl-btn' + (loop ? ' on' : '')} onClick={() => setLoop((v) => !v)} title="Loop playback">
          <Icon icon={Repeat} size={13} />
        </button>
        <span className="tl-time">
          {fmt(liveMs)} <i>/ {fmt(lengthMs)}</i>
        </span>
        <label className="tl-len" title="Length of this scene's timeline">
          <span>Length</span>
          <input
            type="number"
            min={1}
            max={120}
            step={0.5}
            value={Math.round((lengthMs / 1000) * 10) / 10}
            onChange={(e) => {
              const secs = Number(e.target.value)
              if (isFinite(secs) && secs > 0) patchSceneDef(activeSceneId, { timelineMs: Math.round(secs * 1000) })
            }}
          />
          <span>s</span>
        </label>
        <span className="tl-hint">Drag a clip to move it · drag its edges to trim</span>
      </div>

      <div className="tl-body">
        <div className="tl-names">
          <div className="tl-names-head" />
          {rows.map((el) => (
            <div
              key={el.id}
              className={'tl-name' + (selectedIds.includes(el.id) ? ' sel' : '')}
              onClick={() => selectWithGroups(el.id, false)}
              title={el.name}
            >
              <span className="tl-name-txt">{el.name}</span>
              {el.timing ? (
                <button
                  className="tl-name-btn"
                  title="Remove the timing (always visible)"
                  onClick={(e) => {
                    e.stopPropagation()
                    patchElement(el.id, { timing: undefined })
                  }}
                >
                  ✕
                </button>
              ) : (
                <button
                  className="tl-name-btn add"
                  title="Give this element an in/out window, starting at the playhead"
                  onClick={(e) => {
                    e.stopPropagation()
                    addClip(el)
                  }}
                >
                  +
                </button>
              )}
            </div>
          ))}
          {!rows.length && <div className="tl-empty">This scene has no elements yet.</div>}
        </div>

        <div className="tl-lanes" ref={lanesRef} style={{ ['--tl-label-w' as string]: LABEL_W + 'px' }}>
          <div
            className="tl-ruler"
            onPointerDown={onRulerDown}
            onPointerMove={onRulerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {ticks.map((t) => (
              <div key={t} className="tl-tick" style={{ left: t * pxPerMs }}>
                <span>{t % 1000 === 0 ? t / 1000 + 's' : (t / 1000).toFixed(1)}</span>
              </div>
            ))}
          </div>

          {rows.map((el) => {
            const timing = el.timing
            if (!timing) {
              return (
                <div key={el.id} className="tl-lane" onDoubleClick={(e) => addClip(el, toMs(e.clientX))}>
                  <div className="tl-always" title="Always visible — double-click to give it an in/out window">
                    always on
                  </div>
                </div>
              )
            }
            const inMs = Math.max(0, timing.inMs || 0)
            const end = clipEnd(el)
            const open = end == null
            const left = inMs * pxPerMs
            const width = Math.max(6, ((open ? lengthMs : end) - inMs) * pxPerMs)
            const entW = Math.min(phaseMs(el, 'entrance') * pxPerMs, width)
            const exitW = open ? 0 : Math.min(phaseMs(el, 'exit') * pxPerMs, width - entW)
            return (
              <div key={el.id} className="tl-lane" onDoubleClick={(e) => seekTo(toMs(e.clientX))}>
                <div
                  className={'tl-clip' + (selectedIds.includes(el.id) ? ' sel' : '') + (open ? ' open' : '')}
                  style={{ left, width }}
                  onPointerDown={(e) => startClipDrag(e, el, 'move')}
                  onPointerMove={onClipMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {entW > 1 && <div className="tl-ramp in" style={{ width: entW }} />}
                  {exitW > 1 && <div className="tl-ramp out" style={{ width: exitW }} />}
                  <span className="tl-clip-txt">{fmt(inMs)}{open ? ' → end' : ` · ${((end! - inMs) / 1000).toFixed(1)}s`}</span>
                  <div
                    className="tl-handle l"
                    title="Trim the in point"
                    onPointerDown={(e) => startClipDrag(e, el, 'in')}
                    onPointerMove={onClipMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                  <div
                    className="tl-handle r"
                    title="Trim the out point (drag past the end to keep it until the scene ends)"
                    onPointerDown={(e) => startClipDrag(e, el, 'out')}
                    onPointerMove={onClipMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                </div>
              </div>
            )
          })}

          <div className="tl-playhead" style={{ left: liveMs * pxPerMs }}>
            <i />
          </div>
        </div>
      </div>
    </div>
  )
}
