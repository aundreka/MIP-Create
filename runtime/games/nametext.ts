// Shared plumbing for the two name mechanics: the styling both of them expose, and
// the fit that makes a typed string sit inside a box the author drew.
//
// Both templates are meant to feel like a TEXT element that happens to be live, so
// their param lists mirror the text inspector (family, size, weight, spacing, colour,
// stroke, shadow, alignment) plus the background box a text element can carry. Keeping
// the keys identical in both templates is deliberate: a result box is "the input box
// without a caret", and an author who styles one can copy the numbers straight across.
//
// The fit is a TRANSFORM, not a smaller font. Re-measuring at a new font size is a
// loop that never quite converges once letter-spacing and stroke are in play, and a
// stroke that thins as the string grows reads as a different typeface. One scale on
// the line box shrinks every part of the drawing by the same factor, in one pass, and
// the text stays vector-sharp on the way down.

import type { ParamField } from './types'
import { num, str } from './types'
import { cssFontFamily } from '../font'

// ---- small css helpers (design px in, screen px out) ------------------------

/** A corner radius in screen px, capped at half the shorter side so 999 reads as
 * "pill" on any box instead of "circle" on a tall one. */
export function radiusPx(design: number, w: number, h: number, k: number): string {
  return Math.max(0, Math.min(design * k, Math.min(w, h) / 2)).toFixed(1) + 'px'
}

/** A box-shadow from design-px numbers, or '' when it is a no-op. */
export function shadowCss(x: number, y: number, blur: number, spread: number, color: string, k: number): string {
  if (!color || (x === 0 && y === 0 && blur === 0 && spread === 0)) return ''
  return `${(x * k).toFixed(1)}px ${(y * k).toFixed(1)}px ${(blur * k).toFixed(1)}px ${(spread * k).toFixed(1)}px ${color}`
}

// ---- text style -------------------------------------------------------------

export interface TextStyle {
  fontFamily: string
  fontSizePx: number
  fontWeight: number
  letterSpacingPx: number
  lineHeight: number
  color: string
  strokePx: number
  strokeColor: string
  shadowX: number
  shadowY: number
  shadowBlur: number
  shadowColor: string
  align: 'left' | 'center' | 'right'
  transform: TransformMode
  wrap: boolean
}

export type TransformMode = 'as typed' | 'UPPERCASE' | 'lowercase' | 'Capitalized'

/** The text knobs, as inspector fields. `group` titles the block they sit under. */
export function textFields(group: string): ParamField[] {
  return [
    { key: 'fontFamily', group, label: 'Font', type: 'font' },
    { key: 'fontSizePx', group, label: 'Font size', type: 'number', min: 4, max: 400, step: 1 },
    { key: 'fontWeight', group, label: 'Weight', type: 'number', min: 100, max: 900, step: 100 },
    { key: 'letterSpacingPx', group, label: 'Letter spacing', type: 'number', min: -20, max: 40, step: 0.5 },
    { key: 'lineHeight', group, label: 'Line height', type: 'number', min: 0.6, max: 3, step: 0.05 },
    { key: 'color', group, label: 'Colour', type: 'color' },
    { key: 'textTransform', group, label: 'Letter case', type: 'select', options: ['as typed', 'UPPERCASE', 'lowercase', 'Capitalized'] },
    { key: 'align', group, label: 'Align', type: 'select', options: ['left', 'center', 'right'] },
    { key: 'strokePx', group, label: 'Outline width', type: 'number', min: 0, max: 20, step: 0.5 },
    { key: 'strokeColor', group, label: 'Outline colour', type: 'color', showIf: (p) => num(p.strokePx, 0) > 0 },
    { key: 'shadowX', group, label: 'Shadow X', type: 'number', step: 1 },
    { key: 'shadowY', group, label: 'Shadow Y', type: 'number', step: 1 },
    { key: 'shadowBlur', group, label: 'Shadow blur', type: 'number', min: 0, step: 1 },
    { key: 'shadowColor', group, label: 'Shadow colour', type: 'color' },
  ]
}

