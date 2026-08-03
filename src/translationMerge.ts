import type { ProjectData } from './bridge'
import type { HeaderConfig, SceneDef, SceneElement } from '../runtime/scene'
import type { AssetEntry, AssetMap } from '../runtime/types'

export interface TranslationPlayable {
  locale: string
  data: ProjectData
  label?: string
}

export interface TranslationMergeResult extends ProjectData {
  warnings: string[]
}

export interface SceneTranslationResult {
  source: SceneDef
  assets: AssetMap
  header?: HeaderConfig
}

export function buildHeaderTranslation(
  header: HeaderConfig,
  sourceAssets: AssetMap,
  targetAssets: AssetMap,
  locale: string,
): { header: HeaderConfig; assets: AssetMap } {
  const assets = clone(targetAssets)
  const localized = clone(header)
  const oldId = localized.fontFamily
  const font = oldId ? sourceAssets[oldId] : undefined
  if (!oldId || !font) return { header: localized, assets }
  const fingerprint = assetFingerprint(font)
  const existing = Object.entries(assets).find(([, asset]) => assetFingerprint(asset) === fingerprint)?.[0]
  if (existing) localized.fontFamily = existing
  else {
    const newId = uniqueId(`i18n_${cleanId(locale)}_${cleanId(oldId)}`, assets)
    assets[newId] = clone(font)
    localized.fontFamily = newId
  }
  return { header: localized, assets }
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const key = (value: string): string => value.trim().toLowerCase().replace(/[_\s]+/g, '-')
const cleanId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'asset'
const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

function uniqueId(preferred: string, assets: AssetMap): string {
  if (!assets[preferred]) return preferred
  let i = 2
  while (assets[`${preferred}_${i}`]) i += 1
  return `${preferred}_${i}`
}

function assetFingerprint(asset: AssetEntry): string {
  return JSON.stringify([asset.src, asset.w, asset.h, asset.kind ?? '', asset.compress ?? null])
}

function remapDeep<T>(value: T, ids: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') return (ids.get(value) ?? value) as T
  if (Array.isArray(value)) return value.map((item) => remapDeep(item, ids)) as T
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) out[name] = remapDeep(item, ids)
  return out as T
}

/** Copy one scene into a master project's asset namespace for a language override. */
export function buildSceneTranslation(
  master: SceneDef,
  sourceScene: SceneDef,
  sourceAssets: AssetMap,
  targetAssets: AssetMap,
  locale: string,
  sourceHeader?: HeaderConfig,
): SceneTranslationResult {
  const assets = clone(targetAssets)
  const idMap = new Map<string, string>([[sourceScene.id, master.id]])
  const fingerprintIds = new Map<string, string>()
  for (const [id, asset] of Object.entries(assets)) fingerprintIds.set(assetFingerprint(asset), id)
  for (const [oldId, asset] of Object.entries(sourceAssets)) {
    const fingerprint = assetFingerprint(asset)
    const existing = fingerprintIds.get(fingerprint)
    if (existing) { idMap.set(oldId, existing); continue }
    const preferred = `i18n_${cleanId(locale)}_${cleanId(oldId)}`
    const newId = uniqueId(preferred, assets)
    assets[newId] = clone(asset)
    fingerprintIds.set(fingerprint, newId)
    idMap.set(oldId, newId)
  }
  const source = remapDeep(clone(sourceScene), idMap)
  source.id = master.id
  source.advance = clone(master.advance)
  source.transition = master.transition ? clone(master.transition) : undefined
  delete source.localeOverrides
  source.elements = source.elements.map((element) => ({ ...element, localeOverrides: undefined, sync: undefined }))
  return { source, assets, header: sourceHeader ? remapDeep(clone(sourceHeader), idMap) : undefined }
}

