// An image drawn on top of a full-screen endscene rides the endscene's MEDIA box
// (the cover-cropped clip) instead of the global FIT box — see endsceneMediaPos in
// stage.ts. The card positions its own overlays against that crop, so an image
// authored beside one of them has to crop and scale with it; plain FIT layout left
// a badge stranded near the bottom of a landscape tablet at the wrong size.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign, setVAlign } from './responsive'
import type { Project, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920

// Natural size of the endscene clip — the SIP card's real 4:3 pair, which crops
// hard against a 9:16 design and so makes any drift obvious.
const assets = {
  pvid: { src: 'data:video/mp4;base64,', w: 854, h: 1138, kind: 'video' as const },
  lvid: { src: 'data:video/mp4;base64,', w: 1138, h: 854, kind: 'video' as const },
  badge: { src: 'data:image/png;base64,', w: 100, h: 98 },
}

function makeProject(imgZ = 2): Project {
  const elements: SceneElement[] = [
    {
      id: 'vid',
      type: 'endscene',
      name: 'Card',
      x: 540,
      y: 960,
      w: DESIGN_W,
      h: DESIGN_H,
      anchor: 'center',
      zIndex: 1,
      mode: 'extend',
      endscene: { portraitVideoId: 'pvid', landscapeVideoId: 'lvid', objectFit: 'cover', loop: true, bgColor: '#000000' },
    },
    {
      id: 'badge',
      type: 'image',
      name: 'Badge',
      x: 764,
      y: 1534,
      w: 100,
      h: 98,
      anchor: 'top-left',
      zIndex: imgZ,
      mode: 'fit',
      assetId: 'badge',
      landscape: { x: 137, y: 1687, w: 137, h: 150, anchor: 'top-left' },
    },
  ]
  return {
    meta: { schemaVersion: 1, name: 'endscene-image', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H, vAlign: 'center' },
    startSceneId: 's1',
    scenes: [{ id: 's1', name: 'End', kind: 'endscene', elements, advance: { on: 'manual' } }],
  }
}

const fakeRect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

const q = (mount: HTMLElement, id: string): HTMLElement => mount.querySelector<HTMLElement>(`.pa-el[data-id="${id}"]`)!

// The cover-fit box of a clip of natural size (nw,nh) inside a w x h frame.
function cover(w: number, h: number, nw: number, nh: number): { left: number; top: number; width: number; height: number } {
  const k = Math.max(w / nw, h / nh)
  return { left: (w - nw * k) / 2, top: (h - nh * k) / 2, width: nw * k, height: nh * k }
}

// Where the badge SHOULD land: its design anchor expressed as a fraction of the
// media box at the design frame (portrait 1080x1920 / landscape 1920x1080 — the
// frame the position was authored in), re-applied to the live media box.
function expected(vw: number, vh: number, x: number, y: number, w: number, h: number): { left: number; top: number; w: number; h: number } {
  const landscape = vw > vh
  const refW = landscape ? DESIGN_H : DESIGN_W
  const refH = landscape ? DESIGN_W : DESIGN_H
  const nat = landscape ? assets.lvid : assets.pvid
  const fitScale = Math.min(refW / DESIGN_W, refH / DESIGN_H)
  const refMedia = cover(refW, refH, nat.w, nat.h)
  const media = cover(vw, vh, nat.w, nat.h)
  const nx = ((refW - DESIGN_W * fitScale) / 2 + x * fitScale - refMedia.left) / refMedia.width
  const ny = (y * fitScale - refMedia.top) / refMedia.height
  const k = fitScale * (media.height / refMedia.height)
  return { left: media.left + nx * media.width, top: media.top + ny * media.height, w: w * k, h: h * k }
}

function mount(vw: number, vh: number, project = makeProject()): HTMLElement {
  document.body.innerHTML = ''
  const el = document.createElement('div')
  document.body.appendChild(el)
  setDesign(DESIGN_W, DESIGN_H)
  setVAlign('center')
  computeMetrics(vw, vh)
  const mgr = playProject(project, assets, { mount: el, interactive: true })
  q(el, 'vid').getBoundingClientRect = () => fakeRect(0, 0, vw, vh)
  mgr.relayout()
  return el
}

describe('image over an endscene', () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  })
  afterEach(() => {
    setVAlign('top')
  })

  it('rides the cropped clip in portrait', () => {
    const el = mount(390, 844)
    const e = expected(390, 844, 764, 1534, 100, 98)
    const badge = q(el, 'badge')
    expect(parseFloat(badge.style.left)).toBeCloseTo(e.left, 0)
    expect(parseFloat(badge.style.top)).toBeCloseTo(e.top, 0)
    expect(parseFloat(badge.style.width)).toBeCloseTo(e.w, 0)
    expect(parseFloat(badge.style.height)).toBeCloseTo(e.h, 0)
  })

  // A landscape tablet, whose aspect is nowhere near the 16:9 the landscape
  // override was authored against — the case the badge was stranded in. (At a
  // true 16:9 the mapping degenerates to plain FIT, so it proves nothing.)
  it('rides the cropped clip in landscape, where plain FIT would strand it', () => {
    const el = mount(1540, 1135)
    const e = expected(1540, 1135, 137, 1687, 137, 150)
    const badge = q(el, 'badge')
    expect(parseFloat(badge.style.left)).toBeCloseTo(e.left, 0)
    expect(parseFloat(badge.style.top)).toBeCloseTo(e.top, 0)
    expect(parseFloat(badge.style.width)).toBeCloseTo(e.w, 0)
    expect(parseFloat(badge.style.height)).toBeCloseTo(e.h, 0)
    // The FIT box is a narrow centred column there: the old layout put the badge
    // ~100px below and ~55px left of where the clip actually crops, oversized.
    const fit = Math.min(1540 / DESIGN_W, 1135 / DESIGN_H)
    expect(parseFloat(badge.style.left)).not.toBeCloseTo((1540 - DESIGN_W * fit) / 2 + 137 * fit, 0)
    expect(parseFloat(badge.style.top)).not.toBeCloseTo(1687 * fit, 0)
    expect(parseFloat(badge.style.width)).not.toBeCloseTo(137 * fit, 0)
  })

  it('keeps the badge glued to the same point of the clip as the viewport crops', () => {
    const frac = (vw: number, vh: number): { x: number; y: number } => {
      const el = mount(vw, vh)
      const badge = q(el, 'badge')
      const media = cover(vw, vh, assets.pvid.w, assets.pvid.h)
      return {
        x: (parseFloat(badge.style.left) - media.left) / media.width,
        y: (parseFloat(badge.style.top) - media.top) / media.height,
      }
    }
    const a = frac(390, 844)
    const b = frac(430, 932) // taller phone: the clip crops more at the sides
    // Loose to 2dp: the layout rounds its px to whole pixels.
    expect(b.x).toBeCloseTo(a.x, 2)
    expect(b.y).toBeCloseTo(a.y, 2)
  })

  it('leaves an image UNDER the endscene on plain FIT layout', () => {
    const el = mount(1600, 900, makeProject(0)) // z below the endscene: not an overlay
    const badge = q(el, 'badge')
    const fit = Math.min(1600 / DESIGN_W, 900 / DESIGN_H)
    expect(parseFloat(badge.style.left)).toBeCloseTo((1600 - DESIGN_W * fit) / 2 + 137 * fit, 0)
    expect(parseFloat(badge.style.top)).toBeCloseTo(1687 * fit, 0)
    expect(parseFloat(badge.style.width)).toBeCloseTo(137 * fit, 0)
  })

  it('leaves an image in a scene with no endscene on plain FIT layout', () => {
    const project = makeProject()
    project.scenes[0].elements = project.scenes[0].elements.filter((e) => e.type !== 'endscene')
    document.body.innerHTML = ''
    const el = document.createElement('div')
    document.body.appendChild(el)
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign('center')
    computeMetrics(1600, 900)
    playProject(project, assets, { mount: el, interactive: true }).relayout()
    const badge = q(el, 'badge')
    const fit = Math.min(1600 / DESIGN_W, 900 / DESIGN_H)
    expect(parseFloat(badge.style.left)).toBeCloseTo((1600 - DESIGN_W * fit) / 2 + 137 * fit, 0)
    expect(parseFloat(badge.style.top)).toBeCloseTo(1687 * fit, 0)
  })
})
