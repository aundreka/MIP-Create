// The 'tap' animation phase — an element replaying an animation each time the
// player taps IT (as opposed to the scene-wide entrance/exit phases).
//
// It composes exactly like the game-win phase: the one-shot runs first and the
// element's ordinary loop is held back until it finishes, so the two never fight
// over `transform` on the same node.

import { describe, it, expect } from 'vitest'
import { composeTapAnim, composeGameWinAnim, lightraySpec, phaseSpecs, phaseTotalMs } from './anim'
import type { AnimSpec, SceneElement } from './scene'

const spec = (p: Partial<AnimSpec> = {}): AnimSpec => ({
  preset: 'pop',
  durationMs: 320,
  delayMs: 0,
  easing: 'ease-out',
  ...p,
})

const el = (animations: SceneElement['animations']): SceneElement =>
  ({ id: 'e1', type: 'image', assetId: 'a1', animations }) as SceneElement

describe('tap animation phase', () => {
  it('collects the primary spec plus its stacked extras, in order', () => {
    const specs = phaseSpecs(el({ tap: spec(), tapExtra: [spec({ preset: 'shine' })] }), 'tap')
    expect(specs.map((s) => s.preset)).toEqual(['pop', 'shine'])
  })

  it('is empty for an element with no tap animation', () => {
    expect(phaseSpecs(el({ entrance: spec() }), 'tap')).toEqual([])
    expect(composeTapAnim(el({ entrance: spec() }))).toBe('none')
  })

  // The entrance phase must not leak into it: an element that pops IN should not
  // also pop on every tap unless the author asked for it.
  it('does not borrow the entrance or game-win spec', () => {
    const e = el({ entrance: spec({ preset: 'fade' }), gameWin: spec({ preset: 'bounce' }) })
    expect(phaseSpecs(e, 'tap')).toEqual([])
    expect(composeTapAnim(e)).toBe('none')
  })

  it('emits the tap animation shorthand', () => {
    const css = composeTapAnim(el({ tap: spec({ durationMs: 500 }) }))
    expect(css).toContain('500ms')
    expect(css).not.toBe('none')
  })

  // Without the hold, the infinite loop's transform would immediately override the
  // one-shot and the tap would look like it did nothing.
  it('delays the loop until the tap animation has finished', () => {
    const css = composeTapAnim(el({ tap: spec({ durationMs: 300, delayMs: 100 }), loop: spec({ preset: 'float', durationMs: 2000, iterations: 'infinite' }) }))
    expect(css).toContain('400ms') // 100 delay + 300 duration = when the loop may start
    expect(css).toContain('infinite')
  })

  it('reports its total wall time like any other phase', () => {
    expect(phaseTotalMs(el({ tap: spec({ durationMs: 300, delayMs: 120 }) }), 'tap')).toBe(420)
    expect(phaseTotalMs(el({}), 'tap')).toBe(0)
  })

  // lightray is a pseudo-element sweep driven by a class, not a node animation, so
  // it has to be discoverable from whichever phase the author put it in.
  it('finds a lightray authored in the tap phase', () => {
    const ray = lightraySpec(el({ tapExtra: [spec({ preset: 'lightray', durationMs: 2400 })] }))
    expect(ray?.preset).toBe('lightray')
  })

  it('composes independently of the game-win phase', () => {
    const e = el({ tap: spec({ durationMs: 250 }), gameWin: spec({ preset: 'bounce', durationMs: 900 }) })
    expect(composeTapAnim(e)).toContain('250ms')
    expect(composeTapAnim(e)).not.toContain('900ms')
    expect(composeGameWinAnim(e)).toContain('900ms')
    expect(composeGameWinAnim(e)).not.toContain('250ms')
  })
})
