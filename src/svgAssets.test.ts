import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME, lighten, mix, svgBackground, svgCard, themeFromColors } from './svgAssets'

describe('color helpers', () => {
  it('mixes toward white with lighten', () => {
    expect(lighten('#000000', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
  it('builds a theme from brand colors', () => {
    const t = themeFromColors(['#ff0000', '#00ff00'])
    expect(t.primary).toBe('#ff0000')
    expect(t.secondary).toBe('#00ff00')
  })
  it('falls back to the default theme with no colors', () => {
    expect(themeFromColors([])).toBe(DEFAULT_THEME)
  })
})

describe('svg generators', () => {
  it('returns sized data:image/svg+xml URLs', () => {
    const bg = svgBackground(DEFAULT_THEME, 'gradient', 1080, 1920)
    expect(bg.src.startsWith('data:image/svg+xml,')).toBe(true)
    expect(bg.w).toBe(1080)
    expect(bg.h).toBe(1920)
    expect(svgCard(DEFAULT_THEME).src.startsWith('data:image/svg+xml,')).toBe(true)
  })
})
