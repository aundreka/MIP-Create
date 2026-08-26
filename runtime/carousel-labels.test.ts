// A carousel choice's label can be an ordinary scene element the author tagged, the
// way a combo board's layers and name plates are: discovered off the stage, claimed,
// driven by the game, and handed back untouched on teardown. These cover that whole
// contract — the element is claimed and released, it is placed against its own choice
// rather than a slot, the relationship the author drew against the CENTRE choice is
// what travels, and it supersedes the built-in label without disturbing choices that
// still use one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeMetrics, setDesign } from './responsive'
import { clearPicks } from './selection'
import { CAROUSEL_OFF_CLASS } from './games/carousel'
import type { AssetMap } from './types'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

const DESIGN_W = 1080
const DESIGN_H = 1920

const ASSETS: AssetMap = {
  sw0: { src: 'sw0.png', w: 200, h: 200 },
  sw1: { src: 'sw1.png', w: 200, h: 200 },
  sw2: { src: 'sw2.png', w: 200, h: 200 },
  word0: { src: 'word0.png', w: 400, h: 100 },
  word1: { src: 'word1.png', w: 400, h: 100 },
  word2: { src: 'word2.png', w: 400, h: 100 },
}

const game = (params: Record<string, unknown> = {}): SceneElement =>
  ({
    id: 'car',
    type: 'game-mount',
    name: 'Carousel',
    x: 540,
    y: 1400,
    w: 1000,
    h: 500,
    anchor: 'center',
    zIndex: 1,
    mode: 'fit',
    game: {
      templateId: 'carousel',
      hintEnabled: false,
      params: { count: 3, images: ['sw0', 'sw1', 'sw2'], itemPct: 20, gapPct: 5, startIndex: 0, changesToWin: 0, ...params },
    },
  }) as SceneElement

/** A label element, authored somewhere on the canvas and tagged for `choice`. */
const label = (id: string, choice: number, over: Partial<SceneElement> = {}): SceneElement =>
  ({
    id,
    type: 'image',
    name: 'Label ' + choice,
    assetId: 'word' + (choice - 1),
    x: 540,
    y: 1700,
    w: 300,
    h: 80,
    anchor: 'center',
    zIndex: 4,
    mode: 'fit',
    carouselRole: { gameId: 'car', role: 'label', choice },
    ...over,
  }) as SceneElement

function scene(elements: SceneElement[]): Scene {
  return { meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H }, elements, kind: 'game' }
}

interface Rig {
  stage: ReturnType<typeof buildScene>
  mount: HTMLDivElement
  el: (id: string) => HTMLElement
  /** The translate the game wrote on a label, as numbers. */
  shift: (id: string) => { x: number; y: number }
  scale: (id: string) => number
}

// jsdom reports a zero rect for everything, and this whole mechanism is arithmetic on
// rects — so, like the combo tests, give each element a real box. Elements are
// positioned by a percentage transform rather than by inline left/top, so the box is
// supplied here from the scene geometry and shifted by whatever translate the game has
// written since.
const BOXES = new WeakMap<HTMLElement, { x: number; y: number; w: number; h: number }>()

function stubRects(): void {
  const px = (el: HTMLElement | null, prop: 'width' | 'height'): number => {
    for (let n = el; n; n = n.parentElement) {
      const v = n.style[prop]
      if (v.endsWith('px')) return parseFloat(v)
    }
    return 0
  }
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return px(this, 'width')
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return px(this, 'height')
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const b = BOXES.get(this) ?? { x: 0, y: 0, w: px(this, 'width'), h: px(this, 'height') }
    const m = /(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(this.style.translate || '')
    const x = b.x + Number(m?.[1] ?? 0)
    const y = b.y + Number(m?.[2] ?? 0)
    return { left: x, top: y, right: x + b.w, bottom: y + b.h, width: b.w, height: b.h, x, y, toJSON: () => ({}) } as DOMRect
  })
}

function makeRig(elements: SceneElement[], opts: { start?: boolean } = {}): Rig {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const stage = buildScene(scene(elements), ASSETS, { mount })
  stage.layoutAll()
  const el = (id: string): HTMLElement => mount.querySelector<HTMLElement>(`.pa-el[data-id="${id}"]`)!
  // Design px == screen px here (computeMetrics at the design size), and every element
  // in these scenes is centre-anchored.
  for (const e of elements) {
    const node = el(e.id)
    if (node) BOXES.set(node, { x: e.x - (e.w ?? 0) / 2, y: e.y - (e.h ?? 0) / 2, w: e.w ?? 0, h: e.h ?? 0 })
  }
  const slot = mount.querySelector<HTMLElement>('.pa-game')
  const g = elements.find((e) => e.type === 'game-mount')!
  if (slot) BOXES.set(slot, { x: g.x - g.w! / 2, y: g.y - g.h! / 2, w: g.w!, h: g.h! })
  stage.startGames(opts.start !== false)
  const nums = (v: string): { x: number; y: number } => {
    const m = /(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(v)
    return { x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0) }
  }
  return {
    stage,
    mount,
    el,
    shift: (id) => nums(el(id).style.translate),
    scale: (id) => Number((el(id).querySelector<HTMLElement>('.pa-el-anim') ?? el(id)).style.scale || 1),
  }
}

