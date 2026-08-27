// The 'pinch' handguide: the placed hand plus a mirrored duplicate of it, closing on
// whatever the live board still has waiting.
//
// The duplicate is a CLONE of the placed hand rather than a second element the author
// adds, so most of what is worth pinning here is that the two stay one thing: same
// art, same visibility, one fingertip formula, and gone together on teardown.

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
    handguide: { mode: 'pinch', periodMs: PERIOD, ...extra },
  } as SceneElement
}

/** Build a scene with just the guide, then fake the game's published marker. The
 * target sits at (400,600,200,200) — centre (500,700). */
function setup(
  el: SceneElement = guide(),
  marker = 'revealHint',
): { visual: HTMLElement; mirror: HTMLElement; root: HTMLElement; target: HTMLElement; stage: ReturnType<typeof buildScene> } {
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'pinch', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    elements: [el],
    kind: 'game',
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene, { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
  stage.layoutAll()

  const root = host.querySelector('.pa-root') as HTMLElement
  const target = document.createElement('div')
  target.dataset[marker] = '1'
  target.getBoundingClientRect = () => rect(400, 600, 200, 200)
  root.appendChild(target)

  const guideOuter = host.querySelector('.pa-el[data-id="hg"]') as HTMLElement
  guideOuter.getBoundingClientRect = () => rect(0, 0, 60, 74)
  stage.startGames(true)
  return {
    visual: guideOuter.querySelector('img:not([data-pinch-mirror])') as HTMLElement,
    mirror: guideOuter.querySelector('[data-pinch-mirror]') as HTMLElement,
    root,
    target,
    stage,
  }
}

const xOf = (t: string): number => Number(/translate\((-?\d+)px,(-?\d+)px\)/.exec(t)![1])
const yOf = (t: string): number => Number(/translate\((-?\d+)px,(-?\d+)px\)/.exec(t)![2])

describe('editable handguide: pinch mode', () => {
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

  it('duplicates the hand and mirrors the copy', () => {
    const { visual, mirror, stage } = setup()
    expect(mirror).not.toBeNull()
    // Same art, because it IS the same node cloned — a swapped hand image cannot leave
    // the pair mismatched.
    expect(mirror.getAttribute('src')).toBe(visual.getAttribute('src'))

    paintFrame(PERIOD * 0.5)
    expect(mirror.style.transform).toContain('scaleX(-1)')
    expect(visual.style.transform).not.toContain('scaleX(-1)')
    stage.destroy()
  })

  it('places the two hands on opposite sides of the target', () => {
    const { visual, mirror, stage } = setup()
    paintFrame(PERIOD * 0.5)
    // The unmirrored hand carries its body to the right of its fingertip, so it closes
    // from the right; the mirror takes the left.
    expect(xOf(visual.style.transform)).toBeGreaterThan(xOf(mirror.style.transform))
    // Both aim at the same height — this is a squeeze, not a diagonal.
    expect(yOf(visual.style.transform)).toBe(yOf(mirror.style.transform))
    stage.destroy()
  })

  it('closes on the way in and opens on the way out', () => {
    const { visual, mirror, stage } = setup()
    // Start of the cycle: fully open.
    paintFrame(PERIOD * 0.01)
    const openGap = xOf(visual.style.transform) - xOf(mirror.style.transform)
    // Mid-cycle: fully closed.
    paintFrame(PERIOD * 0.5)
    const shutGap = xOf(visual.style.transform) - xOf(mirror.style.transform)
    expect(shutGap).toBeLessThan(openGap)
    // …and open again by the end, so the loop reads as a squeeze rather than a snap.
    paintFrame(PERIOD * 0.99)
    expect(xOf(visual.style.transform) - xOf(mirror.style.transform)).toBeGreaterThan(shutGap)
    stage.destroy()
  })

  it('straddles the target centre, so the fingertips frame it', () => {
    const { visual, mirror, stage } = setup()
    paintFrame(PERIOD * 0.5)
    // Fingertip x = the hand's own 22% point plus the offset (see the transform-origin
    // note in stage.ts). The target's centre column is 500.
    const tip = (t: string): number => xOf(t) + 60 * 0.22
    expect(tip(mirror.style.transform)).toBeLessThan(500)
    expect(tip(visual.style.transform)).toBeGreaterThan(500)
    stage.destroy()
  })

  it('swaps the sides when the hand art is drawn the other way round', () => {
    const { visual, mirror, stage } = setup(guide({ pinchFlip: true }))
    paintFrame(PERIOD * 0.5)
    expect(xOf(visual.style.transform)).toBeLessThan(xOf(mirror.style.transform))
    stage.destroy()
  })

  it('follows a tap-to-remove or drag-to-clean marker too', () => {
    for (const marker of ['tapHint', 'cleanHint']) {
      const { visual, mirror, stage } = setup(guide(), marker)
      paintFrame(PERIOD * 0.5)
      expect(xOf(visual.style.transform)).toBeGreaterThan(xOf(mirror.style.transform))
      stage.destroy()
      document.body.innerHTML = ''
    }
  })

  it('hides both hands while the board has nothing waiting', () => {
    const { visual, mirror, target, stage } = setup()
    paintFrame(PERIOD * 0.4)
    expect(Number(visual.style.opacity)).toBeGreaterThan(0)
    expect(Number(mirror.style.opacity)).toBeGreaterThan(0)

    delete target.dataset.revealHint
    paintFrame(PERIOD * 0.5)
    expect(visual.style.opacity).toBe('0')
    expect(mirror.style.opacity).toBe('0')
    stage.destroy()
  })

  it('takes the duplicate away with it on teardown', () => {
    const { mirror, stage } = setup()
    paintFrame(PERIOD * 0.5)
    expect(mirror.isConnected).toBe(true)
    stage.destroy()
    // The clone was this animator's to create, so it must not outlive it — otherwise a
    // scene rebuilt in the editor accumulates a hand per rebuild.
    expect(mirror.isConnected).toBe(false)
  })

  it('adds no duplicate in any other mode', () => {
    const { stage } = setup(guide({ mode: 'tapreveal' }))
    expect(document.querySelector('[data-pinch-mirror]')).toBeNull()
    stage.destroy()
  })
})
