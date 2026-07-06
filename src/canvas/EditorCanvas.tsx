// Editing surface — a Figma-style multi-frame canvas. Every scene renders as a
// frame (its own <iframe>) on a pan/zoom "world"; frames can be dragged around to
// compare scenes side by side. The ACTIVE frame carries the editing overlay
// (selection/handles/guides/marquee/inline-edit); clicking another frame activates
// it. Per-frame coordinate math is unchanged from the single-frame editor.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FrameMetrics, FrameRect, FrameToParent } from '../../runtime/frame-protocol'
import type { ProjectMeta, Scene, SceneDef, SceneElement } from '../../runtime/scene'
import type { AssetMap } from '../../runtime/types'
import { ContextMenu, type MenuItem } from '../panels/ContextMenu'
import { getFramePos, setFramePos } from '../canvasLayout'
import { resizeBox } from './geometry'
import { isSceneHidden, useCanvasView } from '../canvasView'
import { endPathDraw, pathDrawTarget, usePathDraw } from '../drawMode'
import { useEditLocale } from '../locale'
import { sceneAssetIds } from '../export'
import {
  beginTransaction,
  bulkPatch,
  copySelected,
  copyStyle,
  duplicateSelected,
  endTransaction,
  getState,
  groupSelected,
  hasElementClip,
  hasStyleClip,
  moveSelectedToScene,
  pasteElements,
  patchElement,
  patchGeometry,
  pasteStyle,
  redo,
  removeSelected,
  selectOnly,
  selectWithGroups,
  sendToBack,
  bringToFront,
  setActiveScene,
  setSelection,
  toggleLock,
  undo,
  ungroupSelected,
  useEditorState,
} from '../store'

const LANDSCAPE_ASPECT = 2.165
const PORTRAIT_H = 900
const LAND_H = 520
const SNAP = 6
const FRAME_GAP = 96
const EMPTY_RECTS: FrameRect[] = []

type Handle = { k: string; hx: -1 | 0 | 1; hy: -1 | 0 | 1 }
const CORNERS: Handle[] = [
  { k: 'nw', hx: -1, hy: -1 },
  { k: 'ne', hx: 1, hy: -1 },
  { k: 'sw', hx: -1, hy: 1 },
  { k: 'se', hx: 1, hy: 1 },
]
const EDGES: Handle[] = [
  { k: 'n', hx: 0, hy: -1 },
  { k: 's', hx: 0, hy: 1 },
  { k: 'w', hx: -1, hy: 0 },
  { k: 'e', hx: 1, hy: 0 },
]

function effGeom(el: SceneElement, landscape: boolean) {
  const ov = landscape ? el.landscape : undefined
  return { x: ov?.x ?? el.x, y: ov?.y ?? el.y, scale: ov?.scale ?? el.scale ?? 1, w: ov?.w ?? el.w, h: ov?.h ?? el.h }
}
function boxSizable(el: SceneElement): boolean {
  return (
    el.type === 'cta' ||
    el.type === 'bar' ||
    (el.w != null && el.h != null) ||
    (el.type === 'text' && (!!el.box?.bgColor || !!el.box?.borderPx || el.w != null))
  )
}

// ---- one scene's iframe; reports its own layout (rects + metrics) -----------
function CanvasFrame(props: {
  sceneId: string
  def: SceneDef
  meta: ProjectMeta
  assets: AssetMap
  renderKey: number
  locale: string | null
  onLayout: (id: string, rects: FrameRect[], metrics: FrameMetrics) => void
  iframeRef?: (el: HTMLIFrameElement | null) => void
}): JSX.Element {
  const { sceneId, def, meta, assets, renderKey, locale, onLayout, iframeRef } = props
  const ref = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  // Track the last assets reference sent — only include assets in the message when
  // they actually change. Structured-cloning the full asset map (all image data URIs)
  // on every pointer-move event blocks the main thread and kills live drag updates.
  const lastSentAssets = useRef<AssetMap | null>(null)
  // Give this frame only the assets ITS OWN scene references, not the whole shared
  // library — otherwise every scene iframe caches a full decoded copy of every
  // image/video (the main out-of-memory cause). The key keeps the memo identity
  // stable across position edits so `changed` stays false and we don't re-clone the
  // map on each structural render (which would stall live drags).
  const assetKey = useMemo(() => sceneAssetIds(def, assets).sort().join('|'), [def, assets])
  const frameAssets = useMemo(() => {
    const out: AssetMap = {}
    for (const id of assetKey ? assetKey.split('|') : []) if (assets[id]) out[id] = assets[id]
    return out
  }, [assetKey, assets])
  const post = useCallback(() => {
    const scene: Scene = { meta: { ...meta, bgMatchColor: def.bgColor !== undefined ? def.bgColor : meta.bgMatchColor }, elements: def.elements, kind: def.kind, overlay: def.overlay }
    const changed = lastSentAssets.current !== frameAssets
    lastSentAssets.current = frameAssets
    ref.current?.contentWindow?.postMessage({ type: 'pa:render', scene, assets: changed ? frameAssets : undefined, interactive: false, locale }, '*')
  }, [def, meta, frameAssets, locale])
  useEffect(() => {
    if (ready.current) post()
  }, [post, renderKey])
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.source !== ref.current?.contentWindow) return
      const d = e.data as FrameToParent
      if (!d || typeof d !== 'object') return
      if (d.type === 'pa:ready') {
        ready.current = true
        post()
      } else if (d.type === 'pa:layout') {
        onLayout(sceneId, d.rects, d.metrics)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [post, sceneId, onLayout])
  return (
    <iframe
      ref={(el) => {
        (ref as React.MutableRefObject<HTMLIFrameElement | null>).current = el
        iframeRef?.(el)
      }}
      className="canvas-frame"
      src="./runtime-frame.html"
      title={sceneId}
      onLoad={post}
    />
  )
}

interface Props {
  zoom: number
  pan: { x: number; y: number }
  setZoom: (z: number) => void
  setPan: (p: { x: number; y: number }) => void
  fitSignal: number
}

type Drag =
  | { mode: 'move'; start: { px: number; py: number }; base: Record<string, { x: number; y: number }>; bbox: { x: number; y: number; w: number; h: number } }
  | { mode: 'resize'; id: string; h: Handle; start: { px: number; py: number }; kind: 'wh' | 'scale' | 'font'; sw: number; sh: number; sScale: number; sFont: number; nativeW: number; sx: number; sy: number; anchor: SceneElement['anchor']; cx: number; cy: number; sDist: number }
  | { mode: 'group-scale'; start: { px: number; py: number }; cx: number; cy: number; sDist: number; members: { id: string; x: number; y: number; w?: number; h?: number; scale?: number; font?: number }[] }
  | { mode: 'marquee'; start: { px: number; py: number } }
  | { mode: 'pan'; start: { x: number; y: number }; pan0: { x: number; y: number } }
  | null

