// Wiring for the 'tap' animation phase, at the stage level.
//
// Two things have to be true for it to work at all: the element must be allowed to
// RECEIVE the tap (decorative elements are pointer-events:none so they don't absorb
// touches meant for the game behind them), and the listener must only be armed in
// interactive playback — on the editor canvas a click means "select this element".

import { describe, it, expect, beforeEach } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import type { AnimSpec, Scene, SceneElement } from './scene'
import type { AssetMap } from './types'

const ASSETS: AssetMap = { a1: { src: 'data:image/png;base64,', w: 200, h: 200 } }

const tapSpec: AnimSpec = { preset: 'pop', durationMs: 320, delayMs: 0, easing: 'ease-out' }

const imageEl = (animations?: SceneElement['animations']): SceneElement =>
  ({
    id: 'img1',
    type: 'image',
    name: 'Tappable',
    assetId: 'a1',
    x: 540,
    y: 960,
    w: 400,
    h: 400,
    anchor: 'center',
    zIndex: 1,
    animations,
  }) as SceneElement

const scene = (els: SceneElement[]): Scene => ({
  meta: { schemaVersion: 1, name: 's', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: els,
})

function mount(el: SceneElement, interactive = true) {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  setDesign(1080, 1920)
  computeMetrics(540, 960)
  const stage = buildScene(scene([el]), ASSETS, { mount: host })
  stage.layoutAll()
  stage.startGames(interactive)
  return { stage, rec: stage.get(el.id)!, host }
}

const tap = (n: HTMLElement): void => void n.dispatchEvent(new Event('pointerdown', { bubbles: true }))

describe('on-tap animation', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('plays the tap animation when the element is tapped', () => {
    const { rec } = mount(imageEl({ tap: tapSpec }))
    expect(rec.anim.style.animation).toBe('')
    tap(rec.anim)
    expect(rec.anim.style.animation).toContain('320ms')
  })

  it('replays on every tap, so impatient repeat taps still register', () => {
    const { rec } = mount(imageEl({ tap: tapSpec }))
    tap(rec.anim)
    const first = rec.anim.style.animation
    rec.anim.style.animation = 'sentinel'
    tap(rec.anim)
    expect(rec.anim.style.animation).toBe(first)
  })

  // A decorative image is pointer-events:none so it cannot absorb touches meant for
  // whatever is behind it — but one the author asked to react to taps must opt in,
  // or it would never receive the event in the first place.
  it('lets a tap-animated element receive pointer events', () => {
    const { rec } = mount(imageEl({ tap: tapSpec }))
    expect(rec.anim.style.pointerEvents).not.toBe('none')
    expect(rec.outer.style.pointerEvents).not.toBe('none')
  })

  it('leaves a plain decorative image non-absorbing', () => {
    const { rec } = mount(imageEl())
    expect(rec.anim.style.pointerEvents).toBe('none')
    expect(rec.outer.style.pointerEvents).toBe('none')
  })

  it('stays inert on the editor canvas, where a click means select', () => {
    const { rec } = mount(imageEl({ tap: tapSpec }), false)
    tap(rec.anim)
    expect(rec.anim.style.animation).toBe('')
  })

  it('does nothing for an element with no tap animation', () => {
    const { rec } = mount(imageEl({ entrance: { ...tapSpec, preset: 'fade' } }))
    const before = rec.anim.style.animation
    tap(rec.anim)
    expect(rec.anim.style.animation).toBe(before)
  })

  // The animation is decoration layered on top of whatever the tap already did — if
  // it swallowed the gesture, a scene tap-advance on the same element would die.
  it('does not swallow the tap', () => {
    const { rec, host } = mount(imageEl({ tap: tapSpec }))
    let seen = 0
    host.addEventListener('pointerdown', () => seen++)
    tap(rec.anim)
    expect(seen).toBe(1)
    expect(rec.anim.style.animation).toContain('320ms')
  })

  // Stacked specs get one nested box EACH (see applyAnimParts in stage.ts): two
  // animations on a single node don't blend, the last one just wins, so the shine
  // would have silently replaced the pop.
  it('stacks extras alongside the primary tap spec, one per nested layer', () => {
    const { rec } = mount(imageEl({ tap: tapSpec, tapExtra: [{ preset: 'shine', durationMs: 900, delayMs: 0, easing: 'ease-in-out' }] }))
    tap(rec.anim)
    const layers = [rec.anim, ...Array.from(rec.anim.querySelectorAll<HTMLElement>('.pa-el-anim-l'))]
    expect(layers.length).toBeGreaterThan(1)
    const css = layers.map((n) => n.style.animation)
    expect(css[0]).toContain('320ms')
    expect(css[1]).toContain('900ms')
    // and never doubled up on one node, which is what made them fight
    expect(css[0]).not.toContain('900ms')
  })
})
