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

// 'pop' ships its own six-colour party-popper palette (red / gold / green / blue /
// violet / pink). The 16-colour Material set above is too broad for this look —
// the reference art repeats a handful of saturated hues, which is what reads as
// "printed paper confetti" rather than "random colours".
const POP_COLORS = ['#ea3b4b', '#f5a623', '#6fc63f', '#2f6ede', '#7b3ff2', '#f26ab5']

// Per-frame velocity multiplier for a pop, at 60fps. The pieces are launched fast
// and bled off by air drag, so the cloud expands hard and then hangs — the shape of
// a real popper. Total travel is v0 * DRAG / (1 - DRAG), which is what lets
// makePopPiece solve backwards from a target radius.
const POP_DRAG = 0.93

// Deterministic-enough randomness for a decorative effect (Math.random is fine here;
// confetti never needs to be reproducible across runs like the game mechanics do).
const rand = (a: number, b: number): number => a + Math.random() * (b - a)

// 'rect'/'circle' are the react-confetti shapes (rain + burst). 'shard' (a punched,
// slightly irregular quad) and 'ribbon' (a curved strip of paper) are the pop look.
type PieceKind = 'rect' | 'circle' | 'shard' | 'ribbon'

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  sz: number
  color: string
  kind: PieceKind
  rot: number
  spin: number
  tilt: number
  tiltInc: number
  wobble: number
  alpha: number
  fade: number // per-frame alpha decay (burst pieces fade out); 0 = never
  dead: boolean
  blur: number // gaussian blur px — out-of-focus foreground pieces (pop); 0 = crisp
  arc: number // ribbon sweep in radians
  ratio: number // shard height / width
  drag: number // per-frame velocity multiplier; 1 = none
  fadeAt: number // ms after the pop before this piece starts fading; 0 = use `fade`
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

