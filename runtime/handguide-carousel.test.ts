// The editable Carousel handguide performs the whole gesture the game asks for, in the
// order the game requires: a swipe that pulls the next choice into the centre, then a
// tap on that centre to confirm it. It follows the row's published markers rather than
// touching any real choice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

const PERIOD = 1000
let now = 0

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect
}

function paintFrame(ms: number): void {
  now = ms
  vi.advanceTimersByTime(20)
}

const GUIDE: SceneElement = {
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
  handguide: { mode: 'carousel', periodMs: PERIOD },
}

// The centre choice sits at (500,700); the one a left-swipe brings in is a slot to its
// right, at (700,700). So the swipe travels 200px left, and the tap lands on (500,700).
const CENTRE = { x: 500, y: 700 }
const NEXT = { x: 700, y: 700 }
/** The hand's own offset: its grip is 22% across and 12% down its box. */
const GRIP_X = 60 * 0.22
const GRIP_Y = 74 * 0.12

function setup(opts: { withNext?: boolean } = {}): { visual: HTMLElement; stage: ReturnType<typeof buildScene>; root: HTMLElement } {
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'carousel hand', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    elements: [GUIDE],
    kind: 'game',
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene, { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
  stage.layoutAll()
  const root = host.querySelector('.pa-root') as HTMLElement

  const centre = document.createElement('div')
  centre.dataset.carouselCentre = '1'
  centre.getBoundingClientRect = () => rect(CENTRE.x - 50, CENTRE.y - 50, 100, 100)
  root.appendChild(centre)

  if (opts.withNext !== false) {
    const next = document.createElement('div')
    next.dataset.carouselNext = '1'
    next.getBoundingClientRect = () => rect(NEXT.x - 50, NEXT.y - 50, 100, 100)
    root.appendChild(next)
  }

  const guideOuter = host.querySelector('.pa-el[data-id="hg"]') as HTMLElement
  guideOuter.getBoundingClientRect = () => rect(0, 0, 60, 74)
  stage.startGames(true)
  return { visual: guideOuter.querySelector('img') as HTMLElement, stage, root }
}

/** The finger's x, read back out of the transform the runtime wrote. */
function fingerX(visual: HTMLElement): number {
  const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\)/.exec(visual.style.transform)
  return Number(m?.[1] ?? NaN) + GRIP_X
}
function fingerY(visual: HTMLElement): number {
  const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\)/.exec(visual.style.transform)
  return Number(m?.[2] ?? NaN) + GRIP_Y
}
/** How far the hand is pressed, from the scale the runtime wrote. */
function pressed(visual: HTMLElement): boolean {
  const m = /scale\(([\d.]+)\)/.exec(visual.style.transform)
  return m ? Number(m[1]) < 0.999 : false
}

describe('editable handguide: carousel mode', () => {
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

  it('swipes from the incoming choice to the centre', () => {
    const { visual, stage } = setup()
    paintFrame(PERIOD * 0.04) // just started: still over the incoming choice
    expect(Math.abs(fingerX(visual) - NEXT.x)).toBeLessThan(2) // eased off, not jumped
    paintFrame(PERIOD * 0.21) // half way across the swipe
    const mid = fingerX(visual)
    expect(mid).toBeLessThan(NEXT.x)
    expect(mid).toBeGreaterThan(CENTRE.x)
    paintFrame(PERIOD * 0.41) // arrived at the centre
    expect(fingerX(visual)).toBeCloseTo(CENTRE.x, 0)
    stage.destroy()
  })

  it('stays pressed for the whole swipe — it is a drag, not a series of taps', () => {
    const { visual, stage } = setup()
    for (const p of [0.12, 0.2, 0.3, 0.36]) {
      paintFrame(PERIOD * p)
      expect(pressed(visual)).toBe(true)
    }
    stage.destroy()
  })

  it('lifts between the swipe and the tap', () => {
    const { visual, stage } = setup()
    paintFrame(PERIOD * 0.5)
    expect(pressed(visual)).toBe(false)
    stage.destroy()
  })

  it('then taps, on the centre it just brought in', () => {
    const { visual, stage } = setup()
    paintFrame(PERIOD * 0.75) // mid-tap
    expect(pressed(visual)).toBe(true)
    expect(fingerX(visual)).toBeCloseTo(CENTRE.x, 0)
    expect(fingerY(visual)).toBeCloseTo(CENTRE.y, 0)
    stage.destroy()
  })

  it('never jumps: the swipe ends where the tap begins', () => {
    const { visual, stage } = setup()
    paintFrame(PERIOD * 0.41)
    const endOfSwipe = fingerX(visual)
    paintFrame(PERIOD * 0.6)
    expect(fingerX(visual)).toBeCloseTo(endOfSwipe, 0)
    stage.destroy()
  })

  it('fades out before looping back, so the jump home is unseen', () => {
    const { visual, stage } = setup()
    paintFrame(PERIOD * 0.75)
    expect(Number(visual.parentElement!.style.opacity || 1)).toBeCloseTo(1, 2)
    paintFrame(PERIOD * 0.99)
    expect(Number(visual.parentElement!.style.opacity)).toBeLessThan(0.3)
    stage.destroy()
  })

  it('waits, hidden, until the row has published a centre', () => {
    // No markers at all — a hand miming a swipe over nothing reads as a bug.
    const scene: Scene = {
      meta: { schemaVersion: 1, name: 'no row', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      elements: [GUIDE],
      kind: 'game',
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const stage = buildScene(scene, { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
    stage.layoutAll()
    const guideOuter = host.querySelector('.pa-el[data-id="hg"]') as HTMLElement
    guideOuter.getBoundingClientRect = () => rect(0, 0, 60, 74)
    stage.startGames(true)
    paintFrame(PERIOD * 0.2)
    const visual = guideOuter.querySelector('img') as HTMLElement
    expect(Number(visual.parentElement!.style.opacity)).toBe(0)
    stage.destroy()
  })

  it('still swipes when there is only one choice to point at', () => {
    // No "next" marker: the swipe starts a slot's width to the right instead of
    // collapsing to a tap in place.
    const { visual, stage } = setup({ withNext: false })
    paintFrame(PERIOD * 0.04)
    expect(fingerX(visual)).toBeGreaterThan(CENTRE.x)
    paintFrame(PERIOD * 0.41)
    expect(fingerX(visual)).toBeCloseTo(CENTRE.x, 0)
    stage.destroy()
  })
})
