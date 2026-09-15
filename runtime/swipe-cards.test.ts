// Swipe cards: a pile of placed elements, swiped left or right, feeding a progress bar
// and handing the first liked card to a result image — on this scene or a later one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './emitter'
import { resetSwipeResults } from './games/swipechannel'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

function pointer(type: string, x: number, y: number, pointerId = 1): PointerEvent {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as PointerEvent
  Object.defineProperty(ev, 'pointerId', { value: pointerId, configurable: true })
  Object.defineProperty(ev, 'pointerType', { value: 'touch', configurable: true })
  return ev
}

function game(params: Record<string, unknown> = {}): SceneElement {
  return {
    id: 'swipe-game',
    type: 'game-mount',
    name: 'Swipe',
    x: 540,
    y: 960,
    w: 1000,
    h: 1000,
    anchor: 'center',
    zIndex: 1,
    mode: 'fit',
    game: { templateId: 'swipecards', hintEnabled: false, params: { flingMs: 300, settleMs: 0, returnMs: 0, revealMs: 0, ...params } },
  } as SceneElement
}

function bar(params: Record<string, unknown> = {}): SceneElement {
  return {
    id: 'bar',
    type: 'game-mount',
    name: 'Bar',
    x: 540,
    y: 200,
    w: 900,
    h: 20,
    anchor: 'center',
    zIndex: 2,
    mode: 'fit',
    game: { templateId: 'progressbar', hintEnabled: false, params: { fillMs: 0, popMs: 0, ...params } },
  } as SceneElement
}

function card(id: string, index: number, extra: Partial<SceneElement> = {}): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: id,
    x: 540 + index * 10,
    y: 960,
    w: 600,
    h: 800,
    anchor: 'center',
    zIndex: 10 + index, // deliberately the WRONG way up: card 1 is lowest in the layers
    mode: 'fit',
    swipeRole: { gameId: 'swipe-game', role: 'card', index },
    ...extra,
  } as SceneElement
}

function result(id = 'result'): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'placeholder',
    x: 540,
    y: 900,
    w: 400,
    h: 500,
    anchor: 'center',
    zIndex: 30,
    mode: 'fit',
    swipeRole: { gameId: 'swipe-game', role: 'result' },
  } as SceneElement
}

function mark(id: string, role: 'like' | 'nope' | 'yes' | 'no', showOnCanvas?: boolean): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'placeholder',
    x: 400,
    y: 700,
    w: 100,
    h: 100,
    anchor: 'center',
    zIndex: 40,
    mode: 'fit',
    swipeRole: { gameId: 'swipe-game', role, showOnCanvas },
  } as SceneElement
}

const ASSETS = {
  c1: { src: 'c1.png', w: 600, h: 800 },
  c2: { src: 'c2.png', w: 600, h: 800 },
  c3: { src: 'c3.png', w: 600, h: 800 },
  placeholder: { src: 'placeholder.png', w: 400, h: 500 },
}

function build(elements: SceneElement[]): ReturnType<typeof buildScene> {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'swipe', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    kind: 'game',
    elements,
  }
  const stage = buildScene(scene, ASSETS, { mount })
  stage.layoutAll()
  return stage
}

const q = (s: ReturnType<typeof buildScene>, id: string): HTMLElement => s.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
const widthOf = (el: HTMLElement): number => parseFloat(el.style.width)
const hidden = (el: HTMLElement): boolean => el.classList.contains('pa-combo-off')
const resultSrc = (s: ReturnType<typeof buildScene>, id = 'result'): string => q(s, id).querySelector('img')!.getAttribute('src') ?? ''

/** A slow, deliberate drag of `dx` px — no flick. */
function drag(el: HTMLElement, dx: number): void {
  el.dispatchEvent(pointer('pointerdown', 500, 900))
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    vi.advanceTimersByTime(40)
    window.dispatchEvent(pointer('pointermove', 500 + (dx * i) / steps, 900))
  }
  // Hold still before letting go, so the release is judged on distance alone.
  vi.advanceTimersByTime(200)
  window.dispatchEvent(pointer('pointerup', 500 + dx, 900))
}

