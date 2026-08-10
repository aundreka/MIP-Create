// Editor state store. A project is an ordered list of scenes; the editor edits
// one active scene at a time. A derived `scene` (the active scene as a render
// unit) is kept in state so existing read-consumers keep working unchanged;
// element mutations operate on the active scene.

import { useSyncExternalStore } from 'react'
import type { OrientationOverride, Project, ProjectMeta, Scene, SceneDef, SceneElement, Variant } from '../runtime/scene'
import type { AssetEntry, AssetMap, CompressProfile } from '../runtime/types'
import { getActiveVariant } from './variantMode'
import { applyVariantPatches } from './variants'
import { migrateProject } from './migrate'
import { GAME_TEMPLATES } from '../runtime/games/registry'
import { sfxPreviewUrl } from './sfxLibrary'
import { deleteSharedElement, ensureGroupByName, putSharedElement } from './projectGroups'
import { syncMipName } from './mipName'
import { getEditLocale, subscribeEditLocale } from './locale'
import { localizeElement, localizeHeader, localizeSceneDef } from '../runtime/i18n'

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
    defaultLocale: 'en',
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
  const base = project.scenes.find((s) => s.id === activeSceneId) ?? project.scenes[0]
  const sd = base ? localizeSceneDef(base, getEditLocale()) : undefined
  let elements = sd?.elements ?? []
  // when editing a variant, the canvas/inspector show base + that variant's overrides
  const vid = getActiveVariant()
  if (vid) {
    const v = project.meta.variants?.find((x) => x.id === vid)
    if (v) elements = applyVariantPatches(elements, v.patches)
  }
  return {
    meta: {
      ...project.meta,
      header: localizeHeader(project.meta, getEditLocale()),
      // undefined = not set, fall back to project default; '' = explicitly transparent
      bgMatchColor: sd?.bgColor !== undefined ? sd.bgColor : project.meta.bgMatchColor,
      bgMatchColor2: sd?.bgColor2 !== undefined ? sd.bgColor2 : project.meta.bgMatchColor2,
    },
    elements,
    kind: sd?.kind,
    overlay: sd?.overlay,
  }
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

// Locale selection lives outside undo history, but a whole-scene translation
// changes the derived render scene. Keep that view fresh immediately when the
// language picker changes.
subscribeEditLocale(() => {
  state = { ...state, scene: deriveScene(state.project, state.activeSceneId) }
  emit()
})

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
  // Snapshot on project OR asset changes so adding/compressing an asset is undoable
  // (snapshots share the immutable assets map by reference — cheap, and restore
  // swaps the whole map back).
  if (recordHistory && (partial.project || partial.assets)) pushSnap(false)
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
  const locale = getEditLocale()
  set({ dirty: true, project: { ...state.project, scenes: state.project.scenes.map((s) => {
    if (s.id !== state.activeSceneId) return s
    const localized = locale ? s.localeOverrides?.[locale]?.source : undefined
    if (!locale || !localized) return fn(s)
    const edited = fn(localized)
    return {
      ...s,
      localeOverrides: {
        ...s.localeOverrides,
        [locale]: { source: { ...edited, id: s.id, advance: s.advance, transition: s.transition, localeOverrides: undefined } },
      },
    }
  }) } })
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
  const el = activeSceneDef().elements.find((e) => e.id === id)
  // A synced element mirrors one shared definition — apply the edit to every copy
  // across all scenes and update the group registry. (`sync`-changing patches route
  // through the dedicated sync fns, so they skip this and edit the element directly.)
  if (el?.sync && !('sync' in patch)) return patchSynced(el.sync.key, patch)
  mapEl(id, (e) => ({ ...e, ...patch }))
}
export function patchLandscape(id: string, patch: OrientationOverride): void {
  const vid = getActiveVariant()
  if (vid) {
    const cur = state.scene.elements.find((e) => e.id === id) // merged (base + variant)
    return mergeVariantPatch(vid, id, { landscape: { ...(cur?.landscape ?? {}), ...patch } })
  }
  const el = activeSceneDef().elements.find((e) => e.id === id)
  if (el?.sync) {
    const key = el.sync.key
    const scenes = state.project.scenes.map((sd) => ({ ...sd, elements: sd.elements.map((e) => (e.sync?.key === key ? { ...e, landscape: { ...(e.landscape ?? {}), ...patch } } : e)) }))
    set({ dirty: true, project: { ...state.project, scenes } })
    return pushSharedForKey(key)
  }
  mapEl(id, (e) => ({ ...e, landscape: { ...(e.landscape ?? {}), ...patch } }))
}

