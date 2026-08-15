// Behaviour test for the Countdown ring: the arc sweeps as time passes and its
// colour walks the configured stops, the label counts total seconds remaining,
// the game completes when the clock hits zero, and the whole widget scales by the
// stage scale alone — the same rule the pinned dynamic-date header follows.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { arcPath, createCountdown, formatRingLabel, rampColor } from './countdown'
import { mulberry32, type GameContext } from './types'

function makeRing(params: Record<string, unknown> = {}, scale = 1) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const played: string[] = []
  const ctx: GameContext = {
    root,
    assets: { src: () => '' },
    sfx: { play: (e) => played.push(e) },
    rng: mulberry32(7),
    scale: () => scale,
  }
  const mod = createCountdown()
  mod.mount(ctx, params)
  let done = false
  mod.onComplete(() => (done = true))
  const wrap = root.firstElementChild as HTMLDivElement
  return {
    mod,
    root,
    played,
    wrap,
    label: wrap.querySelector('div') as HTMLDivElement,
    arc: wrap.querySelector('path') as SVGPathElement,
    track: wrap.querySelector('circle') as SVGCircleElement,
    completed: () => done,
  }
}

/** Fraction of the ring the arc currently paints. */
const arcFrac = (arc: SVGPathElement): number => Number(arc.dataset.frac)

