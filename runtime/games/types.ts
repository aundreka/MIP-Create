// Game module contract. A template renders into the game-mount slot, is
// configurable from the editor (paramFields), reports completion, and exposes an
// intelligent hint (getHint) that returns the next correct move in SCREEN px —
// modeled on coinsort's CoinBoard.mergeHint() -> HandHint.slide(from,to).

export interface Pt {
  x: number
  y: number
}

export interface HintMove {
  from: Pt
  to: Pt
  kind?: 'slide' | 'tap'
}

export interface GameContext {
  /** The game-layer slot element (already sized; the game fills it). */
  root: HTMLElement
  /** Resolve an asset id to its src (data URL / url). */
  assets: { src(id?: string): string }
  /** Play an SFX event (no-op until Pass 4 wires audio). */
  sfx: { play(event: string): void }
  /** Deterministic RNG so boards + hints stay consistent. */
  rng: () => number
}

export interface GameModule {
  mount(ctx: GameContext, params: Record<string, unknown>): void
  /** Begin interactive play (skipped in the editor canvas — static preview). */
  start(): void
  relayout(): void
  /** Next correct move in screen px, or null if none (host points at the CTA). */
  getHint(): HintMove | null
  onComplete(cb: () => void): void
  destroy(): void
}

export interface ParamField {
  key: string
  label: string
  type: 'number' | 'color' | 'select' | 'text'
  min?: number
  max?: number
  step?: number
  options?: string[]
}

// Image slots a template can use. `list` slots take one image per item, sized by
// the param named `countParam` (e.g. Match: one image per pair). The game reads
// the assigned asset id(s) from params[key] and renders images when present,
// falling back to colours/text otherwise.
export interface AssetSlot {
  key: string
  label: string
  list?: boolean
  countParam?: string
  /** What kind of asset this slot picks (defaults to image). */
  accept?: 'image' | 'video' | 'audio' | 'html'
}

export interface GameTemplate {
  id: string
  label: string
  paramFields: ParamField[]
  assetSlots?: AssetSlot[]
  defaultParams: Record<string, unknown>
  create(): GameModule
}

/** mulberry32 — tiny deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d)
export const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d)