/** Patch one language's optional asset/layout layer; absent fields inherit default. */
export function patchLocaleOverride(id: string, locale: string, patch: Partial<NonNullable<SceneElement['localeOverrides']>[string]>): void {
  const el = state.scene.elements.find((e) => e.id === id)
  if (!el) return
  const current = el.localeOverrides?.[locale] ?? {}
  patchElement(id, { localeOverrides: { ...(el.localeOverrides ?? {}), [locale]: { ...current, ...patch } } })
}

export function setLocaleAsset(id: string, locale: string, assetId: string | undefined): void {
  const el = state.scene.elements.find((e) => e.id === id)
  if (!el) return
  const overrides = { ...(el.localeOverrides ?? {}) }
  const current = { ...(overrides[locale] ?? {}) }
  if (assetId) current.assetId = assetId
  else delete current.assetId
  if (Object.keys(current).length) overrides[locale] = current
  else delete overrides[locale]
  patchElement(id, { localeOverrides: Object.keys(overrides).length ? overrides : undefined })
}

export function resetLocaleOverride(id: string, locale: string): void {
  const el = state.scene.elements.find((e) => e.id === id)
  if (!el?.localeOverrides?.[locale]) return
  const overrides = { ...el.localeOverrides }
  delete overrides[locale]
  patchElement(id, { localeOverrides: Object.keys(overrides).length ? overrides : undefined })
}

export function resetLocaleLayout(id: string, locale: string, orientation: Orientation): void {
  const el = state.scene.elements.find((e) => e.id === id)
  if (!el) return
  const overrides = { ...(el.localeOverrides ?? {}) }
  const current = { ...(overrides[locale] ?? {}) }
  delete current[orientation]
  if (Object.keys(current).length) overrides[locale] = current
  else delete overrides[locale]
  patchElement(id, { localeOverrides: Object.keys(overrides).length ? overrides : undefined })
}

export function patchGeometry(id: string, patch: OrientationOverride): void {
  const locale = getEditLocale()
  const wholeSceneLocale = locale && activeSceneDef().localeOverrides?.[locale]?.source
  if (wholeSceneLocale) {
    if (state.orientation === 'landscape') patchLandscape(id, patch)
    else patchElement(id, patch as Partial<SceneElement>)
  } else if (locale) {
    const el = state.scene.elements.find((e) => e.id === id)
    if (!el) return
    const current = el.localeOverrides?.[locale] ?? {}
    const key: Orientation = state.orientation
    patchLocaleOverride(id, locale, { [key]: { ...(current[key] ?? {}), ...patch } })
  } else if (state.orientation === 'landscape') patchLandscape(id, patch)
  else patchElement(id, patch as Partial<SceneElement>)
}
export function addElement(el: SceneElement): void {
  set({ dirty: true, selectedIds: [el.id], project: { ...state.project, scenes: state.project.scenes.map((s) => (s.id === state.activeSceneId ? { ...s, elements: [...s.elements, el] } : s)) } })
}
// Built-in hand image (data-URI SVG) for auto-created hint handguides; shared by a
// stable id so it's deduped and inlined once on export. Mirrors the runtime's hand.
const HAND_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="46" height="56" viewBox="0 0 46 56">' +
  '<g fill="#ffffff" stroke="#0b1220" stroke-width="1.5" stroke-linejoin="round">' +
  '<path d="M16 3c2.8 0 5 2.2 5 5v16l3-1.5c2-1 4.6-.3 5.7 1.7l.2.4 6.2 3.2c2.6 1.3 3.9 4.3 3.1 7.1l-2.4 8.6c-1 3.6-4.3 6.1-8 6.1H22c-2.8 0-5.4-1.3-7.1-3.5L5.6 35.4c-1.5-2-1.1-4.8.9-6.3 1.7-1.3 4-1.2 5.6.1l2.9 2.4V8c0-2.8 2.2-5 5-5z"/>' +
  '</g></svg>'
const HAND_ASSET_ID = 'builtin_hand'
const HAND_DATA_URI = 'data:image/svg+xml,' + encodeURIComponent(HAND_SVG)

