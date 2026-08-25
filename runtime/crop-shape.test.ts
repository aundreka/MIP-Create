// Free-form crop area — the outline the author traces, turned into a clip-path.
//
// The one rule the whole feature rests on: the outline is stored as FRACTIONS of the
// element box and emitted as PERCENTAGES. A playable is laid out at a different pixel
// size on every device it lands on, so a px outline would drift off the artwork the
// first time the fit changed — and the drift would only ever show up on a real phone,
// long after the author signed the ad off.

import { describe, it, expect } from 'vitest'
import { cropShapeCss, cropShapePoints, type CropShapeConfig, type CropShapePreset, type Project } from './scene'
import { playProject } from './scenes'
import { computeMetrics, setDesign } from './responsive'

describe('cropShapeCss', () => {
  it('emits a percentage polygon, so one outline fits every viewport the ad is served at', () => {
    expect(
      cropShapeCss({
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.5, y: 1 },
        ],
      }),
    ).toBe('polygon(0% 0%, 100% 0%, 50% 100%)')
  })

  it('is a no-op below the three points a polygon needs, so a half-traced outline shows the image whole', () => {
    expect(cropShapeCss(undefined)).toBe('')
    expect(cropShapeCss({ points: [] })).toBe('')
    expect(
      cropShapeCss({
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
    ).toBe('')
  })

  it('keeps points pulled outside the box — a corner past the edge is how you keep that corner square', () => {
    expect(
      cropShapeCss({
        points: [
          { x: -0.25, y: 0 },
          { x: 1.25, y: 0 },
          { x: 0.5, y: 1 },
        ],
      }),
    ).toBe('polygon(-25% 0%, 125% 0%, 50% 100%)')
  })

  it('drops junk rather than emitting a clip-path the browser would throw away whole', () => {
    // One NaN in the list must not cost the author the other four corners.
    const css = cropShapeCss({
      points: [
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0.5 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    })
    expect(css).toBe('polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)')
  })

  it('rounds to hundredths of a percent — the same dragged corner always writes the same string', () => {
    expect(
      cropShapeCss({
        points: [
          { x: 1 / 3, y: 2 / 3 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      }),
    ).toBe('polygon(33.33% 66.67%, 100% 0%, 0% 100%)')
  })
})

describe('cropShapePoints', () => {
  const PRESETS: CropShapePreset[] = ['ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star']

  it('gives every preset enough points to be a polygon, all inside the box', () => {
    for (const preset of PRESETS) {
      const pts = cropShapePoints(preset)
      expect(pts.length, preset).toBeGreaterThanOrEqual(3)
      for (const p of pts) {
        expect(p.x, preset).toBeGreaterThanOrEqual(0)
        expect(p.x, preset).toBeLessThanOrEqual(1)
        expect(p.y, preset).toBeGreaterThanOrEqual(0)
        expect(p.y, preset).toBeLessThanOrEqual(1)
      }
      expect(cropShapeCss({ points: pts }), preset).toMatch(/^polygon\(/)
    }
  })

  it('starts every preset at 12 o’clock, so swapping one for another is not also a rotation', () => {
    for (const preset of PRESETS) {
      expect(cropShapePoints(preset)[0], preset).toEqual({ x: 0.5, y: 0 })
    }
  })

  it('alternates the star between an outer and an inner radius', () => {
    const star = cropShapePoints('star')
    expect(star).toHaveLength(10)
    const fromCentre = (p: { x: number; y: number }): number => Math.hypot(p.x - 0.5, p.y - 0.5)
    for (let i = 0; i < star.length; i += 2) expect(fromCentre(star[i])).toBeCloseTo(0.5, 3)
    for (let i = 1; i < star.length; i += 2) expect(fromCentre(star[i])).toBeCloseTo(0.21, 3)
  })

  it('draws the ellipse with enough segments to read as a curve, not a polygon', () => {
    const pts = cropShapePoints('ellipse')
    expect(pts.length).toBeGreaterThanOrEqual(24)
    for (const p of pts) expect(Math.hypot(p.x - 0.5, p.y - 0.5)).toBeCloseTo(0.5, 3)
  })
})

// ---- what actually reaches the DOM -----------------------------------------
// The CSS string is only half the feature: it has to land on the layer that has the
// element's size, and it shares `clip-path` with the layer blur. Whichever of the two
// wins, the picture must still be clipped to the element's boundary.

function mountImage(cropShape?: CropShapeConfig, blur?: number): HTMLElement {
  document.body.innerHTML = ''
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  setDesign(1080, 1920)
  computeMetrics(390, 844)
  const project: Project = {
    meta: { schemaVersion: 1, name: 'crop-shape', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    startSceneId: 'game1',
    scenes: [
      {
        id: 'game1',
        name: 'Game',
        kind: 'game',
        advance: { on: 'manual' },
        elements: [{ id: 'hero', type: 'image', name: 'Hero', x: 540, y: 960, w: 600, h: 600, anchor: 'center', zIndex: 1, mode: 'fit', assetId: 'a1', blur, cropShape }],
      },
    ],
  }
  playProject(project, { a1: { src: 'data:image/png;base64,x', w: 600, h: 600 } }, { mount, interactive: true })
  return mount.querySelector<HTMLElement>('.pa-el[data-id="hero"] .pa-el-anim')!
}

describe('a cropped image in the runtime', () => {
  it('clips the layer that carries the element’s size, so the percentages mean what they say', () => {
    const anim = mountImage({
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.5, y: 1 },
      ],
    })
    expect(anim.style.clipPath).toBe('polygon(0% 0%, 100% 0%, 50% 100%)')
  })

  it('leaves clip-path to the blur when there is no crop area', () => {
    expect(mountImage(undefined, 8).style.clipPath).toBe('inset(0)')
    expect(mountImage(undefined).style.clipPath).toBe('')
  })

  it('takes the property over from a blurred element — the outline clips inside the boundary anyway', () => {
    const anim = mountImage(
      {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.5, y: 1 },
        ],
      },
      8,
    )
    expect(anim.style.clipPath).toBe('polygon(0% 0%, 100% 0%, 50% 100%)')
    expect(anim.style.filter).toContain('blur(')
  })
})
