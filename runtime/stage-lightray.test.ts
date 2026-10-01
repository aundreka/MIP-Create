// The 'lightray' reflection sweep (the sliding shine) at the stage level.
//
// It is the one preset that is NOT a node animation: two pseudo-elements on .pa-el-anim
// slide a specular band across the box, driven by classes and CSS vars instead of an
// `animation` shorthand. That made it easy to get wrong — the sweep used to be wired up
// once at mount and hardcoded to `infinite`, no matter which phase authored it, so a
// lightray picked as an ENTRANCE was already sweeping before the element had entered
// and kept sweeping forever afterwards. A one-shot phase now parks it until that phase
// fires; only a `loop` lightray is ambient.

import { describe, it, expect, beforeEach } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import type { AnimSpec, Scene, SceneElement } from './scene'
import type { AssetMap } from './types'

const ASSETS: AssetMap = { a1: { src: 'data:image/png;base64,', w: 200, h: 200 } }

const ray = (over: Partial<AnimSpec> = {}): AnimSpec => ({ preset: 'lightray', durationMs: 2400, delayMs: 0, easing: 'ease-in-out', ...over })

const imageEl = (animations?: SceneElement['animations']): SceneElement =>
  ({
    id: 'img1',
    type: 'image',
    name: 'Shiny',
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

const running = (n: HTMLElement): boolean => n.classList.contains('pa-lightray--run')
const v = (n: HTMLElement, name: string): string => n.style.getPropertyValue('--pa-lightray-' + name)

describe('lightray sweep', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('runs a loop lightray from mount, forever', () => {
    const { rec } = mount(imageEl({ loop: ray() }))
    expect(rec.anim.classList.contains('pa-lightray')).toBe(true)
    expect(running(rec.anim)).toBe(true)
    expect(v(rec.anim, 'iter')).toBe('infinite')
    expect(v(rec.anim, 'name')).toBe('pa-lightray-kf')
  })

  // The box setup (clipping + the parked bands) is there for the element's whole life so
  // its clipping never changes underfoot — but nothing sweeps until the entrance fires.
  it('parks an entrance lightray until the entrance plays', () => {
    const { rec, stage } = mount(imageEl({ entrance: ray({ durationMs: 900 }) }))
    expect(rec.anim.classList.contains('pa-lightray')).toBe(true)
    expect(running(rec.anim)).toBe(false)
    stage.playEntrances()
    expect(running(rec.anim)).toBe(true)
  })

  it('sweeps a one-shot lightray once, over its full authored duration', () => {
    const { rec, stage } = mount(imageEl({ entrance: ray({ durationMs: 900 }) }))
    stage.playEntrances()
    expect(v(rec.anim, 'iter')).toBe('1')
    expect(v(rec.anim, 'dur')).toBe('900ms')
    // the looping keyframes park for the last 45% to space repeats out; a one-shot crosses
    // the box over the whole duration instead
    expect(v(rec.anim, 'name')).toBe('pa-lightray-once')
  })

  it('honours an authored iteration count on a one-shot sweep', () => {
    const { rec, stage } = mount(imageEl({ entrance: ray({ iterations: 3 }) }))
    stage.playEntrances()
    expect(v(rec.anim, 'iter')).toBe('3')
  })

  it('holds a tap lightray until the element is tapped, then replays it', () => {
    const { rec } = mount(imageEl({ tap: ray({ durationMs: 700 }) }))
    expect(running(rec.anim)).toBe(false)
    rec.anim.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(running(rec.anim)).toBe(true)
    expect(v(rec.anim, 'iter')).toBe('1')
  })

  it('carries the authored direction and easing through', () => {
    const { rec } = mount(imageEl({ loop: ray({ angleDeg: 90, easing: 'linear' }) }))
    expect(v(rec.anim, 'ang')).toBe('90deg')
    expect(v(rec.anim, 'ease')).toBe('linear')
  })

  // The canvas plays no entrance at all, so a parked one-shot sweep would give the author
  // nothing to look at when they pick the preset — every other preset at least leaves the
  // element sitting there, but a lightray's resting state is literally nothing.
  it('previews a one-shot lightray ambiently on the static editor canvas', () => {
    const { rec } = mount(imageEl({ entrance: ray({ durationMs: 1200 }) }), false)
    expect(running(rec.anim)).toBe(true)
    expect(v(rec.anim, 'iter')).toBe('infinite')
    expect(v(rec.anim, 'name')).toBe('pa-lightray-kf')
  })

  it('previews a lightray stacked onto an entrance on the canvas too', () => {
    const { rec } = mount(imageEl({ entrance: { preset: 'pop', durationMs: 600, delayMs: 0, easing: 'ease-out' }, entranceExtra: [ray({ durationMs: 1200 })] }), false)
    expect(running(rec.anim)).toBe(true)
  })

  // The sweep lives in its OWN layer rather than on the element's pseudo-elements, so the
  // light can be clipped down to a carved region without clipping the element's content too.
  it('builds the shine layer, and takes it away with the preset', () => {
    const { rec, stage } = mount(imageEl({ loop: ray() }))
    const layer = rec.anim.querySelector('.pa-ray')
    expect(layer).toBeTruthy()
    expect(layer!.parentElement).toBe(rec.anim)
    expect(stage.update(scene([imageEl({})]), ASSETS)).toBe(true)
    expect(rec.anim.querySelector('.pa-ray')).toBeNull()
  })

  // Every default reproduces the sweep as it was before any of it was authorable, so an old
  // project with a bare { preset: 'lightray' } renders unchanged.
  it('defaults to the original band: 28%-wide white streak, screen blend, full opacity, no carve', () => {
    const { rec } = mount(imageEl({ loop: ray() }))
    expect(v(rec.anim, 'op')).toBe('1')
    expect(v(rec.anim, 'blend')).toBe('screen')
    expect(v(rec.anim, 'clip')).toBe('none')
    expect(v(rec.anim, 'mask')).toBe('none')
    // halo half-width: 28% of the element over a band element 200% of it, so 7% either side
    expect(v(rec.anim, 'halo')).toContain('rgba(255,255,255,0) 43.000%')
    expect(v(rec.anim, 'halo')).toContain('rgba(255,255,255,0.2) 50.000%')
    // the core keeps a fixed 0.45 of the halo's width
    expect(v(rec.anim, 'core')).toContain('rgba(255,255,255,0) 46.850%')
  })

  it('widens the streak without shortening the travel', () => {
    const { rec } = mount(imageEl({ loop: ray({ shine: { widthPct: 56 } }) }))
    // twice the width = twice the half-spread; the band element and the keyframes are untouched
    expect(v(rec.anim, 'halo')).toContain('rgba(255,255,255,0) 36.000%')
    expect(v(rec.anim, 'from')).toBe('')
    expect(v(rec.anim, 'to')).toBe('')
  })

  it('tints both bands with the authored colour', () => {
    const { rec } = mount(imageEl({ loop: ray({ shine: { color: '#ffcc00' } }) }))
    expect(v(rec.anim, 'halo')).toContain('rgba(255,204,0,0.2)')
    expect(v(rec.anim, 'core')).toContain('rgba(255,204,0,0.98)')
  })

  it('shrugs off a half-typed colour instead of blanking the sweep', () => {
    const { rec } = mount(imageEl({ loop: ray({ shine: { color: '#ff' } }) }))
    expect(v(rec.anim, 'halo')).toContain('rgba(255,255,255,0.2)')
  })

  it('carries opacity and blend through', () => {
    const { rec } = mount(imageEl({ loop: ray({ shine: { opacity: 0.4, blend: 'normal' } }) }))
    expect(v(rec.anim, 'op')).toBe('0.4')
    expect(v(rec.anim, 'blend')).toBe('normal')
  })

  // Softness moves the gradient's inner stops: out to the band's edge for a hard bar, onto
  // the centre for a pure linear fade.
  it('hardens and softens the streak edges', () => {
    const hard = mount(imageEl({ loop: ray({ shine: { softness: 0 } }) })).rec
    expect(v(hard.anim, 'halo')).toContain('rgba(255,255,255,0.07) 44.400%')
    const soft = mount(imageEl({ loop: ray({ shine: { softness: 1 } }) })).rec
    expect(v(soft.anim, 'halo')).toContain('rgba(255,255,255,0.07) 50.000%')
  })

  describe('the carved shine area', () => {
    it('clips the light to an inset rectangle', () => {
      const { rec } = mount(imageEl({ loop: ray({ shine: { inset: { top: 10, right: 20, bottom: 30, left: 40 } } }) }))
      expect(v(rec.anim, 'clip')).toBe('inset(10% 20% 30% 40%)')
    })

    it('rounds that rectangle off', () => {
      const { rec } = mount(imageEl({ loop: ray({ shine: { shape: 'rounded', radiusPct: 25 } }) }))
      expect(v(rec.anim, 'clip')).toBe('inset(0% 0% 0% 0% round 25%)')
    })

    it('centres an ellipse in the inset region', () => {
      const { rec } = mount(imageEl({ loop: ray({ shine: { shape: 'ellipse', inset: { left: 20 } } }) }))
      expect(v(rec.anim, 'clip')).toBe('ellipse(40% 50% at 60% 50%)')
    })

    // The whole point of the 'art' shape: a shine on a cut-out bottle runs down the bottle,
    // not across the rectangle it happens to sit in.
    it("masks the light to the image's own transparency", () => {
      const { rec } = mount(imageEl({ loop: ray({ shine: { shape: 'art' } }) }))
      expect(v(rec.anim, 'mask')).toContain('url("data:image/png;base64,')
      expect(v(rec.anim, 'mask')).toContain('0 0 / 100% 100% no-repeat')
    })

    // A cropped image positions its own <img> inside the box, so a box-sized mask would not
    // line up with the art — it keeps the shape clip alone rather than masking to the wrong thing.
    it('leaves a cropped image on the shape clip', () => {
      const cropped = { ...imageEl({ loop: ray({ shine: { shape: 'art' } }) }), crop: { x: 0, y: 0, scale: 1.5 } } as SceneElement
      const { rec } = mount(cropped)
      expect(v(rec.anim, 'mask')).toBe('none')
    })

    it('ignores a nonsense inset instead of emitting broken CSS', () => {
      const { rec } = mount(imageEl({ loop: ray({ shine: { inset: { top: 400, left: Number.NaN } } }) }))
      expect(v(rec.anim, 'clip')).toBe('inset(95% 0% 0% 0%)')
    })
  })

  it('leaves an element with no lightray untouched', () => {
    const { rec } = mount(imageEl({ loop: { preset: 'pulse', durationMs: 1200, delayMs: 0, easing: 'ease-in-out' } }))
    expect(rec.anim.classList.contains('pa-lightray')).toBe(false)
    expect(running(rec.anim)).toBe(false)
  })
})
