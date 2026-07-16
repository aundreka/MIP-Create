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
  monthDay: { month: 'long', day: 'numeric' }, // June 24
}

/** A live ticker is only needed when the display changes by the second/minute/hour
 * (a pure {date} or {d} label doesn't tick). */
export function formatTicks(fmt: string): boolean {
  return /\{s\}|\{ss\}|\{m\}|\{mm\}|\{h\}|\{hh\}/.test(fmt)
}

export function needsTicker(el: SceneElement): boolean {
  return formatTicks(el.countdown?.format || '')
}

export interface CountdownFormatOpts {
  dateLocale?: string
  dateStyle?: 'short' | 'long' | 'numeric' | 'monthDay'
  capitalize?: boolean
}

// Date-format fields accept bare tokens ("MMMM D, YYYY") for convenience; the
// formatter itself only knows {braced} ones. Wrap bare standalone tokens in
// braces, leaving anything already braced untouched. Shared by the pinned
// header and the scratch-grid cell date.
export function braceBareTokens(fmt: string): string {
  return fmt.replace(/\{[^}]*\}|\b(MMMM|MMM|MM|M|DD|D|YYYY|YY)\b/g, (match, bare: string | undefined) => (bare ? `{${bare}}` : match))
}

/** Render the format string for the remaining time to `deadline`. Bare date
 * tokens (MM.D, MMMM D YYYY) are accepted like everywhere else. */
export function formatCountdown(el: SceneElement, deadline: number, now: number): string {
  return renderCountdownFormat(braceBareTokens(el.countdown?.format || '{d}d {hh}:{mm}:{ss}'), deadline, now, el.countdown ?? {})
}

/** Element-independent core of formatCountdown — also drives the pinned header's
 * countdown mode, so both surfaces share one token vocabulary. */
export function renderCountdownFormat(fmt: string, deadline: number, now: number, opts: CountdownFormatOpts = {}): string {
  const total = Math.max(0, deadline - now)
  const d = Math.floor(total / DAY)
  const h = Math.floor(total / 3600000) % 24
  const m = Math.floor(total / 60000) % 60
  const s = Math.floor(total / 1000) % 60
  const locale = opts.dateLocale || 'en-US'
  const target = new Date(deadline)
  let dateStr = ''
  try {
    dateStr = target.toLocaleDateString(locale, DATE_OPTS[opts.dateStyle ?? 'short'] ?? DATE_OPTS.short)
  } catch {
    dateStr = ''
  }
  // Localized month name for the {MMMM}/{MMM} date-part tokens.
  const monthName = (style: 'long' | 'short'): string => {
    try {
      return target.toLocaleDateString(locale, { month: style })
    } catch {
      return ''
    }
  }
  const out = fmt
    .replace(/\{date\}/g, dateStr)
    .replace(/\{MMMM\}/g, monthName('long'))
    .replace(/\{MMM\}/g, monthName('short'))
    .replace(/\{MM\}/g, pad(target.getMonth() + 1))
    .replace(/\{M\}/g, String(target.getMonth() + 1))
    .replace(/\{DD\}/g, pad(target.getDate()))
    .replace(/\{D\}/g, String(target.getDate()))
    .replace(/\{YYYY\}/g, String(target.getFullYear()))
    .replace(/\{YY\}/g, pad(target.getFullYear() % 100))
    .replace(/\{dd\}/g, pad(d))
    .replace(/\{hh\}/g, pad(h))
    .replace(/\{mm\}/g, pad(m))
    .replace(/\{ss\}/g, pad(s))
    .replace(/\{d\}/g, String(d))
    .replace(/\{h\}/g, String(h))
    .replace(/\{m\}/g, String(m))
    .replace(/\{s\}/g, String(s))
  // Capitalize the first letter of every word (e.g. "Order by" -> "Order By").
  return opts.capitalize ? out.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : out
}
