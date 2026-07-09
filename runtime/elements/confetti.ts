// Confetti: a self-contained canvas particle system, ported from the react-confetti
// MODEL (falling/bursting rectangles + circles that flutter, drift and spin) into
// framework-agnostic vanilla — so the editor can drop it in without installing the
// npm package. Full-screen overlay; runs ONLY during interactive playback
// (Preview/export). On the static editor canvas the controller paints a single
// frozen frame so the author can see and position it.

import type { SceneElement, ConfettiConfig } from '../scene'

// react-confetti's default Material palette.
const DEFAULT_COLORS = [
  '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3',
  '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39',
  '#ffeb3b', '#ffc107', '#ff9800', '#ff5722',
]

// Deterministic-enough randomness for a decorative effect (Math.random is fine here;
// confetti never needs to be reproducible across runs like the game mechanics do).
const rand = (a: number, b: number): number => a + Math.random() * (b - a)

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  sz: number
  color: string
  circle: boolean
  rot: number
  spin: number
  tilt: number
  tiltInc: number
  wobble: number
  alpha: number
  fade: number // per-frame alpha decay (burst pieces fade out); 0 = never
  dead: boolean
}

export interface ConfettiController {
  start(): void
  stop(): void
  renderStatic(): void
  resize(): void
  destroy(): void
}

export function createConfettiContent(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.className = 'pa-confetti'
  canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;'
  return canvas
}

