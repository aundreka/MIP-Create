// Editing surface — a Figma-style multi-frame canvas. Every scene renders as a
// frame (its own <iframe>) on a pan/zoom "world"; frames can be dragged around to
// compare scenes side by side. The ACTIVE frame carries the editing overlay
// (selection/handles/guides/marquee/inline-edit); clicking another frame activates
// it. Per-frame coordinate math is unchanged from the single-frame editor.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FrameMetrics, FrameRect, FrameToParent, ParentToFrame } from '../../runtime/frame-protocol'
import type { Anchor, ProjectMeta, Scene, SceneDef, SceneElement } from '../../runtime/scene'
import type { AssetMap } from '../../runtime/types'
import { ContextMenu, type MenuItem } from '../panels/ContextMenu'
import { getFramePos, setFramePos } from '../canvasLayout'
import { flipbookBoxes, flipbookOpts, resizeBox, type Box } from './geometry'
import { isSceneHidden, useCanvasView } from '../canvasView'
import { useActiveVariant } from '../variantMode'
import { endPathDraw, pathDrawTarget, usePathDraw } from '../drawMode'
import { useEditLocale } from '../locale'
import { localizeElement, localizeSceneDef } from '../../runtime/i18n'
import { setSceneMediaMs, useTimeline } from '../timeline'
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
  seedLandscapeLayout,
  selectOnly,
  selectWithGroups,
  sendToBack,
  bringToFront,
  setActiveScene,
  setOrientation,
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

// How many elements in a scene carry their own landscape geometry (any override field).
const landscapeCount = (sd: SceneDef): number => sd.elements.filter((e) => e.landscape && Object.keys(e.landscape).length > 0).length

function effGeom(el: SceneElement, landscape: boolean, locale?: string | null) {
  const localized = localizeElement(el, locale)
  const ov = landscape ? localized.landscape : undefined
  return {
    x: ov?.x ?? localized.x,
    y: ov?.y ?? localized.y,
    scale: ov?.scale ?? localized.scale ?? 1,
    w: ov?.w ?? localized.w,
    h: ov?.h ?? localized.h,
    anchor: ov?.anchor ?? localized.anchor,
  }
}
// Anchor point as a fraction of the box (x, y); mirrors the runtime ANCHOR map.
const ANCHOR_FRAC: Record<Anchor, [number, number]> = {
  center: [0.5, 0.5],
  top: [0.5, 0],
  bottom: [0.5, 1],
  left: [0, 0.5],
  right: [1, 0.5],
  'top-left': [0, 0],
  'top-right': [1, 0],
  'bottom-left': [0, 1],
  'bottom-right': [1, 1],
}

// Live crop-editor state: the image window (box, DESIGN px, top-left origin) plus the
// source image's placement behind it (scale = imgWidth/boxWidth; cx/cy = image top-left
// as a fraction of the box). natR = image natural height ÷ width.
type CropView = { left: number; top: number; w: number; h: number; scale: number; cx: number; cy: number; natR: number }
type ThoughtZone = { x: number; y: number; w: number; h: number }

// Keep the source image fully covering the window (no gaps) after any edit: the image
// must be at least as big as the box, and its offset kept within bounds. Canva-style.
function clampCrop(w: number, h: number, scale: number, cx: number, cy: number, natR: number): { scale: number; cx: number; cy: number } {
  const minScaleH = h > 0 && w > 0 && natR > 0 ? h / (w * natR) : 1
  const s = Math.max(scale, 1, minScaleH)
  const cxMin = 1 - s // image left may not move right past 0, nor left past (w - imgW)
  const imgHfrac = (s * w * natR) / (h || 1) // image height ÷ box height
  const cyMin = 1 - imgHfrac
  return { scale: s, cx: Math.min(0, Math.max(cxMin, cx)), cy: Math.min(0, Math.max(cyMin, cy)) }
}

function boxSizable(el: SceneElement): boolean {
  return el.type === 'cta' || el.type === 'bar' || (el.w != null && el.h != null) || (el.type === 'text' && (!!el.box?.bgColor || !!el.box?.borderPx || el.w != null))
}

