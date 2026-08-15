// The 'hold' handguide: the press-and-hold gesture. A 'tap' hand dips in and comes
// straight back up; a 'hold' hand goes down and STAYS down for most of the cycle,
// which is the only way the hint reads as "keep holding" rather than "tap here".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScene } from './stage'
import { holdPress } from './hint'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'

const PERIOD = 1000

function hand(mode: string): SceneElement {
  return {
    id: 'hg', type: 'handguide', name: 'Hint hand', x: 540, y: 900, w: 60, h: 74,
    anchor: 'center', zIndex: 9, mode: 'fit', assetId: 'hand',
    handguide: { mode, periodMs: PERIOD },
  } as unknown as SceneElement
}

const scene = (el: SceneElement): Scene => ({
  meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: [el],
  kind: 'game',
})

let now = 0

function mount(mode: string): HTMLElement {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene(hand(mode)), { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
  stage.layoutAll()
  stage.startGames(true)
  return host.querySelector('.pa-el[data-id="hg"] img') as HTMLElement
}

/** How far down the hand is pressed right now, read back off its scale. */
function pressAt(el: HTMLElement, ms: number): number {
  now = ms
  vi.advanceTimersByTime(20)
  const m = /scale\(([\d.]+)\)/.exec(el.style.transform)
  return m ? (1 - parseFloat(m[1])) / 0.18 : NaN
}

describe('handguide: hold mode', () => {
  beforeEach(() => {
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    vi.useFakeTimers()
    now = 0
    // A hand-driven clock: the frame loop reads performance.now(), so the test owns
    // it outright rather than hoping the fake timer and the animation agree.
    vi.stubGlobal('performance', { now: () => now })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(now), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('presses down and stays down for most of the cycle', () => {
    const el = mount('hold')
    expect(pressAt(el, 0.05 * PERIOD)).toBeGreaterThan(0) // on its way down
    expect(pressAt(el, 0.3 * PERIOD)).toBeCloseTo(1, 2) // held
    expect(pressAt(el, 0.7 * PERIOD)).toBeCloseTo(1, 2) // still held
    expect(pressAt(el, 0.95 * PERIOD)).toBeCloseTo(0, 2) // lifted, waiting to go again
    expect(pressAt(el, 1.3 * PERIOD)).toBeCloseTo(1, 2) // and it loops
  })

  it('is not just a tap — a tap is back up by mid-cycle', () => {
    const el = mount('tap')
    expect(pressAt(el, 0.3 * PERIOD)).toBeGreaterThan(0.5)
    expect(pressAt(el, 0.7 * PERIOD)).toBeCloseTo(0, 2) // where 'hold' is still down
  })

  it('shares one press curve with the coded hint hand', () => {
    expect(holdPress(0)).toBe(0)
    expect(holdPress(0.1)).toBe(1)
    expect(holdPress(0.5)).toBe(1)
    expect(holdPress(0.74)).toBe(1)
    expect(holdPress(0.9)).toBe(0)
    expect(holdPress(1)).toBe(0)
  })
})
