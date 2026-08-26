// The carousel is composed entirely of tagged scene elements — the mount contributes
// only the swipe surface, exactly as a combo board's does. These cover that contract
// end to end: the stage tags them, the game claims and releases them, the row is
// however many choices are wired up, every element keeps the offset it was authored at
// relative to the selected slot, the centre state travels to whichever choice arrives
// there, reveals cross-fade, and a TEXT label is restyled at the centre rather than
// blown up.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import { CAROUSEL_OFF_CLASS, landingIndex, wrapDelta } from './games/carousel'
import type { AssetMap } from './types'
import type { CarouselRoleConfig, Scene, SceneElement } from './scene'
import { buildScene } from './stage'

const DESIGN_W = 1080
const DESIGN_H = 1920
const GAME_X = 540
const GAME_Y = 1400
const GAME_W = 1000
const GAME_H = 500
/** The spot every choice is authored at — where the SELECTED one belongs. */
const CENTRE_X = 540
const CENTRE_Y = 1400

const ASSETS: AssetMap = {
  sw: { src: 'sw.png', w: 200, h: 200 },
  word: { src: 'word.png', w: 400, h: 100 },
  big: { src: 'big.png', w: 800, h: 1200 },
}

const game = (params: Record<string, unknown> = {}): SceneElement =>
  ({
    id: 'car',
    type: 'game-mount',
    name: 'Carousel',
    x: GAME_X,
    y: GAME_Y,
    w: GAME_W,
    h: GAME_H,
    anchor: 'center',
    zIndex: 1,
    mode: 'fit',
    game: { templateId: 'carousel', hintEnabled: false, params: { stepPct: 25, startIndex: 0, changesToWin: 0, revealFadeMs: 0, ...params } },
  }) as SceneElement

/** A tagged element, authored at the centre spot unless moved. */
const tagged = (id: string, role: CarouselRoleConfig['role'], choice: number, over: Partial<SceneElement> = {}): SceneElement =>
  ({
    id,
    type: 'image',
    name: `${role} ${choice}`,
    assetId: role === 'reveal' ? 'big' : role === 'label' ? 'word' : 'sw',
    x: CENTRE_X,
    y: CENTRE_Y,
    w: role === 'reveal' ? 700 : 200,
    h: role === 'label' ? 60 : 200,
    anchor: 'center',
    zIndex: 4,
    mode: 'fit',
    carouselRole: { gameId: 'car', role, choice },
    ...over,
  }) as SceneElement

/** A TEXT element assigned as a label, so the centre can be set in its own type. */
const textLabel = (id: string, choice: number, over: Partial<SceneElement> = {}): SceneElement =>
  ({
    id,
    type: 'text',
    name: `text ${choice}`,
    x: CENTRE_X,
    y: CENTRE_Y + 200,
    anchor: 'center',
    zIndex: 5,
    mode: 'fit',
    text: { value: 'Shade ' + choice, fontSizePx: 40, fontWeight: 400, color: '#5b6472', align: 'center' },
    carouselRole: { gameId: 'car', role: 'label', choice },
    ...over,
  }) as SceneElement

function scene(elements: SceneElement[]): Scene {
  return { meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H }, elements, kind: 'game' }
}

// jsdom reports a zero rect for everything, and the whole mechanism is arithmetic on
// rects — so, like the combo tests, give each element a real box. Elements are
// positioned by a percentage transform rather than by inline left/top, so the box comes
// from the scene geometry here, shifted by whatever translate the game has written.
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

interface Rig {
  stage: ReturnType<typeof buildScene>
  mount: HTMLDivElement
  el: (id: string) => HTMLElement
  /** The translate the game wrote, as numbers. */
  shift: (id: string) => { x: number; y: number }
  scale: (id: string) => number
  up: (id: string) => boolean
  inner: (id: string) => HTMLElement
}

