// The 'marquee' presets — an endless sideways scroll (a ticker, a press-logo strip).
//
// The keyframes only travel one box width; what makes the pass look endless is the pair of
// copies the stage parks one box width to either side, so the one following the travel
// direction lands exactly where the original started. Two things are easy to get wrong and
// both are covered here: the copies must live INSIDE the animating layer chain (or they
// stay put while the element scrolls away from them), and the clip must live on the OUTER
// box (a clip on the animating box travels with it and simply hides them).

import { describe, it, expect, beforeEach } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import type { AnimSpec, Scene, SceneElement } from './scene'
import type { AssetMap } from './types'

const ASSETS: AssetMap = { a1: { src: 'data:image/png;base64,', w: 1000, h: 100 }, a2: { src: 'data:image/gif;base64,', w: 1000, h: 100 } }

const marquee = (over: Partial<AnimSpec> = {}): AnimSpec => ({ preset: 'marquee-left', durationMs: 12000, delayMs: 0, easing: 'ease-in-out', ...over })

const imageEl = (animations?: SceneElement['animations'], over: Partial<SceneElement> = {}): SceneElement =>
  ({
    id: 'img1',
    type: 'image',
    name: 'Logos',
    assetId: 'a1',
    x: 540,
    y: 400,
    w: 1000,
    h: 100,
    anchor: 'center',
    zIndex: 1,
    animations,
    ...over,
  }) as SceneElement

const scene = (els: SceneElement[]): Scene => ({
  meta: { schemaVersion: 1, name: 's', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: els,
})

function mount(el: SceneElement) {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  setDesign(1080, 1920)
  computeMetrics(540, 960)
  const stage = buildScene(scene([el]), ASSETS, { mount: host })
  stage.layoutAll()
  return { stage, rec: stage.get(el.id)!, host }
}

const copies = (rec: { outer: HTMLElement }): HTMLElement | null => rec.outer.querySelector('.pa-marquee-copies')
const tiles = (rec: { outer: HTMLElement }): HTMLElement[] => Array.from(rec.outer.querySelectorAll('.pa-marquee-tile'))

describe('marquee scroll', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('runs the scroll from mount, forever and linear', () => {
    const { rec } = mount(imageEl({ loop: marquee() }))
    expect(rec.anim.style.animation).toContain('pa-marquee-left')
    expect(rec.anim.style.animation).toContain('12000ms')
    expect(rec.anim.style.animation).toContain('infinite')
    // authored easing is ignored: anything but linear stutters where the copies join
    expect(rec.anim.style.animation).toContain('linear')
    expect(rec.anim.style.animation).not.toContain('ease-in-out')
  })

  it('scrolls the other way on marquee-right', () => {
    const { rec } = mount(imageEl({ loop: marquee({ preset: 'marquee-right' }) }))
    expect(rec.anim.style.animation).toContain('pa-marquee-right')
  })

  it('parks a copy of the art one box width to either side', () => {
    const { rec } = mount(imageEl({ loop: marquee() }))
    const t = tiles(rec)
    expect(t.length).toBe(2)
    expect(t[0].className).toContain('pa-marquee-tile--prev')
    expect(t[1].className).toContain('pa-marquee-tile--next')
    for (const tile of t) {
      const img = tile.firstElementChild as HTMLImageElement
      expect(img.tagName).toBe('IMG')
      expect(img.src).toBe((rec.content as HTMLImageElement).src)
    }
  })

  // The whole effect rests on this: the copies have to be below the animating box in the
  // tree, or the element scrolls away and leaves them sitting in place.
  it('keeps the copies inside the layer that carries the animation', () => {
    const { rec } = mount(imageEl({ loop: marquee() }))
    expect(rec.anim.contains(copies(rec)!)).toBe(true)
  })

  // ...and with a stacked loop the marquee rides a NESTED box, so the copies must be
  // deeper still — they travel with every layer above them.
  it('stays inside the deepest layer when another loop is stacked on top', () => {
    const { rec } = mount(imageEl({ loop: { preset: 'float', durationMs: 2200, delayMs: 0, easing: 'ease-in-out' }, loopExtra: [marquee()] }))
    const deepest = rec.layers[rec.layers.length - 1]
    expect(rec.layers.length).toBe(2)
    expect(deepest.style.animation).toContain('pa-marquee-left')
    expect(deepest.contains(copies(rec)!)).toBe(true)
  })

  it('clips on the outer box, never on the box that scrolls', () => {
    const { rec } = mount(imageEl({ loop: marquee() }))
    expect(rec.outer.classList.contains('pa-marquee-clip')).toBe(true)
    expect(rec.anim.style.overflow).toBe('')
  })

  // Rounded corners normally clip on the animation box — which here would hide the copies,
  // so the rounding has to move up to the outer box that is already doing the clipping.
  it('moves a corner radius up to the outer box', () => {
    const { rec } = mount(imageEl({ loop: marquee() }, { box: { radiusPx: 24 } }))
    expect(rec.anim.style.overflow).toBe('')
    expect(rec.outer.style.borderRadius).toBe(rec.anim.style.borderRadius)
    expect(rec.outer.style.borderRadius).not.toBe('')
  })

  it('leaves an element with no marquee alone', () => {
    const { rec } = mount(imageEl({ loop: { preset: 'pulse', durationMs: 1200, delayMs: 0, easing: 'ease-in-out' } }, { box: { radiusPx: 24 } }))
    expect(copies(rec)).toBe(null)
    expect(rec.outer.classList.contains('pa-marquee-clip')).toBe(false)
    expect(rec.anim.style.overflow).toBe('hidden') // the ordinary radius clip is untouched
    expect(rec.outer.style.borderRadius).toBe('')
  })

  it('drops the copies when the marquee is taken off the element', () => {
    const { rec, stage } = mount(imageEl({ loop: marquee() }))
    expect(copies(rec)).not.toBe(null)
    stage.update(scene([imageEl({ loop: { preset: 'float', durationMs: 2200, delayMs: 0, easing: 'ease-in-out' } })]), ASSETS)
    expect(copies(rec)).toBe(null)
    expect(rec.outer.classList.contains('pa-marquee-clip')).toBe(false)
  })

  // A relayout refreshes the copies in place rather than rebuilding them: re-creating the
  // <img> on every resize would make a loaded picture reload and flicker mid-scroll.
  it('keeps the same copy nodes across a relayout', () => {
    const { rec, stage } = mount(imageEl({ loop: marquee() }))
    const before = tiles(rec)[0].firstElementChild
    computeMetrics(360, 640)
    stage.layoutAll()
    expect(tiles(rec)[0].firstElementChild).toBe(before)
  })

  // The copies can't go stale behind an asset swap: update() refuses one outright, so the
  // editor rebuilds the element and the copies are cloned fresh from the new picture.
  it('cannot be left holding the old picture after an asset swap', () => {
    const { stage } = mount(imageEl({ loop: marquee() }))
    expect(stage.update(scene([imageEl({ loop: marquee() }, { assetId: 'a2' })]), ASSETS)).toBe(false)
    const rebuilt = mount(imageEl({ loop: marquee() }, { assetId: 'a2' }))
    const copy = tiles(rebuilt.rec)[0].firstElementChild as HTMLImageElement
    expect(copy.src).toBe((rebuilt.rec.content as HTMLImageElement).src)
    expect(copy.src).toContain('image/gif')
  })
})
