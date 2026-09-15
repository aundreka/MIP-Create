// Progress bar: a meter that other minigames fill, and a win condition in its own
// right.
//
// It is a game mount rather than a decoration for two reasons. First, it has to be
// able to WIN — "fill six of these and the scene is over" is a rule, not a picture,
// and the stage already races every game mount in a scene and lets the first one to
// finish own the redirect (revealOnWin is idempotent). Second, being a mount means it
// gets a box on the canvas, which is where its width, height and position come from —
// including full-screen width, since a game mount goes through the same
// `layoutAsset(…, 'extend')` path the header bar does. There is no bespoke
// full-width mode here; the element's Mode is set to 'extend' and the slot this game
// draws into is already edge to edge.
//
// Everything it renders is its own — the track, the fill, their borders and shadows —
// because a bar is a shape rather than an arrangement of the author's art. That is
// the opposite of the combo/drag-clean model next door, and deliberately so: those
// games position nothing and only drive elements the author placed, whereas nobody
// wants to hand-place six segments and keep them aligned.
//
// What fills it comes in over the progress channel (progresschannel.ts). By default
// it listens to every source in the scene and takes its step count from whatever
// that source says its total is, so wiring a bar to a drag-to-clean board is: place
// the bar. `steps` overrides the count — set it to 4 on a six-obstacle board and the
// bar (and so the scene) finishes two obstacles early.
//
// `fillStyle: 'bars'` draws one separate bar per step — each with its own empty track
// and its own fill sweeping across it — rather than segments inside one shared track.
//
// A scratch card has no steps, only an area; it reports a fraction (`continuous`) of
// the way to its reveal threshold, and the bar fills to exactly that — full at the
// moment the card reveals.
//
// Whatever the bar shows is re-broadcast (emitProgressShown) with its animation
// length, which is what a `{%}` text element counts along with.

import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { num, str } from './types'
import { emitProgressShown, onProgress, PROGRESS_SOURCE_NONE, progressMatches, requestProgress, type ProgressDetail } from './progresschannel'

/** Fold an opacity into a colour so the TRACK can be translucent without dragging
 * the fill sitting inside it down with it (an `opacity` on the track element would).
 * Hex in, rgba out; anything else — rgb(), a named colour — is passed through, which
 * is correct at full strength and the best available guess otherwise. */
function withAlpha(color: string, alpha: number): string {
  if (!color) return ''
  if (alpha >= 1) return color
  const hex = color.trim()
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex)
  if (!m) return color
  let h = m[1]
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  // An 8-digit hex already carries an alpha; the param multiplies it rather than
  // replacing it, so a colour picked with transparency keeps it.
  const own = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return `rgba(${r},${g},${b},${(own * alpha).toFixed(3)})`
}

/** A box-shadow, or '' when every knob is at rest. Sizes are DESIGN px scaled by `s`,
 * so the shadow keeps its proportions on every screen instead of being a fixed blur
 * that reads as heavy on a phone and invisible on a tablet. */
function shadowCss(x: number, y: number, blur: number, spread: number, color: string, inset: boolean, s: number): string {
  if (!color) return ''
  if (x === 0 && y === 0 && blur === 0 && spread === 0) return ''
  return `${inset ? 'inset ' : ''}${(x * s).toFixed(1)}px ${(y * s).toFixed(1)}px ${(blur * s).toFixed(1)}px ${(spread * s).toFixed(1)}px ${color}`
}

/**
 * A corner radius in screen px, capped at half the SHORTER side.
 *
 * The panel offers 999 as "pill", and taken literally that is a 999px radius — which
 * on a bar 40px tall is a pill (the cap does the work) but on a box 1000px tall is a
 * circle. A pill is defined by the shape it is applied to, not by a number, so the
 * cap is what makes the label honest at every box the author might draw.
 */
