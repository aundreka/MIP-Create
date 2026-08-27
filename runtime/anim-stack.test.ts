// Stacked animations must actually stack.
//
// CSS does NOT blend two animations on one node: whichever comes last in the
// `animation` list owns `transform` outright and the other never shows. That made the
// editor's "+ add another animation" a lie — a slide-up plus a pulse played as a bare
// pulse. stage.ts nests one .pa-el-anim box per concurrent spec so the browser
// composes them (outer transform × inner transform). This pins that contract.

import { describe, it, expect, beforeEach } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import type { AnimSpec, Scene, SceneElement } from './scene'
import type { AssetMap } from './types'

const ASSETS: AssetMap = { a1: { src: 'data:image/png;base64,', w: 200, h: 200 } }

const spec = (preset: string, durationMs: number, extra: Partial<AnimSpec> = {}): AnimSpec =>
  ({ preset, durationMs, delayMs: 0, easing: 'ease-out', ...extra }) as AnimSpec

const imageEl = (animations: SceneElement['animations']): SceneElement =>
  ({ id: 'img1', type: 'image', assetId: 'a1', x: 540, y: 960, w: 400, h: 400, anchor: 'center', zIndex: 1, animations }) as SceneElement

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
  stage.startGames(true)
  return stage
}

/** The animation chain for the element, outermost box first. */
function layers(stage: ReturnType<typeof mount>): HTMLElement[] {
  const outer = stage.get('img1')!.anim
  return [outer, ...Array.from(outer.querySelectorAll<HTMLElement>('.pa-el-anim-l'))]
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('stacked animation layers', () => {
  it('gives an element with one animation no extra boxes', () => {
    const stage = mount(imageEl({ loop: spec('pulse', 1200, { iterations: 'infinite' }) }))
    expect(layers(stage)).toHaveLength(1)
  })

  it('puts an entrance and the loop that follows it on separate boxes', () => {
    const stage = mount(imageEl({ entrance: spec('slide-up', 500), loop: spec('pulse', 1200, { iterations: 'infinite' }) }))
    stage.playEntrances()
    const css = layers(stage).map((n) => n.style.animation)
    expect(css.length).toBeGreaterThan(1)
    expect(css[0]).toContain('pa-slide-up')
    expect(css[1]).toContain('pa-pulse')
    expect(css[0]).not.toContain('pa-pulse') // the two would otherwise fight over transform
  })

  it('spreads a stacked entrance across the chain in order', () => {
    const stage = mount(imageEl({ entrance: spec('pop', 400), entranceExtra: [spec('roll-right', 600), spec('glow', 800)] }))
    stage.playEntrances()
    const css = layers(stage).map((n) => n.style.animation)
    expect(css[0]).toContain('pa-pop')
    expect(css[1]).toContain('pa-roll-right')
    expect(css[2]).toContain('pa-glow')
  })

  it('nests the boxes and mounts the content inside the innermost one', () => {
    const stage = mount(imageEl({ entrance: spec('pop', 400), entranceExtra: [spec('bounce-reverse', 600)] }))
    const chain = layers(stage)
    expect(chain).toHaveLength(2)
    expect(chain[0].children[0]).toBe(chain[1]) // nested, not siblings
    expect(chain[1].contains(stage.get('img1')!.content!)).toBe(true)
  })

  it('clears a layer when the next phase needs fewer animations', () => {
    const stage = mount(imageEl({ entrance: spec('pop', 400), entranceExtra: [spec('glow', 800)], exit: spec('fade-out', 300) }))
    stage.playEntrances()
    expect(layers(stage)[1].style.animation).toContain('pa-glow')
    stage.playExit()
    const css = layers(stage).map((n) => n.style.animation)
    expect(css[0]).toContain('pa-fade-out')
    expect(css[1]).toBe('') // the entrance's glow must not linger under the exit
  })
})