// ---- one scene's iframe; reports its own layout (rects + metrics) -----------
function CanvasFrame(props: {
  sceneId: string
  def: SceneDef
  meta: ProjectMeta
  assets: AssetMap
  renderKey: number
  locale: string | null
  onLayout: (id: string, rects: FrameRect[], metrics: FrameMetrics, mediaMs?: number) => void
  iframeRef?: (el: HTMLIFrameElement | null) => void
}): JSX.Element {
  const { sceneId, def, meta, assets, renderKey, locale, onLayout, iframeRef } = props
  const displayDef = useMemo(() => localizeSceneDef(def, locale), [def, locale])
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
  const assetKey = useMemo(() => sceneAssetIds(displayDef, assets).sort().join('|'), [displayDef, assets])
  const frameAssets = useMemo(() => {
    const out: AssetMap = {}
    for (const id of assetKey ? assetKey.split('|') : []) if (assets[id]) out[id] = assets[id]
    return out
  }, [assetKey, assets])
  const post = useCallback(() => {
    const scene: Scene = {
      meta: { ...meta, bgMatchColor: displayDef.bgColor !== undefined ? displayDef.bgColor : meta.bgMatchColor },
      elements: displayDef.elements,
      kind: displayDef.kind,
      overlay: displayDef.overlay,
    }
    const changed = lastSentAssets.current !== frameAssets
    lastSentAssets.current = frameAssets
    ref.current?.contentWindow?.postMessage({ type: 'pa:render', scene, assets: changed ? frameAssets : undefined, interactive: false, locale }, '*')
  }, [displayDef, meta, frameAssets, locale])
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
        onLayout(sceneId, d.rects, d.metrics, d.mediaMs)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [post, sceneId, onLayout])
  return (
    <iframe
      ref={(el) => {
        ;(ref as React.MutableRefObject<HTMLIFrameElement | null>).current = el
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
  | {
      mode: 'resize'
      id: string
      h: Handle
      start: { px: number; py: number }
      kind: 'wh' | 'scale' | 'font'
      sw: number
      sh: number
      sScale: number
      sFont: number
      nativeW: number
      sx: number
      sy: number
      anchor: SceneElement['anchor']
      cx: number
      cy: number
      sDist: number
    }
  | {
      mode: 'group-scale'
      start: { px: number; py: number }
      cx: number
      cy: number
      sDist: number
      members: { id: string; x: number; y: number; w?: number; h?: number; scale?: number; font?: number; isText?: boolean }[]
    }
  | { mode: 'marquee'; start: { px: number; py: number } }
  | { mode: 'pan'; start: { x: number; y: number }; pan0: { x: number; y: number } }
  | null

export function EditorCanvas(props: Props): JSX.Element {
  const { zoom, pan, setZoom, setPan, fitSignal } = props
  const { project, scene, assets, selectedIds, orientation, trace, activeSceneId } = useEditorState()
  useCanvasView() // re-render when canvas scene visibility changes
  const editLocale = useEditLocale()
  const activeVariant = useActiveVariant() // landscape seeding is base-only — banner hides in variant mode
  const landscape = orientation === 'landscape'
  // Scenes whose "landscape mirrors portrait" banner the user closed (session-only).
  const [lsBannerClosed, setLsBannerClosed] = useState<Record<string, boolean>>({})
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
  // Figma-style spacing measurements shown while dragging: the pixel gap from the moving
  // element to its nearest neighbour (or the canvas edge) on each side. Overlay coords.
  const [measures, setMeasures] = useState<{ x1: number; y1: number; x2: number; y2: number; label: string; horiz: boolean }[]>([])
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
  const revealDrag = useRef<{
    mode: 'move' | 'scale'
    sx: number
    sy: number
    startX: number
    startY: number
    startScale: number
    rectW: number
    rectH: number
    ccx: number
    ccy: number
    startDist: number
    last: { scale: number; x: number; y: number } | null
  } | null>(null)
  const curRevealRef = useRef<{ scale: number; x: number; y: number }>({ scale: 1, x: 0, y: 0 })
  // Reveal-zone editor (scratch / scratch grid): which game-mount's zone is being drawn,
  // the live rect during a drag (percent of the card / cell), and the in-flight gesture.
  const [zoneEdit, setZoneEdit] = useState<string | null>(null)
  const [zoneLive, setZoneLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const zoneDrag = useRef<{
    mode: 'move' | 'resize'
    hx: number
    hy: number
    ox: number
    oy: number
    base: { x: number; y: number; w: number; h: number }
    start: { x: number; y: number; w: number; h: number }
    last: { x: number; y: number; w: number; h: number } | null
  } | null>(null)
  const curZoneRef = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 100, h: 100 })
  // Thought-whacker spawn-zone editor: drag on empty game space to draw any
  // number of spawn rectangles; existing rectangles stay movable/resizable.
  const [thoughtZoneEdit, setThoughtZoneEdit] = useState<string | null>(null)
  const [thoughtZonesLive, setThoughtZonesLive] = useState<ThoughtZone[] | null>(null)
  const [thoughtSubjectLive, setThoughtSubjectLive] = useState<{ x: number; y: number } | null>(null)
  const thoughtSubjectDrag = useRef<{ last: { x: number; y: number } | null } | null>(null)
  const thoughtZoneDrag = useRef<{
    mode: 'draw' | 'move' | 'resize'
    idx: number
    hx: number
    hy: number
    sx: number
    sy: number
    base: ThoughtZone[]
    last: ThoughtZone[] | null
  } | null>(null)
  // Memory-match tracker symbol editor: double-click the game → per-symbol boxes to
  // drag (X nudge) / resize (uniform scale, bottoms stay on the shared baseline).
  const [trackerEdit, setTrackerEdit] = useState<string | null>(null)
  const [trackerLive, setTrackerLive] = useState<{ scales: number[]; dxs: number[] } | null>(null)
  const trackerDrag = useRef<{
    mode: 'move' | 'resize'
    idx: number
    ox: number
    oy: number
    s: number
    symSz: number
    bottomY: number
    start: { scales: number[]; dxs: number[] }
    last: { scales: number[]; dxs: number[] } | null
  } | null>(null)
  const curTrackerRef = useRef<{ scales: number[]; dxs: number[] }>({ scales: [], dxs: [] })
  // Scratch-grid dynamic-date position editor: which game-mount's date marker is being
  // dragged, and the live position (percent of the cell — shared by every cell).
  const [dateEdit, setDateEdit] = useState<string | null>(null)
  const [dateLive, setDateLive] = useState<{ x: number; y: number } | null>(null)
  const dateDrag = useRef<{ base: { x: number; y: number; w: number; h: number }; last: { x: number; y: number } | null } | null>(null)
  const curDateRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 })
  // Flipbook book editor: double-click the book → drag the fold line onto the spine
  // drawn in the artwork, and drag the shut cover's corners to size it.
  const [spineEdit, setSpineEdit] = useState<string | null>(null)
  const [spineLive, setSpineLive] = useState<{ coverScale: number; bookScale: number } | null>(null)
  const spineDrag = useRef<{ mode: 'cover' | 'book'; base: { x: number; w: number; cx: number; cy: number; dist: number }; start: number; last: number | null } | null>(null)
  // Canva-style image crop: which image is being cropped, its live geometry, and the
  // in-flight gesture (resize a window edge, pan the picture, or none).
  const [cropEdit, setCropEdit] = useState<string | null>(null)
  const [cropView, setCropView] = useState<CropView | null>(null)
  const cropViewRef = useRef<CropView | null>(null)
  cropViewRef.current = cropView
  const cropEditRef = useRef<string | null>(null)
  cropEditRef.current = cropEdit
  const cropDrag = useRef<
    | { mode: 'resize'; hx: -1 | 0 | 1; hy: -1 | 0 | 1; sx: number; sy: number; base: CropView; imgL: number; imgT: number; imgW: number }
    | { mode: 'pan'; sx: number; sy: number; base: CropView }
    | null
  >(null)
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

  const liveRef = useRef({ scene, selectedIds, landscape, rects, zoom, pan, activeSceneId, editLocale })
  liveRef.current = { scene, selectedIds, landscape, rects, zoom, pan, activeSceneId, editLocale }

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

  // Timeline playhead → active scene iframe. While playback is RUNNING the runtime
  // drives itself off its own timers, so only the transport changes (open / play /
  // pause / a scrub) are posted — not the 60fps playhead position, which stays local
  // to the timeline panel. Re-posted when the active scene changes so a freshly
  // mounted frame lands on the same instant as the one it replaced.
  const timeline = useTimeline()
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline
  // Only the SETTLED position is a dependency: while playing it is pinned to 0 so the
  // effect doesn't re-fire, and the live position is read through the ref when it does.
  const seekKey = timeline.playing ? 0 : timeline.ms
  useEffect(() => {
    const iw = activeIframeRef.current?.contentWindow
    if (!iw) return
    const t = timelineRef.current
    const msg: ParentToFrame = t.open ? { type: 'pa:seek', ms: t.ms, playing: t.playing } : { type: 'pa:seek', ms: null }
    iw.postMessage(msg, '*')
  }, [timeline.open, timeline.playing, seekKey, activeSceneId, renderKey])

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
      setDateEdit(null)
      setDateLive(null)
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
  useEffect(() => {
    const onEnter = (e: Event): void => {
      const id = (e as CustomEvent<{ elementId: string }>).detail?.elementId
      if (!id) return
      setRevealEdit(null)
      setRevealLive(null)
      setZoneEdit(null)
      setZoneLive(null)
      setDateEdit(null)
      setDateLive(null)
      setTrackerEdit(null)
      setTrackerLive(null)
      setSpineEdit(null)
      setSpineLive(null)
      setThoughtZonesLive(null)
      setThoughtSubjectLive(null)
      setThoughtZoneEdit(id)
    }
    window.addEventListener('pa:thought-zone-edit', onEnter)
    return () => window.removeEventListener('pa:thought-zone-edit', onEnter)
  }, [])
  useEffect(() => {
    if (thoughtZoneEdit && !scene.elements.some((e) => e.id === thoughtZoneEdit)) {
      setThoughtZoneEdit(null)
      setThoughtZonesLive(null)
      setThoughtSubjectLive(null)
    }
  }, [thoughtZoneEdit, scene])
  useEffect(() => {
    if (!thoughtZoneEdit) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        thoughtZoneDrag.current = null
        setThoughtZoneEdit(null)
        setThoughtZonesLive(null)
        setThoughtSubjectLive(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [thoughtZoneEdit])
  useEffect(() => {
    if (trackerEdit && !scene.elements.some((e) => e.id === trackerEdit)) {
      setTrackerEdit(null)
      setTrackerLive(null)
    }
  }, [trackerEdit, scene])
  useEffect(() => {
    if (spineEdit && !scene.elements.some((e) => e.id === spineEdit)) {
      setSpineEdit(null)
      setSpineLive(null)
    }
  }, [spineEdit, scene])
  useEffect(() => {
    if (!spineEdit) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        spineDrag.current = null
        setSpineEdit(null)
        setSpineLive(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [spineEdit])
  useEffect(() => {
    if (!trackerEdit) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        trackerDrag.current = null
        setTrackerEdit(null)
        setTrackerLive(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [trackerEdit])

  // Dynamic-date position edit (scratch grid) is entered from the inspector too.
  useEffect(() => {
    const onEnter = (e: Event): void => {
      const id = (e as CustomEvent<{ elementId: string }>).detail?.elementId
      if (!id) return
      setRevealEdit(null)
      setRevealLive(null)
      setZoneEdit(null)
      setZoneLive(null)
      setDateLive(null)
      setDateEdit(id)
    }
    window.addEventListener('pa:date-edit', onEnter)
    return () => window.removeEventListener('pa:date-edit', onEnter)
  }, [])
  useEffect(() => {
    if (dateEdit && !scene.elements.some((e) => e.id === dateEdit)) {
      setDateEdit(null)
      setDateLive(null)
    }
  }, [dateEdit, scene])
  useEffect(() => {
    if (!dateEdit) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        dateDrag.current = null
        setDateEdit(null)
        setDateLive(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dateEdit])

  // ---- Canva-style image crop ----------------------------------------------
  // Enter crop mode for an image: ensure it has an explicit box (so it clips) + a
  // crop config, normalise its anchor to top-left (so the box maths is direct), then
  // seed the live geometry. Cropping never rescales the picture — dragging an edge
  // reveals/hides it; dragging the middle pans; scrolling zooms.
  const enterCrop = useCallback((rawId: string): void => {
    const st = getState()
    const el = st.scene.elements.find((x) => x.id === rawId)
    if (!el || el.type !== 'image' || !el.assetId || el.container) return
    const ls = st.orientation === 'landscape'
    const localized = localizeElement(el, editLocaleRef.current)
    const g = effGeom(el, ls, editLocaleRef.current)
    let w = g.w
    let h = g.h
    if (w == null || h == null) {
      const a = st.assets[localized.assetId ?? '']
      const sc = g.scale || 1
      w = Math.max(1, Math.round((a?.w ?? 300) * sc))
      h = Math.max(1, Math.round((a?.h ?? 300) * sc))
    }
    let x = g.x
    let y = g.y
    if (g.anchor !== 'top-left') {
      const [fx, fy] = ANCHOR_FRAC[g.anchor]
      x = Math.round(g.x - fx * w)
      y = Math.round(g.y - fy * h)
    }
    const a = st.assets[localized.assetId ?? '']
    const natR = a && a.w > 0 ? a.h / a.w : 1
    const cur = el.crop ?? {}
    const cl = clampCrop(w, h, cur.scale ?? 1, cur.x ?? 0, cur.y ?? 0, natR)
    beginTransaction()
    patchGeometry(rawId, { x, y, w, h, anchor: 'top-left' })
    patchElement(rawId, { crop: { scale: cl.scale, x: cl.cx, y: cl.cy } })
    endTransaction()
    setRevealEdit(null)
    setZoneEdit(null)
    setCropView({ left: x, top: y, w, h, scale: cl.scale, cx: cl.cx, cy: cl.cy, natR })
    setCropEdit(rawId)
    selectOnly(rawId)
  }, [])
  useEffect(() => {
    const onEnter = (e: Event): void => {
      const id = (e as CustomEvent<{ elementId: string }>).detail?.elementId
      if (id) enterCrop(id)
    }
    window.addEventListener('pa:crop-edit', onEnter)
    return () => window.removeEventListener('pa:crop-edit', onEnter)
  }, [enterCrop])
  const exitCrop = useCallback((): void => {
    cropDrag.current = null
    setCropEdit(null)
    setCropView(null)
  }, [])
  useEffect(() => {
    if (cropEdit && !scene.elements.some((e) => e.id === cropEdit)) exitCrop()
  }, [cropEdit, scene, exitCrop])
  useEffect(() => {
    if (!cropEdit) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') exitCrop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cropEdit, exitCrop])

  const handleLayout = useCallback((id: string, r: FrameRect[], m: FrameMetrics, mediaMs?: number): void => {
    metricsByScene.current[id] = m
    if (id === liveRef.current.activeSceneId) metricsRef.current = m
    setRectsByScene((prev) => ({ ...prev, [id]: r }))
    // Lets the timeline ruler grow to cover a video in this scene.
    if (mediaMs != null) setSceneMediaMs(id, mediaMs)
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
    for (const l of lX)
      for (const t of tX) {
        const d = t - l
        if (Math.abs(d) < Math.abs(aX)) {
          aX = d
          gX = t
        }
      }
    let aY = SNAP + 1
    let gY: number | null = null
    for (const l of lY)
      for (const t of tY) {
        const d = t - l
        if (Math.abs(d) < Math.abs(aY)) {
          aY = d
          gY = t
        }
      }
    const okX = Math.abs(aX) <= SNAP
    const okY = Math.abs(aY) <= SNAP
    setGuides({ x: okX && gX != null ? [gX] : [], y: okY && gY != null ? [gY] : [] })
    return { dx: dx + (okX ? aX : 0), dy: dy + (okY ? aY : 0) }
  }

  // Figma/Canva-style spacing readout: for a moving bbox (overlay px), measure the gap
  // to the nearest neighbouring element on each side (only counting elements that
  // overlap on the perpendicular axis) — or to the canvas edge when there is none — and
  // return connector segments + labels (design px) to draw. Also emits the bbox size.
  const computeMeasures = (bbox: { x: number; y: number; w: number; h: number }): void => {
    const m = metricsRef.current
    const s = m.s || 1
    const meta = liveRef.current.scene.meta
    const cL = m.offX
    const cR = m.offX + meta.baseW * s
    const cT = m.offY
    const cB = m.offY + meta.baseH * s
    const others = liveRef.current.rects.filter((r) => !liveRef.current.selectedIds.includes(r.id) && r.type !== 'dim')
    const bL = bbox.x
    const bR = bbox.x + bbox.w
    const bT = bbox.y
    const bB = bbox.y + bbox.h
    const cx = bbox.x + bbox.w / 2
    const cy = bbox.y + bbox.h / 2
    const out: { x1: number; y1: number; x2: number; y2: number; label: string; horiz: boolean }[] = []
    const px = (v: number): string => String(Math.round(v / s))
    const overlapY = others.filter((r) => r.y < bB && r.y + r.h > bT)
    const overlapX = others.filter((r) => r.x < bR && r.x + r.w > bL)
    // left
    const leftN = overlapY.filter((r) => r.x + r.w <= bL + 0.5).sort((a, b) => b.x + b.w - (a.x + a.w))[0]
    const leftEdge = leftN ? leftN.x + leftN.w : cL
    if (bL - leftEdge > 0.5) out.push({ x1: leftEdge, y1: cy, x2: bL, y2: cy, label: px(bL - leftEdge), horiz: true })
    // right
    const rightN = overlapY.filter((r) => r.x >= bR - 0.5).sort((a, b) => a.x - b.x)[0]
    const rightEdge = rightN ? rightN.x : cR
    if (rightEdge - bR > 0.5) out.push({ x1: bR, y1: cy, x2: rightEdge, y2: cy, label: px(rightEdge - bR), horiz: true })
    // top
    const topN = overlapX.filter((r) => r.y + r.h <= bT + 0.5).sort((a, b) => b.y + b.h - (a.y + a.h))[0]
    const topEdge = topN ? topN.y + topN.h : cT
    if (bT - topEdge > 0.5) out.push({ x1: cx, y1: topEdge, x2: cx, y2: bT, label: px(bT - topEdge), horiz: false })
    // bottom
    const botN = overlapX.filter((r) => r.y >= bB - 0.5).sort((a, b) => a.y - b.y)[0]
    const botEdge = botN ? botN.y : cB
    if (botEdge - bB > 0.5) out.push({ x1: cx, y1: bB, x2: cx, y2: botEdge, label: px(botEdge - bB), horiz: false })
    setMeasures(out)
  }

  // ---- interactions (active frame) ------------------------------------------
  const drag = useRef<Drag>(null)
  const spaceRef = useRef(false)

  const onOverlayPointerDown = (e: React.PointerEvent): void => {
    if (editing) return
    if (thoughtZoneEdit) {
      beginThoughtZoneDraw(e)
      return
    }
    if (cropEdit) {
      // Clicking outside the crop window (which stops its own events) commits & exits.
      exitCrop()
      return
    }
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
    if (dateEdit) {
      // Clicking outside a date marker (markers stop their own events) exits date-edit.
      setDateEdit(null)
      setDateLive(null)
      return
    }
    if (trackerEdit) {
      // Clicking outside a symbol box (boxes stop their own events) exits the editor.
      setTrackerEdit(null)
      setTrackerLive(null)
      return
    }
    if (spineEdit) {
      // Clicking off the fold line (which stops its own events) exits spine-edit.
      setSpineEdit(null)
      setSpineLive(null)
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
        if (el) base[id] = { x: effGeom(el, liveRef.current.landscape, liveRef.current.editLocale).x, y: effGeom(el, liveRef.current.landscape, liveRef.current.editLocale).y }
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
          const ge = effGeom(el as SceneElement, liveRef.current.landscape, liveRef.current.editLocale)
          // scale: the EFFECTIVE value (landscape override included) so scaling in
          // landscape multiplies the landscape size, not the portrait one.
          const baseScale = ge.scale
          return {
            id: (el as SceneElement).id,
            x: ge.x,
            y: ge.y,
            w: ge.w,
            h: ge.h,
            scale: baseScale,
            font: (el as SceneElement).text?.fontSizePx,
            isText: (el as SceneElement).type === 'text',
          }
        })
      beginTransaction()
      drag.current = { mode: 'group-scale', start: { px, py }, cx, cy, sDist: Math.hypot(px - cxI, py - cyI) || 1, members }
      return
    }
    const id = liveRef.current.selectedIds[0]
    const el = liveRef.current.scene.elements.find((x) => x.id === id)
    const rect = liveRef.current.rects.find((r) => r.id === id)
    if (!el || !rect) return
    const localized = localizeElement(el, liveRef.current.editLocale)
    const g = effGeom(el, liveRef.current.landscape, liveRef.current.editLocale)
    let kind: 'wh' | 'scale' | 'font' = 'scale'
    let sw = rect.w / s
    let sh = rect.h / s
    let sScale = g.scale
    let sFont = el.text?.fontSizePx ?? 48
    const nativeW = (assets[localized.assetId ?? ''] ?? { w: 100 }).w
    if (boxSizable(localized)) {
      kind = 'wh'
      sw = g.w ?? sw
      sh = g.h ?? sh
      if (g.w == null || g.h == null) patchGeometry(id, { w: Math.round(sw), h: Math.round(sh) })
    } else if (el.type === 'text') {
      // fontSizePx is SHARED config (both orientations) — resizing text in landscape
      // must go through the landscape `scale` override instead, or portrait moves too.
      kind = liveRef.current.landscape || !!liveRef.current.editLocale ? 'scale' : 'font'
    } else {
      kind = 'scale'
      sScale = g.scale
    }
    const cx = rect.x + rect.w / 2 // intrinsic center → distance-based scale/font
    const cy = rect.y + rect.h / 2
    beginTransaction()
    drag.current = {
      mode: 'resize',
      id,
      h,
      start: { px, py },
      kind,
      sw,
      sh,
      sScale,
      sFont,
      nativeW,
      sx: g.x,
      sy: g.y,
      anchor: g.anchor,
      cx,
      cy,
      sDist: Math.hypot(px - cx, py - cy) || 1,
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (thoughtZoneDrag.current) {
      moveThoughtZone(e)
      return
    }
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
      if (liveRef.current.landscape || liveRef.current.editLocale) for (const id of Object.keys(patches)) patchGeometry(id, patches[id])
      else bulkPatch(patches)
      sendToActiveFrame()
      // Spacing readout to the nearest neighbours (or canvas edges) at the snapped pos.
      computeMeasures({ x: d.bbox.x + snapped.dx, y: d.bbox.y + snapped.dy, w: d.bbox.w, h: d.bbox.h })
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
      if (liveRef.current.landscape || liveRef.current.editLocale) {
        // Landscape group-scale writes ONLY landscape overrides — never the base
        // (portrait) fields. Text has no per-orientation font size, so its size is
        // driven by the landscape `scale` override instead (w/h skipped: the runtime
        // multiplies a text box by scale already, patching both would double-scale).
        for (const m of d.members) {
          const p: Partial<SceneElement> = { x: Math.round(d.cx + (m.x - d.cx) * f), y: Math.round(d.cy + (m.y - d.cy) * f) }
          if (m.isText) {
            p.scale = Math.max(0.05, +((m.scale ?? 1) * f).toFixed(3))
          } else {
            if (m.w != null) p.w = Math.max(8, Math.round(m.w * f))
            if (m.h != null) p.h = Math.max(8, Math.round(m.h * f))
            if (m.scale != null) p.scale = Math.max(0.05, +(m.scale * f).toFixed(3))
          }
          patchGeometry(m.id, p)
        }
      } else {
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
      }
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
    if (thoughtZoneDrag.current) {
      if (e) endThoughtZone(e)
      return
    }
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
          if (el) {
            const g = effGeom(el, liveRef.current.landscape, liveRef.current.editLocale)
            place[id] = { x: g.x + ddx, y: g.y + ddy }
          }
        }
        moveSelectedToScene(dropId, place)
      }
      endTransaction()
      drag.current = null
      setMarquee(null)
      setGuides({ x: [], y: [] })
      setMeasures([])
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
    setMeasures([])
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
    // Double-click a plain image → enter Canva-style crop mode.
    const el = liveRef.current.scene.elements.find((x) => x.id === hit.id)
    if (el && el.type === 'image' && el.assetId && !el.container) {
      enterCrop(el.id)
      return
    }
    // Double-click a memory match → edit its tracker symbols on the canvas.
    // Skipped when the tracker is off: there are no symbols to edit, and the
    // mode would trap the user in an overlay with nothing in it.
    if (el && el.type === 'game-mount' && el.game?.templateId === 'memorymatch' && el.game.params?.tracker !== 'off') {
      setTrackerLive(null)
      setTrackerEdit(hit.id)
      return
    }
    // Double-click a flipbook → drag its fold line onto the spine in the artwork.
    if (el && el.type === 'game-mount' && el.game?.templateId === 'flipbook') {
      setSpineLive(null)
      setSpineEdit(hit.id)
      return
    }
    // Double-click a scratch card that has a prize image → edit the reveal transform.
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
      // In crop mode, the wheel zooms the picture inside the window (about its centre).
      if (cropEditRef.current && cropViewRef.current) {
        const v = cropViewRef.current
        const raw = v.scale * (e.deltaY < 0 ? 1.05 : 1 / 1.05)
        const imgW = v.scale * v.w
        const imgH = imgW * v.natR
        const fx = imgW > 0 ? (v.w / 2 - v.cx * v.w) / imgW : 0.5
        const fy = imgH > 0 ? (v.h / 2 - v.cy * v.h) / imgH : 0.5
        const imgW2 = raw * v.w
        const imgH2 = imgW2 * v.natR
        const cl = clampCrop(v.w, v.h, raw, (v.w / 2 - fx * imgW2) / v.w, (v.h / 2 - fy * imgH2) / v.h, v.natR)
        const nv: CropView = { ...v, scale: cl.scale, cx: cl.cx, cy: cl.cy }
        setCropView(nv)
        cropViewRef.current = nv
        const idc = cropEditRef.current
        if (idc) {
          patchElement(idc, { crop: { scale: nv.scale, x: nv.cx, y: nv.cy } })
          sendToActiveFrame()
        }
        return
      }
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
          const g = effGeom(el, liveRef.current.landscape, liveRef.current.editLocale)
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
  const single = selectedIds.length === 1 ? (scene.elements.find((e) => e.id === selectedIds[0]) ?? null) : null
  const singleRect = single ? (rects.find((r) => r.id === single.id) ?? null) : null
  const singleHandles: Handle[] = single ? (boxSizable(localizeElement(single, editLocale)) ? [...CORNERS, ...EDGES] : CORNERS) : []
  // Handguide slide path (design coords -> intrinsic) for the selected handguide:
  // a polyline from the hand's center through each waypoint.
  const hgPath = (() => {
    if (!single || single.type !== 'handguide' || single.handguide?.mode !== 'slide' || !singleRect) return null
    const hg = single.handguide
    const m = metricsRef.current
    const wp = hg.nodes && hg.nodes.length ? hg.nodes : hg.toX != null && hg.toY != null ? [{ x: hg.toX, y: hg.toY }] : []
    if (!wp.length) return null
    return [{ x: singleRect.x + singleRect.w / 2, y: singleRect.y + singleRect.h / 2 }, ...wp.map((n) => ({ x: n.x * m.s + m.offX, y: n.y * m.s + m.offY }))]
  })()
  const groupBbox = selectedIds.length > 1 ? bboxOf(selectedIds) : null
  const editEl = editing ? (scene.elements.find((e) => e.id === editing) ?? null) : null
  const editRect = editing ? (rects.find((r) => r.id === editing) ?? null) : null

  const revealEl = revealEdit ? (scene.elements.find((e) => e.id === revealEdit) ?? null) : null
  const revealRect = revealEdit ? (rects.find((r) => r.id === revealEdit) ?? null) : null
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
    revealDrag.current = {
      mode: 'move',
      sx: e.clientX,
      sy: e.clientY,
      startX: cur.x,
      startY: cur.y,
      startScale: cur.scale,
      rectW: revealRect.w,
      rectH: revealRect.h,
      ccx: 0,
      ccy: 0,
      startDist: 1,
      last: null,
    }
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
    revealDrag.current = {
      mode: 'scale',
      sx: e.clientX,
      sy: e.clientY,
      startX: cur.x,
      startY: cur.y,
      startScale: cur.scale,
      rectW: revealRect.w,
      rectH: revealRect.h,
      ccx,
      ccy,
      startDist: Math.hypot(e.clientX - ccx, e.clientY - ccy) || 1,
      last: null,
    }
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

  // ---- Canva-style image crop editor ----------------------------------------
  const cropEl = cropEdit ? (scene.elements.find((e) => e.id === cropEdit) ?? null) : null
  const localizedCropEl = cropEl ? localizeElement(cropEl, editLocale) : null
  const cropSrc = localizedCropEl?.assetId ? assets[localizedCropEl.assetId]?.src : undefined
  const writeCrop = (v: CropView, box: boolean): void => {
    setCropView(v)
    cropViewRef.current = v
    const idc = cropEditRef.current
    if (!idc) return
    if (box) patchGeometry(idc, { x: Math.round(v.left), y: Math.round(v.top), w: Math.round(v.w), h: Math.round(v.h) })
    patchElement(idc, { crop: { scale: v.scale, x: v.cx, y: v.cy } })
    sendToActiveFrame()
  }
  const onCropBodyDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    const v = cropViewRef.current
    if (!v) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const p = toIntrinsic(e.clientX, e.clientY)
    cropDrag.current = { mode: 'pan', sx: p.px, sy: p.py, base: { ...v } }
  }
  const onCropHandleDown = (e: React.PointerEvent, hnd: Handle): void => {
    e.stopPropagation()
    const v = cropViewRef.current
    if (!v) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const p = toIntrinsic(e.clientX, e.clientY)
    cropDrag.current = { mode: 'resize', hx: hnd.hx, hy: hnd.hy, sx: p.px, sy: p.py, base: { ...v }, imgL: v.left + v.cx * v.w, imgT: v.top + v.cy * v.h, imgW: v.scale * v.w }
  }
  const onCropMove = (e: React.PointerEvent): void => {
    const d = cropDrag.current
    if (!d) return
    e.stopPropagation()
    const p = toIntrinsic(e.clientX, e.clientY)
    const dd = designDelta(p.px - d.sx, p.py - d.sy)
    const b = d.base
    if (d.mode === 'pan') {
      // Drag the picture behind the window (clamped so it always covers the window).
      const cl = clampCrop(b.w, b.h, b.scale, b.cx + dd.dx / b.w, b.cy + dd.dy / b.h, b.natR)
      writeCrop({ ...b, scale: cl.scale, cx: cl.cx, cy: cl.cy }, false)
      return
    }
    // Resize: move only the grabbed edge(s); the picture stays fixed on screen (its
    // design-px rect was captured at drag start), so the window reveals/hides it.
    let left = b.left
    let top = b.top
    let w = b.w
    let h = b.h
    if (d.hx === -1) {
      left = b.left + dd.dx
      w = b.w - dd.dx
    } else if (d.hx === 1) {
      w = b.w + dd.dx
    }
    if (d.hy === -1) {
      top = b.top + dd.dy
      h = b.h - dd.dy
    } else if (d.hy === 1) {
      h = b.h + dd.dy
    }
    const MIN = 20
    if (w < MIN) {
      if (d.hx === -1) left = b.left + b.w - MIN
      w = MIN
    }
    if (h < MIN) {
      if (d.hy === -1) top = b.top + b.h - MIN
      h = MIN
    }
    const scale = d.imgW / w
    const cl = clampCrop(w, h, scale, (d.imgL - left) / w, (d.imgT - top) / h, b.natR)
    writeCrop({ left, top, w, h, scale: cl.scale, cx: cl.cx, cy: cl.cy, natR: b.natR }, true)
  }
  const onCropUp = (e: React.PointerEvent): void => {
    e.stopPropagation()
    cropDrag.current = null
  }

  // ---- reveal-zone editor ---------------------------------------------------
  const zoneEl = zoneEdit ? (scene.elements.find((e) => e.id === zoneEdit) ?? null) : null
  const zoneRect = zoneEdit ? (rects.find((r) => r.id === zoneEdit) ?? null) : null
  const zoneParams: Record<string, unknown> = zoneEl?.game?.params ?? {}
  const basketZone = zoneEl?.game?.templateId === 'basket'
  const curZone = zoneLive ?? {
    x: typeof zoneParams.zoneX === 'number' ? zoneParams.zoneX : basketZone ? 12 : 0,
    y: typeof zoneParams.zoneY === 'number' ? zoneParams.zoneY : basketZone ? 34 : 0,
    w: typeof zoneParams.zoneW === 'number' ? zoneParams.zoneW : basketZone ? 76 : 100,
    h: typeof zoneParams.zoneH === 'number' ? zoneParams.zoneH : basketZone ? 43 : 100,
  }
  curZoneRef.current = curZone
  // Cell rects (overlay space, pre-zoom — like `rects`) for a scratch_grid game-mount.
  // Mirrors the runtime's grid math (design-px padding/gaps scaled uniformly). Shared
  // by the reveal-zone editor and the dynamic-date position editor.
  const gridCellRects = (el: SceneElement, r: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number }[] => {
    const p = el.game?.params ?? {}
    const cols = Math.max(1, Math.min(4, Number(p.cols ?? 2)))
    const rows = Math.max(1, Math.min(4, Number(p.rows ?? 2)))
    const gap = Math.max(0, Number(p.gap ?? 10))
    const colGap = Math.max(0, Number(p.colGap ?? gap))
    const rowGap = Math.max(0, Number(p.rowGap ?? gap))
    const ew = el.w ?? 980
    const eh = el.h ?? 1100
    const sx = r.w / ew // design px → overlay px (uniform scale)
    const sy = r.h / eh
    const cellW = (r.w - gap * sx * 2 - colGap * sx * (cols - 1)) / cols
    const cellH = (r.h - gap * sy * 2 - rowGap * sy * (rows - 1)) / rows
    const out: { x: number; y: number; w: number; h: number }[] = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        out.push({
          x: r.x + gap * sx + col * (cellW + colGap * sx),
          y: r.y + gap * sy + row * (cellH + rowGap * sy),
          w: cellW,
          h: cellH,
        })
      }
    }
    return out
  }
  // The base rect(s) the zone is normalized against: the whole card (scratch) or each
  // cell (scratch grid). All coords are in overlay space (pre-zoom), like `rects`.
  const zoneBaseRects: { x: number; y: number; w: number; h: number }[] = (() => {
    if (!zoneEl || !zoneRect) return []
    if (zoneEl.game?.templateId !== 'scratch_grid') return [{ x: zoneRect.x, y: zoneRect.y, w: zoneRect.w, h: zoneRect.h }]
    return gridCellRects(zoneEl, zoneRect)
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
      if (d.hx < 0) {
        nx = Math.min(fx, right - MIN)
        nw = right - nx
      } else if (d.hx > 0) {
        nw = Math.max(MIN, fx - left)
      }
      if (d.hy < 0) {
        ny = Math.min(fy, bottom - MIN)
        nh = bottom - ny
      } else if (d.hy > 0) {
        nh = Math.max(MIN, fy - top)
      }
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

  // ---- thought-whacker multi-zone editor ----------------------------------
  const thoughtZoneEl = thoughtZoneEdit ? (scene.elements.find((e) => e.id === thoughtZoneEdit) ?? null) : null
  const thoughtZoneRect = thoughtZoneEdit ? (rects.find((r) => r.id === thoughtZoneEdit) ?? null) : null
  const readThoughtZones = (value: unknown): ThoughtZone[] => {
    if (!Array.isArray(value)) return [{ x: 8, y: 8, w: 84, h: 62 }]
    const out: ThoughtZone[] = []
    for (const raw of value) {
      if (!raw || typeof raw !== 'object') continue
      const z = raw as Partial<ThoughtZone>
      const x = Math.max(0, Math.min(100, Number(z.x) || 0))
      const y = Math.max(0, Math.min(100, Number(z.y) || 0))
      const w = Math.max(1, Math.min(100 - x, Number(z.w) || 1))
      const h = Math.max(1, Math.min(100 - y, Number(z.h) || 1))
      out.push({ x, y, w, h })
    }
    return out.length ? out : [{ x: 8, y: 8, w: 84, h: 62 }]
  }
  const currentThoughtZones = thoughtZonesLive ?? readThoughtZones(thoughtZoneEl?.game?.params?.spawnZones)
  const currentThoughtSubject = thoughtSubjectLive ?? {
    x: Math.max(0, Math.min(100, Number(thoughtZoneEl?.game?.params?.subjectX ?? 50))),
    y: Math.max(0, Math.min(100, Number(thoughtZoneEl?.game?.params?.subjectY ?? 88))),
  }
  const roundZone = (z: ThoughtZone): ThoughtZone => ({
    x: Math.round(z.x * 10) / 10,
    y: Math.round(z.y * 10) / 10,
    w: Math.round(z.w * 10) / 10,
    h: Math.round(z.h * 10) / 10,
  })
  const saveThoughtZones = (next: ThoughtZone[]): void => {
    if (!thoughtZoneEl?.game) return
    const zones = (next.length ? next : [{ x: 8, y: 8, w: 84, h: 62 }]).map(roundZone)
    setThoughtZonesLive(zones)
    patchElement(thoughtZoneEl.id, {
      game: { ...thoughtZoneEl.game, params: { ...(thoughtZoneEl.game.params ?? {}), spawnZones: zones } },
    })
  }
  const thoughtZonePoint = (e: React.PointerEvent): { x: number; y: number } | null => {
    if (!thoughtZoneRect) return null
    const { px, py } = toIntrinsic(e.clientX, e.clientY)
    return {
      x: Math.max(0, Math.min(100, ((px - thoughtZoneRect.x) / thoughtZoneRect.w) * 100)),
      y: Math.max(0, Math.min(100, ((py - thoughtZoneRect.y) / thoughtZoneRect.h) * 100)),
    }
  }
  const beginThoughtZoneDraw = (e: React.PointerEvent): void => {
    if (!thoughtZoneRect) return
    const { px, py } = toIntrinsic(e.clientX, e.clientY)
    if (px < thoughtZoneRect.x || px > thoughtZoneRect.x + thoughtZoneRect.w || py < thoughtZoneRect.y || py > thoughtZoneRect.y + thoughtZoneRect.h) return
    const p = thoughtZonePoint(e)
    if (!p) return
    overlayRef.current?.setPointerCapture(e.pointerId)
    const base = currentThoughtZones.slice()
    thoughtZoneDrag.current = { mode: 'draw', idx: base.length, hx: 1, hy: 1, sx: p.x, sy: p.y, base, last: null }
  }
  const beginThoughtZoneMove = (e: React.PointerEvent, idx: number): void => {
    e.stopPropagation()
    const p = thoughtZonePoint(e)
    if (!p) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    thoughtZoneDrag.current = { mode: 'move', idx, hx: 0, hy: 0, sx: p.x, sy: p.y, base: currentThoughtZones.map((z) => ({ ...z })), last: null }
  }
  const beginThoughtZoneResize = (e: React.PointerEvent, idx: number, hx: number, hy: number): void => {
    e.stopPropagation()
    const p = thoughtZonePoint(e)
    if (!p) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    thoughtZoneDrag.current = { mode: 'resize', idx, hx, hy, sx: p.x, sy: p.y, base: currentThoughtZones.map((z) => ({ ...z })), last: null }
  }
  const moveThoughtZone = (e: React.PointerEvent): void => {
    const d = thoughtZoneDrag.current
    const p = thoughtZonePoint(e)
    if (!d || !p) return
    e.stopPropagation()
    const next = d.base.map((z) => ({ ...z }))
    if (d.mode === 'draw') {
      const x = Math.min(d.sx, p.x)
      const y = Math.min(d.sy, p.y)
      next.push({ x, y, w: Math.max(0.1, Math.abs(p.x - d.sx)), h: Math.max(0.1, Math.abs(p.y - d.sy)) })
    } else if (d.mode === 'move') {
      const z = next[d.idx]
      if (!z) return
      z.x = Math.max(0, Math.min(100 - z.w, d.base[d.idx].x + p.x - d.sx))
      z.y = Math.max(0, Math.min(100 - z.h, d.base[d.idx].y + p.y - d.sy))
    } else {
      const z = next[d.idx]
      const original = d.base[d.idx]
      if (!z || !original) return
      const right = original.x + original.w
      const bottom = original.y + original.h
      if (d.hx < 0) {
        z.x = Math.min(p.x, right - 1)
        z.w = right - z.x
      } else {
        z.w = Math.max(1, p.x - original.x)
      }
      if (d.hy < 0) {
        z.y = Math.min(p.y, bottom - 1)
        z.h = bottom - z.y
      } else {
        z.h = Math.max(1, p.y - original.y)
      }
    }
    d.last = next
    setThoughtZonesLive(next)
  }
  const endThoughtZone = (e: React.PointerEvent): void => {
    e.stopPropagation()
    const d = thoughtZoneDrag.current
    thoughtZoneDrag.current = null
    if (!d?.last) return
    const next = d.last.filter((z) => z.w >= 1 && z.h >= 1)
    saveThoughtZones(next)
  }
  const removeThoughtZone = (e: React.PointerEvent, idx: number): void => {
    e.stopPropagation()
    saveThoughtZones(currentThoughtZones.filter((_, i) => i !== idx))
  }
  const beginThoughtSubjectMove = (e: React.PointerEvent): void => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    thoughtSubjectDrag.current = { last: null }
  }
  const moveThoughtSubject = (e: React.PointerEvent): void => {
    if (!thoughtSubjectDrag.current) return
    e.stopPropagation()
    const point = thoughtZonePoint(e)
    if (!point) return
    thoughtSubjectDrag.current.last = point
    setThoughtSubjectLive(point)
  }
  const endThoughtSubject = (e: React.PointerEvent): void => {
    e.stopPropagation()
    const drag = thoughtSubjectDrag.current
    thoughtSubjectDrag.current = null
    const point = drag?.last
    if (!point || !thoughtZoneEl?.game) return
    const x = Math.round(point.x * 10) / 10
    const y = Math.round(point.y * 10) / 10
    setThoughtSubjectLive({ x, y })
    patchElement(thoughtZoneEl.id, {
      game: { ...thoughtZoneEl.game, params: { ...(thoughtZoneEl.game.params ?? {}), subjectX: x, subjectY: y } },
    })
  }

  // ---- scratch-grid dynamic-date position editor -----------------------------
  // One shared (dateX, dateY) — dragging the marker in ANY cell moves it in all.
  const dateEl = dateEdit ? (scene.elements.find((e) => e.id === dateEdit) ?? null) : null
  const dateRect = dateEdit ? (rects.find((r) => r.id === dateEdit) ?? null) : null
  const dateParams: Record<string, unknown> = dateEl?.game?.params ?? {}
  const curDate = dateLive ?? {
    x: typeof dateParams.dateX === 'number' ? dateParams.dateX : 50,
    y: typeof dateParams.dateY === 'number' ? dateParams.dateY : 50,
  }
  curDateRef.current = curDate
  const dateCellRects = dateEl && dateRect && dateEl.game?.templateId === 'scratch_grid' ? gridCellRects(dateEl, dateRect) : []
  // Whether cell i actually shows a date (per-cell off flag + override/fallback formats).
  const dateCellOn = (i: number): boolean => {
    const off = dateParams['cell' + i + 'dateOff']
    if (off === true || off === 1 || off === '1' || off === 'on') return false
    if (String(dateParams['cell' + i + 'date'] ?? '')) return true
    const isW = (String(dateParams.pattern ?? 'LWWL')[i] ?? 'L').toUpperCase() === 'W'
    return !!String((isW ? dateParams.winDate : dateParams.loseDate) ?? '')
  }
  const onDateDown = (e: React.PointerEvent, base: { x: number; y: number; w: number; h: number }): void => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dateDrag.current = { base, last: null }
  }
  const onDateMove = (e: React.PointerEvent): void => {
    const d = dateDrag.current
    if (!d) return
    e.stopPropagation()
    const o = overlayRef.current!.getBoundingClientRect()
    const z = liveRef.current.zoom
    const ox = (e.clientX - o.left) / z
    const oy = (e.clientY - o.top) / z
    // The marker centers on the pointer (the date is center-anchored at dateX/dateY).
    const next = {
      x: Math.max(0, Math.min(100, ((ox - d.base.x) / d.base.w) * 100)),
      y: Math.max(0, Math.min(100, ((oy - d.base.y) / d.base.h) * 100)),
    }
    d.last = next
    setDateLive(next)
  }
  const onDateUp = (e: React.PointerEvent): void => {
    e.stopPropagation()
    const d = dateDrag.current
    dateDrag.current = null
    const g = dateEl?.game
    if (d?.last && dateEl && g) {
      const r = (n: number): number => Math.round(n * 10) / 10
      patchElement(dateEl.id, { game: { ...g, params: { ...(g.params ?? {}), dateX: r(d.last.x), dateY: r(d.last.y) } } })
    }
  }

  // ---- flipbook book editor --------------------------------------------------
  // Two things live on the canvas here, both measured against the BOOK (an
  // aspect-locked box centered in the element) rather than the element itself:
  // the fold line, and the shut cover's box with corner handles. Mirrors
  // runtime/games/flipbook.ts layout()/sizeCover() so what you drag is what renders.
  const spineEl = spineEdit ? (scene.elements.find((e) => e.id === spineEdit) ?? null) : null
  const spineRect = spineEdit ? (rects.find((r) => r.id === spineEdit) ?? null) : null
  const spineParams: Record<string, unknown> = spineEl?.game?.params ?? {}
  const curCoverScale = spineLive?.coverScale ?? (typeof spineParams.coverScale === 'number' ? spineParams.coverScale : 100)
  const curBookScale = spineLive?.bookScale ?? (typeof spineParams.bookScale === 'number' ? spineParams.bookScale : 100)
  const spineBoxes = spineRect ? flipbookBoxes(spineRect, { ...flipbookOpts(spineParams, assets), bookScale: curBookScale, coverScale: curCoverScale }) : null
  const spineBook = spineBoxes?.book ?? null
  const spineCover = spineBoxes?.cover ?? null
  // Passive indicator: a SELECTED flipbook shows where its fold falls — the seam
  // between the left and right page art — so the layout is visible without opening
  // the editor. The fold is derived from the art, so there is nothing to drag.
  const spineHint = ((): { book: Box; x: number } | null => {
    if (spineEdit || !singleRect || single?.type !== 'game-mount' || single.game?.templateId !== 'flipbook') return null
    const p: Record<string, unknown> = single.game?.params ?? {}
    const { book, spineX } = flipbookBoxes(singleRect, flipbookOpts(p, assets))
    return { book, x: spineX }
  })()
  /** Grab a corner of the book or of the shut cover: uniform scale about that box's
   * centre, frozen at drag start so the anchor can't chase the pointer as it resizes. */
  const onScaleDown =
    (mode: 'cover' | 'book') =>
    (e: React.PointerEvent): void => {
      e.stopPropagation()
      const box = mode === 'book' ? spineBook : spineCover
      if (!spineBook || !box) return
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      const o = overlayRef.current!.getBoundingClientRect()
      const z = liveRef.current.zoom
      const cx = box.x + box.w / 2
      const cy = box.y + box.h / 2
      const dx = (e.clientX - o.left) / z - cx
      const dy = (e.clientY - o.top) / z - cy
      spineDrag.current = {
        mode,
        base: { x: spineBook.x, w: spineBook.w, cx, cy, dist: Math.max(1, Math.hypot(dx, dy)) },
        start: mode === 'book' ? curBookScale : curCoverScale,
        last: null,
      }
    }
  const onSpineMove = (e: React.PointerEvent): void => {
    const d = spineDrag.current
    if (!d) return
    e.stopPropagation()
    const o = overlayRef.current!.getBoundingClientRect()
    const z = liveRef.current.zoom
    const ox = (e.clientX - o.left) / z
    const oy = (e.clientY - o.top) / z
    const ratio = Math.hypot(ox - d.base.cx, oy - d.base.cy) / d.base.dist
    const max = d.mode === 'book' ? 200 : 150
    d.last = Math.max(20, Math.min(max, d.start * ratio))
    setSpineLive({ coverScale: curCoverScale, bookScale: curBookScale, [d.mode === 'book' ? 'bookScale' : 'coverScale']: d.last })
  }
  const onSpineUp = (e: React.PointerEvent): void => {
    e.stopPropagation()
    const d = spineDrag.current
    spineDrag.current = null
    const g = spineEl?.game
    if (d?.last != null && spineEl && g) {
      const key = d.mode === 'book' ? 'bookScale' : 'coverScale'
      patchElement(spineEl.id, { game: { ...g, params: { ...(g.params ?? {}), [key]: Math.round(d.last * 10) / 10 } } })
    }
  }

  // ---- memory-match tracker symbol editor -----------------------------------
  // Mirrors runtime/games/memorymatch.ts tracker layout (baseline model): symbols
  // left-to-right, bottoms on a shared baseline; per-symbol scale + X nudge.
  const trackerEl = trackerEdit ? (scene.elements.find((e) => e.id === trackerEdit) ?? null) : null
  const trackerRect = trackerEdit ? (rects.find((r) => r.id === trackerEdit) ?? null) : null
  const tP: Record<string, unknown> = trackerEl?.game?.params ?? {}
  const tPairs = Math.max(2, Math.min(10, Number(tP.pairs ?? 5)))
  const parseNums = (v: unknown): number[] =>
    String(v ?? '')
      .split(',')
      .map((x) => parseFloat(x.trim()))
  const curTracker = trackerLive ?? {
    scales: Array.from({ length: tPairs }, (_, i) => {
      const n = parseNums(tP.trackerScales)[i]
      return n > 0 ? n : 1
    }),
    dxs: Array.from({ length: tPairs }, (_, i) => {
      const n = parseNums(tP.trackerDx)[i]
      return isFinite(n) ? n : 0
    }),
  }
  curTrackerRef.current = curTracker
  // Per-symbol boxes in overlay space (pre-zoom), plus the design→overlay scale
  // and base symbol size needed by the drag handlers.
  const trackerGeom = (() => {
    if (!trackerEl || !trackerRect) return null
    const pos = tP.tracker === 'off' ? 'off' : tP.tracker === 'bottom' ? 'bottom' : 'top'
    if (pos === 'off') return null
    const ew = trackerEl.w ?? 900
    const s = trackerRect.w / ew
    const symSz = Math.max(10, Number(tP.trackerSize ?? 34)) * s
    const gap = Math.max(0, Number(tP.trackerGap ?? 18)) * s
    const shiftX = Number(tP.trackerShiftX ?? 0) * s
    const shiftY = Number(tP.trackerShiftY ?? 0) * s
    // Mirror the runtime baseline anchoring: bottom tracker = fixed pad above the
    // element's bottom; top tracker = fixed top pad, grows downward. While a drag
    // is in flight the baseline FREEZES at its drag-start value so the bottoms
    // stay glued under the pointer (it settles on release).
    const maxTs = Math.max(1, ...curTracker.scales.filter((v) => v > 0))
    const maxH = symSz * maxTs
    const pad = Math.max(8 * s, symSz * 0.35)
    const baseline = trackerDrag.current ? trackerDrag.current.bottomY : trackerRect.y + (pos === 'bottom' ? trackerRect.h - pad / 2 : pad / 2 + maxH) + shiftY
    const sizes = curTracker.scales.map((v) => symSz * (v > 0 ? v : 1))
    const totalW = sizes.reduce((a, b) => a + b, 0) + gap * (tPairs - 1)
    let x = trackerRect.x + (trackerRect.w - totalW) / 2 + shiftX
    const boxes = sizes.map((sz, i) => {
      const b = { x: x + curTracker.dxs[i] * s, y: baseline - sz, w: sz, h: sz }
      x += sz + gap
      return b
    })
    return { boxes, s, symSz, baseline }
  })()
  const onTrackerBodyDown = (e: React.PointerEvent, idx: number): void => {
    e.stopPropagation()
    if (!trackerGeom) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const o = overlayRef.current!.getBoundingClientRect()
    const z = liveRef.current.zoom
    trackerDrag.current = {
      mode: 'move',
      idx,
      ox: (e.clientX - o.left) / z,
      oy: (e.clientY - o.top) / z,
      s: trackerGeom.s,
      symSz: trackerGeom.symSz,
      bottomY: trackerGeom.baseline,
      start: curTrackerRef.current,
      last: null,
    }
  }
  const onTrackerHandleDown = (e: React.PointerEvent, idx: number): void => {
    e.stopPropagation()
    if (!trackerGeom) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const o = overlayRef.current!.getBoundingClientRect()
    const z = liveRef.current.zoom
    trackerDrag.current = {
      mode: 'resize',
      idx,
      ox: (e.clientX - o.left) / z,
      oy: (e.clientY - o.top) / z,
      s: trackerGeom.s,
      symSz: trackerGeom.symSz,
      bottomY: trackerGeom.baseline,
      start: curTrackerRef.current,
      last: null,
    }
  }
  const onTrackerMove = (e: React.PointerEvent): void => {
    const d = trackerDrag.current
    if (!d) return
    e.stopPropagation()
    const o = overlayRef.current!.getBoundingClientRect()
    const z = liveRef.current.zoom
    const ox = (e.clientX - o.left) / z
    const oy = (e.clientY - o.top) / z
    let next: { scales: number[]; dxs: number[] }
    if (d.mode === 'move') {
      // Horizontal nudge only — bottoms stay glued to the shared baseline.
      const dx = Math.round(d.start.dxs[d.idx] + (ox - d.ox) / d.s)
      next = { scales: d.start.scales, dxs: d.start.dxs.map((v, i) => (i === d.idx ? dx : v)) }
    } else {
      // Resize upward from the baseline; the box is square so aspect is locked.
      const size = Math.max(6, d.bottomY - oy)
      const sc = Math.max(0.2, Math.min(4, Math.round((size / d.symSz) * 100) / 100))
      next = { scales: d.start.scales.map((v, i) => (i === d.idx ? sc : v)), dxs: d.start.dxs }
    }
    d.last = next
    setTrackerLive(next)
  }
  const onTrackerUp = (e: React.PointerEvent): void => {
    e.stopPropagation()
    const d = trackerDrag.current
    trackerDrag.current = null
    const g = trackerEl?.game
    if (d?.last && trackerEl && g) {
      patchElement(trackerEl.id, {
        game: {
          ...g,
          params: {
            ...(g.params ?? {}),
            trackerScales: d.last.scales.map((v) => Math.round(v * 100) / 100).join(', '),
            trackerDx: d.last.dxs.map((v) => Math.round(v)).join(', '),
          },
        },
      })
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
          const lsN = landscapeCount(sd)
          return (
            <div
              key={sd.id}
              className={'frame' + (active ? ' active' : '') + (dropTarget === sd.id ? ' drop-target' : '')}
              style={{ left: pos.x, top: pos.y, width: box.w, height: box.h }}
            >
              <div
                className="frame-label"
                onPointerDown={(e) => onFrameLabelDown(e, sd.id)}
                onPointerMove={onFrameLabelMove}
                onPointerUp={onFrameLabelUp}
                onPointerCancel={onFrameLabelUp}
              >
                {sd.name}
                {active && (
                  <button
                    className="frame-chip"
                    title={landscape ? 'Switch the canvas to portrait' : 'Switch the canvas to landscape'}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setOrientation(landscape ? 'portrait' : 'landscape')}
                  >
                    {landscape ? '▯ portrait' : '▭ landscape'}
                  </button>
                )}
                {lsN > 0 && (
                  <span className="frame-chip frame-chip-ls" title={`${lsN}/${sd.elements.length} elements in this scene have their own landscape layout`}>
                    ▭ {lsN}
                  </span>
                )}
              </div>
              {/* One-click entry into a separate landscape layout, right where you edit:
                  shown only on the active frame, in landscape, while the scene still
                  mirrors portrait. Seeding snapshots portrait geometry per element and
                  the banner disappears (overrides now exist). */}
              {active &&
                landscape &&
                lsN === 0 &&
                sd.elements.length > 0 &&
                !activeVariant &&
                !editLocale &&
                !lsBannerClosed[sd.id] &&
                !revealEdit &&
                !zoneEdit &&
                !thoughtZoneEdit &&
                !cropEdit &&
                !trackerEdit &&
                !spineEdit && (
                  <div className="ls-banner" onPointerDown={(e) => e.stopPropagation()}>
                    <span>Landscape mirrors portrait</span>
                    <button onClick={() => seedLandscapeLayout()}>Create separate landscape layout</button>
                    <button className="ls-banner-close" title="Hide for this scene" onClick={() => setLsBannerClosed((m) => ({ ...m, [sd.id]: true }))}>
                      ✕
                    </button>
                  </div>
                )}
              <div className="stage-wrap">
                <CanvasFrame
                  sceneId={sd.id}
                  def={sd}
                  meta={project.meta}
                  assets={assets}
                  renderKey={renderKey}
                  locale={editLocale}
                  onLayout={handleLayout}
                  iframeRef={
                    active
                      ? (el) => {
                          activeIframeRef.current = el
                        }
                      : undefined
                  }
                />
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
                  {!revealEdit &&
                    !zoneEdit &&
                    !thoughtZoneEdit &&
                    !cropEdit &&
                    !trackerEdit &&
                    !spineEdit &&
                    selectedIds.map((id) => {
                      const r = rects.find((x) => x.id === id)
                      if (!r) return null
                      // In landscape, a dashed box marks an element still mirroring its
                      // portrait geometry (no landscape override yet) — drag it (or seed
                      // the scene layout) and the box turns solid.
                      const mirrors = landscape && !sd.elements.some((x) => x.id === id && x.landscape && Object.keys(x.landscape).length > 0)
                      return <div key={id} className={'sel-box' + (mirrors ? ' mirrors-portrait' : '')} style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
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
                  {!revealEdit &&
                    !zoneEdit &&
                    !cropEdit &&
                    !trackerEdit &&
                    !spineEdit &&
                    single &&
                    singleRect &&
                    singleHandles.map((h) => (
                      <div
                        key={h.k}
                        className={'handle h-' + h.k}
                        style={{ left: singleRect.x + ((h.hx + 1) / 2) * singleRect.w, top: singleRect.y + ((h.hy + 1) / 2) * singleRect.h }}
                        onPointerDown={(e) => onHandlePointerDown(e, h, 'single')}
                      />
                    ))}
                  {!revealEdit && !zoneEdit && !cropEdit && !trackerEdit && !spineEdit && single && singleRect && (
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
                  {measures.map((mo, i) => {
                    const len = mo.horiz ? mo.x2 - mo.x1 : mo.y2 - mo.y1
                    return (
                      <div key={'ms' + i}>
                        <div
                          className={'measure-line ' + (mo.horiz ? 'mh' : 'mv')}
                          style={mo.horiz ? { left: mo.x1, top: mo.y1, width: Math.max(0, len) } : { left: mo.x1, top: mo.y1, height: Math.max(0, len) }}
                        />
                        <div
                          className="measure-badge"
                          style={{ left: mo.horiz ? mo.x1 + len / 2 : mo.x1, top: mo.horiz ? mo.y1 : mo.y1 + len / 2, transform: `translate(-50%,-50%) scale(${1 / zoom})` }}
                        >
                          {mo.label}
                        </div>
                      </div>
                    )
                  })}
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
                      defaultValue={editLocale ? (editEl.text.i18n?.[editLocale] ?? editEl.text.value) : editEl.text.value}
                      style={{
                        left: editRect.x,
                        top: editRect.y,
                        width: Math.max(40, editRect.w),
                        height: Math.max(24, editRect.h),
                        fontSize: editEl.text.fontSizePx * metricsRef.current.s,
                        color: editEl.text.color ?? '#fff',
                        textAlign: editEl.text.align ?? 'center',
                      }}
                      onChange={(e) =>
                        patchElement(editEl.id, {
                          text: editLocale ? { ...editEl.text!, i18n: { ...(editEl.text!.i18n ?? {}), [editLocale]: e.target.value } } : { ...editEl.text!, value: e.target.value },
                        })
                      }
                      onBlur={() => setEditing(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
                          e.preventDefault()
                          setEditing(null)
                        }
                      }}
                    />
                  )}
                  {cropEdit &&
                    cropView &&
                    cropSrc &&
                    (() => {
                      const m = metricsRef.current
                      const rx = cropView.left * m.s + m.offX
                      const ry = cropView.top * m.s + m.offY
                      const rw = cropView.w * m.s
                      const rh = cropView.h * m.s
                      const iw = cropView.scale * rw
                      const ih = iw * cropView.natR
                      const ix = rx + cropView.cx * rw
                      const iy = ry + cropView.cy * rh
                      const dim = 'rgba(0,0,0,0.5)'
                      return (
                        <>
                          {/* the full picture behind the window; bright inside, dimmed outside by the bands */}
                          <img
                            src={cropSrc}
                            alt=""
                            draggable={false}
                            style={{ position: 'absolute', left: ix, top: iy, width: iw, height: ih, pointerEvents: 'none', userSelect: 'none' }}
                          />
                          <div style={{ position: 'absolute', left: 0, top: 0, width: box.w, height: Math.max(0, ry), background: dim, pointerEvents: 'none' }} />
                          <div
                            style={{ position: 'absolute', left: 0, top: ry + rh, width: box.w, height: Math.max(0, box.h - (ry + rh)), background: dim, pointerEvents: 'none' }}
                          />
                          <div style={{ position: 'absolute', left: 0, top: ry, width: Math.max(0, rx), height: rh, background: dim, pointerEvents: 'none' }} />
                          <div
                            style={{ position: 'absolute', left: rx + rw, top: ry, width: Math.max(0, box.w - (rx + rw)), height: rh, background: dim, pointerEvents: 'none' }}
                          />
                          {/* the crop window: drag the middle to pan, the handles to resize */}
                          <div
                            style={{
                              position: 'absolute',
                              left: rx,
                              top: ry,
                              width: rw,
                              height: rh,
                              border: '2px solid var(--accent)',
                              boxSizing: 'border-box',
                              cursor: 'move',
                              touchAction: 'none',
                            }}
                            onPointerDown={onCropBodyDown}
                            onPointerMove={onCropMove}
                            onPointerUp={onCropUp}
                            onPointerCancel={onCropUp}
                          >
                            {[...CORNERS, ...EDGES].map((h) => (
                              <div
                                key={h.k}
                                className={'handle h-' + h.k}
                                style={{ left: ((h.hx + 1) / 2) * rw, top: ((h.hy + 1) / 2) * rh }}
                                onPointerDown={(ev) => onCropHandleDown(ev, h)}
                                onPointerMove={onCropMove}
                                onPointerUp={onCropUp}
                                onPointerCancel={onCropUp}
                              />
                            ))}
                          </div>
                          <div className="dim-badge" style={{ left: rx + rw / 2, top: ry + rh, transform: `translate(-50%, 6px) scale(${1 / zoom})`, whiteSpace: 'nowrap' }}>
                            drag edges to crop · drag middle to move · scroll to zoom · Enter when done
                          </div>
                        </>
                      )
                    })()}
                  {revealEdit && revealRect && revealSrc && (
                    <div className="reveal-edit" style={{ left: revealRect.x, top: revealRect.y, width: revealRect.w, height: revealRect.h }}>
                      <div className="reveal-edit-clip" onPointerDown={onRevealBodyDown} onPointerMove={onRevealMove} onPointerUp={onRevealUp} onPointerCancel={onRevealUp}>
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
                            style={{
                              position: 'absolute',
                              left: bx.x,
                              top: bx.y,
                              width: bx.w,
                              height: bx.h,
                              border: '1.5px dashed var(--accent)',
                              opacity: 0.45,
                              pointerEvents: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        )
                      })}
                      {/* The editable zone box (whole card, or the top-left cell for a grid). */}
                      {(() => {
                        const bx = zoneBoxFor(zoneBase, curZone)
                        return (
                          <div
                            style={{
                              position: 'absolute',
                              left: bx.x,
                              top: bx.y,
                              width: bx.w,
                              height: bx.h,
                              border: '2px solid var(--accent)',
                              background: 'rgba(80,140,255,0.12)',
                              boxSizing: 'border-box',
                              cursor: 'move',
                              touchAction: 'none',
                            }}
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
                  {thoughtZoneEdit && thoughtZoneRect && (
                    <>
                      <div
                        style={{
                          position: 'absolute',
                          left: thoughtZoneRect.x,
                          top: thoughtZoneRect.y,
                          width: thoughtZoneRect.w,
                          height: thoughtZoneRect.h,
                          border: '1px dashed rgba(80,140,255,.7)',
                          boxSizing: 'border-box',
                          pointerEvents: 'none',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: 4,
                            top: 4,
                            padding: '2px 7px',
                            borderRadius: 4,
                            background: 'var(--accent)',
                            color: '#fff',
                            font: '600 11px/1.5 system-ui,sans-serif',
                          }}
                        >
                          Draw spawn areas · drag the SUBJECT marker · Enter when done
                        </div>
                      </div>
                      {currentThoughtZones.map((zone, i) => {
                        const bx = {
                          x: thoughtZoneRect.x + (zone.x / 100) * thoughtZoneRect.w,
                          y: thoughtZoneRect.y + (zone.y / 100) * thoughtZoneRect.h,
                          w: (zone.w / 100) * thoughtZoneRect.w,
                          h: (zone.h / 100) * thoughtZoneRect.h,
                        }
                        return (
                          <div
                            key={`thought-zone-${i}`}
                            style={{
                              position: 'absolute',
                              left: bx.x,
                              top: bx.y,
                              width: bx.w,
                              height: bx.h,
                              border: '2px solid var(--accent)',
                              background: 'rgba(80,140,255,.15)',
                              boxSizing: 'border-box',
                              cursor: 'move',
                              touchAction: 'none',
                            }}
                            onPointerDown={(e) => beginThoughtZoneMove(e, i)}
                            onPointerMove={moveThoughtZone}
                            onPointerUp={endThoughtZone}
                            onPointerCancel={endThoughtZone}
                          >
                            <div
                              title="Remove this spawn area"
                              style={{
                                position: 'absolute',
                                right: -10,
                                top: -10,
                                width: 18,
                                height: 18,
                                borderRadius: '50%',
                                background: 'var(--accent)',
                                color: '#fff',
                                font: '700 12px/18px system-ui,sans-serif',
                                textAlign: 'center',
                                cursor: 'pointer',
                              }}
                              onPointerDown={(e) => removeThoughtZone(e, i)}
                            >
                              ×
                            </div>
                            {CORNERS.map((h) => (
                              <div
                                key={h.k}
                                className={'handle h-' + h.k}
                                style={{ left: ((h.hx + 1) / 2) * bx.w, top: ((h.hy + 1) / 2) * bx.h }}
                                onPointerDown={(e) => beginThoughtZoneResize(e, i, h.hx, h.hy)}
                                onPointerMove={moveThoughtZone}
                                onPointerUp={endThoughtZone}
                                onPointerCancel={endThoughtZone}
                              />
                            ))}
                          </div>
                        )
                      })}
                      <div
                        title="Drag this marker onto the subject; every thought tail points here"
                        style={{
                          position: 'absolute',
                          left: thoughtZoneRect.x + (currentThoughtSubject.x / 100) * thoughtZoneRect.w - 14,
                          top: thoughtZoneRect.y + (currentThoughtSubject.y / 100) * thoughtZoneRect.h - 14,
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          border: '3px solid #ff4f87',
                          background: 'rgba(255,79,135,.22)',
                          boxShadow: '0 0 0 2px #fff,0 2px 8px rgba(0,0,0,.25)',
                          boxSizing: 'border-box',
                          cursor: 'move',
                          touchAction: 'none',
                          zIndex: 20,
                        }}
                        onPointerDown={beginThoughtSubjectMove}
                        onPointerMove={moveThoughtSubject}
                        onPointerUp={endThoughtSubject}
                        onPointerCancel={endThoughtSubject}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: '50%',
                            top: -23,
                            transform: 'translateX(-50%)',
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: '#ff4f87',
                            color: '#fff',
                            font: '700 10px/1.5 system-ui,sans-serif',
                            whiteSpace: 'nowrap',
                            pointerEvents: 'none',
                          }}
                        >
                          SUBJECT
                        </div>
                      </div>
                    </>
                  )}
                  {trackerEdit && trackerGeom && (
                    <>
                      {/* Shared baseline every symbol's bottom sits on. */}
                      <div
                        style={{
                          position: 'absolute',
                          left: trackerGeom.boxes[0] ? Math.min(...trackerGeom.boxes.map((b) => b.x)) - 14 : 0,
                          top: trackerGeom.baseline,
                          width: trackerGeom.boxes[0] ? Math.max(...trackerGeom.boxes.map((b) => b.x + b.w)) - Math.min(...trackerGeom.boxes.map((b) => b.x)) + 28 : 0,
                          height: 0,
                          borderTop: '1px dashed var(--accent)',
                          opacity: 0.6,
                          pointerEvents: 'none',
                        }}
                      />
                      {trackerGeom.boxes.map((b, i) => (
                        <div
                          key={'trk' + i}
                          style={{
                            position: 'absolute',
                            left: b.x,
                            top: b.y,
                            width: b.w,
                            height: b.h,
                            border: '1.5px solid var(--accent)',
                            background: 'rgba(80,140,255,0.10)',
                            boxSizing: 'border-box',
                            cursor: 'ew-resize',
                            touchAction: 'none',
                          }}
                          onPointerDown={(e) => onTrackerBodyDown(e, i)}
                          onPointerMove={onTrackerMove}
                          onPointerUp={onTrackerUp}
                          onPointerCancel={onTrackerUp}
                        >
                          {/* one top-right handle: resize upward from the baseline, aspect locked */}
                          <div
                            className="handle"
                            style={{ left: b.w, top: 0, cursor: 'nesw-resize' }}
                            onPointerDown={(e) => onTrackerHandleDown(e, i)}
                            onPointerMove={onTrackerMove}
                            onPointerUp={onTrackerUp}
                            onPointerCancel={onTrackerUp}
                          />
                        </div>
                      ))}
                    </>
                  )}
                  {dateEdit &&
                    dateCellRects.length > 0 &&
                    dateCellRects.map((b, i) => {
                      const on = dateCellOn(i)
                      const mx = b.x + (curDate.x / 100) * b.w
                      const my = b.y + (curDate.y / 100) * b.h
                      return (
                        <div
                          key={'dmark-' + i}
                          title={on ? 'Drag to position the date (shared by all cells). Esc to finish.' : 'No date in this cell — drag still moves the shared position'}
                          style={{
                            position: 'absolute',
                            left: mx - 10,
                            top: my - 10,
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            border: '2px solid var(--accent)',
                            background: 'rgba(80,140,255,0.28)',
                            boxSizing: 'border-box',
                            cursor: 'move',
                            touchAction: 'none',
                            opacity: on ? 1 : 0.35,
                          }}
                          onPointerDown={(e) => onDateDown(e, b)}
                          onPointerMove={onDateMove}
                          onPointerUp={onDateUp}
                          onPointerCancel={onDateUp}
                        />
                      )
                    })}
                  {spineHint && (
                    <>
                      {/* Where the fold sits — visible on selection, not only in the editor. */}
                      <div
                        style={{
                          position: 'absolute',
                          left: spineHint.x - 1,
                          top: spineHint.book.y,
                          width: 2,
                          height: spineHint.book.h,
                          background: 'var(--accent)',
                          opacity: 0.55,
                          pointerEvents: 'none',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: spineHint.x,
                          top: spineHint.book.y - 20,
                          transform: 'translateX(-50%)',
                          padding: '0 5px',
                          borderRadius: 4,
                          background: 'var(--accent)',
                          color: '#fff',
                          opacity: 0.85,
                          font: '600 10px/1.7 system-ui, sans-serif',
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                        }}
                      >
                        fold · double-click to size the book
                      </div>
                    </>
                  )}
                  {spineEdit && spineBook && (
                    <>
                      {/* The book itself — drag a corner to size it (the fold and the
                          cover are measured against this box, not the element). */}
                      <div
                        title="Drag a corner to size the book. Esc to finish."
                        style={{
                          position: 'absolute',
                          left: spineBook.x,
                          top: spineBook.y,
                          width: spineBook.w,
                          height: spineBook.h,
                          border: '1px dashed var(--accent)',
                          boxSizing: 'border-box',
                          pointerEvents: 'none',
                        }}
                      >
                        {(
                          [
                            [0, 0, 'nwse-resize'],
                            [1, 0, 'nesw-resize'],
                            [0, 1, 'nesw-resize'],
                            [1, 1, 'nwse-resize'],
                          ] as const
                        ).map(([hx, hy, cursor]) => (
                          <div
                            key={'bk' + hx + hy}
                            className="handle"
                            style={{ left: hx * spineBook.w, top: hy * spineBook.h, cursor, pointerEvents: 'auto', touchAction: 'none' }}
                            onPointerDown={onScaleDown('book')}
                            onPointerMove={onSpineMove}
                            onPointerUp={onSpineUp}
                            onPointerCancel={onSpineUp}
                          />
                        ))}
                        <div
                          style={{
                            position: 'absolute',
                            top: -22,
                            left: 0,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: 'var(--accent)',
                            color: '#fff',
                            font: '600 11px/1.5 system-ui, sans-serif',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          book {Math.round(curBookScale)}%
                        </div>
                      </div>
                      {/* The shut cover — drag a corner to size it (shape is locked to
                          the art, so it scales uniformly). */}
                      {spineCover && (
                        <div
                          title="Drag a corner to size the shut cover. Esc to finish."
                          style={{
                            position: 'absolute',
                            left: spineCover.x,
                            top: spineCover.y,
                            width: spineCover.w,
                            height: spineCover.h,
                            border: '1.5px solid var(--accent)',
                            background: 'rgba(80,140,255,0.08)',
                            boxSizing: 'border-box',
                            pointerEvents: 'none',
                          }}
                        >
                          {(
                            [
                              [0, 0, 'nwse-resize'],
                              [1, 0, 'nesw-resize'],
                              [0, 1, 'nesw-resize'],
                              [1, 1, 'nwse-resize'],
                            ] as const
                          ).map(([hx, hy, cursor]) => (
                            <div
                              key={'cov' + hx + hy}
                              className="handle"
                              style={{ left: hx * spineCover.w, top: hy * spineCover.h, cursor, pointerEvents: 'auto', touchAction: 'none' }}
                              onPointerDown={onScaleDown('cover')}
                              onPointerMove={onSpineMove}
                              onPointerUp={onSpineUp}
                              onPointerCancel={onSpineUp}
                            />
                          ))}
                          <div
                            style={{
                              position: 'absolute',
                              bottom: -22,
                              left: '50%',
                              transform: 'translateX(-50%)',
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: 'var(--accent)',
                              color: '#fff',
                              font: '600 11px/1.5 system-ui, sans-serif',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            cover {Math.round(curCoverScale)}%
                          </div>
                        </div>
                      )}
                      {/* The cover's own pivot — the point the shut book turns about.
                          Distinct from the fold: dashed, and measured across the COVER. */}
                      {/* The fold: where the left and right page art meet. Derived from
                          the art, so it's shown, not dragged. */}
                      {spineBoxes && (
                        <div
                          style={{
                            position: 'absolute',
                            left: spineBoxes.spineX - 1,
                            top: spineBook.y,
                            width: 2,
                            height: spineBook.h,
                            background: 'var(--accent)',
                            opacity: 0.5,
                            pointerEvents: 'none',
                          }}
                        />
                      )}
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