function radiusPx(design: number, w: number, h: number, s: number): string {
  return Math.max(0, Math.min(design * s, Math.min(w, h) / 2)).toFixed(1) + 'px'
}

/** The fill's paint: a flat colour, or a gradient when a second colour is given. */
function fillPaint(a: string, b: string, angleDeg: number): string {
  if (!a) return 'transparent'
  if (!b) return a
  return `linear-gradient(${angleDeg}deg, ${a}, ${b})`
}

export function createProgressBar(): GameModule {
  let ctx: GameContext
  let track: HTMLDivElement
  let inner: HTMLDivElement
  /** The continuous fill, or null in segmented mode. */
  let fill: HTMLDivElement | null = null
  /** The segments, or empty in continuous mode. */
  let segs: HTMLDivElement[] = []
  /** 'bars' only: each segment's own fill, index-aligned with `segs`. */
  let segFills: HTMLDivElement[] = []

  // ---- logic ----
  /** 0 = however many the source says there are. */
  let stepsParam = 0
  /** What the live source last said its total was; 0 until one speaks. */
  let sourceTotal = 0
  let sourceGameId = ''
  let value = 0
  /** How full the bar is, 0..1 — the truth the continuous fill and `{%}` texts draw.
   * A stepped source keeps it at value / steps; a continuous one (a scratch card)
   * sets it directly and `value` is derived from it for the segments. */
  let frac = 0
  /** The live source reports a fraction rather than steps. */
  let continuous = false
  /** Last % broadcast, so a resize that changes nothing stays quiet. */
  let shownPct = -1

  // ---- visuals ----
  let heightPx = 0
  let widthPct = 100
  let trackColor = '#ffffff'
  let trackOpacity = 0.22
  let trackRadiusPx = 999
  let trackBorderPx = 0
  let trackBorderColor = '#ffffff'
  let trackPadPx = 0
  let trackShadow = ''
  let fillStyle: 'continuous' | 'segmented' | 'bars' = 'continuous'
  let segmentGapPx = 6
  let fillColor = '#3ddc84'
  let fillColor2 = ''
  let fillAngleDeg = 90
  let fillRadiusPx = 999
  let fillBorderPx = 0
  let fillBorderColor = '#ffffff'
  let fillShadow = ''
  let direction: 'ltr' | 'rtl' = 'ltr'
  let fillMs = 420
  let fillEasing = 'cubic-bezier(.34,1.2,.4,1)'
  let popScale = 1.12
  let popMs = 260

  const timers: number[] = []
  let offProgress: (() => void) | null = null
  let shell: HTMLElement | null = null
  let shellPointerEvents = ''
  let rootPointerEvents = ''
  let started = false
  let done = false
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null

  const after = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms))
  }

  const s = (): number => ctx.scale?.() ?? 1

  /** How many steps this bar is counting to. The author's number wins; failing that
   * it is whatever the source says it has, and failing THAT it is 1 — a bar nothing
   * is feeding yet still has to render as an empty bar rather than divide by zero. */
  // A continuous source has no count of its own to lend (its "total" is just 100), so
  // a segmented bar fed by one draws ten segments unless the author says otherwise.
  const steps = (): number => Math.max(1, stepsParam || (continuous ? 10 : sourceTotal) || 1)

  // ---- painting ------------------------------------------------------------
  /** What `inner` currently holds. Tracked explicitly rather than inferred from
   * segs.length, which cannot tell "a continuous fill is already built" apart from
   * "nothing is built yet" — both read as zero segments, and the early-out then
   * skipped building the fill at all, leaving an empty track on screen. */
  let built: { style: 'continuous' | 'segmented' | 'bars'; count: number } | null = null

  /** Rebuild the fill children. Only does work when the shape actually changes — a
   * source announcing its total for the first time, or the style being switched — so
   * the common case repaints nothing. */
  const buildFill = (): void => {
    const want = fillStyle !== 'continuous' ? steps() : 0
    if (built && built.style === fillStyle && built.count === want) return
    built = { style: fillStyle, count: want }
    inner.textContent = ''
    segs = []
    segFills = []
    fill = null
    if (want > 0) {
      for (let i = 0; i < want; i++) {
        const seg = document.createElement('div')
        seg.dataset.progressSeg = String(i + 1)
        seg.style.cssText = 'flex:1 1 0;min-width:0;box-sizing:border-box;transform-origin:center;'
        // Every step is a slot of its own: this node is its empty track, `box` is the
        // padded window inside it, and the fill sweeps across that window.
        seg.style.position = 'relative'
        const box = document.createElement('div')
        box.style.cssText = 'position:absolute;overflow:hidden;box-sizing:border-box;'
        const f = document.createElement('div')
        f.dataset.progressSegFill = String(i + 1)
        f.style.cssText = 'position:absolute;top:0;bottom:0;box-sizing:border-box;width:0;'
        box.appendChild(f)
        seg.appendChild(box)
        segFills.push(f)
        inner.appendChild(seg)
        segs.push(seg)
      }
    } else {
      fill = document.createElement('div')
      fill.dataset.progressFill = '1'
      fill.style.cssText = 'position:absolute;top:0;bottom:0;box-sizing:border-box;transform-origin:center;'
      inner.appendChild(fill)
    }
  }

  /** The shadow params are stored pre-joined at mount as design-px numbers in a
   * `x|y|blur|spread|color|inset` string, so layout can rescale them without
   * carrying six more module variables per shadow. */
  const shadowCssScaled = (packed: string, k: number): string => {
    const [x, y, blur, spread, color, inset] = packed.split('|')
    return shadowCss(Number(x), Number(y), Number(blur), Number(spread), color, inset === '1', k)
  }

  /** Re-apply every size that depends on the stage scale or the slot's box. */
  const layout = (): void => {
    const k = s()
    const boxW = ctx.root.clientWidth || 1
    const boxH = ctx.root.clientHeight || 1
    const h = heightPx > 0 ? heightPx * k : boxH
    const w = boxW * (widthPct / 100)
    track.style.left = ((boxW - w) / 2).toFixed(1) + 'px'
    track.style.top = ((boxH - h) / 2).toFixed(1) + 'px'
    track.style.width = w.toFixed(1) + 'px'
    track.style.height = h.toFixed(1) + 'px'
    // Segmented and bars both draw one slot per step.
    const bars = fillStyle !== 'continuous'
    const trackBg = withAlpha(trackColor, trackOpacity)
    const trackBorder = trackBorderPx > 0 ? `${(trackBorderPx * k).toFixed(1)}px solid ${withAlpha(trackBorderColor, trackOpacity)}` : ''
    const trackShadowPx = trackShadow ? shadowCssScaled(trackShadow, k) : ''
    // One slot per step: the empty-bar look moves onto every segment, and the box around
    // them is only the row they sit in — unclipped, so each bar's own shadow shows.
    track.style.background = bars ? '' : trackBg
    track.style.border = bars ? '' : trackBorder
    track.style.borderRadius = bars ? '' : radiusPx(trackRadiusPx, w, h, k)
    track.style.boxShadow = bars ? '' : trackShadowPx
    track.style.overflow = bars ? 'visible' : 'hidden'
    inner.style.overflow = bars ? 'visible' : 'hidden'

    // Bars carry the padding inside each one instead; the row itself runs edge to edge.
    const pad = bars ? 0 : trackPadPx * k
    // Explicit sides rather than the `inset` shorthand: the oldest WebViews these
    // playables land in do not know it, and a bar that ignores its padding there is
    // a silent visual regression rather than a crash.
    inner.style.left = pad.toFixed(1) + 'px'
    inner.style.right = pad.toFixed(1) + 'px'
    inner.style.top = pad.toFixed(1) + 'px'
    inner.style.bottom = pad.toFixed(1) + 'px'
    inner.style.gap = fillStyle !== 'continuous' ? (segmentGapPx * k).toFixed(1) + 'px' : ''
    inner.style.flexDirection = direction === 'rtl' ? 'row-reverse' : 'row'

    const paint = fillPaint(fillColor, fillColor2, fillAngleDeg)
    const border = fillBorderPx > 0 ? `${(fillBorderPx * k).toFixed(1)}px solid ${fillBorderColor}` : ''
    // The fill sits inside the track's padding, so it is measured against the inner
    // box — otherwise a padded bar's fill would be rounder than the bar around it.
    const radius = radiusPx(fillRadiusPx, Math.max(0, w - pad * 2), Math.max(0, h - pad * 2), k)
    const shadow = fillShadow ? shadowCssScaled(fillShadow, k) : ''
    if (bars) {
      const n = Math.max(1, segs.length)
      const segW = Math.max(0, (w - segmentGapPx * k * (n - 1)) / n)
      const segPad = (trackPadPx * k).toFixed(1) + 'px'
      const segRadius = radiusPx(fillRadiusPx, Math.max(0, segW - trackPadPx * k * 2), Math.max(0, h - trackPadPx * k * 2), k)
      segs.forEach((seg, i) => {
        seg.style.background = trackBg
        seg.style.border = trackBorder
        seg.style.borderRadius = radiusPx(trackRadiusPx, segW, h, k)
        seg.style.boxShadow = trackShadowPx
        const f = segFills[i]
        const box = f?.parentElement
        if (!f || !box) return
        box.style.left = segPad
        box.style.right = segPad
        box.style.top = segPad
        box.style.bottom = segPad
        box.style.borderRadius = segRadius
        f.style.left = direction === 'rtl' ? 'auto' : '0'
        f.style.right = direction === 'rtl' ? '0' : 'auto'
        f.style.background = paint
        f.style.border = border
        f.style.borderRadius = segRadius
        f.style.boxShadow = shadow
      })
    }
    if (fill) {
      fill.style.background = paint
      fill.style.border = border
      fill.style.borderRadius = radius
      fill.style.boxShadow = shadow
      fill.style.left = direction === 'rtl' ? 'auto' : '0'
      fill.style.right = direction === 'rtl' ? '0' : 'auto'
    }
    paintValue(false)
  }

  /** Draw the current value. `animate` false is a resize — snap, so a rotation does
   * not replay the fill sweep in front of the player. */
  const paintValue = (animate: boolean): void => {
    const n = steps()
    const shown = Math.max(0, Math.min(n, value))
    track.dataset.progressValue = String(shown)
    track.dataset.progressTotal = String(n)
    const ms = animate ? fillMs : 0
    const f = Math.max(0, Math.min(1, frac))
    if (fill) {
      fill.style.transition = ms > 0 ? `width ${ms}ms ${fillEasing}` : ''
      fill.style.width = (f * 100).toFixed(3) + '%'
    }
    const pct = Math.round(f * 1000) / 10
    if (pct !== shownPct) {
      shownPct = pct
      emitProgressShown(ctx.root, { barId: ctx.elementId ?? '', pct, ms })
    }
    segFills.forEach((sf, i) => {
      // Every slot fills up across its own empty track. 'bars' follows the fraction, so a
      // continuous source can leave the bar it is crossing part-way full; 'segmented'
      // only ever fills a segment whole, once it is earned.
      const part = fillStyle === 'bars' ? Math.max(0, Math.min(1, f * segFills.length - i)) : i < shown ? 1 : 0
      sf.style.transition = ms > 0 ? `width ${ms}ms ${fillEasing}` : ''
      sf.style.width = (part * 100).toFixed(3) + '%'
    })
  }

  /**
   * The bump a landed step makes. Applied to the segment that just arrived, or to the
   * whole continuous fill, and only when the author has dialled one in.
   *
   * It APPENDS to whatever transition paintValue just wrote rather than replacing it.
   * Replacing would drop `width` (or `opacity`) off the transition list in the same
   * style recalc that set the new value, so the fill would jump to its new length
   * instantly and only the pop would animate — the exact opposite of the intent. A
   * duplicated `scale` entry is fine: the last one in the list wins, which is this one.
   */
  const pop = (): void => {
    if (popScale === 1 || popMs <= 0) return
    const node = fill ?? segs[Math.max(0, Math.min(segs.length - 1, value - 1))]
    if (!node) return
    const half = Math.max(1, Math.round(popMs / 2))
    const base = node.style.transition
    const withScale = (dir: string): string => [base, `scale ${half}ms ${dir}`].filter(Boolean).join(', ')
    node.style.transition = withScale('ease-out')
    node.style.scale = String(popScale)
    after(half, () => {
      node.style.transition = withScale('ease-in')
      node.style.scale = '1'
    })
  }

  const finish = (): void => {
    if (done) return
    done = true
    track.dataset.progressComplete = '1'
    ctx.sfx.play('gameWin')
    winCb?.()
    completeCb?.()
  }

  /** Take an announcement from a source. */
  const receive = (d: ProgressDetail): void => {
    const { gameId, value: next, total } = d
    if (!progressMatches(sourceGameId, gameId, d.to ?? '', ctx.elementId ?? '')) return
    if (!!d.continuous !== continuous) {
      continuous = !!d.continuous
      buildFill()
      layout()
    }
    if (continuous) {
      receiveFraction(total > 0 ? next / total : 0)
      return
    }
    // A source's total is what the bar counts to when the author left `steps` at 0,
    // so a changed total has to rebuild the segments before the value is painted.
    if (total > 0 && total !== sourceTotal) {
      sourceTotal = total
      buildFill()
      layout()
    }
    const clamped = Math.max(0, Math.min(steps(), Math.round(next)))
    if (clamped === value) return
    const gained = clamped > value
    value = clamped
    frac = value / steps()
    paintValue(true)
    if (gained) {
      pop()
      ctx.sfx.play('progressStep')
    }
    if (value >= steps()) after(fillMs, finish)
  }

  /** A continuous source moved. The fill follows the fraction itself; segments light
   * as it crosses them, and only a newly lit segment pops and sounds — a scratch card
   * reports many times a second, and a beat on every report would be noise. */
  const receiveFraction = (raw: number): void => {
    const next = Math.max(0, Math.min(1, raw))
    if (done || Math.abs(next - frac) < 0.001) return
    frac = next
    const lit = Math.floor(frac * steps() + 1e-6)
    const gained = lit > value
    value = lit
    paintValue(true)
    if (gained && fillStyle !== 'continuous') {
      pop()
      ctx.sfx.play('progressStep')
    }
    if (frac >= 1) after(fillMs, finish)
  }

  return {
    mount(c, params) {
      ctx = c
      stepsParam = Math.max(0, Math.round(num(params.steps, 0)))
      sourceGameId = str(params.sourceGameId, '').trim()
      heightPx = Math.max(0, Math.min(400, num(params.heightPx, 0)))
      widthPct = Math.max(1, Math.min(100, num(params.widthPct, 100)))
      trackColor = str(params.trackColor, '#ffffff')
      trackOpacity = Math.max(0, Math.min(1, num(params.trackOpacity, 0.22)))
      trackRadiusPx = Math.max(0, Math.min(999, num(params.trackRadiusPx, 999)))
      trackBorderPx = Math.max(0, Math.min(40, num(params.trackBorderPx, 0)))
      trackBorderColor = str(params.trackBorderColor, '#ffffff')
      trackPadPx = Math.max(0, Math.min(80, num(params.trackPadPx, 0)))
      trackShadow = [
        num(params.trackShadowX, 0),
        num(params.trackShadowY, 0),
        num(params.trackShadowBlur, 0),
        num(params.trackShadowSpread, 0),
        str(params.trackShadowColor, ''),
        params.trackShadowInset === true || params.trackShadowInset === 'true' ? '1' : '0',
      ].join('|')
      const style = str(params.fillStyle, 'continuous')
      fillStyle = style === 'segmented' || style === 'bars' ? style : 'continuous'
      segmentGapPx = Math.max(0, Math.min(80, num(params.segmentGapPx, 6)))
      fillColor = str(params.fillColor, '#3ddc84')
      fillColor2 = str(params.fillColor2, '')
      fillAngleDeg = num(params.fillAngleDeg, 90)
      fillRadiusPx = Math.max(0, Math.min(999, num(params.fillRadiusPx, 999)))
      fillBorderPx = Math.max(0, Math.min(40, num(params.fillBorderPx, 0)))
      fillBorderColor = str(params.fillBorderColor, '#ffffff')
      fillShadow = [
        num(params.fillShadowX, 0),
        num(params.fillShadowY, 0),
        num(params.fillShadowBlur, 0),
        num(params.fillShadowSpread, 0),
        str(params.fillShadowColor, ''),
        params.fillShadowInset === true || params.fillShadowInset === 'true' ? '1' : '0',
      ].join('|')
      direction = str(params.direction, 'ltr') === 'rtl' ? 'rtl' : 'ltr'
      fillMs = Math.max(0, Math.min(3000, num(params.fillMs, 420)))
      fillEasing = str(params.fillEasing, 'cubic-bezier(.34,1.2,.4,1)')
      popScale = Math.max(1, Math.min(2, num(params.popScale, 1.12)))
      popMs = Math.max(0, Math.min(2000, num(params.popMs, 260)))
      // The editor canvas shows the bar part-filled so its colours are judgeable
      // without playing the scene; start() zeroes it for real play.
      frac = 0.5
      value = Math.round(steps() / 2)

      track = document.createElement('div')
      track.dataset.progressBar = '1'
      track.setAttribute('role', 'progressbar')
      // overflow:hidden is what clips the fill to the track's rounded corners. It
      // also clips an OUTER shadow on the fill, so a fill glow should be authored
      // inset; the track's own shadow is unaffected (an element's box-shadow is
      // never clipped by its own overflow).
      track.style.cssText = 'position:absolute;box-sizing:border-box;overflow:hidden;pointer-events:none;'
      inner = document.createElement('div')
      inner.style.cssText = 'position:absolute;display:flex;align-items:stretch;overflow:hidden;'
      track.appendChild(inner)
      ctx.root.appendChild(track)

      // Step the mount out of hit-testing entirely, exactly as the combo board does.
      // A bar is a readout, and a full-width one is a band across the screen that
      // would otherwise swallow every touch meant for the elements behind it — which
      // on a drag-to-clean board is the whole game.
      shell = ctx.root.closest<HTMLElement>('.pa-el')
      shellPointerEvents = shell?.style.pointerEvents ?? ''
      rootPointerEvents = ctx.root.style.pointerEvents
      if (shell) shell.style.pointerEvents = 'none'
      ctx.root.style.pointerEvents = 'none'

      buildFill()
      layout()
    },
    start() {
      if (started) return
      started = true
      value = 0
      frac = 0
      paintValue(false)
      // A decorative bar subscribes to nothing and asks nobody: it never fills, and
      // so — since finish() is only ever reached through receive() — it can never win
      // the scene out from under the mechanic that is actually being played.
      if (sourceGameId === PROGRESS_SOURCE_NONE) return
      offProgress = onProgress(ctx.root, receive)
      // Mounting order is scene order, so a source below this bar in the stack has
      // already announced its total by now. Ask again rather than starting blind.
      requestProgress(ctx.root)
    },
    relayout() {
      layout()
    },
    getHint(): HintMove | null {
      // Nothing to point at: the player advances this bar by playing something else.
      return null
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      for (const t of timers) window.clearTimeout(t)
      timers.length = 0
      offProgress?.()
      offProgress = null
      if (shell) shell.style.pointerEvents = shellPointerEvents
      shell = null
      ctx.root.style.pointerEvents = rootPointerEvents
      ctx.root.innerHTML = ''
      built = null
      segs = []
      segFills = []
      fill = null
      value = 0
      frac = 0
      continuous = false
      shownPct = -1
      sourceTotal = 0
      started = false
      done = false
    },
  }
}

