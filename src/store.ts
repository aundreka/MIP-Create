// Editor state store. A project is an ordered list of scenes; the editor edits
// one active scene at a time. A derived `scene` (the active scene as a render
// unit) is kept in state so existing read-consumers keep working unchanged;
// element mutations operate on the active scene.

import { useSyncExternalStore } from 'react'
import type { OrientationOverride, Project, ProjectMeta, Scene, SceneDef, SceneElement, Variant } from '../runtime/scene'
import type { AssetEntry, AssetMap } from '../runtime/types'
import { getActiveVariant } from './variantMode'
import { applyVariantPatches } from './variants'

export type Orientation = 'portrait' | 'landscape'

// Editor-only trace-over backdrop: a mockup faintly overlaid on the canvas to
// align elements against. Never rendered by the runtime or included in export.
export interface TraceState {
  assetId?: string
  opacity: number
  visible: boolean
}

export interface EditorState {
  project: Project
  activeSceneId: string
  scene: Scene // DERIVED: active scene as a render unit (read-only convenience)
  assets: AssetMap
  selectedIds: string[]
  orientation: Orientation
  trace: TraceState
  dirty: boolean
  projectPath: string | null
  canUndo: boolean
  canRedo: boolean
}

function defaultTrace(): TraceState {
  return { opacity: 0.5, visible: true }
}

let idSeq = 0
function now(): number {
  return performance.now()
}
export function nextId(prefix: string): string {
  idSeq += 1
  return `${prefix}${idSeq}_${Math.floor(now())}`
}

function starterMeta(): ProjectMeta {
  return {
    schemaVersion: 1,
    name: 'untitled',
    clickUrl: {
      ios: 'https://apps.apple.com/app/id000000000',
      android: 'https://play.google.com/store/apps/details?id=com.example.app',
    },
    baseW: 1080,
    baseH: 1920,
    bgMatchColor: '#101a33',
  }
}
function starterProject(): Project {
  const scene: SceneDef = {
    id: 'scene1',
    name: 'Game',
    kind: 'game',
    elements: [
      { id: 'title', type: 'text', name: 'Title', x: 540, y: 360, anchor: 'center', zIndex: 11, mode: 'fit', text: { value: 'Your Title', fontSizePx: 92, fontWeight: 800, color: '#ffffff', align: 'center' } },
      { id: 'cta', type: 'cta', name: 'CTA button', x: 540, y: 1720, anchor: 'center', zIndex: 20, mode: 'fit', w: 560, h: 150, cta: { pulse: 'medium' }, text: { value: 'PLAY NOW', fontSizePx: 64, fontWeight: 800, color: '#ffffff' }, box: { bgColor: '#16a34a', radiusPx: 75 } },
    ],
    advance: { on: 'gameWin' },
  }
  return { meta: starterMeta(), scenes: [scene], startSceneId: 'scene1' }
}

/** A fresh blank project (used by the project library / "New project"). */
export function blankProject(): { project: Project; assets: AssetMap; trace?: TraceState } {
  return { project: starterProject(), assets: {} }
}

function deriveScene(project: Project, activeSceneId: string): Scene {
  const sd = project.scenes.find((s) => s.id === activeSceneId) ?? project.scenes[0]
  let elements = sd?.elements ?? []
  // when editing a variant, the canvas/inspector show base + that variant's overrides
  const vid = getActiveVariant()
  if (vid) {
    const v = project.meta.variants?.find((x) => x.id === vid)
    if (v) elements = applyVariantPatches(elements, v.patches)
  }
  return { meta: { ...project.meta, bgMatchColor: sd?.bgColor ?? project.meta.bgMatchColor }, elements }
}

const project0 = starterProject()
let state: EditorState = {
  project: project0,
  activeSceneId: project0.startSceneId,
  scene: deriveScene(project0, project0.startSceneId),
  assets: {},
  selectedIds: [],
  orientation: 'portrait',
  trace: defaultTrace(),
  dirty: false,
  projectPath: null,
  canUndo: false,
  canRedo: false,
}

