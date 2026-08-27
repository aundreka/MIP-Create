// Pure canvas geometry helpers (unit-tested in geometry.test.ts).

import type { SceneElement } from '../../runtime/scene'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Read a flipbook game-mount's params + assets into the shape flipbookBoxes wants.
 * Ratios come from the ART's own pixels (the `aspect` param is only the fallback for
 * art of unknown size) — the same rule runtime/games/flipbook.ts uses, so the overlay
 * measures the book the game actually draws. */
export function flipbookOpts(params: Record<string, unknown>, assets: Record<string, { w: number; h: number }>): FlipbookOpts {
  const ratioOf = (id: unknown): number => {
    const a = typeof id === 'string' && id ? assets[id] : undefined
    return a && a.w > 0 && a.h > 0 ? a.w / a.h : 0
  }
  const first = (key: string): number => ratioOf((Array.isArray(params[key]) ? (params[key] as unknown[]) : [])[0])
  return {
    leftRatio: first('leftPages'),
    rightRatio: first('rightPages'),
    coverRatio: ratioOf(params.cover),
    pageAspect: typeof params.aspect === 'number' ? params.aspect : 0.6,
    bookScale: typeof params.bookScale === 'number' ? params.bookScale : 100,
    coverScale: typeof params.coverScale === 'number' ? params.coverScale : 100,
    anchor: params.anchor === 'spread' ? 'spread' : 'cover',
    hasCover: params.hasCover !== false,
  }
}

export interface FlipbookOpts {
  /** Width/height of the first opening's LEFT page art (0 = not known). */
  leftRatio?: number
  /** Width/height of the first opening's RIGHT page art (0 = not known). */
  rightRatio?: number
  /** The cover art's width/height (0 = not known). */
  coverRatio?: number
  /** Fallback ratio for any page whose art size can't be read. */
  pageAspect?: number
  /** What is centred in the slot: the shut cover, or the open book. */
  anchor?: 'cover' | 'spread'
  /** Whole-book size, %. */
  bookScale?: number
  /** Cover height as a % of the pages'. */
  coverScale?: number
  hasCover?: boolean
}

/** The flipbook's boxes inside its game-mount, mirroring runtime/games/flipbook.ts
 * layout(): height-driven (the slot's height times the book scale), each page then as
 * wide as its OWN art makes it at that height — so an opening may run WIDER than the
 * slot. The fold is fixed, anchored so the shut cover is centred; the left page sits
 * to its left, the right page (and the cover, on top of it) to its right.
 *
 * The canvas overlay has to draw its guides and handles on the same boxes the game
 * renders, so this is the one place that math lives on the editor side —
 * cross-checked against the real game in geometry.test.ts. */
export function flipbookBoxes(slot: Box, o: FlipbookOpts): { book: Box; cover: Box | null; spineX: number } {
  const fallback = Math.max(0.2, Math.min(2, o.pageAspect ?? 0.6))
  const s = Math.max(0.2, Math.min(2, (o.bookScale ?? 100) / 100))
  const h = slot.h * 0.98 * s
  const y = slot.y + (slot.h - h) / 2
  const wide = (r: number | undefined): number => h * (r && r > 0 ? r : fallback)
  const lw = wide(o.leftRatio)
  const rw = wide(o.rightRatio)

  const hasCover = o.hasCover !== false
  const cs = Math.max(0.2, Math.min(1.5, (o.coverScale ?? 100) / 100))
  const ch = h * cs
  const cw = (o.coverRatio ?? 0) > 0 ? ch * (o.coverRatio as number) : rw
  // The fold is anchored so the shut cover is centred (or the first opening, if the
  // book starts open), and never moves after that.
  const spineX = hasCover && o.anchor !== 'spread' ? slot.x + slot.w / 2 - cw / 2 : slot.x + slot.w / 2 - (rw - lw) / 2
  const book = { x: spineX - lw, y, w: lw + rw, h }
  return { book, cover: hasCover ? { x: spineX, y: y + (h - ch) / 2, w: cw, h: ch } : null, spineX }
}

/** Where the element's (x,y) anchor sits within its box: 0=start, .5=center, 1=end. */
export function anchorFactors(a: SceneElement['anchor']): { ax: number; ay: number } {
  return {
    ax: a.includes('left') ? 0 : a.includes('right') ? 1 : 0.5,
    ay: a.includes('top') ? 0 : a.includes('bottom') ? 1 : 0.5,
  }
}

/** Resize a box by dragging a handle (hx/hy ∈ -1|0|1). Moves only the grabbed
 * edge(s); the opposite edge stays fixed regardless of the element's anchor. The
 * returned (x,y) is the new anchor point so the element re-lays-out in place. */
export function resizeBox(
  start: { anchor: SceneElement['anchor']; x: number; y: number; w: number; h: number },
  hx: -1 | 0 | 1,
  hy: -1 | 0 | 1,
  dx: number,
  dy: number,
  min = 8,
): Box {
  const { ax, ay } = anchorFactors(start.anchor)
  const left0 = start.x - ax * start.w
  const top0 = start.y - ay * start.h
  const right = left0 + start.w
  const bottom = top0 + start.h
  let left = left0
  let top = top0
  let w = start.w
  let h = start.h
  if (hx > 0) w = Math.max(min, start.w + dx)
  else if (hx < 0) ((w = Math.max(min, start.w - dx)), (left = right - w))
  if (hy > 0) h = Math.max(min, start.h + dy)
  else if (hy < 0) ((h = Math.max(min, start.h - dy)), (top = bottom - h))
  return { x: Math.round(left + ax * w), y: Math.round(top + ay * h), w: Math.round(w), h: Math.round(h) }
}

// ---- canvas zoom range ------------------------------------------------------
// Shared by the Topbar +/- buttons and the wheel zoom so both stop at the same
// place. The ceiling is deliberately well past 100% — pixel-nudging small art
// (handguide dots, badge text) needs real magnification.
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 16

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}
