// Hold gauge: an arc dial with a knob that climbs toward the winning end for as
// long as the screen is held, and slides back down the moment it is let go. Reach
// the win end and the round is over (the scene's gameWin phase takes over).
//
// The mechanic is one number — `v`, 0 at the resting end of the bar and 1 at the
// winning end — driven by two speeds: `fillSecs` to cross the whole bar holding,
// `dropSecs` to fall the whole way back. Everything else on screen reads off `v`:
// where the knob sits, which STAGE the dial is in, and therefore which image and
// which status label are showing. A three-stage setup (high / neutral / low) with
// three faces is the cortisol-dial brief; two stages, or six, work the same way.
//
// Each stage carries TWO pieces of art: the stage image (the face) and the status
// label (the HIGH / NEUTRAL / LOW pill). The label falls back to drawn text on a
// coloured pill for any stage with no uploaded art, so a half-filled set of slots
// still reads on screen.
//
// SCALING — the whole widget is authored in DESIGN px and drawn through a single
// `scale()` transform, exactly like the countdown ring (countdown.ts) and the
// pinned header (header.ts): the arc, its border, the knob, the art and the label
// are one rigid unit that grows and shrinks with the layout instead of being
// re-derived from the mount box's pixel size.

import { cssFontFamily } from '../font'
import { arcPath } from './countdown'
import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { num, str } from './types'

const SVG_NS = 'http://www.w3.org/2000/svg'
const DEG = Math.PI / 180

/** Split a "HIGH|NEUTRAL|LOW" (or comma-separated) list into trimmed entries. */
export function splitList(text: string): string[] {
  if (!text.trim()) return []
  return (text.includes('|') ? text.split('|') : text.split(',')).map((s) => s.trim())
}

/** Positions (0..1) for `n` colour stops along the bar.
 *
 * A blank/short/unparseable list falls back to an even spread — and "even" means
 * something different per mode: a SMOOTH ramp puts its stops on the ends (0 … 1)
 * so the first and last colours are reached, while HARD bands treat each position
 * as the START of a band (0, 1/n, …) so n colours give n equal slices. */
export function parsePositions(text: string, n: number, hard: boolean): number[] {
  const even = Array.from({ length: n }, (_, i) => (hard ? i / n : n > 1 ? i / (n - 1) : 0))
  const raw = text
    .split(/[,\s|]+/)
    .filter(Boolean)
    .map(Number)
  if (raw.length < n || raw.some((v) => !isFinite(v))) return even
  const p = raw.slice(0, n).map((v) => Math.max(0, Math.min(100, v)) / 100)
  // A stop that runs backwards would flip the gradient inside out; clamp to
  // monotonic so a typo degrades to a hard edge instead of a scrambled bar.
  for (let i = 1; i < n; i++) if (p[i] < p[i - 1]) p[i] = p[i - 1]
  return p
}

/** Gradient stops for the bar. Smooth = one stop per colour; hard = each colour
 * held flat to the next colour's position, which reads as discrete zones. */
export function barStops(colors: string[], pos: number[], hard: boolean): { o: number; c: string }[] {
  if (!colors.length) return []
  if (colors.length === 1) return [{ o: 0, c: colors[0] }, { o: 1, c: colors[0] }]
  if (!hard) return colors.map((c, i) => ({ o: pos[i] ?? 1, c }))
  const out: { o: number; c: string }[] = []
  for (let i = 0; i < colors.length; i++) {
    const a = pos[i] ?? 1
    const b = i + 1 < colors.length ? (pos[i + 1] ?? 1) : 1
    out.push({ o: a, c: colors[i] }, { o: b, c: colors[i] })
  }
  return out
}

/** Stage-arrival animations, by the name the author picks. Every one of these is a
 * keyframe the runtime already injects for the scene's own element animations
 * (anim.ts), so the gauge borrows the house vocabulary instead of inventing one. */
export const STAGE_ANIMS: Record<string, string> = {
  None: '',
  Pop: 'pa-pop',
  Fade: 'pa-fade',
  Bounce: 'pa-bounce',
  Pulse: 'pa-pulse',
  Shake: 'pa-shake',
  Wave: 'pa-wave',
  Shine: 'pa-shine',
  Glow: 'pa-glow',
  'Slide up': 'pa-slide-up',
  'Slide down': 'pa-slide-down',
}

/** `color` at `alpha` (0..1) as an rgba() string. Only #rgb / #rrggbb can be
 * re-mixed; anything else (a named colour, an rgba() already) is handed back
 * untouched and carries its own alpha. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return `rgba(${ch[0]},${ch[1]},${ch[2]},${Math.round(alpha * 1000) / 1000})`
}

/** Which stage `v` falls in, given each stage's ascending start position. */
export function stageAt(v: number, starts: number[]): number {
  let i = 0
  for (let k = 0; k < starts.length; k++) if (v >= starts[k] - 1e-9) i = k
  return i
}

interface Stage {
  /** Outer node: position + crossfade. Inner node: the art + any stage animation. */
  layer: HTMLDivElement
  art: HTMLDivElement
  /** This stage's status-label ART, when one was uploaded — it replaces the drawn
   * text pill for this stage (and only this stage). */
  labelLayer: HTMLDivElement | null
  labelInner: HTMLDivElement | null
  label: string
  /** Pill colour for this stage — blank falls back to the one colour for all. */
  pillBg: string
}

