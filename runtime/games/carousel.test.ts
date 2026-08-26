// Behavior test for the Carousel: the centre choice is the biggest (and carries
// no border), a swipe rotates the row and settles on a whole item, the choice is
// published into the selection group that Fill slots read, and looping takes the
// short way round rather than unwinding the whole strip.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCarousel, landingIndex, wrapDelta } from './carousel'
import { getPicks, clearPicks } from '../selection'
import { mulberry32, type GameContext } from './types'

const W = 400
const H = 400

interface Rig {
  mod: ReturnType<typeof createCarousel>
  root: HTMLDivElement
  wraps: HTMLDivElement[]
  arts: HTMLDivElement[]
  played: string[]
  completed: () => boolean
  /** A deliberate drag from x0 to x1 that eases to a stop before the lift. */
  swipe(x0: number, x1: number, ms?: number): void
  /** A fast flick released while the finger is still travelling. */
  flick(x0: number, x1: number): void
  /** Run the settle spring to rest. */
  settle(): void
  scaleOf(i: number): number
  xOf(i: number): number
}

let now = 0

function makeRig(params: Record<string, unknown> = {}): Rig {
  const root = document.createElement('div')
  document.body.appendChild(root)
  Object.defineProperty(root, 'clientWidth', { value: W, configurable: true })
  Object.defineProperty(root, 'clientHeight', { value: H, configurable: true })
  const played: string[] = []
  const ctx: GameContext = {
    root,
    assets: { src: (id) => (id ? String(id) : '') },
    sfx: { play: (e) => played.push(e) },
    rng: mulberry32(42),
    scale: () => 1,
  }
  const mod = createCarousel()
  mod.mount(ctx, params)
  mod.start()
  let done = false
  mod.onComplete(() => (done = true))
  const wraps = [...root.children] as HTMLDivElement[]
  const arts = wraps.map((w) => w.firstElementChild as HTMLDivElement)
  const send = (type: string, x: number): void => {
    const e = new Event(type, { bubbles: true }) as PointerEvent
    Object.defineProperties(e, {
      pointerId: { value: 1 },
      clientX: { value: x },
      clientY: { value: H / 2 },
      timeStamp: { value: now },
    })
    root.dispatchEvent(e)
  }
  // jsdom drives rAF off timers; step the clock by whole frames so the spring
  // integrates the same way it would on screen.
  const settle = (): void => {
    for (let i = 0; i < 400; i++) {
      now += 16
      vi.advanceTimersByTime(16)
    }
  }
  const num = (s: string, re: RegExp): number => Number(re.exec(s)?.[1] ?? NaN)
  return {
    mod,
    root,
    wraps,
    arts,
    played,
    completed: () => done,
    swipe(x0, x1, ms = 240) {
      send('pointerdown', x0)
      const steps = 8
      for (let i = 1; i <= steps; i++) {
        now += ms / steps
        send('pointermove', x0 + ((x1 - x0) * i) / steps)
      }
      // A real finger lingers before it lifts, so the release velocity is ~0 and
      // the row settles on where the drag actually left it.
      now += 80
      send('pointermove', x1)
      send('pointerup', x1)
    },
    flick(x0, x1) {
      send('pointerdown', x0)
      for (let i = 1; i <= 4; i++) {
        now += 16
        send('pointermove', x0 + ((x1 - x0) * i) / 4)
      }
      send('pointerup', x1)
    },
    settle,
    scaleOf: (i) => num(arts[i].style.transform, /scale\(([-\d.]+)\)/),
    xOf: (i) => num(wraps[i].style.transform, /translate3d\(([-\d.]+)px/),
  }
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  clearPicks()
})

function useFrames(): void {
  vi.useFakeTimers()
  now = 0
}

