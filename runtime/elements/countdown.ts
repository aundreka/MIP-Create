// Countdown / dynamic-date helpers. The element renders like a text element
// (styled via el.text); the stage runs a 1s ticker that rewrites the inner text
// using formatCountdown. 'dynamic' mode targets (now + dynamicDays) so the date
// is always relative to when the ad actually runs, optionally snapped forward to the
// next day a `recur` set allows ("the next Friday", "the next weekday").

import type { SceneElement } from '../scene'
import { promoLabelFor } from './promoCalendar'

const DAY = 86400000

// ---------------------------------------------------------------------------
// Preview date (editor only). The editor can force the runtime to render as if
// it were another day, so a designer can see both states of a dynamic holiday
// without changing the machine clock. It shifts ONLY what is drawn — timers,
// intervals and deadlines keep real time, so nothing else in the runtime changes
// behaviour while a preview date is on. Export never sets it.
// ---------------------------------------------------------------------------
let nowOverride: number | null = null

export function setNowOverride(ms: number | null | undefined): void {
  nowOverride = typeof ms === 'number' && isFinite(ms) ? ms : null
}

/** The instant DATE rendering should describe: the preview date when one is set,
 * otherwise the real clock. */
export function runtimeNow(): number {
  return nowOverride ?? Date.now()
}

/** How far the rendered date is displaced from the real clock. Added to both `now`
 * and `deadline` so the REMAINING time (deadline - now) is untouched: a timer still
 * counts what it really has left while its date tokens read the preview day. */
export function nowShift(): number {
  return nowOverride == null ? 0 : nowOverride - Date.now()
}

// ---------------------------------------------------------------------------
// Recurrence. A dynamic date normally lands on a flat offset from today ("now + 3
// days"), which drifts across the week — run the same ad on a Saturday and the
// "order by" date is a Tuesday. A recurrence pins it to the days that actually mean
// something to the offer instead: the next Friday, the next weekday (the classic
// "next business day" ship date), the next weekend, or any set of days the author
// picks. Shared by the countdown element and the pinned header, so both surfaces
// resolve "next Friday" identically.
// ---------------------------------------------------------------------------

/** Which weekdays a dynamic date may land on: a named preset, or an explicit list of
 * day numbers (0 = Sunday … 6 = Saturday) for "every Friday" / "Mon, Wed & Fri". */
export type Recurrence = 'weekday' | 'weekend' | number[]

/** The named presets, expanded to day numbers. Mon–Fri and Sat/Sun. */
export const RECURRENCE_PRESETS: Record<'weekday' | 'weekend', number[]> = {
  weekday: [1, 2, 3, 4, 5],
  weekend: [0, 6],
}

/** Normalize a recurrence to the day numbers it allows, or null when there is nothing
 * to snap to (unset, unknown, or a list holding no valid day) — in which case the flat
 * `dynamicDays` offset stands on its own. */
export function recurrenceDays(recur?: Recurrence | null): number[] | null {
  if (!recur) return null
  if (typeof recur === 'string') return RECURRENCE_PRESETS[recur] ?? null
  const days = recur.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  return days.length ? days : null
}

/** The first instant at or after `from` whose LOCAL day is in `days`, keeping the
 * time of day. Walking with setDate (rather than adding 86.4e6) is what makes the
 * result the same wall-clock time on the far side of a DST change. Seven steps is
 * always enough; the fallback only fires for an empty set, which callers exclude. */
export function nextRecurrence(from: number, days: number[]): number {
  const d = new Date(from)
  for (let i = 0; i < 7; i++) {
    if (days.includes(d.getDay())) return d.getTime()
    d.setDate(d.getDate() + 1)
  }
  return from
}

/** The instant a dynamic date targets: `days` days on from now, then forward to the
 * next day the recurrence allows. The two compose — `days` is a head start applied
 * BEFORE the snap, so "weekday, 1 day" is tomorrow when tomorrow is a weekday and
 * Monday otherwise, while "Friday, 0 days" stays on today when today is already
 * Friday. Without a recurrence this is just the flat offset it has always been. */
export function resolveDynamicTarget(now: number, days: number | undefined, recur?: Recurrence | null): number {
  const start = now + Math.max(0, days ?? 0) * DAY
  const set = recurrenceDays(recur)
  return set ? nextRecurrence(start, set) : start
}