export function EditorCanvas(props: Props): JSX.Element {
  const { zoom, pan, setZoom, setPan, fitSignal } = props
  const { project, scene, assets, selectedIds, orientation, trace, activeSceneId } = useEditorState()
  useCanvasView() // re-render when canvas scene visibility changes
  const editLocale = useEditLocale()
  const landscape = orientation === 'landscape'
  const traceSrc = trace.visible && trace.assetId ? assets[trace.assetId]?.src : undefined
  // Frames shown on the canvas: visible scenes + always the active one.
  const visibleScenes = project.scenes.filter((s) => s.id === activeSceneId || !isSceneHidden(s.id))

  const areaRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  // Direct iframe ref for drag updates — bypasses the useEffect chain so position
  // changes reach the iframe in the same event handler, not one paint cycle later.
  const activeIframeRef = useRef<HTMLIFrameElement | null>(null)
  const editLocaleRef = useRef(editLocale)
  editLocaleRef.current = editLocale

  const [box, setBox] = useState({ w: 506, h: 900 })
  const [renderKey, setRenderKey] = useState(0)
  const [rectsByScene, setRectsByScene] = useState<Record<string, FrameRect[]>>({})
  const metricsByScene = useRef<Record<string, FrameMetrics>>({})
  const metricsRef = useRef<FrameMetrics>({ s: 1, offX: 0, offY: 0, vw: 1, vh: 1 })
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // During a move-drag, the scene frame the cursor is hovering (other than the active
  // one) — dropping there relocates the selection into that scene.
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  // Reveal-image editor (scratch): which game-mount's reveal is being positioned, the
  // live transform during a drag, and the in-flight gesture.
  const [revealEdit, setRevealEdit] = useState<string | null>(null)
  const [revealLive, setRevealLive] = useState<{ scale: number; x: number; y: number } | null>(null)
  const revealDrag = useRef<{ mode: 'move' | 'scale'; sx: number; sy: number; startX: number; startY: number; startScale: number; rectW: number; rectH: number; ccx: number; ccy: number; startDist: number; last: { scale: number; x: number; y: number } | null } | null>(null)
  const curRevealRef = useRef<{ scale: number; x: number; y: number }>({ scale: 1, x: 0, y: 0 })
  // Reveal-zone editor (scratch / scratch grid): which game-mount's zone is being drawn,
  // the live rect during a drag (percent of the card / cell), and the in-flight gesture.
  const [zoneEdit, setZoneEdit] = useState<string | null>(null)
  const [zoneLive, setZoneLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const zoneDrag = useRef<
    | { mode: 'move' | 'resize'; hx: number; hy: number; ox: number; oy: number; base: { x: number; y: number; w: number; h: number }; start: { x: number; y: number; w: number; h: number }; last: { x: number; y: number; w: number; h: number } | null }
    | null
  >(null)
  const curZoneRef = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 100, h: 100 })
  const [posTick, setPosTick] = useState(0)
  const [panning, setPanning] = useState(false)
  const pathDraw = usePathDraw()
  // Multi-node path drawing: clicks drop the start + each waypoint (intrinsic px);
  // pathCursor is the live rubber-band point to the cursor.
  const [pathPoints, setPathPoints] = useState<{ x: number; y: number }[]>([])
  const [pathCursor, setPathCursor] = useState<{ x: number; y: number } | null>(null)
  const pathPointsRef = useRef<{ x: number; y: number }[]>([])
  pathPointsRef.current = pathPoints
  // entering/leaving draw mode clears any in-progress polyline
  useEffect(() => {
    setPathPoints([])
    setPathCursor(null)
  }, [pathDraw])

  const rects = rectsByScene[activeSceneId] ?? EMPTY_RECTS

  const liveRef = useRef({ scene, selectedIds, landscape, rects, zoom, pan, activeSceneId })
  liveRef.current = { scene, selectedIds, landscape, rects, zoom, pan, activeSceneId }

  // Sends the current scene state directly to the active iframe without going through
  // the React render / useEffect cycle. Called after every drag mutation so the canvas
  // updates in the same event handler, not after the next paint.
  const sendToActiveFrame = useCallback(() => {
    const iw = activeIframeRef.current?.contentWindow
    if (!iw) return
    const st = getState()
    const sd = st.project.scenes.find((s) => s.id === st.activeSceneId)
    if (!sd) return
    const scene: Scene = {
      meta: { ...st.project.meta, bgMatchColor: sd.bgColor !== undefined ? sd.bgColor : st.project.meta.bgMatchColor },
      elements: sd.elements,
      kind: sd.kind,
      overlay: sd.overlay,
    }
    // Assets are not included here — the iframe caches them from the last full render.
    iw.postMessage({ type: 'pa:render', scene, interactive: false, locale: editLocaleRef.current }, '*')
  }, [])

  // active scene's metrics drive the overlay math
  useEffect(() => {
    metricsRef.current = metricsByScene.current[activeSceneId] ?? metricsRef.current
  }, [activeSceneId, rectsByScene])

  // Exit the inline text editor if its element was deleted or we switched scenes
  // (element ids are project-unique), so `editing` can't linger and desync.
  useEffect(() => {
    if (editing && !scene.elements.some((e) => e.id === editing)) setEditing(null)
  }, [editing, scene])

  // Leave reveal-edit if the element is gone (delete / scene switch), or on Escape.
  useEffect(() => {
    if (revealEdit && !scene.elements.some((e) => e.id === revealEdit)) {
      setRevealEdit(null)
      setRevealLive(null)
    }
  }, [revealEdit, scene])
  useEffect(() => {
    if (!revealEdit) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        revealDrag.current = null
        setRevealEdit(null)
        setRevealLive(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealEdit])

  // Reveal-zone edit is entered from the inspector (a button dispatches this event).
  useEffect(() => {
    const onEnter = (e: Event): void => {
      const id = (e as CustomEvent<{ elementId: string }>).detail?.elementId
      if (!id) return
      setRevealEdit(null)
      setRevealLive(null)
      setZoneLive(null)
      setZoneEdit(id)
    }
    window.addEventListener('pa:zone-edit', onEnter)
    return () => window.removeEventListener('pa:zone-edit', onEnter)
  }, [])
  useEffect(() => {
    if (zoneEdit && !scene.elements.some((e) => e.id === zoneEdit)) {
      setZoneEdit(null)
      setZoneLive(null)
    }
  }, [zoneEdit, scene])
  useEffect(() => {
    if (!zoneEdit) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        zoneDrag.current = null
        setZoneEdit(null)
        setZoneLive(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoneEdit])

  const handleLayout = useCallback((id: string, r: FrameRect[], m: FrameMetrics): void => {
    metricsByScene.current[id] = m
    if (id === liveRef.current.activeSceneId) metricsRef.current = m
    setRectsByScene((prev) => ({ ...prev, [id]: r }))
  }, [])

  // ---- frame positions (auto row layout, draggable overrides) ---------------
  const positions = useMemo(() => {
    const m: Record<string, { x: number; y: number }> = {}
    project.scenes.forEach((sd, i) => {
      m[sd.id] = getFramePos(sd.id) ?? { x: i * (box.w + FRAME_GAP), y: 0 }
    })
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.scenes, box.w, posTick])

  // ---- box size & fit -------------------------------------------------------
  useLayoutEffect(() => {
    if (landscape) setBox({ w: Math.round(LANDSCAPE_ASPECT * LAND_H), h: LAND_H })
    else setBox({ w: Math.round((scene.meta.baseW / scene.meta.baseH) * PORTRAIT_H), h: PORTRAIT_H })
  }, [landscape, scene.meta.baseW, scene.meta.baseH])

  useEffect(() => {
    setRenderKey((k) => k + 1)
  }, [box.w, box.h])

  const fit = useCallback(() => {
    const area = areaRef.current
    if (!area) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    project.scenes.forEach((sd, i) => {
      if (sd.id !== liveRef.current.activeSceneId && isSceneHidden(sd.id)) return
      const p = getFramePos(sd.id) ?? { x: i * (box.w + FRAME_GAP), y: 0 }
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y - 28) // include the label strip above
      maxX = Math.max(maxX, p.x + box.w)
      maxY = Math.max(maxY, p.y + box.h)
    })
    if (!isFinite(minX)) {
      minX = 0
      minY = 0
      maxX = box.w
      maxY = box.h
    }
    const w = maxX - minX
    const h = maxY - minY
    const pad = 56
    const z = Math.max(0.05, Math.min(2, Math.min((area.clientWidth - pad * 2) / w, (area.clientHeight - pad * 2) / h)))
    setZoom(z)
    setPan({ x: (area.clientWidth - w * z) / 2 - minX * z, y: (area.clientHeight - h * z) / 2 - minY * z })
  }, [project.scenes, box.w, box.h, setZoom, setPan])

  // Fit only on first load, on orientation change, and when the Fit button fires —
  // never continuously. (A ResizeObserver here previously re-fit every render,
  // which fought user zoom/pan and made the view snap back to "fit all".)
  useEffect(() => {
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.w, box.h, fitSignal])

  // ---- coords (relative to the ACTIVE frame's overlay) ----------------------
  const toIntrinsic = (clientX: number, clientY: number): { px: number; py: number } => {
    const r = overlayRef.current!.getBoundingClientRect()
    const z = liveRef.current.zoom
    return { px: (clientX - r.left) / z, py: (clientY - r.top) / z }
  }
  const designDelta = (dpx: number, dpy: number) => ({ dx: dpx / metricsRef.current.s, dy: dpy / metricsRef.current.s })

  // Which visible frame (other than the active one) a client point lands on. The move
  // overlay holds pointer capture, so the cursor can roam over other frames mid-drag;
  // a frame's stage fills box.w × box.h at its world position (the label sits above it).
  const frameUnderClient = (clientX: number, clientY: number): string | null => {
    const area = areaRef.current
    if (!area) return null
    const r = area.getBoundingClientRect()
    const { zoom: z, pan: pn, activeSceneId: act } = liveRef.current
    const wx = (clientX - r.left - pn.x) / z
    const wy = (clientY - r.top - pn.y) / z
    for (const sd of visibleScenes) {
      if (sd.id === act) continue
      const p = positions[sd.id]
      if (p && wx >= p.x && wx <= p.x + box.w && wy >= p.y && wy <= p.y + box.h) return sd.id
    }
    return null
  }

  const selectableOnCanvas = (r: FrameRect): boolean => {
    if (r.type === 'background' || r.type === 'dim') return false
    const el = liveRef.current.scene.elements.find((e) => e.id === r.id)
    if (!el || el.locked) return false
    if (el.type === 'endscene' && ((liveRef.current.landscape ? el.landscape?.mode : undefined) ?? el.mode) === 'extend') return false
    return true
  }

  const hitTest = (px: number, py: number): FrameRect | null => {
    const rs = liveRef.current.rects
    for (let i = rs.length - 1; i >= 0; i--) {
      const r = rs[i]
      if (!selectableOnCanvas(r)) continue
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r
    }
    return null
  }
  const bboxOf = (ids: string[]): { x: number; y: number; w: number; h: number } | null => {
    const rs = liveRef.current.rects.filter((r) => ids.includes(r.id))
    if (!rs.length) return null
    const x1 = Math.min(...rs.map((r) => r.x))
    const y1 = Math.min(...rs.map((r) => r.y))
    const x2 = Math.max(...rs.map((r) => r.x + r.w))
    const y2 = Math.max(...rs.map((r) => r.y + r.h))
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }

  const snapMove = (bbox: { x: number; y: number; w: number; h: number }, dx: number, dy: number) => {
    const m = metricsRef.current
    const meta = liveRef.current.scene.meta
    const others = liveRef.current.rects.filter((r) => !liveRef.current.selectedIds.includes(r.id) && r.type !== 'dim')
    const cL = m.offX
    const cR = m.offX + meta.baseW * m.s
    const cT = m.offY
    const cB = m.offY + meta.baseH * m.s
    const tX = [cL, (cL + cR) / 2, cR, ...others.flatMap((r) => [r.x, r.x + r.w / 2, r.x + r.w])]
    const tY = [cT, (cT + cB) / 2, cB, ...others.flatMap((r) => [r.y, r.y + r.h / 2, r.y + r.h])]
    const lX = [bbox.x + dx, bbox.x + bbox.w / 2 + dx, bbox.x + bbox.w + dx]
    const lY = [bbox.y + dy, bbox.y + bbox.h / 2 + dy, bbox.y + bbox.h + dy]
    let aX = SNAP + 1
    let gX: number | null = null
    for (const l of lX) for (const t of tX) { const d = t - l; if (Math.abs(d) < Math.abs(aX)) { aX = d; gX = t } }
    let aY = SNAP + 1
    let gY: number | null = null
    for (const l of lY) for (const t of tY) { const d = t - l; if (Math.abs(d) < Math.abs(aY)) { aY = d; gY = t } }
    const okX = Math.abs(aX) <= SNAP
    const okY = Math.abs(aY) <= SNAP
    setGuides({ x: okX && gX != null ? [gX] : [], y: okY && gY != null ? [gY] : [] })
    return { dx: dx + (okX ? aX : 0), dy: dy + (okY ? aY : 0) }
  }

  // ---- interactions (active frame) ------------------------------------------
  const drag = useRef<Drag>(null)
  const spaceRef = useRef(false)

  const onOverlayPointerDown = (e: React.PointerEvent): void => {
    if (editing) return
    if (revealEdit) {
      // A pointer-down reaching the overlay = clicked outside the reveal box (the box
      // stops its own events) → exit reveal-edit mode.
      setRevealEdit(null)
      setRevealLive(null)
      return
    }
    if (zoneEdit) {
      // Clicking outside the zone box (which stops its own events) exits zone-edit.
      setZoneEdit(null)
      setZoneLive(null)
      return
    }
    const { px, py } = toIntrinsic(e.clientX, e.clientY)
    if (pathDrawTarget()) {
      // each click drops a waypoint; double-click / Enter finishes (handled below)
      setPathPoints((pts) => [...pts, { x: px, y: py }])
      return
    }
    overlayRef.current?.setPointerCapture(e.pointerId)
    if (spaceRef.current || e.button === 1) {
      drag.current = { mode: 'pan', start: { x: e.clientX, y: e.clientY }, pan0: { ...liveRef.current.pan } }
      return
    }
    const hit = hitTest(px, py)
    if (hit) {
      let ids = liveRef.current.selectedIds
      if (e.shiftKey) {
        selectWithGroups(hit.id, true)
        ids = getState().selectedIds
      } else if (!ids.includes(hit.id)) {
        selectWithGroups(hit.id, false)
        ids = getState().selectedIds
      }
      const base: Record<string, { x: number; y: number }> = {}
      for (const id of ids) {
        const el = liveRef.current.scene.elements.find((x) => x.id === id)
        if (el) base[id] = { x: effGeom(el, liveRef.current.landscape).x, y: effGeom(el, liveRef.current.landscape).y }
      }
      beginTransaction()
      drag.current = { mode: 'move', start: { px, py }, base, bbox: bboxOf(ids) ?? { x: hit.x, y: hit.y, w: hit.w, h: hit.h } }
    } else {
      if (!e.shiftKey) selectOnly(null)
      drag.current = { mode: 'marquee', start: { px, py } }
    }
  }

  const onHandlePointerDown = (e: React.PointerEvent, h: Handle, scope: 'single' | 'group'): void => {
    e.stopPropagation()
    overlayRef.current?.setPointerCapture(e.pointerId)
    const { px, py } = toIntrinsic(e.clientX, e.clientY)
    const s = metricsRef.current.s
    if (scope === 'group') {
      const bb = bboxOf(liveRef.current.selectedIds)
      if (!bb) return
      const cxI = bb.x + bb.w / 2
      const cyI = bb.y + bb.h / 2
      const cx = (cxI - metricsRef.current.offX) / s
      const cy = (cyI - metricsRef.current.offY) / s
      const members = liveRef.current.selectedIds
        .map((id) => liveRef.current.scene.elements.find((x) => x.id === id))
        .filter(Boolean)
        .map((el) => {
          const ge = effGeom(el as SceneElement, liveRef.current.landscape)
          return { id: (el as SceneElement).id, x: ge.x, y: ge.y, w: ge.w, h: ge.h, scale: (el as SceneElement).scale, font: (el as SceneElement).text?.fontSizePx }
        })
      beginTransaction()
      drag.current = { mode: 'group-scale', start: { px, py }, cx, cy, sDist: Math.hypot(px - cxI, py - cyI) || 1, members }
      return
    }
    const id = liveRef.current.selectedIds[0]
    const el = liveRef.current.scene.elements.find((x) => x.id === id)
    const rect = liveRef.current.rects.find((r) => r.id === id)
    if (!el || !rect) return
    const g = effGeom(el, liveRef.current.landscape)
    let kind: 'wh' | 'scale' | 'font' = 'scale'
    let sw = rect.w / s
    let sh = rect.h / s
    let sScale = g.scale
    let sFont = el.text?.fontSizePx ?? 48
    const nativeW = (assets[el.assetId ?? ''] ?? { w: 100 }).w
    if (boxSizable(el)) {
      kind = 'wh'
      sw = g.w ?? sw
      sh = g.h ?? sh
      if (g.w == null || g.h == null) patchGeometry(id, { w: Math.round(sw), h: Math.round(sh) })
    } else if (el.type === 'text') {
      kind = 'font'
    } else {
      kind = 'scale'
      sScale = g.scale
    }
    const cx = rect.x + rect.w / 2 // intrinsic center → distance-based scale/font
    const cy = rect.y + rect.h / 2
    beginTransaction()
    drag.current = { mode: 'resize', id, h, start: { px, py }, kind, sw, sh, sScale, sFont, nativeW, sx: g.x, sy: g.y, anchor: el.anchor, cx, cy, sDist: Math.hypot(px - cx, py - cy) || 1 }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (pathDrawTarget()) {
      const c = toIntrinsic(e.clientX, e.clientY)
      setPathCursor({ x: c.px, y: c.py })
      return
    }
    const d = drag.current
    if (!d) return
    if (d.mode === 'pan') {
      setPan({ x: d.pan0.x + (e.clientX - d.start.x), y: d.pan0.y + (e.clientY - d.start.y) })
      return
    }
    const { px, py } = toIntrinsic(e.clientX, e.clientY)
    if (d.mode === 'move') {
      const snapped = snapMove(d.bbox, px - d.start.px, py - d.start.py)
      const dd = designDelta(snapped.dx, snapped.dy)
      const patches: Record<string, Partial<SceneElement>> = {}
      for (const id of Object.keys(d.base)) patches[id] = { x: Math.round(d.base[id].x + dd.dx), y: Math.round(d.base[id].y + dd.dy) }
      if (liveRef.current.landscape) for (const id of Object.keys(patches)) patchGeometry(id, patches[id])
      else bulkPatch(patches)
      sendToActiveFrame()
      // Highlight another frame when the cursor is over it — dropping moves there.
      setDropTarget(frameUnderClient(e.clientX, e.clientY))
    } else if (d.mode === 'resize') {
      if (d.kind === 'wh') {
        // Move only the grabbed edge(s); keep the opposite edge fixed regardless of
        // the element's anchor (previously grew symmetrically about center / doubled).
        const dd = designDelta(px - d.start.px, py - d.start.py)
        patchGeometry(d.id, resizeBox({ anchor: d.anchor, x: d.sx, y: d.sy, w: d.sw, h: d.sh }, d.h.hx, d.h.hy, dd.dx, dd.dy))
      } else if (d.kind === 'font') {
        // Scale by how far the pointer moved relative to the element center, so
        // every handle (incl. vertical edges) resizes intuitively.
        const f = Math.max(0.2, Math.hypot(px - d.cx, py - d.cy) / d.sDist)
        const el = liveRef.current.scene.elements.find((x) => x.id === d.id)
        if (el?.text) patchElement(d.id, { text: { ...el.text, fontSizePx: Math.max(8, Math.round(d.sFont * f)) } })
      } else {
        const f = Math.max(0.05, Math.hypot(px - d.cx, py - d.cy) / d.sDist)
        patchGeometry(d.id, { scale: +(d.sScale * f).toFixed(3) })
      }
      sendToActiveFrame()
    } else if (d.mode === 'group-scale') {
      const f = Math.max(0.1, Math.hypot(px - (d.cx * metricsRef.current.s + metricsRef.current.offX), py - (d.cy * metricsRef.current.s + metricsRef.current.offY)) / d.sDist)
      const patches: Record<string, Partial<SceneElement>> = {}
      for (const m of d.members) {
        const p: Partial<SceneElement> = { x: Math.round(d.cx + (m.x - d.cx) * f), y: Math.round(d.cy + (m.y - d.cy) * f) }
        if (m.w != null) p.w = Math.max(8, Math.round(m.w * f))
        if (m.h != null) p.h = Math.max(8, Math.round(m.h * f))
        if (m.scale != null) p.scale = Math.max(0.05, +(m.scale * f).toFixed(3))
        if (m.font != null) {
          const el = liveRef.current.scene.elements.find((x) => x.id === m.id)
          if (el?.text) p.text = { ...el.text, fontSizePx: Math.max(8, Math.round(m.font * f)) }
        }
        patches[m.id] = p
      }
      bulkPatch(patches)
      sendToActiveFrame()
    } else if (d.mode === 'marquee') {
      setMarquee({ x: Math.min(d.start.px, px), y: Math.min(d.start.py, py), w: Math.abs(px - d.start.px), h: Math.abs(py - d.start.py) })
    }
  }

  // Finish drawing a handguide path: dedupe near-duplicate clicks (handles the
  // double-click finish), then write the start position + waypoints (preserving any
  // prior per-node dwell times by index when redrawing).
  const commitPath = (): void => {
    const tid = pathDrawTarget()
    const m = metricsRef.current
    const raw = pathPointsRef.current
    const pts: { x: number; y: number }[] = []
    for (const p of raw) {
      const last = pts[pts.length - 1]
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 6) pts.push(p)
    }
    if (tid && pts.length >= 2) {
      const toDesign = (p: { x: number; y: number }): { x: number; y: number } => ({ x: Math.round((p.x - m.offX) / m.s), y: Math.round((p.y - m.offY) / m.s) })
      const start = toDesign(pts[0])
      const tel = liveRef.current.scene.elements.find((x) => x.id === tid)
      const prev = tel?.handguide?.nodes ?? []
      const nodes = pts.slice(1).map((p, i) => ({ ...toDesign(p), pauseMs: prev[i]?.pauseMs }))
      beginTransaction()
      patchGeometry(tid, { x: start.x, y: start.y })
      patchElement(tid, { handguide: { ...(tel?.handguide ?? { mode: 'slide' }), mode: 'slide', nodes, toX: undefined, toY: undefined } })
      endTransaction()
    }
    endPathDraw()
    setPathPoints([])
    setPathCursor(null)
  }
  const commitPathRef = useRef<() => void>(() => {})
  commitPathRef.current = commitPath

  const endInteraction = (e?: React.PointerEvent): void => {
    // Release the pointer capture taken on pointerdown so an interrupted/cancelled
    // gesture can't leak capture and swallow later events.
    if (e && overlayRef.current?.hasPointerCapture?.(e.pointerId)) overlayRef.current.releasePointerCapture(e.pointerId)
    const d = drag.current
    if (!d) return
    // Cross-scene drop: a move-drag released over another frame relocates the selection
    // into that scene at the drop point. The two frames share a coordinate system, so
    // correcting by their world offset (in design units) keeps each element under the
    // cursor. Done while the transaction is still open → the whole gesture is one undo.
    const dropId = e && e.type !== 'pointercancel' && d.mode === 'move' ? frameUnderClient(e.clientX, e.clientY) : null
    if (d.mode === 'move' && dropId) {
      const s = metricsRef.current.s || 1
      const posA = positions[liveRef.current.activeSceneId]
      const posB = positions[dropId]
      if (posA && posB) {
        const ddx = (posA.x - posB.x) / s
        const ddy = (posA.y - posB.y) / s
        const place: Record<string, { x: number; y: number }> = {}
        for (const id of Object.keys(d.base)) {
          const el = liveRef.current.scene.elements.find((x) => x.id === id)
          if (el) { const g = effGeom(el, liveRef.current.landscape); place[id] = { x: g.x + ddx, y: g.y + ddy } }
        }
        moveSelectedToScene(dropId, place)
      }
      endTransaction()
      drag.current = null
      setMarquee(null)
      setGuides({ x: [], y: [] })
      setDropTarget(null)
      return
    }
    if (d.mode === 'marquee' && marquee) {
      const hit = liveRef.current.rects
        .filter(selectableOnCanvas)
        .filter((r) => r.x < marquee.x + marquee.w && r.x + r.w > marquee.x && r.y < marquee.y + marquee.h && r.y + r.h > marquee.y)
        .map((r) => r.id)
      if (hit.length) setSelection(hit)
    }
    if (d.mode === 'move' || d.mode === 'resize' || d.mode === 'group-scale') endTransaction()
    drag.current = null
    setMarquee(null)
    setGuides({ x: [], y: [] })
    setDropTarget(null)
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    if (pathDrawTarget()) {
      commitPath()
      return
    }
    const { px, py } = toIntrinsic(e.clientX, e.clientY)
    const hit = hitTest(px, py)
    if (!hit) return
    if (hit.type === 'text') {
      setEditing(hit.id)
      return
    }
    // Double-click a scratch card that has a prize image → edit the reveal transform.
    const el = liveRef.current.scene.elements.find((x) => x.id === hit.id)
    const g = el?.game
    if (el && el.type === 'game-mount' && g && g.templateId === 'scratch' && g.params?.prize) {
      if (g.params?.fit !== 'fit') patchElement(el.id, { game: { ...g, params: { ...(g.params ?? {}), fit: 'fit' } } })
      setRevealLive(null)
      setRevealEdit(hit.id)
    }
    // Double-click a scratch grid cell → select it in the inspector
    if (el && el.type === 'game-mount' && g && g.templateId === 'scratch_grid') {
      const cols = Math.max(1, Math.min(4, Number(g.params?.cols ?? 2)))
      const rows = Math.max(1, Math.min(4, Number(g.params?.rows ?? 2)))
      const gap = Math.max(0, Number(g.params?.gap ?? 10))
      const colGap = Math.max(0, Number(g.params?.colGap ?? gap))
      const rowGap = Math.max(0, Number(g.params?.rowGap ?? gap))
      const ew = el.w ?? 980
      const eh = el.h ?? 1100
      // el.x/y is the center (anchor=center); convert to top-left edge
      const ex = el.x - ew / 2
      const ey = el.y - eh / 2
      const lx = px - ex
      const ly = py - ey
      const cellW = (ew - gap * 2 - colGap * (cols - 1)) / cols
      const cellH = (eh - gap * 2 - rowGap * (rows - 1)) / rows
      const col = Math.max(0, Math.min(cols - 1, Math.floor((lx - gap) / (cellW + colGap))))
      const row = Math.max(0, Math.min(rows - 1, Math.floor((ly - gap) / (cellH + rowGap))))
      window.dispatchEvent(new CustomEvent('pa:grid-cell-select', { detail: { elementId: el.id, cellIdx: row * cols + col } }))
    }
  }

  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const { px, py } = toIntrinsic(e.clientX, e.clientY)
    const hit = hitTest(px, py)
    if (hit && !liveRef.current.selectedIds.includes(hit.id)) selectWithGroups(hit.id, false)
    setMenu({ x: e.clientX, y: e.clientY })
  }

  // ---- frame drag (reposition) + activation ---------------------------------
  const frameDrag = useRef<{ id: string; sx: number; sy: number; bx: number; by: number; moved: boolean } | null>(null)
  const onFrameLabelDown = (e: React.PointerEvent, id: string): void => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    if (id !== activeSceneId) setActiveScene(id)
    const p = positions[id]
    frameDrag.current = { id, sx: e.clientX, sy: e.clientY, bx: p.x, by: p.y, moved: false }
  }
  const onFrameLabelMove = (e: React.PointerEvent): void => {
    const d = frameDrag.current
    if (!d) return
    // Ignore sub-threshold jitter so a click on the label doesn't persist a
    // 1px frame move (it would also be saved to localStorage).
    if (!d.moved && Math.abs(e.clientX - d.sx) <= 3 && Math.abs(e.clientY - d.sy) <= 3) return
    const z = liveRef.current.zoom
    d.moved = true
    setFramePos(d.id, { x: Math.round(d.bx + (e.clientX - d.sx) / z), y: Math.round(d.by + (e.clientY - d.sy) / z) })
    setPosTick((n) => n + 1)
  }
  const onFrameLabelUp = (): void => {
    frameDrag.current = null
  }

  const activateFrame = (e: React.PointerEvent, id: string): void => {
    setActiveScene(id)
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const z = liveRef.current.zoom
    const px = (e.clientX - r.left) / z
    const py = (e.clientY - r.top) / z
    const rs = rectsByScene[id] ?? []
    let hitId: string | null = null
    for (let i = rs.length - 1; i >= 0; i--) {
      const rc = rs[i]
      if (rc.type === 'background' || rc.type === 'dim') continue
      if (px >= rc.x && px <= rc.x + rc.w && py >= rc.y && py <= rc.y + rc.h) {
        hitId = rc.id
        break
      }
    }
    selectOnly(hitId)
  }

  // ---- area pan (empty space) -----------------------------------------------
  const areaPan = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null)
  const onAreaPointerDown = (e: React.PointerEvent): void => {
    const t = e.target as HTMLElement
    const empty = t.classList.contains('canvas-area') || t.classList.contains('canvas-grid') || t.classList.contains('world')
    if (!empty && !spaceRef.current && e.button !== 1) return
    areaRef.current?.setPointerCapture(e.pointerId)
    areaPan.current = { sx: e.clientX, sy: e.clientY, px: liveRef.current.pan.x, py: liveRef.current.pan.y, moved: false }
    setPanning(true)
  }
  const onAreaPointerMove = (e: React.PointerEvent): void => {
    const d = areaPan.current
    if (!d) return
    if (Math.abs(e.clientX - d.sx) > 2 || Math.abs(e.clientY - d.sy) > 2) d.moved = true
    setPan({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) })
  }
  const onAreaPointerUp = (): void => {
    const d = areaPan.current
    areaPan.current = null
    setPanning(false)
    if (d && !d.moved) selectOnly(null)
  }

  // ---- wheel zoom / pan -----------------------------------------------------
  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const r = area.getBoundingClientRect()
        const ax = e.clientX - r.left
        const ay = e.clientY - r.top
        const z0 = liveRef.current.zoom
        const z = Math.max(0.05, Math.min(3, z0 * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
        const p = liveRef.current.pan
        setPan({ x: ax - ((ax - p.x) / z0) * z, y: ay - ((ay - p.y) / z0) * z })
        setZoom(z)
      } else {
        const p = liveRef.current.pan
        setPan({ x: p.x - e.deltaX, y: p.y - e.deltaY })
      }
    }
    area.addEventListener('wheel', onWheel, { passive: false })
    return () => area.removeEventListener('wheel', onWheel)
  }, [setPan, setZoom])

  // ---- keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Never hijack keys while typing in a field (incl. the inline-text editor),
      // so a space doesn't arm pan and Esc/Enter/Delete don't act on the canvas.
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (pathDrawTarget()) {
        if (e.key === 'Escape') {
          endPathDraw()
          setPathPoints([])
          setPathCursor(null)
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          commitPathRef.current()
          return
        }
      }
      if (e.code === 'Space') spaceRef.current = true
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') return (e.preventDefault(), e.shiftKey ? redo() : undo())
      if (mod && e.key.toLowerCase() === 'd') return (e.preventDefault(), duplicateSelected())
      if (mod && e.key.toLowerCase() === 'c') return (e.preventDefault(), copySelected())
      if (mod && e.key.toLowerCase() === 'x') return (e.preventDefault(), copySelected(), removeSelected())
      // Ctrl+V is handled by the window 'paste' listener (App.tsx) so OS images win.
      if (mod && e.key.toLowerCase() === 'g') return (e.preventDefault(), e.shiftKey ? ungroupSelected() : groupSelected())
      const ids = liveRef.current.selectedIds
      if (!ids.length) {
        if (e.key === 'Escape') selectOnly(null)
        return
      }
      const step = e.shiftKey ? 10 : 1
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        beginTransaction()
        for (const id of ids) {
          const el = liveRef.current.scene.elements.find((x) => x.id === id)
          if (!el) continue
          const g = effGeom(el, liveRef.current.landscape)
          if (e.key === 'ArrowLeft') patchGeometry(id, { x: g.x - step })
          else if (e.key === 'ArrowRight') patchGeometry(id, { x: g.x + step })
          else if (e.key === 'ArrowUp') patchGeometry(id, { y: g.y - step })
          else patchGeometry(id, { y: g.y + step })
        }
        endTransaction()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeSelected()
      } else if (e.key === 'Escape') selectOnly(null)
    }
    const onUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceRef.current = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  // ---- render helpers (active frame) ----------------------------------------
  const single = selectedIds.length === 1 ? scene.elements.find((e) => e.id === selectedIds[0]) ?? null : null
  const singleRect = single ? rects.find((r) => r.id === single.id) ?? null : null
  const singleHandles: Handle[] = single ? (boxSizable(single) ? [...CORNERS, ...EDGES] : CORNERS) : []
  // Handguide slide path (design coords -> intrinsic) for the selected handguide:
  // a polyline from the hand's center through each waypoint.
  const hgPath = (() => {
    if (!single || single.type !== 'handguide' || single.handguide?.mode !== 'slide' || !singleRect) return null
    const hg = single.handguide
    const m = metricsRef.current
    const wp = hg.nodes && hg.nodes.length ? hg.nodes : hg.toX != null && hg.toY != null ? [{ x: hg.toX, y: hg.toY }] : []
    if (!wp.length) return null
    return [
      { x: singleRect.x + singleRect.w / 2, y: singleRect.y + singleRect.h / 2 },
      ...wp.map((n) => ({ x: n.x * m.s + m.offX, y: n.y * m.s + m.offY })),
    ]
  })()
  const groupBbox = selectedIds.length > 1 ? bboxOf(selectedIds) : null
  const editEl = editing ? scene.elements.find((e) => e.id === editing) ?? null : null
  const editRect = editing ? rects.find((r) => r.id === editing) ?? null : null

  const revealEl = revealEdit ? scene.elements.find((e) => e.id === revealEdit) ?? null : null
  const revealRect = revealEdit ? rects.find((r) => r.id === revealEdit) ?? null : null
  const revealParams: Record<string, unknown> = revealEl?.game?.params ?? {}
  const revealSrc = revealParams.prize ? assets[String(revealParams.prize)]?.src : undefined
  const curReveal = revealLive ?? {
    scale: typeof revealParams.revealScale === 'number' ? revealParams.revealScale : 1,
    x: typeof revealParams.revealX === 'number' ? revealParams.revealX : 0,
    y: typeof revealParams.revealY === 'number' ? revealParams.revealY : 0,
  }
  curRevealRef.current = curReveal
  const onRevealBodyDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    if (!revealRect) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const cur = curRevealRef.current
    revealDrag.current = { mode: 'move', sx: e.clientX, sy: e.clientY, startX: cur.x, startY: cur.y, startScale: cur.scale, rectW: revealRect.w, rectH: revealRect.h, ccx: 0, ccy: 0, startDist: 1, last: null }
  }
  const onRevealHandleDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    if (!revealRect) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const o = overlayRef.current!.getBoundingClientRect()
    const z = liveRef.current.zoom
    const ccx = o.left + (revealRect.x + revealRect.w / 2) * z
    const ccy = o.top + (revealRect.y + revealRect.h / 2) * z
    const cur = curRevealRef.current
    revealDrag.current = { mode: 'scale', sx: e.clientX, sy: e.clientY, startX: cur.x, startY: cur.y, startScale: cur.scale, rectW: revealRect.w, rectH: revealRect.h, ccx, ccy, startDist: Math.hypot(e.clientX - ccx, e.clientY - ccy) || 1, last: null }
  }
  const onRevealMove = (e: React.PointerEvent): void => {
    const d = revealDrag.current
    if (!d) return
    e.stopPropagation()
    const z = liveRef.current.zoom
    const next =
      d.mode === 'move'
        ? { scale: d.startScale, x: d.startX + ((e.clientX - d.sx) / z / d.rectW) * 100, y: d.startY + ((e.clientY - d.sy) / z / d.rectH) * 100 }
        : { scale: Math.max(0.05, d.startScale * (Math.hypot(e.clientX - d.ccx, e.clientY - d.ccy) / d.startDist)), x: d.startX, y: d.startY }
    d.last = next
    setRevealLive(next)
  }
  const onRevealUp = (e: React.PointerEvent): void => {
    e.stopPropagation()
    const d = revealDrag.current
    revealDrag.current = null
    const g = revealEl?.game
    if (d?.last && revealEl && g) {
      patchElement(revealEl.id, { game: { ...g, params: { ...(g.params ?? {}), revealScale: d.last.scale, revealX: d.last.x, revealY: d.last.y } } })
    }
  }

  // ---- reveal-zone editor ---------------------------------------------------
  const zoneEl = zoneEdit ? scene.elements.find((e) => e.id === zoneEdit) ?? null : null
  const zoneRect = zoneEdit ? rects.find((r) => r.id === zoneEdit) ?? null : null
  const zoneParams: Record<string, unknown> = zoneEl?.game?.params ?? {}
  const curZone = zoneLive ?? {
    x: typeof zoneParams.zoneX === 'number' ? zoneParams.zoneX : 0,
    y: typeof zoneParams.zoneY === 'number' ? zoneParams.zoneY : 0,
    w: typeof zoneParams.zoneW === 'number' ? zoneParams.zoneW : 100,
    h: typeof zoneParams.zoneH === 'number' ? zoneParams.zoneH : 100,
  }
  curZoneRef.current = curZone
  // The base rect(s) the zone is normalized against: the whole card (scratch) or each
  // cell (scratch grid). All coords are in overlay space (pre-zoom), like `rects`.
  const zoneBaseRects: { x: number; y: number; w: number; h: number }[] = (() => {
    if (!zoneEl || !zoneRect) return []
    const g = zoneEl.game
    if (g?.templateId !== 'scratch_grid') return [{ x: zoneRect.x, y: zoneRect.y, w: zoneRect.w, h: zoneRect.h }]
    const cols = Math.max(1, Math.min(4, Number(g.params?.cols ?? 2)))
    const rows = Math.max(1, Math.min(4, Number(g.params?.rows ?? 2)))
    const gap = Math.max(0, Number(g.params?.gap ?? 10))
    const colGap = Math.max(0, Number(g.params?.colGap ?? gap))
    const rowGap = Math.max(0, Number(g.params?.rowGap ?? gap))
    const ew = zoneEl.w ?? 980
    const eh = zoneEl.h ?? 1100
    const sx = zoneRect.w / ew // design px → overlay px (uniform scale)
    const sy = zoneRect.h / eh
    const cellW = (zoneRect.w - gap * sx * 2 - colGap * sx * (cols - 1)) / cols
    const cellH = (zoneRect.h - gap * sy * 2 - rowGap * sy * (rows - 1)) / rows
    const out: { x: number; y: number; w: number; h: number }[] = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        out.push({
          x: zoneRect.x + gap * sx + col * (cellW + colGap * sx),
          y: zoneRect.y + gap * sy + row * (cellH + rowGap * sy),
          w: cellW,
          h: cellH,
        })
      }
    }
    return out
  })()
  // The editable base rect (whole card, or the top-left cell for a grid). Dragging here
  // sets the shared zone that every cell mirrors.
  const zoneBase = zoneBaseRects[0] ?? null
  const zoneBoxFor = (b: { x: number; y: number; w: number; h: number }, z: { x: number; y: number; w: number; h: number }) => ({
    x: b.x + (z.x / 100) * b.w,
    y: b.y + (z.y / 100) * b.h,
    w: (z.w / 100) * b.w,
    h: (z.h / 100) * b.h,
  })
  const onZoneBodyDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    if (!zoneBase) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const o = overlayRef.current!.getBoundingClientRect()
    const z = liveRef.current.zoom
    zoneDrag.current = { mode: 'move', hx: 0, hy: 0, ox: (e.clientX - o.left) / z, oy: (e.clientY - o.top) / z, base: zoneBase, start: curZoneRef.current, last: null }
  }
  const onZoneHandleDown = (e: React.PointerEvent, hx: number, hy: number): void => {
    e.stopPropagation()
    if (!zoneBase) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const o = overlayRef.current!.getBoundingClientRect()
    const z = liveRef.current.zoom
    zoneDrag.current = { mode: 'resize', hx, hy, ox: (e.clientX - o.left) / z, oy: (e.clientY - o.top) / z, base: zoneBase, start: curZoneRef.current, last: null }
  }
  const onZoneMove = (e: React.PointerEvent): void => {
    const d = zoneDrag.current
    if (!d) return
    e.stopPropagation()
    const o = overlayRef.current!.getBoundingClientRect()
    const z = liveRef.current.zoom
    const ox = (e.clientX - o.left) / z
    const oy = (e.clientY - o.top) / z
    let next: { x: number; y: number; w: number; h: number }
    if (d.mode === 'move') {
      const dx = ((ox - d.ox) / d.base.w) * 100
      const dy = ((oy - d.oy) / d.base.h) * 100
      next = {
        x: Math.max(0, Math.min(100 - d.start.w, d.start.x + dx)),
        y: Math.max(0, Math.min(100 - d.start.h, d.start.y + dy)),
        w: d.start.w,
        h: d.start.h,
      }
    } else {
      // Pointer position as a fraction of the base rect, clamped to it.
      const fx = Math.max(0, Math.min(1, (ox - d.base.x) / d.base.w))
      const fy = Math.max(0, Math.min(1, (oy - d.base.y) / d.base.h))
      const left = d.start.x / 100
      const top = d.start.y / 100
      const right = (d.start.x + d.start.w) / 100
      const bottom = (d.start.y + d.start.h) / 100
      const MIN = 0.02
      let nx = left
      let nw = right - left
      let ny = top
      let nh = bottom - top
      if (d.hx < 0) { nx = Math.min(fx, right - MIN); nw = right - nx }
      else if (d.hx > 0) { nw = Math.max(MIN, fx - left) }
      if (d.hy < 0) { ny = Math.min(fy, bottom - MIN); nh = bottom - ny }
      else if (d.hy > 0) { nh = Math.max(MIN, fy - top) }
      next = { x: nx * 100, y: ny * 100, w: nw * 100, h: nh * 100 }
    }
    d.last = next
    setZoneLive(next)
  }
  const onZoneUp = (e: React.PointerEvent): void => {
    e.stopPropagation()
    const d = zoneDrag.current
    zoneDrag.current = null
    const g = zoneEl?.game
    if (d?.last && zoneEl && g) {
      const r = (n: number): number => Math.round(n * 10) / 10
      patchElement(zoneEl.id, { game: { ...g, params: { ...(g.params ?? {}), zoneX: r(d.last.x), zoneY: r(d.last.y), zoneW: r(d.last.w), zoneH: r(d.last.h) } } })
    }
  }

  const menuItems = (): MenuItem[] => {
    const multi = selectedIds.length > 1
    const locked = single?.locked
    const otherScenes = project.scenes.filter((s) => s.id !== activeSceneId)
    return [
      { label: 'Copy', onClick: copySelected, disabled: !selectedIds.length },
      { label: 'Paste', onClick: pasteElements, disabled: !hasElementClip() },
      { label: 'Duplicate', onClick: duplicateSelected, disabled: !selectedIds.length },
      { label: 'Delete', onClick: removeSelected, disabled: !selectedIds.length },
      { sep: true, label: '' },
      ...(selectedIds.length && otherScenes.length
        ? [
            { label: `Move to scene  (${selectedIds.length})`, disabled: true } as MenuItem,
            ...otherScenes.map((s) => ({ label: `   → ${s.name}`, onClick: () => moveSelectedToScene(s.id) }) as MenuItem),
            { sep: true, label: '' } as MenuItem,
          ]
        : []),
      { label: 'Copy style', onClick: copyStyle, disabled: !single },
      { label: 'Paste style', onClick: pasteStyle, disabled: !hasStyleClip() || !selectedIds.length },
      { sep: true, label: '' },
      { label: 'Bring to front', onClick: () => selectedIds.forEach(bringToFront), disabled: !selectedIds.length },
      { label: 'Send to back', onClick: () => selectedIds.forEach(sendToBack), disabled: !selectedIds.length },
      { sep: true, label: '' },
      ...(multi ? [{ label: 'Group', onClick: groupSelected } as MenuItem] : []),
      { label: 'Ungroup', onClick: ungroupSelected, disabled: !scene.elements.some((e) => selectedIds.includes(e.id) && e.groupId) },
      { label: locked ? 'Unlock' : 'Lock', onClick: () => single && toggleLock(single.id), disabled: !single },
    ]
  }

  return (
    <div
      className={'canvas-area' + (panning ? ' panning' : '')}
      ref={areaRef}
      onPointerDown={onAreaPointerDown}
      onPointerMove={onAreaPointerMove}
      onPointerUp={onAreaPointerUp}
      onPointerCancel={onAreaPointerUp}
    >
      <div
        className="canvas-grid"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--grid) 1.1px, transparent 1.2px)',
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />
      <div className="world" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
        {visibleScenes.map((sd) => {
          const pos = positions[sd.id] ?? { x: 0, y: 0 }
          const active = sd.id === activeSceneId
          return (
            <div key={sd.id} className={'frame' + (active ? ' active' : '') + (dropTarget === sd.id ? ' drop-target' : '')} style={{ left: pos.x, top: pos.y, width: box.w, height: box.h }}>
              <div
                className="frame-label"
                onPointerDown={(e) => onFrameLabelDown(e, sd.id)}
                onPointerMove={onFrameLabelMove}
                onPointerUp={onFrameLabelUp}
                onPointerCancel={onFrameLabelUp}
              >
                {sd.name}
              </div>
              <div className="stage-wrap">
                <CanvasFrame sceneId={sd.id} def={sd} meta={project.meta} assets={assets} renderKey={renderKey} locale={editLocale} onLayout={handleLayout} iframeRef={active ? (el) => { activeIframeRef.current = el } : undefined} />
                {active && traceSrc && <img className="trace-backdrop" src={traceSrc} alt="" style={{ opacity: trace.opacity }} />}
              </div>
              {active ? (
                <div
                  className="canvas-overlay"
                  ref={overlayRef}
                  style={{ cursor: pathDraw ? 'crosshair' : spaceRef.current ? 'grab' : 'default' }}
                  onPointerDown={onOverlayPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endInteraction}
                  onPointerCancel={endInteraction}
                  onDoubleClick={onDoubleClick}
                  onContextMenu={onContextMenu}
                >
                  {!revealEdit && !zoneEdit &&
                    selectedIds.map((id) => {
                      const r = rects.find((x) => x.id === id)
                      return r ? <div key={id} className="sel-box" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} /> : null
                    })}
                  {/* Scratch / reveal markers (editor-only; the coating runs in Preview/export). */}
                  {rects.map((r) => {
                    const e = sd.elements.find((x) => x.id === r.id)
                    if (!e || (!e.scratch && !e.reveal)) return null
                    return (
                      <div
                        key={'sr-' + r.id}
                        className={'scratch-mark-wrap' + (e.scratch ? ' is-cover' : '') + (e.reveal ? ' is-reveal' : '')}
                        style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                      >
                        {e.scratch && <span className="scratch-mark cover">scratch</span>}
                        {e.reveal && <span className="scratch-mark reveal">$ reveal</span>}
                      </div>
                    )
                  })}
                  {!revealEdit && !zoneEdit && single && singleRect && singleHandles.map((h) => (
                    <div
                      key={h.k}
                      className={'handle h-' + h.k}
                      style={{ left: singleRect.x + ((h.hx + 1) / 2) * singleRect.w, top: singleRect.y + ((h.hy + 1) / 2) * singleRect.h }}
                      onPointerDown={(e) => onHandlePointerDown(e, h, 'single')}
                    />
                  ))}
                  {!revealEdit && !zoneEdit && single && singleRect && (
                    <div
                      className="dim-badge"
                      style={{ left: singleRect.x + singleRect.w / 2, top: singleRect.y + singleRect.h, transform: `translate(-50%, 6px) scale(${1 / zoom})` }}
                    >
                      {Math.round(singleRect.w / metricsRef.current.s)} × {Math.round(singleRect.h / metricsRef.current.s)}
                    </div>
                  )}
                  {groupBbox && (
                    <>
                      <div className="sel-box group" style={{ left: groupBbox.x, top: groupBbox.y, width: groupBbox.w, height: groupBbox.h }} />
                      {CORNERS.map((h) => (
                        <div
                          key={h.k}
                          className={'handle h-' + h.k}
                          style={{ left: groupBbox.x + ((h.hx + 1) / 2) * groupBbox.w, top: groupBbox.y + ((h.hy + 1) / 2) * groupBbox.h }}
                          onPointerDown={(e) => onHandlePointerDown(e, h, 'group')}
                        />
                      ))}
                      <div
                        className="dim-badge"
                        style={{ left: groupBbox.x + groupBbox.w / 2, top: groupBbox.y + groupBbox.h, transform: `translate(-50%, 6px) scale(${1 / zoom})` }}
                      >
                        {Math.round(groupBbox.w / metricsRef.current.s)} × {Math.round(groupBbox.h / metricsRef.current.s)}
                      </div>
                    </>
                  )}
                  {guides.x.map((gx, i) => (
                    <div key={'gx' + i} className="guide v" style={{ left: gx }} />
                  ))}
                  {guides.y.map((gy, i) => (
                    <div key={'gy' + i} className="guide h" style={{ top: gy }} />
                  ))}
                  {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
                  {(() => {
                    const drawing = !!pathDraw && pathPoints.length > 0
                    const pts = drawing ? (pathCursor ? [...pathPoints, pathCursor] : pathPoints) : hgPath
                    if (!pts || pts.length < (drawing ? 1 : 2)) return null
                    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
                    return (
                      <svg className="hg-path" width={box.w} height={box.h}>
                        <defs>
                          <marker id="hgArrow" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto">
                            <path d="M0 0L9 4.5L0 9z" fill="var(--accent)" />
                          </marker>
                        </defs>
                        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray={drawing ? undefined : '7 5'} markerEnd="url(#hgArrow)" />
                        {pts.map((p, i) =>
                          i === 0 ? (
                            <circle key={i} cx={p.x} cy={p.y} r={5} fill="var(--accent)" />
                          ) : (
                            <g key={i}>
                              <circle cx={p.x} cy={p.y} r={8} fill="var(--panel)" stroke="var(--accent)" strokeWidth={2} />
                              <text x={p.x} y={p.y} dy="0.35em" textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--accent)" style={{ pointerEvents: 'none' }}>
                                {i}
                              </text>
                            </g>
                          ),
                        )}
                      </svg>
                    )
                  })()}
                  {editEl && editRect && editEl.text && (
                    <textarea
                      className="inline-edit"
                      autoFocus
                      defaultValue={editEl.text.value}
                      style={{
                        left: editRect.x,
                        top: editRect.y,
                        width: Math.max(40, editRect.w),
                        height: Math.max(24, editRect.h),
                        fontSize: editEl.text.fontSizePx * metricsRef.current.s,
                        color: editEl.text.color ?? '#fff',
                        textAlign: editEl.text.align ?? 'center',
                      }}
                      onChange={(e) => patchElement(editEl.id, { text: { ...editEl.text!, value: e.target.value } })}
                      onBlur={() => setEditing(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
                          e.preventDefault()
                          setEditing(null)
                        }
                      }}
                    />
                  )}
                  {revealEdit && revealRect && revealSrc && (
                    <div className="reveal-edit" style={{ left: revealRect.x, top: revealRect.y, width: revealRect.w, height: revealRect.h }}>
                      <div
                        className="reveal-edit-clip"
                        onPointerDown={onRevealBodyDown}
                        onPointerMove={onRevealMove}
                        onPointerUp={onRevealUp}
                        onPointerCancel={onRevealUp}
                      >
                        <img
                          src={revealSrc}
                          alt=""
                          draggable={false}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            transformOrigin: 'center',
                            transform: `translate(${curReveal.x}%, ${curReveal.y}%) scale(${curReveal.scale})`,
                          }}
                        />
                      </div>
                      {CORNERS.map((h) => (
                        <div
                          key={h.k}
                          className={'handle h-' + h.k}
                          style={{ left: ((h.hx + 1) / 2) * revealRect.w, top: ((h.hy + 1) / 2) * revealRect.h }}
                          onPointerDown={onRevealHandleDown}
                          onPointerMove={onRevealMove}
                          onPointerUp={onRevealUp}
                          onPointerCancel={onRevealUp}
                        />
                      ))}
                    </div>
                  )}
                  {zoneEdit && zoneBase && (
                    <>
                      {/* Read-only preview of the shared zone in every OTHER grid cell. */}
                      {zoneBaseRects.slice(1).map((b, i) => {
                        const bx = zoneBoxFor(b, curZone)
                        return (
                          <div
                            key={'zprev-' + i}
                            style={{ position: 'absolute', left: bx.x, top: bx.y, width: bx.w, height: bx.h, border: '1.5px dashed var(--accent)', opacity: 0.45, pointerEvents: 'none', boxSizing: 'border-box' }}
                          />
                        )
                      })}
                      {/* The editable zone box (whole card, or the top-left cell for a grid). */}
                      {(() => {
                        const bx = zoneBoxFor(zoneBase, curZone)
                        return (
                          <div
                            style={{ position: 'absolute', left: bx.x, top: bx.y, width: bx.w, height: bx.h, border: '2px solid var(--accent)', background: 'rgba(80,140,255,0.12)', boxSizing: 'border-box', cursor: 'move', touchAction: 'none' }}
                            onPointerDown={onZoneBodyDown}
                            onPointerMove={onZoneMove}
                            onPointerUp={onZoneUp}
                            onPointerCancel={onZoneUp}
                          >
                            {CORNERS.map((h) => (
                              <div
                                key={h.k}
                                className={'handle h-' + h.k}
                                style={{ left: ((h.hx + 1) / 2) * bx.w, top: ((h.hy + 1) / 2) * bx.h }}
                                onPointerDown={(e) => onZoneHandleDown(e, h.hx, h.hy)}
                                onPointerMove={onZoneMove}
                                onPointerUp={onZoneUp}
                                onPointerCancel={onZoneUp}
                              />
                            ))}
                          </div>
                        )
                      })()}
                    </>
                  )}
                </div>
              ) : (
                <div className="frame-activate" onPointerDown={(e) => activateFrame(e, sd.id)} />
              )}
            </div>
          )
        })}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
    </div>
  )
}
