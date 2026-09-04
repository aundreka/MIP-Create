// Ordinal day tokens — {Do} ("21st") and the bare suffix {o} ("st").
//
// The rule worth pinning is the teens exception: 11/12/13 take "th" even though they
// end in 1/2/3, so a naive unit-digit lookup renders "11st" / "12nd" / "13rd".

import { describe, it, expect } from 'vitest'
import { braceBareTokens, needsMidnightRefresh, ordinalSuffix, renderCountdownFormat } from './elements/countdown'

// Local midday avoids any chance of a UTC-vs-local date rollover changing the day.
const on = (y: number, m: number, d: number): number => new Date(y, m - 1, d, 12, 0, 0).getTime()
const render = (fmt: string, at: number): string => renderCountdownFormat(braceBareTokens(fmt), at, at)

describe('ordinalSuffix', () => {
  it('follows the unit digit', () => {
    expect(ordinalSuffix(1)).toBe('st')
    expect(ordinalSuffix(2)).toBe('nd')
    expect(ordinalSuffix(3)).toBe('rd')
    expect(ordinalSuffix(4)).toBe('th')
    expect(ordinalSuffix(21)).toBe('st')
    expect(ordinalSuffix(22)).toBe('nd')
    expect(ordinalSuffix(23)).toBe('rd')
    expect(ordinalSuffix(31)).toBe('st')
  })

  it('makes 11, 12 and 13 the exception', () => {
    expect(ordinalSuffix(11)).toBe('th')
    expect(ordinalSuffix(12)).toBe('th')
    expect(ordinalSuffix(13)).toBe('th')
  })

  it('covers every day of a month without producing a bare number', () => {
    for (let d = 1; d <= 31; d++) expect(ordinalSuffix(d)).toMatch(/^(st|nd|rd|th)$/)
  })
})

describe('{Do} / {o} rendering', () => {
  it('renders the example from the request', () => {
    expect(render('MMMM Do', on(2026, 7, 21))).toBe('July 21st')
  })

  it('works braced and bare alike', () => {
    const at = on(2026, 7, 21)
    expect(render('{MMMM} {Do}', at)).toBe('July 21st')
    expect(render('MMM Do', at)).toBe('Jul 21st')
  })

  it('composes the bare suffix with either day token', () => {
    const at = on(2026, 7, 3)
    expect(render('{D}{o}', at)).toBe('3rd')
    expect(render('{DD}{o}', at)).toBe('03rd')
  })

  it('leaves the plain day tokens alone', () => {
    const at = on(2026, 7, 21)
    expect(render('MMMM D', at)).toBe('July 21')
    expect(render('{DD}', at)).toBe('21')
  })

  it('applies the teens exception through the formatter', () => {
    expect(render('MMMM Do', on(2026, 7, 11))).toBe('July 11th')
    expect(render('MMMM Do', on(2026, 7, 12))).toBe('July 12th')
    expect(render('MMMM Do', on(2026, 7, 13))).toBe('July 13th')
  })

  it('honours text case like every other token', () => {
    const at = on(2026, 7, 21)
    expect(renderCountdownFormat(braceBareTokens('MMMM Do'), at, at, { textCase: 'upper' })).toBe('JULY 21ST')
  })

  it('does not brace a lone "o", which is likelier to be copy than a token', () => {
    expect(braceBareTokens('o')).toBe('o')
    expect(braceBareTokens('Do')).toBe('{Do}')
  })
})

describe('weekday tokens', () => {
  it('renders {dddd} spelled out and {ddd} abbreviated', () => {
    // 2026-07-21 is a Tuesday.
    const at = on(2026, 7, 21)
    expect(render('{dddd}', at)).toBe('Tuesday')
    expect(render('{ddd}', at)).toBe('Tue')
    expect(render('{dddd}, {MMMM} {Do}', at)).toBe('Tuesday, July 21st')
  })

  // Authors type these by hand, in whatever case and length feels right — "DDDD",
  // "ddddd". Any run of 3+ d's is the weekday, 3 being the only length that means the
  // abbreviation; nothing else in the vocabulary is a run of d's, so none of this is
  // ambiguous.
  it('takes any run of three or more d\'s, in either case', () => {
    const at = on(2026, 7, 21)
    expect(render('{DDDD}', at)).toBe('Tuesday')
    expect(render('{ddddd}', at)).toBe('Tuesday')
    expect(render('{DDDDD}', at)).toBe('Tuesday')
    expect(render('{DDD}', at)).toBe('Tue')
    expect(render('DDDD, MMMM D', at)).toBe('Tuesday, July 21')
    expect(render('ddddd', at)).toBe('Tuesday')
  })

  it('keeps the one- and two-letter day tokens out of it', () => {
    const now = on(2026, 7, 21)
    // {DD}/{D} stay day-of-month, {dd}/{d} stay days remaining.
    expect(render('{DD} {D}', now)).toBe('21 21')
    expect(renderCountdownFormat('{dd} {d}', now + 3 * 86400000, now, {})).toBe('03 3')
  })

  it('accepts bare weekday tokens like the other date parts', () => {
    const at = on(2026, 7, 21)
    expect(render('dddd, MMMM D', at)).toBe('Tuesday, July 21')
    expect(render('ddd MMM DD', at)).toBe('Tue Jul 21')
  })

  it('follows dateLocale', () => {
    const at = on(2026, 7, 21)
    expect(renderCountdownFormat(braceBareTokens('dddd'), at, at, { dateLocale: 'es' })).toBe('martes')
  })

  // {dddd} names the TARGET day, like every other date part — three days on from a
  // Tuesday is Friday — while {dd}/{d} stay the days remaining.
  it('leaves the {dd}/{d} duration tokens alone', () => {
    const now = on(2026, 7, 21)
    expect(renderCountdownFormat('{dddd} {dd} {d}', now + 3 * 86400000, now, {})).toBe('Friday 03 3')
  })

  it('marks a weekday format as needing the midnight refresh', () => {
    expect(needsMidnightRefresh('dddd')).toBe(true)
    expect(needsMidnightRefresh('{ddd}')).toBe(true)
    expect(needsMidnightRefresh('{mm}:{ss}')).toBe(false)
  })
})
