// Countdown / dynamic-date helpers. The element renders like a text element
// (styled via el.text); the stage runs a 1s ticker that rewrites the inner text
// using formatCountdown. 'dynamic' mode targets (now + dynamicDays) so the date
// is always relative to when the ad actually runs.

import type { SceneElement } from '../scene'

const DAY = 86400000

/** Resolve the target instant (ms epoch) for the element, given the load time. */
export function computeDeadline(el: SceneElement, now: number): number {
  const cd = el.countdown
  if (!cd) return now
  if (cd.mode === 'timer') return now + Math.max(0, cd.seconds ?? 60) * 1000
  if (cd.mode === 'dynamic') return now + Math.max(0, cd.dynamicDays ?? 3) * DAY
  const t = cd.targetIso ? Date.parse(cd.targetIso) : NaN
  return isFinite(t) ? t : now
}

const pad = (n: number): string => (n < 10 ? '0' + n : String(n))

const DATE_OPTS: Record<string, Intl.DateTimeFormatOptions> = {
  short: { month: 'short', day: 'numeric', year: 'numeric' }, // Jun 24, 2026
  long: { month: 'long', day: 'numeric', year: 'numeric' }, // June 24, 2026
  numeric: { year: 'numeric', month: '2-digit', day: '2-digit' }, // 2026/06/24
}

/** A live ticker is only needed when the display changes by the second/minute/hour
 * (a pure {date} or {d} label doesn't tick). */
export function needsTicker(el: SceneElement): boolean {
  return /\{s\}|\{ss\}|\{m\}|\{mm\}|\{h\}|\{hh\}/.test(el.countdown?.format || '')
}

/** Render the format string for the remaining time to `deadline`. */
export function formatCountdown(el: SceneElement, deadline: number, now: number): string {
  const fmt = el.countdown?.format || '{d}d {hh}:{mm}:{ss}'
  const total = Math.max(0, deadline - now)
  const d = Math.floor(total / DAY)
  const h = Math.floor(total / 3600000) % 24
  const m = Math.floor(total / 60000) % 60
  const s = Math.floor(total / 1000) % 60
  let dateStr = ''
  try {
    dateStr = new Date(deadline).toLocaleDateString(undefined, DATE_OPTS[el.countdown?.dateStyle ?? 'short'] ?? DATE_OPTS.short)
  } catch {
    dateStr = ''
  }
  return fmt
    .replace(/\{date\}/g, dateStr)
    .replace(/\{dd\}/g, pad(d))
    .replace(/\{hh\}/g, pad(h))
    .replace(/\{mm\}/g, pad(m))
    .replace(/\{ss\}/g, pad(s))
    .replace(/\{d\}/g, String(d))
    .replace(/\{h\}/g, String(h))
    .replace(/\{m\}/g, String(m))
    .replace(/\{s\}/g, String(s))
}