const listeners = new Set<() => void>()
function emit(): void {
  for (const l of [...listeners]) l()
}

// ---- history (snapshots the whole project) --------------------------------
interface Snap {
  project: Project
  assets: AssetMap
}
const past: Snap[] = []
const future: Snap[] = []
const CAP = 60
let txDepth = 0
let txSnapped = false
let lastSnapAt = -1e9

function pushSnap(force: boolean): void {
  if (txDepth > 0) {
    if (txSnapped && !force) return
    txSnapped = true
  } else if (!force && now() - lastSnapAt < 450) return
  past.push({ project: structuredClone(state.project), assets: state.assets })
  if (past.length > CAP) past.shift()
  future.length = 0
  lastSnapAt = now()
}

function set(partial: Partial<EditorState>, recordHistory = true): void {
  if (recordHistory && partial.project) pushSnap(false)
  state = { ...state, ...partial }
  state.scene = deriveScene(state.project, state.activeSceneId)
  state.canUndo = past.length > 0
  state.canRedo = future.length > 0
  emit()
}

export function beginTransaction(): void {
  if (txDepth === 0) {
    txSnapped = false
    pushSnap(true)
    txSnapped = true
  }
  txDepth += 1
}
export function endTransaction(): void {
  txDepth = Math.max(0, txDepth - 1)
}
function restore(snap: Snap): void {
  state = {
    ...state,
    project: snap.project,
    assets: snap.assets,
    dirty: true,
  }
  if (!state.project.scenes.some((s) => s.id === state.activeSceneId)) state.activeSceneId = state.project.startSceneId
  state.scene = deriveScene(state.project, state.activeSceneId)
  state.selectedIds = state.selectedIds.filter((id) => state.scene.elements.some((e) => e.id === id))
  state.canUndo = past.length > 0
  state.canRedo = future.length > 0
  emit()
}
export function undo(): void {
  if (!past.length) return
  future.push({ project: structuredClone(state.project), assets: state.assets })
  restore(past.pop()!)
}
export function redo(): void {
  if (!future.length) return
  past.push({ project: structuredClone(state.project), assets: state.assets })
  restore(future.pop()!)
}

// ---- subscription ---------------------------------------------------------
export function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export function getState(): EditorState {
  return state
}
export function useEditorState(): EditorState {
  return useSyncExternalStore(subscribe, getState)
}

// ---- active-scene helpers -------------------------------------------------
export function activeSceneDef(s: EditorState = state): SceneDef {
  return s.project.scenes.find((x) => x.id === s.activeSceneId) ?? s.project.scenes[0]
}
function mapActiveScene(fn: (sd: SceneDef) => SceneDef): void {
  set({ dirty: true, project: { ...state.project, scenes: state.project.scenes.map((s) => (s.id === state.activeSceneId ? fn(s) : s)) } })
}
function mapEl(id: string, fn: (e: SceneElement) => SceneElement): void {
  mapActiveScene((sd) => ({ ...sd, elements: sd.elements.map((e) => (e.id === id ? fn(e) : e)) }))
}

// ---- selection ------------------------------------------------------------
export function selectOnly(id: string | null): void {
  set({ selectedIds: id ? [id] : [] }, false)
}
export function setSelection(ids: string[]): void {
  set({ selectedIds: ids }, false)
}
export function toggleSelect(id: string): void {
  const has = state.selectedIds.includes(id)
  set({ selectedIds: has ? state.selectedIds.filter((x) => x !== id) : [...state.selectedIds, id] }, false)
}
export function clearSelection(): void {
  set({ selectedIds: [] }, false)
}
export function isSelected(id: string): boolean {
  return state.selectedIds.includes(id)
}
export function setOrientation(o: Orientation): void {
  set({ orientation: o }, false)
}

// Re-derive the active scene (e.g. after toggling variant/locale edit mode) so
// read-consumers pick up the change without a project mutation.
export function refreshScene(): void {
  set({}, false)
}

