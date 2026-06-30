// DOM hand-guide. Ported in spirit from coinsort's HandHint: animate a hand
// between two SCREEN points (slide) or bounce-tap at a point. Lives above the
// game (appended to the runtime root). Driven by gameHost from getHint().

export interface Hand {
  show(from: { x: number; y: number }, to: { x: number; y: number }, kind: 'slide' | 'tap' | 'scratch', fit?: number): void
  hide(): void
  destroy(): void
}

const HAND_SVG =
  `<svg width="46" height="56" viewBox="0 0 46 56" xmlns="http://www.w3.org/2000/svg">` +
  `<g fill="#ffffff" stroke="#0b1220" stroke-width="1.5" stroke-linejoin="round">` +
  `<path d="M16 3c2.8 0 5 2.2 5 5v16l3-1.5c2-1 4.6-.3 5.7 1.7l.2.4 6.2 3.2c2.6 1.3 3.9 4.3 3.1 7.1l-2.4 8.6c-1 3.6-4.3 6.1-8 6.1H22c-2.8 0-5.4-1.3-7.1-3.5L5.6 35.4c-1.5-2-1.1-4.8.9-6.3 1.7-1.3 4-1.2 5.6.1l2.9 2.4V8c0-2.8 2.2-5 5-5z"/>` +
  `</g></svg>`

// Hand element dimensions (must match the cssText width/height below).
const HAND_W = 46
const HAND_H = 56

const cubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export function createHand(root: HTMLElement): Hand {
  const el = document.createElement('div')
  el.style.cssText =
    `position:absolute;left:0;top:0;width:${HAND_W}px;height:${HAND_H}px;pointer-events:none;z-index:200000;` +
    'transform-origin:8px 6px;filter:drop-shadow(0 4px 6px rgba(0,0,0,.4));will-change:transform,opacity;display:none;'
  el.innerHTML = HAND_SVG
  root.appendChild(el)

  let raf = 0
  let active = false

  const stop = (): void => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  const loop = (from: { x: number; y: number }, to: { x: number; y: number }, kind: 'slide' | 'tap' | 'scratch', t0: number, fit: number): void => {
    const period = kind === 'slide' ? 1500 : kind === 'scratch' ? 600 : 900
    const frame = (now: number): void => {
      if (!active) return
      const phase = ((now - t0) % period) / period // 0..1
      let x = from.x
      let y = from.y
      let press = 0
      if (kind === 'slide') {
        // travel 0.15..0.8 of the cycle, pause at ends
        const p = phase < 0.15 ? 0 : phase > 0.85 ? 1 : cubic((phase - 0.15) / 0.7)
        x = from.x + (to.x - from.x) * p
        y = from.y + (to.y - from.y) * p
        // Ease the press in/out with the travel window instead of snapping (binary
        // 0/1 made the scale pop). Pressed during the slide, lifted at the pauses.
        press = phase < 0.15 ? cubic(phase / 0.15) : phase > 0.85 ? cubic((1 - phase) / 0.15) : 1
      } else if (kind === 'scratch') {
        // Back-and-forth rub: ease to the right, ease back to the left
        const p = phase < 0.5 ? cubic(phase * 2) : cubic((1 - phase) * 2)
        x = from.x + (to.x - from.x) * p
        y = from.y + (to.y - from.y) * p
        // Press down smoothly, hold while rubbing, lift smoothly — a binary 0/1 press
        // snapped the scale, making the hand pop bigger/smaller instantly. Ease the
        // press in over the first 14% of the cycle and out over the last 14%.
        press = phase < 0.14 ? cubic(phase / 0.14) : phase > 0.86 ? cubic((1 - phase) / 0.14) : 1
      } else {
        x = to.x
        y = to.y
        press = phase < 0.5 ? Math.sin(phase * Math.PI) : 0
      }
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
    hide() {
      active = false
      stop()
      el.style.display = 'none'
    },
    destroy() {
      active = false
      stop()
      el.remove()
    },
  }
}
