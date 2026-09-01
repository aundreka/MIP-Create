// The promo calendar the {holiday} token reads: which sale is running on any given
// day. Editor-owned — the runtime ships no rows of its own, so a project pays the
// ~3 KB only once a holiday element puts them in meta.promoCalendar.
//
// DEFAULT_PROMO_CALENDAR is the 2026-2027 US retail calendar (58 periods, back to
// back from 2026-01-01 to 2027-12-31): every day of those two years produces a label,
// with generic "Winter Sale" / "Spring Sale" rows filling the stretches between named
// holidays. Outside it the label is empty and a `showWhen: 'holiday'` element hides.
// A client with its own schedule replaces the whole thing via Import CSV.

import type { PromoCalendarEntry, Project } from '../runtime/scene'

// [start, end, label] — inclusive local dates, kept as tuples so the baked-in table
// stays compact in the editor bundle.
const DEFAULT_ROWS: [string, string, string][] = [
  ['2026-01-01', '2026-01-04', 'New Year Sale'],
  ['2026-01-05', '2026-01-15', 'Winter Sale'],
  ['2026-01-16', '2026-01-19', 'MLK Day Sale'],
  ['2026-01-20', '2026-02-10', 'Winter Sale'],
  ['2026-02-11', '2026-02-15', 'Valentine’s Day Sale'],
  ['2026-02-16', '2026-02-22', 'Presidents Day Sale'],
  ['2026-02-23', '2026-03-13', 'Winter Sale'],
  ['2026-03-14', '2026-03-17', 'St. Paddy’s Day Sale'],
  ['2026-03-18', '2026-03-19', 'Winter Sale'],
  ['2026-03-20', '2026-04-01', 'Spring Sale'],
  ['2026-04-02', '2026-04-05', 'Easter Sale'],
  ['2026-04-06', '2026-05-05', 'Spring Sale'],
  ['2026-05-06', '2026-05-10', 'Mother’s Day Sale'],
  ['2026-05-11', '2026-05-20', 'Spring Sale'],
  ['2026-05-21', '2026-05-25', 'Memorial Day Sale'],
  ['2026-05-26', '2026-06-19', 'Spring Sale'],
  ['2026-06-20', '2026-06-21', 'Father’s Day Sale'],
  ['2026-06-22', '2026-06-30', 'Summer Sale'],
  ['2026-07-01', '2026-07-05', 'July 4 Sale'],
  ['2026-07-06', '2026-08-30', 'Summer Sale'],
  ['2026-08-31', '2026-09-07', 'Labor Day Sale'],
  ['2026-09-08', '2026-09-21', 'Summer Sale'],
  ['2026-09-22', '2026-10-25', 'Fall Sale'],
  ['2026-10-26', '2026-10-31', 'Halloween Sale'],
  ['2026-11-01', '2026-11-22', 'Fall Sale'],
  ['2026-11-23', '2026-11-30', 'Thanksgiving, Black Friday & Cyber Monday Sale'],
  ['2026-12-01', '2026-12-20', 'Fall Sale'],
  ['2026-12-21', '2026-12-25', 'Christmas Sale'],
  ['2026-12-26', '2026-12-31', 'Winter Sale'],
  ['2027-01-01', '2027-01-03', 'New Year Sale'],
  ['2027-01-04', '2027-01-14', 'Winter Sale'],
  ['2027-01-15', '2027-01-18', 'MLK Day Sale'],
  ['2027-01-19', '2027-02-09', 'Winter Sale'],
  ['2027-02-10', '2027-02-14', 'Valentine’s Day Sale'],
  ['2027-02-15', '2027-02-21', 'Presidents Day Sale'],
  ['2027-02-22', '2027-03-13', 'Winter Sale'],
  ['2027-03-14', '2027-03-17', 'St. Paddy’s Day Sale'],
  ['2027-03-18', '2027-03-19', 'Winter Sale'],
  ['2027-03-20', '2027-03-24', 'Spring Sale'],
  ['2027-03-25', '2027-03-28', 'Easter Sale'],
  ['2027-03-29', '2027-05-05', 'Spring Sale'],
  ['2027-05-06', '2027-05-09', 'Mother’s Day Sale'],
  ['2027-05-10', '2027-05-20', 'Spring Sale'],
  ['2027-05-21', '2027-05-31', 'Memorial Day Sale'],
  ['2027-06-01', '2027-06-19', 'Spring Sale'],
  ['2027-06-20', '2027-06-20', 'Father’s Day Sale'],
  ['2027-06-21', '2027-06-30', 'Summer Sale'],
  ['2027-07-01', '2027-07-05', 'July 4 Sale'],
  ['2027-07-06', '2027-08-29', 'Summer Sale'],
  ['2027-08-30', '2027-09-06', 'Labor Day Sale'],
  ['2027-09-07', '2027-09-21', 'Summer Sale'],
  ['2027-09-22', '2027-10-25', 'Fall Sale'],
  ['2027-10-26', '2027-10-31', 'Halloween Sale'],
  ['2027-11-01', '2027-11-21', 'Fall Sale'],
  ['2027-11-22', '2027-11-29', 'Thanksgiving, Black Friday & Cyber Monday Sale'],
  ['2027-11-30', '2027-12-20', 'Fall Sale'],
  ['2027-12-21', '2027-12-26', 'Christmas Sale'],
  ['2027-12-27', '2027-12-31', 'Winter Sale'],
]