describe('countdown ring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:00:00Z'))
    // jsdom never fires rAF under fake timers — drive it off the timer queue.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('draws the ring in design px under a single stage-scale transform', () => {
    const r = makeRing({ sizePx: 400, thicknessPx: 40, fontSizePx: 100 }, 0.5)
    // Geometry stays in DESIGN px …
    expect(r.wrap.style.width).toBe('400px')
    expect(r.track.getAttribute('r')).toBe('180') // (400 - 40) / 2
    expect(r.track.getAttribute('stroke-width')).toBe('40')
    expect(r.label.style.fontSize).toBe('100px')
    // … and the ONLY viewport-dependent term is the scale, as in header.ts.
    expect(r.wrap.style.transform).toBe('translate(-50%,-50%) scale(0.5)')
  })

  it('rescales on relayout without redrawing in screen px', () => {
    const r = makeRing({ sizePx: 300 }, 1)
    ;(r.mod as unknown as { relayout(): void }).relayout()
    expect(r.wrap.style.width).toBe('300px')
    expect(r.wrap.style.transform).toBe('translate(-50%,-50%) scale(1)')
  })

  it('sweeps the arc and counts the seconds down, then completes at zero', () => {
    const r = makeRing({ seconds: 60, label: '{t}s' })
    r.mod.start()
    expect(r.label.textContent).toBe('60s')
    expect(arcFrac(r.arc)).toBeCloseTo(0, 3)

    vi.advanceTimersByTime(4000)
    expect(r.label.textContent).toBe('56s')
    expect(arcFrac(r.arc)).toBeCloseTo(4 / 60, 2)
    expect(r.completed()).toBe(false)

    vi.advanceTimersByTime(56_000)
    expect(r.completed()).toBe(true)
    expect(r.label.textContent).toBe('0s')
    expect(arcFrac(r.arc)).toBeCloseTo(1, 3)
  })

  it('counts the label down from its own start number over a shorter round', () => {
    // 10 seconds of play, but the copy reads 60s → 50s.
    const r = makeRing({ seconds: 10, startSeconds: 60 })
    r.mod.start()
    expect(r.label.textContent).toBe('60s')

    // Real-time drain: 4s of play spends 4s of label, not 4/10ths of the range …
    vi.advanceTimersByTime(4016)
    expect(r.label.textContent).toBe('56s')
    // … and the arc follows the label onto its 60-second dial, so it has moved
    // 4/60ths of a turn — it does NOT sweep the whole circle in the 10s round.
    expect(arcFrac(r.arc)).toBeCloseTo(4 / 60, 2)

    vi.advanceTimersByTime(6000)
    expect(r.completed()).toBe(true)
    expect(r.label.textContent).toBe('50s')
    expect(arcFrac(r.arc)).toBeCloseTo(10 / 60, 2)
  })

  it('sizes the arc against its own cap, so a 4s round can wear a 60s dial', () => {
    // The worked example: 4s of play, label starts at 54, a full circle is 60s.
    const r = makeRing({ seconds: 4, startSeconds: 54, capSeconds: 60 })
    r.mod.start()
    expect(r.label.textContent).toBe('54s')
    expect(arcFrac(r.arc)).toBeCloseTo(6 / 60, 3) // 54 of 60 left → 10% covered

    vi.advanceTimersByTime(2016)
    expect(r.label.textContent).toBe('52s')
    expect(arcFrac(r.arc)).toBeCloseTo(8 / 60, 2)

    vi.advanceTimersByTime(2000)
    expect(r.completed()).toBe(true)
    expect(r.label.textContent).toBe('50s')
    // Ends a sixth of the way round — nowhere near a full sweep.
    expect(arcFrac(r.arc)).toBeCloseTo(10 / 60, 2)
  })

  it('shifts the arc colour through the stops as time passes', () => {
    const r = makeRing({ seconds: 100, fillColor: '#000000', fillColorEnd: '#ffffff' })
    r.mod.start()
    vi.advanceTimersByTime(50_000)
    expect(r.arc.getAttribute('fill')).toBe('rgb(128,128,128)')
  })

  it('drains instead of filling when asked, and honours the countdown tokens', () => {
    const r = makeRing({ seconds: 90, fillMode: 'Drain', label: '{mm}:{ss}' })
    r.mod.start()
    expect(r.label.textContent).toBe('01:30')
    expect(arcFrac(r.arc)).toBeCloseTo(1, 3)
    // One extra frame past the halfway mark: the label is painted on rAF, so it
    // lags the wall clock by up to a frame and would still read 00:46 at exactly 45s.
    vi.advanceTimersByTime(45_016)
    expect(arcFrac(r.arc)).toBeCloseTo(0.5, 2)
    expect(r.label.textContent).toBe('00:45')
  })

  it('shows the end label and swaps the sweep direction', () => {
    const r = makeRing({ seconds: 2, endLabel: "TIME'S UP", direction: 'Counter-clockwise' })
    expect(r.arc.getAttribute('transform')).toContain('scale(-1 1)')
    r.mod.start()
    vi.advanceTimersByTime(2100)
    expect(r.completed()).toBe(true)
    expect(r.label.textContent).toBe("TIME'S UP")
  })

  it('stays click-through unless tap-to-skip is on, which finishes early', () => {
    const plain = makeRing({ seconds: 30 })
    plain.mod.start()
    expect(plain.wrap.style.pointerEvents).toBe('none')
    expect(plain.mod.getHint()).toBeNull()

    const skip = makeRing({ seconds: 30, tapToSkip: true })
    skip.mod.start()
    expect(skip.wrap.style.pointerEvents).toBe('auto')
    expect(skip.mod.getHint()?.kind).toBe('tap')
    skip.root.dispatchEvent(new Event('pointerdown'))
    expect(skip.completed()).toBe(true)
  })

  it('renders a partly-filled preview before start so colours are judgeable in the editor', () => {
    const r = makeRing({ seconds: 60, previewPct: 40 })
    expect(arcFrac(r.arc)).toBeCloseTo(0.4, 3)
    expect(r.label.textContent).toBe('36s')
  })
})

