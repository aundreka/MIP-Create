import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHand, dragGesture } from './hint'

describe('drag gesture curve', () => {
  it('grabs, carries, releases and stays put at both ends', () => {
    const grab = dragGesture(0.0)
    expect(grab.travel).toBe(0)
    expect(grab.press).toBe(0)
    expect(grab.carry).toBe(0)

    // Held down and swollen before it has gone anywhere — the pick-up beat.
    const lifted = dragGesture(0.2)
    expect(lifted.press).toBe(1)
    expect(lifted.carry).toBeGreaterThan(0)
    expect(lifted.travel).toBe(0)

    // Mid-carry: still held, fully swollen, part-way across.
    const mid = dragGesture(0.48)
    expect(mid.press).toBe(1)
    expect(mid.carry).toBe(1)
    expect(mid.travel).toBeGreaterThan(0.2)
    expect(mid.travel).toBeLessThan(0.8)

    // Arrived, still held: the release has not begun yet.
    const arrived = dragGesture(0.74)
    expect(arrived.travel).toBe(1)
    expect(arrived.press).toBe(1)

    // Let go: contact and swell both gone, and it stays at the target.
    const dropped = dragGesture(0.9)
    expect(dropped.travel).toBe(1)
    expect(dropped.press).toBe(0)
    expect(dropped.carry).toBe(0)
  })

  it('advances monotonically across the carry so the hand never stutters', () => {
    let prev = -1
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const t = dragGesture(p).travel
      expect(t).toBeGreaterThanOrEqual(prev)
      prev = t
    }
  })

  it('the swell trails the grab rather than arriving with it', () => {
    // The finger has to land before the object comes up, or the gesture reads as
    // the hand inflating in mid-air.
    expect(dragGesture(0.1).press).toBeGreaterThan(0)
    expect(dragGesture(0.1).carry).toBe(0)
  })

  it('fades out after the drop so the loop never shows the jump back', () => {
    expect(dragGesture(0.0).alpha).toBe(0)
    expect(dragGesture(0.5).alpha).toBe(1)
    expect(dragGesture(0.86).alpha).toBe(1)
    expect(dragGesture(0.95).alpha).toBeLessThan(0.2)
    expect(dragGesture(1).alpha).toBe(0)
  })

  it('clamps outside 0..1 instead of running away', () => {
    expect(dragGesture(-1).travel).toBe(0)
    expect(dragGesture(2).travel).toBe(1)
  })
})

describe('drag hand rendering', () => {
  let root: HTMLElement
  let now = 0

  beforeEach(() => {
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    // Drive rAF by hand so we can sample an exact cycle phase.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queue.push(cb)
      return queue.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    queue.length = 0
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  const queue: FrameRequestCallback[] = []
  const tick = (at: number): void => {
    now = at
    const pending = queue.splice(0, queue.length)
    for (const cb of pending) cb(at)
  }

  /** The scale factor out of the hand's transform. */
  const scaleOf = (el: HTMLElement): number => Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? '0')

  it('carries the hand from the option to the drop area and swells on the way', () => {
    const hand = createHand(root)
    hand.show({ x: 0, y: 0 }, { x: 1000, y: 0 }, 'drag')
    const el = root.querySelector<HTMLElement>('div[style*="z-index: 200000"]')!

    // The 'drag' cycle is 1900ms. Sample the pick-up, the carry and the release.
    tick(0)
    expect(el.style.transform).toContain('translate(0px,0px)')

    tick(1900 * 0.48)
    const carried = scaleOf(el)
    const xMid = Number(/translate\((-?\d+)px/.exec(el.style.transform)![1])
    expect(xMid).toBeGreaterThan(50)
    expect(xMid).toBeLessThan(950)
    // Holding something reads as bigger, not smaller — this is the cue the
    // player needs to learn the option is pickup-able.
    expect(carried).toBeGreaterThan(1)

    tick(1900 * 0.8)
    expect(el.style.transform).toContain('translate(1000px,0px)')
    expect(Number(el.style.opacity)).toBeGreaterThan(0)

    tick(1900 * 0.98)
    expect(Number(el.style.opacity)).toBeLessThan(0.3)
    hand.destroy()
  })

  it('rings the drop area on release and stays quiet during the carry', () => {
    const hand = createHand(root)
    hand.show({ x: 0, y: 0 }, { x: 400, y: 200 }, 'drag')
    const rippleLayer = root.querySelector<HTMLElement>('div[style*="z-index: 199999"]')!
    const rings = Array.from(rippleLayer.children) as HTMLElement[]
    const litRings = (): number => rings.filter((r) => Number(r.style.opacity) > 0).length

    tick(0)
    tick(1900 * 0.45)
    expect(litRings()).toBe(0)

    tick(1900 * 0.8)
    expect(litRings()).toBeGreaterThan(0)
    // Anchored on the drop area, which is invisible and needs the marker.
    expect(rippleLayer.style.transform).toContain('translate(400px,200px)')
    hand.destroy()
  })

  it('leaves the slide gesture untouched — fully opaque and shrinking under press', () => {
    const hand = createHand(root)
    hand.show({ x: 0, y: 0 }, { x: 500, y: 0 }, 'slide')
    const el = root.querySelector<HTMLElement>('div[style*="z-index: 200000"]')!
    tick(0)
    tick(1500 * 0.5)
    expect(el.style.opacity).toBe('1')
    expect(scaleOf(el)).toBeLessThan(1)
    hand.destroy()
  })
})
