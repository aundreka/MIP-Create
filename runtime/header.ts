// Pinned header that stays at the physical top of the screen (never drifts with
// letterbox reflow). Fixed positioning + transform scale only — no _offY term.

import { cssFontFamily } from './font'
import { scale, viewW } from './responsive'
import { braceBareTokens, formatTickerIntervalMs, renderCountdownFormat } from './elements/countdown'
import { injectAnimStyles, oneShotAnimationCss } from './anim'
import type { AnimSpec } from './scene'

export interface HeaderConfig {
  bgColor?: string
  color?: string
  heightPx?: number
  fontSizePx?: number
  fontWeight?: number
  fontFamily?: string
  topPaddingPx?: number
  align?: 'left' | 'center' | 'right'
  letterSpacingPx?: number
  prefix?: string
  suffix?: string
  zIndex?: number
  mode?: 'date' | 'countdown'
  countdownTarget?: 'duration' | 'midnight'
  countdownSeconds?: number
  countdownFormat?: string
  dateFormat?: string
  // Case applied to the rendered date/timer (the band's own prefix/suffix are left
  // as typed). Passed straight through to the shared formatter — these used to be
  // dropped here, so the project-level date silently ignored them.
  textCase?: 'none' | 'title' | 'upper' | 'lower'
  dateLocale?: string
  dateStyle?: 'short' | 'long' | 'numeric' | 'monthDay'
  entrance?: AnimSpec
}

interface HeaderHandle {
  relayout(): void
  /** Show/hide the band (per-scene `hideHeader`). Fades after the first call; instant at mount. */
  setVisible(visible: boolean): void
  /** Freeze a live countdown at its current displayed instant for the rest of this playable. */
  freezeCountdown(): void
  destroy(): void
}

const LEGACY_DATE_OPTS: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }
// Keep the pinned header above every runtime overlay tier, including lifted
// overlayTop elements (10050) and redirect cover scenes (11000).
const HEADER_OVERLAY_Z = 20000
const FIRST_INTERACTION_EVENTS = ['pointerdown', 'touchstart', 'mousedown', 'click'] as const

/** Start of the next local day (tonight's 12am). setHours(24,…) rolls the date over
 * through month/year ends and follows the device's own DST rules, so the remaining
 * time is whatever the viewer's clock says is left in the day. */
