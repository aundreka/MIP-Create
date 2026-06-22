// Runtime localization. A playable carries its base copy in each TextConfig.value
// plus optional per-locale overrides in TextConfig.i18n. At boot the export picks
// the best locale from the browser language; the editor forces a chosen locale via
// the render message. `localize()` is read wherever text is drawn.

import type { TextConfig } from './scene'

let active: string | null = null // null = base copy (TextConfig.value)

export function setActiveLocale(code: string | null | undefined): void {
  active = code && code.trim() ? code.trim() : null
}
export function getActiveLocale(): string | null {
  return active
}

const norm = (s: string): string => s.toLowerCase().replace(/_/g, '-')

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
  if (active && t.i18n) {
    if (t.i18n[active] != null) return t.i18n[active]
    const base = active.split('-')[0]
    if (t.i18n[base] != null) return t.i18n[base]
  }
  return t.value ?? ''
}
