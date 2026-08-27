// Animation travel distances scale with the layout.
//
// The keyframe library authors its slide/bounce/float offsets in DESIGN px and
// multiplies them by --pa-s, the live FIT scale. Without that factor a "slide up
// 46px" would be a fixed SCREEN distance: a fifth of a small phone's height and a
// twentieth of a tablet's, so the same element would visibly settle from a different
// place on every viewport — and would drift relative to its own box as the editor
// canvas is zoomed. This pins the contract that computeMetrics publishes the factor
// on every metrics pass, and that the keyframes consume it.

import { describe, it, expect } from 'vitest'
import { computeMetrics, scale, setDesign } from './responsive'
import { injectAnimStyles } from './anim'

const rootVar = (): string => document.documentElement.style.getPropertyValue('--pa-s')

/** The full text of one @keyframes block, nested step braces included. */
function keyframeRule(css: string, name: string): string {
  return css.match(new RegExp(`@keyframes pa-${name}\\{(?:[^{}]*\\{[^{}]*\\})*[^{}]*\\}`))?.[0] ?? ''
}

describe('animation scale factor', () => {
  it('publishes the FIT scale on :root for every viewport', () => {
    setDesign(1080, 1920)

    computeMetrics(540, 960) // exactly half the design
    expect(Number(rootVar())).toBeCloseTo(0.5, 6)
    expect(Number(rootVar())).toBeCloseTo(scale(), 6)

    computeMetrics(1080, 1920) // 1:1
    expect(Number(rootVar())).toBeCloseTo(1, 6)

    computeMetrics(2160, 3840) // 2x — a slide must travel twice as far in screen px
    expect(Number(rootVar())).toBeCloseTo(2, 6)
  })

  it('drives the travel distance of every px-based preset through the factor', () => {
    injectAnimStyles()
    const css = document.getElementById('pa-anim')?.textContent ?? ''
    expect(css).not.toBe('')

    // Presets whose keyframes move the element by an authored distance. A raw px
    // offset here (no var(--pa-s)) is the bug this test exists to catch.
    for (const name of ['slide-up', 'slide-down', 'slide-left', 'slide-right', 'bounce', 'bounce-reverse', 'roll-right', 'roll-left', 'shake', 'float', 'subtle-float']) {
      const rule = keyframeRule(css, name)
      expect(rule, `pa-${name} missing`).not.toBe('')
      const bare = rule.match(/-?\d+(\.\d+)?px/g)?.filter((px) => !rule.includes(`${px} * var(--pa-s`)) ?? []
      expect(bare, `pa-${name} has unscaled px travel: ${bare.join(', ')}`).toEqual([])
    }
  })

  it('swipes traverse the viewport, not the design box', () => {
    injectAnimStyles()
    const css = document.getElementById('pa-anim')?.textContent ?? ''
    // Viewport-relative by design: a swipe must clear the physical screen edge from
    // any on-screen position, on any aspect ratio.
    for (const name of ['swipe-left', 'swipe-right', 'swipe-out-left', 'swipe-out-right']) {
      const rule = keyframeRule(css, name)
      expect(rule, `pa-${name} missing`).not.toBe('')
      expect(rule).toContain('vw')
    }
    // The vertical traversals (swipe-up, and the drop's fall from above the screen) use
    // the height axis, so they must clear the top/bottom edge instead — 110vh.
    for (const name of ['swipe-up', 'drop']) {
      const rule = keyframeRule(css, name)
      expect(rule, `pa-${name} missing`).not.toBe('')
      expect(rule).toContain('vh')
    }
    // Their settle/bounce offsets are still authored distances, so those stay scaled.
    for (const name of ['swipe-up', 'drop']) {
      const rule = keyframeRule(css, name)
      const bare = rule.match(/-?\d+(\.\d+)?px/g)?.filter((px) => !rule.includes(`${px} * var(--pa-s`)) ?? []
      expect(bare, `pa-${name} has unscaled px travel: ${bare.join(', ')}`).toEqual([])
    }
  })
})