// Seed an editable handguide ("hint hand") for a game-mount: a hand image on a route
// derived from the template's defaultHandguide (normalized to the game card), or a
// centered tap if the template has none. The runtime suppresses the non-editable coded
// hint whenever a handguide is present, so there's exactly one (editable) hand.
export function addGameHint(gameId: string): void {
  const scene = state.project.scenes.find((s) => s.id === state.activeSceneId)
  const game = scene?.elements.find((e) => e.id === gameId)
  if (!game || game.type !== 'game-mount') return
  if (!state.assets[HAND_ASSET_ID]) addAsset(HAND_ASSET_ID, { src: HAND_DATA_URI, w: 46, h: 56 })
  const tpl = GAME_TEMPLATES.find((t) => t.id === game.game?.templateId)
  const gw = game.w ?? Math.round(state.project.meta.baseW * 0.9)
  const gh = game.h ?? Math.round(state.project.meta.baseH * 0.5)
  const left = game.x - gw / 2 // game-mount elements are center-anchored
  const top = game.y - gh / 2
  const norm = tpl?.defaultHandguide?.nodes ?? [{ x: 0.5, y: 0.5 }]
  const pts = norm.map((n) => ({ x: Math.round(left + n.x * gw), y: Math.round(top + n.y * gh), pauseMs: n.pauseMs }))
  const handW = Math.round(Math.max(60, Math.min(140, gw * 0.16)))
  const hg: SceneElement = {
    id: nextId('hint'),
    type: 'handguide',
    name: 'Hint hand',
    x: pts[0].x,
    y: pts[0].y,
    w: handW,
    h: Math.round(handW * (56 / 46)),
    anchor: 'center',
    zIndex: (game.zIndex ?? 0) + 1,
    mode: 'fit',
    assetId: HAND_ASSET_ID,
    handguide:
      tpl?.defaultHandguide?.mode // game-aware logic template (e.g. 'match' follows the game's next card)
        ? { mode: tpl.defaultHandguide.mode, periodMs: tpl.defaultHandguide.periodMs ?? 900 }
        : pts.length > 1
          ? { mode: 'slide', nodes: pts.slice(1), periodMs: tpl?.defaultHandguide?.periodMs ?? 1800 }
          : { mode: 'tap', periodMs: 900 },
  }
  addElement(hg)
}

// ---- per-scene landscape layout -------------------------------------------
// Landscape geometry lives per element in `el.landscape` (OrientationOverride) and
// falls back to the portrait value PER FIELD — so until a field is touched, a
// portrait edit silently moves landscape too. "Seeding" snapshots the current
// portrait geometry into a FULL landscape override for every element in the active
// scene, decoupling the two layouts: same assets + animations, but from then on
// each orientation is positioned/scaled independently. Fields an element already
// overrode keep their landscape value; w/h stay unset when portrait auto-sizes.
// Writes the BASE scene elements directly (one set, one undo step) — NOT via
// patchElement, which reroutes into variant patches while a variant is being
// edited (the seed would then never reach the base elements, the canvas banner's
// override count would stay 0, and the button would appear to do nothing).
// Like scene settings, the landscape layout is base-only.
export function seedLandscapeLayout(): void {
  if (!activeSceneDef().elements.length) return
  beginTransaction()
  mapActiveScene((s) => ({
    ...s,
    elements: s.elements.map((e) => {
      const seed: OrientationOverride = { x: e.x, y: e.y, scale: e.scale ?? 1, anchor: e.anchor, mode: e.mode, zIndex: e.zIndex }
      if (e.w != null) seed.w = e.w
      if (e.h != null) seed.h = e.h
      if (e.hidden != null) seed.hidden = e.hidden
      return { ...e, landscape: { ...seed, ...(e.landscape ?? {}) } }
    }),
  }))
  endTransaction()
}

// Drop every landscape override in the active scene — landscape follows portrait again.
export function clearLandscapeLayout(): void {
  if (!activeSceneDef().elements.some((e) => e.landscape)) return
  beginTransaction()
  mapActiveScene((s) => ({ ...s, elements: s.elements.map((e) => (e.landscape ? { ...e, landscape: undefined } : e)) }))
  endTransaction()
}

