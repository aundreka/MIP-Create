// The 'radialtap' handguide: a tap that also pings. It taps exactly like 'tap'
// (same dip, same period), and spreads concentric rings out of the fingertip on
// contact — the affordance for tap targets that have none of their own. The rings
// live on their own layer, so they must appear WITH the hand and go away with it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScene } from './stage'
import { tapPress } from './hint'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'

const PERIOD = 1000

function hand(mode: string, hg: Record<string, unknown> = {}): SceneElement {
  return {
    id: 'hg', type: 'handguide', name: 'Hint hand', x: 540, y: 900, w: 60, h: 74,
    anchor: 'center', zIndex: 9, mode: 'fit', assetId: 'hand',
    handguide: { mode, periodMs: PERIOD, ...hg },
  } as unknown as SceneElement
}

const scene = (el: SceneElement): Scene => ({
  meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: [el],
  kind: 'game',
})

let now = 0

function mount(mode: string, hg: Record<string, unknown> = {}): { hand: HTMLElement; host: HTMLElement } {
  document.body.innerHTML = ''
  now = 0 // every mount starts its cycle at t=0, so remounting inside one test is safe
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene(hand(mode, hg)), { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
  stage.layoutAll()
  stage.startGames(true)
  return { hand: host.querySelector('.pa-el[data-id="hg"] img') as HTMLElement, host }
}

const ripple = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-pa-ripple]')

/** Every ring's opacity at `ms`, in emission order. */
function ringsAt(ms: number): number[] {
  now = ms
  vi.advanceTimersByTime(20)
  return Array.from(ripple()?.children ?? []).map((r) => parseFloat((r as HTMLElement).style.opacity) || 0)
}

const scaleOf = (el: HTMLElement): number => parseFloat(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 'NaN')

/** How far down the hand is pressed right now, read back off its scale. */
function pressAt(el: HTMLElement, ms: number): number {
  now = ms
  vi.advanceTimersByTime(20)
  const m = /scale\(([\d.]+)\)/.exec(el.style.transform)
  return m ? (1 - parseFloat(m[1])) / 0.18 : NaN
}

describe('handguide: radial tap mode', () => {
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

  it('taps with the same dip as a plain tap', () => {
    const { hand: el } = mount('radialtap')
    expect(pressAt(el, 0.275 * PERIOD)).toBeCloseTo(tapPress(0.275), 2) // deepest contact
    expect(pressAt(el, 0.8 * PERIOD)).toBeCloseTo(0, 2) // lifted off between taps
  })

  it('spreads rings out of the fingertip, staggered, after contact', () => {
    mount('radialtap')
    expect(ringsAt(0.02 * PERIOD).every((o) => o === 0)).toBe(true) // nothing before the finger lands
    const early = ringsAt(0.2 * PERIOD)
    expect(early[0]).toBeGreaterThan(0) // first ring born on the dip
    expect(early[1]).toBe(0) // the others still to come
    const later = ringsAt(0.45 * PERIOD)
    expect(later[1]).toBeGreaterThan(0) // second ring following it out
    expect(later[0]).toBeLessThan(early[0]) // and the first fading as it widens
    const first = ripple()?.firstElementChild as HTMLElement
    expect(parseFloat(/scale\(([\d.]+)\)/.exec(first.style.transform)?.[1] ?? '0')).toBeGreaterThan(0.5) // widening
  })

  it('leaves no rings behind when the hand hides on interaction', () => {
    const { hand: el } = mount('radialtap')
    ringsAt(0.4 * PERIOD)
    expect(ripple()?.style.display).toBe('block')
    el.dispatchEvent(new Event('pointerdown', { bubbles: true })) // the player touches the screen
    expect(ripple()?.style.display).toBe('none')
  })

  it('pings in an authored color, wash included', () => {
    mount('radialtap', { rippleColor: '#ff8a3d' })
    ringsAt(0.2 * PERIOD)
    const ring = ripple()?.firstElementChild as HTMLElement
    expect(ring.style.borderColor.replace(/\s/g, '')).toContain('255,138,61')
    expect(ring.style.backgroundImage.replace(/\s/g, '')).toContain('255,138,61') // fill follows the stroke
  })

  it('takes a separate fill color without touching the stroke', () => {
    mount('radialtap', { rippleColor: '#ff8a3d', rippleFillColor: '#2244ff' })
    ringsAt(0.2 * PERIOD)
    const ring = ripple()?.firstElementChild as HTMLElement
    const bg = ring.style.backgroundImage.replace(/\s/g, '')
    expect(ring.style.borderColor.replace(/\s/g, '')).toContain('255,138,61')
    expect(bg).toContain('34,68,255')
    expect(bg).not.toContain('255,138,61')
  })

  it('spreads to an authored radius instead of sizing off the hand', () => {
    // Radius is design px and the stage is at 1:1 here, so doubling it has to double
    // the rings — that is the whole contract of the field.
    mount('radialtap', { rippleRadius: 78 })
    ringsAt(0.2 * PERIOD)
    const small = scaleOf(ripple()?.firstElementChild as HTMLElement)
    mount('radialtap', { rippleRadius: 156 })
    ringsAt(0.2 * PERIOD)
    expect(scaleOf(ripple()?.firstElementChild as HTMLElement)).toBeCloseTo(small * 2, 2) // 2dp: the transform is written rounded to 3
  })

  it('gives a plain tap no rings at all', () => {
    mount('tap')
    expect(ripple()).toBeNull()
  })
})
