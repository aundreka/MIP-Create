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
  labels: HTMLDivElement[]
  played: string[]
  completed: () => boolean
  /** A deliberate drag from x0 to x1 that eases to a stop before the lift. */
  swipe(x0: number, x1: number, ms?: number): void
  /** A fast flick released while the finger is still travelling. */
  flick(x0: number, x1: number): void
  /** Run the settle spring to rest. */
  settle(): void
  /** Advance exactly one animation frame. */
  frame(): void
  /** Press and drag to x1, leaving the finger down, with a frame rendered. */
  hold(x0: number, x1: number): void
  /** Lift the finger that `hold` left down. */
  lift(x: number): void
  scaleOf(i: number): number
  xOf(i: number): number
  artShift(i: number): { x: number; y: number }
  labelShift(i: number): { x: number; y: number }
  labelScale(i: number): number
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
  const labels = wraps.map((w) => w.querySelector('.pa-carousel-label') as HTMLDivElement)
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
    labels,
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
    frame() {
      now += 16
      vi.advanceTimersByTime(16)
    },
    hold(x0, x1) {
      send('pointerdown', x0)
      for (let i = 1; i <= 4; i++) {
        now += 16
        send('pointermove', x0 + ((x1 - x0) * i) / 4)
      }
      now += 80 // settle the finger so a later lift is a drag, not a flick
      send('pointermove', x1)
      vi.advanceTimersByTime(16) // let the drag frame render
    },
    lift(x) {
      send('pointerup', x)
    },
    scaleOf: (i) => num(arts[i].style.transform, /scale\(([-\d.]+)\)/),
    xOf: (i) => num(wraps[i].style.transform, /translate3d\(([-\d.]+)px/),
    artShift: (i) => {
      const m = /translate3d\(([-\d.]+)px,([-\d.]+)px/.exec(arts[i].style.transform)
      return { x: Number(m?.[1] ?? NaN), y: Number(m?.[2] ?? NaN) }
    },
    labelShift: (i) => {
      const m = /translate\(-50%,-50%\) translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(labels[i].style.transform)
      return { x: Number(m?.[1] ?? NaN), y: Number(m?.[2] ?? NaN) }
    },
    labelScale: (i) => num(labels[i].style.transform, /scale\(([-\d.]+)\)/),
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

  it('gives each option a label image that rides in its own wrap', () => {
    useFrames()
    const r = makeRig({ count: 3, labelImages: ['lbl0', 'lbl1', 'lbl2'], labelImgHeightPx: 40 })
    // The label lives inside the SAME wrap as its art, which is what keeps the two
    // together through every slot — not a separate row indexed by slot.
    r.wraps.forEach((wrap, i) => {
      const img = wrap.querySelector('img[src^="lbl"]') as HTMLImageElement
      expect(img).toBeTruthy()
      expect(img.getAttribute('src')).toBe('lbl' + i)
      expect(wrap.contains(r.labels[i])).toBe(true)
    })
  })

  it('keeps a label with its own option after the row moves', () => {
    useFrames()
    const r = makeRig({ count: 5, labelImages: ['a', 'b', 'c', 'd', 'e'], itemPct: 20, gapPct: 5 })
    const srcAt = (i: number): string => (r.wraps[i].querySelector('img[src]:not([src^="sw"])') as HTMLImageElement).getAttribute('src')!
    r.swipe(300, 300 - (W * 25) / 100)
    r.settle()
    // Option 3 is now centred; its label is still option 3's, not slot 3's.
    expect(r.scaleOf(3)).toBeGreaterThan(1.4)
    expect(srcAt(3)).toBe('d')
    expect(srcAt(2)).toBe('c')
  })

  it('falls back to typed text for an option with no label image', () => {
    useFrames()
    const r = makeRig({ count: 3, labels: 'One, Two, Three', labelImages: ['a', '', 'c'] })
    expect(r.wraps[1].querySelector('img[src="a"], img[src="c"]')).toBeNull()
    expect(r.labels[1].textContent).toBe('Two')
    expect(r.labels[0].querySelector('img')).toBeTruthy()
  })

  it('offsets the centre choice without touching the side ones', () => {
    useFrames()
    const r = makeRig({ count: 5, centerOffsetX: 12, centerOffsetY: -30, itemPct: 20, gapPct: 5 })
    expect(r.artShift(2)).toEqual({ x: 12, y: -30 }) // centred
    expect(r.artShift(1)).toEqual({ x: 0, y: 0 }) // side slots stay put
    expect(r.artShift(3)).toEqual({ x: 0, y: 0 })
  })

  it('offsets and resizes the centre label independently of the art', () => {
    useFrames()
    const r = makeRig({
      count: 5,
      labelImages: ['a', 'b', 'c', 'd', 'e'],
      labelOffsetY: 6,
      labelCenterOffsetX: -8,
      labelCenterOffsetY: 40,
      labelImgCenterScale: 2,
      centerOffsetY: -20,
      itemPct: 20,
      gapPct: 5,
    })
    expect(r.labelShift(2)).toEqual({ x: -8, y: 40 }) // centre state
    expect(r.labelShift(1)).toEqual({ x: 0, y: 6 }) // base state, every side slot
    expect(r.labelScale(2)).toBeCloseTo(2, 3)
    expect(r.labelScale(1)).toBeCloseTo(1, 3)
    // The art moved its own way — the two are independent.
    expect(r.artShift(2).y).toBe(-20)
  })

  it('carries the centre state to whichever option arrives there', () => {
    useFrames()
    const r = makeRig({ count: 5, centerOffsetY: -24, labelCenterOffsetY: 18, labelImages: ['a', 'b', 'c', 'd', 'e'], itemPct: 20, gapPct: 5 })
    r.swipe(300, 300 - (W * 25) / 100)
    r.settle()
    expect(r.artShift(3)).toEqual({ x: 0, y: -24 }) // now it is 3 that is lifted
    expect(r.artShift(2)).toEqual({ x: 0, y: 0 }) // and 2 has returned to base
    expect(r.labelShift(3).y).toBe(18)
    expect(r.labelShift(2).y).toBe(0)
  })

  it('eases between the two states rather than snapping at the halfway point', () => {
    useFrames()
    const r = makeRig({ count: 5, centerOffsetY: -100, itemPct: 20, gapPct: 5 })
    const step = (W * 25) / 100
    // Hold the row half a step across. Neither option is centred, so BOTH should
    // be showing a partial amount of the centre state — a snap at the midpoint
    // would leave one at 0 and the other already at -100.
    r.hold(300, 300 - step / 2)
    for (const i of [2, 3]) {
      expect(r.artShift(i).y).toBeLessThan(-1)
      expect(r.artShift(i).y).toBeGreaterThan(-99)
      expect(r.scaleOf(i)).toBeGreaterThan(1)
      expect(r.scaleOf(i)).toBeLessThan(1.45)
    }
    r.lift(300 - step / 2)
    r.settle()
    expect(r.artShift(3).y).toBeCloseTo(-100, 5) // fully arrived
    expect(r.artShift(2).y).toBeCloseTo(0, 5) // fully departed
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