// Reuse elements from another scene: plain copies (fresh ids) added to the ACTIVE
// scene. Copies keep the source's geometry/asset/config but are fully independent —
// so each scene can carry its own animations/tweaks. They reference the same asset
// ids (every asset is inlined once on export), so reuse never duplicates image data.
// `sync` is stripped: the cross-MIP sync invariant is one copy per scene/MIP, which
// a manual second copy would silently break; groupId is remapped like duplicate.
export function copyElementsFromScene(fromSceneId: string, elementIds: string[]): void {
  if (fromSceneId === state.activeSceneId) return
  const from = state.project.scenes.find((s) => s.id === fromSceneId)
  if (!from) return
  const wanted = new Set(elementIds)
  const gmap = new Map<string, string>()
  const clones: SceneElement[] = []
  for (const e of from.elements) {
    if (!wanted.has(e.id)) continue
    const c = structuredClone(e)
    c.id = nextId(e.type)
    delete c.sync
    if (c.groupId) {
      if (!gmap.has(c.groupId)) gmap.set(c.groupId, nextId('grp'))
      c.groupId = gmap.get(c.groupId)
    }
    clones.push(c)
  }
  if (clones.length) addElements(clones)
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

// ---- element clipboard (copy/paste & move across scenes) ------------------
// Asset ids one element references (so a cross-scene paste survives even if the
// source asset is later deleted). Mirrors export's pruneAssets walk.
function elementAssetIds(el: SceneElement): string[] {
  const ids: (string | undefined)[] = [el.assetId, el.container?.imageId, el.generate?.resultId, el.button?.tapFadeAssetId]
  if (el.sfx) for (const b of el.sfx) ids.push(b.assetId)
  if (el.game?.params) for (const v of Object.values(el.game.params)) (Array.isArray(v) ? ids.push(...(v as string[])) : ids.push(v as string))
  if (el.endscene) ids.push(el.endscene.portraitVideoId, el.endscene.landscapeVideoId, el.endscene.portraitImageId, el.endscene.landscapeImageId)
  return ids.filter((x): x is string => typeof x === 'string')
}
// In-memory clipboard (NOT the OS clipboard; persists across scene switches).
let elClip: { els: SceneElement[]; assets: AssetMap } | null = null
export function hasElementClip(): boolean {
  return !!elClip && elClip.els.length > 0
}
export function copySelected(): void {
  const ids = new Set(state.selectedIds)
  if (!ids.size) return
  const els = activeSceneDef().elements.filter((e) => ids.has(e.id)).map((e) => structuredClone(e))
  const assets: AssetMap = {}
  for (const e of els) for (const aid of elementAssetIds(e)) if (state.assets[aid]) assets[aid] = state.assets[aid]
  elClip = { els, assets }
}
/** Paste the clipboard into the active scene (offset, new ids, on top). */
export function pasteElements(): void {
  if (!elClip || !elClip.els.length) return
  const missing: AssetMap = {}
  for (const [aid, a] of Object.entries(elClip.assets)) if (!state.assets[aid]) missing[aid] = a
  const maxZ = Math.max(0, ...activeSceneDef().elements.map((e) => e.zIndex))
  const gmap = new Map<string, string>() // preserve grouping with fresh group ids
  let bump = 1
  const clones = elClip.els.map((e) => {
    const c = structuredClone(e)
    c.id = nextId(e.type)
    c.x = e.x + 20
    c.y = e.y + 20
    c.zIndex = maxZ + bump++
    if (c.groupId) {
      if (!gmap.has(c.groupId)) gmap.set(c.groupId, nextId('grp'))
      c.groupId = gmap.get(c.groupId)
    }
    return c
  })
  if (Object.keys(missing).length) set({ assets: { ...state.assets, ...missing } }, false)
  addElements(clones) // sets selection + dirty + history
}
/** Move the current selection out of the active scene into another scene. */
// Move the current selection into another scene. `place` (optional, design coords
// keyed by element id) repositions each moved element — used by cross-scene drag so
// elements land under the cursor in the target frame; the right-click "Move to scene"
// menu omits it and keeps each element's existing position.
export function moveSelectedToScene(sceneId: string, place?: Record<string, { x: number; y: number }>): void {
  const ids = new Set(state.selectedIds)
  if (!ids.size || sceneId === state.activeSceneId) return
  const target = state.project.scenes.find((s) => s.id === sceneId)
  if (!target) return
  const moving = activeSceneDef().elements.filter((e) => ids.has(e.id))
  if (!moving.length) return
  const landscape = state.orientation === 'landscape'
  const maxZ = Math.max(0, ...target.elements.map((e) => e.zIndex))
  const placed = moving.map((e, i) => {
    const c: SceneElement = { ...structuredClone(e), zIndex: maxZ + 1 + i }
    const p = place?.[e.id]
    // Write the drop position to the active orientation's coords (landscape keeps its
    // own override so the portrait layout is untouched, and vice-versa).
    if (p) {
      if (landscape) c.landscape = { ...c.landscape, x: Math.round(p.x), y: Math.round(p.y) }
      else { c.x = Math.round(p.x); c.y = Math.round(p.y) }
    }
    return c
  })
  const scenes = state.project.scenes.map((s) => {
    if (s.id === state.activeSceneId) return { ...s, elements: s.elements.filter((e) => !ids.has(e.id)) }
    if (s.id === sceneId) return { ...s, elements: [...s.elements, ...placed] }
    return s
  })
  set({ dirty: true, project: { ...state.project, scenes }, activeSceneId: sceneId, selectedIds: placed.map((e) => e.id) })
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
  if (getActiveVariant()) return // lock is a base-only authoring aid (disabled in variant mode)
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
  const ids = state.selectedIds
  if (!ids.length) return
  const m = state.project.meta
  // Route each write through patchGeometry so alignment lands in the right place:
  // a variant override in variant edit-mode, the LANDSCAPE override in landscape
  // orientation (aligning there must never move the portrait layout), else the base.
  const landscape = state.orientation === 'landscape'
  beginTransaction()
  for (const id of ids) {
    const e = state.scene.elements.find((x) => x.id === id)
    if (!e) continue
    const localized = localizeElement(e, getEditLocale())
    const ov = landscape ? localized.landscape ?? {} : {}
    const [h, v] = A_DECOMP[ov.anchor ?? localized.anchor] ?? ['center', 'center']
    let x = ov.x ?? localized.x
    let y = ov.y ?? localized.y
    let anchor = ov.anchor ?? localized.anchor
    if (op === 'left') ((x = 0), (anchor = recompose('left', v)))
    else if (op === 'centerH') ((x = Math.round(m.baseW / 2)), (anchor = recompose('center', v)))
    else if (op === 'right') ((x = m.baseW), (anchor = recompose('right', v)))
    else if (op === 'top') ((y = 0), (anchor = recompose(h, 'top')))
    else if (op === 'middleV') ((y = Math.round(m.baseH / 2)), (anchor = recompose(h, 'center')))
    else ((y = m.baseH), (anchor = recompose(h, 'bottom')))
    patchGeometry(id, { x, y, anchor })
  }
  endTransaction()
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
  // Fan a patch on a synced element out to its copies on other scenes too.
  const byKey = new Map<string, Partial<SceneElement>>()
  for (const e of activeSceneDef().elements) if (patches[e.id] && e.sync) byKey.set(e.sync.key, patches[e.id])
  if (!byKey.size) return mapActiveScene((sd) => ({ ...sd, elements: sd.elements.map((e) => (patches[e.id] ? { ...e, ...patches[e.id] } : e)) }))
  const scenes = state.project.scenes.map((sd) => ({
    ...sd,
    elements: sd.elements.map((e) => (patches[e.id] ? { ...e, ...patches[e.id] } : e.sync && byKey.has(e.sync.key) ? { ...e, ...byKey.get(e.sync.key)! } : e)),
  }))
  set({ dirty: true, project: { ...state.project, scenes } })
  for (const key of byKey.keys()) pushSharedForKey(key)
}

// ---- "Sync to project" — an element shared across every MIP in the group ------
// A synced element carries a `sync.key`; all elements with the same key (across
// scenes and across MIPs) mirror one canonical definition in the group registry
// (src/projectGroups.ts). Editing any copy propagates to the others in the open MIP
// and writes the registry; opening another MIP reconciles its copies (projects.ts).

// Write the current props of a synced key to the group registry (async IDB flush).
function pushSharedForKey(key: string): void {
  const gid = state.project.meta.projectId
  if (!gid) return
  for (const sd of state.project.scenes) {
    const e = sd.elements.find((x) => x.sync?.key === key)
    if (e) return void putSharedElement(gid, e, state.assets)
  }
}

// Apply a patch to every copy of a synced key across all scenes, then push.
function patchSynced(key: string, patch: Partial<SceneElement>): void {
  const scenes = state.project.scenes.map((sd) => ({ ...sd, elements: sd.elements.map((e) => (e.sync?.key === key ? { ...e, ...patch } : e)) }))
  set({ dirty: true, project: { ...state.project, scenes } })
  pushSharedForKey(key)
}

/** Push every synced element in the open MIP to the group registry (save backstop). */
export function flushSharedToRegistry(): void {
  if (!state.project.meta.projectId) return
  const keys = new Set<string>()
  for (const sd of state.project.scenes) for (const e of sd.elements) if (e.sync) keys.add(e.sync.key)
  for (const key of keys) pushSharedForKey(key)
}

/** Is the element (or any selected one) syncable — i.e. this MIP is in a project? */
export function projectGroupId(): string | undefined {
  return state.project.meta.projectId
}

/** Toggle project-sync on an element. On → assigns a shared key (scope 'scene').
 * Off → stops sharing (see unsyncElement). No-op in variant mode. */
export function toggleSyncToProject(id: string): void {
  if (getActiveVariant()) return
  const el = activeSceneDef().elements.find((e) => e.id === id)
  if (!el) return
  if (el.sync) return unsyncElement(id)
  if (!state.project.meta.projectId) {
    alert('Assign this MIP to a project first. Open Project settings and set the “Project” field.')
    return
  }
  const key = nextId('sync')
  mapEl(id, (e) => ({ ...e, sync: { key, scope: 'scene' } }))
  pushSharedForKey(key)
}

/** Change where a synced element shows: 'scene' (one copy per MIP) or 'all'
 * (a copy on every scene — a persistent overlay). */
export function setSyncScope(id: string, scope: 'scene' | 'all'): void {
  const el = activeSceneDef().elements.find((e) => e.id === id)
  if (!el?.sync) return
  const key = el.sync.key
  let scenes = state.project.scenes.map((sd) => ({ ...sd, elements: sd.elements.map((e) => (e.sync?.key === key ? { ...e, sync: { key, scope } } : e)) }))
  if (scope === 'all') {
    const canon = { ...el } as Partial<SceneElement>
    delete canon.id
    scenes = scenes.map((sd) =>
      sd.elements.some((e) => e.sync?.key === key)
        ? sd
        : { ...sd, elements: [...sd.elements, { ...canon, id: `sync_${key}_${sd.id}`, sync: { key, scope: 'all' } } as SceneElement] },
    )
  } else {
    let kept = false
    scenes = scenes.map((sd) => ({
      ...sd,
      elements: sd.elements.filter((e) => {
        if (e.sync?.key !== key) return true
        if (kept) return false
        kept = true
        return true
      }),
    }))
  }
  const selectedIds = state.selectedIds.filter((sid) => scenes.some((sd) => sd.elements.some((e) => e.id === sid)))
  set({ dirty: true, selectedIds, project: { ...state.project, scenes } })
  pushSharedForKey(key)
}

/** Stop sharing: remove the shared element from the group registry and drop the
 * sync marker from its copies in this MIP (they remain as ordinary elements). */
export function unsyncElement(id: string): void {
  const el = activeSceneDef().elements.find((e) => e.id === id)
  if (!el?.sync) return
  const key = el.sync.key
  const gid = state.project.meta.projectId
  const scenes = state.project.scenes.map((sd) => ({
    ...sd,
    elements: sd.elements.map((e) => {
      if (e.sync?.key !== key) return e
      const c = { ...e }
      delete c.sync
      return c
    }),
  }))
  set({ dirty: true, project: { ...state.project, scenes } })
  if (gid) deleteSharedElement(gid, key)
}

export type ConvertTo = 'image' | 'bar' | 'rect' | 'cta' | 'background' | 'text' | 'handguide'
export function convertElement(id: string, to: ConvertTo): void {
  if (getActiveVariant()) return // changing element type is structural — disabled in variant mode
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
      case 'cta': {
        let ctaW = e.w
        let ctaH = e.h
        if ((ctaW == null || ctaH == null) && e.assetId) {
          const a = state.assets[e.assetId]
          if (a) {
            const sc = e.scale ?? 1
            ctaW = ctaW ?? Math.round(a.w * sc)
            ctaH = ctaH ?? Math.round(a.h * sc)
          }
        }
        return { ...e, type: 'cta', mode: 'fit', cta: e.cta ?? { pulse: 'medium' }, w: ctaW ?? 560, h: ctaH ?? 150, text: e.assetId ? e.text : e.text ?? { value: 'PLAY NOW', fontSizePx: 64, fontWeight: 800, color: '#ffffff' }, box: e.assetId ? e.box : e.box ?? { bgColor: '#16a34a', radiusPx: 75 } }
      }
      case 'text':
        return { ...e, type: 'text', mode: 'fit', text: e.text ?? { value: 'Text', fontSizePx: 64, fontWeight: 700, color: '#ffffff', align: 'center' } }
      default:
        return { ...e, type: 'image', mode: 'fit' }
    }
  })
}

