// Gradient text fill (TextConfig.gradient). The same stop model a design tool shows —
// a position %, a hex colour and an opacity % per stop, plus an angle — turned into a
// CSS linear-gradient that is clipped to the glyphs. Shared by the runtime renderer
// and the inspector's preview bar, so what the editor shows is exactly what ships.

import type { GradientStop, TextGradient } from '../scene'

/** Default direction: left → right, the way a freshly made linear gradient reads. */
export const GRADIENT_DEFAULT_ANGLE = 90

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** '#rgb' / '#rrggbb' / '#rrggbbaa' (hash optional) → [r, g, b, a 0–1], or null. */
export function parseHex(hex: string): [number, number, number, number] | null {
  let h = String(hex ?? '').trim().replace(/^#/, '')
  if (/^[0-9a-f]{3,4}$/i.test(h)) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null
  const n = (i: number): number => parseInt(h.slice(i, i + 2), 16)
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
}

/** A stop's colour with its opacity folded in. Unparseable colours pass through as-is. */
export function stopColor(stop: GradientStop): string {
  const rgb = parseHex(stop.color)
  if (!rgb) return stop.color
  const a = rgb[3] * clamp(stop.opacity ?? 100, 0, 100) / 100
  return a >= 1 ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${+a.toFixed(3)})`
}

/** Stops ordered by position, positions clamped to 0–100. */
export function sortedStops(stops: GradientStop[]): GradientStop[] {
  return stops.map((s) => ({ ...s, pos: clamp(Number(s.pos) || 0, 0, 100) })).sort((a, b) => a.pos - b.pos)
}

/** The CSS background for a gradient, or null when there is nothing to draw.
 * `angleDeg` overrides the stored angle (the inspector's bar always previews
 * left → right). A single stop is a flat fill. */
export function gradientCss(g: TextGradient | undefined | null, angleDeg?: number): string | null {
  if (!g || !Array.isArray(g.stops) || !g.stops.length) return null
  const stops = sortedStops(g.stops)
  if (stops.length === 1) stops.push({ ...stops[0] })
  const angle = angleDeg ?? g.angleDeg ?? GRADIENT_DEFAULT_ANGLE
  return `linear-gradient(${angle}deg, ${stops.map((s) => `${stopColor(s)} ${s.pos}%`).join(', ')})`
}

/** Split a comma-separated shadow list, ignoring commas inside rgba(...). */
function splitShadows(shadow: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of shadow) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** text-shadow → an equivalent `filter: drop-shadow(...)` chain. A text-shadow paints
 * ABOVE a background clipped to text, so it would bury the gradient; a drop-shadow
 * filter is drawn behind the finished glyphs instead. The syntaxes line up one to one
 * (text-shadow has no spread), so each shadow maps straight across. */
export function shadowAsDropShadow(shadow: string | undefined): string {
  if (!shadow || shadow.trim() === 'none') return ''
  return splitShadows(shadow)
    .map((s) => `drop-shadow(${s})`)
    .join(' ')
}

/** Paint (or clear) the gradient fill on a text node. Called on every text layout, so
 * switching back to a solid colour must undo everything it set. */
export function applyTextGradient(node: HTMLElement, g: TextGradient | undefined, shadow: string | undefined): void {
  const css = gradientCss(g)
  const st = node.style
  if (!css) {
    st.backgroundImage = ''
    st.setProperty('-webkit-background-clip', '')
    st.setProperty('background-clip', '')
    st.setProperty('-webkit-text-fill-color', '')
    st.filter = ''
    return
  }
  st.backgroundImage = css
  st.setProperty('-webkit-background-clip', 'text')
  st.setProperty('background-clip', 'text')
  st.setProperty('-webkit-text-fill-color', 'transparent')
  st.textShadow = ''
  st.filter = shadowAsDropShadow(shadow)
}
