// Pinned header that stays at the physical top of the screen (never drifts with
// letterbox reflow). Fixed positioning + transform scale only — no _offY term.

import { scale, viewW } from './responsive'
import { formatTicks, renderCountdownFormat } from './elements/countdown'

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
  countdownSeconds?: number
  countdownFormat?: string
  dateFormat?: string
}

interface HeaderHandle {
  relayout(): void
  /** Show/hide the band (per-scene `hideHeader`). Fades after the first call; instant at mount. */
  setVisible(visible: boolean): void
  destroy(): void
}

const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long' })

function formatHeaderDate(d = new Date()): string {
  return `${monthFormatter.format(d).toUpperCase()} ${d.getDate()}, ${d.getFullYear()}`
}

// Date-format fields accept bare tokens ("MMMM D, YYYY") for convenience; the
// shared countdown formatter only knows {braced} ones. Wrap bare standalone
// tokens in braces, leaving anything already braced untouched.
function braceBareTokens(fmt: string): string {
  return fmt.replace(/\{[^}]*\}|\b(MMMM|MMM|MM|M|DD|D|YYYY|YY)\b/g, (match, bare: string | undefined) => (bare ? `{${bare}}` : match))
}

export function mountHeader(container: HTMLElement, opts: HeaderConfig): HeaderHandle {
  const band = document.createElement('div')
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

  band.style.alignItems = topPadded ? 'start' : 'center'
  band.style.justifyItems = justify
  band.style.textAlign = align
  band.style.padding = (topPadded ? opts.topPaddingPx : 0) + 'px 24px 0'
  band.style.height = height + 'px'
  band.style.zIndex = String(opts.zIndex ?? 9999)
  if (opts.bgColor) band.style.backgroundColor = opts.bgColor
  band.style.color = opts.color ?? '#ffffff'
  band.style.fontSize = (opts.fontSizePx ?? 64) + 'px'
  band.style.fontWeight = String(opts.fontWeight ?? 500)
  band.style.fontFamily = opts.fontFamily || '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
  if (opts.letterSpacingPx) band.style.letterSpacing = opts.letterSpacingPx + 'px'

  const text = document.createElement('div')
  text.style.whiteSpace = 'pre-line'
  band.appendChild(text)

  // 'countdown' mode ticks down from countdownSeconds after load; 'date' (default)
  // renders once. Both wrap the value in the shared prefix/suffix literals.
  let timer = 0
  if (opts.mode === 'countdown') {
    const fmt = opts.countdownFormat || '{mm}:{ss}'
    const deadline = Date.now() + Math.max(0, opts.countdownSeconds ?? 300) * 1000
    const render = (): void => {
      text.textContent = (opts.prefix ?? '') + renderCountdownFormat(fmt, deadline, Date.now()) + (opts.suffix ?? '')
    }
    render()
    if (formatTicks(fmt)) {
      timer = window.setInterval(() => {
        render()
        if (Date.now() >= deadline) window.clearInterval(timer)
      }, 1000)
    }
  } else {
    // Custom layouts render today via the shared token formatter (deadline=now
    // makes the date tokens target today); empty keeps the legacy fixed style.
    const now = Date.now()
    const date = opts.dateFormat ? renderCountdownFormat(braceBareTokens(opts.dateFormat), now, now) : formatHeaderDate()
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
    destroy() {
      if (timer) window.clearInterval(timer)
      band.remove()
    },
  }
}
