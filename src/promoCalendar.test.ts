// The editor's promo-calendar data: the baked-in 2026–2027 default, the CSV importer
// a client's own schedule arrives through, and the structural check the inspector and
// preflight both report from.

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PROMO_CALENDAR,
  calendarRange,
  coversYearFrom,
  dayAfter,
  parsePromoCsv,
  validatePromoCalendar,
} from './promoCalendar'
import { promoLabelFor, setPromoCalendar } from '../runtime/elements/promoCalendar'

const at = (y: number, m: number, d: number): number => new Date(y, m - 1, d, 12).getTime()

describe('DEFAULT_PROMO_CALENDAR', () => {
  it('covers 2026-01-01 to 2027-12-31 with no gap and no overlap', () => {
    expect(DEFAULT_PROMO_CALENDAR).toHaveLength(58)
    expect(calendarRange(DEFAULT_PROMO_CALENDAR)).toEqual({ first: '2026-01-01', last: '2027-12-31' })
    expect(validatePromoCalendar(DEFAULT_PROMO_CALENDAR)).toEqual([])
  })

  it('every row carries copy, so no day inside it renders blank', () => {
    for (const e of DEFAULT_PROMO_CALENDAR) expect(e.label.length).toBeGreaterThan(0)
  })

  it('reads the way the peakfootwear spec describes it', () => {
    setPromoCalendar(DEFAULT_PROMO_CALENDAR)
    expect(promoLabelFor(at(2026, 8, 31))).toBe('Labor Day Sale')
    expect(promoLabelFor(at(2026, 9, 7))).toBe('Labor Day Sale')
    expect(promoLabelFor(at(2026, 9, 8))).toBe('Summer Sale')
    expect(promoLabelFor(at(2026, 11, 26))).toBe('Thanksgiving, Black Friday & Cyber Monday Sale')
    expect(promoLabelFor(at(2027, 12, 25))).toBe('Christmas Sale')
    expect(promoLabelFor(at(2028, 1, 1))).toBe('') // past the end of the calendar
  })
})

const CSV = `Year,Start Date,End Date,Promo,Key Holiday Dates
2026,2026-08-31,2026-09-07,"Labor Day Sale","Labor Day: Sep 7"
2026,2026-09-08,2026-09-21,"Summer Sale","—"
2026,2026-11-23,2026-11-30,"Thanksgiving, Black Friday & Cyber Monday Sale","Thanksgiving: Nov 26"
`

