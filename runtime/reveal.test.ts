import { describe, it, expect } from 'vitest'
import { clamp, formatMoney, resolveAmount } from './reveal'
import type { RevealConfig } from './scene'

describe('formatMoney', () => {
  it('formats with the default $ to 2 dp', () => {
    expect(formatMoney(7.99)).toBe('$7.99')
    expect(formatMoney(0)).toBe('$0.00')
    expect(formatMoney(17.98)).toBe('$17.98')
  })
  it('honors a custom currency', () => {
    expect(formatMoney(5, '€')).toBe('€5.00')
  })
  it('rounds float drift to 2 dp', () => {
    // 7.99 + 9.99 + 12.99 = 30.97 but FP gives 30.970000000000002
    expect(formatMoney(7.99 + 9.99 + 12.99)).toBe('$30.97')
  })
})

describe('resolveAmount', () => {
  const fixedRng = (): number => 0.5

  it('uses an explicit amount when set', () => {
    expect(resolveAmount({ amount: 59.99 } as RevealConfig, fixedRng)).toBe(59.99)
    expect(resolveAmount({ amount: 0, randMin: 1, randMax: 9 } as RevealConfig, fixedRng)).toBe(0)
  })
  it('draws a 2-dp random amount from [randMin,randMax]', () => {
    // 4 + 0.5*(14-4) = 9
    expect(resolveAmount({ randMin: 4, randMax: 14 } as RevealConfig, fixedRng)).toBe(9)
  })
  it('returns 0 when nothing is configured', () => {
    expect(resolveAmount({} as RevealConfig, fixedRng)).toBe(0)
  })
  it('stays within the configured range for any rng output', () => {
    for (const r of [0, 0.01, 0.37, 0.99, 1]) {
      const v = resolveAmount({ randMin: 4.99, randMax: 14.99 } as RevealConfig, () => r)
      expect(v).toBeGreaterThanOrEqual(4.99)
      expect(v).toBeLessThanOrEqual(14.99)
    }
  })
})

describe('tally accumulation', () => {
  it('sums per-target amounts into a running total that formats cleanly', () => {
    const rng = (): number => 0.5
    const targets: RevealConfig[] = [{ amount: 7.99 }, { amount: 9.99 }, { amount: 12.99 }, { amount: 59.99, big: true }]
    let sum = 0
    const display: string[] = []
    for (const t of targets) {
      sum += resolveAmount(t, rng)
      display.push(formatMoney(sum))
    }
    expect(display).toEqual(['$7.99', '$17.98', '$30.97', '$90.96'])
  })
})

describe('clamp', () => {
  it('bounds a value to [lo,hi]', () => {
    expect(clamp(0.5, 0.15, 0.95)).toBe(0.5)
    expect(clamp(-1, 0.15, 0.95)).toBe(0.15)
    expect(clamp(2, 0.15, 0.95)).toBe(0.95)
  })
})
