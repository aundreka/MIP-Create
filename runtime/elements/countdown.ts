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
  // Clock shows the current time, so there is no target instant — the renderer reads
  // `now` directly and the deadline is only a placeholder.
  if (cd.mode === 'clock') return now
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
  // A clock must keep ticking whatever its format — even a bare {hh}:{mm} has to roll
  // over on the minute, and formatTicks alone can't tell a clock from a static label.
  if (el.countdown?.mode === 'clock') return true
  return formatTicks(el.countdown?.format || '')
}

/** How the rendered text is cased. 'title' upper-cases the first letter of every
 * word ("order by jul 30" → "Order By Jul 30"); 'upper'/'lower' transform the whole
 * string. Note that month names arrive already title-cased from Intl, so 'title' is
 * a no-op on them — 'upper' is what turns "Jul" into "JUL". */
export type TextCase = 'none' | 'title' | 'upper' | 'lower'

export interface CountdownFormatOpts {
  dateLocale?: string
  dateStyle?: 'short' | 'long' | 'numeric' | 'monthDay'
  textCase?: TextCase
  /** Legacy on/off flag, equivalent to textCase 'title'. Read only when textCase is unset. */
  capitalize?: boolean
  /** Clock mode: {h}/{hh}/{m}/{mm}/{s}/{ss} render the CURRENT wall-clock time rather
   * than the time remaining, and the date tokens target today. */
  clock?: boolean
  /** 12-hour clock: {h}/{hh} render 1–12 instead of 0–23. Only applies in clock mode —
   * on a countdown those tokens are a remaining duration, where 12-hour is meaningless.
   * Pair it with the {A} / {a} token for the AM/PM suffix. */
  hour12?: boolean
}

/** Resolve the effective case, honoring the legacy `capitalize` boolean. */
export function effectiveCase(opts: CountdownFormatOpts): TextCase {
  return opts.textCase ?? (opts.capitalize ? 'title' : 'none')
}

function applyCase(s: string, mode: TextCase): string {
  if (mode === 'upper') return s.toUpperCase()
  if (mode === 'lower') return s.toLowerCase()
  if (mode === 'title') return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
  return s
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
  const cd = el.countdown
  const fallback = cd?.mode === 'clock' ? '{hh}:{mm}' : '{d}d {hh}:{mm}:{ss}'
  return renderCountdownFormat(braceBareTokens(cd?.format || fallback), deadline, now, {
    ...(cd ?? {}),
    clock: cd?.mode === 'clock',
  })
}

/** Element-independent core of formatCountdown — also drives the pinned header's
 * countdown mode, so both surfaces share one token vocabulary. */
export function renderCountdownFormat(fmt: string, deadline: number, now: number, opts: CountdownFormatOpts = {}): string {
  // Clock mode reads the CURRENT wall-clock time instead of a remaining duration,
  // so {hh}:{mm} shows "14:05". Date tokens then target today (deadline = now), which
  // is what a clock should show alongside the time.
  const clock = !!opts.clock
  const nowDate = new Date(now)
  const total = Math.max(0, deadline - now)
  const d = clock ? 0 : Math.floor(total / DAY)
  // 12-hour applies to the CLOCK only: on a countdown {hh} is hours remaining, and
  // folding 0 into 12 there would read as "12 hours left" when none are.
  const h24 = clock ? nowDate.getHours() : Math.floor(total / 3600000) % 24
  const h = clock && opts.hour12 ? h24 % 12 || 12 : h24
  const m = clock ? nowDate.getMinutes() : Math.floor(total / 60000) % 60
  const s = clock ? nowDate.getSeconds() : Math.floor(total / 1000) % 60
  const locale = opts.dateLocale || 'en-US'
  const target = clock ? nowDate : new Date(deadline)
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
  // AM/PM for the instant the other date tokens describe (today in clock mode, the
  // target otherwise). Braces are required — a bare "A" would collide with ordinary
  // copy like "A GREAT DEAL".
  const meridiem = target.getHours() < 12 ? 'AM' : 'PM'
  const out = fmt
    .replace(/\{A\}/g, meridiem)
    .replace(/\{a\}/g, meridiem.toLowerCase())
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
  return applyCase(out, effectiveCase(opts))
}