describe('swipe cards', () => {
  let off: (() => void) | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    resetSwipeResults()
  })

  afterEach(() => {
    off?.()
    off = null
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('tags the cards, keeps them grabbable and stacks card 1 on top', () => {
    const stage = build([game(), card('c1', 1), card('c2', 2), card('c3', 3)])
    stage.startGames(true)
    const c1 = q(stage, 'c1')
    expect(c1.dataset.swipeRole).toBe('card')
    expect(c1.style.pointerEvents).not.toBe('none')
    expect(Number(c1.style.zIndex)).toBeGreaterThan(Number(q(stage, 'c2').style.zIndex))
    expect(Number(q(stage, 'c2').style.zIndex)).toBeGreaterThan(Number(q(stage, 'c3').style.zIndex))
    expect(c1.dataset.swipeHint).toBe('1')
  })

  it('leaves the editor canvas alone', () => {
    const stage = build([game({ display: 'one' }), card('c1', 1), card('c2', 2)])
    stage.startGames(false)
    expect(hidden(q(stage, 'c2'))).toBe(false)
    expect(q(stage, 'c1').dataset.swipeHint).toBeUndefined()
  })

  it('flings a card dragged past the line and moves to the next', () => {
    const stage = build([game(), card('c1', 1), card('c2', 2)])
    stage.startGames(true)
    drag(q(stage, 'c1'), 400)
    vi.advanceTimersByTime(400)
    expect(hidden(q(stage, 'c1'))).toBe(true)
    expect(q(stage, 'c2').dataset.swipeHint).toBe('1')
  })

  it('springs a short drag back instead of counting it', () => {
    const stage = build([game(), bar(), card('c1', 1), card('c2', 2)])
    stage.startGames(true)
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!
    drag(q(stage, 'c1'), 60)
    vi.runAllTimers()
    expect(hidden(q(stage, 'c1'))).toBe(false)
    expect(q(stage, 'c1').style.translate).toBe('')
    expect(track.dataset.progressValue).toBe('0')
  })

  it('counts a quick flick even short of the line', () => {
    const stage = build([game(), card('c1', 1), card('c2', 2)])
    stage.startGames(true)
    const c1 = q(stage, 'c1')
    c1.dispatchEvent(pointer('pointerdown', 500, 900))
    vi.advanceTimersByTime(16)
    window.dispatchEvent(pointer('pointermove', 530, 900))
    vi.advanceTimersByTime(16)
    window.dispatchEvent(pointer('pointermove', 580, 900))
    window.dispatchEvent(pointer('pointerup', 580, 900))
    vi.runAllTimers()
    expect(hidden(c1)).toBe(true)
  })

  it('shows the FIRST card swiped right on in the result, and nothing for passes', () => {
    const stage = build([game(), card('c1', 1), card('c2', 2), card('c3', 3), result()])
    stage.startGames(true)
    expect(resultSrc(stage)).toBe('placeholder.png')

    drag(q(stage, 'c1'), -400) // pass
    vi.runAllTimers()
    expect(resultSrc(stage)).toBe('placeholder.png')

    drag(q(stage, 'c2'), 400) // like
    vi.runAllTimers()
    expect(resultSrc(stage)).toBe('c2.png')

    drag(q(stage, 'c3'), 400) // a later like does not replace the first
    vi.runAllTimers()
    expect(resultSrc(stage)).toBe('c2.png')
  })

  it('carries the liked card to a result on a later scene', () => {
    const first = build([game(), card('c1', 1), card('c2', 2)])
    first.startGames(true)
    drag(q(first, 'c1'), 400)
    vi.runAllTimers()
    first.destroy()

    const end = build([result('end-result')])
    end.startGames(true)
    expect(resultSrc(end, 'end-result')).toBe('c1.png')
  })

  it('keeps the placeholder when every card is passed', () => {
    const stage = build([game(), card('c1', 1), card('c2', 2), result()])
    stage.startGames(true)
    drag(q(stage, 'c1'), -400)
    vi.runAllTimers()
    drag(q(stage, 'c2'), -400)
    vi.runAllTimers()
    expect(resultSrc(stage)).toBe('placeholder.png')
  })

  it('shows one card at a time when asked', () => {
    const stage = build([game({ display: 'one' }), card('c1', 1), card('c2', 2), card('c3', 3)])
    stage.startGames(true)
    expect(hidden(q(stage, 'c1'))).toBe(false)
    expect(hidden(q(stage, 'c2'))).toBe(true)
    drag(q(stage, 'c1'), 400)
    vi.runAllTimers()
    expect(hidden(q(stage, 'c2'))).toBe(false)
    expect(hidden(q(stage, 'c3'))).toBe(true)
  })

  it('fills one bar per swipe on a separate-bars progress bar, and wins at the end', () => {
    const seen: string[] = []
    off = on('game-complete', () => seen.push('win'))
    const stage = build([game(), bar({ fillStyle: 'bars' }), card('c1', 1), card('c2', 2), card('c3', 3)])
    stage.startGames(true)
    const fills = Array.from(stage.root.querySelectorAll<HTMLElement>('[data-progress-seg-fill]'))
    expect(fills).toHaveLength(3)
    expect(fills.map(widthOf)).toEqual([0, 0, 0])

    drag(q(stage, 'c1'), 400)
    vi.runAllTimers()
    expect(fills.map(widthOf)).toEqual([100, 0, 0])
    expect(seen).toEqual([])

    drag(q(stage, 'c2'), -400)
    vi.runAllTimers()
    drag(q(stage, 'c3'), 400)
    vi.runAllTimers()
    expect(fills.map(widthOf)).toEqual([100, 100, 100])
    expect(seen.length).toBeGreaterThan(0)
  })

  it('copies the swipe marks into every card and fades the right one in with the drag', () => {
    const stage = build([game(), card('c1', 1), card('c2', 2), mark('heart', 'like'), mark('cross', 'nope')])
    stage.startGames(true)
    expect(hidden(q(stage, 'heart'))).toBe(true)
    const c1 = q(stage, 'c1')
    const like = c1.querySelector<HTMLElement>('[data-swipe-mark="like"]')!
    const nope = c1.querySelector<HTMLElement>('[data-swipe-mark="nope"]')!
    expect(q(stage, 'c2').querySelectorAll('[data-swipe-mark]')).toHaveLength(2)
    expect(like.style.opacity).toBe('0')

    c1.dispatchEvent(pointer('pointerdown', 500, 900))
    vi.advanceTimersByTime(100)
    window.dispatchEvent(pointer('pointermove', 580, 900))
    expect(Number(like.style.opacity)).toBeGreaterThan(0)
    expect(Number(nope.style.opacity)).toBe(0)

    vi.advanceTimersByTime(100)
    window.dispatchEvent(pointer('pointermove', 420, 900))
    expect(Number(like.style.opacity)).toBe(0)
    expect(Number(nope.style.opacity)).toBeGreaterThan(0)

    vi.advanceTimersByTime(300)
    window.dispatchEvent(pointer('pointerup', 500, 900))
    vi.runAllTimers()
    expect(Number(nope.style.opacity)).toBe(0)

    stage.destroy()
    expect(c1.querySelectorAll('[data-swipe-mark]')).toHaveLength(0)
  })

  it('hides a mark on the canvas unless it is being positioned', () => {
    const stage = build([game(), card('c1', 1), mark('heart', 'like', true), mark('cross', 'nope')])
    stage.startGames(false)
    expect(hidden(q(stage, 'heart'))).toBe(false)
    expect(hidden(q(stage, 'cross'))).toBe(true)
  })

  it('swipes the top card from the Yes and No buttons, one card per tap', () => {
    const stage = build([game(), bar(), card('c1', 1), card('c2', 2), card('c3', 3), result(), mark('yes', 'yes'), mark('no', 'no')])
    stage.startGames(true)
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!
    const tap = (id: string): void => void q(stage, id).dispatchEvent(pointer('pointerdown', 10, 10))
    expect(q(stage, 'yes').style.pointerEvents).toBe('auto')

    tap('no')
    tap('yes') // mid-lean: must not swipe a second card or reverse the first
    vi.runAllTimers()
    expect(hidden(q(stage, 'c1'))).toBe(true)
    expect(hidden(q(stage, 'c2'))).toBe(false)
    expect(track.dataset.progressValue).toBe('1')
    expect(resultSrc(stage)).toBe('placeholder.png')

    tap('yes')
    vi.runAllTimers()
    expect(hidden(q(stage, 'c2'))).toBe(true)
    expect(resultSrc(stage)).toBe('c2.png')
  })

  it('wins early on a swipe target', () => {
    const seen: string[] = []
    off = on('game-complete', () => seen.push('win'))
    const stage = build([game({ winSwipes: 1 }), card('c1', 1), card('c2', 2)])
    stage.startGames(true)
    drag(q(stage, 'c1'), 400)
    vi.runAllTimers()
    expect(seen.length).toBeGreaterThan(0)
    expect(hidden(q(stage, 'c2'))).toBe(false)
  })
})