export function createHoldGauge(): GameModule {
  let ctx: GameContext
  let wrap: HTMLDivElement
  let svg: SVGSVGElement
  let grad: SVGLinearGradientElement
  let bar: SVGPathElement
  let knob: SVGCircleElement
  let knobImg: HTMLDivElement | null = null
  let art: HTMLDivElement
  let labelArt: HTMLDivElement
  let pillWrap: HTMLDivElement
  let pill: HTMLDivElement
  const stages: Stage[] = []

  // Bar geometry / paint (design px, degrees), read once at mount.
  let sizeParam = 700
  let sweepDeg = 180
  let rotationDeg = 0
  let thicknessPx = 56
  let capRoundPct = 1
  let borderColor = ''
  let borderWidthPx = 0
  let colors: string[] = []
  let stopsText = ''
  let hardBands = false

  // Knob.
  let knobSizePx = 84
  let knobColor = '#3cc27a'
  let knobBorderColor = '#ffffff'
  let knobBorderWidthPx = 10
  let knobShadow = false
  let shadowColor = '#000000'
  let shadowAlpha = 0.3
  let shadowBlur = 16
  let shadowX = 0
  let shadowY = 8
  /** Filter id for the drawn knob's shadow — empty when the shadow is off. */
  let shadowId = ''

  // Motion.
  let fillSecs = 2.2
  let dropSecs = 1.2
  let releaseDelayMs = 0
  let startFrac = 0
  let winFrac = 1
  let holdAtTopMs = 0
  let previewFrac = 0
  let winAtStart = true
  let barOnly = false
  let screenWide = true
  let holdSfx = false
  let stageSfx = false
  /** '' off, 'once' a one-shot as the slide starts, 'loop' for as long as it lasts. */
  let dropSfx: '' | 'once' | 'loop' = ''
  let dropSfxMs = 600

  // Stage art / label.
  let starts: number[] = [0]
  let crossfadeMs = 200
  let showLabel = true
  let pillBg = ''
  /** Keyframe name played when the dial arrives in a new stage ('' = none). These
   * are the runtime's shared animations (anim.ts), already injected for every scene. */
  let animName = ''
  let animMs = 500
  let animArt = true
  let animLabel = true

  // Live state.
  let v = 0
  let holding = false
  let falling = false
  let holdLooping = false
  /** While the slide-back sound owns the audio, the hold loop stays quiet: the two
   * are never allowed to play over each other. Zero once it has had its say. */
  let quietUntil = 0
  let holdSfxTimer = 0
  let releasedAt = 0
  let topSince = 0
  let lastTs = 0
  let raf = 0
  let running = false
  let done = false
  let shownStage = -1
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null

  // Geometry in design px, recomputed by geometry() and read back per frame.
  // The arc's CENTRE sits at the centre of the mount box: a half-circle bar arches
  // over that point, the stage art sits on it and the status label hangs below it,
  // which is the layout the mechanic is drawn for. `nudge` shifts the whole lot.
  let S = 700
  let ringC = 350
  let ringR = 300
  let ringT = 56
  let nudgeX = 0
  let nudgeY = 0

  /** Gauge diameter in DESIGN px. 0 means "fill the mount box": the box's screen
   * size is divided back out by the stage scale so the widget stays a design-px
   * composition governed by the single scale transform below. */
  const designSize = (): number => {
    if (sizeParam > 0) return sizeParam
    const s = ctx.scale?.() || 1
    const box = Math.min(ctx.root.clientWidth || 0, ctx.root.clientHeight || 0)
    return Math.max(20, box / s)
  }

  /** How far along the BAR (0 = the arc's start end, 1 = its end) the dial sits.
   * `v` is measured from the resting end, which is whichever end doesn't win. */
  const arcFrac = (): number => (winAtStart ? 1 - v : v)

  /** Angle of a point at fraction `t` along the bar, in degrees clockwise from 12
   * o'clock — the same convention arcPath() draws in. */
  const angleAt = (t: number): number => rotationDeg - sweepDeg / 2 + t * sweepDeg

  /** A point on the gauge, from an angle in degrees clockwise from 12 o'clock. */
  const at = (deg: number, radius: number): { x: number; y: number } => ({
    x: ringC + radius * Math.sin(deg * DEG),
    y: ringC - radius * Math.cos(deg * DEG),
  })

  const pointAt = (t: number, radius: number): { x: number; y: number } => at(angleAt(t), radius)

  /** Size-dependent attributes: re-run whenever the design size can change (mount,
   * relayout) rather than every frame. */
  const geometry = (): void => {
    S = designSize()
    // The border straddles the path edge, so half of it hangs outside the band —
    // inset the radius by that half so a heavy border stays inside the box.
    ringT = Math.max(0.5, Math.min(S / 2, thicknessPx))
    ringR = Math.max(ringT / 2, (S - ringT - borderWidthPx) / 2)
    ringC = S / 2

    wrap.style.width = S + 'px'
    wrap.style.height = S + 'px'
    svg.setAttribute('viewBox', `0 0 ${S} ${S}`)
    svg.setAttribute('width', String(S))
    svg.setAttribute('height', String(S))

    // The sweep is drawn from 12 o'clock and rotated back by half its length, so a
    // 180° bar spans 9 → 3 o'clock and `rotationDeg` tilts the whole gauge.
    bar.setAttribute('d', arcPath(ringC, ringR, ringT, Math.min(360, sweepDeg) * DEG, (capRoundPct * ringT) / 2))
    bar.setAttribute('transform', `rotate(${rotationDeg - sweepDeg / 2} ${ringC} ${ringC})`)

    // The gradient runs along the CHORD between the bar's two ends, so the first
    // colour always lands on the start of the bar. Its coordinates are the PATH's
    // own space — the rotate above carries the ramp around with the arc, so these
    // are the un-rotated 12 o'clock → sweep endpoints, not the on-screen ones. A
    // full circle has no chord to run along; fall back to a straight ramp.
    const a = at(0, ringR)
    const b = at(Math.min(359.9, sweepDeg), ringR)
    const flat = Math.hypot(b.x - a.x, b.y - a.y) < 1
    const round = (n: number): string => String(Math.round(n * 1000) / 1000)
    grad.setAttribute('x1', round(flat ? 0 : a.x))
    grad.setAttribute('y1', round(flat ? ringC : a.y))
    grad.setAttribute('x2', round(flat ? S : b.x))
    grad.setAttribute('y2', round(flat ? ringC : b.y))

    knob.setAttribute('r', String(Math.max(1, knobSizePx / 2 - knobBorderWidthPx / 2)))
    if (knobImg) {
      knobImg.style.width = knobSizePx + 'px'
      knobImg.style.height = knobSizePx + 'px'
    }
  }

  /** Replay the stage-change animation on one node. Setting the same animation twice
   * running is a no-op in CSS, so it is cleared and the layout flushed first — the
   * standard restart, and the reason the dial can pop on every crossing rather than
   * only the first. */
  const playAnim = (el: HTMLElement | null | undefined): void => {
    if (!el || !animName) return
    el.style.animation = 'none'
    void el.offsetWidth
    el.style.animation = `${animName} ${animMs}ms ${animName === 'pa-pop' || animName === 'pa-fade' ? 'cubic-bezier(.2,.9,.3,1.2)' : 'ease-in-out'} both`
  }

  /** Per-frame state: knob position, which stage's art shows, the status label. */
  const render = (): void => {
    const t = arcFrac()
    const p = pointAt(t, ringR)
    knob.setAttribute('cx', String(p.x))
    knob.setAttribute('cy', String(p.y))
    if (knobImg) knobImg.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%)`

    const i = Math.min(stages.length - 1, stageAt(v, starts))
    wrap.dataset.value = v.toFixed(4)
    wrap.dataset.stage = String(i)
    if (i !== shownStage) {
      // Climbing into a stage is the game's progress beat, and each stage gets its
      // OWN sound ('stage2' for the second, 'stage3' for the third, …). Falling back
      // through the same boundary is a loss, not progress, so it stays silent — and
      // the very first paint (shownStage -1) isn't a crossing at all.
      if (shownStage >= 0 && stageSfx && running && i > shownStage) ctx.sfx.play(`stage${i + 1}`)
      const first = shownStage < 0
      shownStage = i
      stages.forEach((s, k) => {
        s.layer.style.opacity = k === i ? '1' : '0'
        if (s.labelLayer) s.labelLayer.style.opacity = showLabel && k === i ? '1' : '0'
      })
      // Uploaded label art wins for the stages that have it; the drawn pill covers
      // the rest, so a half-filled set of slots still reads.
      const label = stages[i]?.label ?? ''
      pill.textContent = label
      pillWrap.style.display = showLabel && label && !stages[i]?.labelLayer ? '' : 'none'
      pill.style.background = stages[i]?.pillBg || pillBg || 'transparent'
      // The first paint is the dial's opening state, not an arrival at a new one —
      // nothing has changed yet, so nothing plays.
      if (!first) {
        if (animArt) playAnim(stages[i]?.art)
        if (animLabel) playAnim(stages[i]?.labelInner ?? (pillWrap.style.display === 'none' ? null : pill))
      }
    }
  }

  // ---- Sound ---------------------------------------------------------------
  // Two sounds, one channel: the hold loop while the player is driving the dial up,
  // and the slide-back sound when they let go. They must never play over each other,
  // so the slide-back one takes precedence — the hold loop stays silent until it has
  // finished, then starts by itself if the player is still holding.

  /** Start (or re-arm) the hold loop, waiting out the slide-back sound first. */
  const startHoldSfx = (): void => {
    window.clearTimeout(holdSfxTimer)
    holdSfxTimer = 0
    if (!holdSfx || !holding || done || holdLooping) return
    const wait = quietUntil - Date.now()
    // A one-shot can't be interrupted or queried once it's playing, so its authored
    // length is what the loop waits out. Re-check on the way back in: the player may
    // have let go again in the meantime.
    if (wait > 0) {
      holdSfxTimer = window.setTimeout(startHoldSfx, wait)
      return
    }
    ctx.sfx.loopStart?.('drag')
    holdLooping = true
  }

  const stopHoldSfx = (): void => {
    window.clearTimeout(holdSfxTimer)
    holdSfxTimer = 0
    if (!holdLooping) return
    ctx.sfx.loopStop?.('drag')
    holdLooping = false
  }

  /** The dial has started sliding back — the moment the slide-back sound belongs to. */
  const startFall = (): void => {
    if (falling || done) return
    falling = true
    if (dropSfx === 'loop') ctx.sfx.loopStart?.('release')
    else if (dropSfx === 'once' && Date.now() >= quietUntil) {
      // Guarded by the same window that mutes the hold loop, so hammering the screen
      // retriggers neither the sound over itself nor the loop over the sound.
      ctx.sfx.play('release')
      quietUntil = Date.now() + dropSfxMs
    }
  }

  /** It landed, or the player grabbed it again — either way the slide is over. */
  const endFall = (): void => {
    if (!falling) return
    falling = false
    if (dropSfx === 'loop') {
      ctx.sfx.loopStop?.('release')
      quietUntil = 0 // a loop ends the instant it's told to; nothing to wait out
    }
  }

  const win = (): void => {
    if (done) return
    done = true
    holding = false
    stopHoldSfx()
    endFall()
    v = Math.max(v, winFrac)
    render()
    ctx.sfx.play('gameWin')
    winCb?.()
    completeCb?.()
  }

  /** Advance the dial by `dt` seconds of held / released motion. */
  const step = (dt: number): void => {
    if (holding) v = Math.min(1, v + (fillSecs > 0 ? dt / fillSecs : 1))
    else if (Date.now() - releasedAt >= releaseDelayMs) {
      // The slide-back sound belongs to the slide, not to the release: a let-go with
      // the dial already at rest has lost no ground and makes no sound.
      if (v > 0) startFall()
      v = Math.max(0, dropSecs > 0 ? v - dt / dropSecs : 0)
      if (v <= 0) endFall()
    }

    if (v >= winFrac - 1e-9) {
      if (holdAtTopMs <= 0) return win()
      if (!topSince) topSince = Date.now()
      else if (Date.now() - topSince >= holdAtTopMs) return win()
    } else topSince = 0
  }

  const frame = (): void => {
    raf = 0
    if (!running || done) return
    const now = Date.now()
    // Cap the step so a backgrounded tab doesn't resume with one giant jump.
    const dt = Math.min(0.1, Math.max(0, (now - lastTs) / 1000))
    lastTs = now
    step(dt)
    render()
    // Idle (parked at rest, nobody holding) costs nothing: the loop stops until the
    // next press wakes it.
    if (!done && (holding || v > 0)) raf = requestAnimationFrame(frame)
  }

  const wake = (): void => {
    if (raf || done || !running) return
    lastTs = Date.now()
    raf = requestAnimationFrame(frame)
  }

  /** Does this press count? "Bar only" means on the band itself or on the knob —
   * the rest of the card stays inert so a CTA underneath still works. */
  const hits = (clientX: number, clientY: number): boolean => {
    if (!barOnly) return true
    const r = svg.getBoundingClientRect()
    const s = (r.width || S) / S
    const x = (clientX - r.left) / s - ringC
    const y = (clientY - r.top) / s - ringC
    const tol = knobSizePx / 2
    const d = Math.hypot(x, y)
    if (d < ringR - ringT / 2 - tol || d > ringR + ringT / 2 + tol) return false
    // Angle of the press, measured the same way as the bar: clockwise from 12.
    let a = Math.atan2(x, -y) / DEG - (rotationDeg - sweepDeg / 2)
    while (a < -180) a += 360
    while (a > 360) a -= 360
    const slack = (tol / Math.max(1, ringR)) / DEG
    return a >= -slack && a <= sweepDeg + slack
  }

  const beginHold = (clientX: number, clientY: number, target: EventTarget | null): boolean => {
    if (done || !running || holding) return false
    // The CTA is never a hold: a press there is the player going to the store, and
    // driving the dial off it would fight the tap. `.pa-cta` is worn by both the CTA
    // and button elements, and closest() catches a press on the label inside one.
    if (target instanceof Element && target.closest('.pa-cta')) return false
    if (!hits(clientX, clientY)) return false
    holding = true
    topSince = 0
    // Grabbing the dial ends the slide first, so its sound is already off the channel
    // by the time the hold loop asks for it.
    endFall()
    startHoldSfx()
    wake()
    return true
  }

  const endHold = (): void => {
    if (!holding) return
    holding = false
    releasedAt = Date.now()
    topSince = 0
    stopHoldSfx()
    wake()
  }

  // Every listener this game puts on shared targets (the document, the window), so
  // destroy() can take them all back off again — a game-mount is torn down and
  // rebuilt on every edit in the editor, and a stray document listener would
  // outlive its dial and keep driving a detached one.
  const bound: { target: EventTarget; type: string; fn: EventListener }[] = []
  const bind = (target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void => {
    target.addEventListener(type, fn, opts)
    bound.push({ target, type, fn })
  }

  const layout = (): void => {
    geometry()
    // The ONLY viewport-dependent term is the scale, matching countdown.ts /
    // header.ts; any nudge is design px, so it rides inside that scale.
    const nudge = nudgeX || nudgeY ? ` translate(${nudgeX}px,${nudgeY}px)` : ''
    wrap.style.transform = `translate(-50%,-50%) scale(${ctx.scale?.() ?? 1})${nudge}`
    render()
  }

  return {
    mount(c, params) {
      ctx = c
      sizeParam = Math.max(0, Math.min(4000, num(params.sizePx, 700)))
      sweepDeg = Math.max(10, Math.min(360, num(params.sweepDeg, 180)))
      rotationDeg = Math.max(-180, Math.min(180, num(params.rotationDeg, 0)))
      thicknessPx = Math.max(1, Math.min(400, num(params.thicknessPx, 56)))
      capRoundPct = Math.max(0, Math.min(100, num(params.capRoundPct, 100))) / 100
      nudgeX = Math.max(-2000, Math.min(2000, num(params.nudgeXPx, 0)))
      nudgeY = Math.max(-2000, Math.min(2000, num(params.nudgeYPx, 0)))
      borderColor = str(params.borderColor, '')
      borderWidthPx = Math.max(0, Math.min(80, num(params.borderWidthPx, 0)))
      colors = [
        str(params.colorStart, '#5fbf7f'),
        str(params.colorMid, '#f2c14e'),
        str(params.colorMid2, ''),
        str(params.colorEnd, '#e2664b'),
      ].filter(Boolean)
      stopsText = str(params.colorStopsPct, '')
      hardBands = str(params.gradientMode, 'Smooth blend') === 'Hard bands'

      knobSizePx = Math.max(4, Math.min(600, num(params.knobSizePx, 84)))
      knobColor = str(params.knobColor, '#3cc27a')
      knobBorderColor = str(params.knobBorderColor, '#ffffff')
      knobBorderWidthPx = Math.max(0, Math.min(100, num(params.knobBorderWidthPx, 10)))
      knobShadow = params.knobShadow === true
      shadowColor = str(params.knobShadowColor, '#000000') || '#000000'
      shadowAlpha = Math.max(0, Math.min(100, num(params.knobShadowOpacity, 30))) / 100
      shadowBlur = Math.max(0, Math.min(400, num(params.knobShadowBlurPx, 16)))
      shadowX = Math.max(-400, Math.min(400, num(params.knobShadowXPx, 0)))
      shadowY = Math.max(-400, Math.min(400, num(params.knobShadowYPx, 8)))

      fillSecs = Math.max(0.05, Math.min(60, num(params.fillSecs, 2.2)))
      dropSecs = Math.max(0, Math.min(60, num(params.dropSecs, 1.2)))
      releaseDelayMs = Math.max(0, Math.min(5000, num(params.releaseDelayMs, 0)))
      startFrac = Math.max(0, Math.min(1, num(params.startPct, 0) / 100))
      winFrac = Math.max(0.05, Math.min(1, num(params.winAtPct, 100) / 100))
      holdAtTopMs = Math.max(0, Math.min(10000, num(params.holdAtTopMs, 0)))
      previewFrac = Math.max(0, Math.min(1, num(params.previewPct, 0) / 100))
      winAtStart = str(params.winEnd, 'Start of the bar') !== 'End of the bar'
      const area = str(params.holdArea, 'Anywhere on the screen')
      barOnly = area === 'The bar and knob only'
      screenWide = area === 'Anywhere on the screen'
      holdSfx = params.holdSfx === true
      stageSfx = params.stageSfx === true
      const drop = str(params.dropSfx, 'Off')
      dropSfx = drop === 'Once on release' ? 'once' : drop === 'Loop while it falls' ? 'loop' : ''
      dropSfxMs = Math.max(0, Math.min(5000, num(params.dropSfxMs, 600)))
      crossfadeMs = Math.max(0, Math.min(3000, num(params.crossfadeMs, 200)))
      showLabel = params.showLabel !== false
      animName = STAGE_ANIMS[str(params.stageAnim, 'None')] ?? ''
      animMs = Math.max(50, Math.min(5000, num(params.stageAnimMs, 500)))
      const animOn = str(params.stageAnimTarget, 'Stage image + label')
      animArt = animOn !== 'Label only'
      animLabel = animOn !== 'Stage image only'

      const n = Math.max(1, Math.min(8, Math.round(num(params.stages, 3))))
      const imgs = Array.isArray(params.stageImages) ? (params.stageImages as string[]) : []
      const labels = splitList(str(params.stageLabels, ''))
      const pillBgs = splitList(str(params.stageLabelBgColors, ''))
      // Stage starts are read as "the dial enters stage i at N%", so a blank list
      // is an even split of the travel.
      starts = parsePositions(str(params.stageStopsPct, ''), n, true)
      v = previewFrac

      ctx.root.style.touchAction = 'none'

      wrap = document.createElement('div')
      wrap.style.cssText = 'position:absolute;left:50%;top:50%;transform-origin:center;pointer-events:none;'
      // The shared keyframes scale their px offsets by --pa-s (the stage scale), but
      // everything in here is already inside one scale() — pin it to 1 so a bounce
      // travels its design-px distance instead of being scaled twice.
      wrap.style.setProperty('--pa-s', '1')

      // Art sits UNDER the bar so a face drawn inside the arc never covers the knob.
      art = document.createElement('div')
      art.style.cssText = 'position:absolute;inset:0;'
      wrap.appendChild(art)

      // One crossfading layer per stage, sized by the art's OWN aspect so swapping
      // stages never squashes a face — and so a wide status pill and a tall face can
      // share the same code with nothing but a width.
      //
      // Two nodes, not one, for the same reason the stage splits .pa-el from
      // .pa-el-anim: the OUTER holds the position (a translate that must not move)
      // and the crossfade, the INNER holds the art and any stage-change animation,
      // whose keyframes are free to write transform without fighting the centring.
      const makeLayer = (id: string | undefined, widthPx: number, offX: number, offY: number): { outer: HTMLDivElement; inner: HTMLDivElement } => {
        const nat = ctx.assets.size?.(id) ?? null
        const h = nat && nat.w > 0 ? (widthPx * nat.h) / nat.w : widthPx
        const outer = document.createElement('div')
        outer.style.cssText =
          'position:absolute;left:50%;top:50%;opacity:0;' +
          `width:${widthPx}px;height:${h}px;transform:translate(calc(-50% + ${offX}px),calc(-50% + ${offY}px));` +
          `transition:opacity ${crossfadeMs}ms linear;`
        const inner = document.createElement('div')
        inner.style.cssText = 'position:absolute;inset:0;background:center/contain no-repeat;transform-origin:center;'
        const src = ctx.assets.src(id)
        if (src) inner.style.backgroundImage = `url("${src}")`
        outer.appendChild(inner)
        return { outer, inner }
      }

      const artSize = Math.max(0, Math.min(4000, num(params.imageSizePx, 380)))
      const artX = num(params.imageOffsetXPx, 0)
      const artY = num(params.imageOffsetYPx, 0)
      const labelImgs = Array.isArray(params.stageLabelImages) ? (params.stageLabelImages as string[]) : []
      const labelW = Math.max(0, Math.min(4000, num(params.labelImageWidthPx, 300)))
      const labelX = num(params.labelOffsetXPx, 0)
      const labelY = num(params.labelOffsetYPx, 250)
      // Label art rides ABOVE the bar (a pill may overlap it); the faces sit under it.
      labelArt = document.createElement('div')
      labelArt.style.cssText = 'position:absolute;inset:0;'
      for (let i = 0; i < n; i++) {
        const face = makeLayer(imgs[i], artSize, artX, artY)
        art.appendChild(face.outer)
        let label: { outer: HTMLDivElement; inner: HTMLDivElement } | null = null
        if (ctx.assets.src(labelImgs[i])) {
          label = makeLayer(labelImgs[i], labelW, labelX, labelY)
          labelArt.appendChild(label.outer)
        }
        stages.push({
          layer: face.outer,
          art: face.inner,
          labelLayer: label?.outer ?? null,
          labelInner: label?.inner ?? null,
          label: labels[i] ?? '',
          pillBg: pillBgs[i] ?? '',
        })
      }

      svg = document.createElementNS(SVG_NS, 'svg')
      svg.setAttribute('fill', 'none')
      svg.style.cssText = 'position:absolute;left:0;top:0;display:block;overflow:visible;'

      const uid = `hg-${Math.round((ctx.rng?.() ?? 0.5) * 1e9).toString(36)}`
      const defs = document.createElementNS(SVG_NS, 'defs')
      grad = document.createElementNS(SVG_NS, 'linearGradient')
      grad.setAttribute('id', uid)
      grad.setAttribute('gradientUnits', 'userSpaceOnUse')
      for (const s of barStops(colors, parsePositions(stopsText, colors.length, hardBands), hardBands)) {
        const st = document.createElementNS(SVG_NS, 'stop')
        st.setAttribute('offset', String(s.o))
        st.setAttribute('stop-color', s.c)
        grad.appendChild(st)
      }
      defs.appendChild(grad)

      // The knob's shadow. One set of numbers drives both knobs: an SVG drop-shadow
      // for the drawn circle, the identical CSS one for an uploaded knob image (which
      // follows the art's alpha, so a non-round knob still casts its own shape).
      // `blur` is the CSS blur radius, which is twice a Gaussian's deviation.
      if (knobShadow) {
        const f = document.createElementNS(SVG_NS, 'filter')
        f.setAttribute('id', uid + '-s')
        // The default filter region is a hair bigger than the shape — far too tight
        // for an offset, blurred shadow, which would come out with its edges cut off.
        f.setAttribute('x', '-100%')
        f.setAttribute('y', '-100%')
        f.setAttribute('width', '300%')
        f.setAttribute('height', '300%')
        const ds = document.createElementNS(SVG_NS, 'feDropShadow')
        ds.setAttribute('dx', String(shadowX))
        ds.setAttribute('dy', String(shadowY))
        ds.setAttribute('stdDeviation', String(shadowBlur / 2))
        ds.setAttribute('flood-color', shadowColor)
        ds.setAttribute('flood-opacity', String(shadowAlpha))
        f.appendChild(ds)
        defs.appendChild(f)
        shadowId = uid + '-s'
      }
      svg.appendChild(defs)

      bar = document.createElementNS(SVG_NS, 'path')
      bar.setAttribute('fill', colors.length ? `url(#${grad.getAttribute('id')})` : 'none')
      bar.setAttribute('stroke', borderWidthPx > 0 && borderColor ? borderColor : 'none')
      if (borderWidthPx > 0) bar.setAttribute('stroke-width', String(borderWidthPx))
      bar.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(bar)

      knob = document.createElementNS(SVG_NS, 'circle')
      knob.setAttribute('fill', knobColor || 'none')
      knob.setAttribute('stroke', knobBorderWidthPx > 0 && knobBorderColor ? knobBorderColor : 'none')
      if (knobBorderWidthPx > 0) knob.setAttribute('stroke-width', String(knobBorderWidthPx))
      if (shadowId) knob.setAttribute('filter', `url(#${shadowId})`)
      svg.appendChild(knob)
      wrap.appendChild(svg)

      // An uploaded knob replaces the drawn circle entirely (its own art carries the
      // fill and the border), so the two never double up.
      const knobSrc = ctx.assets.src(params.knobImage as string)
      if (knobSrc) {
        knob.setAttribute('fill', 'none')
        knob.setAttribute('stroke', 'none')
        knob.removeAttribute('filter')
        knobImg = document.createElement('div')
        knobImg.style.cssText = 'position:absolute;left:0;top:0;background:center/contain no-repeat;'
        knobImg.style.backgroundImage = `url("${knobSrc}")`
        if (knobShadow) knobImg.style.filter = `drop-shadow(${shadowX}px ${shadowY}px ${shadowBlur}px ${withAlpha(shadowColor, shadowAlpha)})`
        wrap.appendChild(knobImg)
      }

      wrap.appendChild(labelArt)

      // Same two-node split as the art layers: the wrapper is positioned, the pill
      // itself is what animates.
      pillWrap = document.createElement('div')
      pillWrap.style.cssText = 'position:absolute;left:50%;top:50%;display:none;'
      pillWrap.style.transform = `translate(calc(-50% + ${labelX}px),calc(-50% + ${labelY}px))`
      pill = document.createElement('div')
      pill.style.cssText = 'white-space:pre;line-height:1.1;text-align:center;transform-origin:center;'
      pill.style.fontSize = Math.max(4, Math.min(400, num(params.labelSizePx, 46))) + 'px'
      pill.style.fontWeight = String(Math.max(100, Math.min(900, num(params.labelWeight, 700))))
      pill.style.color = str(params.labelColor, '#ffffff')
      pillBg = str(params.labelBgColor, '#e2664b')
      pill.style.borderRadius = Math.max(0, Math.min(400, num(params.labelRadiusPx, 999))) + 'px'
      pill.style.padding = `${Math.max(0, num(params.labelPadYPx, 12))}px ${Math.max(0, num(params.labelPadXPx, 34))}px`
      const family = cssFontFamily(str(params.labelFontFamily, ''))
      pill.style.fontFamily = family || '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
      const ls = num(params.labelLetterSpacingPx, 0)
      if (ls) pill.style.letterSpacing = ls + 'px'
      pillWrap.appendChild(pill)
      wrap.appendChild(pillWrap)

      ctx.root.appendChild(wrap)
      layout()
    },

    start() {
      if (running) return
      running = true
      v = startFrac
      shownStage = -1 // force the first paint of art + label
      render()

      // Where a press has to LAND to count. Screen-wide listens on the document, so
      // holding any part of the ad — the copy, the CTA, the empty margin — drives the
      // dial; the narrower modes listen on the game's own box and hit-test from there.
      const down: EventTarget = screenWide ? (ctx.root.ownerDocument ?? document) : ctx.root

      // Touch first (the reliable path in MRAID containers), pointer as the desktop
      // fallback — the same split scratch.ts uses. No preventDefault on touchstart:
      // `touch-action:none` already blocks scrolling, and swallowing it costs the
      // user-activation that unlocks audio on Android.
      let touchActive = false
      const onTouchStart = (ev: Event): void => {
        const t = (ev as TouchEvent).changedTouches[0]
        if (!beginHold(t.clientX, t.clientY, ev.target)) return
        touchActive = true
      }
      const onTouchEnd = (): void => {
        if (!touchActive) return
        touchActive = false
        endHold()
      }
      const onPointerDown = (ev: Event): void => {
        const e = ev as PointerEvent
        if (touchActive || e.pointerType === 'touch') return
        beginHold(e.clientX, e.clientY, ev.target)
      }
      const onPointerUp = (): void => endHold()

      bind(down, 'touchstart', onTouchStart, { passive: true })
      bind(down, 'pointerdown', onPointerDown)
      // The RELEASE always listens document-wide, whatever the hold area is: a finger
      // that starts on the bar and lifts off it (or off the ad entirely) must still end
      // the hold, or the dial would keep climbing with nobody touching it.
      const doc = ctx.root.ownerDocument ?? document
      bind(doc, 'touchend', onTouchEnd)
      bind(doc, 'touchcancel', onTouchEnd)
      bind(doc, 'pointerup', onPointerUp)
      bind(doc, 'pointercancel', onPointerUp)
      bind(window, 'blur', onPointerUp)
    },

    relayout: layout,

    getHint(): HintMove | null {
      if (done) return null
      // Rest the hand on the knob and hold it there — the gesture the game wants,
      // shown where the press moves the dial from.
      const r = svg.getBoundingClientRect()
      const s = (r.width || S) / S
      const p = pointAt(arcFrac(), ringR)
      const at = { x: r.left + p.x * s, y: r.top + p.y * s }
      return { from: at, to: at, kind: 'hold' }
    },

    onComplete(cb) {
      completeCb = cb
    },

    onWin(cb) {
      winCb = cb
    },

    destroy() {
      running = false
      cancelAnimationFrame(raf)
      raf = 0
      stopHoldSfx()
      endFall()
      holding = false
      for (const b of bound) b.target.removeEventListener(b.type, b.fn)
      bound.length = 0
      ctx.root.innerHTML = ''
    },
  }
}

