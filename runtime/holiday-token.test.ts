// The {holiday} token: the shared countdown formatter resolves it against the
// viewer's LOCAL date through the promo calendar registry. Because it lives in
// renderCountdownFormat, the element, the pinned header band, the countdown-ring
// label and the scratch-grid cell date all speak it.

import { describe, it, expect, beforeEach } from 'vitest'
import { formatCountdown, needsMidnightRefresh, nextMidnight, renderCountdownFormat, setNowOverride } from './elements/countdown'
import { localDateKey, nextPromoBoundary, promoLabelFor, setPromoCalendar } from './elements/promoCalendar'
import type { SceneElement } from './scene'

// Four real rows from the 2026 promo calendar, including the longest label.
const CALENDAR = [
  { start: '2026-07-06', end: '2026-08-30', label: 'Summer Sale' },
  { start: '2026-08-31', end: '2026-09-07', label: 'Labor Day Sale' },
  { start: '2026-09-08', end: '2026-09-21', label: 'Summer Sale' },
  { start: '2026-11-23', end: '2026-11-30', label: 'Thanksgiving, Black Friday & Cyber Monday Sale' },
]

// Local noon on a given day — never Date.parse('YYYY-MM-DD'), which is UTC.
const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime()

const el = (format: string, extra: Record<string, unknown> = {}): SceneElement => ({
  id: 'cd', type: 'countdown', name: 'cd', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit',
  countdown: { mode: 'dynamic', dynamicDays: 3, format, ...extra },
})

describe('promo calendar registry', () => {
  beforeEach(() => {
    setPromoCalendar(CALENDAR)
    setNowOverride(null)
  })

  it('reads the label from the viewer local date, both ends inclusive', () => {
    expect(promoLabelFor(at(2026, 8, 31))).toBe('Labor Day Sale') // first day
    expect(promoLabelFor(at(2026, 9, 7))).toBe('Labor Day Sale') // last day
    expect(promoLabelFor(at(2026, 9, 8))).toBe('Summer Sale') // the day after
    expect(promoLabelFor(at(2026, 8, 30))).toBe('Summer Sale') // the day before
  })

  it('is empty outside the calendar, which is what hides a holiday element', () => {
    expect(promoLabelFor(at(2028, 1, 1))).toBe('')
    expect(promoLabelFor(at(2026, 10, 1))).toBe('') // a gap between the rows above
  })

  it('holds the label right up to local midnight and flips on the far side of it', () => {
    expect(promoLabelFor(at(2026, 9, 7, 23))).toBe('Labor Day Sale')
    expect(promoLabelFor(at(2026, 9, 7, 23) + 2 * 3600000)).toBe('Summer Sale')
  })

  // Date.parse('2026-09-08') is UTC midnight, which is still Sep 7 in the Americas —
  // exactly the bug the local-key comparison exists to prevent.
  it('keys on the device date, not on a UTC parse of the string', () => {
    expect(localDateKey(at(2026, 9, 8, 0))).toBe('2026-09-08')
    expect(localDateKey(at(2026, 9, 8, 23))).toBe('2026-09-08')
  })

  it('names the next boundary: the day after the period ends, or the next period start', () => {
    expect(nextPromoBoundary(at(2026, 9, 1))).toBe(at(2026, 9, 8, 0))
    expect(nextPromoBoundary(at(2026, 10, 1))).toBe(at(2026, 11, 23, 0)) // in a gap
    expect(nextPromoBoundary(at(2028, 1, 1))).toBeUndefined() // calendar exhausted
  })

  it('drops malformed rows instead of blanking the creative', () => {
    setPromoCalendar([
      { start: 'nope', end: '2026-09-07', label: 'Bad' },
      { start: '2026-09-08', end: '2026-09-01', label: 'Backwards' },
      { start: '2026-08-31', end: '2026-09-07', label: 'Labor Day Sale' },
    ] as never)
    expect(promoLabelFor(at(2026, 9, 1))).toBe('Labor Day Sale')
  })

  it('an empty / absent calendar renders an empty label rather than throwing', () => {
    setPromoCalendar(undefined)
    expect(promoLabelFor(at(2026, 9, 1))).toBe('')
    expect(renderCountdownFormat('{holiday}', at(2026, 9, 1), at(2026, 9, 1))).toBe('')
  })
})