// Merge a patch into the active variant's overrides for one element (variant edit
// mode). Stored in project.meta.variants → part of undo history like any edit.
function mergeVariantPatch(vid: string, id: string, patch: Partial<SceneElement>): void {
  const variants = (state.project.meta.variants ?? []).map((v) => {
    if (v.id !== vid) return v
    const patches = [...v.patches]
    const i = patches.findIndex((p) => p.elementId === id)
    if (i >= 0) patches[i] = { elementId: id, patch: { ...patches[i].patch, ...patch } }
    else patches.push({ elementId: id, patch: { ...patch } })
    return { ...v, patches }
  })
  set({ dirty: true, project: { ...state.project, meta: { ...state.project.meta, variants } } })
}

// ---- element editing (active scene) ---------------------------------------
export function patchElement(id: string, patch: Partial<SceneElement>): void {
  const vid = getActiveVariant()
  if (vid) return mergeVariantPatch(vid, id, patch)
  mapEl(id, (e) => ({ ...e, ...patch }))
}
export function patchLandscape(id: string, patch: OrientationOverride): void {
  const vid = getActiveVariant()
  if (vid) {
    const cur = state.scene.elements.find((e) => e.id === id) // merged (base + variant)
    return mergeVariantPatch(vid, id, { landscape: { ...(cur?.landscape ?? {}), ...patch } })
  }
  mapEl(id, (e) => ({ ...e, landscape: { ...(e.landscape ?? {}), ...patch } }))
}
export function patchGeometry(id: string, patch: OrientationOverride): void {
  if (state.orientation === 'landscape') patchLandscape(id, patch)
  else patchElement(id, patch as Partial<SceneElement>)
}
export function addElement(el: SceneElement): void {
  set({ dirty: true, selectedIds: [el.id], project: { ...state.project, scenes: state.project.scenes.map((s) => (s.id === state.activeSceneId ? { ...s, elements: [...s.elements, el] } : s)) } })
}
export function addElements(els: SceneElement[]): void {
  set({ dirty: true, selectedIds: els.map((e) => e.id), project: { ...state.project, scenes: state.project.scenes.map((s) => (s.id === state.activeSceneId ? { ...s, elements: [...s.elements, ...els] } : s)) } })
}
export function removeElement(id: string): void {
  set({ dirty: true, selectedIds: state.selectedIds.filter((x) => x !== id) })
  mapActiveScene((sd) => ({ ...sd, elements: sd.elements.filter((e) => e.id !== id) }))
}
export function removeSelected(): void {
  const ids = new Set(state.selectedIds)
  if (!ids.size) return
  set({ selectedIds: [] }, false)
  mapActiveScene((sd) => ({ ...sd, elements: sd.elements.filter((e) => !ids.has(e.id)) }))
}
export function duplicateSelected(): void {
  const ids = new Set(state.selectedIds)
  if (!ids.size) return
  const els = activeSceneDef().elements
  const maxZ = Math.max(0, ...els.map((e) => e.zIndex))
  const clones: SceneElement[] = []
  let bump = 1
  for (const e of els) {
    if (!ids.has(e.id)) continue
    const c = structuredClone(e)
    c.id = nextId(e.type)
    c.name = e.name + ' copy'
    c.x = e.x + 30
    c.y = e.y + 30
    c.zIndex = maxZ + bump++
    clones.push(c)
  }
  addElements(clones)
}

function zRange(): { min: number; max: number } {
  const zs = activeSceneDef().elements.map((e) => e.zIndex)
  return { min: Math.min(0, ...zs), max: Math.max(0, ...zs) }
}
export function bringToFront(id: string): void {
  patchElement(id, { zIndex: zRange().max + 1 })
}
export function sendToBack(id: string): void {
  patchElement(id, { zIndex: zRange().min - 1 })
}
export function reorderLayers(frontToBack: string[]): void {
  const n = frontToBack.length
  const z = new Map(frontToBack.map((id, i) => [id, n - i]))
  mapActiveScene((sd) => ({ ...sd, elements: sd.elements.map((e) => ({ ...e, zIndex: z.get(e.id) ?? e.zIndex })) }))
}
export function toggleLock(id: string): void {
  mapEl(id, (e) => ({ ...e, locked: !e.locked }))
}