export const TEXT_DEFAULTS: Record<string, unknown> = {
  fontFamily: '',
  fontSizePx: 44,
  fontWeight: 700,
  letterSpacingPx: 0,
  lineHeight: 1.15,
  color: '#111827',
  textTransform: 'as typed',
  align: 'left',
  strokePx: 0,
  strokeColor: '#000000',
  shadowX: 0,
  shadowY: 0,
  shadowBlur: 0,
  shadowColor: '',
}

export function readTextStyle(p: Record<string, unknown>, fallbackAlign: TextStyle['align'] = 'left'): TextStyle {
  const align = str(p.align, fallbackAlign)
  return {
    fontFamily: str(p.fontFamily, ''),
    fontSizePx: Math.max(1, num(p.fontSizePx, 44)),
    fontWeight: num(p.fontWeight, 700),
    letterSpacingPx: num(p.letterSpacingPx, 0),
    lineHeight: num(p.lineHeight, 1.15),
    color: str(p.color, '#111827'),
    strokePx: Math.max(0, num(p.strokePx, 0)),
    strokeColor: str(p.strokeColor, '#000000'),
    shadowX: num(p.shadowX, 0),
    shadowY: num(p.shadowY, 0),
    shadowBlur: Math.max(0, num(p.shadowBlur, 0)),
    shadowColor: str(p.shadowColor, ''),
    align: align === 'center' || align === 'right' ? align : 'left',
    transform: normalizeTransform(p.textTransform),
    wrap: p.wrap === true,
  }
}

function normalizeTransform(v: unknown): TransformMode {
  const s = str(v, 'as typed')
  return s === 'UPPERCASE' || s === 'lowercase' || s === 'Capitalized' ? s : 'as typed'
}

/**
 * Display casing.
 *
 * Casing is applied at DISPLAY time, never to the stored value: the player types
 * "brownie", the patch shows "BROWNIE" and a headline elsewhere can show "Brownie"
 * off the same keystrokes. Doing it with CSS text-transform would be less code but
 * would also lie to the fit — `scrollWidth` is measured on the transformed glyphs
 * either way, so this only changes where the truth lives, and having the real string
 * in the DOM keeps the caret arithmetic honest.
 */