// ---- project / scene meta -------------------------------------------------
export function patchMeta(patch: Partial<ProjectMeta>): void {
  // Keep meta.name canonical ("<Client> <MIP> <Date>") after every edit so the
  // topbar, Home, team library, and JSON download all agree.
  const meta = syncMipName({ ...state.project.meta, ...patch })
  set({ dirty: true, project: { ...state.project, meta } })
}

/**
 * Assign this MIP to a project group by name — typing an existing project name
 * joins that project; a new name starts a new one. An empty name detaches the MIP.
 * Stores the stable group id + display name on the meta so Home/switcher can group.
 */
export function assignProjectGroup(name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return patchMeta({ projectId: undefined, projectName: undefined })
  const g = ensureGroupByName(trimmed)
  patchMeta({ projectId: g.id, projectName: g.name })
}

/** Join an existing group by id (used by "New MIP in this project"). */
export function joinProjectGroup(projectId: string, projectName: string): void {
  patchMeta({ projectId, projectName })
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
  if (getActiveVariant()) return // scene background is base-only (disabled in variant mode)
  mapActiveScene((sd) => ({ ...sd, bgColor: color }))
}
export function setSceneBg2(color: string | undefined): void {
  if (getActiveVariant()) return
  mapActiveScene((sd) => ({ ...sd, bgColor2: color }))
}
export function addAsset(id: string, entry: AssetEntry): void {
  set({ dirty: true, assets: { ...state.assets, [id]: entry } })
}
/** Set (or clear, with undefined) a video/audio asset's compression override. */
export function setAssetCompress(id: string, compress: CompressProfile | undefined): void {
  const a = state.assets[id]
  if (!a) return
  const next = { ...a } as AssetEntry
  if (compress && Object.keys(compress).length) next.compress = compress
  else delete next.compress
  set({ dirty: true, assets: { ...state.assets, [id]: next } })
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
  if (getActiveVariant()) return // scene name/advance/transition are base-only (disabled in variant mode)
  set({ dirty: true, project: { ...state.project, scenes: state.project.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) } })
}
export function setSceneLocaleSource(id: string, locale: string, source: SceneDef, assets: AssetMap, header?: ProjectMeta['header']): void {
  const code = locale.trim().replace(/_/g, '-')
  if (!code) return
  const locales = [...new Set([...(state.project.meta.locales ?? []), code])]
  set({
    dirty: true,
    assets,
    project: {
      ...state.project,
      meta: {
        ...state.project.meta,
        defaultLocale: state.project.meta.defaultLocale || 'en',
        locales,
        ...(header ? { headerI18n: { ...(state.project.meta.headerI18n ?? {}), [code]: header } } : {}),
      },
      scenes: state.project.scenes.map((scene) => scene.id === id ? {
        ...scene,
        localeOverrides: { ...(scene.localeOverrides ?? {}), [code]: { source } },
      } : scene),
    },
  })
}
export function setLocaleHeader(locale: string, header: NonNullable<ProjectMeta['header']>, assets: AssetMap): void {
  const code = locale.trim().replace(/_/g, '-')
  if (!code) return
  set({
    dirty: true,
    assets,
    project: {
      ...state.project,
      meta: {
        ...state.project.meta,
        defaultLocale: state.project.meta.defaultLocale || 'en',
        locales: [...new Set([...(state.project.meta.locales ?? []), code])],
        headerI18n: { ...(state.project.meta.headerI18n ?? {}), [code]: header },
      },
    },
  })
}
export function removeSceneLocaleSource(id: string, locale: string): void {
  const scene = state.project.scenes.find((item) => item.id === id)
  if (!scene?.localeOverrides?.[locale]) return
  const overrides = { ...scene.localeOverrides }
  delete overrides[locale]
  patchSceneDef(id, { localeOverrides: Object.keys(overrides).length ? overrides : undefined })
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
  if (kind === 'overlay') {
    return [
      { id: nextId('text'), type: 'text', name: 'Congrats', x: c.x, y: Math.round(m.baseH * 0.42), anchor: 'center', zIndex: 51, mode: 'fit', text: { value: 'You won!', fontSizePx: 130, fontWeight: 800, color: '#ffffff', align: 'center' }, sfx: [{ event: 'sceneEnter', assetId: 'sfx_f_correctBright' }] },
    ]
  }
  if (kind === 'endscene') {
    return [
      { id: nextId('end'), type: 'endscene', name: 'Endscene video', x: c.x, y: c.y, w: m.baseW, h: m.baseH, anchor: 'center', zIndex: 1, mode: 'extend', endscene: { objectFit: 'cover', bgColor: '#000000', loop: true, matchBgEdge: false, muteUntilInteraction: true }, sfx: [{ event: 'sceneEnter', assetId: 'sfx_f_winJingle' }] },
      { id: nextId('text'), type: 'text', name: 'Endscene title', x: c.x, y: Math.round(m.baseH * 0.3), anchor: 'center', zIndex: 11, mode: 'fit', text: { value: 'Get the app!', fontSizePx: 120, fontWeight: 800, color: '#ffffff', align: 'center' } },
      { id: nextId('cta'), type: 'cta', name: 'CTA button', x: c.x, y: Math.round(m.baseH * 0.6), anchor: 'center', zIndex: 20, mode: 'fit', w: 600, h: 160, cta: { pulse: 'medium' }, text: { value: 'PLAY NOW', fontSizePx: 66, fontWeight: 800, color: '#ffffff' }, box: { bgColor: '#16a34a', radiusPx: 80 } },
    ]
  }
  return []
}
export function addScene(kind: SceneDef['kind'] = 'overlay'): void {
  const id = nextId('scene')
  const labels: Record<string, string> = { game: 'Game', overlay: 'Overlay', endscene: 'Endscene' }
  const advance: SceneDef['advance'] = kind === 'game' ? { on: 'gameWin' } : kind === 'overlay' ? { on: 'timer', delayMs: 1500 } : kind === 'endscene' ? { on: 'manual' } : { on: 'tap' }
  const overlay = kind === 'overlay' ? { opacity: 0.72, color: '#0a1024' } : undefined
  const sd: SceneDef = {
    id,
    name: `${labels[kind ?? 'overlay'] ?? 'Scene'} ${state.project.scenes.length + 1}`,
    kind,
    overlay,
    elements: templateElements(kind),
    advance,
    transition: { type: 'fade', durationMs: 350 },
  }
  const extraAssets: AssetMap = {}
  if (kind === 'overlay' && !state.assets['sfx_f_correctBright'])
    extraAssets['sfx_f_correctBright'] = { src: sfxPreviewUrl('f_correctBright'), w: 0, h: 0, kind: 'audio' }
  if (kind === 'endscene' && !state.assets['sfx_f_winJingle'])
    extraAssets['sfx_f_winJingle'] = { src: sfxPreviewUrl('f_winJingle'), w: 0, h: 0, kind: 'audio' }
  const assets = Object.keys(extraAssets).length ? { ...state.assets, ...extraAssets } : state.assets
  set({ dirty: true, activeSceneId: id, selectedIds: [], project: { ...state.project, scenes: [...state.project.scenes, sd] }, assets })
}