function matchScenes(base: SceneDef[], source: SceneDef[]): Array<{ base: SceneDef; source: SceneDef; sourceIndex: number }> {
  const used = new Set<number>()
  return base.flatMap((baseScene, baseIndex) => {
    let sourceIndex = source.findIndex((scene, i) => !used.has(i) && scene.id === baseScene.id)
    if (sourceIndex < 0) sourceIndex = source.findIndex((scene, i) => !used.has(i) && sameName(scene.name, baseScene.name))
    if (sourceIndex < 0 && source[baseIndex] && !used.has(baseIndex)) sourceIndex = baseIndex
    if (sourceIndex < 0) return []
    used.add(sourceIndex)
    return [{ base: baseScene, source: source[sourceIndex], sourceIndex }]
  })
}

function matchElements(base: SceneElement[], source: SceneElement[]): Array<{ base: SceneElement; source: SceneElement; sourceIndex: number }> {
  const used = new Set<number>()
  return base.flatMap((baseElement, baseIndex) => {
    let sourceIndex = source.findIndex((element, i) => !used.has(i) && element.id === baseElement.id)
    if (sourceIndex < 0) sourceIndex = source.findIndex((element, i) => !used.has(i) && element.type === baseElement.type && sameName(element.name, baseElement.name))
    if (sourceIndex < 0 && source[baseIndex]?.type === baseElement.type && !used.has(baseIndex)) sourceIndex = baseIndex
    if (sourceIndex < 0) sourceIndex = source.findIndex((element, i) => !used.has(i) && element.type === baseElement.type)
    if (sourceIndex < 0) return []
    used.add(sourceIndex)
    return [{ base: baseElement, source: source[sourceIndex], sourceIndex }]
  })
}

/**
 * Combine separately-authored language copies into one browser-language-aware
 * project. The default playable remains the fallback and each matched element
 * receives a complete localized source snapshot.
 */