export const PROGRESSBAR_TEMPLATE: GameTemplate = {
  id: 'progressbar',
  label: 'Progress bar',
  paramFields: [
    { key: 'steps', label: 'Steps to win (0 = however many the game feeding it has)', type: 'number', min: 0, max: 100, step: 1, group: 'Progress' },
    { key: 'widthPct', label: 'Width (% of the box)', type: 'number', min: 1, max: 100, step: 1, group: 'Progress' },
    { key: 'heightPx', label: 'Height (0 = fill the box)', type: 'number', min: 0, max: 400, step: 2, group: 'Progress' },
    { key: 'direction', label: 'Fills toward', type: 'select', options: ['ltr', 'rtl'], group: 'Progress' },

    { key: 'trackColor', label: 'Empty bar / empty segment colour', type: 'color', group: 'Empty bar' },
    { key: 'trackOpacity', label: 'Empty bar / empty segment opacity', type: 'number', min: 0, max: 1, step: 0.05, group: 'Empty bar' },
    { key: 'trackRadiusPx', label: 'Corner radius (999 = pill)', type: 'number', min: 0, max: 999, step: 1, group: 'Empty bar' },
    { key: 'trackBorderPx', label: 'Border width', type: 'number', min: 0, max: 40, step: 1, group: 'Empty bar' },
    { key: 'trackBorderColor', label: 'Border colour', type: 'color', group: 'Empty bar', showIf: (p) => Number(p.trackBorderPx ?? 0) > 0 },
    { key: 'trackPadPx', label: 'Gap between bar and fill', type: 'number', min: 0, max: 80, step: 1, group: 'Empty bar' },
    { key: 'trackShadowColor', label: 'Shadow colour (none = no shadow)', type: 'color', group: 'Empty bar' },
    { key: 'trackShadowX', label: 'Shadow x', type: 'number', min: -80, max: 80, step: 1, group: 'Empty bar', showIf: (p) => !!p.trackShadowColor },
    { key: 'trackShadowY', label: 'Shadow y', type: 'number', min: -80, max: 80, step: 1, group: 'Empty bar', showIf: (p) => !!p.trackShadowColor },
    { key: 'trackShadowBlur', label: 'Shadow blur', type: 'number', min: 0, max: 200, step: 1, group: 'Empty bar', showIf: (p) => !!p.trackShadowColor },
    { key: 'trackShadowSpread', label: 'Shadow spread', type: 'number', min: -80, max: 80, step: 1, group: 'Empty bar', showIf: (p) => !!p.trackShadowColor },
    { key: 'trackShadowInset', label: 'Shadow inside the bar', type: 'boolean', group: 'Empty bar', showIf: (p) => !!p.trackShadowColor },

    { key: 'fillStyle', label: 'Fill style (bars = a separate bar per step)', type: 'select', options: ['continuous', 'segmented', 'bars'], group: 'Fill' },
    { key: 'segmentGapPx', label: 'Gap between segments', type: 'number', min: 0, max: 80, step: 1, group: 'Fill', showIf: (p) => p.fillStyle === 'segmented' || p.fillStyle === 'bars' },
    { key: 'fillColor', label: 'Fill colour', type: 'color', group: 'Fill' },
    { key: 'fillColor2', label: 'Fill colour 2 (none = flat)', type: 'color', group: 'Fill' },
    { key: 'fillAngleDeg', label: 'Gradient angle', type: 'number', min: 0, max: 360, step: 5, group: 'Fill', showIf: (p) => !!p.fillColor2 },
    { key: 'fillRadiusPx', label: 'Corner radius (999 = pill)', type: 'number', min: 0, max: 999, step: 1, group: 'Fill' },
    { key: 'fillBorderPx', label: 'Border width', type: 'number', min: 0, max: 40, step: 1, group: 'Fill' },
    { key: 'fillBorderColor', label: 'Border colour', type: 'color', group: 'Fill', showIf: (p) => Number(p.fillBorderPx ?? 0) > 0 },
    { key: 'fillShadowColor', label: 'Shadow colour (none = no shadow)', type: 'color', group: 'Fill' },
    { key: 'fillShadowX', label: 'Shadow x', type: 'number', min: -80, max: 80, step: 1, group: 'Fill', showIf: (p) => !!p.fillShadowColor },
    { key: 'fillShadowY', label: 'Shadow y', type: 'number', min: -80, max: 80, step: 1, group: 'Fill', showIf: (p) => !!p.fillShadowColor },
    { key: 'fillShadowBlur', label: 'Shadow blur', type: 'number', min: 0, max: 200, step: 1, group: 'Fill', showIf: (p) => !!p.fillShadowColor },
    { key: 'fillShadowSpread', label: 'Shadow spread', type: 'number', min: -80, max: 80, step: 1, group: 'Fill', showIf: (p) => !!p.fillShadowColor },
    { key: 'fillShadowInset', label: 'Shadow inside the fill', type: 'boolean', group: 'Fill', showIf: (p) => !!p.fillShadowColor },

    { key: 'fillMs', label: 'Fill animation (ms)', type: 'number', min: 0, max: 3000, step: 20, group: 'Animation' },
    { key: 'fillEasing', label: 'Fill easing (CSS)', type: 'text', group: 'Animation' },
    { key: 'popScale', label: 'Pop on each step (1 = none)', type: 'number', min: 1, max: 2, step: 0.02, group: 'Animation' },
    { key: 'popMs', label: 'Pop length (ms)', type: 'number', min: 0, max: 2000, step: 20, group: 'Animation' },
  ],
  defaultParams: {
    // 0 = count to whatever the game feeding this bar says its total is, so a
    // drag-to-clean board with six obstacles produces a six-step bar untouched.
    steps: 0,
    // '' = listen to every progress source in the scene. Name a game mount's element
    // id to pin this bar to one of them, for a scene with more than one.
    sourceGameId: '',
    widthPct: 100,
    heightPx: 0,
    direction: 'ltr',
    trackColor: '#ffffff',
    trackOpacity: 0.22,
    trackRadiusPx: 999,
    trackBorderPx: 0,
    trackBorderColor: '#ffffff',
    trackPadPx: 0,
    trackShadowColor: '',
    trackShadowX: 0,
    trackShadowY: 0,
    trackShadowBlur: 0,
    trackShadowSpread: 0,
    trackShadowInset: false,
    fillStyle: 'continuous',
    segmentGapPx: 6,
    fillColor: '#3ddc84',
    fillColor2: '',
    fillAngleDeg: 90,
    fillRadiusPx: 999,
    fillBorderPx: 0,
    fillBorderColor: '#ffffff',
    fillShadowColor: '',
    fillShadowX: 0,
    fillShadowY: 0,
    fillShadowBlur: 0,
    fillShadowSpread: 0,
    fillShadowInset: false,
    fillMs: 420,
    fillEasing: 'cubic-bezier(.34,1.2,.4,1)',
    popScale: 1.12,
    popMs: 260,
  },
  // There is nothing to point a hand at — the bar is filled by playing something
  // else — so no handguide is seeded and the coded hint returns null.
  create: createProgressBar,
}
