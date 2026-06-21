// Brand kit — a persisted color palette used by the swatch pickers. (Saved
// text/button styles will build on this in a later step.)

const LS_KEY = 'pa:palette'

const DEFAULT_PALETTE = [
  '#ffffff',
  '#0e1320',
  '#16a34a',
  '#22c55e',
  '#4f7bf0',
  '#2563eb',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
  '#1b2a4a',
  '#101a33',
]

export function loadPalette(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as string[]
      if (Array.isArray(p) && p.length) return p
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_PALETTE]
}

export function savePalette(palette: string[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(palette.slice(0, 24)))
  } catch {
    /* ignore */
  }
}

export function addToPalette(color: string): string[] {
  const p = loadPalette()
  if (!p.includes(color)) {
    p.unshift(color)
    savePalette(p)
  }
  return loadPalette()
}