// ---- grouping -------------------------------------------------------------
export function groupSelected(): void {
  if (state.selectedIds.length < 2) return
  const gid = nextId('grp')
  const ids = new Set(state.selectedIds)
  mapActiveScene((sd) => ({ ...sd, elements: sd.elements.map((e) => (ids.has(e.id) ? { ...e, groupId: gid } : e)) }))
}
export function ungroupSelected(): void {
  const groups = new Set(activeSceneDef().elements.filter((e) => state.selectedIds.includes(e.id) && e.groupId).map((e) => e.groupId))
  if (!groups.size) return
  mapActiveScene((sd) => ({ ...sd, elements: sd.elements.map((e) => (e.groupId && groups.has(e.groupId) ? { ...e, groupId: undefined } : e)) }))
}
export function selectWithGroups(id: string, additive: boolean): void {
  const el = activeSceneDef().elements.find((e) => e.id === id)
  if (!el) return
  const ids = el.groupId ? activeSceneDef().elements.filter((e) => e.groupId === el.groupId).map((e) => e.id) : [id]
  if (additive) {
    const allIn = ids.every((i) => state.selectedIds.includes(i))
    set({ selectedIds: allIn ? state.selectedIds.filter((i) => !ids.includes(i)) : Array.from(new Set([...state.selectedIds, ...ids])) }, false)
  } else set({ selectedIds: ids }, false)
}

// ---- alignment ------------------------------------------------------------
type H = 'left' | 'center' | 'right'
type V = 'top' | 'center' | 'bottom'
const A_DECOMP: Record<string, [H, V]> = {
  center: ['center', 'center'], top: ['center', 'top'], bottom: ['center', 'bottom'],
  left: ['left', 'center'], right: ['right', 'center'],
  'top-left': ['left', 'top'], 'top-right': ['right', 'top'], 'bottom-left': ['left', 'bottom'], 'bottom-right': ['right', 'bottom'],
}
function recompose(h: H, v: V): SceneElement['anchor'] {
  if (h === 'center' && v === 'center') return 'center'
  if (h === 'center') return v as SceneElement['anchor']
  if (v === 'center') return h as SceneElement['anchor']
  return `${v}-${h}` as SceneElement['anchor']
}
export type AlignOp = 'left' | 'centerH' | 'right' | 'top' | 'middleV' | 'bottom'
export function alignSelected(op: AlignOp): void {
  const ids = new Set(state.selectedIds)
  if (!ids.size) return
  const m = state.project.meta
  mapActiveScene((sd) => ({
    ...sd,
    elements: sd.elements.map((e) => {
      if (!ids.has(e.id)) return e
      const [h, v] = A_DECOMP[e.anchor] ?? ['center', 'center']
      let { x, y } = e
      let anchor = e.anchor
      if (op === 'left') ((x = 0), (anchor = recompose('left', v)))
      else if (op === 'centerH') ((x = Math.round(m.baseW / 2)), (anchor = recompose('center', v)))
      else if (op === 'right') ((x = m.baseW), (anchor = recompose('right', v)))
      else if (op === 'top') ((y = 0), (anchor = recompose(h, 'top')))
      else if (op === 'middleV') ((y = Math.round(m.baseH / 2)), (anchor = recompose(h, 'center')))
      else ((y = m.baseH), (anchor = recompose(h, 'bottom')))
      return { ...e, x, y, anchor }
    }),
  }))
}

// ---- copy / paste style ---------------------------------------------------
let styleClip: { box?: SceneElement['box']; text?: SceneElement['text']; pulse?: string } | null = null
export function copyStyle(): void {
  const el = singleSelected(state)
  if (!el) return
  styleClip = { box: el.box, text: el.text, pulse: el.cta?.pulse }
}
export function hasStyleClip(): boolean {
  return !!styleClip
}
export function pasteStyle(): void {
  if (!styleClip) return
  const ids = new Set(state.selectedIds)
  if (!ids.size) return
  mapActiveScene((sd) => ({
    ...sd,
    elements: sd.elements.map((e) => {
      if (!ids.has(e.id)) return e
      const next: SceneElement = { ...e }
      if (styleClip!.box) next.box = { ...styleClip!.box }
      if (styleClip!.text && e.text) next.text = { ...e.text, ...styleClip!.text, value: e.text.value }
      if (styleClip!.pulse && e.cta) next.cta = { ...e.cta, pulse: styleClip!.pulse as never }
      return next
    }),
  }))
}

