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

  it('leaves an element with no lightray untouched', () => {
    const { rec } = mount(imageEl({ loop: { preset: 'pulse', durationMs: 1200, delayMs: 0, easing: 'ease-in-out' } }))
    expect(rec.anim.classList.contains('pa-lightray')).toBe(false)
    expect(running(rec.anim)).toBe(false)
  })
})
