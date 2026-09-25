// Random win scene — a weighted pool of scenes a win may route to, one picked at win time.
// Stored as a single string param: "sceneA:1,sceneB:3" (weight optional, defaults to 1), so
// sceneB is three times as likely as sceneA. Empty = no pool (the fixed win scene applies).

export interface ScenePoolEntry {
  id: string
  weight: number
}

export function parseScenePool(raw: unknown): ScenePoolEntry[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  const out: ScenePoolEntry[] = []
  for (const part of raw.split(',')) {
    const [id, w] = part.split(':').map((s) => s.trim())
    if (!id || out.some((e) => e.id === id)) continue
    const n = w === undefined || w === '' ? 1 : Number(w)
    out.push({ id, weight: Number.isFinite(n) ? Math.max(0, n) : 1 })
  }
  return out
}

export function serializeScenePool(entries: ScenePoolEntry[]): string {
  return entries.map((e) => (e.weight === 1 ? e.id : `${e.id}:${e.weight}`)).join(',')
}

/** One item drawn by weight (zero-weight items never win); null when nothing can be drawn. */
export function pickWeighted<T extends { weight: number }>(items: T[], rand: () => number = Math.random): T | null {
  const pool = items.filter((e) => e.weight > 0)
  const total = pool.reduce((s, e) => s + e.weight, 0)
  if (!total) return null
  let r = rand() * total
  for (const e of pool) {
    r -= e.weight
    if (r < 0) return e
  }
  return pool[pool.length - 1]
}

/** One scene id drawn from the pool by weight; '' when the pool is empty or all-zero. */
export function pickFromScenePool(raw: unknown, rand: () => number = Math.random): string {
  return pickWeighted(parseScenePool(raw), rand)?.id ?? ''
}

// Random reveals — a list of possible prizes, one drawn per card / cell at mount. Each
// option carries its own art and, optionally, the scene its win redirects to. Stored as
// an array param; blank fields fall back to the card's / cell's usual setting.
export interface RevealOption {
  image: string // asset id: the prize (scratch card) or cell background (scratch grid)
  text: string // asset id: text overlay (scratch grid only)
  weight: number
  sceneId: string // win redirect; '' = the usual win routing
}

export function parseRevealOptions(raw: unknown): RevealOption[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map((o) => {
      const w = Number(o.weight ?? 1)
      return {
        image: typeof o.image === 'string' ? o.image : '',
        text: typeof o.text === 'string' ? o.text : '',
        weight: Number.isFinite(w) ? Math.max(0, w) : 1,
        sceneId: typeof o.sceneId === 'string' ? o.sceneId : '',
      }
    })
}