export function bulkPatch(patches: Record<string, Partial<SceneElement>>): void {
  const vid = getActiveVariant()
  if (vid) {
    for (const [id, p] of Object.entries(patches)) mergeVariantPatch(vid, id, p)
    return
  }
  mapActiveScene((sd) => ({ ...sd, elements: sd.elements.map((e) => (patches[e.id] ? { ...e, ...patches[e.id] } : e)) }))
}

export type ConvertTo = 'image' | 'bar' | 'rect' | 'cta' | 'background' | 'text' | 'handguide'
export function convertElement(id: string, to: ConvertTo): void {
  mapEl(id, (e) => {
    switch (to) {
      case 'handguide':
        return { ...e, type: 'handguide', mode: 'fit', handguide: e.handguide ?? { mode: 'smart' } }
      case 'background':
        return { ...e, type: 'background', mode: 'extend', anchor: 'center', zIndex: 0, background: { objectFit: e.background?.objectFit ?? 'cover' } }
      case 'bar':
        return { ...e, type: 'bar', mode: 'extend', anchor: e.anchor === 'bottom' ? 'bottom' : 'top', bar: e.bar ?? (e.assetId ? {} : { color: '#1b2a4a' }) }
      case 'rect':
        return { ...e, type: 'bar', mode: 'fit', bar: e.bar ?? { color: '#3a7bd5' }, w: e.w ?? 600, h: e.h ?? 360 }
      case 'cta':
        return { ...e, type: 'cta', mode: 'fit', cta: e.cta ?? { pulse: 'medium' }, w: e.w ?? 560, h: e.h ?? 150, text: e.assetId ? e.text : e.text ?? { value: 'PLAY NOW', fontSizePx: 64, fontWeight: 800, color: '#ffffff' }, box: e.assetId ? e.box : e.box ?? { bgColor: '#16a34a', radiusPx: 75 } }
      case 'text':
        return { ...e, type: 'text', mode: 'fit', text: e.text ?? { value: 'Text', fontSizePx: 64, fontWeight: 700, color: '#ffffff', align: 'center' } }
      default:
        return { ...e, type: 'image', mode: 'fit' }
    }
  })
}

// ---- project / scene meta -------------------------------------------------
export function patchMeta(patch: Partial<ProjectMeta>): void {
  set({ dirty: true, project: { ...state.project, meta: { ...state.project.meta, ...patch } } })
}

// ---- variants (export-time overrides of the same MIP) ---------------------
function setVariants(variants: Variant[]): void {
  set({ dirty: true, project: { ...state.project, meta: { ...state.project.meta, variants } } })
}
export function listVariants(): Variant[] {
  return state.project.meta.variants ?? []
}
export function addVariant(name: string): string {
  const id = nextId('var')
  setVariants([...(state.project.meta.variants ?? []), { id, name: name.trim() || `Variant ${(state.project.meta.variants?.length ?? 0) + 1}`, patches: [] }])
  return id
}
export function renameVariant(id: string, name: string): void {
  setVariants((state.project.meta.variants ?? []).map((v) => (v.id === id ? { ...v, name } : v)))
}
export function removeVariant(id: string): void {
  setVariants((state.project.meta.variants ?? []).filter((v) => v.id !== id))
}
/** Drop a single element's override in a variant (reset it to the base). */
export function resetVariantElement(vid: string, elementId: string): void {
  setVariants((state.project.meta.variants ?? []).map((v) => (v.id === vid ? { ...v, patches: v.patches.filter((p) => p.elementId !== elementId) } : v)))
}
export function setSceneBg(color: string | undefined): void {
  mapActiveScene((sd) => ({ ...sd, bgColor: color }))
}
export function addAsset(id: string, entry: AssetEntry): void {
  set({ dirty: true, assets: { ...state.assets, [id]: entry } })
}

