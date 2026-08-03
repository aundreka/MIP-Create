// Runtime localization. A playable carries its base copy in each TextConfig.value
// plus optional per-locale overrides in TextConfig.i18n. At boot the export picks
// the best locale from the browser language; the editor forces a chosen locale via
// the render message. `localize()` is read wherever text is drawn.

import type { HeaderConfig, LocaleElementOverride, ProjectMeta, SceneDef, SceneElement, TextConfig } from './scene'

let active: string | null = null // null = base copy (TextConfig.value)

export function setActiveLocale(code: string | null | undefined): void {
  active = code && code.trim() ? code.trim() : null
}
export function getActiveLocale(): string | null {
  return active
}

const norm = (s: string): string => s.toLowerCase().replace(/_/g, '-')

/** Resolve an exact or base-language entry from a locale-keyed record. */
export function localeEntry<T>(values: Record<string, T> | undefined, locale: string | null | undefined): T | undefined {
  if (!values || !locale) return undefined
  if (values[locale] != null) return values[locale]
  const wanted = norm(locale)
  const exact = Object.keys(values).find((key) => norm(key) === wanted)
  if (exact) return values[exact]
  const base = wanted.split('-')[0]
  const fallback = Object.keys(values).find((key) => norm(key).split('-')[0] === base)
  return fallback ? values[fallback] : undefined
}

export function elementLocaleOverride(el: SceneElement, locale: string | null | undefined = active): LocaleElementOverride | undefined {
  return localeEntry(el.localeOverrides, locale)
}

export function localizeHeader(
  meta: Pick<ProjectMeta, 'header' | 'headerI18n'>,
  locale: string | null | undefined = active,
): HeaderConfig | undefined {
  return localeEntry(meta.headerI18n, locale) ?? meta.header
}

/** Resolve a whole-scene language version while keeping the master flow stable. */
export function localizeSceneDef(scene: SceneDef, locale: string | null | undefined = active): SceneDef {
  const override = localeEntry(scene.localeOverrides, locale)
  if (!override?.source) return scene
  return {
    ...override.source,
    id: scene.id,
    advance: scene.advance,
    transition: scene.transition,
    localeOverrides: scene.localeOverrides,
  }
}

/** Bake a language's asset + portrait/landscape geometry into a transient element. */
export function localizeElement(el: SceneElement, locale: string | null | undefined = active): SceneElement {
  const override = elementLocaleOverride(el, locale)
  if (!override) return el
  const localized = override.source
    ? { ...override.source, id: el.id, localeOverrides: el.localeOverrides }
    : el
  return {
    ...localized,
    ...(override.assetId !== undefined ? { assetId: override.assetId } : {}),
    // A localized background replaces both orientations so rotating cannot reveal default-language art.
    ...(override.assetId !== undefined && localized.type === 'background'
      ? { background: { ...(localized.background ?? {}), landscapeAssetId: override.assetId } }
      : {}),
    ...(override.portrait ?? {}),
    landscape: override.landscape ? { ...(localized.landscape ?? {}), ...override.landscape } : localized.landscape,
  }
}

/** Pick the best available locale for the browser, else null (= base copy). */
export function resolveLocale(available?: string[]): string | null {
  if (!available || !available.length) return null
  const avail = available.map(norm)
  const nav =
    typeof navigator !== 'undefined'
      ? navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language]
      : []
  for (const raw of nav) {
    if (!raw) continue
    const want = norm(raw)
    let i = avail.indexOf(want)
    if (i >= 0) return available[i]
    const base = want.split('-')[0]
    i = avail.findIndex((a) => a === base || a.split('-')[0] === base)
    if (i >= 0) return available[i]
  }
  return null
}

/** The active-locale string for a text config, falling back to its base value. */
export function localize(t?: TextConfig): string {
  if (!t) return ''
  const translated = localeEntry(t.i18n, active)
  if (translated != null) return translated
  return t.value ?? ''
}
