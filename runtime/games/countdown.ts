// Countdown ring: a circular timer whose arc sweeps into a second colour as the
// seconds run out, with the remaining time printed in the middle. When the round's
// duration elapses the game completes (the scene's gameWin phase takes over).
//
// Three numbers, each independent, so a short round can WEAR a long clock:
//   seconds      — how long the round actually runs before the game completes
//   startSeconds — what the label starts at (0 = the duration)
//   capSeconds   — what one full circle of the arc is worth (0 = the label start)
// Set them to 4 / 54 / 60 and the viewer sees a 60-second dial holding steady near
// full, its number ticking 54 → 50, while the round is over in four seconds. The
// label always drains in real time; the arc is just the label's position on the dial.
//
// SCALING — the whole widget is authored in DESIGN px and drawn through a single
// `scale()` transform, exactly like the pinned dynamic-date header (header.ts):
// the ring, its stroke, the label and its letter-spacing are one rigid unit that
// grows and shrinks with the layout instead of being re-derived from the mount
// box's pixel size. A ring set to 420px therefore holds the same proportion of
// the composition on every phone, tablet and zoom level, and reads at the same
// size as a header set to the same number.

import { cssFontFamily } from '../font'
import { braceBareTokens, renderCountdownFormat, type TextCase } from '../elements/countdown'
import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { num, str } from './types'

const SVG_NS = 'http://www.w3.org/2000/svg'
const TAU = Math.PI * 2

