import type { Project, SceneElement } from '../runtime/scene'
import type { AssetEntry, AssetMap } from '../runtime/types'
import { getTemplate } from '../runtime/games/registry'

export interface AssetFlipSlot {
  id: string
  asset: AssetEntry
  references: string[]
  sceneNames: string[]
}

export interface AssetFlipUpload {
  name: string
  asset: AssetEntry
}

export interface AssetFlipAnalysis {
  matches: Record<string, AssetFlipUpload>
  missing: string[]
  extra: AssetFlipUpload[]
  duplicate: string[]
}

const IMAGE_EXT = /\.(?:png|jpe?g|webp)$/i

/** The filename (without its supported image extension) used for matching. */
export function assetFlipName(value: string): string {
  return value.trim().replace(IMAGE_EXT, '')
}

const matchKey = (value: string): string => assetFlipName(value).toLocaleLowerCase()

function gameAssetKeys(el: Partial<SceneElement>): Set<string> {
  const params = el.game?.params ?? {}
  const keys = new Set(getTemplate(el.game?.templateId)?.assetSlots?.map((slot) => slot.key) ?? [])
  // Scratch grid supports authored cells beyond the four starter slots and a
  // per-cell win overlay. These keys are dynamic, so they cannot all be listed
  // in the static template definition.
  if (el.game?.templateId === 'scratch_grid') {
    for (const key of Object.keys(params)) if (/^cell\d+(?:cover|text|winOverlayImage)?$/.test(key)) keys.add(key)
  }
  // The configurator's picture table is one param per combination (img_2_3) plus one
  // per option's selected art (on_1_4), so its keys are dynamic for the same reason.
  if (el.game?.templateId === 'configurator') {
    for (const key of Object.keys(params)) if (/^(?:img|on)(?:_\d+)+$/.test(key)) keys.add(key)
  }
  return keys
}

function jsonRevealAssetIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => entry && typeof entry === 'object' && typeof (entry as { src?: unknown }).src === 'string' ? [(entry as { src: string }).src] : [])
  } catch {
    return []
  }
}

function elementAssetRefs(el: Partial<SceneElement>, path: string): Array<{ id: string; path: string }> {
  const out: Array<{ id: string; path: string }> = []
  const add = (id: unknown, at: string): void => { if (typeof id === 'string' && id) out.push({ id, path: at }) }
  const addValue = (value: unknown, at: string): void => {
    if (Array.isArray(value)) value.forEach((id, index) => add(id, `${at}[${index}]`))
    else add(value, at)
  }

  add(el.assetId, `${path}.assetId`)
  for (const [locale, override] of Object.entries(el.localeOverrides ?? {})) add(override.assetId, `${path}.localeOverrides.${locale}.assetId`)
  add(el.background?.landscapeAssetId, `${path}.background.landscapeAssetId`)
  add(el.text?.fontFamily, `${path}.text.fontFamily`)
  add(el.container?.imageId, `${path}.container.imageId`)
  add(el.button?.tapFadeAssetId, `${path}.button.tapFadeAssetId`)
  add(el.generate?.resultId, `${path}.generate.resultId`)
  add(el.scratch?.coverAssetId, `${path}.scratch.coverAssetId`)

  if (el.game?.params) {
    for (const key of gameAssetKeys(el)) addValue(el.game.params[key], `${path}.game.params.${key}`)
    if (el.game.templateId === 'scratch_grid') {
      jsonRevealAssetIds(el.game.params.revealAssets).forEach((id, index) => add(id, `${path}.game.params.revealAssets[${index}].src`))
    }
  }
  if (el.unboxing) {
    const u = el.unboxing
    add(u.bgAssetId, `${path}.unboxing.bgAssetId`)
    add(u.back?.assetId, `${path}.unboxing.back.assetId`)
    add(u.front?.assetId, `${path}.unboxing.front.assetId`)
    add(u.top?.assetId, `${path}.unboxing.top.assetId`)
    add(u.winAssetId, `${path}.unboxing.winAssetId`)
    add(u.loseAssetId, `${path}.unboxing.loseAssetId`)
    add(u.revealSyncAssetId, `${path}.unboxing.revealSyncAssetId`)
  }
  if (el.endscene) {
    const end = el.endscene
    if (end.mode !== 'html') {
      add(end.portraitVideoId, `${path}.endscene.portraitVideoId`)
      add(end.landscapeVideoId, `${path}.endscene.landscapeVideoId`)
      add(end.portraitImageId, `${path}.endscene.portraitImageId`)
      add(end.landscapeImageId, `${path}.endscene.landscapeImageId`)
    }
    if (end.mode !== 'video') {
      add(end.htmlId, `${path}.endscene.htmlId`)
      add(end.htmlLandscapeId, `${path}.endscene.htmlLandscapeId`)
    }
  }
  return out
}

