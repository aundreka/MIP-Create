// Pinned header that stays at the physical top of the screen (never drifts with
// letterbox reflow). Fixed positioning + transform scale only — no _offY term.

import { scale, viewW } from './responsive'

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
}

interface HeaderHandle {
  relayout(): void
  destroy(): void
}

const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long' })

function formatHeaderDate(d = new Date()): string {
  return `${monthFormatter.format(d).toUpperCase()} ${d.getDate()}, ${d.getFullYear()}`
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
  text.textContent = (opts.prefix ?? '') + formatHeaderDate() + (opts.suffix ?? '')
  band.appendChild(text)

  container.appendChild(band)

  const relayout = (): void => {
    const s = scale() // from responsive.ts — NO _offY term
    band.style.width = (viewW() + 24) / s + 'px'
    band.style.transform = `translateX(-50%) scale(${s})`
  }

  relayout()

  return {
    relayout,
    destroy() {
      band.remove()
    },
  }
}
