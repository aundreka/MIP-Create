// The fallback keyboard: an A–Z pad the playable draws itself.
//
// A real <input> and the device's own keyboard is the better experience when it
// works — it is the keyboard the player already knows, with their own autocorrect
// and their own language. It does not always work. Some ad SDKs run the creative in
// a webview with input focus suppressed; others let the keyboard up but resize the
// visual viewport under it, which shoves a carefully composed 1080×1920 layout
// halfway off screen. Neither failure is detectable from a capability check, only
// from watching what happens after the player taps.
//
// So nameinput.ts asks for the device keyboard first and starts a short timer. If
// nothing that looks like a keyboard has happened by the time it fires, this pad
// slides up instead — inside the ad, sized to the ad, working identically on every
// network. It writes into exactly the same value as the device keyboard would, so
// everything downstream (the caret, the fit, the name channel) is unaware of which
// one the player got.

import { radiusPx } from './nametext'
import { cssFontFamily } from '../font'

export type KeyLayout = 'QWERTY' | 'ABC'

export interface KeypadStyle {
  layout: KeyLayout
  /** Prepend a 0–9 row. */
  digits: boolean
  /** Backdrop behind the keys. */
  bg: string
  keyColor: string
  keyTextColor: string
  keyRadiusPx: number
  /** Height of the whole pad as a percentage of the stage height. */
  heightPct: number
  /** Gap between keys, in design px. */
  gapPx: number
  fontFamily: string
  doneLabel: string
  spaceLabel: string
}

export interface KeypadCallbacks {
  char(ch: string): void
  backspace(): void
  done(): void
}

export interface Keypad {
  open(): void
  close(): void
  isOpen(): boolean
  /** Re-size to the host box and stage scale. */
  relayout(k: number): void
  destroy(): void
}

const ROWS_QWERTY = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']
// Straight alphabetical, 9/9/8 — the layout to pick when the audience is not
// necessarily a touch-typist (kids' apps, markets where QWERTY isn't the norm).
const ROWS_ABC = ['ABCDEFGHI', 'JKLMNOPQR', 'STUVWXYZ']

/** Above every scene element and the hint hand, below the redirect cover (11000)
 * so a tap-to-install cover still wins when the endcard puts one up. */
const Z = 10500

export function createKeypad(host: HTMLElement, style: KeypadStyle, cb: KeypadCallbacks): Keypad {
  const doc = host.ownerDocument ?? document
  const pad = doc.createElement('div')
  pad.className = 'pa-name-keypad'
  pad.dataset.paKeypad = '1'
  pad.style.cssText =
    'position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;display:none;flex-direction:column;justify-content:flex-end;' +
    'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;'
  pad.style.zIndex = String(Z)

  const rows: HTMLDivElement[] = []
  const keys: { el: HTMLDivElement; wide: number }[] = []
  let open = false

  const makeRow = (): HTMLDivElement => {
    const r = doc.createElement('div')
    r.style.cssText = 'display:flex;flex:1 1 0;min-height:0;align-items:stretch;justify-content:center;'
    pad.appendChild(r)
    rows.push(r)
    return r
  }

  /** One key. `wide` is its share of a row relative to a letter key (space is 5). */
  const makeKey = (row: HTMLDivElement, label: string, wide: number, hit: () => void): void => {
    const el = doc.createElement('div')
    el.textContent = label
    el.style.cssText = 'box-sizing:border-box;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:' + wide + ' 1 0;min-width:0;'
    // pointerdown, not click: the pad has to act on the press (a click waits for the
    // release and, on some webviews, never arrives at all inside a captured gesture).
    // preventDefault keeps the press from blurring the hidden input that holds the
    // value and the selection — losing focus there would put the caret at the end
    // of the string on the next keystroke.
    const press = (e: Event): void => {
      e.preventDefault()
      e.stopPropagation()
      el.style.filter = 'brightness(0.86)'
      hit()
    }
    const release = (): void => {
      el.style.filter = ''
    }
    el.addEventListener('pointerdown', press)
    el.addEventListener('pointerup', release)
    el.addEventListener('pointercancel', release)
    el.addEventListener('pointerleave', release)
    row.appendChild(el)
    keys.push({ el, wide })
  }

  const letterRows = style.layout === 'ABC' ? ROWS_ABC : ROWS_QWERTY
  if (style.digits) {
    const r = makeRow()
    for (const ch of '1234567890') makeKey(r, ch, 1, () => cb.char(ch))
  }
  letterRows.forEach((chars, i) => {
    const r = makeRow()
    for (const ch of chars) makeKey(r, ch, 1, () => cb.char(ch))
    // Backspace rides the last letter row, where a phone keyboard puts it.
    if (i === letterRows.length - 1) makeKey(r, '⌫', 1.6, () => cb.backspace())
  })
  const bottom = makeRow()
  makeKey(bottom, style.spaceLabel, 5, () => cb.char(' '))
  makeKey(bottom, style.doneLabel, 2.2, () => cb.done())

  host.appendChild(pad)

  const relayout = (k: number): void => {
    const hostH = host.clientHeight || 0
    const hostW = host.clientWidth || 0
    const h = Math.max(0, hostH * (style.heightPct / 100))
    pad.style.height = h.toFixed(1) + 'px'
    pad.style.background = style.bg || 'rgba(20,22,30,.94)'
    const gap = Math.max(0, style.gapPx) * k
    pad.style.padding = gap.toFixed(1) + 'px'
    pad.style.gap = gap.toFixed(1) + 'px'
    for (const r of rows) r.style.gap = gap.toFixed(1) + 'px'
    // Key text is sized off the key BOX rather than the stage scale: the pad's height
    // is a percentage of the screen, so its keys are already screen-relative and a
    // design-px font would drift out of them on a short viewport.
    const rowH = rows.length ? (h - gap * (rows.length + 1)) / rows.length : 0
    const colW = hostW / 11
    const fontPx = Math.max(8, Math.min(rowH * 0.44, colW * 0.62))
    const family = cssFontFamily(style.fontFamily)
    for (const key of keys) {
      key.el.style.background = style.keyColor || '#3b3f4c'
      key.el.style.color = style.keyTextColor || '#ffffff'
      key.el.style.borderRadius = radiusPx(style.keyRadiusPx, colW, rowH || 1, k)
      key.el.style.fontSize = fontPx.toFixed(1) + 'px'
      key.el.style.fontFamily = family || 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
      key.el.style.fontWeight = '600'
    }
  }

  return {
    open(): void {
      if (open) return
      open = true
      pad.style.display = 'flex'
    },
    close(): void {
      if (!open) return
      open = false
      pad.style.display = 'none'
    },
    isOpen: () => open,
    relayout,
    destroy(): void {
      pad.remove()
    },
  }
}