describe('carousel', () => {
  it('enlarges only the centre choice, and gives it no border', () => {
    useFrames()
    const r = makeRig({ count: 5, centerScale: 1.5, sideScale: 1 })
    // startIndex -1 → the middle item (index 2 of 5).
    expect(r.scaleOf(2)).toBeCloseTo(1.5, 3)
    expect(r.scaleOf(1)).toBeCloseTo(1, 3)
    expect(r.scaleOf(3)).toBeCloseTo(1, 3)
    for (const a of r.arts) {
      expect(a.style.outline).toBe('')
      expect(a.style.border).toBe('')
      expect(a.style.boxShadow).toBe('')
    }
  })

  it('centres the selected choice horizontally', () => {
    useFrames()
    const r = makeRig({ count: 5, itemPct: 20 })
    const itemW = (W * 20) / 100
    expect(r.xOf(2)).toBeCloseTo(W / 2 - itemW / 2, 3)
  })

  it('advances one choice per swipe and settles on a whole item', () => {
    useFrames()
    const r = makeRig({ count: 5, itemPct: 20, gapPct: 5 })
    const step = (W * 25) / 100
    r.swipe(300, 300 - step) // drag left → the next choice comes to the centre
    r.settle()
    expect(r.scaleOf(3)).toBeCloseTo(1.45, 2)
    expect(r.xOf(3)).toBeCloseTo(W / 2 - (W * 20) / 100 / 2, 1)
  })

  it('publishes the settled choice into the link group for Fill slots', () => {
    useFrames()
    const r = makeRig({
      count: 3,
      linkGroup: 'shade',
      images: ['sw0', 'sw1', 'sw2'],
      results: ['model0', 'model1', 'model2'],
      itemPct: 20,
      gapPct: 5,
    })
    expect(getPicks('shade')).toEqual(['model1']) // middle of 3
    r.swipe(300, 300 - (W * 25) / 100)
    r.settle()
    expect(getPicks('shade')).toEqual(['model2'])
  })

  it('falls back to the choice image when no linked image is assigned', () => {
    useFrames()
    makeRig({ count: 3, linkGroup: 'shade', images: ['sw0', 'sw1', 'sw2'], results: [] })
    expect(getPicks('shade')).toEqual(['sw1'])
  })

  it('wins after the configured number of changes, not before', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 2, itemPct: 20, gapPct: 5 })
    const step = (W * 25) / 100
    r.swipe(300, 300 - step)
    r.settle()
    expect(r.completed()).toBe(false)
    r.swipe(300, 300 - step)
    r.settle()
    expect(r.completed()).toBe(true)
  })

  it('a flick carries past the item the drag alone would have reached', () => {
    useFrames()
    const r = makeRig({ count: 8, changesToWin: 0, itemPct: 20, gapPct: 5, loop: false })
    const step = (W * 25) / 100
    r.flick(360, 360 - step) // same one-step distance, released mid-travel
    r.settle()
    // Off-screen items are parked, so read the centre off the scales we rendered.
    const centre = r.arts.findIndex((_, i) => r.scaleOf(i) > 1.4)
    expect(centre).toBeGreaterThan(4) // the drag alone would have landed on 4
  })

  it('a release without movement is not a change', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 1, itemPct: 20, gapPct: 5 })
    r.swipe(300, 300) // tap-in-place on the centre choice
    r.settle()
    expect(r.completed()).toBe(false)
  })

  it('never wins on its own when changesToWin is 0 (the CTA ends it)', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemPct: 20, gapPct: 5 })
    for (let i = 0; i < 4; i++) {
      r.swipe(300, 300 - (W * 25) / 100)
      r.settle()
    }
    expect(r.completed()).toBe(false)
  })

  it('takes the short way round the ring', () => {
    // 6 slots: from 0, item 5 is one step back, not five steps forward.
    expect(wrapDelta(5 - 0, 6)).toBe(-1)
    expect(wrapDelta(1 - 0, 6)).toBe(1)
    expect(wrapDelta(3 - 0, 6)).toBe(3)
  })

  it('carries flick momentum past the nearest item', () => {
    // A slow release lands where it stopped; a fast one glides further on.
    expect(landingIndex(2.1, 0)).toBe(2)
    expect(landingIndex(2.1, 8)).toBeGreaterThan(2)
    expect(landingIndex(2.1, -8)).toBeLessThan(2)
  })
})