export function applyCase(value: string, mode: TransformMode): string {
  if (mode === 'UPPERCASE') return value.toUpperCase()
  if (mode === 'lowercase') return value.toLowerCase()
  if (mode === 'Capitalized') return value.replace(/(^|\s)(\S)/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
  return value
}

/** Paint one text style onto a node. `k` is the stage scale — every px in the style
 * is DESIGN px, so the whole label scales as one unit with the rest of the layout. */
export function applyTextStyle(el: HTMLElement, t: TextStyle, k: number): void {
  const family = cssFontFamily(t.fontFamily)
  el.style.fontFamily = family || 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  el.style.fontSize = (t.fontSizePx * k).toFixed(2) + 'px'
  el.style.fontWeight = String(t.fontWeight)
  el.style.letterSpacing = (t.letterSpacingPx * k).toFixed(2) + 'px'
  el.style.lineHeight = String(t.lineHeight)
  el.style.color = t.color
  el.style.textAlign = t.align
  el.style.whiteSpace = t.wrap ? 'pre-wrap' : 'pre'
  el.style.setProperty('-webkit-text-stroke', t.strokePx > 0 ? (t.strokePx * k).toFixed(2) + 'px ' + t.strokeColor : '')
  el.style.textShadow = t.shadowColor ? `${(t.shadowX * k).toFixed(1)}px ${(t.shadowY * k).toFixed(1)}px ${(t.shadowBlur * k).toFixed(1)}px ${t.shadowColor}` : ''
}

// ---- background box ---------------------------------------------------------

export interface BoxStyle {
  color: string
  radiusPx: number
  borderPx: number
  borderColor: string
  padXPx: number
  padYPx: number
  shadowX: number
  shadowY: number
  shadowBlur: number
  shadowSpread: number
  shadowColor: string
}

export function boxFields(group: string): ParamField[] {
  return [
    { key: 'boxColor', group, label: 'Fill (none = transparent)', type: 'color' },
    { key: 'boxRadiusPx', group, label: 'Corner radius', type: 'number', min: 0, max: 999, step: 1 },
    { key: 'boxBorderPx', group, label: 'Border width', type: 'number', min: 0, max: 40, step: 1 },
    { key: 'boxBorderColor', group, label: 'Border colour', type: 'color', showIf: (p) => num(p.boxBorderPx, 0) > 0 },
    { key: 'boxPadXPx', group, label: 'Inset left/right', type: 'number', min: 0, max: 400, step: 2 },
    { key: 'boxPadYPx', group, label: 'Inset top/bottom', type: 'number', min: 0, max: 400, step: 2 },
    { key: 'boxShadowX', group, label: 'Box shadow X', type: 'number', step: 1 },
    { key: 'boxShadowY', group, label: 'Box shadow Y', type: 'number', step: 1 },
    { key: 'boxShadowBlur', group, label: 'Box shadow blur', type: 'number', min: 0, step: 1 },
    { key: 'boxShadowSpread', group, label: 'Box shadow spread', type: 'number', step: 1 },
    { key: 'boxShadowColor', group, label: 'Box shadow colour', type: 'color' },
  ]
}

export const BOX_DEFAULTS: Record<string, unknown> = {
  boxColor: '',
  boxRadiusPx: 0,
  boxBorderPx: 0,
  boxBorderColor: '#000000',
  boxPadXPx: 0,
  boxPadYPx: 0,
  boxShadowX: 0,
  boxShadowY: 0,
  boxShadowBlur: 0,
  boxShadowSpread: 0,
  boxShadowColor: '',
}

export function readBoxStyle(p: Record<string, unknown>): BoxStyle {
  return {
    color: str(p.boxColor, ''),
    radiusPx: Math.max(0, num(p.boxRadiusPx, 0)),
    borderPx: Math.max(0, num(p.boxBorderPx, 0)),
    borderColor: str(p.boxBorderColor, '#000000'),
    padXPx: Math.max(0, num(p.boxPadXPx, 0)),
    padYPx: Math.max(0, num(p.boxPadYPx, 0)),
    shadowX: num(p.boxShadowX, 0),
    shadowY: num(p.boxShadowY, 0),
    shadowBlur: Math.max(0, num(p.boxShadowBlur, 0)),
    shadowSpread: num(p.boxShadowSpread, 0),
    shadowColor: str(p.boxShadowColor, ''),
  }
}

export function applyBoxStyle(el: HTMLElement, b: BoxStyle, w: number, h: number, k: number): void {
  el.style.background = b.color || 'transparent'
  el.style.border = b.borderPx > 0 ? `${(b.borderPx * k).toFixed(1)}px solid ${b.borderColor}` : ''
  el.style.borderRadius = radiusPx(b.radiusPx, w, h, k)
  el.style.boxShadow = shadowCss(b.shadowX, b.shadowY, b.shadowBlur, b.shadowSpread, b.shadowColor, k)
}

// ---- fit --------------------------------------------------------------------

export type FitMode = 'shrink to fit' | 'fill the area' | 'never resize'

/**
 * The four corners of a `w × h` box after skewX then rotate, measured from the box's
 * CENTRE (which is the transform-origin used for a turned label).
 *
 * Order matches the CSS transform list `rotate(θ) skewX(a)`: the skew happens in the
 * box's own frame and the rotation turns the result.
 */
function corners(w: number, h: number, angleDeg: number, skewDeg: number): { x: number; y: number }[] {
  const r = (angleDeg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  // Clamped well clear of ±90°, where tan runs away to infinity and the footprint
  // would be meaningless. The param itself stops at ±60.
  const k = Math.tan((Math.max(-80, Math.min(80, skewDeg)) * Math.PI) / 180)
  const cx = w / 2
  const cy = h / 2
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ].map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const sx = dx + k * dy // skewX
    return { x: cx + sx * cos - dy * sin, y: cy + sx * sin + dy * cos }
  })
}