describe('a carousel label can be a scene element', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearPicks()
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(DESIGN_W, DESIGN_H)
    stubRects()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    clearPicks()
  })

  it('tags the element on the stage so the game can find it', () => {
    const r = makeRig([game(), label('l1', 1)], { start: false })
    const el = r.el('l1')
    expect(el.dataset.carouselRole).toBe('label')
    expect(el.dataset.carouselGameId).toBe('car')
    expect(el.dataset.carouselChoice).toBe('1')
    // Every label is authored against the same centre spot, so they stack on the
    // canvas: hidden while editing unless this one is being positioned.
    expect(el.classList.contains(CAROUSEL_OFF_CLASS)).toBe(true)
  })

  it('leaves a label the author asked to see visible on the canvas', () => {
    const r = makeRig([game(), label('l1', 1, { carouselRole: { gameId: 'car', role: 'label', choice: 1, showOnCanvas: true } })], { start: false })
    expect(r.el('l1').classList.contains(CAROUSEL_OFF_CLASS)).toBe(false)
  })

  it('does not move anything on the static editor canvas', () => {
    // The game mounts and lays out here exactly as it does in the editor, but play has
    // not begun — so a label must stay where the author put it, and stay draggable.
    const r = makeRig([game(), label('l1', 1), label('l2', 2)], { start: false })
    expect(r.el('l1').style.translate).toBe('')
    expect(r.el('l2').style.translate).toBe('')
  })

  it('claims the element, then releases it on teardown', () => {
    const r = makeRig([game(), label('l1', 1)])
    expect(r.el('l1').dataset.carouselClaimedBy).toBe('car')
    const el = r.el('l1')
    r.stage.destroy()
    expect(el.dataset.carouselClaimedBy).toBeUndefined()
    expect(el.style.translate).toBe('')
    expect((el.querySelector<HTMLElement>('.pa-el-anim') ?? el).style.scale).toBe('')
  })

  it('shows every label in play, whatever the canvas flag said', () => {
    const r = makeRig([game(), label('l1', 1), label('l2', 2)])
    expect(r.el('l1').classList.contains(CAROUSEL_OFF_CLASS)).toBe(false)
    expect(r.el('l2').classList.contains(CAROUSEL_OFF_CLASS)).toBe(false)
  })

  it('puts the canvas back the way it found it', () => {
    const shown = label('l1', 1, { carouselRole: { gameId: 'car', role: 'label', choice: 1, showOnCanvas: true } })
    const r = makeRig([game(), shown, label('l2', 2)])
    const a = r.el('l1')
    const b = r.el('l2')
    r.stage.destroy()
    expect(a.classList.contains(CAROUSEL_OFF_CLASS)).toBe(false) // was shown
    expect(b.classList.contains(CAROUSEL_OFF_CLASS)).toBe(true) // was hidden
  })

  it('leaves the centred choice’s label exactly where it was authored', () => {
    // A label is authored AGAINST the centre slot, so when its choice is the selected
    // one the relationship is already satisfied and the game must not shift it at all.
    const r = makeRig([game({ startIndex: 0 }), label('l1', 1), label('l2', 2)])
    expect(Math.abs(r.shift('l1').x)).toBeLessThan(0.01)
    expect(Math.abs(r.shift('l1').y)).toBeLessThan(0.01)
    expect(r.scale('l1')).toBeCloseTo(1, 3)
  })

  it('carries the authored relationship into the other slots', () => {
    const r = makeRig([game({ startIndex: 0 }), label('l1', 1), label('l2', 2)])
    // Choice 2 sits one slot along, so its label travels with it — and shrinks, by
    // exactly the ratio the art does, which is what keeps the pair reading as one.
    expect(r.shift('l2').x).toBeGreaterThan(1)
    expect(r.scale('l2')).toBeCloseTo(1 / 1.45, 3) // sideScale ÷ centerScale
  })

  it('gives the centre state to whichever choice is selected', () => {
    // Same scene, different starting choice: now it is 2 that sits where it was
    // authored and 1 that has travelled off to a side slot.
    const r = makeRig([game({ startIndex: 1 }), label('l1', 1), label('l2', 2)])
    expect(Math.abs(r.shift('l2').x)).toBeLessThan(0.01)
    expect(r.scale('l2')).toBeCloseTo(1, 3)
    expect(Math.abs(r.shift('l1').x)).toBeGreaterThan(1)
    expect(r.scale('l1')).toBeCloseTo(1 / 1.45, 3)
  })

  it('moves a label the same distance the row moves', () => {
    const r = makeRig([game({ startIndex: 0, itemPct: 20, gapPct: 5 }), label('l1', 1), label('l2', 2)])
    // Both labels are authored at the same point, so the side one's shift is purely
    // its slot: one step of (itemPct + gapPct)% of the game width.
    const step = (1000 * 25) / 100
    expect(r.shift('l2').x).toBeCloseTo(step, 0)
  })

  it('supersedes the built-in label only for the choice it names', () => {
    const r = makeRig([game({ labels: 'One, Two, Three' }), label('l1', 1)])
    const wraps = [...r.mount.querySelectorAll('.pa-game > div')] as HTMLElement[]
    const inner = wraps.map((wr) => wr.querySelector<HTMLElement>('.pa-carousel-label')!)
    expect(inner[0].style.display).toBe('none') // has an element label
    expect(inner[1].style.display).not.toBe('none') // still typed
    expect(inner[1].textContent).toBe('Two')
  })

  it('ignores a label pointing at a choice the row does not have, but still releases it', () => {
    const r = makeRig([game({ count: 3 }), label('l9', 9)])
    const el = r.el('l9')
    expect(el.style.translate).toBe('') // never driven
    expect(el.dataset.carouselClaimedBy).toBe('car')
    r.stage.destroy()
    expect(el.dataset.carouselClaimedBy).toBeUndefined()
  })

  it('will not let two carousels drive the same untagged label', () => {
    const second = { ...game(), id: 'car2', game: { ...game().game, params: { ...game().game!.params } } } as SceneElement
    const untagged = label('l1', 1, { carouselRole: { role: 'label', choice: 1 } }) // no gameId
    const r = makeRig([game(), second, untagged])
    expect(r.el('l1').dataset.carouselClaimedBy).toBe('car')
  })
})
