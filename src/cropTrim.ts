// "Trim box to the area" — re-box an image element onto its free-form crop outline.
//
// Cutting a star out of a photo leaves the element still OCCUPYING the whole photo: it
// selects, aligns, and stacks as the original rectangle, with transparent corners. That
// reads as the crop not having taken. Trimming shrinks the box onto the outline — and
// then everything stored RELATIVE to that box has to be rewritten, or the picture jumps
// the instant the box changes. The outline itself is in box fractions, and so is any
// rectangular crop sitting underneath it, so both are re-expressed here.
//
// Pure geometry, kept out of the panel so the rewrite can be tested on its own.

import type { CropPoint, ImageCropConfig } from '../runtime/scene'

export interface CropTrim {
  /** New box, in design px, relative to the old box's TOP-LEFT corner. */
  dx: number
  dy: number
  w: number
  h: number
  /** The outline and the rectangular crop, re-expressed against the new box. */
  points: CropPoint[]
  crop?: ImageCropConfig
}

const round4 = (v: number): number => Math.round(v * 10000) / 10000

/**
 * `null` when there is nothing to trim to — fewer than the 3 points a polygon needs,
 * a degenerate (zero-width or zero-height) outline, or a box with no size. Callers
 * treat that as "leave the element alone" rather than as an error.
 */
export function trimCropShapeBox(points: CropPoint[], boxW: number, boxH: number, crop?: ImageCropConfig): CropTrim | null {
  const clean = points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  if (clean.length < 3 || !(boxW > 0) || !(boxH > 0)) return null
  const xs = clean.map((p) => p.x)
  const ys = clean.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const fw = Math.max(...xs) - minX
  const fh = Math.max(...ys) - minY
  // An outline with no area (every point on one line) would divide by zero below and
  // leave a 0-px box the author could never grab again.
  if (fw <= 0.0001 || fh <= 0.0001) return null

  const w = Math.max(1, Math.round(fw * boxW))
  const h = Math.max(1, Math.round(fh * boxH))
  const out: CropTrim = {
    dx: Math.round(minX * boxW),
    dy: Math.round(minY * boxH),
    w,
    h,
    points: clean.map((p) => ({ x: round4((p.x - minX) / fw), y: round4((p.y - minY) / fh) })),
  }
  if (crop) {
    // The picture must not move: its size and offset are fractions of the box, so both
    // scale by exactly how much the box shrank.
    out.crop = {
      scale: round4((crop.scale ?? 1) / fw),
      x: round4(((crop.x ?? 0) - minX) / fw),
      y: round4(((crop.y ?? 0) - minY) / fh),
    }
  }
  return out
}
