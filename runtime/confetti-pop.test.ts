import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConfetti, createConfettiContent } from './elements/confetti'
import type { SceneElement, ConfettiConfig } from './scene'

// jsdom has no canvas backend, so record the 2D calls instead of painting them.
// Each translate() starts a new piece; everything after it belongs to that piece.
interface Rec {
  x: number
  y: number
  blur: number
  strokes: number
  fills: number
}

let recs: Rec[] = []
let origGetContext: typeof HTMLCanvasElement.prototype.getContext

function fakeCtx(): CanvasRenderingContext2D {
  let cur: Rec | null = null
  const ctx = {
    filter: 'none',
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {
      cur = null
    },
    translate: (x: number, y: number) => {
      cur = { x, y, blur: 0, strokes: 0, fills: 0 }
      recs.push(cur)
    },
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    arc: () => {},
    ellipse: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {
      if (cur) cur.fills++
    },
    stroke: () => {
      if (cur) cur.strokes++
    },
    fillRect: () => {
      if (cur) cur.fills++
    },
    createRadialGradient: () => ({ addColorStop: () => {} }),
  }
  // `filter` is a plain property here, so setting it records the blur for the piece.
  return new Proxy(ctx, {
    set(t, k, v) {
      if (k === 'filter' && typeof v === 'string' && cur) {
        const m = /blur\(([\d.]+)px\)/.exec(v)
        if (m) cur.blur = parseFloat(m[1])
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(t as any)[k] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

function mount(confetti: ConfettiConfig, w = 600, h = 900): HTMLCanvasElement {
  const canvas = createConfettiContent()
  Object.defineProperty(canvas, 'clientWidth', { value: w })
  Object.defineProperty(canvas, 'clientHeight', { value: h })
  const el = { id: 'c1', type: 'confetti', confetti } as unknown as SceneElement
  createConfetti(canvas, () => el).renderStatic()
  return canvas
}

beforeEach(() => {
  recs = []
  origGetContext = HTMLCanvasElement.prototype.getContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx()) as any
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext
})

describe('confetti pop', () => {
  it('keeps every piece inside the radius around the origin', () => {
    // 600x900 -> short side 600, radius 40% = 240px, centred at 50%/50%.
    mount({ mode: 'pop', pieces: 160, radius: 40, originX: 50, originY: 50 })
    expect(recs.length).toBe(160)
    for (const r of recs) {
      const d = Math.hypot(r.x - 300, r.y - 450)
      expect(d).toBeLessThanOrEqual(240.001)
    }
    // ...and actually reaches out to it, rather than clumping at the origin.
    const far = Math.max(...recs.map((r) => Math.hypot(r.x - 300, r.y - 450)))
    expect(far).toBeGreaterThan(240 * 0.8)
  })

  it('honors a non-centred origin', () => {
    mount({ mode: 'pop', pieces: 120, radius: 20, originX: 25, originY: 80 })
    for (const r of recs) {
      expect(Math.hypot(r.x - 150, r.y - 720)).toBeLessThanOrEqual(120.001)
    }
  })

  it('mixes curved ribbons (stroked) with punched shards (filled)', () => {
    mount({ mode: 'pop', pieces: 160 })
    const ribbons = recs.filter((r) => r.strokes > 0).length
    const shards = recs.filter((r) => r.fills > 0).length
    expect(ribbons).toBeGreaterThan(10)
    expect(shards).toBeGreaterThan(10)
    expect(ribbons + shards).toBe(recs.length)
  })

  it('draws the blurred foreground pieces last so they sit on top', () => {
    mount({ mode: 'pop', pieces: 160 })
    const blurred = recs.filter((r) => r.blur > 0)
    expect(blurred.length).toBeGreaterThan(0)
    const firstBlurred = recs.findIndex((r) => r.blur > 0)
    expect(recs.slice(firstBlurred).every((r) => r.blur > 0)).toBe(true)
  })

  it('drops the depth blur when blurDepth is off', () => {
    mount({ mode: 'pop', pieces: 160, blurDepth: false })
    expect(recs.every((r) => r.blur === 0)).toBe(true)
  })

  it('leaves rain scattered across the whole frame', () => {
    mount({ mode: 'rain', pieces: 160 })
    // Rain is not radius-bound: it should reach well past a pop's 45% disc.
    const far = Math.max(...recs.map((r) => Math.hypot(r.x - 300, r.y - 450)))
    expect(far).toBeGreaterThan(0.45 * 600)
  })
})
