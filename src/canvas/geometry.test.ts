import { describe, expect, it } from 'vitest'
import { anchorFactors, resizeBox } from './geometry'

describe('anchorFactors', () => {
  it('maps anchor names to box-origin factors', () => {
    expect(anchorFactors('center')).toEqual({ ax: 0.5, ay: 0.5 })
    expect(anchorFactors('top-left')).toEqual({ ax: 0, ay: 0 })
    expect(anchorFactors('bottom-right')).toEqual({ ax: 1, ay: 1 })
    expect(anchorFactors('top')).toEqual({ ax: 0.5, ay: 0 })
    expect(anchorFactors('right')).toEqual({ ax: 1, ay: 0.5 })
  })
})

describe('resizeBox — opposite edge stays fixed', () => {
  it('top-left anchor: dragging the east edge moves only the right edge', () => {
    const b = resizeBox({ anchor: 'top-left', x: 100, y: 50, w: 200, h: 100 }, 1, 0, 40, 0)
    expect(b).toEqual({ x: 100, y: 50, w: 240, h: 100 }) // left fixed, right +40
  })
  it('top-left anchor: dragging the west edge moves the left edge, right fixed', () => {
    const b = resizeBox({ anchor: 'top-left', x: 100, y: 50, w: 200, h: 100 }, -1, 0, -40, 0)
    // right was 300; left moves to 60 → x (=left for top-left) = 60, w = 240
    expect(b).toEqual({ x: 60, y: 50, w: 240, h: 100 })
  })
  it('center anchor: east drag moves the center by half the delta (right edge follows pointer)', () => {
    const b = resizeBox({ anchor: 'center', x: 100, y: 50, w: 200, h: 100 }, 1, 0, 40, 0)
    // left edge (0) fixed, right 200→240, so center x = 120, w = 240
    expect(b).toEqual({ x: 120, y: 50, w: 240, h: 100 })
  })
  it('corner drag resizes both axes, anchoring the opposite corner', () => {
    const b = resizeBox({ anchor: 'top-left', x: 0, y: 0, w: 100, h: 100 }, 1, 1, 50, 30)
    expect(b).toEqual({ x: 0, y: 0, w: 150, h: 130 })
  })
  it('clamps to the minimum and keeps the opposite edge fixed', () => {
    const b = resizeBox({ anchor: 'top-left', x: 0, y: 0, w: 100, h: 100 }, -1, 0, 200, 0, 8)
    // dragging left edge way past right → width clamps to 8, right edge (100) fixed
    expect(b.w).toBe(8)
    expect(b.x).toBe(92) // left = right(100) - 8
  })
})