function makeRig(elements: SceneElement[], opts: { start?: boolean } = {}): Rig {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const stage = buildScene(scene(elements), ASSETS, { mount })
  stage.layoutAll()
  const el = (id: string): HTMLElement => mount.querySelector<HTMLElement>(`.pa-el[data-id="${id}"]`)!
  // Design px == screen px here, and every element in these scenes is centre-anchored.
  for (const e of elements) {
    const node = el(e.id)
    if (node) BOXES.set(node, { x: e.x - (e.w ?? 200) / 2, y: e.y - (e.h ?? 60) / 2, w: e.w ?? 200, h: e.h ?? 60 })
  }
  const slot = mount.querySelector<HTMLElement>('.pa-game')
  if (slot) BOXES.set(slot, { x: GAME_X - GAME_W / 2, y: GAME_Y - GAME_H / 2, w: GAME_W, h: GAME_H })
  const root = mount.querySelector<HTMLElement>('.pa-root')
  if (root) BOXES.set(root, { x: 0, y: 0, w: DESIGN_W, h: DESIGN_H })
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
    up: (id) => !el(id).classList.contains(CAROUSEL_OFF_CLASS),
    inner: (id) => el(id).querySelector<HTMLElement>('.pa-text-inner')!,
  }
}

const STEP = (GAME_W * 25) / 100