export function addGameScene(templateId: string): void {
  const id = nextId('scene')
  const c = center()
  const m = state.project.meta
  const tpl = GAME_TEMPLATES.find((t) => t.id === templateId)
  const isScratch = templateId === 'scratch' || templateId === 'scratch_grid'
  // The scrollable page IS the whole screen: full-bleed extend mount (like an
  // endscene video) so the image fills the viewport width at any aspect.
  const fullBleed = templateId === 'scroll'
  const gameEl: SceneElement = {
    id: nextId('game'),
    type: 'game-mount',
    name: tpl?.label ?? 'Game',
    x: c.x,
    y: fullBleed ? c.y : Math.round(m.baseH * 0.45),
    w: fullBleed ? m.baseW : Math.round(m.baseW * 0.9),
    h: fullBleed ? m.baseH : Math.round(m.baseH * 0.52),
    anchor: 'center',
    zIndex: 10,
    mode: fullBleed ? 'extend' : 'fit',
    game: { templateId, params: {} },
    sfx: isScratch ? [{ event: 'whileScratching', assetId: 'sfx_f_scratch' }, { event: 'onReveal', assetId: 'sfx_f_correctBright' }] : undefined,
  }
  const sd: SceneDef = {
    id,
    name: `Game ${state.project.scenes.length + 1}`,
    kind: 'game',
    elements: [gameEl],
    advance: { on: 'gameWin' },
    transition: { type: 'fade', durationMs: 350 },
  }
  const extraAssets: AssetMap = {}
  if (isScratch) {
    if (!state.assets['sfx_f_scratch']) extraAssets['sfx_f_scratch'] = { src: sfxPreviewUrl('f_scratch'), w: 0, h: 0, kind: 'audio' }
    if (!state.assets['sfx_f_correctBright']) extraAssets['sfx_f_correctBright'] = { src: sfxPreviewUrl('f_correctBright'), w: 0, h: 0, kind: 'audio' }
  }
  const assets = Object.keys(extraAssets).length ? { ...state.assets, ...extraAssets } : state.assets
  set({ dirty: true, activeSceneId: id, selectedIds: [], project: { ...state.project, scenes: [...state.project.scenes, sd] }, assets })
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
  const sd: SceneDef = { id, name, kind: 'overlay', bgColor, elements, advance: { on: 'tap' }, transition: { type: 'fade', durationMs: 350 } }
  set({ dirty: true, activeSceneId: id, selectedIds: [], assets: { ...state.assets, ...assets }, project: { ...state.project, scenes: [...state.project.scenes, sd] } })
}

// ---- load / save ----------------------------------------------------------
export function loadProject(raw: Project, assets: AssetMap, path: string | null, trace?: TraceState): void {
  // Single chokepoint for every load path (file open, library, team import,
  // version restore, boot) — upgrade old saves to the current schema here.
  const project = migrateProject(raw)
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
  // Self-heal audio portability: built-in SFX were historically stored with a Vite
  // bundle URL that doesn't resolve on another build/machine, so imported / shared /
  // team-pulled projects lost their sound. Re-inline any non-data audio from the local
  // build (fire-and-forget; a no-op when everything is already a data URL). Only patch
  // if this same project is still loaded, and don't mark the project dirty.
  void import('./sfxLibrary')
    .then(async ({ inlineProjectSfx }) => {
      const changed = await inlineProjectSfx(assets)
      if (changed && state.project === project) {
        state = { ...state, assets: { ...state.assets, ...changed } }
        emit()
      }
    })
    .catch(() => {})
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
