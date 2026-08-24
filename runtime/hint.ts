// DOM hand-guide. Ported in spirit from coinsort's HandHint: animate a hand
// between two SCREEN points (slide) or bounce-tap at a point. Lives above the
// game (appended to the runtime root). Driven by gameHost from getHint().

export type HandKind = 'slide' | 'tap' | 'scratch' | 'hold'

export interface Hand {
  show(from: { x: number; y: number }, to: { x: number; y: number }, kind: HandKind, fit?: number): void
  /** Follow a live DOM target. The resolver is sampled on every animation frame,
   * so a game can retarget the same hand as its next valid target changes. */
  showTarget(resolveTarget: () => HTMLElement | null, kind: HandKind, fit?: number, yRatio?: number): void
  hide(): void
  destroy(): void
}

interface HandPoint {
  x: number
  y: number
}

type PointSource = HandPoint | (() => HandPoint | null)

const HAND_SVG =
  `<svg width="46" height="56" viewBox="0 0 46 56" xmlns="http://www.w3.org/2000/svg">` +
  `<g fill="#ffffff" stroke="#0b1220" stroke-width="1.5" stroke-linejoin="round">` +
  `<path d="M16 3c2.8 0 5 2.2 5 5v16l3-1.5c2-1 4.6-.3 5.7 1.7l.2.4 6.2 3.2c2.6 1.3 3.9 4.3 3.1 7.1l-2.4 8.6c-1 3.6-4.3 6.1-8 6.1H22c-2.8 0-5.4-1.3-7.1-3.5L5.6 35.4c-1.5-2-1.1-4.8.9-6.3 1.7-1.3 4-1.2 5.6.1l2.9 2.4V8c0-2.8 2.2-5 5-5z"/>` +
  `</g></svg>`

// Hand element dimensions (must match the cssText width/height below).
const HAND_W = 46
const HAND_H = 56

// Radial tap ping: concentric rings that spread from the fingertip on contact,
// the way a touch ripples out of the point it lands on. Drawn in its own layer
// under the hand and driven by the same cycle phase, so the first ring is born
// on the dip rather than free-running against it.
const RIPPLE_COUNT = 3
/** Ring radius in px at fit=1 when fully spread. */
const RIPPLE_MAX = 54
const RIPPLE_COLOR = 'rgba(150,130,235,'

interface RippleTiming {
  /** Cycle phase at which the first ring is emitted. */
  start: number
  /** Phase gap between consecutive rings. */
  stagger: number
  /** Phase span each ring takes to spread out and fade away. */
  life: number
}

// Only the stationary gestures ping; a slide/scratch hand is already moving, and
// rings trailing behind it read as smear rather than as touch.
const RIPPLE_TIMING: Partial<Record<HandKind, RippleTiming>> = {
  // tapPress dips from 0 and bottoms out at 0.275 — emit just as it lands.
  tap: { start: 0.16, stagger: 0.13, life: 0.5 },
  // holdPress is down from 0.1 to 0.75: spread the rings across the held stretch
  // so the point keeps pulsing for as long as the finger stays on it.
  hold: { start: 0.08, stagger: 0.2, life: 0.62 },
}

const cubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Screen-space point at which the hand's fingertip should land on an element. */
export function elementHintPoint(target: HTMLElement, yRatio = 0.5): HandPoint {
  const r = target.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height * yRatio }
}

/** Press curve for a tap: dip to the target, lift, then pause before repeating. */
export function tapPress(phase: number): number {
  return phase < 0.55 ? Math.sin((phase / 0.55) * Math.PI) : 0
}

/** Press curve for the press-and-HOLD gesture, as a fraction of one cycle: down
 * over the first 10%, held down to 75%, lifted by 90%, then a beat off the surface
 * before it goes again. A tap's in-and-out dip says "tap here"; staying down is
 * the only thing that says "and keep holding". Shared with the editable handguide
 * element's 'hold' mode (stage.ts) so the coded hand and the placed one move alike. */
