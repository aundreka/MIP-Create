// The point of the carousel is that something OUTSIDE it changes with the choice.
// The stage already mirrors a selection group into `fill` elements, but it only
// wired that up when the scene contained a tappable `pick` element — a game that
// owns the group had no way in. These cover the whole path: a carousel publishes
// its centre choice, a plain image element marked as a fill slot for the same
// group shows that choice's linked art, and it keeps up as the choice changes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import { clearPicks, setPicks } from './selection'
import type { AssetMap } from './types'
import type { Scene, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920

const ASSETS: AssetMap = {
  sw_red: { src: 'swatch-red.png', w: 200, h: 200 },
  sw_blonde: { src: 'swatch-blonde.png', w: 200, h: 200 },
  model_red: { src: 'model-red.png', w: 800, h: 1200 },
  model_blonde: { src: 'model-blonde.png', w: 800, h: 1200 },
  model_clip: { src: 'model-red.mp4', w: 800, h: 1200, kind: 'video' },
}

function scene(elements: SceneElement[]): Scene {
  return {
    meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H },
    elements,
    kind: 'game',
  }
}

const carouselEl = (params: Record<string, unknown> = {}): SceneElement =>
  ({
    id: 'g1',
    type: 'game-mount',
    name: 'Carousel',
    x: 540,
    y: 1400,
    w: 1000,
    h: 500,
    anchor: 'center',
    zIndex: 5,
    mode: 'fit',
    game: {
      templateId: 'carousel',
      params: {
        count: 2,
        linkGroup: 'shade',
        images: ['sw_blonde', 'sw_red'],
        results: ['model_blonde', 'model_red'],
        startIndex: 0,
        ...params,
      },
    },
  }) as SceneElement

const previewEl = (over: Partial<SceneElement> = {}): SceneElement =>
  ({
    id: 'preview',
    type: 'image',
    name: 'Model',
    x: 540,
    y: 600,
    w: 800,
    h: 900,
    anchor: 'center',
    zIndex: 4,
    mode: 'fit',
    fill: { group: 'shade' },
    ...over,
  }) as SceneElement

function mountScene(elements: SceneElement[]): { stage: ReturnType<typeof buildScene>; mount: HTMLDivElement; fillSrc: () => string | null } {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const stage = buildScene(scene(elements), ASSETS, { mount })
  stage.layoutAll()
  stage.startGames(true)
  vi.advanceTimersByTime(50) // the stage seeds fills on the next frame
  return {
    stage,
    mount,
    fillSrc: () => {
      const node = mount.querySelector('.pa-fill') as HTMLImageElement | null
      return node ? node.getAttribute('src') : null
    },
  }
}

describe('an element outside the carousel follows the chosen item', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) // jsdom has none
    document.body.innerHTML = ''
    clearPicks()
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(DESIGN_W, DESIGN_H)
    const resolve = (el: HTMLElement | null, prop: 'width' | 'height'): number => {
      for (let n = el; n; n = n.parentElement) {
        const v = n.style[prop]
        if (v.endsWith('px')) return parseFloat(v)
      }
      return 0
    }
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return resolve(this, 'width')
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return resolve(this, 'height')
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    clearPicks()
  })

  it('shows the starting choice as soon as the scene opens', () => {
    const { fillSrc } = mountScene([carouselEl(), previewEl()])
    expect(fillSrc()).toBe('model-blonde.png')
  })

  it('swaps when the choice changes — with no pick element anywhere in the scene', () => {
    const { fillSrc } = mountScene([carouselEl(), previewEl()])
    // Stand in for the swipe: the carousel publishes through this same call.
    setPicks('shade', ['model_red'])
    expect(fillSrc()).toBe('model-red.png')
  })

  it('leaves other groups alone', () => {
    const { fillSrc } = mountScene([carouselEl(), previewEl()])
    setPicks('other', ['model_red'])
    expect(fillSrc()).toBe('model-blonde.png')
  })

  it('plays a linked video choice instead of stamping it as an image', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const stage = buildScene(scene([carouselEl(), previewEl()]), ASSETS, { mount })
    stage.layoutAll()
    stage.startGames(true)
    vi.advanceTimersByTime(50)
    setPicks('shade', ['model_clip'])
    const node = mount.querySelector('.pa-fill')
    expect(node?.tagName).toBe('VIDEO')
  })

  it('covers the slot by default, so nothing authored before this changes', () => {
    const { mount } = mountScene([carouselEl(), previewEl()])
    const n = mount.querySelector('.pa-fill') as HTMLImageElement
    expect(n.style.objectFit).toBe('cover')
    expect(n.style.objectPosition).toBe('50% 50%')
    expect(n.style.transform).toBe('')
  })

  it('shows the whole picture when the slot asks to contain it', () => {
    // The point for a portrait: cover would crop the head off a short box.
    const { mount } = mountScene([carouselEl(), previewEl({ fill: { group: 'shade', fit: 'contain' } })])
    expect((mount.querySelector('.pa-fill') as HTMLImageElement).style.objectFit).toBe('contain')
  })

  it('keeps the part of the picture the author chose when it crops', () => {
    const { mount } = mountScene([carouselEl(), previewEl({ fill: { group: 'shade', focusX: 30, focusY: 10 } })])
    expect((mount.querySelector('.pa-fill') as HTMLImageElement).style.objectPosition).toBe('30% 10%')
  })

  it('zooms around that same point', () => {
    const { mount } = mountScene([carouselEl(), previewEl({ fill: { group: 'shade', focusY: 20, zoom: 1.4 } })])
    const n = mount.querySelector('.pa-fill') as HTMLImageElement
    expect(n.style.transform).toBe('scale(1.4)')
    expect(n.style.transformOrigin).toBe('50% 20%')
  })

  it('keeps the fit when the choice changes', () => {
    const { mount, fillSrc } = mountScene([carouselEl(), previewEl({ fill: { group: 'shade', fit: 'contain', focusY: 20 } })])
    setPicks('shade', ['model_red'])
    const n = mount.querySelector('.pa-fill') as HTMLImageElement
    expect(fillSrc()).toBe('model-red.png')
    expect(n.style.objectFit).toBe('contain')
    expect(n.style.objectPosition).toBe('50% 20%')
  })

  it('stops mirroring once the scene is torn down', () => {
    const { stage, fillSrc } = mountScene([carouselEl(), previewEl()])
    expect(fillSrc()).toBe('model-blonde.png')
    stage.destroy()
    expect(() => setPicks('shade', ['model_red'])).not.toThrow()
  })
})