describe('countdown ring helpers', () => {
  it('walks a colour ramp evenly across the stops', () => {
    expect(rampColor(['#ff0000'], 0.7)).toBe('#ff0000')
    expect(rampColor(['#000000', '#ffffff'], 0.25)).toBe('rgb(64,64,64)')
    expect(rampColor(['#000000', '#ff0000', '#ffffff'], 0.5)).toBe('rgb(255,0,0)')
    // Non-hex colours can't be mixed — the nearer stop is used verbatim.
    expect(rampColor(['red', 'blue'], 0.2)).toBe('red')
  })

  // The arc is a filled annular sector so its corners can be filleted by any
  // amount; the flat end face is the `L` between the outer and inner fillets, and
  // how much of the thickness that face still spans IS the rounding.
  const face = (d: string, c = 200): number => {
    const m = /([-\d.]+) ([-\d.]+) L ([-\d.]+) ([-\d.]+)/.exec(d)
    if (!m) throw new Error('no end face in ' + d)
    return Math.hypot(+m[1] - c, +m[2] - c) - Math.hypot(+m[3] - c, +m[4] - c)
  }

  it('rounds the arc corners by any amount, keeping the end face flat', () => {
    // 400px ring, 40px thick: mid radius 180, so the end face is 40px when square.
    const at = (k: number) => arcPath(200, 180, 40, Math.PI / 2, k)
    expect(face(at(0))).toBeCloseTo(40, 3) // square — a butt cap
    expect(face(at(10))).toBeCloseTo(20, 1) // half rounded: half the face still flat
    expect(face(at(20))).toBeCloseTo(0, 2) // fully round — the face closes to a point
    // A square end starts flush with the top of the ring; rounding pulls it in.
    expect(at(0).startsWith('M 200.000 0.000')).toBe(true)
    expect(at(0)).toContain('A 200 200 0 0 1')
  })

  it('holds the same rounding at every point of the sweep', () => {
    // The rounding is the author's setting, not a function of the clock: only a
    // sweep genuinely too short to hold the fillet may shrink it. Regression —
    // the fit limit used sin(span/2), which turns back down past a half turn and
    // squared off a nearly FULL ring, so a drain ring visibly un-rounded itself
    // over its first seconds.
    // From the narrowest sweep that can still seat a full 20px fillet (~0.21 rad;
    // below that it legitimately shrinks — see the sliver case) up to a full turn.
    for (let sp = 0.25; sp < Math.PI * 2 - 0.01; sp += 0.05) {
      expect(face(arcPath(200, 180, 40, sp, 20))).toBeCloseTo(0, 2)
      expect(face(arcPath(200, 180, 40, sp, 10))).toBeCloseTo(20, 1)
    }
  })

  it('never folds the fillets back through a sliver of an arc', () => {
    // Half a degree of sweep can't hold a 20px fillet — the radius shrinks to fit
    // rather than producing a self-crossing shape.
    const d = arcPath(200, 180, 40, 0.02, 20)
    expect(d).not.toContain('NaN')
    expect(face(d)).toBeGreaterThan(0)
  })

  it('draws a full turn as two opposed circles, with no ends to round', () => {
    const d = arcPath(200, 180, 40, Math.PI * 2, 20)
    expect(d).not.toContain('L')
    expect(d.match(/M /g)).toHaveLength(2) // outer clockwise, inner counter — a hole
  })

  it('formats {t} as the TOTAL seconds left, agreeing with {mm}:{ss}', () => {
    const now = Date.parse('2026-08-12T10:00:00Z')
    expect(formatRingLabel('{t}s', 90_000, now, 'none')).toBe('90s')
    expect(formatRingLabel('{tt}', 5_000, now, 'none')).toBe('05')
    expect(formatRingLabel('{mm}:{ss}', 90_000, now, 'none')).toBe('01:30')
    // A partial second rounds up on BOTH tokens, so they never disagree by one.
    expect(formatRingLabel('{t} / {mm}:{ss}', 89_400, now, 'none')).toBe('90 / 01:30')
    expect(formatRingLabel('only {t} left', 3_000, now, 'upper')).toBe('ONLY 3 LEFT')
  })
})