/** Find only real, rendered image references (including nested minigame slots). */
export function collectAssetFlipSlots(project: Project, assets: AssetMap): AssetFlipSlot[] {
  const refs = new Map<string, Set<string>>()
  const scenes = new Map<string, Set<string>>()

  const record = (id: string, path: string, sceneName: string): void => {
    const asset = assets[id]
    if (!asset || (asset.kind && asset.kind !== 'image')) return
    const paths = refs.get(id) ?? new Set<string>()
    paths.add(path)
    refs.set(id, paths)
    const names = scenes.get(id) ?? new Set<string>()
    names.add(sceneName)
    scenes.set(id, names)
  }

  project.scenes.forEach((scene, sceneIndex) => {
    const sceneName = scene.name || `Scene ${sceneIndex + 1}`
    scene.elements.forEach((el, elementIndex) => {
      const path = `scenes[${sceneIndex}].elements[${elementIndex}]`
      elementAssetRefs(el, path).forEach((ref) => record(ref.id, ref.path, sceneName))
      for (const variant of project.meta.variants ?? []) {
        const patch = variant.patches.find((entry) => entry.elementId === el.id)?.patch
        if (patch) elementAssetRefs({ ...el, ...patch }, `${path}.variant.${variant.id}`).forEach((ref) => record(ref.id, ref.path, sceneName))
      }
    })
  })
  return [...refs.entries()]
    .map(([id, paths]) => ({ id, asset: assets[id], references: [...paths].sort(), sceneNames: [...(scenes.get(id) ?? ['Project'])].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

/** Match uploaded images to renamed asset ids by exact, case-insensitive stem. */
export function analyzeAssetFlipUploads(expectedNames: string[], uploads: AssetFlipUpload[]): AssetFlipAnalysis {
  const expected = new Map<string, string>()
  for (const name of expectedNames) expected.set(matchKey(name), name)

  const buckets = new Map<string, AssetFlipUpload[]>()
  for (const upload of uploads) {
    const key = matchKey(upload.name)
    const list = buckets.get(key) ?? []
    list.push(upload)
    buckets.set(key, list)
  }

  const matches: Record<string, AssetFlipUpload> = {}
  const missing: string[] = []
  const duplicate: string[] = []
  for (const [key, name] of expected) {
    const candidates = buckets.get(key) ?? []
    if (!candidates.length) missing.push(name)
    else if (candidates.length > 1) duplicate.push(name)
    else matches[name] = candidates[0]
  }

  const extra: AssetFlipUpload[] = []
  for (const [key, candidates] of buckets) {
    if (!expected.has(key)) extra.push(...candidates)
  }
  return { matches, missing, extra, duplicate }
}

function remapElementAssets(el: Partial<SceneElement>, renameById: Record<string, string>): void {
  const remap = (id: string | undefined): string | undefined => id ? (renameById[id] ?? id) : id
  const remapValue = (value: unknown): unknown => Array.isArray(value) ? value.map((id) => typeof id === 'string' ? remap(id) : id) : typeof value === 'string' ? remap(value) : value

  el.assetId = remap(el.assetId)
  for (const override of Object.values(el.localeOverrides ?? {})) override.assetId = remap(override.assetId)
  if (el.background) el.background.landscapeAssetId = remap(el.background.landscapeAssetId)
  if (el.text) el.text.fontFamily = remap(el.text.fontFamily)
  if (el.container) el.container.imageId = remap(el.container.imageId)
  if (el.button) el.button.tapFadeAssetId = remap(el.button.tapFadeAssetId)
  if (el.generate) el.generate.resultId = remap(el.generate.resultId)
  if (el.scratch) el.scratch.coverAssetId = remap(el.scratch.coverAssetId)

  if (el.game?.params) {
    for (const key of gameAssetKeys(el)) el.game.params[key] = remapValue(el.game.params[key])
    if (el.game.templateId === 'scratch_grid' && typeof el.game.params.revealAssets === 'string') {
      try {
        const list = JSON.parse(el.game.params.revealAssets) as unknown
        if (Array.isArray(list)) {
          for (const entry of list) if (entry && typeof entry === 'object' && typeof (entry as { src?: unknown }).src === 'string') {
            const record = entry as { src: string }
            record.src = remap(record.src) ?? record.src
          }
          el.game.params.revealAssets = JSON.stringify(list)
        }
      } catch { /* leave invalid authored JSON unchanged */ }
    }
  }
  if (el.unboxing) {
    const u = el.unboxing
    u.bgAssetId = remap(u.bgAssetId)
    if (u.back) u.back.assetId = remap(u.back.assetId)
    if (u.front) u.front.assetId = remap(u.front.assetId)
    if (u.top) u.top.assetId = remap(u.top.assetId)
    u.winAssetId = remap(u.winAssetId)
    u.loseAssetId = remap(u.loseAssetId)
    u.revealSyncAssetId = remap(u.revealSyncAssetId)
  }
  if (el.endscene) {
    const end = el.endscene
    end.portraitVideoId = remap(end.portraitVideoId)
    end.landscapeVideoId = remap(end.landscapeVideoId)
    end.portraitImageId = remap(end.portraitImageId)
    end.landscapeImageId = remap(end.landscapeImageId)
    end.htmlId = remap(end.htmlId)
    end.htmlLandscapeId = remap(end.htmlLandscapeId)
  }
  for (const binding of el.sfx ?? []) binding.assetId = remap(binding.assetId) ?? binding.assetId
}

/** Create the in-memory cloned project, with asset ids and every nested reference remapped. */
export function buildAssetFlipData(
  project: Project,
  assets: AssetMap,
  newProjectName: string,
  renameById: Record<string, string>,
  replacements: Record<string, AssetEntry>,
): { project: Project; assets: AssetMap } {
  const renamedProject = structuredClone(project)
  for (const scene of renamedProject.scenes) for (const el of scene.elements) remapElementAssets(el, renameById)
  for (const variant of renamedProject.meta.variants ?? []) for (const entry of variant.patches) remapElementAssets(entry.patch, renameById)
  for (const binding of renamedProject.sfx ?? []) binding.assetId = renameById[binding.assetId] ?? binding.assetId
  if (renamedProject.bgm) renamedProject.bgm.assetId = renameById[renamedProject.bgm.assetId] ?? renamedProject.bgm.assetId
  if (renamedProject.meta.header?.fontFamily) renamedProject.meta.header.fontFamily = renameById[renamedProject.meta.header.fontFamily] ?? renamedProject.meta.header.fontFamily
  renamedProject.meta = { ...renamedProject.meta, name: newProjectName.trim() || `${project.meta.name || 'untitled'} flip` }

  const renamedAssets: AssetMap = {}
  const claimedIds = new Set(Object.values(renameById))
  // Keep unrelated library assets first, except stale/unreferenced entries whose
  // id is being deliberately claimed by a renamed, referenced image.
  for (const [oldId, asset] of Object.entries(assets)) {
    if (Object.prototype.hasOwnProperty.call(renameById, oldId) || claimedIds.has(oldId)) continue
    renamedAssets[oldId] = { ...asset }
  }
  // Referenced/renamed assets always win, independent of source object order.
  for (const [oldId, newId] of Object.entries(renameById)) {
    const asset = assets[oldId]
    if (asset) renamedAssets[newId] = replacements[newId] ?? { ...asset }
  }
  return { project: renamedProject, assets: renamedAssets }
}

export function assetFlipRenameErrors(renameById: Record<string, string>, protectedIds: string[]): string[] {
  const errors: string[] = []
  const values = Object.entries(renameById).map(([oldId, value]) => [oldId, assetFlipName(value)] as const)
  for (const [oldId, value] of values) if (!value) errors.push(`“${oldId}” needs a name.`)
  const imageOldIds = new Set(Object.keys(renameById))
  const reserved = new Map(protectedIds.filter((id) => !imageOldIds.has(id)).map((id) => [matchKey(id), id]))
  for (const [, value] of values) {
    if (!value) continue
    const key = matchKey(value)
    if (reserved.has(key)) errors.push(`“${value}” conflicts with the non-image asset “${reserved.get(key)}”.`)
  }
  return errors
}
