// Trimming an element onto its free-form crop outline.
//
// The property that matters: the PICTURE MUST NOT MOVE. Trimming only changes which
// rectangle the element claims — every pixel that was on screen has to still be in the
// same place afterwards, or the author's careful placement is destroyed by a button
// that was supposed to be tidying up. Since the outline and the rectangular crop are
// both stored as fractions of the box, shrinking the box means rewriting both.

import { describe, it, expect } from 'vitest'
import { trimCropShapeBox } from './cropTrim'
import { cropShapeCss } from '../runtime/scene'

// A triangle occupying the middle half of a 400×400 box.
const TRI = [
  { x: 0.5, y: 0.25 },
  { x: 0.75, y: 0.75 },
  { x: 0.25, y: 0.75 },
]

describe('trimCropShapeBox', () => {
  it('boxes the element onto the outline’s bounds', () => {
    const t = trimCropShapeBox(TRI, 400, 400)!
    expect({ dx: t.dx, dy: t.dy, w: t.w, h: t.h }).toEqual({ dx: 100, dy: 100, w: 200, h: 200 })
  })

  it('re-expresses the outline so the shape on screen is unchanged', () => {
    const t = trimCropShapeBox(TRI, 400, 400)!
    // The same triangle, now filling the smaller box instead of floating in a big one.
    expect(cropShapeCss({ points: t.points })).toBe('polygon(50% 0%, 100% 100%, 0% 100%)')
    // Each point maps back to where it was, in the old box's coordinates.
    for (let i = 0; i < TRI.length; i++) {
      expect(t.dx + t.points[i].x * t.w).toBeCloseTo(TRI[i].x * 400, 6)
      expect(t.dy + t.points[i].y * t.h).toBeCloseTo(TRI[i].y * 400, 6)
    }
  })

  it('keeps a rectangular crop’s picture pinned where it was', () => {
    // The source sits at 1.5× the box, offset up and left — a normal zoomed-in crop.
    const crop = { scale: 1.5, x: -0.2, y: -0.3 }
    const t = trimCropShapeBox(TRI, 400, 400, crop)!
    const before = { left: crop.x * 400, top: crop.y * 400, width: crop.scale * 400 }
    const after = { left: t.dx + t.crop!.x! * t.w, top: t.dy + t.crop!.y! * t.h, width: t.crop!.scale! * t.w }
    expect(after.left).toBeCloseTo(before.left, 3)
    expect(after.top).toBeCloseTo(before.top, 3)
    expect(after.width).toBeCloseTo(before.width, 3)
  })

  it('leaves a crop-less element without inventing one', () => {
    expect(trimCropShapeBox(TRI, 400, 400)!.crop).toBeUndefined()
  })

  it('handles an outline traced outside the box, which is a legal way to keep an edge', () => {
    const t = trimCropShapeBox(
      [
        { x: -0.5, y: 0 },
        { x: 1.5, y: 0 },
        { x: 0.5, y: 1 },
      ],
      200,
      100,
    )!
    expect({ dx: t.dx, dy: t.dy, w: t.w, h: t.h }).toEqual({ dx: -100, dy: 0, w: 400, h: 100 })
    expect(cropShapeCss({ points: t.points })).toBe('polygon(0% 0%, 100% 0%, 50% 100%)')
  })

  it('declines rather than producing a box nobody could grab again', () => {
    expect(
      trimCropShapeBox(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        400,
        400,
      ),
    ).toBeNull() // not a polygon
    expect(
      trimCropShapeBox(
        [
          { x: 0.5, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 1 },
        ],
        400,
        400,
      ),
    ).toBeNull() // zero width
    expect(trimCropShapeBox(TRI, 0, 400)).toBeNull()
    expect(trimCropShapeBox(TRI, 400, 0)).toBeNull()
  })
})