/** The axis-aligned box a turned/slanted `w × h` label really occupies. */
export function rotatedFootprint(w: number, h: number, angleDeg: number, skewDeg: number): { w: number; h: number } {
  if (!angleDeg && !skewDeg) return { w, h }
  const pts = corners(w, h, angleDeg, skewDeg)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

/**
 * The factor that puts `line` inside a `availW × availH` box.
 *
 * Measured from the line's own layout size (offsetWidth/Height), which a transform
 * does not affect — so this can be called every keystroke without the previous
 * scale feeding back into the next measurement. A zero measurement means the node
 * is not laid out yet (jsdom, or a scene built off-screen); returning 1 leaves the
 * authored size alone rather than collapsing the text to nothing on a measurement
 * that never happened.
 *
 * The fit is against the label's ROTATED footprint, not its upright box. A name set
 * at an angle occupies a wider and taller rectangle than the same name straight, and
 * measuring the upright box would let a long one run past the edges of the area — the
 * one thing an author sizing an area is trying to prevent.
 */
export function fitScale(line: HTMLElement, availW: number, availH: number, mode: FitMode, minPct: number, maxPct: number, angleDeg = 0, skewDeg = 0): number {
  if (mode === 'never resize') return 1
  const w = line.offsetWidth || line.scrollWidth
  const h = line.offsetHeight || line.scrollHeight
  if (!w || !h || availW <= 0 || availH <= 0) return 1
  const box = rotatedFootprint(w, h, angleDeg, skewDeg)
  const raw = Math.min(availW / box.w, availH / box.h)
  const capped = mode === 'fill the area' ? raw : Math.min(1, raw)
  return Math.max(minPct / 100, Math.min(maxPct / 100, capped))
}

/**
 * How far to nudge a turned label so its real footprint sits against the edge the
 * author aligned it to.
 *
 * Rotating about the centre leaves the label's LAYOUT box where flex put it while its
 * visible corners swing outside — so a left-aligned tilted name starts left of the
 * inset even though it fits. This measures the scaled footprint against the layout box
 * and returns the translate that lines the two up.
 */
export function fitOffset(
  w: number,
  h: number,
  scale: number,
  angleDeg: number,
  skewDeg: number,
  align: 'left' | 'center' | 'right',
  vAlign: 'top' | 'middle' | 'bottom',
): { dx: number; dy: number } {
  if ((!angleDeg && !skewDeg) || !w || !h) return { dx: 0, dy: 0 }
  const cx = w / 2
  const cy = h / 2
  const pts = corners(w, h, angleDeg, skewDeg).map((p) => ({ x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale }))
  const minX = Math.min(...pts.map((p) => p.x))
  const maxX = Math.max(...pts.map((p) => p.x))
  const minY = Math.min(...pts.map((p) => p.y))
  const maxY = Math.max(...pts.map((p) => p.y))
  return {
    dx: align === 'left' ? -minX : align === 'right' ? w - maxX : cx - (minX + maxX) / 2,
    dy: vAlign === 'top' ? -minY : vAlign === 'bottom' ? h - maxY : cy - (minY + maxY) / 2,
  }
}

// ---- caret ------------------------------------------------------------------

const CARET_CSS_ID = 'pa-name-css'

/**
 * The blink keyframes, injected once per document.
 *
 * A hard on/off at the halfway point rather than a fade: that is what a native text
 * caret does, and a caret that fades reads as a decoration rather than as the thing
 * the OS put there. Kept in a stylesheet instead of a JS interval so it costs nothing
 * per frame and pauses with the tab.
 */
export function ensureCaretCss(doc: Document): void {
  if (doc.getElementById(CARET_CSS_ID)) return
  const style = doc.createElement('style')
  style.id = CARET_CSS_ID
  style.textContent = '@keyframes pa-name-blink{0%,49%{opacity:1}50%,100%{opacity:0}}'
  doc.head.appendChild(style)
}
