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
  kind?: 'slide' | 'tap' | 'scratch' | 'hold'
  /** Optional hand-size multiplier (1 = natural). Lets a game shrink the hint hand so
   * it fits inside small targets — e.g. a short cell in a 1-column scratch grid. */
  scale?: number
  /** Vertical target point within a live hint element (0 = top, 1 = bottom). */
  targetYRatio?: number
}

export interface GameContext {
  /** The game-layer slot element (already sized; the game fills it). */
  root: HTMLElement
  /** Resolve an asset id to its src (data URL / url), and to its intrinsic pixel
   * size when known — so a game can size art by the art's OWN aspect instead of
   * guessing a box for it. */
  assets: { src(id?: string): string; size?(id?: string): { w: number; h: number } | null }
  /** Play an SFX event; loopStart/loopStop drive a looping gesture sound (e.g. a
   * scratching/dragging loop that runs while the pointer is held). */
  sfx: { play(event: string): void; loopStart?(event: string): void; loopStop?(event: string): void }
  /** Deterministic RNG so boards + hints stay consistent. */
  rng: () => number
  /** Current stage scale (screen px per design px). Multiply design-px params
   * (gaps, radii, offsets) by this so the game scales as ONE unit with the rest
   * of the layout at any viewport size/zoom, instead of keeping fixed px. */
  scale?: () => number
  /** Navigate to a named scene (for games with multi-scene flows, e.g. scratch grid lose → return). */
  navigate?(sceneId: string): void
  /** Stable ID of this game-mount element — use as a state key for cross-scene persistence. */
  elementId?: string
}

export interface GameModule {
  mount(ctx: GameContext, params: Record<string, unknown>): void
  /** Begin interactive play (skipped in the editor canvas — static preview). */
  start(): void
  relayout(): void
  /** Next correct move in screen px, or null if none (host points at the CTA). */
  getHint(): HintMove | null
  /** Optional live target for the shared hand animation. The hint layer samples
   * it every frame, allowing the hand to follow a newly selected valid target. */
  getHintTarget?(): HTMLElement | null
  onComplete(cb: () => void): void
  /** Optional: fires immediately when the win condition is met, before any reveal
   * transition. Use this for SFX that should play at the moment of winning rather
   * than after a fade/animation completes. */
  onWin?(cb: () => void): void
  destroy(): void
}

export interface ParamField {
  key: string
  label: string
  type: 'number' | 'color' | 'select' | 'text' | 'boolean'
  min?: number
  max?: number
  step?: number
  options?: string[]
  /** Editor-only: hide this field when it can't do anything (e.g. tracker
   * styling once the tracker is off). Runtime ignores it — a hidden field's
   * value is untouched, so turning the feature back on restores the setup. */
  showIf?: (params: Record<string, unknown>) => boolean
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
  /** Editor-only: hide this slot when the feature it feeds is switched off. */
  showIf?: (params: Record<string, unknown>) => boolean
}

export interface GameTemplate {
  id: string
  label: string
  paramFields: ParamField[]
  assetSlots?: AssetSlot[]
  defaultParams: Record<string, unknown>
  /** Default delay before the coded hint hand appears. */
  defaultHintIdleMs?: number
  /** Optional default hint route (points normalized 0..1 of the game card) used to
   * seed an editable handguide when the game is added. The first point is the start;
   * the rest are slide waypoints. Omit for a simple centered tap hint. A `mode`
   * picks a game-aware logic template instead (e.g. 'match' follows the game's
   * data-mm-hint card); nodes then only place the hand's initial position. */
  defaultHandguide?: { mode?: 'match' | 'hold' | 'thoughtwhack' | 'basket'; nodes: { x: number; y: number; pauseMs?: number }[]; periodMs?: number }
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
