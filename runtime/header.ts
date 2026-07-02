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

  // Position:fixed anchors to the physical viewport top (always top:0, never drifts
  // with _offY). Transform scale only — the sole viewport-dependent term is scale().
  band.style.cssText =
    'position:fixed;top:0;left:50%;display:grid;place-items:center;overflow:hidden;' +
    'box-sizing:border-box;padding:0 24px;line-height:1.15;text-align:center;' +
    'white-space:pre-line;pointer-events:none;transform-origin:top center;'

  band.style.height = height + 'px'
  band.style.zIndex = String(opts.heightPx ?? 9999)
  if (opts.bgColor) band.style.backgroundColor = opts.bgColor
  band.style.color = opts.color ?? '#ffffff'
  band.style.fontSize = (opts.fontSizePx ?? 64) + 'px'
  band.style.fontWeight = String(opts.fontWeight ?? 500)
  band.style.fontFamily = opts.fontFamily || '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'

  const text = document.createElement('div')
  text.style.whiteSpace = 'pre-line'
  text.textContent = formatHeaderDate()
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
