// Coded-SVG asset generators for the MIP generator. Everything is procedural and
// themed by a brand palette, so a generated MIP ships tiny, crisp, fully-editable
// assets (no external image API). Each generator returns a data:image/svg+xml URL
// plus its intrinsic size. The user supplies the real logo + product images; these
// fill in the surrounding design (background, cards/tiles, badges).

export interface Theme {
  primary: string
  secondary: string
  accent: string
  ink: string
  bg1: string
  bg2: string
}

// ---- tiny color helpers ----------------------------------------------------
const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6)
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0]
}
export const rgbToHex = (r: number, g: number, b: number): string => '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}
export const lighten = (hex: string, t: number): string => mix(hex, '#ffffff', t)
export const darken = (hex: string, t: number): string => mix(hex, '#000000', t)
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** Black or white text that reads on the given fill. */
export const idealInk = (bg: string): string => (luminance(bg) > 0.55 ? '#15203a' : '#ffffff')

export const DEFAULT_THEME: Theme = { primary: '#6c4cf0', secondary: '#22b3a4', accent: '#ffc83d', ink: '#15203a', bg1: '#efeaff', bg2: '#dcd2ff' }

/** Build a full theme from one or more brand colors (e.g. extracted from a logo). */
export function themeFromColors(colors: string[]): Theme {
  const c = colors.filter(Boolean)
  if (!c.length) return DEFAULT_THEME
  const primary = c[0]
  const secondary = c[1] ?? mix(primary, '#000000', 0.25)
  const accent = c[2] ?? (luminance(primary) > 0.6 ? darken(primary, 0.3) : lighten(primary, 0.4))
  return { primary, secondary, accent, ink: idealInk(lighten(primary, 0.85)), bg1: lighten(primary, 0.86), bg2: lighten(secondary, 0.72) }
}

const url = (svg: string): string => 'data:image/svg+xml,' + encodeURIComponent(svg.replace(/\s{2,}/g, ' ').trim())
const SVG = (w: number, h: number, body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

export interface GenAsset {
  src: string
  w: number
  h: number
}

// ---- generators ------------------------------------------------------------
export type BgStyle = 'gradient' | 'pattern' | 'rays' | 'solid'

export function svgBackground(theme: Theme, style: BgStyle, w: number, h: number): GenAsset {
  const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.bg1}"/><stop offset="1" stop-color="${theme.bg2}"/></linearGradient><radialGradient id="r" cx="50%" cy="32%" r="75%"><stop offset="0" stop-color="${lighten(theme.primary, 0.55)}"/><stop offset="1" stop-color="${theme.bg2}"/></radialGradient></defs>`
  let overlay = ''
  if (style === 'pattern') {
    overlay = `<defs><pattern id="p" width="${Math.round(w / 9)}" height="${Math.round(w / 9)}" patternUnits="userSpaceOnUse"><circle cx="${Math.round(w / 18)}" cy="${Math.round(w / 18)}" r="${Math.round(w / 80)}" fill="${theme.primary}" opacity="0.10"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#p)"/>`
  } else if (style === 'rays') {
    const cx = w / 2
    const cy = h * 0.34
    const rays = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2
      const a2 = a + 0.18
      const R = Math.hypot(w, h)
      return `<path d="M${cx} ${cy} L${cx + Math.cos(a) * R} ${cy + Math.sin(a) * R} L${cx + Math.cos(a2) * R} ${cy + Math.sin(a2) * R} Z" fill="${theme.primary}" opacity="${i % 2 ? 0.06 : 0.11}"/>`
    }).join('')
    overlay = rays
  }
  const fill = style === 'rays' ? 'url(#r)' : 'url(#g)'
  return { src: url(SVG(w, h, `${grad}<rect width="${w}" height="${h}" fill="${fill}"/>${style === 'solid' ? '' : overlay}`)), w, h }
}

/** A scratch/mystery card cover (or a generic game card). */
export function svgCard(theme: Theme, label = '?', w = 620, h = 420): GenAsset {
  const ink = idealInk(theme.primary)
  const body =
    `<defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(theme.primary, 0.12)}"/><stop offset="1" stop-color="${darken(theme.primary, 0.18)}"/></linearGradient></defs>` +
    `<rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="40" fill="url(#c)" stroke="${theme.accent}" stroke-width="6"/>` +
    `<rect x="34" y="34" width="${w - 68}" height="${h - 68}" rx="26" fill="none" stroke="${lighten(theme.primary, 0.4)}" stroke-width="3" opacity="0.5" stroke-dasharray="14 12"/>` +
    `<text x="50%" y="52%" text-anchor="middle" dominant-baseline="central" font-family="Montserrat, Arial, sans-serif" font-weight="800" font-size="${Math.round(h * 0.42)}" fill="${ink}">${label}</text>`
  return { src: url(SVG(w, h, body)), w, h }
}

/** A coloured game tile/icon (distinct hue per index for match/pick games). */
export function svgTile(theme: Theme, index: number, size = 300): GenAsset {
  const palette = [theme.primary, theme.secondary, theme.accent, mix(theme.primary, theme.accent, 0.5), lighten(theme.secondary, 0.2), darken(theme.accent, 0.2)]
  const c = palette[index % palette.length]
  const ink = idealInk(c)
  const body =
    `<rect x="8" y="8" width="${size - 16}" height="${size - 16}" rx="${Math.round(size * 0.18)}" fill="${c}"/>` +
    `<circle cx="50%" cy="50%" r="${Math.round(size * 0.22)}" fill="${ink}" opacity="0.92"/>`
  return { src: url(SVG(size, size, body)), w: size, h: size }
}

/** A starburst "WIN" badge. */
export function svgBadge(theme: Theme, text = 'WIN', size = 380): GenAsset {
  const pts = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2
    const r = (i % 2 ? 0.84 : 1) * (size / 2 - 8)
    return `${size / 2 + Math.cos(a) * r},${size / 2 + Math.sin(a) * r}`
  }).join(' ')
  const ink = idealInk(theme.accent)
  const body =
    `<polygon points="${pts}" fill="${theme.accent}"/>` +
    `<circle cx="50%" cy="50%" r="${Math.round(size * 0.34)}" fill="${darken(theme.accent, 0.12)}"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="Montserrat, Arial, sans-serif" font-weight="800" font-size="${Math.round(size * 0.16)}" fill="${ink}">${text}</text>`
  return { src: url(SVG(size, size, body)), w: size, h: size }
}