describe('parsePromoCsv', () => {
  it('reads start/end/promo out of the delivered sheet', () => {
    const { entries, skipped } = parsePromoCsv(CSV)
    expect(skipped).toEqual([])
    expect(entries).toEqual([
      { start: '2026-08-31', end: '2026-09-07', label: 'Labor Day Sale' },
      { start: '2026-09-08', end: '2026-09-21', label: 'Summer Sale' },
      { start: '2026-11-23', end: '2026-11-30', label: 'Thanksgiving, Black Friday & Cyber Monday Sale' },
    ])
  })

  it('keeps a comma inside a quoted label instead of splitting on it', () => {
    expect(parsePromoCsv(CSV).entries[2].label).toContain('Thanksgiving, Black Friday')
  })

  it('keeps typographic apostrophes verbatim — they are the ad copy', () => {
    const { entries } = parsePromoCsv(`Start Date,End Date,Promo\n2026-02-11,2026-02-15,"Valentine’s Day Sale"\n`)
    expect(entries[0].label).toBe('Valentine’s Day Sale')
  })

  it('locates columns by name, so extra or reordered columns still import', () => {
    const { entries } = parsePromoCsv(`Notes,Promo,End Date,Start Date\nx,"Fall Sale",2026-10-25,2026-09-22\n`)
    expect(entries).toEqual([{ start: '2026-09-22', end: '2026-10-25', label: 'Fall Sale' }])
  })

  it('falls back to start,end,label order when the file has no header', () => {
    const { entries } = parsePromoCsv(`2026-09-22,2026-10-25,Fall Sale\n`)
    expect(entries).toEqual([{ start: '2026-09-22', end: '2026-10-25', label: 'Fall Sale' }])
  })

  it('handles CRLF, a BOM, blank lines and a "" escape', () => {
    const { entries, skipped } = parsePromoCsv('﻿Start Date,End Date,Promo\r\n\r\n2026-07-01,2026-07-05,"The ""Big"" Sale"\r\n')
    expect(skipped).toEqual([])
    expect(entries[0].label).toBe('The "Big" Sale')
  })

  it('sorts by start date whatever order the sheet is in', () => {
    const { entries } = parsePromoCsv(`Start Date,End Date,Promo\n2026-11-23,2026-11-30,B\n2026-08-31,2026-09-07,A\n`)
    expect(entries.map((e) => e.label)).toEqual(['A', 'B'])
  })

  // One bad line must not cost the designer the other fifty-nine.
  it('reports unreadable rows by line number and imports the rest', () => {
    const { entries, skipped } = parsePromoCsv(
      `Start Date,End Date,Promo\n2026-08-31,2026-09-07,Good\nnot-a-date,2026-09-21,Bad date\n2026-10-05,2026-10-01,Backwards\n2026-11-01,2026-11-05,\n`,
    )
    expect(entries.map((e) => e.label)).toEqual(['Good'])
    expect(skipped.map((s) => s.line)).toEqual([3, 4, 5])
    expect(skipped[1].reason).toMatch(/before the start/)
    expect(skipped[2].reason).toMatch(/no promo text/)
  })

  it('round-trips the default calendar through its own CSV shape', () => {
    const csv = ['Start Date,End Date,Promo', ...DEFAULT_PROMO_CALENDAR.map((e) => `${e.start},${e.end},"${e.label}"`)].join('\n')
    expect(parsePromoCsv(csv).entries).toEqual(DEFAULT_PROMO_CALENDAR)
  })
})

describe('validatePromoCalendar', () => {
  it('is silent on a continuous calendar', () => {
    expect(validatePromoCalendar([
      { start: '2026-01-01', end: '2026-01-04', label: 'A' },
      { start: '2026-01-05', end: '2026-01-15', label: 'B' },
    ])).toEqual([])
  })

  it('errors on an overlap, because the second row would never render', () => {
    const out = validatePromoCalendar([
      { start: '2026-01-01', end: '2026-01-10', label: 'A' },
      { start: '2026-01-05', end: '2026-01-15', label: 'B' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].level).toBe('error')
    expect(out[0].message).toContain('never shows')
  })

  it('warns on a gap — legal, but usually a missing row', () => {
    const out = validatePromoCalendar([
      { start: '2026-01-01', end: '2026-01-04', label: 'A' },
      { start: '2026-01-10', end: '2026-01-15', label: 'B' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].level).toBe('warn')
    expect(out[0].message).toContain('2026-01-04')
  })

  it('warns on an empty calendar', () => {
    expect(validatePromoCalendar([])[0].level).toBe('warn')
  })
})

describe('date helpers', () => {
  it('dayAfter rolls months, years and leap days', () => {
    expect(dayAfter('2026-01-31')).toBe('2026-02-01')
    expect(dayAfter('2026-12-31')).toBe('2027-01-01')
    expect(dayAfter('2028-02-28')).toBe('2028-02-29') // 2028 is a leap year
  })

  it('coversYearFrom wants twelve full months from the export date', () => {
    expect(coversYearFrom(DEFAULT_PROMO_CALENDAR, '2026-09-01')).toBe(true)
    expect(coversYearFrom(DEFAULT_PROMO_CALENDAR, '2027-06-01')).toBe(false) // runs out 2027-12-31
    expect(coversYearFrom([], '2026-09-01')).toBe(false)
  })
})