export const HOLDGAUGE_TEMPLATE: GameTemplate = {
  id: 'holdgauge',
  label: 'Hold gauge (hold to drive the dial into the win zone)',
  paramFields: [
    // — The bar —
    { key: 'sizePx', label: 'Gauge size (design px, 0 = fill the box)', type: 'number', min: 0, max: 4000, step: 10 },
    { key: 'sweepDeg', label: 'Bar length (degrees of arc — 180 = half circle)', type: 'number', min: 10, max: 360, step: 5 },
    { key: 'rotationDeg', label: 'Bar rotation (deg)', type: 'number', min: -180, max: 180, step: 5 },
    { key: 'nudgeXPx', label: 'Whole gauge nudge X (design px)', type: 'number', min: -2000, max: 2000, step: 5 },
    { key: 'nudgeYPx', label: 'Whole gauge nudge Y (design px)', type: 'number', min: -2000, max: 2000, step: 5 },
    { key: 'thicknessPx', label: 'Bar thickness (design px)', type: 'number', min: 1, max: 400, step: 2 },
    { key: 'capRoundPct', label: 'Bar corner radius (%, 0 = square, 100 = fully round)', type: 'number', min: 0, max: 100, step: 5 },
    { key: 'borderColor', label: 'Bar border colour (none = no border)', type: 'color' },
    { key: 'borderWidthPx', label: 'Bar border weight (design px)', type: 'number', min: 0, max: 80, step: 1 },
    { key: 'colorStart', label: 'Bar colour 1 (at the start of the bar)', type: 'color' },
    { key: 'colorMid', label: 'Bar colour 2 (none = skip)', type: 'color' },
    { key: 'colorMid2', label: 'Bar colour 3 (none = skip)', type: 'color' },
    { key: 'colorEnd', label: 'Bar colour 4 (at the end of the bar, none = skip)', type: 'color' },
    { key: 'gradientMode', label: 'Bar colours', type: 'select', options: ['Smooth blend', 'Hard bands'] },
    { key: 'colorStopsPct', label: 'Colour levels (% along the bar, e.g. 0,40,80 — blank = even)', type: 'text' },

    // — The knob —
    { key: 'knobSizePx', label: 'Knob size (design px)', type: 'number', min: 4, max: 600, step: 2 },
    { key: 'knobColor', label: 'Knob colour', type: 'color' },
    { key: 'knobBorderColor', label: 'Knob border colour (none = no border)', type: 'color' },
    { key: 'knobBorderWidthPx', label: 'Knob border weight (design px)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'knobShadow', label: 'Shadow under the knob', type: 'boolean' },
    { key: 'knobShadowColor', label: 'Knob shadow colour', type: 'color', showIf: (p) => p.knobShadow === true },
    { key: 'knobShadowOpacity', label: 'Knob shadow opacity (%)', type: 'number', min: 0, max: 100, step: 5, showIf: (p) => p.knobShadow === true },
    { key: 'knobShadowBlurPx', label: 'Knob shadow blur (design px)', type: 'number', min: 0, max: 400, step: 2, showIf: (p) => p.knobShadow === true },
    { key: 'knobShadowXPx', label: 'Knob shadow offset X (design px)', type: 'number', min: -400, max: 400, step: 1, showIf: (p) => p.knobShadow === true },
    { key: 'knobShadowYPx', label: 'Knob shadow offset Y (design px)', type: 'number', min: -400, max: 400, step: 1, showIf: (p) => p.knobShadow === true },

    // — Motion —
    { key: 'winEnd', label: 'Winning end of the bar', type: 'select', options: ['Start of the bar', 'End of the bar'] },
    { key: 'fillSecs', label: 'Hold time to cross the whole bar (seconds)', type: 'number', min: 0.05, max: 60, step: 0.1 },
    { key: 'dropSecs', label: 'Fall-back time on release (seconds, 0 = snap back)', type: 'number', min: 0, max: 60, step: 0.1 },
    { key: 'releaseDelayMs', label: 'Grace before it starts falling (ms)', type: 'number', min: 0, max: 5000, step: 50 },
    { key: 'startPct', label: 'Dial starts at (% of travel)', type: 'number', min: 0, max: 100, step: 5 },
    { key: 'winAtPct', label: 'Win when the dial reaches (% of travel)', type: 'number', min: 5, max: 100, step: 5 },
    { key: 'holdAtTopMs', label: 'Hold in the win zone for (ms, 0 = instant)', type: 'number', min: 0, max: 10000, step: 100 },
    { key: 'holdArea', label: 'Where the player has to hold (the CTA is never a hold)', type: 'select', options: ['Anywhere on the screen', 'Anywhere on the game', 'The bar and knob only'] },

    // — Stages (art + status label) —
    { key: 'stages', label: 'How many dial stages', type: 'number', min: 1, max: 8, step: 1 },
    { key: 'stageStopsPct', label: 'Stage starts (% of travel, e.g. 0,40,80 — blank = even)', type: 'text' },
    { key: 'imageSizePx', label: 'Stage image width (design px)', type: 'number', min: 0, max: 4000, step: 10 },
    { key: 'imageOffsetXPx', label: 'Stage image nudge X (design px)', type: 'number', min: -2000, max: 2000, step: 5 },
    { key: 'imageOffsetYPx', label: 'Stage image nudge Y (design px)', type: 'number', min: -2000, max: 2000, step: 5 },
    { key: 'crossfadeMs', label: 'Stage crossfade (ms)', type: 'number', min: 0, max: 3000, step: 25 },
    { key: 'stageAnim', label: 'Animation when the dial reaches a new stage', type: 'select', options: Object.keys(STAGE_ANIMS) },
    { key: 'stageAnimMs', label: 'Stage animation length (ms)', type: 'number', min: 50, max: 5000, step: 50, showIf: (p) => p.stageAnim !== 'None' && p.stageAnim != null },
    { key: 'stageAnimTarget', label: 'Animate', type: 'select', options: ['Stage image + label', 'Stage image only', 'Label only'], showIf: (p) => p.stageAnim !== 'None' && p.stageAnim != null },
    { key: 'showLabel', label: 'Show the status label', type: 'boolean' },
    { key: 'labelImageWidthPx', label: 'Status label image width (design px)', type: 'number', min: 0, max: 4000, step: 10, showIf: (p) => p.showLabel !== false },
    { key: 'stageLabels', label: 'Typed labels, per stage (HIGH|NEUTRAL|LOW) — used where no label image is set', type: 'text', showIf: (p) => p.showLabel !== false },
    { key: 'labelFontFamily', label: 'Label font (family or uploaded font id)', type: 'text', showIf: (p) => p.showLabel !== false },
    { key: 'labelSizePx', label: 'Label size (design px)', type: 'number', min: 4, max: 400, step: 2, showIf: (p) => p.showLabel !== false },
    { key: 'labelWeight', label: 'Label weight', type: 'number', min: 100, max: 900, step: 100, showIf: (p) => p.showLabel !== false },
    { key: 'labelColor', label: 'Label colour', type: 'color', showIf: (p) => p.showLabel !== false },
    { key: 'labelBgColor', label: 'Label pill colour (none = no pill)', type: 'color', showIf: (p) => p.showLabel !== false },
    { key: 'stageLabelBgColors', label: 'Pill colour per stage (#e2664b|#f2c14e|#5fbf7f — blank = the colour above)', type: 'text', showIf: (p) => p.showLabel !== false },
    { key: 'labelRadiusPx', label: 'Label pill corner radius (design px)', type: 'number', min: 0, max: 400, step: 2, showIf: (p) => p.showLabel !== false },
    { key: 'labelPadXPx', label: 'Label pill padding X (design px)', type: 'number', min: 0, max: 400, step: 2, showIf: (p) => p.showLabel !== false },
    { key: 'labelPadYPx', label: 'Label pill padding Y (design px)', type: 'number', min: 0, max: 400, step: 2, showIf: (p) => p.showLabel !== false },
    { key: 'labelLetterSpacingPx', label: 'Label letter spacing (design px)', type: 'number', min: -40, max: 80, step: 1, showIf: (p) => p.showLabel !== false },
    { key: 'labelOffsetXPx', label: 'Label nudge X (design px)', type: 'number', min: -2000, max: 2000, step: 5, showIf: (p) => p.showLabel !== false },
    { key: 'labelOffsetYPx', label: 'Label nudge Y (design px)', type: 'number', min: -2000, max: 2000, step: 5, showIf: (p) => p.showLabel !== false },

    // — Sound / editor —
    { key: 'holdSfx', label: 'Loop the "drag" sound while held', type: 'boolean' },
    { key: 'dropSfx', label: 'Sound when the dial slides back ("release")', type: 'select', options: ['Off', 'Once on release', 'Loop while it falls'] },
    { key: 'dropSfxMs', label: 'How long that sound is (ms) — the hold sound waits it out', type: 'number', min: 0, max: 5000, step: 50, showIf: (p) => p.dropSfx === 'Once on release' },
    { key: 'stageSfx', label: 'Play a sound each time the dial climbs into a new stage', type: 'boolean' },
    { key: 'previewPct', label: 'Editor preview position (% of travel)', type: 'number', min: 0, max: 100, step: 5 },
  ],
  assetSlots: [
    { key: 'stageImages', label: 'Stage image', list: true, countParam: 'stages' },
    { key: 'stageLabelImages', label: 'Status label image', list: true, countParam: 'stages', showIf: (p) => p.showLabel !== false },
    { key: 'knobImage', label: 'Knob image (replaces the drawn circle)' },
  ],
  defaultParams: {
    sizePx: 700,
    sweepDeg: 180,
    rotationDeg: 0,
    nudgeXPx: 0,
    nudgeYPx: 0,
    thicknessPx: 56,
    capRoundPct: 100,
    borderColor: '',
    borderWidthPx: 0,
    colorStart: '#5fbf7f',
    colorMid: '#f2c14e',
    colorMid2: '',
    colorEnd: '#e2664b',
    gradientMode: 'Smooth blend',
    colorStopsPct: '',
    knobSizePx: 84,
    knobColor: '#3cc27a',
    knobBorderColor: '#ffffff',
    knobBorderWidthPx: 10,
    knobShadow: false,
    knobShadowColor: '#000000',
    knobShadowOpacity: 30,
    knobShadowBlurPx: 16,
    knobShadowXPx: 0,
    knobShadowYPx: 8,
    winEnd: 'Start of the bar',
    fillSecs: 2.2,
    dropSecs: 1.2,
    releaseDelayMs: 0,
    startPct: 0,
    winAtPct: 100,
    holdAtTopMs: 0,
    holdArea: 'Anywhere on the screen',
    stages: 3,
    stageStopsPct: '',
    stageImages: [],
    stageLabelImages: [],
    labelImageWidthPx: 300,
    knobImage: '',
    imageSizePx: 380,
    imageOffsetXPx: 0,
    imageOffsetYPx: 0,
    crossfadeMs: 200,
    stageAnim: 'None',
    stageAnimMs: 500,
    stageAnimTarget: 'Stage image + label',
    showLabel: true,
    stageLabels: 'HIGH|NEUTRAL|LOW',
    labelFontFamily: '',
    labelSizePx: 46,
    labelWeight: 700,
    labelColor: '#ffffff',
    labelBgColor: '#e2664b',
    stageLabelBgColors: '#e2664b|#f2c14e|#5fbf7f',
    labelRadiusPx: 999,
    labelPadXPx: 34,
    labelPadYPx: 12,
    labelLetterSpacingPx: 0,
    labelOffsetXPx: 0,
    labelOffsetYPx: 250,
    holdSfx: false,
    dropSfx: 'Off',
    dropSfxMs: 600,
    stageSfx: false,
    previewPct: 0,
  },
  // Press and HOLD in place — the gesture is the whole mechanic, so the hand rests
  // on the dial and stays down rather than tapping at it.
  defaultHandguide: { mode: 'hold', nodes: [{ x: 0.5, y: 0.5 }], periodMs: 2000 },
  create: createHoldGauge,
}