export function combineTranslatedPlayables(
  playables: TranslationPlayable[],
  defaultIndex: number,
  newName: string,
): TranslationMergeResult {
  if (playables.length < 2) throw new Error('Choose at least two playables.')
  if (!playables[defaultIndex]) throw new Error('Choose a default playable.')

  const locales = playables.map((item) => item.locale.trim().replace(/_/g, '-'))
  if (locales.some((locale) => !locale)) throw new Error('Every selected playable needs a language code.')
  if (new Set(locales.map(key)).size !== locales.length) throw new Error('Each selected playable needs a different language.')

  const baseInput = playables[defaultIndex]
  const project = clone(baseInput.data.project)
  const assets = clone(baseInput.data.assets)
  const warnings: string[] = []
  const defaultLocale = locales[defaultIndex]
  project.meta = {
    ...project.meta,
    name: newName.trim() || `${project.meta.name || 'Untitled'} multilingual`,
    defaultLocale,
    locales: locales.filter((_, index) => index !== defaultIndex),
  }

  const fingerprintIds = new Map<string, string>()
  for (const [id, asset] of Object.entries(assets)) fingerprintIds.set(assetFingerprint(asset), id)

  playables.forEach((playable, playableIndex) => {
    if (playableIndex === defaultIndex) return
    const locale = locales[playableIndex]
    const sourceProject = playable.data.project
    const sourceLabel = playable.label || sourceProject.meta.name || locale
    const idMap = new Map<string, string>()

    for (const [oldId, asset] of Object.entries(playable.data.assets)) {
      const fingerprint = assetFingerprint(asset)
      const existing = fingerprintIds.get(fingerprint)
      if (existing) {
        idMap.set(oldId, existing)
        continue
      }
      const preferred = `i18n_${cleanId(locale)}_${cleanId(oldId)}`
      const newId = uniqueId(preferred, assets)
      assets[newId] = clone(asset)
      fingerprintIds.set(fingerprint, newId)
      idMap.set(oldId, newId)
    }

    if (sourceProject.meta.header) {
      project.meta.headerI18n = {
        ...(project.meta.headerI18n ?? {}),
        [locale]: remapDeep(clone(sourceProject.meta.header), idMap),
      }
    }

    const sceneMatches = matchScenes(project.scenes, sourceProject.scenes)
    for (const match of sceneMatches) idMap.set(match.source.id, match.base.id)
    if (sceneMatches.length < project.scenes.length || sceneMatches.length < sourceProject.scenes.length) {
      warnings.push(`${sourceLabel}: matched ${sceneMatches.length} of ${project.scenes.length} default scenes; unmatched content falls back to ${defaultLocale}.`)
    }

    const allElementMatches = sceneMatches.map((sceneMatch) => ({
      sceneMatch,
      elements: matchElements(sceneMatch.base.elements, sceneMatch.source.elements),
    }))
    for (const { elements } of allElementMatches) for (const match of elements) idMap.set(match.source.id, match.base.id)

    for (const { sceneMatch, elements } of allElementMatches) {
      if (elements.length < sceneMatch.base.elements.length || elements.length < sceneMatch.source.elements.length) {
        warnings.push(`${sourceLabel} / ${sceneMatch.base.name}: matched ${elements.length} of ${sceneMatch.base.elements.length} default elements; unmatched elements use ${defaultLocale}.`)
      }
      for (const match of elements) {
        const localized = remapDeep(clone(match.source), idMap)
        localized.id = match.base.id
        delete localized.localeOverrides
        delete localized.sync
        match.base.localeOverrides = {
          ...(match.base.localeOverrides ?? {}),
          [locale]: { ...(match.base.localeOverrides?.[locale] ?? {}), source: localized },
        }
      }
      // With a one-to-one structure, keep the translated scene exactly as it
      // was authored (including scene background/overlay and source-only config).
      // Mismatched structures stay on element overrides so missing pieces can
      // safely fall back to the master instead of disappearing.
      if (elements.length === sceneMatch.base.elements.length && elements.length === sceneMatch.source.elements.length) {
        const localizedScene = remapDeep(clone(sceneMatch.source), idMap)
        localizedScene.id = sceneMatch.base.id
        localizedScene.advance = clone(sceneMatch.base.advance)
        localizedScene.transition = sceneMatch.base.transition ? clone(sceneMatch.base.transition) : undefined
        delete localizedScene.localeOverrides
        localizedScene.elements = localizedScene.elements.map((element) => ({ ...element, localeOverrides: undefined, sync: undefined }))
        sceneMatch.base.localeOverrides = {
          ...(sceneMatch.base.localeOverrides ?? {}),
          [locale]: { source: localizedScene },
        }
      }
    }

    if (!sourceProject.scenes.length) warnings.push(`${sourceLabel}: the playable has no scenes.`)
  })

  return { project, assets, trace: baseInput.data.trace, warnings }
}

export const LANGUAGE_SUGGESTIONS = [
  ['en', 'English'], ['de', 'German'], ['ar', 'Arabic'], ['es', 'Spanish'],
  ['fr', 'French'], ['pt', 'Portuguese'], ['it', 'Italian'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['zh-CN', 'Chinese (Simplified)'], ['zh-TW', 'Chinese (Traditional)'],
] as const

export function inferLanguageCode(name: string, fallback = ''): string {
  const text = name.toLowerCase()
  const aliases: Array<[RegExp, string]> = [
    [/\b(english|eng)\b/, 'en'], [/\b(german|deutsch)\b/, 'de'], [/\b(arabic|arab)\b/, 'ar'],
    [/\b(spanish|espanol|español)\b/, 'es'], [/\b(french|francais|français)\b/, 'fr'],
    [/\b(portuguese|portugues|português)\b/, 'pt'], [/\bitalian\b/, 'it'],
    [/\bjapanese\b/, 'ja'], [/\bkorean\b/, 'ko'], [/\bchinese\b/, 'zh-CN'],
  ]
  return aliases.find(([pattern]) => pattern.test(text))?.[1] ?? fallback
}
