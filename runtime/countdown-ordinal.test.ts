// Ordinal day tokens — {Do} ("21st") and the bare suffix {o} ("st").
//
// The rule worth pinning is the teens exception: 11/12/13 take "th" even though they
// end in 1/2/3, so a naive unit-digit lookup renders "11st" / "12nd" / "13rd".

import { describe, it, expect } from 'vitest'
import { braceBareTokens, ordinalSuffix, renderCountdownFormat } from './elements/countdown'

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
