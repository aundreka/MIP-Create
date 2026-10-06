// Confetti delay (confetti.delayMs): the trigger fires, but the burst is held back
// so it can land ON a beat — a win jingle, the end of an entrance animation —
// instead of popping the instant the scene appears.
//
// jsdom has no canvas backend, so the test records the 2D calls: one translate()
// per piece painted, so "nothing drawn yet" is simply "no translate calls".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createConfetti, createConfettiContent } from './elements/confetti'
import type { SceneElement, ConfettiConfig } from './scene'

let drawn = 0
let origGetContext: typeof HTMLCanvasElement.prototype.getContext

function fakeCtx(): CanvasRenderingContext2D {
  return {
    filter: 'none',
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {
      drawn++
    },
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    arc: () => {},
    ellipse: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
  } as unknown as CanvasRenderingContext2D
}

function make(confetti: ConfettiConfig, w = 600, h = 900) {
  const canvas = createConfettiContent()
  Object.defineProperty(canvas, 'clientWidth', { value: w })
  Object.defineProperty(canvas, 'clientHeight', { value: h })
  const el = { id: 'c1', type: 'confetti', confetti } as unknown as SceneElement
  return createConfetti(canvas, () => el)
}

// One animation frame's worth of fake time — enough for whenSized()'s rAF and the
// first step().
const frame = (): void => void vi.advanceTimersByTime(20)

beforeEach(() => {
  drawn = 0
  vi.useFakeTimers()
  origGetContext = HTMLCanvasElement.prototype.getContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx()) as any
})

afterEach(() => {
  vi.useRealTimers()
  HTMLCanvasElement.prototype.getContext = origGetContext
})

describe('confetti delayMs', () => {
  it('paints nothing until the delay has elapsed, then bursts', () => {
    const c = make({ mode: 'pop', pieces: 80, delayMs: 800 })
    c.start()
    vi.advanceTimersByTime(700)
    frame()
    expect(drawn).toBe(0) // still holding
    vi.advanceTimersByTime(200) // past 800ms
    frame()
    expect(drawn).toBeGreaterThan(0)
    c.destroy()
  })

  it('fires on the first frame when no delay is set', () => {
    const c = make({ mode: 'pop', pieces: 80 })
    c.start()
    frame()
    expect(drawn).toBeGreaterThan(0)
    c.destroy()
  })

  it('a second start() during the countdown does not queue a second burst', () => {
    const c = make({ mode: 'pop', pieces: 50, delayMs: 500 })
    c.start()
    c.start()
    c.start()
    vi.advanceTimersByTime(600)
    frame()
    expect(drawn).toBeGreaterThan(0) // it did fire
    // One burst = one seed of `pieces`, so a single frame paints at most that many.
    // Three queued timers would paint three clouds' worth.
    drawn = 0
    vi.advanceTimersByTime(16) // one animation frame
    expect(drawn).toBeGreaterThan(0)
    expect(drawn).toBeLessThanOrEqual(50)
    c.destroy()
  })

  it('a scene change mid-countdown cancels the burst', () => {
    const c = make({ mode: 'pop', pieces: 80, delayMs: 900 })
    c.start()
    vi.advanceTimersByTime(400)
    c.destroy() // scene torn down before the confetti was due
    vi.advanceTimersByTime(2000)
    frame()
    expect(drawn).toBe(0)
  })

  it('freezing the editor frame cancels a pending delay', () => {
    const c = make({ mode: 'pop', pieces: 60, delayMs: 900 })
    c.start()
    vi.advanceTimersByTime(300)
    c.renderStatic()
    frame()
    const afterStatic = drawn
    expect(afterStatic).toBeGreaterThan(0) // the frozen frame is painted at once
    vi.advanceTimersByTime(2000)
    frame()
    expect(drawn).toBe(afterStatic) // ...and the held burst never arrives on top of it
    c.destroy()
  })
})