describe('{holiday} in the shared formatter', () => {
  beforeEach(() => {
    setPromoCalendar(CALENDAR)
    setNowOverride(null)
  })

  it('renders the calendar copy verbatim', () => {
    const t = at(2026, 9, 1)
    expect(renderCountdownFormat('{holiday}', t, t)).toBe('Labor Day Sale')
    expect(renderCountdownFormat('{promo}', t, t)).toBe('Labor Day Sale') // alias
    expect(renderCountdownFormat('Shop the {holiday} now', t, t)).toBe('Shop the Labor Day Sale now')
  })

  it('honours textCase like every other token', () => {
    const t = at(2026, 9, 1)
    expect(renderCountdownFormat('{holiday}', t, t, { textCase: 'upper' })).toBe('LABOR DAY SALE')
    expect(renderCountdownFormat('{holiday}', t, t, { textCase: 'lower' })).toBe('labor day sale')
  })

  // The element's target is 3 days out; the promo it announces is still TODAY's.
  it('resolves against today, not the countdown target', () => {
    const now = at(2026, 9, 7) // last day of Labor Day Sale
    const deadline = now + 3 * 86400000 // Sep 10 — inside "Summer Sale"
    expect(formatCountdown(el('{holiday} ends {date}'), deadline, now)).toBe('Labor Day Sale ends Sep 10, 2026')
  })

  it('composes with a live timer without disturbing the remaining time', () => {
    const now = at(2026, 9, 1)
    expect(formatCountdown(el('{holiday} — {hh}:{mm}:{ss}', { mode: 'timer' }), now + 3661000, now)).toBe('Labor Day Sale — 01:01:01')
  })

  it('leaves an unknown-looking literal alone', () => {
    const t = at(2026, 9, 1)
    expect(renderCountdownFormat('holiday {holiday}', t, t)).toBe('holiday Labor Day Sale')
  })
})

describe('preview date (setNowOverride)', () => {
  beforeEach(() => {
    setPromoCalendar(CALENDAR)
    setNowOverride(null)
  })

  it('renders the holiday of the previewed day', () => {
    setNowOverride(at(2026, 11, 23))
    expect(formatCountdown(el('{holiday}'), Date.now(), Date.now())).toBe('Thanksgiving, Black Friday & Cyber Monday Sale')
    setNowOverride(at(2026, 9, 1))
    expect(formatCountdown(el('{holiday}'), Date.now(), Date.now())).toBe('Labor Day Sale')
    setNowOverride(null)
  })

  // Both instants shift together, so a timer keeps counting what it really has left.
  it('shifts the date without changing a countdown duration', () => {
    setNowOverride(at(2026, 11, 23))
    const now = Date.now()
    expect(formatCountdown(el('{hh}:{mm}:{ss}', { mode: 'timer' }), now + 3661000, now)).toBe('01:01:01')
    expect(formatCountdown(el('{holiday}\n{hh}:{mm}', { mode: 'timer' }), now + 60000, now)).toBe('Thanksgiving, Black Friday & Cyber Monday Sale\n00:01')
    setNowOverride(null)
  })

  it('a cleared override goes straight back to the real clock', () => {
    setNowOverride(at(2026, 11, 23))
    setNowOverride(null)
    expect(formatCountdown(el('{holiday}'), Date.now(), Date.now())).toBe(promoLabelFor(Date.now()))
  })
})

describe('needsMidnightRefresh', () => {
  it('is true for the holiday token and for every date part', () => {
    for (const fmt of ['{holiday}', '{promo}', 'Order by {date}', 'Ends MMMM Do', '{DD}.{MM}', '{YYYY}'])
      expect(needsMidnightRefresh(fmt)).toBe(true)
  })

  it('is false for pure timer formats and literals', () => {
    for (const fmt of ['{hh}:{mm}:{ss}', '{d}d {hh}h', 'Buy 1 Get 1 Free', '{ss}:{ms}'])
      expect(needsMidnightRefresh(fmt)).toBe(false)
  })

  it('nextMidnight is the viewer own next 12am', () => {
    const now = at(2026, 9, 7, 23)
    expect(nextMidnight(now)).toBe(at(2026, 9, 8, 0))
    expect(nextMidnight(at(2026, 12, 31, 20))).toBe(at(2027, 1, 1, 0))
  })
})
