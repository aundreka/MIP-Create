// The 'slidetap' handguide: travel a leg of the path, TAP where it lands, travel the
// next leg. The two beats are timed separately (periodMs = one leg, tapMs = one tap),
// so this pins down the timeline the two knobs produce: the hand must actually be
// standing still while it taps, and moving while it travels.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'

const TRAVEL = 1000
const TAP = 400

function hand(mode: string, extra: Record<string, unknown> = {}): SceneElement {
  return {
    id: 'hg',
    type: 'handguide',
    name: 'Hint hand',
    x: 100,
    y: 900,
    w: 60,
    h: 74,
    anchor: 'center',
    zIndex: 9,
    mode: 'fit',
    assetId: 'hand',
    handguide: { mode, nodes: [{ x: 500, y: 900 }], periodMs: TRAVEL, tapMs: TAP, ...extra },
  } as unknown as SceneElement
}

const scene = (el: SceneElement): Scene => ({
  meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: [el],
  kind: 'game',
})

const ASSETS = { hand: { src: 'hand.png', w: 46, h: 56 } }

// Frames are pumped by hand: every rAF registration lands here, and each mount pops
// the one ITS stage just made. (Two stages are alive at once in the timing test, so a
// single shared `frame` variable would let one sampler drive the other's hand.)
let pending: FrameRequestCallback[] = []

/** Mount the scene and return a sampler that runs one animation frame at `t` ms into
 * the loop, handing back the transform the hand was painted with. */
function mount(mode: string, extra?: Record<string, unknown>): (t: number) => { x: number; scale: number } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  pending = []
  const stage = buildScene(scene(hand(mode, extra)), ASSETS, { mount: host })
  stage.layoutAll()
  stage.startGames(true)
  const content = host.querySelector('.pa-el[data-id="hg"] img') as HTMLElement
  let frame = pending.pop()
  return (t: number) => {
    pending = []
    frame?.(t)
    frame = pending.pop() ?? frame
    const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(content.style.transform)
    if (!m) throw new Error('no transform: ' + content.style.transform)
    return { x: parseFloat(m[1]), scale: parseFloat(m[3]) }
  }
}

describe('handguide: slidetap mode', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    pending = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      pending.push(cb)
      return 1
    })
    vi.spyOn(performance, 'now').mockReturnValue(0)
  })
  afterEach(() => vi.restoreAllMocks())

  it('travels a leg, taps where it lands, then carries on around the loop', () => {
    const at = mount('slidetap')
    // Mid-leg: moving, and NOT tapping while it moves.
    const mid = at(TRAVEL / 2)
    expect(mid.x).toBeGreaterThan(0)
    expect(mid.scale).toBe(1)
    // Landed on the waypoint (twice the halfway offset) and tapping there.
    const landed = at(TRAVEL + TAP * 0.28)
    expect(landed.x).toBeCloseTo(mid.x * 2, 0)
    expect(landed.scale).toBeLessThan(1)
    // Still parked on it as the tap finishes — the stop is a stop, not a bounce
    // taken at speed.
    const lifted = at(TRAVEL + TAP * 0.9)
    expect(lifted.x).toBe(landed.x)
    expect(lifted.scale).toBe(1)
    // Heading home, then tapping at the start too.
    expect(at(TRAVEL + TAP + TRAVEL / 2).x).toBeCloseTo(mid.x, 0)
    const home = at(2 * TRAVEL + TAP + TAP * 0.28)
    expect(home.x).toBe(0)
    expect(home.scale).toBeLessThan(1)
  })

  it('times travel and tap independently, and loops on their sum', () => {
    const at = mount('slidetap')
    // One cycle = 2 legs + 2 taps; a whole cycle later the frame repeats exactly.
    const cycle = 2 * (TRAVEL + TAP)
    const a = at(TRAVEL + TAP * 0.28)
    const b = at(cycle + TRAVEL + TAP * 0.28)
    expect(b.x).toBe(a.x)
    expect(b.scale).toBeCloseTo(a.scale, 6)
    // A longer tap holds the stop longer, with the leg's own timing untouched: at a
    // moment the default timing has already set off home, a 3x tap is still parked
    // on the waypoint — and it got there at the same time.
    const slow = mount('slidetap', { tapMs: TAP * 3 })
    expect(slow(TRAVEL / 2).x).toBeCloseTo(at(TRAVEL / 2).x, 6)
    expect(slow(TRAVEL + TAP * 2).x).toBe(a.x)
    expect(at(TRAVEL + TAP * 2).x).toBeLessThan(a.x)
  })

  it('leaves plain slide alone (no press at its waypoints)', () => {
    const at = mount('slide')
    expect(at(TRAVEL / 2).scale).toBe(1)
    expect(at(TRAVEL + 1).scale).toBe(1)
  })

  it('falls back to an in-place tap when no path has been drawn yet', () => {
    const at = mount('slidetap', { nodes: [] })
    const s = at(200)
    expect(s.x).toBe(0)
    expect(s.scale).toBeLessThan(1)
  })
})
