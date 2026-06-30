import { describe, it, expect } from 'vitest'
import { parseResultsCsv } from './results'

describe('parseResultsCsv', () => {
  it('detects headers fuzzily and parses numbers (strips % $ ,)', () => {
    const rows = parseResultsCsv('Creative,Network,IPM,CTR,Installs\nBioma_MIP3_al,AppLovin,8.2,1.9%,"1,240"')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ creative: 'Bioma_MIP3_al', network: 'AppLovin', ipm: 8.2, ctr: 1.9, installs: 1240 })
  })
  it('falls back to the first column for the creative name', () => {
    const rows = parseResultsCsv('thing,ipm\nfoo,5')
    expect(rows[0].creative).toBe('foo')
    expect(rows[0].ipm).toBe(5)
  })
  it('ignores empty lines and rows without a creative', () => {
    expect(parseResultsCsv('creative,ipm\n\n,3')).toHaveLength(0)
  })
})