// ---- audio: project-level event→sound map + background music ---------------
export function setSfxBinding(event: string, assetId: string | undefined, volume?: number): void {
  const rest = (state.project.sfx ?? []).filter((b) => b.event !== event)
  const sfx = assetId ? [...rest, { event, assetId, volume }] : rest
  set({ dirty: true, project: { ...state.project, sfx } })
}
export function setBgm(assetId: string | undefined, volume?: number): void {
  const bgm = assetId ? { assetId, volume: volume ?? state.project.bgm?.volume ?? 0.5 } : undefined
  set({ dirty: true, project: { ...state.project, bgm } })
}

// ---- trace-over backdrop (editor only) ------------------------------------
export function setTrace(patch: Partial<TraceState>): void {
  set({ dirty: true, trace: { ...state.trace, ...patch } })
}

// ---- scenes ---------------------------------------------------------------
export function setActiveScene(id: string): void {
  set({ activeSceneId: id, selectedIds: [] }, false)
}
export function setStartScene(id: string): void {
  set({ dirty: true, project: { ...state.project, startSceneId: id } })
}
export function patchSceneDef(id: string, patch: Partial<SceneDef>): void {
  set({ dirty: true, project: { ...state.project, scenes: state.project.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) } })
}
export function reorderScenes(ids: string[]): void {
  const byId = new Map(state.project.scenes.map((s) => [s.id, s]))
  const scenes = ids.map((id) => byId.get(id)!).filter(Boolean)
  set({ dirty: true, project: { ...state.project, scenes } })
}
export function removeScene(id: string): void {
  if (state.project.scenes.length <= 1) return
  const scenes = state.project.scenes.filter((s) => s.id !== id)
  const startSceneId = state.project.startSceneId === id ? scenes[0].id : state.project.startSceneId
  const activeSceneId = state.activeSceneId === id ? scenes[0].id : state.activeSceneId
  set({ dirty: true, activeSceneId, selectedIds: [], project: { ...state.project, scenes, startSceneId } })
}

function center(): { x: number; y: number } {
  const m = state.project.meta
  return { x: Math.round(m.baseW / 2), y: Math.round(m.baseH / 2) }
}
function templateElements(kind: SceneDef['kind']): SceneElement[] {
  const c = center()
  const m = state.project.meta
  if (kind === 'win') {
    return [
      { id: nextId('dim'), type: 'dim', name: 'Dim', x: c.x, y: c.y, anchor: 'center', zIndex: 50, mode: 'fit', dim: { color: '#0a1024', alpha: 0.72, blocksInput: false } },
      { id: nextId('text'), type: 'text', name: 'Congrats', x: c.x, y: Math.round(m.baseH * 0.42), anchor: 'center', zIndex: 51, mode: 'fit', text: { value: 'You won!', fontSizePx: 130, fontWeight: 800, color: '#ffffff', align: 'center' } },
    ]
  }
  if (kind === 'endscene') {
    return [
      { id: nextId('end'), type: 'endscene', name: 'Endscene video', x: c.x, y: c.y, w: m.baseW, h: m.baseH, anchor: 'center', zIndex: 1, mode: 'extend', endscene: { objectFit: 'cover', bgColor: '#000000', loop: true, matchBgEdge: false, muteUntilInteraction: true } },
      { id: nextId('text'), type: 'text', name: 'Endscene title', x: c.x, y: Math.round(m.baseH * 0.3), anchor: 'center', zIndex: 11, mode: 'fit', text: { value: 'Get the app!', fontSizePx: 120, fontWeight: 800, color: '#ffffff', align: 'center' } },
      { id: nextId('cta'), type: 'cta', name: 'CTA button', x: c.x, y: Math.round(m.baseH * 0.6), anchor: 'center', zIndex: 20, mode: 'fit', w: 600, h: 160, cta: { pulse: 'medium' }, text: { value: 'PLAY NOW', fontSizePx: 66, fontWeight: 800, color: '#ffffff' }, box: { bgColor: '#16a34a', radiusPx: 80 } },
    ]
  }
  return []
}
export function addScene(kind: SceneDef['kind'] = 'custom'): void {
  const id = nextId('scene')
  const labels: Record<string, string> = { game: 'Game', win: 'Win', endscene: 'Endscene', custom: 'Scene' }
  const advance: SceneDef['advance'] = kind === 'game' ? { on: 'gameWin' } : kind === 'win' ? { on: 'timer', delayMs: 1500 } : kind === 'endscene' ? { on: 'manual' } : { on: 'tap' }
  const sd: SceneDef = {
    id,
    name: `${labels[kind ?? 'custom']} ${state.project.scenes.length + 1}`,
    kind,
    elements: templateElements(kind),
    advance,
    transition: { type: 'fade', durationMs: 350 },
  }
  set({ dirty: true, activeSceneId: id, selectedIds: [], project: { ...state.project, scenes: [...state.project.scenes, sd] } })
}
export function duplicateScene(id: string): void {
  const sd = state.project.scenes.find((s) => s.id === id)
  if (!sd) return
  const copy: SceneDef = structuredClone(sd)
  copy.id = nextId('scene')
  copy.name = sd.name + ' copy'
  copy.elements = copy.elements.map((e) => ({ ...e, id: nextId(e.type) }))
  const i = state.project.scenes.findIndex((s) => s.id === id)
  const scenes = [...state.project.scenes]
  scenes.splice(i + 1, 0, copy)
  set({ dirty: true, activeSceneId: copy.id, selectedIds: [], project: { ...state.project, scenes } })
}