export const DEFAULT_PROMO_CALENDAR: PromoCalendarEntry[] = DEFAULT_ROWS.map(([start, end, label]) => ({ start, end, label }))

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

// The delivered calendar is a spreadsheet export:
//   Year,Start Date,End Date,Promo,Key Holiday Dates
//   2026,2026-08-31,2026-09-07,"Labor Day Sale","Labor Day: Sep 7"
// Only Start/End/Promo are read; Year is redundant with the dates and the Key
// Holiday Dates column is a human note. Columns are located BY HEADER NAME, so a
// sheet that carries extra columns (or reorders them) still imports.

/** Split one CSV line, honoring "quoted, fields" and "" escapes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

// Sheets and word processors turn a typed apostrophe into U+2019 ("Valentine's Day"
// → "Valentine’s Day"). Both forms are legal ad copy, so the label is passed through
// verbatim — this only normalizes the whitespace around it.
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface PromoCsvResult {
  entries: PromoCalendarEntry[]
  /** Rows that could not be read, by 1-based line number in the file. */
  skipped: { line: number; reason: string }[]
}

/**
 * Parse a promo-calendar CSV into entries, sorted by start date. Unreadable rows are
 * REPORTED rather than thrown on, so one bad line in a 60-row sheet still imports the
 * other 59 and tells the designer which one to fix.
 */
export function parsePromoCsv(text: string): PromoCsvResult {
  // \uFEFF written as an escape, not the literal char: a raw BOM in source is invisible.
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
  const entries: PromoCalendarEntry[] = []
  const skipped: { line: number; reason: string }[] = []

  // Locate the header row (the first line naming a start column). A file with no
  // header at all is read positionally as start,end,label.
  let headerAt = -1
  let cols = { start: 0, end: 1, label: 2 }
  for (let i = 0; i < lines.length && i < 10; i++) {
    const cells = splitCsvLine(lines[i]).map((c) => clean(c).toLowerCase())
    const start = cells.findIndex((c) => c === 'start date' || c === 'start')
    if (start < 0) continue
    const end = cells.findIndex((c) => c === 'end date' || c === 'end')
    const label = cells.findIndex((c) => c === 'promo' || c === 'label' || c === 'promo text')
    if (end < 0 || label < 0) continue
    headerAt = i
    cols = { start, end, label }
    break
  }

  for (let i = headerAt + 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) continue
    const cells = splitCsvLine(raw)
    const start = clean(cells[cols.start] ?? '')
    const end = clean(cells[cols.end] ?? '')
    const label = clean(cells[cols.label] ?? '')
    if (!DATE.test(start) || !DATE.test(end)) {
      skipped.push({ line: i + 1, reason: 'start/end must be YYYY-MM-DD' })
      continue
    }
    if (end < start) {
      skipped.push({ line: i + 1, reason: 'end date is before the start date' })
      continue
    }
    if (!label) {
      skipped.push({ line: i + 1, reason: 'no promo text' })
      continue
    }
    entries.push({ start, end, label })
  }
  entries.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  return { entries, skipped }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface CalendarProblem {
  level: 'error' | 'warn'
  message: string
}