export function holdPress(phase: number): number {
  if (phase < 0.1) return cubic(phase / 0.1)
  if (phase < 0.75) return 1
  if (phase < 0.9) return cubic((0.9 - phase) / 0.15)
  return 0
}

/** `imgSrc` swaps the built-in white hand for a custom image (contain-fit in the
 * same box, so show()'s fit/scale math is unchanged). */
export function createHand(root: HTMLElement, imgSrc?: string): Hand {
  const ripple = document.createElement('div')
  ripple.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:199999;display:none;'
  const rings: HTMLElement[] = []
  for (let i = 0; i < RIPPLE_COUNT; i++) {
    const ring = document.createElement('div')
    // box-sizing keeps the ring centred on the fingertip while its border thins
    // out; with the default content-box the growing stroke would drift the circle.
    ring.style.cssText =
      `position:absolute;left:${-RIPPLE_MAX}px;top:${-RIPPLE_MAX}px;width:${RIPPLE_MAX * 2}px;height:${RIPPLE_MAX * 2}px;` +
      `box-sizing:border-box;border-radius:50%;border:3px solid ${RIPPLE_COLOR}.9);` +
      `box-shadow:0 0 12px ${RIPPLE_COLOR}.35),inset 0 0 12px ${RIPPLE_COLOR}.25);` +
      'opacity:0;will-change:transform,opacity;'
    ripple.appendChild(ring)
    rings.push(ring)
  }
  root.appendChild(ripple)

  const el = document.createElement('div')
  el.style.cssText =
    `position:absolute;left:0;top:0;width:${HAND_W}px;height:${HAND_H}px;pointer-events:none;z-index:200000;` +
    'transform-origin:8px 6px;filter:drop-shadow(0 4px 6px rgba(0,0,0,.4));will-change:transform,opacity;display:none;'
  if (imgSrc) el.innerHTML = `<img src="${imgSrc}" style="width:100%;height:100%;object-fit:contain" draggable="false" alt="">`
  else el.innerHTML = HAND_SVG
  root.appendChild(el)

  let raf = 0
  let active = false

  const stop = (): void => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  const hideRipple = (): void => {
    ripple.style.display = 'none'
  }

  /** Paint one frame of the radial ping centred on the fingertip's target. */
  const drawRipple = (point: HandPoint, phase: number, fit: number, timing?: RippleTiming): void => {
    if (!timing) return hideRipple()
    ripple.style.display = 'block'
    ripple.style.transform = `translate(${Math.round(point.x)}px,${Math.round(point.y)}px)`
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i]
      const p = (phase - timing.start - i * timing.stagger) / timing.life
      if (p < 0 || p > 1) {
        ring.style.opacity = '0'
        continue
      }
      // Ease-out radius: a real ring loses speed as it widens. Opacity and stroke
      // both thin with it so the ring dissolves instead of blinking off.
      const spread = 1 - (1 - p) * (1 - p)
      ring.style.transform = `scale(${((0.15 + 0.85 * spread) * fit).toFixed(3)})`
      ring.style.opacity = ((1 - p) * 0.7).toFixed(3)
      ring.style.borderWidth = `${(3 - 2 * spread).toFixed(2)}px`
    }
  }

  const loop = (from: PointSource, to: PointSource, kind: HandKind, t0: number, fit: number): void => {
    const period = kind === 'slide' ? 1500 : kind === 'scratch' ? 600 : kind === 'hold' ? 2000 : 900
    const resolve = (source: PointSource): HandPoint | null => (typeof source === 'function' ? source() : source)
    const frame = (now: number): void => {
      if (!active) return
      const fromPoint = resolve(from)
      const toPoint = from === to ? fromPoint : resolve(to)
      if (!fromPoint || !toPoint) {
        el.style.opacity = '0'
        hideRipple()
        raf = requestAnimationFrame(frame)
        return
      }
      el.style.opacity = '1'
      const phase = ((now - t0) % period) / period // 0..1
      let x = fromPoint.x
      let y = fromPoint.y
      let press = 0
      if (kind === 'slide') {
        // travel 0.15..0.8 of the cycle, pause at ends
        const p = phase < 0.15 ? 0 : phase > 0.85 ? 1 : cubic((phase - 0.15) / 0.7)
        x = fromPoint.x + (toPoint.x - fromPoint.x) * p
        y = fromPoint.y + (toPoint.y - fromPoint.y) * p
        // Ease the press in/out with the travel window instead of snapping (binary
        // 0/1 made the scale pop). Pressed during the slide, lifted at the pauses.
        press = phase < 0.15 ? cubic(phase / 0.15) : phase > 0.85 ? cubic((1 - phase) / 0.15) : 1
      } else if (kind === 'scratch') {
        // Back-and-forth rub: ease to the right, ease back to the left
        const p = phase < 0.5 ? cubic(phase * 2) : cubic((1 - phase) * 2)
        x = fromPoint.x + (toPoint.x - fromPoint.x) * p
        y = fromPoint.y + (toPoint.y - fromPoint.y) * p
        // Press down smoothly, hold while rubbing, lift smoothly — a binary 0/1 press
        // snapped the scale, making the hand pop bigger/smaller instantly. Ease the
        // press in over the first 14% of the cycle and out over the last 14%.
        press = phase < 0.14 ? cubic(phase / 0.14) : phase > 0.86 ? cubic((1 - phase) / 0.14) : 1
      } else if (kind === 'hold') {
        // Same dip as a tap, but it stays down: the hand comes to rest on the point
        // and holds there for most of the cycle.
        press = holdPress(phase)
        x = toPoint.x
        y = toPoint.y - 16 * fit * (1 - press)
      } else {
        // Tap: hover a little above the point and dip DOWN to touch it — an
        // actual tapping motion. (The old scale-only pulse read as "pushing".)
        const dip = tapPress(phase)
        x = toPoint.x
        y = toPoint.y - 16 * fit * (1 - dip)
        press = dip
      }
      drawRipple(toPoint, phase, fit, RIPPLE_TIMING[kind])
      const scale = (1 - press * 0.18) * fit
      if (kind === 'scratch') {
        // Anchor by the hand's CENTER (transform-origin set to center in show()) so the
        // hand sits centered on the cell both axes. The default top-left anchor makes it
        // hang low/right — very visible in short cells (e.g. a 1-column scratch grid),
        // where `fit` also shrinks the hand so it isn't oversized for the cell.
        // Nudge it slightly DOWN: a pointing hand reads as too high when geometrically
        // centered (the finger points up, the visual mass sits in the lower palm).
        const cy = y + HAND_H * 0.22 * fit
        el.style.transform = `translate(${Math.round(x)}px,${Math.round(cy)}px) translate(-50%,-50%) scale(${scale.toFixed(3)})`
      } else {
        el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px) scale(${scale.toFixed(3)})`
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
  }

  return {
    show(from, to, kind, fit = 1) {
      stop()
      active = true
      el.style.display = 'block'
      el.style.opacity = '1'
      // Scratch hands anchor by center (centered on the cell); others point with the
      // fingertip at the target, so keep the top-left/fingertip origin for those.
      el.style.transformOrigin = kind === 'scratch' ? 'center center' : '8px 6px'
      loop(from, to, kind, performance.now(), fit)
    },
    showTarget(resolveTarget, kind, fit = 1, yRatio = 0.5) {
      stop()
      active = true
      el.style.display = 'block'
      el.style.opacity = '0'
      el.style.transformOrigin = kind === 'scratch' ? 'center center' : '8px 6px'
      const point = (): HandPoint | null => {
        const target = resolveTarget()
        return target ? elementHintPoint(target, yRatio) : null
      }
      loop(point, point, kind, performance.now(), fit)
    },
    hide() {
      active = false
      stop()
      el.style.display = 'none'
      hideRipple()
    },
    destroy() {
      active = false
      stop()
      el.remove()
      ripple.remove()
    },
  }
}
