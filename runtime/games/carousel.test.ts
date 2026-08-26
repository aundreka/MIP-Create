// Behavior test for the Carousel: the centre choice is the biggest (and carries
// no border), a swipe rotates the row and settles on a whole item, the choice is
// published into the selection group that Fill slots read, and looping takes the
// short way round rather than unwinding the whole strip.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAROUSEL_TEMPLATE, createCarousel, landingIndex, wrapDelta } from './carousel'
import { validateTemplate } from './validate'
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
  /** Did the module raise the win signal the "on game won" sound hangs off? */
  won: () => boolean
  winBeforeComplete: () => boolean
  /** A deliberate drag from x0 to x1 that eases to a stop before the lift. */
  swipe(x0: number, x1: number, ms?: number): void
  /** A fast flick released while the finger is still travelling. */
  flick(x0: number, x1: number): void
  /** Run the settle spring to rest. */
  settle(): void
  /** Advance exactly one animation frame. */
  frame(): void
  /** Press and release on one choice, without moving. */
  tap(i: number): void
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

function makeRig(params: Record<string, unknown> = {}, opts: { w?: number } = {}): Rig {
  const root = document.createElement('div')
  document.body.appendChild(root)
  Object.defineProperty(root, 'clientWidth', { value: opts.w ?? W, configurable: true })
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
  // The stage plays the "When the game is won" binding off onWin, and times the scene's
  // win phase off onComplete — so the order between them is what that binding depends
  // on. onComplete holds ONE callback, so both live in the same registration.
  let wonAt = -1
  let doneAt = -1
  let seq = 0
  mod.onWin?.(() => (wonAt = ++seq))
  mod.onComplete(() => {
    done = true
    doneAt = ++seq
  })
  const wraps = [...root.children] as HTMLDivElement[]
  const arts = wraps.map((w) => w.firstElementChild as HTMLDivElement)
  const labels = wraps.map((w) => w.querySelector('.pa-carousel-label') as HTMLDivElement)
  const send = (type: string, x: number, onto?: HTMLElement): void => {
    const e = new Event(type, { bubbles: true }) as PointerEvent
    Object.defineProperties(e, {
      pointerId: { value: 1 },
      clientX: { value: x },
      clientY: { value: H / 2 },
      timeStamp: { value: now },
    })
    ;(onto ?? root).dispatchEvent(e)
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
    won: () => wonAt > 0,
    winBeforeComplete: () => wonAt > 0 && doneAt > 0 && wonAt < doneAt,
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
    tap(i) {
      send('pointerdown', 300, wraps[i])
      now += 30
      // Released on the ROOT, not the choice: the root takes pointer capture in a real
      // browser, which retargets everything after the press to itself. jsdom has no
      // setPointerCapture, so a test that released on the choice would pass against
      // code that only works there.
      send('pointerup', 300)
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
    const r = makeRig({ count: 5, itemWidthPx: 80 })
    const itemW = 80
    expect(r.xOf(2)).toBeCloseTo(W / 2 - itemW / 2, 3)
  })

  it('advances one choice per swipe and settles on a whole item', () => {
    useFrames()
    const r = makeRig({ count: 5, itemWidthPx: 80, gapPx: 20 })
    const step = 100 // 80 wide + a 20 gap
    r.swipe(300, 300 - step) // drag left → the next choice comes to the centre
    r.settle()
    expect(r.scaleOf(3)).toBeCloseTo(1.45, 2)
    expect(r.xOf(3)).toBeCloseTo(W / 2 - 80 / 2, 1)
  })

  it('publishes the settled choice into the link group for Fill slots', () => {
    useFrames()
    const r = makeRig({
      count: 3,
      linkGroup: 'shade',
      images: ['sw0', 'sw1', 'sw2'],
      results: ['model0', 'model1', 'model2'],
      itemWidthPx: 80,
      gapPx: 20,
    })
    expect(getPicks('shade')).toEqual(['model1']) // middle of 3
    r.swipe(300, 300 - 100)
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
    const r = makeRig({ count: 5, changesToWin: 2, itemWidthPx: 80, gapPx: 20 })
    const step = 100 // 80 wide + a 20 gap
    r.swipe(300, 300 - step)
    r.settle()
    expect(r.completed()).toBe(false)
    r.swipe(300, 300 - step)
    r.settle()
    expect(r.completed()).toBe(true)
  })

  it('a flick carries past the item the drag alone would have reached', () => {
    useFrames()
    const r = makeRig({ count: 8, changesToWin: 0, itemWidthPx: 80, gapPx: 20, loop: false })
    const step = 100 // 80 wide + a 20 gap
    r.flick(360, 360 - step) // same one-step distance, released mid-travel
    r.settle()
    // Off-screen items are parked, so read the centre off the scales we rendered.
    const centre = r.arts.findIndex((_, i) => r.scaleOf(i) > 1.4)
    expect(centre).toBeGreaterThan(4) // the drag alone would have landed on 4
  })

  it('a release without movement is not a change', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 1, itemWidthPx: 80, gapPx: 20 })
    r.swipe(300, 300) // tap-in-place on the centre choice
    r.settle()
    expect(r.completed()).toBe(false)
  })

  it('never wins on its own when changesToWin is 0 (the CTA ends it)', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemWidthPx: 80, gapPx: 20 })
    for (let i = 0; i < 4; i++) {
      r.swipe(300, 300 - 100)
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
    const r = makeRig({ count: 5, labelImages: ['a', 'b', 'c', 'd', 'e'], itemWidthPx: 80, gapPx: 20 })
    const srcAt = (i: number): string => (r.wraps[i].querySelector('img[src]:not([src^="sw"])') as HTMLImageElement).getAttribute('src')!
    r.swipe(300, 300 - 100)
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
    const r = makeRig({ count: 5, centerOffsetX: 12, centerOffsetY: -30, itemWidthPx: 80, gapPx: 20 })
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
      itemWidthPx: 80,
      gapPx: 20,
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
    const r = makeRig({ count: 5, centerOffsetY: -24, labelCenterOffsetY: 18, labelImages: ['a', 'b', 'c', 'd', 'e'], itemWidthPx: 80, gapPx: 20 })
    r.swipe(300, 300 - 100)
    r.settle()
    expect(r.artShift(3)).toEqual({ x: 0, y: -24 }) // now it is 3 that is lifted
    expect(r.artShift(2)).toEqual({ x: 0, y: 0 }) // and 2 has returned to base
    expect(r.labelShift(3).y).toBe(18)
    expect(r.labelShift(2).y).toBe(0)
  })

  it('eases between the two states rather than snapping at the halfway point', () => {
    useFrames()
    const r = makeRig({ count: 5, centerOffsetY: -100, itemWidthPx: 80, gapPx: 20 })
    const step = 100 // 80 wide + a 20 gap
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

  it('draws the choice at the size you typed, in design px', () => {
    useFrames()
    const r = makeRig({ count: 5, itemWidthPx: 120, itemHeightPx: 60 })
    const art = r.arts[2]
    expect(parseFloat(art.parentElement!.style.width)).toBeCloseTo(120, 3)
    expect(parseFloat(art.style.height)).toBeCloseTo(60, 3)
  })

  it('puts exactly the gap you asked for between choices', () => {
    useFrames()
    const r = makeRig({ count: 5, itemWidthPx: 100, gapPx: 40 })
    // Slot pitch is the choice plus the gap, so the numbers add up on their own.
    expect(r.xOf(3) - r.xOf(2)).toBeCloseTo(140, 3)
  })

  it('gives the centre its own gap, leaving every other gap alone', () => {
    useFrames()
    // 100 wide + 20 gap = a 120 pitch everywhere; +30 beside the centre only.
    const r = makeRig({ count: 7, itemWidthPx: 100, gapPx: 20, centerGapExtraPx: 30, startIndex: 3 })
    const centreToNeighbour = r.xOf(4) - r.xOf(3)
    const neighbourToNext = r.xOf(5) - r.xOf(4)
    expect(centreToNeighbour).toBeCloseTo(150, 3) // 120 + 30
    expect(neighbourToNext).toBeCloseTo(120, 3) // untouched
    // ...and the same on the left, since the push is symmetric.
    expect(r.xOf(3) - r.xOf(2)).toBeCloseTo(150, 3)
    expect(r.xOf(2) - r.xOf(1)).toBeCloseTo(120, 3)
  })

  it('can pull the centre’s neighbours in as well as push them out', () => {
    useFrames()
    const r = makeRig({ count: 7, itemWidthPx: 100, gapPx: 40, centerGapExtraPx: -20, startIndex: 3 })
    expect(r.xOf(4) - r.xOf(3)).toBeCloseTo(120, 3) // 140 - 20
    expect(r.xOf(5) - r.xOf(4)).toBeCloseTo(140, 3)
  })

  it('leaves the row uniform when no extra is asked for', () => {
    useFrames()
    const r = makeRig({ count: 7, itemWidthPx: 100, gapPx: 20, startIndex: 3 })
    expect(r.xOf(4) - r.xOf(3)).toBeCloseTo(120, 3)
    expect(r.xOf(5) - r.xOf(4)).toBeCloseTo(120, 3)
  })

  it('hands the centre gap over as the selection moves', () => {
    useFrames()
    // Same row, a different choice selected: the wide gaps must follow the centre.
    const r = makeRig({ count: 7, itemWidthPx: 100, gapPx: 20, centerGapExtraPx: 30, startIndex: 4 })
    expect(r.xOf(5) - r.xOf(4)).toBeCloseTo(150, 3)
    expect(r.xOf(4) - r.xOf(3)).toBeCloseTo(150, 3)
    expect(r.xOf(3) - r.xOf(2)).toBeCloseTo(120, 3)
  })

  it('opens the centre gap smoothly instead of snapping it open', () => {
    useFrames()
    // A wide mount, so slot 2 out is still on screen and therefore still drawn.
    const r = makeRig({ count: 7, itemWidthPx: 100, gapPx: 20, centerGapExtraPx: 60, startIndex: 3 }, { w: 900 })
    const step = 120
    // The pair straddling the centre always holds the wide gap, so watch the one that
    // actually has to change: 4→5 is narrow while 3 is selected and wide once 4 is.
    const gap = (): number => r.xOf(5) - r.xOf(4)
    expect(gap()).toBeCloseTo(120, 3)
    const seen = [gap()]
    r.hold(300, 300 - step / 2)
    seen.push(gap())
    for (let i = 0; i < 30; i++) {
      r.frame()
      seen.push(gap())
    }
    r.lift(300 - step / 2)
    r.settle()
    expect(gap()).toBeCloseTo(180, 3) // 4 is selected now
    // It got there by passing through, not by jumping.
    expect(seen.some((v) => v > 121 && v < 179)).toBe(true)
    const steps = seen.slice(1).map((v, i) => Math.abs(v - seen[i]))
    expect(Math.max(...steps)).toBeLessThan(35)
  })

  it('butts the choices together at a gap of 0', () => {
    useFrames()
    const r = makeRig({ count: 5, itemWidthPx: 100, gapPx: 0 })
    expect(r.xOf(3) - r.xOf(2)).toBeCloseTo(100, 3)
  })

  it('keeps the size independent of the game box', () => {
    // The point of design px over a percentage: resizing the mount must not resize the
    // choices out from under the author.
    useFrames()
    const a = makeRig({ count: 5, itemWidthPx: 100, gapPx: 20 })
    const wide = a.xOf(3) - a.xOf(2)
    document.body.innerHTML = ''
    const b = makeRig({ count: 5, itemWidthPx: 100, gapPx: 20 }, { w: 900 })
    expect(b.xOf(3) - b.xOf(2)).toBeCloseTo(wide, 3)
    expect(parseFloat(b.arts[2].parentElement!.style.width)).toBeCloseTo(100, 3)
  })

  it('moves the whole row without touching the game box', () => {
    useFrames()
    const a = makeRig({ count: 5, itemWidthPx: 80 })
    const b0 = a.wraps[2].style.top
    document.body.innerHTML = ''
    const b = makeRig({ count: 5, itemWidthPx: 80, rowOffsetY: -50 })
    expect(parseFloat(b.wraps[2].style.top)).toBeCloseTo(parseFloat(b0) - 50, 3)
  })

  it('moves the label without moving the choices', () => {
    useFrames()
    const a = makeRig({ count: 3, labels: 'a, b, c', itemWidthPx: 80, itemHeightPx: 80 })
    const artTop = a.arts[1].style.top
    const wrapTop = a.wraps[1].style.top
    document.body.innerHTML = ''
    const b = makeRig({ count: 3, labels: 'a, b, c', itemWidthPx: 80, itemHeightPx: 80, labelOffsetY: -200 })
    // Nudging a label is about the label. The row must stay exactly where it was.
    expect(b.arts[1].style.top).toBe(artTop)
    expect(b.wraps[1].style.top).toBe(wrapTop)
  })

  it('nudges the label by exactly what it was asked for', () => {
    useFrames()
    const a = makeRig({ count: 3, labels: 'a, b, c', itemWidthPx: 80, itemHeightPx: 80 })
    const base = parseFloat(a.labels[1].style.top)
    document.body.innerHTML = ''
    const b = makeRig({ count: 3, labels: 'a, b, c', itemWidthPx: 80, itemHeightPx: 80, labelOffsetY: -30, labelOffsetX: 12 })
    expect(parseFloat(b.labels[1].style.top)).toBeCloseTo(base, 3) // the anchor is unchanged...
    expect(b.labelShift(0)).toEqual({ x: 12, y: -30 }) // ...the nudge is the transform (a side slot; 1 of 3 is the centre)
  })

  it('gives the centre label a position of its own', () => {
    useFrames()
    const r = makeRig({ count: 5, labels: 'a, b, c, d, e', itemWidthPx: 80, labelOffsetY: 8, labelCenterOffsetY: 44, labelCenterOffsetX: -10, startIndex: 2 })
    expect(r.labelShift(2)).toEqual({ x: -10, y: 44 }) // selected
    expect(r.labelShift(1)).toEqual({ x: 0, y: 8 }) // every other slot
  })

  it('puts the label above the choice when asked', () => {
    useFrames()
    const below = makeRig({ count: 3, labels: 'a, b, c', itemWidthPx: 80, itemHeightPx: 80 })
    const artY = parseFloat(below.arts[1].style.top)
    expect(parseFloat(below.labels[1].style.top)).toBeGreaterThan(artY)
    document.body.innerHTML = ''
    const above = makeRig({ count: 3, labels: 'a, b, c', itemWidthPx: 80, itemHeightPx: 80, labelPlacement: 'above' })
    expect(parseFloat(above.labels[1].style.top)).toBeLessThan(parseFloat(above.arts[1].style.top))
  })

  it('can sit the label right on top of the choice', () => {
    useFrames()
    const r = makeRig({ count: 3, labels: 'a, b, c', itemWidthPx: 80, itemHeightPx: 80, labelPlacement: 'over' })
    // The label's anchor is the art's own centre, so it reads as a caption on the art.
    const artCentre = parseFloat(r.arts[1].style.top) + 80 / 2
    expect(parseFloat(r.labels[1].style.top)).toBeCloseTo(artCentre, 3)
  })

  it('still reserves room for the label wherever it is placed', () => {
    useFrames()
    // Above or below, the row is centred with the label's box accounted for — so the
    // choices don't ride against the top of the game box when the label moves over them.
    const below = makeRig({ count: 3, labels: 'a, b, c', itemWidthPx: 80, itemHeightPx: 80 })
    document.body.innerHTML = ''
    const above = makeRig({ count: 3, labels: 'a, b, c', itemWidthPx: 80, itemHeightPx: 80, labelPlacement: 'above' })
    // style.top is the label's CENTRE but the art's TOP EDGE, so compare both against
    // the art's centre.
    const centreOf = (r: Rig): number => parseFloat(r.arts[1].style.top) + 80 / 2
    const gapBelow = parseFloat(below.labels[1].style.top) - centreOf(below)
    const gapAbove = centreOf(above) - parseFloat(above.labels[1].style.top)
    expect(gapAbove).toBeCloseTo(gapBelow, 3) // mirrored, same spacing
  })

  it('sets the gap under the choice before its label', () => {
    useFrames()
    const a = makeRig({ count: 3, labels: 'a, b, c', itemWidthPx: 80, itemHeightPx: 80, labelGapPx: 10 })
    const gapA = parseFloat(a.labels[1].style.top) - parseFloat(a.arts[1].style.top)
    document.body.innerHTML = ''
    const b = makeRig({ count: 3, labels: 'a, b, c', itemWidthPx: 80, itemHeightPx: 80, labelGapPx: 40 })
    const gapB = parseFloat(b.labels[1].style.top) - parseFloat(b.arts[1].style.top)
    expect(gapB - gapA).toBeCloseTo(30, 3)
  })

  it('carries a project authored in the old percentages over to design px', () => {
    // The mount is 400 wide at scale 1, so 20% / 5% is 80px wide with a 20px gap —
    // the same row it drew before, with nothing to re-dial by hand.
    useFrames()
    const r = makeRig({ count: 5, itemPct: 20, gapPct: 5 })
    expect(parseFloat(r.arts[2].parentElement!.style.width)).toBeCloseTo(80, 3)
    expect(r.xOf(3) - r.xOf(2)).toBeCloseTo(100, 3)
  })

  it('reads an old aspect ratio as a height, once', () => {
    useFrames()
    const r = makeRig({ count: 5, itemPct: 25, itemAspect: 2 }) // 100 wide ÷ 2 = 50 tall
    expect(parseFloat(r.arts[2].style.height)).toBeCloseTo(50, 3)
  })

  it('wins when the selected choice is tapped', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemWidthPx: 80, startIndex: 2 })
    expect(r.completed()).toBe(false)
    r.tap(2)
    r.settle()
    expect(r.completed()).toBe(true)
  })

  it('wins on a tap even when swiping alone never would', () => {
    // changesToWin 0 means the row itself never ends the game — the tap is the only
    // way through, which is the point of it.
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemWidthPx: 80, startIndex: 2 })
    r.swipe(300, 300 - 100)
    r.settle()
    expect(r.completed()).toBe(false)
    r.tap(3)
    r.settle()
    expect(r.completed()).toBe(true)
  })

  it('brings an unselected choice in rather than winning on it', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemWidthPx: 80, gapPx: 20, startIndex: 2 })
    r.tap(3)
    r.settle()
    expect(r.completed()).toBe(false) // it was not the selected one
    expect(r.scaleOf(3)).toBeGreaterThan(1.4) // it is now
  })

  it('can be switched off, leaving a tap to only re-centre', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, tapCentreWins: false, itemWidthPx: 80, startIndex: 2 })
    r.tap(2)
    r.settle()
    expect(r.completed()).toBe(false)
  })

  it('pulses the tapped choice once, and settles back to its own size', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemWidthPx: 80, centerScale: 1.5, startIndex: 2 })
    const resting = r.scaleOf(2)
    expect(resting).toBeCloseTo(1.5, 3)
    r.tap(2)
    const seen: number[] = []
    for (let i = 0; i < 30; i++) {
      r.frame()
      seen.push(r.scaleOf(2))
    }
    const peak = Math.max(...seen)
    expect(peak).toBeGreaterThan(resting) // it swelled...
    expect(peak).toBeLessThan(resting * 1.2) // ...by a bump, not a jump
    // One bump: it grows then comes back, it does not keep going.
    expect(seen[seen.length - 1]).toBeCloseTo(resting, 3)
    const rises = seen.slice(1).filter((v, i) => v > seen[i]).length
    const falls = seen.slice(1).filter((v, i) => v < seen[i]).length
    expect(rises).toBeGreaterThan(2)
    expect(falls).toBeGreaterThan(2)
    // Smooth on both sides — no corner at the start or the peak.
    expect(Math.max(...seen.slice(1).map((v, i) => Math.abs(v - seen[i])))).toBeLessThan(0.05)
  })

  it('leaves the other choices alone while one pulses', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemWidthPx: 80, startIndex: 2 })
    const other = r.scaleOf(1)
    r.tap(2)
    for (let i = 0; i < 8; i++) r.frame()
    expect(r.scaleOf(1)).toBeCloseTo(other, 5)
  })

  it('holds the win back until the pulse has played', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemWidthPx: 80, startIndex: 2 })
    r.tap(2)
    r.frame()
    expect(r.completed()).toBe(false) // still swelling
    r.settle()
    expect(r.completed()).toBe(true)
  })

  it('ignores further taps once it has been confirmed', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemWidthPx: 80, gapPx: 20, startIndex: 2 })
    r.tap(2)
    r.settle()
    const wonAt = r.scaleOf(2)
    r.tap(3)
    r.settle()
    expect(r.scaleOf(2)).toBeCloseTo(wonAt, 3) // the row did not move on
  })

  it('fires a swipe-start sound once the finger really is swiping', () => {
    useFrames()
    const r = makeRig({ count: 5, itemWidthPx: 80, gapPx: 20, startIndex: 2 })
    r.swipe(300, 300 - 100)
    r.settle()
    expect(r.played.filter((e) => e === 'swipeStart')).toHaveLength(1)
  })

  it('does not call a tap a swipe', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemWidthPx: 80, startIndex: 2 })
    r.tap(2)
    r.settle()
    expect(r.played).not.toContain('swipeStart')
  })

  it('ticks as each choice passes the centre', () => {
    useFrames()
    const r = makeRig({ count: 8, itemWidthPx: 80, gapPx: 20, changesToWin: 0, loop: false, startIndex: 0 })
    r.flick(360, 360 - 100) // carries past more than one choice
    r.settle()
    // One tick per choice crossed, not one per swipe.
    const ticks = r.played.filter((e) => e === 'swipeTick').length
    expect(ticks).toBeGreaterThan(1)
  })

  it('sounds when it lands on a new choice, but not on a release that went nowhere', () => {
    useFrames()
    const r = makeRig({ count: 5, itemWidthPx: 80, gapPx: 20, changesToWin: 0, startIndex: 2 })
    r.swipe(300, 300 - 100)
    r.settle()
    expect(r.played.filter((e) => e === 'swipeSettle')).toHaveLength(1)
    r.swipe(300, 300) // pressed and released without moving on
    r.settle()
    expect(r.played.filter((e) => e === 'swipeSettle')).toHaveLength(1)
  })

  it('sounds its own note when the selected choice is confirmed', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemWidthPx: 80, startIndex: 2 })
    r.tap(2)
    r.settle()
    expect(r.played).toContain('choiceConfirm')
  })

  it('raises the win signal the “on game won” sound hangs off', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 0, itemWidthPx: 80, startIndex: 2 })
    expect(r.won()).toBe(false)
    r.tap(2)
    r.settle()
    expect(r.won()).toBe(true)
    // Before completion, which is what lets the stage line the sound up with the
    // scene's own win phase rather than after it.
    expect(r.winBeforeComplete()).toBe(true)
  })

  it('raises it for a win reached by swiping too', () => {
    useFrames()
    const r = makeRig({ count: 5, changesToWin: 1, tapCentreWins: false, itemWidthPx: 80, gapPx: 20, startIndex: 2 })
    r.swipe(300, 300 - 100)
    r.settle()
    expect(r.won()).toBe(true)
    expect(r.winBeforeComplete()).toBe(true)
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

// The editor renders a template's panel straight from paramFields, so the contract
// additions that make that panel navigable are worth pinning here.
describe('the carousel panel is described well enough to navigate', () => {
  it('files every field under a heading', () => {
    const ungrouped = CAROUSEL_TEMPLATE.paramFields.filter((f) => !f.group)
    expect(ungrouped).toEqual([])
  })

  it('keeps each heading contiguous, so the panel is blocks rather than a stripe', () => {
    // The editor emits a heading whenever the group changes; a group that reappears
    // later would print its title twice.
    const seen: string[] = []
    for (const f of CAROUSEL_TEMPLATE.paramFields) if (f.group !== seen[seen.length - 1]) seen.push(f.group!)
    expect(seen).toEqual([...new Set(seen)])
  })

  it('asks for fonts with a picker, not a typed asset id', () => {
    const fonts = CAROUSEL_TEMPLATE.paramFields.filter((f) => /font/i.test(f.key))
    expect(fonts.length).toBeGreaterThan(0)
    expect(fonts.every((f) => f.type === 'font')).toBe(true)
  })

  it('passes the registry contract with the new field types', () => {
    expect(validateTemplate(CAROUSEL_TEMPLATE)).toEqual([])
  })
})