/**
 * Structural check on a calendar: overlapping periods are an ERROR (the runtime takes
 * the first match, so the second row would silently never render), gaps are a WARNING
 * (legal — the label goes empty and a `noHoliday` element covers it — but usually a
 * mistake in a sheet meant to be continuous).
 */
export function validatePromoCalendar(entries: readonly PromoCalendarEntry[]): CalendarProblem[] {
  const problems: CalendarProblem[] = []
  if (!entries.length) return [{ level: 'warn', message: 'The calendar is empty — {holiday} renders nothing.' }]
  const sorted = [...entries].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (cur.start <= prev.end) {
      problems.push({ level: 'error', message: `${cur.start} “${cur.label}” overlaps ${prev.start}–${prev.end} “${prev.label}” — the earlier row wins and this one never shows.` })
    } else if (dayAfter(prev.end) !== cur.start) {
      problems.push({ level: 'warn', message: `Gap between ${prev.end} and ${cur.start} — no label on those days.` })
    }
  }
  return problems
}

/** The 'YYYY-MM-DD' key of the day after `key`, via the Date constructor so month,
 * year and leap-day rollovers are the calendar's problem and not ours. */
export function dayAfter(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const next = new Date(y, (m || 1) - 1, (d || 1) + 1)
  const p = (n: number): string => (n < 10 ? '0' + n : String(n))
  return `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())}`
}

/** First and last date the calendar covers, for the editor's status lines. */
export function calendarRange(entries: readonly PromoCalendarEntry[]): { first: string; last: string } | null {
  if (!entries.length) return null
  let first = entries[0].start
  let last = entries[0].end
  for (const e of entries) {
    if (e.start < first) first = e.start
    if (e.end > last) last = e.end
  }
  return { first, last }
}

/** Does the calendar cover every day from `fromKey` for the next 12 months? Used by
 * preflight: a MIP delivered in November whose calendar stops on Dec 31 will render an
 * empty label for most of its flight. */
export function coversYearFrom(entries: readonly PromoCalendarEntry[], fromKey: string): boolean {
  const range = calendarRange(entries)
  if (!range) return false
  const [y, m, d] = fromKey.split('-').map(Number)
  const p = (n: number): string => (n < 10 ? '0' + n : String(n))
  const end = new Date(y + 1, (m || 1) - 1, d || 1)
  const endKey = `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}`
  return range.first <= fromKey && range.last >= endKey
}

/** The label a calendar gives one local date ('YYYY-MM-DD'), or '' when nothing covers
 * it. The editor-side twin of the runtime's promoLabelFor — same rule (inclusive ends,
 * lexicographic ISO compare), but reading a passed-in array instead of the runtime's
 * registered one, since the editor and the render iframe are separate module instances. */
export function labelForDate(entries: readonly PromoCalendarEntry[], key: string): string {
  return entries.find((e) => e.start <= key && key <= e.end)?.label ?? ''
}

const HOLIDAY_TOKEN = /\{holiday\}|\{promo\}/

/** Does anything in this MIP render the promo calendar — an element's countdown format,
 * or the pinned header's date format (base or per-locale)? Preflight reports on it, and
 * export drops the calendar rows from a MIP that answers no. */
export function usesHolidayToken(project: Project): boolean {
  if (HOLIDAY_TOKEN.test(project.meta.header?.dateFormat ?? '')) return true
  for (const header of Object.values(project.meta.headerI18n ?? {})) if (HOLIDAY_TOKEN.test(header.dateFormat ?? '')) return true
  return project.scenes.some((s) => s.elements.some((e) => HOLIDAY_TOKEN.test(e.countdown?.format ?? '')))
}
