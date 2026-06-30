// Extract a brand palette from an uploaded logo (canvas pixel sampling), favoring
// frequent + saturated colors and skipping near-white/black/grey. Falls back to a
// default theme. Browser-only (uses canvas); used by the MIP generator.

import { DEFAULT_THEME, hexToRgb, rgbToHex, themeFromColors, type Theme } from './svgAssets'

const dist = (a: string, b: string): number => {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)
}

export function extractTheme(src: string): Promise<Theme> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const N = 64
        const cv = document.createElement('canvas')
        cv.width = N
        cv.height = N
        const ctx = cv.getContext('2d')
        if (!ctx) return resolve(DEFAULT_THEME)
        ctx.drawImage(img, 0, 0, N, N)
        const data = ctx.getImageData(0, 0, N, N).data
        const buckets = new Map<string, { n: number; r: number; g: number; b: number; sat: number }>()
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          if (data[i + 3] < 128) continue
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          if (max > 240 && min > 228) continue // near-white
          if (max < 26) continue // near-black
          const sat = max === 0 ? 0 : (max - min) / max
          const key = `${r >> 4},${g >> 4},${b >> 4}`
          const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, sat: 0 }
          e.n++
          e.r += r
          e.g += g
          e.b += b
          e.sat += sat
          buckets.set(key, e)
        }
        const sorted = [...buckets.values()]
          .map((e) => ({ hex: rgbToHex(e.r / e.n, e.g / e.n, e.b / e.n), score: e.n * (0.35 + e.sat / e.n) }))
          .sort((a, b) => b.score - a.score)
        const colors: string[] = []
        for (const s of sorted) {
          if (colors.length >= 3) break
          if (colors.every((c) => dist(c, s.hex) > 70)) colors.push(s.hex)
        }
        resolve(colors.length ? themeFromColors(colors) : DEFAULT_THEME)
      } catch {
        resolve(DEFAULT_THEME)
      }
    }
    img.onerror = () => resolve(DEFAULT_THEME)
    img.src = src
  })
}