export function nextMidnight(now: number): number {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

function formatHeaderDate(d = new Date(), locale = 'en-US'): string {
  try {
    return d.toLocaleDateString(locale, LEGACY_DATE_OPTS).toUpperCase()
  } catch {
    return d.toLocaleDateString('en-US', LEGACY_DATE_OPTS).toUpperCase()
  }
}

export function mountHeader(container: HTMLElement, opts: HeaderConfig): HeaderHandle {
  const band = document.createElement('div')
  band.className = 'pa-header'
  const height = opts.heightPx ?? 120
  const align = opts.align ?? 'center'
  const justify = align === 'left' ? 'start' : align === 'right' ? 'end' : 'center'
  // When a top padding is set, top-anchor the text so the gap is measured from the
  // band's top edge; otherwise keep the original vertically-centred behaviour.
  const topPadded = opts.topPaddingPx != null

  // Position:fixed anchors to the physical viewport top (always top:0, never drifts
  // with _offY). Transform scale only — the sole viewport-dependent term is scale().
  band.style.cssText =
    'position:fixed;top:0;left:50%;display:grid;overflow:hidden;' +
    'box-sizing:border-box;line-height:1.15;' +
    'white-space:pre-line;pointer-events:none;transform-origin:top center;'

  band.style.height = height + 'px'
  band.style.zIndex = String(Math.max(opts.zIndex ?? 0, HEADER_OVERLAY_Z))

  // Keep the responsive scale/position on `band` and animate this full-size inner
  // surface instead. That lets transform-based entrances move the whole header
  // (including its background) without fighting relayout's transform.
  const surface = document.createElement('div')
  surface.className = 'pa-header-surface'
  surface.style.cssText = 'width:100%;height:100%;display:grid;box-sizing:border-box;line-height:1.15;white-space:pre-line;'
  surface.style.alignItems = topPadded ? 'start' : 'center'
  surface.style.justifyItems = justify
  surface.style.textAlign = align
  surface.style.padding = (topPadded ? opts.topPaddingPx : 0) + 'px 24px 0'
  if (opts.bgColor) surface.style.backgroundColor = opts.bgColor
  surface.style.color = opts.color ?? '#ffffff'
  surface.style.fontSize = (opts.fontSizePx ?? 64) + 'px'
  surface.style.fontWeight = String(opts.fontWeight ?? 500)
  surface.style.fontFamily = cssFontFamily(opts.fontFamily) || '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
  if (opts.letterSpacingPx) surface.style.letterSpacing = opts.letterSpacingPx + 'px'

  if (opts.entrance) {
    injectAnimStyles()
    surface.style.animation = oneShotAnimationCss(opts.entrance)
  }

  const text = document.createElement('div')
  text.className = 'pa-header-text'
  text.style.whiteSpace = 'pre-line'
  surface.appendChild(text)
  band.appendChild(surface)

  // 'countdown' mode ticks down from countdownSeconds after load — or, with
  // countdownTarget 'midnight', from however much of the viewer's day is left
  // ("only 7 hours left" at 5pm); 'date' (default) renders once. Both wrap the
  // value in the shared prefix/suffix literals.
  let timer = 0
  let removeStartListeners = (): void => {}
  let freezeCountdown = (): void => {}
  if (opts.mode === 'countdown') {
    const midnight = opts.countdownTarget === 'midnight'
    // Hours matter for a to-midnight timer, so its default format carries {hh}
    // — a bare {mm}:{ss} would show "00:00" with 7 hours still on the clock.
    const fmt = opts.countdownFormat || (midnight ? '{hh}:{mm}:{ss}' : '{mm}:{ss}')
    const durationMs = Math.max(0, opts.countdownSeconds ?? 300) * 1000
    const storedDeadline = Number(container.dataset.paCountdownDeadline || 0)
    const storedFrozenAt = Number(container.dataset.paCountdownFrozenAt || 0)
    let frozenAt = storedFrozenAt
    let frozen = storedFrozenAt > 0 && storedDeadline > 0
    let deadline = frozen ? storedDeadline : midnight ? nextMidnight(Date.now()) : storedDeadline
    let started = midnight || storedDeadline > 0
    if (midnight && !frozen) container.dataset.paCountdownDeadline = String(deadline)
    const render = (): void => {
      const now = frozen ? frozenAt : Date.now()
      // Before the first gesture, keep a duration countdown visibly parked at its
      // full authored value. Its real deadline is created only when playback starts.
      const displayDeadline = started ? deadline : now + durationMs
      text.textContent = (opts.prefix ?? '') + renderCountdownFormat(fmt, displayDeadline, now, opts) + (opts.suffix ?? '')
    }
    const intervalMs = formatTickerIntervalMs(fmt)
    const startTicker = (): void => {
      if (frozen || !intervalMs || timer || Date.now() >= deadline) return
      timer = window.setInterval(() => {
        render()
        if (Date.now() >= deadline) {
          window.clearInterval(timer)
          timer = 0
        }
      }, intervalMs)
    }
    const startDurationCountdown = (): void => {
      if (started || frozen) return
      started = true
      deadline = Date.now() + durationMs
      container.dataset.paCountdownDeadline = String(deadline)
      removeStartListeners()
      render()
      startTicker()
    }
    freezeCountdown = (): void => {
      if (frozen) return
      frozenAt = Date.now()
      // An auto-completing game can win before a gesture. In that case the header
      // freezes at its full authored duration instead of inventing elapsed time.
      if (!started) {
        started = true
        deadline = frozenAt + durationMs
      }
      frozen = true
      container.dataset.paCountdownDeadline = String(deadline)
      container.dataset.paCountdownFrozenAt = String(frozenAt)
      removeStartListeners()
      if (timer) {
        window.clearInterval(timer)
        timer = 0
      }
      render()
    }

    render()
    if (midnight) {
      // Midnight is an absolute wall-clock deadline, so it remains live from mount.
      startTicker()
    } else if (started) {
      // Preserve the original deadline across a localized-header remount.
      startTicker()
    } else {
      removeStartListeners = (): void => {
        for (const type of FIRST_INTERACTION_EVENTS) container.removeEventListener(type, startDurationCountdown, true)
      }
      for (const type of FIRST_INTERACTION_EVENTS) container.addEventListener(type, startDurationCountdown, { capture: true, passive: true })
    }
  } else {
    // Custom layouts render today via the shared token formatter (deadline=now
    // makes the date tokens target today); empty keeps the legacy fixed style.
    const now = Date.now()
    const date = opts.dateFormat ? renderCountdownFormat(braceBareTokens(opts.dateFormat), now, now, opts) : formatHeaderDate(new Date(now), opts.dateLocale)
    text.textContent = (opts.prefix ?? '') + date + (opts.suffix ?? '')
  }

  container.appendChild(band)

  const relayout = (): void => {
    const s = scale() // from responsive.ts — NO _offY term
    band.style.width = (viewW() + 24) / s + 'px'
    band.style.transform = `translateX(-50%) scale(${s})`
  }

  relayout()

  // First setVisible applies instantly (a scene that starts with the header hidden must not
  // flash it at load); later calls fade so mid-flow scene changes read as a soft toggle.
  let visInit = false

  return {
    relayout,
    setVisible(visible: boolean) {
      band.style.transition = visInit ? 'opacity 250ms ease' : ''
      band.style.opacity = visible ? '1' : '0'
      visInit = true
    },
    freezeCountdown,
    destroy() {
      removeStartListeners()
      if (timer) window.clearInterval(timer)
      band.remove()
    },
  }
}
