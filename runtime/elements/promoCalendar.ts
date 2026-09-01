// The promo calendar the {holiday} token reads. A project carries the rows in
// meta.promoCalendar (seeded by the editor — see src/promoCalendar.ts); the
// runtime ships NO data of its own, so a MIP that never uses the feature pays
// nothing for it. Registered exactly where setActiveLocale / setDesign are:
// index.ts boot() for exports, frame.ts render()/play() for the editor.

import type { PromoCalendarEntry } from '../scene'

let entries: PromoCalendarEntry[] = []

/** Local-date key 'YYYY-MM-DD' for an instant, in the DEVICE's timezone.
 * Deliberately not Date.parse('YYYY-MM-DD'), which is parsed as UTC and would
 * flip the label a few hours early or late depending on the viewer's offset. */
export function localDateKey(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Local midnight of the day `key` names, offset by `plusDays`. The date arithmetic
 * runs through the Date constructor (not +86400000) so a period that ends across a
 * DST switch still rolls over at the viewer's own midnight. */
function keyToMs(key: string, plusDays = 0): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, (d || 1) + plusDays).getTime()
}

const isKey = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Install the project's calendar. Rows without a well-formed start/end/label are
 * dropped rather than throwing — a half-typed CSV must never blank the creative. */
export function setPromoCalendar(next: PromoCalendarEntry[] | null | undefined): void {
  entries = (next ?? [])
    .filter((e) => e && isKey(e.start) && isKey(e.end) && typeof e.label === 'string' && e.start <= e.end)
    .map((e) => ({ start: e.start, end: e.end, label: e.label }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
}

/** The rows currently installed (read-only view; used by the editor's status line). */
export function getPromoCalendar(): readonly PromoCalendarEntry[] {
  return entries
}

/** The entry covering the viewer's local date, or undefined outside the calendar.
 * Both ends are INCLUSIVE, and the zero-padded ISO keys compare lexicographically. */
export function promoEntryFor(nowMs: number): PromoCalendarEntry | undefined {
  const key = localDateKey(nowMs)
  return entries.find((e) => e.start <= key && key <= e.end)
}

/** The label for today, or '' outside the calendar — which is what makes a
 * `showWhen: 'holiday'` element hide itself and its fallback sibling appear. */
export function promoLabelFor(nowMs: number): string {
  return promoEntryFor(nowMs)?.label ?? ''
}

/** The next instant the label can change: local midnight of the day after the
 * current period ends, or of the next period's start when today is in a gap.
 * Undefined once the calendar is exhausted (nothing left to change to). */
export function nextPromoBoundary(nowMs: number): number | undefined {
  const key = localDateKey(nowMs)
  const here = entries.find((e) => e.start <= key && key <= e.end)
  if (here) return keyToMs(here.end, 1) // midnight opening the day after the last day
  const next = entries.find((e) => e.start > key)
  return next ? keyToMs(next.start) : undefined
}
