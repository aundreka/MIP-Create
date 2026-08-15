// Font asset ids double as CSS family names, and ids come from the uploaded
// filename — so a hash-named upload like `068ad4a6548dab7c.otf` produces a family
// starting with a digit. Unquoted, CSS rejects it and the text silently renders in
// the browser's default serif even though the face loaded fine.

import { describe, it, expect } from 'vitest'
import { cssFontFamily } from './font'

describe('cssFontFamily', () => {
  it('quotes a digit-leading asset id (the family CSS would otherwise drop)', () => {
    expect(cssFontFamily('068ad4a6548dab7c')).toBe('"068ad4a6548dab7c"')
  })

  it('quotes a name carrying punctuation', () => {
    expect(cssFontFamily('Exposure[-30]')).toBe('"Exposure[-30]"')
  })

  it('leaves a plain identifier alone', () => {
    expect(cssFontFamily('Poppins')).toBe('Poppins')
    expect(cssFontFamily('Helvetica_Neue-Bold')).toBe('Helvetica_Neue-Bold')
  })

  it('leaves multi-word and generic families unquoted', () => {
    expect(cssFontFamily('Times New Roman')).toBe('Times New Roman')
    expect(cssFontFamily('sans-serif')).toBe('sans-serif')
    expect(cssFontFamily('system-ui')).toBe('system-ui')
  })

  it('keeps a hand-typed fallback stack a stack, quoting only what needs it', () => {
    expect(cssFontFamily('Poppins, sans-serif')).toBe('Poppins,sans-serif')
    expect(cssFontFamily('068abc, Arial, sans-serif')).toBe('"068abc",Arial,sans-serif')
  })

  it('preserves families the author already quoted, commas and all', () => {
    expect(cssFontFamily('"Segoe UI", Roboto')).toBe('"Segoe UI",Roboto')
    expect(cssFontFamily('"Foo, Bar", serif')).toBe('"Foo, Bar",serif')
  })

  it('escapes quotes rather than emitting a broken declaration', () => {
    expect(cssFontFamily('12"font')).toBe('"12\\"font"')
  })

  it('returns empty for a missing value so callers can fall back', () => {
    expect(cssFontFamily(undefined)).toBe('')
    expect(cssFontFamily('')).toBe('')
    expect(cssFontFamily('  ')).toBe('')
  })
})