describe('a carousel is built from tagged scene elements', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(DESIGN_W, DESIGN_H)
    stubRects()
  })
  afterEach(() => vi.restoreAllMocks())

  it('offers no way to load art into the game itself', async () => {
    // The whole point: every picture is an element on the canvas, so the template must
    // not carry image slots of its own.
    const { CAROUSEL_TEMPLATE } = await import('./games/carousel')
    expect(CAROUSEL_TEMPLATE.assetSlots).toBeUndefined()
    expect(CAROUSEL_TEMPLATE.paramFields.some((f) => /image|images/i.test(f.key))).toBe(false)
  })

  it('tags each role on the stage so the game can find it', () => {
    const r = makeRig([game(), tagged('c1', 'choice', 1), tagged('l1', 'label', 1), tagged('v1', 'reveal', 1)], { start: false })
    expect(r.el('c1').dataset.carouselRole).toBe('choice')
    expect(r.el('l1').dataset.carouselRole).toBe('label')
    expect(r.el('v1').dataset.carouselRole).toBe('reveal')
    expect(r.el('c1').dataset.carouselGameId).toBe('car')
    expect(r.el('c1').dataset.carouselChoice).toBe('1')
  })

  it('hides them on the canvas by default, since they are authored on the same spot', () => {
    const r = makeRig([game(), tagged('c1', 'choice', 1)], { start: false })
    expect(r.up('c1')).toBe(false)
  })

  it('leaves one the author asked to see visible on the canvas', () => {
    const shown = tagged('c1', 'choice', 1, { carouselRole: { gameId: 'car', role: 'choice', choice: 1, showOnCanvas: true } })
    const r = makeRig([game(), shown], { start: false })
    expect(r.up('c1')).toBe(true)
  })

  it('does not move anything on the static editor canvas', () => {
    const r = makeRig([game(), tagged('c1', 'choice', 1), tagged('c2', 'choice', 2)], { start: false })
    expect(r.el('c1').style.translate).toBe('')
    expect(r.el('c2').style.translate).toBe('')
  })

  it('claims what it drives and releases it on teardown', () => {
    const r = makeRig([game(), tagged('c1', 'choice', 1), tagged('l1', 'label', 1), tagged('v1', 'reveal', 1)])
    const nodes = ['c1', 'l1', 'v1'].map(r.el)
    expect(nodes.every((n) => n.dataset.carouselClaimedBy === 'car')).toBe(true)
    r.stage.destroy()
    for (const n of nodes) {
      expect(n.dataset.carouselClaimedBy).toBeUndefined()
      expect(n.style.translate).toBe('')
      expect((n.querySelector<HTMLElement>('.pa-el-anim') ?? n).style.scale).toBe('')
    }
  })

  it('puts the canvas back the way it found it', () => {
    const shown = tagged('c1', 'choice', 1, { carouselRole: { gameId: 'car', role: 'choice', choice: 1, showOnCanvas: true } })
    const r = makeRig([game(), shown, tagged('c2', 'choice', 2)])
    const a = r.el('c1')
    const b = r.el('c2')
    r.stage.destroy()
    expect(a.classList.contains(CAROUSEL_OFF_CLASS)).toBe(false) // was shown
    expect(b.classList.contains(CAROUSEL_OFF_CLASS)).toBe(true) // was hidden
  })

  it('takes the row length from what is wired up, not from a number', () => {
    // Three choices assigned, so the third is one step from the first — a count kept by
    // hand could disagree with the elements; this cannot.
    const r = makeRig([game({ startIndex: 1, choices: 99 }), tagged('c1', 'choice', 1), tagged('c2', 'choice', 2), tagged('c3', 'choice', 3)])
    expect(Math.abs(r.shift('c2').x)).toBeLessThan(0.01) // centred
    expect(r.shift('c3').x).toBeCloseTo(STEP, 0)
    expect(r.shift('c1').x).toBeCloseTo(-STEP, 0)
  })

  it('leaves the selected choice exactly where it was authored', () => {
    const r = makeRig([game({ startIndex: 0 }), tagged('c1', 'choice', 1), tagged('c2', 'choice', 2)])
    expect(Math.abs(r.shift('c1').x)).toBeLessThan(0.01)
    expect(Math.abs(r.shift('c1').y)).toBeLessThan(0.01)
    expect(r.scale('c1')).toBeCloseTo(1, 3)
  })

  it('shrinks the side choices by the ratio between the two sizes', () => {
    const r = makeRig([game({ startIndex: 0, centerScale: 2, sideScale: 1 }), tagged('c1', 'choice', 1), tagged('c2', 'choice', 2)])
    expect(r.scale('c2')).toBeCloseTo(0.5, 3)
  })

  it('gives the centre state to whichever choice is selected', () => {
    const a = makeRig([game({ startIndex: 0, centerOffsetY: -40 }), tagged('c1', 'choice', 1), tagged('c2', 'choice', 2)])
    expect(a.shift('c1').y).toBeCloseTo(-40, 0)
    expect(Math.abs(a.shift('c2').y)).toBeLessThan(0.01)
    document.body.innerHTML = ''
    const b = makeRig([game({ startIndex: 1, centerOffsetY: -40 }), tagged('c1', 'choice', 1), tagged('c2', 'choice', 2)])
    expect(b.shift('c2').y).toBeCloseTo(-40, 0)
    expect(Math.abs(b.shift('c1').y)).toBeLessThan(0.01)
  })

  it('carries a label with its own choice, keeping the offset it was authored at', () => {
    // The label sits 150px below the centre spot; that gap is the relationship.
    const lab = tagged('l2', 'label', 2, { y: CENTRE_Y + 150 })
    const r = makeRig([game({ startIndex: 0 }), tagged('c1', 'choice', 1), tagged('c2', 'choice', 2), lab])
    const k = 1 / 1.45 // sideScale ÷ centerScale
    // Choice 2 is one slot along, so its label is too — and the gap shrinks with it.
    expect(r.shift('l2').x).toBeCloseTo(STEP, 0)
    expect(r.shift('l2').y).toBeCloseTo(150 * k - 150, 0)
  })

  it('shows only the selected choice’s reveal', () => {
    const r = makeRig([game({ startIndex: 0 }), tagged('c1', 'choice', 1), tagged('c2', 'choice', 2), tagged('v1', 'reveal', 1), tagged('v2', 'reveal', 2)])
    expect(r.up('v1')).toBe(true)
    expect(r.up('v2')).toBe(false)
  })

  it('shows the reveal belonging to whichever choice starts selected', () => {
    const r = makeRig([game({ startIndex: 1 }), tagged('c1', 'choice', 1), tagged('c2', 'choice', 2), tagged('v1', 'reveal', 1), tagged('v2', 'reveal', 2)])
    expect(r.up('v1')).toBe(false)
    expect(r.up('v2')).toBe(true)
  })

  it('never moves a reveal — it belongs to the layout, not to the row', () => {
    const r = makeRig([game({ startIndex: 0 }), tagged('c1', 'choice', 1), tagged('v1', 'reveal', 1)])
    expect(r.el('v1').style.translate).toBe('')
  })

  it('sets a text label’s centre in its own type rather than blowing one up', () => {
    const r = makeRig([
      game({ startIndex: 0, labelCenterFontSizePx: 90, labelCenterFontWeight: 800, labelCenterFontColor: '#101418' }),
      tagged('c1', 'choice', 1),
      tagged('c2', 'choice', 2),
      textLabel('t1', 1),
      textLabel('t2', 2),
    ])
    // Centred: the centre type, and NOT scaled — the two would otherwise multiply.
    expect(parseFloat(r.inner('t1').style.fontSize)).toBeCloseTo(90, 0)
    expect(r.inner('t1').style.fontWeight).toBe('800')
    expect(r.scale('t1')).toBe(1)
    // A side slot reads at the size the element was actually authored at — the type you
    // set on the element IS the side state, not that size shrunk.
    expect(parseFloat(r.inner('t2').style.fontSize)).toBeCloseTo(40, 0)
    expect(r.inner('t2').style.fontWeight).toBe('400')
    expect(r.scale('t2')).toBe(1)
  })

  it('leaves a text label alone where no centre override is set', () => {
    const r = makeRig([game({ startIndex: 0 }), tagged('c1', 'choice', 1), textLabel('t1', 1)])
    // No size override, so it scales like a picture would and keeps its own weight.
    expect(r.inner('t1').style.fontWeight).toBe('400')
    expect(r.scale('t1')).toBeCloseTo(1, 3)
  })

  it('hands a text label its own type back on teardown', () => {
    const r = makeRig([game({ startIndex: 0, labelCenterFontSizePx: 90 }), tagged('c1', 'choice', 1), textLabel('t1', 1)])
    const inner = r.inner('t1')
    expect(parseFloat(inner.style.fontSize)).toBeCloseTo(90, 0)
    r.stage.destroy()
    // Cleared, so the next layout pass writes the element's authored type back.
    expect(inner.style.fontSize).toBe('')
    expect(inner.style.fontWeight).toBe('')
  })

  it('will not let two carousels drive the same unaddressed element', () => {
    const second = { ...game(), id: 'car2' } as SceneElement
    const loose = tagged('c1', 'choice', 1, { carouselRole: { role: 'choice', choice: 1 } }) // no gameId
    const r = makeRig([game(), second, loose])
    expect(r.el('c1').dataset.carouselClaimedBy).toBe('car')
  })

  it('wins immediately when nothing is wired up, rather than stranding the player', async () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const stage = buildScene(scene([game({ changesToWin: 1 })]), ASSETS, { mount })
    let won = false
    // 'game-win' is intercepted stage-locally by revealOnWin; 'game-complete' is what
    // that reveal pass broadcasts when it finishes.
    const offWin = on('game-complete', () => {
      won = true
    })
    stage.layoutAll()
    stage.startGames(true)
    await vi.waitFor(() => expect(won).toBe(true))
    offWin()
  })

  it('does not claim a win on an empty row when the CTA is what ends it', async () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const stage = buildScene(scene([game({ changesToWin: 0 })]), ASSETS, { mount })
    let won = false
    const offWin = on('game-complete', () => {
      won = true
    })
    stage.layoutAll()
    stage.startGames(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(won).toBe(false)
    offWin()
  })

  it('takes the short way round the ring', () => {
    expect(wrapDelta(5 - 0, 6)).toBe(-1)
    expect(wrapDelta(1 - 0, 6)).toBe(1)
    expect(wrapDelta(3 - 0, 6)).toBe(3)
  })

  it('carries flick momentum past the nearest choice, but not round the world', () => {
    expect(landingIndex(2.1, 0)).toBe(2)
    expect(landingIndex(2.1, 8)).toBeGreaterThan(2)
    expect(landingIndex(2.1, -8)).toBeLessThan(2)
    expect(landingIndex(0, 999)).toBe(3) // capped
    expect(landingIndex(0, -999)).toBe(-3)
  })
})