describe('editable handguide: swipecards mode', () => {
  const PERIOD = 1000
  let now = 0

  function guide(extra: Record<string, unknown> = {}): SceneElement {
    return {
      id: 'hg',
      type: 'handguide',
      name: 'Hint hand',
      x: 540,
      y: 900,
      w: 60,
      h: 74,
      anchor: 'center',
      zIndex: 9,
      mode: 'fit',
      assetId: 'hand',
      handguide: { mode: 'swipecards', periodMs: PERIOD, ...extra },
    } as SceneElement
  }

  function setup(el: SceneElement): { visual: HTMLElement; stage: ReturnType<typeof buildScene> } {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const scene: Scene = { meta: { schemaVersion: 1, name: 'hg', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 }, elements: [el], kind: 'game' }
    const stage = buildScene(scene, { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount })
    stage.layoutAll()
    const target = document.createElement('div')
    target.dataset.swipeHint = '1'
    target.getBoundingClientRect = () => ({ x: 400, y: 600, left: 400, top: 600, right: 600, bottom: 800, width: 200, height: 200, toJSON: () => ({}) }) as DOMRect
    stage.root.appendChild(target)
    const outer = mount.querySelector('.pa-el[data-id="hg"]') as HTMLElement
    outer.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 60, bottom: 74, width: 60, height: 74, toJSON: () => ({}) }) as DOMRect
    stage.startGames(true)
    return { visual: outer.querySelector('img') as HTMLElement, stage }
  }

  const xOf = (t: string): number => Number(/translate\((-?\d+)px,(-?\d+)px\)/.exec(t)![1])
  const paint = (ms: number): void => {
    now = ms
    vi.advanceTimersByTime(20)
  }

  beforeEach(() => {
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    vi.useFakeTimers()
    now = 0
    vi.stubGlobal('performance', { now: () => now })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(now), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('drags from the card centre toward the right by default', () => {
    const { visual, stage } = setup(guide())
    paint(PERIOD * 0.1)
    const start = xOf(visual.style.transform)
    paint(PERIOD * 0.8)
    expect(xOf(visual.style.transform)).toBeGreaterThan(start + 50)
    stage.destroy()
  })

  it('drags left when told to', () => {
    const { visual, stage } = setup(guide({ swipeDir: 'left' }))
    paint(PERIOD * 0.1)
    const start = xOf(visual.style.transform)
    paint(PERIOD * 0.8)
    expect(xOf(visual.style.transform)).toBeLessThan(start - 50)
    stage.destroy()
  })

  it('hides while there is no card to point at', () => {
    const { visual, stage } = setup(guide())
    stage.root.querySelector('[data-swipe-hint]')!.remove()
    paint(PERIOD * 0.5)
    expect(visual.style.opacity).toBe('0')
    stage.destroy()
  })
})