export function createConfetti(canvas: HTMLCanvasElement, getEl: () => SceneElement): ConfettiController {
  const ctx = canvas.getContext('2d')
  let pieces: Piece[] = []
  let raf = 0
  let running = false
  let emitStart = 0 // performance.now() when emission began (for durationMs)
  let W = 0
  let H = 0
  let dpr = 1
  let mode: 'live' | 'static' | 'idle' = 'idle'
  let waitRaf = 0 // rAF id for the "wait until laid out" retry (bounded)
  let prevT = 0 // timestamp of the last frame, for delta-time normalization

  const cfg = (): ConfettiConfig => getEl().confetti ?? {}

  function resize(): void {
    const cw = canvas.clientWidth || canvas.parentElement?.clientWidth || 0
    const ch = canvas.clientHeight || canvas.parentElement?.clientHeight || 0
    if (!cw || !ch) return
    dpr = Math.min(2, window.devicePixelRatio || 1)
    W = cw
    H = ch
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (mode === 'static') draw() // re-freeze after a viewport change
  }

  function palette(): string[] {
    const c = cfg().colors
    return c && c.length ? c : DEFAULT_COLORS
  }

  // Vertical scale so physics tuned at ~900px look the same at any export size.
  function unit(): number {
    return Math.max(0.4, H / 900)
  }

  function makeRainPiece(colors: string[], stagger: boolean): Piece {
    const c = cfg()
    const s = unit()
    const scalar = c.scalar ?? 1
    const power = c.power ?? 8
    const spread = c.spread ?? 5
    const sz = rand(7, 13) * s * scalar
    return {
      x: rand(0, W),
      y: stagger ? rand(-H, 0) : rand(-sz * 2, -sz),
      vx: rand(-spread, spread) * s + (c.wind ?? 0) * s,
      vy: rand(0.55, 1) * power * s,
      sz,
      color: colors[(Math.random() * colors.length) | 0],
      circle: Math.random() < 0.35,
      rot: rand(0, Math.PI * 2),
      spin: rand(-0.16, 0.16),
      tilt: rand(0, Math.PI * 2),
      tiltInc: rand(0.05, 0.13),
      wobble: rand(0.7, 1.4),
      alpha: 1,
      fade: 0,
      dead: false,
    }
  }

  function makeBurstPiece(colors: string[]): Piece {
    const c = cfg()
    const s = unit()
    const scalar = c.scalar ?? 1
    const power = c.power ?? 9
    const sz = rand(7, 13) * s * scalar
    const angle = rand(0, Math.PI * 2)
    const speed = rand(0.35, 1) * power * 1.7 * s
    return {
      x: (c.originX ?? 50) / 100 * W,
      y: (c.originY ?? 45) / 100 * H,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - power * s, // bias upward for a pop
      sz,
      color: colors[(Math.random() * colors.length) | 0],
      circle: Math.random() < 0.35,
      rot: rand(0, Math.PI * 2),
      spin: rand(-0.3, 0.3),
      tilt: rand(0, Math.PI * 2),
      tiltInc: rand(0.06, 0.16),
      wobble: rand(0.4, 1),
      alpha: 1,
      fade: rand(0.006, 0.014),
      dead: false,
    }
  }

  function seed(stagger: boolean): void {
    const c = cfg()
    const count = Math.max(1, Math.min(1200, Math.round(c.pieces ?? 200)))
    const colors = palette()
    const burst = c.mode === 'burst'
    pieces = Array.from({ length: count }, () => (burst ? makeBurstPiece(colors) : makeRainPiece(colors, stagger)))
  }

  function drawPiece(p: Piece): void {
    if (!ctx) return
    const flip = Math.max(0.15, Math.abs(Math.cos(p.tilt))) // fake 3D flutter (squish)
    ctx.save()
    ctx.globalAlpha = p.alpha
    ctx.translate(p.x, p.y)
    ctx.rotate(p.rot)
    ctx.fillStyle = p.color
    if (p.circle) {
      ctx.beginPath()
      ctx.ellipse(0, 0, p.sz / 2, (p.sz / 2) * flip, 0, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillRect(-p.sz / 2, (-p.sz / 2) * flip, p.sz, p.sz * flip)
    }
    ctx.restore()
  }

  function draw(): void {
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    for (const p of pieces) drawPiece(p)
  }

  function step(now: number): void {
    if (!running || !ctx) return
    const c = cfg()
    const s = unit()
    const burst = c.mode === 'burst'
    const g = (c.gravity ?? (burst ? 0.28 : 0.08)) * s
    const wind = (c.wind ?? 0) * s
    // Rain keeps recycling pieces off the bottom while still emitting; emission ends
    // after durationMs (0 = forever), then remaining pieces fall out and we stop.
    const emitting = burst ? false : c.recycle !== false && (!(c.durationMs && c.durationMs > 0) || now - emitStart < c.durationMs)
    let alive = 0

    // Delta-time factor normalized to 60fps, so speed is independent of the display's
    // refresh rate (otherwise a 120Hz / uncapped Chromium runs ~2x faster than a
    // vsync-capped 60Hz Chrome). Clamped so a backgrounded tab can't teleport pieces.
    const k = Math.min(3, (prevT ? now - prevT : 16.667) / 16.667)
    prevT = now

    for (const p of pieces) {
      if (p.dead) continue
      p.tilt += p.tiltInc * k
      p.rot += p.spin * k
      p.vy += g * k
      p.vx += wind * 0.03 * k
      if (burst) p.vx *= Math.pow(0.985, k)
      p.x += (p.vx + Math.sin(p.tilt) * p.wobble * s) * k
      p.y += p.vy * k
      if (p.fade) p.alpha -= p.fade * k

      const off = p.y - p.sz > H || p.x < -p.sz * 4 || p.x > W + p.sz * 4 || p.alpha <= 0.02
      if (off) {
        if (emitting) {
          // Recycle SPREAD across a screen-height above the top (stagger=true), not a
          // thin line — otherwise the initial clump exits and re-enters coherently,
          // producing bands of confetti separated by empty gaps. Staggering the
          // re-entry height decoheres the group into a steady, continuous stream.
          Object.assign(p, makeRainPiece(palette(), true))
          alive++
        } else {
          p.dead = true
        }
      } else {
        alive++
      }
    }

    draw()
    if (alive === 0 && !emitting) { stop(); return }
    raf = requestAnimationFrame(step)
  }

  // Retry a not-yet-laid-out canvas a bounded number of times (≈1s) so a hidden
  // confetti element can never spin an infinite rAF; layoutAll's resize() will pick
  // it up if it becomes visible later.
  function whenSized(fn: () => void, tries = 0): void {
    resize()
    if (W && H) { fn(); return }
    if (tries >= 60) return
    waitRaf = requestAnimationFrame(() => whenSized(fn, tries + 1))
  }

  function start(): void {
    if (running) return
    if (waitRaf) cancelAnimationFrame(waitRaf)
    whenSized(() => {
      mode = 'live'
      running = true
      emitStart = performance.now()
      prevT = 0 // first frame uses a 1.0 factor rather than a huge dt
      seed(cfg().mode !== 'burst') // rain staggers pieces across the height at t=0
      raf = requestAnimationFrame(step)
    })
  }

  function stop(): void {
    running = false
    if (raf) cancelAnimationFrame(raf)
    if (waitRaf) cancelAnimationFrame(waitRaf)
    raf = 0
    waitRaf = 0
    if (ctx) ctx.clearRect(0, 0, W, H)
    if (mode === 'live') mode = 'idle'
  }

  function renderStatic(): void {
    if (raf) cancelAnimationFrame(raf)
    if (waitRaf) cancelAnimationFrame(waitRaf)
    raf = 0
    running = false
    mode = 'static'
    whenSized(() => {
      // A representative frozen frame: pieces scattered across the whole frame.
      const colors = palette()
      const count = Math.max(1, Math.min(160, Math.round(cfg().pieces ?? 200)))
      pieces = Array.from({ length: count }, () => {
        const p = cfg().mode === 'burst' ? makeBurstPiece(colors) : makeRainPiece(colors, true)
        p.y = rand(0, H)
        p.x = rand(0, W)
        return p
      })
      draw()
    })
  }

  return {
    start,
    stop,
    renderStatic,
    resize,
    destroy() {
      stop()
      pieces = []
      mode = 'idle'
    },
  }
}
