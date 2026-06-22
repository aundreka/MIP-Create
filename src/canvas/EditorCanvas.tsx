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
import { isSceneHidden, useCanvasView } from '../canvasView'
import { endPathDraw, pathDrawTarget, usePathDraw } from '../drawMode'
import { useEditLocale } from '../locale'
import {
  beginTransaction,
  bulkPatch,
  copyStyle,
  duplicateSelected,
  endTransaction,
  getState,
  groupSelected,
  hasStyleClip,
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
}): JSX.Element {
  const { sceneId, def, meta, assets, renderKey, locale, onLayout } = props
  const ref = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const post = useCallback(() => {
    const scene: Scene = { meta: { ...meta, bgMatchColor: def.bgColor ?? meta.bgMatchColor }, elements: def.elements }
    ref.current?.contentWindow?.postMessage({ type: 'pa:render', scene, assets, interactive: false, locale }, '*')
  }, [def, meta, assets, locale])
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
  return <iframe ref={ref} className="canvas-frame" src="./runtime-frame.html" title={sceneId} onLoad={post} />
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
  | { mode: 'resize'; id: string; h: Handle; start: { px: number; py: number }; kind: 'wh' | 'scale' | 'font'; sw: number; sh: number; sScale: number; sFont: number; nativeW: number }
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

  const [box, setBox] = useState({ w: 506, h: 900 })
  const [renderKey, setRenderKey] = useState(0)
  const [rectsByScene, setRectsByScene] = useState<Record<string, FrameRect[]>>({})
  const metricsByScene = useRef<Record<string, FrameMetrics>>({})
  const metricsRef = useRef<FrameMetrics>({ s: 1, offX: 0, offY: 0, vw: 1, vh: 1 })
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
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

  // active scene's metrics drive the overlay math
  useEffect(() => {
    metricsRef.current = metricsByScene.current[activeSceneId] ?? metricsRef.current
  }, [activeSceneId, rectsByScene])

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
    beginTransaction()
    drag.current = { mode: 'resize', id, h, start: { px, py }, kind, sw, sh, sScale, sFont, nativeW }
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
    } else if (d.mode === 'resize') {
      const dd = designDelta(px - d.start.px, py - d.start.py)
      if (d.kind === 'wh') {
        const nw = d.h.hx !== 0 ? Math.max(8, Math.round(d.sw + d.h.hx * dd.dx * 2)) : Math.round(d.sw)
        const nh = d.h.hy !== 0 ? Math.max(8, Math.round(d.sh + d.h.hy * dd.dy * 2)) : Math.round(d.sh)
        patchGeometry(d.id, { w: nw, h: nh })
      } else if (d.kind === 'font') {
        const ratio = Math.max(0.2, (d.sw + d.h.hx * dd.dx * 2) / Math.max(1, d.sw))
        const el = liveRef.current.scene.elements.find((x) => x.id === d.id)
        if (el?.text) patchElement(d.id, { text: { ...el.text, fontSizePx: Math.max(8, Math.round(d.sFont * ratio)) } })
      } else {
        const ns = Math.max(0.05, +(d.sScale + (d.h.hx * dd.dx * 2) / Math.max(1, d.nativeW)).toFixed(3))
        patchGeometry(d.id, { scale: ns })
      }
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

  const endInteraction = (): void => {
    const d = drag.current
    if (!d) return
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
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    if (pathDrawTarget()) {
      commitPath()
      return
    }
    const { px, py } = toIntrinsic(e.clientX, e.clientY)
    const hit = hitTest(px, py)
    if (hit && hit.type === 'text') setEditing(hit.id)
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
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') return (e.preventDefault(), e.shiftKey ? redo() : undo())
      if (mod && e.key.toLowerCase() === 'd') return (e.preventDefault(), duplicateSelected())
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

  const menuItems = (): MenuItem[] => {
    const multi = selectedIds.length > 1
    const locked = single?.locked
    return [
      { label: 'Duplicate', onClick: duplicateSelected, disabled: !selectedIds.length },
      { label: 'Delete', onClick: removeSelected, disabled: !selectedIds.length },
      { sep: true, label: '' },
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
            <div key={sd.id} className={'frame' + (active ? ' active' : '')} style={{ left: pos.x, top: pos.y, width: box.w, height: box.h }}>
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
                <CanvasFrame sceneId={sd.id} def={sd} meta={project.meta} assets={assets} renderKey={renderKey} locale={editLocale} onLayout={handleLayout} />
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
                  {selectedIds.map((id) => {
                    const r = rects.find((x) => x.id === id)
                    return r ? <div key={id} className="sel-box" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} /> : null
                  })}
                  {single && singleRect && singleHandles.map((h) => (
                    <div
                      key={h.k}
                      className={'handle h-' + h.k}
                      style={{ left: singleRect.x + ((h.hx + 1) / 2) * singleRect.w, top: singleRect.y + ((h.hy + 1) / 2) * singleRect.h }}
                      onPointerDown={(e) => onHandlePointerDown(e, h, 'single')}
                    />
                  ))}
                  {single && singleRect && (
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
