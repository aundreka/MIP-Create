import { describe, expect, it } from 'vitest'
import { colorDelta, diffImages, motionMask, rgbToHex, samplePixel, type Bitmap } from './imageDiff'

function solid(w: number, h: number, rgba: [number, number, number, number]): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4)
  return { data, width: w, height: h }
}

function paint(bmp: Bitmap, x0: number, y0: number, w: number, h: number, rgba: [number, number, number, number]): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) bmp.data.set(rgba, (y * bmp.width + x) * 4)
}

describe('colorDelta', () => {
  it('is 0 for identical pixels and ~1 for black vs white', () => {
    expect(colorDelta(10, 20, 30, 255, 10, 20, 30, 255)).toBe(0)
    expect(colorDelta(0, 0, 0, 255, 255, 255, 255, 255)).toBeGreaterThan(0.9)
  })
  it('treats transparent as white (composite on white)', () => {
    expect(colorDelta(0, 0, 0, 0, 255, 255, 255, 255)).toBeLessThan(0.001)
  })
  it('is small for near-identical shades', () => {
    expect(colorDelta(200, 200, 200, 255, 203, 201, 199, 255)).toBeLessThan(0.01)
  })
})

describe('rgbToHex / samplePixel', () => {
  it('formats hex and samples pixels', () => {
    expect(rgbToHex(255, 0, 128)).toBe('#ff0080')
    const bmp = solid(4, 4, [10, 20, 30, 255])
    expect(samplePixel(bmp, 2, 2)?.hex).toBe('#0a141e')
    expect(samplePixel(bmp, 9, 0)).toBeNull()
    expect(samplePixel(bmp, -1, 0)).toBeNull()
  })
})

describe('diffImages', () => {
  it('reports no differences for identical images', () => {
    const a = solid(64, 64, [50, 100, 150, 255])
    const r = diffImages(a, solid(64, 64, [50, 100, 150, 255]))
    expect(r.diffPixels).toBe(0)
    expect(r.regions).toHaveLength(0)
    expect(r.pct).toBe(0)
  })

  it('finds and localizes a changed block', () => {
    const a = solid(128, 128, [255, 255, 255, 255])
    const b = solid(128, 128, [255, 255, 255, 255])
    paint(b, 32, 40, 24, 16, [255, 0, 0, 255])
    const r = diffImages(a, b)
    expect(r.diffPixels).toBe(24 * 16)
    expect(r.regions).toHaveLength(1)
    const box = r.regions[0]
    // box is cell-aligned (8px grid) so it may overshoot by <8px per side
    expect(box.x).toBeLessThanOrEqual(32)
    expect(box.y).toBeLessThanOrEqual(40)
    expect(box.x + box.w).toBeGreaterThanOrEqual(32 + 24)
    expect(box.y + box.h).toBeGreaterThanOrEqual(40 + 16)
    expect(box.pixels).toBe(24 * 16)
  })

  it('separates distant changes into distinct regions, largest first', () => {
    const a = solid(160, 160, [0, 0, 0, 255])
    const b = solid(160, 160, [0, 0, 0, 255])
    paint(b, 8, 8, 16, 16, [255, 255, 255, 255])
    paint(b, 120, 120, 32, 32, [255, 255, 255, 255])
    const r = diffImages(a, b)
    expect(r.regions).toHaveLength(2)
    expect(r.regions[0].pixels).toBe(32 * 32)
    expect(r.regions[1].pixels).toBe(16 * 16)
  })

  it('ignores sub-threshold shifts and speckle below minRegionPixels', () => {
    const a = solid(64, 64, [200, 200, 200, 255])
    const b = solid(64, 64, [202, 199, 201, 255]) // imperceptible shift
    expect(diffImages(a, b).diffPixels).toBe(0)

    const c = solid(64, 64, [0, 0, 0, 255])
    paint(c, 10, 10, 2, 2, [255, 255, 255, 255]) // 4px speckle
    const r = diffImages(solid(64, 64, [0, 0, 0, 255]), c)
    expect(r.diffPixels).toBe(4)
    expect(r.regions).toHaveLength(0)
  })

  it('marks diff pixels magenta in the mask', () => {
    const a = solid(16, 16, [255, 255, 255, 255])
    const b = solid(16, 16, [255, 255, 255, 255])
    paint(b, 0, 0, 8, 8, [0, 0, 0, 255])
    const { mask } = diffImages(a, b)
    expect(mask.data[3]).toBe(200) // (0,0) differs → alpha set
    const clean = (15 * 16 + 15) * 4
    expect(mask.data[clean + 3]).toBe(0) // (15,15) same → transparent
  })

  it('compares the overlapping area when sizes differ', () => {
    const a = solid(64, 64, [255, 255, 255, 255])
    const b = solid(48, 32, [255, 255, 255, 255])
    const r = diffImages(a, b)
    expect(r.totalPixels).toBe(48 * 32)
    expect(r.diffPixels).toBe(0)
  })

  it('excludes ignore-masked pixels from the diff and the denominator', () => {
    const a = solid(64, 64, [255, 255, 255, 255])
    const b = solid(64, 64, [255, 255, 255, 255])
    paint(b, 16, 16, 16, 16, [255, 0, 0, 255]) // "pulsing CTA" area
    const ignore = new Uint8Array(64 * 64)
    for (let y = 16; y < 32; y++) for (let x = 16; x < 32; x++) ignore[y * 64 + x] = 1
    const r = diffImages(a, b, 0.12, 24, ignore)
    expect(r.diffPixels).toBe(0)
    expect(r.regions).toHaveLength(0)
    expect(r.ignoredPixels).toBe(16 * 16)
    expect(r.totalPixels).toBe(64 * 64 - 16 * 16)
    expect(r.pct).toBe(0)
  })
})

describe('motionMask', () => {
  it('marks moving areas (dilated) and reports them as regions', () => {
    const f1 = solid(128, 128, [255, 255, 255, 255])
    const f2 = solid(128, 128, [255, 255, 255, 255])
    paint(f1, 48, 48, 24, 24, [200, 30, 30, 255]) // CTA at pulse-min
    paint(f2, 44, 44, 32, 32, [200, 30, 30, 255]) // CTA at pulse-max
    const m = motionMask(f1, f2)
    expect(m.regions).toHaveLength(1)
    // the moving rim is covered (with dilation margin); static bg is not
    expect(m.mask[60 * 128 + 46]).toBe(1) // left rim, mid-height
    expect(m.mask[45 * 128 + 45]).toBe(1) // corner rim only present at pulse-max
    expect(m.mask[10 * 128 + 10]).toBe(0) // static background
    expect(m.pixels).toBeGreaterThan(32 * 32 - 24 * 24) // at least the moving ring
    // and feeding it back into diffImages neutralizes the animation
    const r = diffImages(f1, f2, 0.12, 24, m.mask)
    expect(r.diffPixels).toBe(0)
  })

  it('is empty for two identical frames', () => {
    const f = solid(64, 64, [10, 20, 30, 255])
    const m = motionMask(f, solid(64, 64, [10, 20, 30, 255]))
    expect(m.pixels).toBe(0)
    expect(m.regions).toHaveLength(0)
  })
})