/** Append several prebuilt scenes at once (quiz funnel generator) and merge any
 * assets. Selects the first new scene; sets it as the start scene if the project
 * was empty. */
export function addScenes(defs: SceneDef[], assets: AssetMap = {}): void {
  if (!defs.length) return
  const hadScenes = state.project.scenes.length > 0
  const scenes = [...state.project.scenes, ...defs]
  const startSceneId = hadScenes ? state.project.startSceneId : defs[0].id
  set({
    dirty: true,
    activeSceneId: defs[0].id,
    selectedIds: [],
    assets: { ...state.assets, ...assets },
    project: { ...state.project, scenes, startSceneId },
  })
}

/** Append an imported frame as a NEW scene and merge its assets (Figma). */
export function addImportedScene(name: string, bgColor: string | undefined, elements: SceneElement[], assets: AssetMap): void {
  const id = nextId('scene')
  const sd: SceneDef = { id, name, kind: 'custom', bgColor, elements, advance: { on: 'tap' }, transition: { type: 'fade', durationMs: 350 } }
  set({ dirty: true, activeSceneId: id, selectedIds: [], assets: { ...state.assets, ...assets }, project: { ...state.project, scenes: [...state.project.scenes, sd] } })
}

// ---- load / save ----------------------------------------------------------
export function loadProject(project: Project, assets: AssetMap, path: string | null, trace?: TraceState): void {
  past.length = 0
  future.length = 0
  const activeSceneId = project.startSceneId && project.scenes.some((s) => s.id === project.startSceneId) ? project.startSceneId : project.scenes[0]?.id
  state = {
    project,
    activeSceneId,
    scene: deriveScene(project, activeSceneId),
    assets,
    selectedIds: [],
    orientation: 'portrait',
    trace: trace ?? defaultTrace(),
    dirty: false,
    projectPath: path,
    canUndo: false,
    canRedo: false,
  }
  emit()
}
export function markSaved(path: string | null): void {
  set({ dirty: false, projectPath: path ?? state.projectPath }, false)
}

// ---- selectors ------------------------------------------------------------
export function selectedElements(s: EditorState): SceneElement[] {
  const ids = new Set(s.selectedIds)
  return s.scene.elements.filter((e) => ids.has(e.id))
}
export function singleSelected(s: EditorState): SceneElement | null {
  return s.selectedIds.length === 1 ? s.scene.elements.find((e) => e.id === s.selectedIds[0]) ?? null : null
}