const TEXT_CASE: Record<string, TextCase> = {
  UPPERCASE: 'upper',
  'Capitalize Each Word': 'title',
  lowercase: 'lower',
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Parse a #rgb / #rrggbb colour into channels. Returns null for anything else
 * (named colours, rgba(), gradients) — those are used as-is, unmixed. */
function channels(color: string): [number, number, number] | null {
  const m = HEX.exec(color.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function mix(a: string, b: string, t: number): string {
  const A = channels(a)
  const B = channels(b)
  if (!A || !B) return t < 0.5 ? a : b
  const ch = A.map((v, i) => Math.round(v + (B[i] - v) * t))
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`
}

/** Colour of the arc at elapsed fraction `t`, walking an even ramp through the
 * configured stops (start → mid → end). One stop = a constant colour. */
export function rampColor(stops: string[], t: number): string {
  if (stops.length < 2) return stops[0] ?? '#000000'
  const p = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(p))
  return mix(stops[i], stops[i + 1], p - i)
}

/** SVG path for the arc: an annular sector with all four corners filleted.
 *
 * The arc is a FILLED shape rather than a stroked circle because that is the only
 * way the rounding can be dialled: `stroke-linecap` offers butt or fully-round and
 * nothing between. Here each corner gets its own circular fillet of radius `k`, so
 * the end face stays flat and just curves in at the edges — `k` = 0 reproduces a
 * butt cap exactly, `k` = t/2 collapses the flat face to a point and reproduces a
 * round cap. Unlike a round linecap the rounding eats INTO the sweep instead of
 * overhanging it, so the arc still covers exactly its share of the circle.
 *
 * Angles run clockwise from 12 o'clock (the caller's rotate/mirror transform puts
 * the sweep where the author asked for it). `c` centre, `r` mid radius, `t` stroke
 * thickness, `span` sweep in radians. */
export function arcPath(c: number, r: number, t: number, span: number, k: number): string {
  const R = r + t / 2
  const Ri = Math.max(0, r - t / 2)
  const P = (rho: number, a: number): string =>
    `${(c + rho * Math.sin(a)).toFixed(3)} ${(c - rho * Math.cos(a)).toFixed(3)}`

  // A full turn has no ends to round, and no single arc command can draw it: two
  // circles wound in opposite directions punch the hole with the default fill rule.
  if (span >= TAU - 1e-6) {
    return (
      `M ${P(R, 0)} A ${R} ${R} 0 1 1 ${P(R, Math.PI)} A ${R} ${R} 0 1 1 ${P(R, 0)} Z ` +
      `M ${P(Ri, 0)} A ${Ri} ${Ri} 0 1 0 ${P(Ri, Math.PI)} A ${Ri} ${Ri} 0 1 0 ${P(Ri, 0)} Z`
    )
  }

  // Each fillet eats an angle off its end of the sweep, and the outer edge — being
  // the longer one — runs out of room first. Shrink the radii until both fits, so a
  // nearly empty ring tapers to a sliver instead of folding back through itself.
  //
  // A fillet can never eat more than a quarter turn, so past a half turn there is
  // always room and the limit must be switched OFF rather than computed: sin() turns
  // back down after span = π and would otherwise square off a nearly FULL ring as
  // though it were a nearly empty one — visible as a drain ring whose corners
  // un-round themselves over the first seconds of the count.
  const s = span >= Math.PI ? 1 : Math.sin(span / 2)
  const kMax = Math.min(k, t / 2)
  const kO = Math.max(0, Math.min(kMax, (s * R) / (1 + s)))
  const kI = Math.max(0, Math.min(kMax, s < 1 ? (s * Ri) / (1 - s) : Infinity))
  // A fillet centre sits `k` in from its own edge and `k` off the flat end face,
  // which fixes both the angle it consumes and where it meets that face.
  const dO = Math.asin(Math.min(1, kO / Math.max(1e-6, R - kO)))
  const dI = Math.asin(Math.min(1, kI / Math.max(1e-6, Ri + kI)))
  const fO = Math.sqrt(Math.max(0, (R - kO) ** 2 - kO ** 2))
  const fI = Math.sqrt(Math.max(0, (Ri + kI) ** 2 - kI ** 2))

  return [
    `M ${P(R, dO)}`,
    `A ${R} ${R} 0 ${span - 2 * dO > Math.PI ? 1 : 0} 1 ${P(R, span - dO)}`,
    `A ${kO} ${kO} 0 0 1 ${P(fO, span)}`,
    `L ${P(fI, span)}`,
    `A ${kI} ${kI} 0 0 1 ${P(Ri, span - dI)}`,
    `A ${Ri} ${Ri} 0 ${span - 2 * dI > Math.PI ? 1 : 0} 0 ${P(Ri, dI)}`,
    `A ${kI} ${kI} 0 0 1 ${P(fI, 0)}`,
    `L ${P(fO, 0)}`,
    `A ${kO} ${kO} 0 0 1 ${P(R, dO)}`,
    'Z',
  ].join(' ')
}

/** Render the label for `remainMs` left on the clock.
 *
 * `{t}`/`{tt}` are this game's own tokens — the TOTAL whole seconds remaining, so
 * a 90s ring can read "90s" rather than the shared `{ss}`'s seconds-within-the-
 * minute. Everything else goes through the same formatter (and so the same token
 * vocabulary) as the header and the countdown element. The deadline is rounded up
 * to the next whole second so `{t}` and `{mm}:{ss}` never disagree by one. */
export function formatRingLabel(fmt: string, remainMs: number, now: number, textCase: TextCase): string {
  const secs = Math.ceil(Math.max(0, remainMs) / 1000)
  const withTotals = fmt.replace(/\{tt\}/g, secs < 10 ? '0' + secs : String(secs)).replace(/\{t\}/g, String(secs))
  return renderCountdownFormat(braceBareTokens(withTotals), now + secs * 1000, now, { textCase })
}

export function createCountdown(): GameModule {
  let ctx: GameContext
  let wrap: HTMLDivElement
  let svg: SVGSVGElement
  let track: SVGCircleElement
  let arc: SVGPathElement
  let label: HTMLDivElement

  // Config (design px / ms), read once at mount.
  let totalMs = 60000
  // What the LABEL starts at, which need not be the round's length: "count down
  // from 60" over a 10s round reads 60s → 50s. 0 keeps the two in step.
  let startFromMs = 0
  // What a FULL CIRCLE of the arc is worth. Independent of both of the above, so a
  // 4s round counting 54 → 50 can sit on a 60-second dial and only nudge the arc.
  let capMs = 0
  let sizeParam = 420
  let thicknessPx = 44
  let trackColor = '#8e86ea'
  let stops: string[] = ['#171774']
  let drain = false
  let ccw = false
  let startDeg = 0
  // Corner radius of the arc's ends as a fraction of half the thickness: 0 flat,
  // 1 fully round, anything between is a flat end face that curves in at the edges.
  let capRound = 1
  let labelFmt = '{t}s'
  let endLabelFmt = ''
  let showLabel = true
  let fontSizePx = 104
  let textCase: TextCase = 'none'
  let tapToSkip = false
  let tickSfx = false
  let previewFrac = 0.25

  let startedAt = 0
  let running = false
  let done = false
  let raf = 0
  let lastTickSec = -1
  let completeCb: (() => void) | null = null

  /** Ring diameter in DESIGN px. `sizePx` 0 means "fill the mount box": the box's
   * screen size is divided back out by the stage scale so the widget stays a
   * design-px composition and the single scale transform below still governs it. */
  const designSize = (): number => {
    if (sizeParam > 0) return sizeParam
    const s = ctx.scale?.() || 1
    const box = Math.min(ctx.root.clientWidth || 0, ctx.root.clientHeight || 0)
    return Math.max(20, box / s)
  }

  /** Milliseconds the LABEL reads. The clock always drains in real time (one second
   * of copy per second of play); `startFromMs` only decides where it starts.
   *
   * Before play (the editor's static preview) the reading is derived from the
   * preview fill instead, so the ring and the number always agree on screen. */
  const labelMs = (): number => {
    if (!running && !done) return Math.min(startFromMs, capMs * (1 - Math.max(0, Math.min(1, previewFrac))))
    const elapsed = done || totalMs <= 0 ? totalMs : Math.min(totalMs, Date.now() - startedAt)
    return Math.max(0, startFromMs - elapsed)
  }

  /** How much of the ring the arc has covered. The dial's full turn is worth
   * `capMs` — NOT the round's duration — so the arc is simply the label's position
   * on that dial. A 4-second round counting 54 → 50 on a 60-second cap therefore
   * nudges the arc from 10% to 17% rather than sweeping the whole circle. */
  const dialFrac = (): number => (capMs > 0 ? Math.max(0, Math.min(1, (capMs - labelMs()) / capMs)) : 1)

  // Ring geometry in design px, recomputed by geometry() and read back per frame.
  let ringC = 0
  let ringR = 0
  let ringT = 0

  /** Size-dependent attributes: re-run whenever the design size can change (mount,
   * relayout) rather than every frame. */
  const geometry = (): void => {
    const S = designSize()
    ringT = Math.max(0.5, Math.min(S / 2, thicknessPx))
    ringR = (S - ringT) / 2
    ringC = S / 2

    wrap.style.width = S + 'px'
    wrap.style.height = S + 'px'
    svg.setAttribute('viewBox', `0 0 ${S} ${S}`)
    svg.setAttribute('width', String(S))
    svg.setAttribute('height', String(S))

    track.setAttribute('cx', String(ringC))
    track.setAttribute('cy', String(ringC))
    track.setAttribute('r', String(ringR))
    track.setAttribute('stroke-width', String(ringT))
    // Sweep starts `startDeg` clockwise from 12 o'clock. Counter-clockwise mirrors
    // the arc about the vertical axis (which reverses the sweep) and pre-rotates by
    // 270-θ so the START point still lands on the same spot on the dial.
    arc.setAttribute(
      'transform',
      ccw
        ? `translate(${S} 0) scale(-1 1) rotate(${270 - startDeg} ${ringC} ${ringC})`
        : `rotate(${startDeg - 90} ${ringC} ${ringC})`,
    )
    label.style.fontSize = fontSizePx + 'px'
  }

  /** Per-frame state: arc length, arc colour, label text. */
  const render = (): void => {
    const t = dialFrac()
    const shown = drain ? 1 - t : t
    arc.setAttribute('d', arcPath(ringC, ringR, ringT, shown * TAU, (capRound * ringT) / 2))
    arc.setAttribute('fill', rampColor(stops, t))
    arc.dataset.frac = String(shown)
    arc.style.display = shown > 0.0005 ? '' : 'none'

    if (!showLabel) return
    const remain = labelMs()
    const sec = Math.ceil(remain / 1000)
    if (sec === lastTickSec) return
    // Not the first render (-1) and not the editor's static preview: a real second
    // rolled over, so this is where a per-second sound belongs.
    if (tickSfx && lastTickSec >= 0 && running) ctx.sfx.play('tick')
    lastTickSec = sec
    label.textContent = done && endLabelFmt ? formatRingLabel(endLabelFmt, 0, Date.now(), textCase) : formatRingLabel(labelFmt, remain, Date.now(), textCase)
  }

  const finish = (): void => {
    if (done) return
    done = true
    running = false
    cancelAnimationFrame(raf)
    lastTickSec = -1 // force the final label (and any endLabel) to paint
    render()
    completeCb?.()
  }

  const frame = (): void => {
    if (!running) return
    render()
    if (Date.now() - startedAt >= totalMs) finish()
    else raf = requestAnimationFrame(frame)
  }

  const onTap = (): void => {
    if (running && tapToSkip) finish()
  }

  const layout = (): void => {
    geometry()
    // The ONLY viewport-dependent term, matching header.ts: design-px content under
    // one uniform scale.
    wrap.style.transform = `translate(-50%,-50%) scale(${ctx.scale?.() ?? 1})`
    render()
  }

  return {
    mount(c, params) {
      ctx = c
      totalMs = Math.max(1, Math.min(3600, num(params.seconds, 60))) * 1000
      // Each 0 falls back to the value above it: cap → label start → duration, so
      // leaving both alone gives a plain "N seconds, one full sweep" ring.
      startFromMs = Math.max(0, Math.min(3600, num(params.startSeconds, 0))) * 1000 || totalMs
      capMs = Math.max(0, Math.min(3600, num(params.capSeconds, 0))) * 1000 || startFromMs
      sizeParam = Math.max(0, Math.min(4000, num(params.sizePx, 420)))
      thicknessPx = Math.max(1, Math.min(400, num(params.thicknessPx, 44)))
      trackColor = str(params.trackColor, '#8e86ea')
      stops = [str(params.fillColor, '#171774') || '#171774', str(params.fillColorMid, ''), str(params.fillColorEnd, '')].filter(Boolean)
      drain = str(params.fillMode, 'Fill up') === 'Drain'
      ccw = str(params.direction, 'Clockwise') === 'Counter-clockwise'
      startDeg = Math.max(-360, Math.min(360, num(params.startAngle, 0)))
      capRound = Math.max(0, Math.min(100, num(params.capRoundPct, 100))) / 100
      labelFmt = str(params.label, '{t}s')
      endLabelFmt = str(params.endLabel, '')
      showLabel = params.showLabel !== false
      fontSizePx = Math.max(4, Math.min(800, num(params.fontSizePx, 104)))
      textCase = TEXT_CASE[str(params.textCase, '')] ?? 'none'
      tapToSkip = params.tapToSkip === true
      tickSfx = params.tickSfx === true
      previewFrac = Math.max(0, Math.min(100, num(params.previewPct, 25))) / 100

      wrap = document.createElement('div')
      wrap.style.cssText = 'position:absolute;left:50%;top:50%;transform-origin:center;pointer-events:none;'

      svg = document.createElementNS(SVG_NS, 'svg')
      svg.setAttribute('fill', 'none')
      svg.style.cssText = 'display:block;overflow:visible;'

      track = document.createElementNS(SVG_NS, 'circle')
      track.setAttribute('fill', 'none')
      track.setAttribute('stroke', trackColor || 'none')
      svg.appendChild(track)

      arc = document.createElementNS(SVG_NS, 'path')
      arc.setAttribute('stroke', 'none')
      svg.appendChild(arc)
      wrap.appendChild(svg)

      label = document.createElement('div')
      label.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;' +
        'line-height:1.05;white-space:pre-line;'
      label.style.color = str(params.fontColor, '#171774')
      label.style.fontWeight = String(Math.max(100, Math.min(900, num(params.fontWeight, 800))))
      const family = cssFontFamily(str(params.fontFamily, ''))
      label.style.fontFamily = family || '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
      const ls = num(params.letterSpacingPx, 0)
      if (ls) label.style.letterSpacing = ls + 'px'
      if (!showLabel) label.style.display = 'none'
      wrap.appendChild(label)

      ctx.root.appendChild(wrap)
      layout()
    },
    start() {
      startedAt = Date.now()
      running = true
      lastTickSec = -1
      // Only a skippable ring needs to hear taps; otherwise the widget stays
      // click-through so a CTA underneath keeps working.
      if (tapToSkip) {
        wrap.style.pointerEvents = 'auto'
        ctx.root.addEventListener('pointerdown', onTap)
      }
      render()
      raf = requestAnimationFrame(frame)
    },
    relayout: layout,
    getHint(): HintMove | null {
      // Nothing to do but wait, unless a tap can end it early — then point at the ring.
      if (done || !tapToSkip) return null
      const r = wrap.getBoundingClientRect()
      const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      running = false
      cancelAnimationFrame(raf)
      ctx.root.removeEventListener('pointerdown', onTap)
      ctx.root.innerHTML = ''
    },
  }
}

export const COUNTDOWN_TEMPLATE: GameTemplate = {
  id: 'countdown',
  label: 'Countdown ring (timer that fills with colour)',
  paramFields: [
    { key: 'seconds', label: 'Duration — how long the round runs (seconds)', type: 'number', min: 1, max: 3600, step: 1 },
    { key: 'startSeconds', label: 'Label counts down from (0 = the duration)', type: 'number', min: 0, max: 3600, step: 1 },
    { key: 'capSeconds', label: 'A full circle is worth (seconds, 0 = the label start)', type: 'number', min: 0, max: 3600, step: 1 },
    { key: 'sizePx', label: 'Ring size (design px, 0 = fill the box)', type: 'number', min: 0, max: 4000, step: 10 },
    { key: 'thicknessPx', label: 'Ring thickness (design px)', type: 'number', min: 1, max: 400, step: 1 },
    { key: 'trackColor', label: 'Track colour (none = hidden)', type: 'color' },
    { key: 'fillColor', label: 'Arc colour at the start', type: 'color' },
    { key: 'fillColorMid', label: 'Arc colour halfway (none = skip)', type: 'color' },
    { key: 'fillColorEnd', label: 'Arc colour at zero (none = no shift)', type: 'color' },
    { key: 'fillMode', label: 'Arc', type: 'select', options: ['Fill up', 'Drain'] },
    { key: 'direction', label: 'Direction', type: 'select', options: ['Clockwise', 'Counter-clockwise'] },
    { key: 'startAngle', label: 'Start angle (deg from 12 o’clock)', type: 'number', min: -360, max: 360, step: 5 },
    { key: 'capRoundPct', label: 'Arc end rounding (%, 0 = square, 100 = fully round)', type: 'number', min: 0, max: 100, step: 5 },
    { key: 'showLabel', label: 'Show the label', type: 'boolean' },
    { key: 'label', label: 'Label ({t} secs left, {tt}, {mm}:{ss}, {date}, dddd, MMMM D)', type: 'text' },
    { key: 'endLabel', label: 'Label at zero (empty = keeps counting to 0)', type: 'text' },
    { key: 'fontFamily', label: 'Label font (family or uploaded font id)', type: 'text' },
    { key: 'fontSizePx', label: 'Label size (design px)', type: 'number', min: 4, max: 800, step: 2 },
    { key: 'fontWeight', label: 'Label weight', type: 'number', min: 100, max: 900, step: 100 },
    { key: 'fontColor', label: 'Label colour', type: 'color' },
    { key: 'letterSpacingPx', label: 'Label letter spacing (design px)', type: 'number', min: -40, max: 80, step: 1 },
    { key: 'textCase', label: 'Label case', type: 'select', options: ['As typed', 'UPPERCASE', 'Capitalize Each Word', 'lowercase'] },
    { key: 'tapToSkip', label: 'Tap the ring to finish early', type: 'boolean' },
    { key: 'tickSfx', label: 'Play a "tick" sound each second', type: 'boolean' },
    { key: 'previewPct', label: 'Editor preview fill (%)', type: 'number', min: 0, max: 100, step: 5 },
  ],
  defaultParams: {
    seconds: 60,
    startSeconds: 0,
    capSeconds: 0,
    sizePx: 420,
    thicknessPx: 44,
    trackColor: '#8e86ea',
    fillColor: '#171774',
    fillColorMid: '',
    fillColorEnd: '',
    fillMode: 'Fill up',
    direction: 'Clockwise',
    startAngle: 0,
    capRoundPct: 100,
    showLabel: true,
    label: '{t}s',
    endLabel: '',
    fontFamily: '',
    fontSizePx: 104,
    fontWeight: 800,
    fontColor: '#171774',
    letterSpacingPx: 0,
    textCase: 'As typed',
    tapToSkip: false,
    tickSfx: false,
    previewPct: 25,
  },
  // Nothing to point at while the clock simply runs; a centred tap covers the
  // opt-in "tap to finish early" mode.
  defaultHandguide: { nodes: [{ x: 0.5, y: 0.5 }] },
  create: createCountdown,
}