// #rgb / #rrggbb -> rgba(). Used only by the no-filter blur fallback; anything else
// (named colours, rgb(), gradients) falls through to a flat low-alpha blob.
function withAlpha(hex: string, a: number): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (ch) => ch + ch) : m[1]
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
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
  let filterOK: boolean | null = null // ctx.filter support, probed once

  const cfg = (): ConfettiConfig => getEl().confetti ?? {}
  const style = (): 'rain' | 'burst' | 'pop' => cfg().mode ?? 'rain'
  // Pop fills a disc rather than the whole screen, so it needs more pieces than rain
  // to read as dense at the same coverage.
  const pieceCount = (): number => cfg().pieces ?? (style() === 'pop' ? 320 : 200)

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
    if (c && c.length) return c
    return style() === 'pop' ? POP_COLORS : DEFAULT_COLORS
  }

  // Vertical scale so physics tuned at ~900px look the same at any export size.
  // Pop measures against its own DISC instead, which makes it self-similar: the same
  // picture at any screen size or radius, just smaller. Scaling it by screen height
  // would keep full-size pieces inside a small disc and pack it into a clot.
  function unit(): number {
    return style() === 'pop' ? Math.max(0.2, popRadius() / 430) : Math.max(0.4, H / 900)
  }

  // How far a pop reaches. Measured against the SHORT side so the cloud stays a
  // disc inside the screen in both orientations instead of running off the top in
  // landscape.
  function popRadius(): number {
    return Math.max(20, ((cfg().radius ?? 45) / 100) * Math.min(W, H))
  }

  // Canvas filters are how the out-of-focus foreground pieces get their softness.
  // Supported everywhere the ads run (Chrome/Firefox/Safari 17+), but probe rather
  // than assume — an old WebView gets the gradient-blob fallback instead.
  function canFilter(): boolean {
    if (filterOK === null) {
      if (!ctx) return false
      try {
        ctx.filter = 'blur(1px)'
        filterOK = ctx.filter !== 'none' && ctx.filter !== ''
        ctx.filter = 'none'
      } catch {
        filterOK = false
      }
    }
    return !!filterOK
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
      kind: Math.random() < 0.35 ? 'circle' : 'rect',
      rot: rand(0, Math.PI * 2),
      spin: rand(-0.16, 0.16),
      tilt: rand(0, Math.PI * 2),
      tiltInc: rand(0.05, 0.13),
      wobble: rand(0.7, 1.4),
      alpha: 1,
      fade: 0,
      dead: false,
      blur: 0,
      arc: 0,
      ratio: 1,
      drag: 1,
      fadeAt: 0,
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
      kind: Math.random() < 0.35 ? 'circle' : 'rect',
      rot: rand(0, Math.PI * 2),
      spin: rand(-0.3, 0.3),
      tilt: rand(0, Math.PI * 2),
      tiltInc: rand(0.06, 0.16),
      wobble: rand(0.4, 1),
      alpha: 1,
      fade: rand(0.006, 0.014),
      dead: false,
      blur: 0,
      arc: 0,
      ratio: 1,
      drag: 1,
      fadeAt: 0,
    }
  }

  // One piece of a party-popper burst: launched radially from the origin at exactly
  // the speed that air drag bleeds off by the time it reaches its share of the
  // radius, so the cloud settles into a disc instead of flying off-screen.
  // `settled` places it at that resting spot immediately (the frozen editor frame).
  function makePopPiece(colors: string[], settled: boolean): Piece {
    const c = cfg()
    const s = unit()
    const scalar = c.scalar ?? 1
    const R = popRadius()
    const angle = rand(0, Math.PI * 2)
    // sqrt() spreads the pieces evenly over the AREA of the disc. Drawing the
    // distance uniformly instead would pile most of them near the centre.
    const dist = R * Math.sqrt(rand(0.02, 1))
    // A handful of pieces pass close to the lens: much bigger and out of focus.
    // This is the depth cue that makes a flat 2D scatter read as a real photo.
    const near = c.blurDepth !== false && Math.random() < 0.06
    const ribbon = Math.random() < 0.3
    // Heavy-tailed sizes — mostly specks, a few full-size shards, like punched paper
    // seen at mixed distances.
    const base = near ? rand(20, 36) : 4.5 + Math.pow(Math.random(), 1.9) * 14
    const sz = base * (ribbon ? 1.5 : 1) * s * scalar
    const speed = (dist * (1 - POP_DRAG)) / POP_DRAG
    const hold = c.holdMs ?? 1400
    return {
      x: (c.originX ?? 50) / 100 * W + (settled ? Math.cos(angle) * dist : 0),
      y: (c.originY ?? 45) / 100 * H + (settled ? Math.sin(angle) * dist : 0),
      vx: settled ? 0 : Math.cos(angle) * speed,
      vy: settled ? 0 : Math.sin(angle) * speed,
      sz,
      color: colors[(Math.random() * colors.length) | 0],
      kind: ribbon ? 'ribbon' : 'shard',
      rot: rand(0, Math.PI * 2),
      spin: rand(-0.25, 0.25),
      tilt: rand(0, Math.PI * 2),
      tiltInc: rand(0.04, 0.12),
      wobble: rand(0.25, 0.8), // gentle: a wide wobble would blur the disc's edge
      alpha: 1,
      fade: 0,
      dead: false,
      blur: near ? rand(2.5, 5.5) * s * scalar : 0,
      arc: rand(0.9, 2),
      ratio: rand(0.55, 1),
      drag: POP_DRAG,
      fadeAt: hold * rand(0.75, 1.25),
    }
  }

  function seed(stagger: boolean, settled = false, cap = 1200): void {
    const count = Math.max(1, Math.min(cap, Math.round(pieceCount())))
    const colors = palette()
    const st = style()
    if (st === 'pop') {
      pieces = Array.from({ length: count }, () => makePopPiece(colors, settled))
      // Blurred pieces are the ones in FRONT of the lens, so they have to paint over
      // the sharp ones. Draw order is array order, so park them at the end.
      pieces.sort((a, b) => a.blur - b.blur)
      return
    }
    pieces = Array.from({ length: count }, () => (st === 'burst' ? makeBurstPiece(colors) : makeRainPiece(colors, stagger)))
  }

  // Soft colour smear standing in for a real blur where ctx.filter is unavailable.
  function drawBlob(p: Piece): void {
    if (!ctx) return
    const r = p.sz / 2 + p.blur
    const mid = withAlpha(p.color, 0.55)
    const edge = withAlpha(p.color, 0)
    if (mid && edge) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
      g.addColorStop(0, mid)
      g.addColorStop(1, edge)
      ctx.fillStyle = g
    } else {
      ctx.globalAlpha *= 0.35
      ctx.fillStyle = p.color
    }
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
  }

  function drawPiece(p: Piece): void {
    if (!ctx) return
    // Fake 3D flutter (squish). Floored well above 0 so a random tilt leaves flat
    // paper shapes rather than a cloud of edge-on slivers.
    const flip = 0.34 + 0.66 * Math.abs(Math.cos(p.tilt))
    ctx.save()
    ctx.globalAlpha = p.alpha
    ctx.translate(p.x, p.y)
    ctx.rotate(p.rot)
    if (p.blur > 0 && !canFilter()) {
      drawBlob(p)
      ctx.restore()
      return
    }
    if (p.blur > 0) ctx.filter = `blur(${p.blur.toFixed(1)}px)`
    ctx.fillStyle = p.color
    if (p.kind === 'ribbon') {
      // A curved band: a thick stroked arc, squished by the flutter so it reads as a
      // strip of paper bending as it turns in the air.
      ctx.scale(1, flip)
      ctx.strokeStyle = p.color
      ctx.lineWidth = Math.max(1, p.sz * 0.3)
      ctx.beginPath()
      ctx.arc(0, 0, p.sz * 0.78, -p.arc / 2, p.arc / 2)
      ctx.stroke()
    } else if (p.kind === 'shard') {
      // A slightly irregular quad — punched confetti is never a clean rectangle.
      const a = p.sz / 2
      const b = (p.sz * p.ratio) / 2 * flip
      ctx.beginPath()
      ctx.moveTo(-a, -b * 0.8)
      ctx.lineTo(a, -b)
      ctx.lineTo(a * 0.88, b)
      ctx.lineTo(-a, b * 0.86)
      ctx.closePath()
      ctx.fill()
    } else if (p.kind === 'circle') {
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
    const st = style()
    const burst = st === 'burst'
    const pop = st === 'pop'
    const g = (c.gravity ?? (pop ? 0.05 : burst ? 0.28 : 0.08)) * s
    const wind = (c.wind ?? 0) * s
    const fadeMs = c.fadeMs ?? 900
    const age = now - emitStart
    // Rain keeps recycling pieces off the bottom while still emitting; emission ends
    // after durationMs (0 = forever), then remaining pieces fall out and we stop.
    // Burst and pop are one-shots — they never re-emit.
    const emitting = burst || pop ? false : c.recycle !== false && (!(c.durationMs && c.durationMs > 0) || age < c.durationMs)
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
      if (p.drag !== 1) {
        const d = Math.pow(p.drag, k)
        p.vx *= d
        p.vy *= d
      }
      p.vy += g * k
      p.vx += wind * 0.03 * k
      if (burst) p.vx *= Math.pow(0.985, k)
      p.x += (p.vx + Math.sin(p.tilt) * p.wobble * s) * k
      p.y += p.vy * k
      if (p.fadeAt) {
        // Pop: hold the full cloud, then dissolve it. fadeMs 0 keeps it up until the
        // pieces drift off-screen on their own.
        const ft = age - p.fadeAt
        if (ft > 0) p.alpha = fadeMs > 0 ? Math.max(0, 1 - ft / fadeMs) : p.alpha
      } else if (p.fade) {
        p.alpha -= p.fade * k
      }

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
      seed(style() === 'rain') // rain staggers pieces across the height at t=0
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
      const st = style()
      const colors = palette()
      const count = Math.max(1, Math.min(st === 'pop' ? 400 : 160, Math.round(pieceCount())))
      if (st === 'pop') {
        // Pop freezes at full extent — the moment the cloud has stopped expanding,
        // which is the frame the author is placing. The cap goes INTO seed(): the
        // blurred pieces are sorted last, so trimming the array afterwards would
        // drop exactly them.
        seed(false, true, count)
        draw()
        return
      }
      // A representative frozen frame: pieces scattered across the whole frame.
      pieces = Array.from({ length: count }, () => {
        const p = st === 'burst' ? makeBurstPiece(colors) : makeRainPiece(colors, true)
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
