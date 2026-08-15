// The countdown ELEMENT's format field accepts bare date tokens (MM.D) exactly
// like the header and the scratch-cell date — all three normalize via
// braceBareTokens before rendering.

import { describe, it, expect } from 'vitest'
import { formatCountdown, formatTickerIntervalMs } from './countdown'
import type { SceneElement } from '../scene'

const el = (format: string): SceneElement => ({
  id: 'cd', type: 'countdown', name: 'cd', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit',
  countdown: { mode: 'dynamic', dynamicDays: 0, format },
})

// July 16, 2026 (local time)
const T = new Date(2026, 6, 16, 12, 0, 0).getTime()

describe('countdown element bare date tokens', () => {
  it('renders MM.D without braces', () => {
    expect(formatCountdown(el('MM.D'), T, T)).toBe('07.16')
  })

  it('renders bare month names and years', () => {
    expect(formatCountdown(el('MMM D, YYYY'), T, T)).toBe('Jul 16, 2026')
  })

  it('leaves braced timer tokens working as before', () => {
    expect(formatCountdown(el('{mm}:{ss}'), T + 65000, T)).toBe('01:05')
  })

  it('renders two-digit hundredths with {ms}', () => {
    expect(formatCountdown(el('{ss}:{ms}'), T + 6990, T)).toBe('06:99')
    expect(formatTickerIntervalMs('{ss}:{ms}')).toBe(10)
    expect(formatTickerIntervalMs('{mm}:{ss}')).toBe(1000)
  })

  it('does not eat literal words', () => {
    expect(formatCountdown(el('Ends DD'), T, T)).toBe('Ends 16')
    expect(formatCountdown(el('DAY D'), T, T)).toBe('DAY 16')
  })

  it('preserves newlines in the format field', () => {
    expect(formatCountdown(el('Ends\nMMM D'), T, T)).toBe('Ends\nJul 16')
  })
})