/** Resolve the target instant (ms epoch) for the element, given the load time. */
export function computeDeadline(el: SceneElement, now: number): number {
  const cd = el.countdown
  if (!cd) return now
  // Clock shows the current time, so there is no target instant — the renderer reads
  // `now` directly and the deadline is only a placeholder.
  if (cd.mode === 'clock') return now
  if (cd.mode === 'timer') return now + Math.max(0, cd.seconds ?? 60) * 1000
  if (cd.mode === 'dynamic') return resolveDynamicTarget(now, cd.dynamicDays ?? 3, cd.recur)
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

/** A live ticker is only needed when the display changes by the hundredth/second/
 * minute/hour (a pure {date} or {d} label doesn't tick). */
export function formatTicks(fmt: string): boolean {
  return /\{ms\}|\{s\}|\{ss\}|\{m\}|\{mm\}|\{h\}|\{hh\}/.test(fmt)
}

/** Tokens whose value changes when the LOCAL DATE rolls over, but not second to
 * second: the holiday label and every date part. A format holding one of these
 * needs a single timer at midnight rather than a ticker (see startTicker). */
export function needsMidnightRefresh(fmt: string): boolean {
  return /\{holiday\}|\{promo\}|\{date\}|\{dddd\}|\{ddd\}|\{MMMM\}|\{MMM\}|\{MM\}|\{M\}|\{Do\}|\{o\}|\{DD\}|\{D\}|\{YYYY\}|\{YY\}/.test(braceBareTokens(fmt))
}

/** Start of the next local day (tonight's 12am). setHours(24,…) rolls the date over
 * through month/year ends and follows the device's own DST rules, so the remaining
 * time is whatever the viewer's clock says is left in the day. */
export function nextMidnight(now: number): number {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

/** How often a formatted timer needs repainting. `{ms}` intentionally represents
 * two-digit hundredths (00–99), matching a display such as `06:99`. */
export function formatTickerIntervalMs(fmt: string): number {
  if (/\{ms\}/.test(fmt)) return 10
  return formatTicks(fmt) ? 1000 : 0
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

/** English ordinal suffix for a day of the month: 1st, 2nd, 3rd, 4th … and the 11th/12th/13th
 * exception, which take 'th' despite ending in 1/2/3. English-only by design — the {Do}/{o}
 * tokens are for ad copy like "Ends July 21st"; `dateLocale` still governs {date}/{MMMM}. */
export function ordinalSuffix(day: number): string {
  const teens = day % 100
  if (teens >= 11 && teens <= 13) return 'th'
  const unit = day % 10
  return unit === 1 ? 'st' : unit === 2 ? 'nd' : unit === 3 ? 'rd' : 'th'
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
//
// `Do` (ordinal day, "MMMM Do" → "July 21st") joins the bare list; the bare suffix
// `o` deliberately does NOT, since a lone "o" is far likelier to be copy than a token.
// Write "{D}{o}" if you want the parts separately.
export function braceBareTokens(fmt: string): string {
  return fmt.replace(/\{[^}]*\}|\b(dddd|ddd|MMMM|MMM|MM|M|Do|DD|D|YYYY|YY)\b/g, (match, bare: string | undefined) => (bare ? `{${bare}}` : match))
}

/** Render the format string for the remaining time to `deadline`. Bare date
 * tokens (MM.D, MMMM D YYYY) are accepted like everywhere else. */
export function formatCountdown(el: SceneElement, deadline: number, now: number): string {
  const cd = el.countdown
  const fallback = cd?.mode === 'clock' ? '{hh}:{mm}' : '{d}d {hh}:{mm}:{ss}'
  // Both instants move together under a preview date, so the duration between them —
  // what a timer actually displays — is exactly what it would be on the real clock.
  const shift = nowShift()
  return renderCountdownFormat(braceBareTokens(cd?.format || fallback), deadline + shift, now + shift, {
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
  // The editor-facing token is called {ms}, but the requested two-digit display is
  // hundredths rather than three-digit milliseconds: 6.99 seconds -> "06:99".
  const ms = Math.floor((clock ? nowDate.getMilliseconds() : total % 1000) / 10)
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
  // Localized weekday name for {dddd} (Monday) / {ddd} (Mon), following dateLocale
  // exactly like the month names do.
  const weekdayName = (style: 'long' | 'short'): string => {
    try {
      return target.toLocaleDateString(locale, { weekday: style })
    } catch {
      return ''
    }
  }
  // AM/PM for the instant the other date tokens describe (today in clock mode, the
  // target otherwise). Braces are required — a bare "A" would collide with ordinary
  // copy like "A GREAT DEAL".
  const meridiem = target.getHours() < 12 ? 'AM' : 'PM'
  // {holiday} / {promo} resolve against TODAY (the viewer's local date), never the
  // countdown's target: a "3 days from now" offer still announces today's promo.
  // Outside the calendar the label is empty, which is what a showWhen:'holiday'
  // element hides on.
  const holiday = /\{holiday\}|\{promo\}/.test(fmt) ? promoLabelFor(now) : ''
  const out = fmt
    .replace(/\{holiday\}/g, holiday)
    .replace(/\{promo\}/g, holiday)
    .replace(/\{A\}/g, meridiem)
    .replace(/\{a\}/g, meridiem.toLowerCase())
    .replace(/\{date\}/g, dateStr)
    // Weekday names. Both must be replaced before the {dd}/{d} duration tokens below:
    // the brace patterns don't actually overlap, but keeping the four-then-three order
    // is what stops "{dddd}" from ever being read as a shorter token.
    .replace(/\{dddd\}/g, weekdayName('long'))
    .replace(/\{ddd\}/g, weekdayName('short'))
    .replace(/\{MMMM\}/g, monthName('long'))
    .replace(/\{MMM\}/g, monthName('short'))
    .replace(/\{MM\}/g, pad(target.getMonth() + 1))
    .replace(/\{M\}/g, String(target.getMonth() + 1))
    // {Do} = day with its ordinal suffix ("21st"); {o} = the bare suffix, so "{D}{o}" and
    // "{DD}{o}" compose too. Both must precede {DD}/{D} in this chain — not because the
    // literal patterns overlap (they don't) but so the ordering reads day-tokens-together.
    .replace(/\{Do\}/g, String(target.getDate()) + ordinalSuffix(target.getDate()))
    .replace(/\{o\}/g, ordinalSuffix(target.getDate()))
    .replace(/\{DD\}/g, pad(target.getDate()))
    .replace(/\{D\}/g, String(target.getDate()))
    .replace(/\{YYYY\}/g, String(target.getFullYear()))
    .replace(/\{YY\}/g, pad(target.getFullYear() % 100))
    .replace(/\{dd\}/g, pad(d))
    .replace(/\{hh\}/g, pad(h))
    .replace(/\{mm\}/g, pad(m))
    .replace(/\{ss\}/g, pad(s))
    .replace(/\{ms\}/g, pad(ms))
    .replace(/\{d\}/g, String(d))
    .replace(/\{h\}/g, String(h))
    .replace(/\{m\}/g, String(m))
    .replace(/\{s\}/g, String(s))
  return applyCase(out, effectiveCase(opts))
}
