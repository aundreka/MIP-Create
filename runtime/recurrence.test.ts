// Recurring dynamic dates — "the next Friday", "the next weekday", "Mon, Wed or Fri".
//
// The rule worth pinning is the composition: `dynamicDays` is a head start applied
// BEFORE the weekday snap, so offset 0 can land on today while offset 1 always skips it.

import { describe, it, expect } from 'vitest'
import { computeDeadline, nextRecurrence, recurrenceDays, resolveDynamicTarget } from './elements/countdown'
import type { SceneElement } from './scene'

// Local midday keeps every case clear of a UTC-vs-local date rollover.
const on = (y: number, m: number, d: number): number => new Date(y, m - 1, d, 12, 0, 0).getTime()
const dayName = (ms: number): string => new Date(ms).toLocaleDateString('en-US', { weekday: 'long' })
const ymd = (ms: number): string => new Date(ms).toLocaleDateString('en-US')

// September 2026: the 7th is a Monday, so the 11th is a Friday and the 12th/13th the weekend.
const MON = on(2026, 9, 7)
const FRI = on(2026, 9, 11)
const SAT = on(2026, 9, 12)

describe('recurrenceDays', () => {
  it('expands the named presets', () => {
    expect(recurrenceDays('weekday')).toEqual([1, 2, 3, 4, 5])
    expect(recurrenceDays('weekend')).toEqual([0, 6])
  })

  it('passes an explicit list through and drops junk', () => {
    expect(recurrenceDays([5])).toEqual([5])
    expect(recurrenceDays([1, 3, 5])).toEqual([1, 3, 5])
    expect(recurrenceDays([7, -1, 2.5, 3])).toEqual([3])
  })

  it('is null when there is nothing to snap to', () => {
    expect(recurrenceDays(undefined)).toBeNull()
    expect(recurrenceDays([])).toBeNull()
    expect(recurrenceDays([9])).toBeNull()
    expect(recurrenceDays('nope' as 'weekday')).toBeNull()
  })
})

describe('nextRecurrence', () => {
  it('stays put when the day already matches', () => {
    expect(nextRecurrence(FRI, [5])).toBe(FRI)
  })

  it('walks forward to the next matching day', () => {
    expect(dayName(nextRecurrence(MON, [5]))).toBe('Friday')
    expect(ymd(nextRecurrence(MON, [5]))).toBe(ymd(FRI))
  })

  it('wraps into the following week', () => {
    // Saturday asking for Friday is six days out, not a week and a day.
    expect(ymd(nextRecurrence(SAT, [5]))).toBe(ymd(on(2026, 9, 18)))
  })

  it('takes the soonest day of a multi-day set', () => {
    expect(dayName(nextRecurrence(MON, [1, 3, 5]))).toBe('Monday')
    expect(dayName(nextRecurrence(on(2026, 9, 8), [1, 3, 5]))).toBe('Wednesday')
  })

  it('keeps the time of day', () => {
    const at = new Date(2026, 8, 7, 9, 30, 15)
    const out = new Date(nextRecurrence(at.getTime(), [5]))
    expect([out.getHours(), out.getMinutes(), out.getSeconds()]).toEqual([9, 30, 15])
  })
})

describe('resolveDynamicTarget', () => {
  it('is the flat offset with no recurrence — the original behaviour', () => {
    expect(ymd(resolveDynamicTarget(MON, 3))).toBe(ymd(on(2026, 9, 10)))
    expect(resolveDynamicTarget(MON, undefined)).toBe(MON)
  })

  it('applies the offset before the snap', () => {
    // Offset 0 keeps today when today already matches; offset 1 skips to next week.
    expect(ymd(resolveDynamicTarget(FRI, 0, [5]))).toBe(ymd(FRI))
    expect(ymd(resolveDynamicTarget(FRI, 1, [5]))).toBe(ymd(on(2026, 9, 18)))
  })

  it('gives the next-business-day shape', () => {
    // Friday + 1 day is Saturday, which is not a weekday → Monday.
    expect(dayName(resolveDynamicTarget(FRI, 1, 'weekday'))).toBe('Monday')
    // Monday + 1 day already is one.
    expect(dayName(resolveDynamicTarget(MON, 1, 'weekday'))).toBe('Tuesday')
  })

  it('finds the next weekend', () => {
    expect(dayName(resolveDynamicTarget(MON, 0, 'weekend'))).toBe('Saturday')
    expect(dayName(resolveDynamicTarget(SAT, 0, 'weekend'))).toBe('Saturday')
    expect(dayName(resolveDynamicTarget(SAT, 1, 'weekend'))).toBe('Sunday')
  })

  it('ignores an unusable recurrence rather than dropping the offset', () => {
    expect(ymd(resolveDynamicTarget(MON, 2, []))).toBe(ymd(on(2026, 9, 9)))
  })
})

describe('computeDeadline', () => {
  const el = (countdown: SceneElement['countdown']): SceneElement => ({ id: 'd', type: 'countdown', x: 0, y: 0, countdown }) as SceneElement

  it('snaps a dynamic date to its recurrence', () => {
    expect(dayName(computeDeadline(el({ mode: 'dynamic', dynamicDays: 0, format: '{dddd}', recur: [5] }), MON))).toBe('Friday')
  })

  it('leaves a plain dynamic date on the flat offset', () => {
    expect(ymd(computeDeadline(el({ mode: 'dynamic', dynamicDays: 3, format: '{date}' }), MON))).toBe(ymd(on(2026, 9, 10)))
  })

  it('does not touch timer or fixed-date modes', () => {
    expect(computeDeadline(el({ mode: 'timer', seconds: 60, format: '{ss}', recur: 'weekday' }), MON)).toBe(MON + 60000)
    const iso = new Date(on(2026, 9, 30)).toISOString()
    expect(computeDeadline(el({ mode: 'date', targetIso: iso, format: '{date}', recur: 'weekday' }), MON)).toBe(Date.parse(iso))
  })
})
