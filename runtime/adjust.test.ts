// Colour adjustment — the Brightness / Contrast / Saturation trio (AdjustConfig).
//
// Two things are worth pinning. First, 1 is the identity: an absent block, an all-1
// block and a block the author dragged back to 100% must all render the same pixels,
// or "reset" wouldn't actually reset. Second, the adjustment shares one CSS property
// with the layer blur AND with every keyframe that animates `filter` — so the chain is
// published as --pa-filter and those keyframes lead with it. Without that a shining
// element snaps back to unadjusted pixels the instant its loop starts, which is the
// bug this arrangement exists to prevent.

import { describe, it, expect } from 'vitest'
import { adjustFilterCss } from './scene'
import { injectAnimStyles } from './anim'

describe('adjustFilterCss', () => {
  it('emits the three functions in a fixed order, whatever order they were set in', () => {
    expect(adjustFilterCss({ saturation: 1.4, brightness: 0.8, contrast: 1.2 })).toBe('brightness(0.8) contrast(1.2) saturate(1.4)')
  })

  it('treats 1 as untouched and omits it', () => {
    expect(adjustFilterCss({ brightness: 1, contrast: 1, saturation: 1 })).toBe('')
    expect(adjustFilterCss({ brightness: 1, saturation: 0 })).toBe('saturate(0)')
  })

  it('is a no-op for an absent or empty block', () => {
    expect(adjustFilterCss(undefined)).toBe('')
    expect(adjustFilterCss({})).toBe('')
  })

  it('keeps 0 — greyscale and pure black are real settings, not "unset"', () => {
    expect(adjustFilterCss({ brightness: 0 })).toBe('brightness(0)')
    expect(adjustFilterCss({ saturation: 0 })).toBe('saturate(0)')
  })

  it('clamps negatives away and ignores junk rather than emitting invalid CSS', () => {
    expect(adjustFilterCss({ brightness: -2 })).toBe('brightness(0)')
    expect(adjustFilterCss({ contrast: Number.NaN, saturation: Number.POSITIVE_INFINITY })).toBe('')
  })

  it('rounds long fractions so the same slider always writes the same string', () => {
    expect(adjustFilterCss({ brightness: 1 / 3 })).toBe('brightness(0.333)')
  })
})

describe('the filter chain', () => {
  it('lets a filter-animating preset compose with the element’s own chain instead of wiping it', () => {
    injectAnimStyles()
    const css = document.getElementById('pa-anim')?.textContent ?? ''
    expect(css).not.toBe('')
    // shine and glow both replace `filter` for the animation's whole length, so each
    // keyframe has to lead with the element's chain (blur + adjustment).
    for (const frame of ['pa-shine', 'pa-glow']) {
      const block = css.match(new RegExp(`@keyframes ${frame}\\{(?:[^{}]*\\{[^{}]*\\})*[^{}]*\\}`))?.[0] ?? ''
      expect(block).not.toBe('')
      const filters = block.match(/filter:[^;}]*/g) ?? []
      expect(filters.length).toBeGreaterThan(0)
      for (const f of filters) expect(f).toContain('var(--pa-filter,)')
    }
  })
})
