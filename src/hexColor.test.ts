// The hex code every colour picker accepts (Swatches' typed-hex field).

import { describe, expect, it } from 'vitest'
import { normalizeHex } from './ui'

describe('normalizeHex', () => {
  it('takes 6- and 8-digit codes with or without the hash', () => {
    expect(normalizeHex('#1B2A4A')).toBe('#1b2a4a')
    expect(normalizeHex('1b2a4a')).toBe('#1b2a4a')
    expect(normalizeHex('  #1b2a4a  ')).toBe('#1b2a4a')
    expect(normalizeHex('#1b2a4a80')).toBe('#1b2a4a80')
  })

  it('expands 3- and 4-digit shorthand', () => {
    expect(normalizeHex('f00')).toBe('#ff0000')
    expect(normalizeHex('#FFF')).toBe('#ffffff')
    expect(normalizeHex('#f00a')).toBe('#ff0000aa')
  })

  it('rejects anything that is not a hex colour', () => {
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex('#')).toBeNull()
    expect(normalizeHex('#12')).toBeNull()
    expect(normalizeHex('#1234567')).toBeNull()
    expect(normalizeHex('rebeccapurple')).toBeNull()
    expect(normalizeHex('rgb(1,2,3)')).toBeNull()
  })
})
