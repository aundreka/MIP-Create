// Everything drawn ON TOP of an endscene is locked to the card's clip, not to the
// global FIT frame: the clip is one element that extends past the scene, and a badge,
// a label or a CTA authored against it has to crop, move and SCALE with it however the
// viewport crops. Before this, only `image` rode the clip (endsceneMediaPos) — a text
// or CTA beside it kept plain FIT layout and drifted away from the artwork it belonged
// to, shrinking relative to the clip on every screen taller than the design aspect.
//
// The invariant each test asserts: the element's box, expressed as a FRACTION of the
// live cover-cropped clip, is the same at every viewport size.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign, setVAlign } from './responsive'
import type { Project, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920

// A 3:4 clip against a 9:16 design: cover crops it hard, so any drift is obvious.
const assets = {
  pvid: { src: 'data:video/mp4;base64,', w: 854, h: 1138, kind: 'video' as const },
  lvid: { src: 'data:video/mp4;base64,', w: 1138, h: 854, kind: 'video' as const },
  badge: { src: 'data:image/png;base64,', w: 100, h: 98 },
}

function makeProject(): Project {
  const elements: SceneElement[] = [
    {
      id: 'vid', type: 'endscene', name: 'Card', x: 540, y: 960, w: DESIGN_W, h: DESIGN_H,
      anchor: 'center', zIndex: 1, mode: 'extend',
      endscene: { portraitVideoId: 'pvid', landscapeVideoId: 'lvid', objectFit: 'cover', loop: true, bgColor: '#000000' },
    },
    { id: 'badge', type: 'image', name: 'Badge', x: 500, y: 1500, w: 100, h: 98, anchor: 'top-left', zIndex: 2, mode: 'fit', assetId: 'badge' },
    { id: 'label', type: 'text', name: 'Label', x: 500, y: 1500, anchor: 'top-left', zIndex: 3, mode: 'fit', text: { value: 'SALE', fontSizePx: 100 } },
    { id: 'btn', type: 'cta', name: 'Cta', x: 500, y: 1700, w: 400, h: 120, anchor: 'top-left', zIndex: 4, mode: 'fit', text: { value: 'GET IT', fontSizePx: 48 } },
    {
      id: 'date', type: 'countdown', name: 'Dynamic date', x: 500, y: 1300, anchor: 'top-left', zIndex: 5, mode: 'fit',
      text: { value: '', fontSizePx: 52, fontWeight: 700, align: 'center' },
      countdown: { mode: 'dynamic', dynamicDays: 3, format: 'Offer ends {date}', dateStyle: 'short' },
    },
  ]
  return {
    meta: { schemaVersion: 1, name: 'endscene-lock', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H, vAlign: 'center' },
    startSceneId: 's1',
    scenes: [{ id: 's1', name: 'End', kind: 'endscene', elements, advance: { on: 'manual' } }],
  }
}

const fakeRect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

const q = (mount: HTMLElement, id: string): HTMLElement => mount.querySelector<HTMLElement>(`.pa-el[data-id="${id}"]`)!

// The frame a SIP clamps its cover box to on an EXTREME viewport (long/short past 1.8):
// a centred band of exactly 16:9 (9:16 in portrait). Re-derived here rather than imported
// so these tests stay an independent statement of the rule. Mirrors endsceneCoverFrame.
function coverFrame(w: number, h: number): { left: number; top: number; width: number; height: number } {
  if (Math.max(w, h) / Math.min(w, h) <= 1.8) return { left: 0, top: 0, width: w, height: h }
  if (h > w) {
    const bh = w * (16 / 9)
    return { left: 0, top: (h - bh) / 2, width: w, height: bh }
  }
  const bw = h * (16 / 9)
  return { left: (w - bw) / 2, top: 0, width: bw, height: h }
}

// The cover-fit box of a clip of natural size (nw,nh) inside a w x h frame — filling the
// clamped band, which is the whole frame on every non-extreme viewport.
function cover(w: number, h: number, nw: number, nh: number): { left: number; top: number; width: number; height: number } {
  const f = coverFrame(w, h)
  const k = Math.max(f.width / nw, f.height / nh)
  return { left: f.left + (f.width - nw * k) / 2, top: f.top + (f.height - nh * k) / 2, width: nw * k, height: nh * k }
}

function mount(vw: number, vh: number): HTMLElement {
  document.body.innerHTML = ''
  const el = document.createElement('div')
  document.body.appendChild(el)
  setDesign(DESIGN_W, DESIGN_H)
  setVAlign('center')
  computeMetrics(vw, vh)
  const mgr = playProject(makeProject(), assets, { mount: el, interactive: true })
  q(el, 'vid').getBoundingClientRect = () => fakeRect(0, 0, vw, vh)
  mgr.relayout()
  return el
}

// An element's box as a fraction of the live clip: x/y of its top-left, plus width.
function onClip(vw: number, vh: number, id: string): { fx: number; fy: number; fw: number } {
  const el = mount(vw, vh)
  const nat = vw > vh ? assets.lvid : assets.pvid
  const m = cover(vw, vh, nat.w, nat.h)
  const node = q(el, id)
  return {
    fx: (parseFloat(node.style.left) - m.left) / m.width,
    fy: (parseFloat(node.style.top) - m.top) / m.height,
    fw: parseFloat(node.style.width) / m.width,
  }
}

describe('elements over a cover endscene lock to the clip', () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  })

  // 1080x1920 is the design frame itself; the other two crop the clip's sides harder.
  const portrait: [number, number][] = [
    [1080, 1920],
    [390, 844],
    [1080, 2400],
  ]

  for (const id of ['badge', 'btn']) {
    it(`keeps ${id} at the same point and size on the clip across portrait viewports`, () => {
      const ref = onClip(1080, 1920, id)
      for (const [vw, vh] of portrait.slice(1)) {
        const got = onClip(vw, vh, id)
        expect(got.fx).toBeCloseTo(ref.fx, 2)
        expect(got.fy).toBeCloseTo(ref.fy, 2)
        expect(got.fw).toBeCloseTo(ref.fw, 3)
      }
    })
  }

  it('keeps a text label at the same point on the clip, at the same size relative to it', () => {
    const fontFrac = (vw: number, vh: number): number => {
      const el = mount(vw, vh)
      const nat = vw > vh ? assets.lvid : assets.pvid
      const m = cover(vw, vh, nat.w, nat.h)
      return parseFloat(q(el, 'label').querySelector<HTMLElement>('.pa-text-inner')!.style.fontSize) / m.height
    }
    const ref = onClip(1080, 1920, 'label')
    const refFont = fontFrac(1080, 1920)
    for (const [vw, vh] of portrait.slice(1)) {
      const got = onClip(vw, vh, 'label')
      expect(got.fx).toBeCloseTo(ref.fx, 2)
      expect(got.fy).toBeCloseTo(ref.fy, 2)
      expect(fontFrac(vw, vh)).toBeCloseTo(refFont, 4)
    }
  })

  // A CTA is parked OUT of the scene root into pa-stage for the scene's whole life
  // (parkImmune), so finding the endscene under it means looking past its own parent.
  it('locks a CTA even though it is parked outside the scene root', () => {
    const el = mount(390, 844)
    expect(q(el, 'btn').parentElement?.classList.contains('pa-stage')).toBe(true)
    const m = cover(390, 844, assets.pvid.w, assets.pvid.h)
    // Locked: 400 design px of a clip that is 1440.9 design px wide at the design frame.
    expect(parseFloat(q(el, 'btn').style.width) / m.width).toBeCloseTo(400 / cover(DESIGN_W, DESIGN_H, assets.pvid.w, assets.pvid.h).width, 3)
    // The label inside it is sized by the CLIP's scale, not the FIT frame's. (On a
    // clamped band the two happen to agree — the band shares the design aspect — so the
    // width check above is what separates them; this pins the label to the same source.)
    const ref = cover(DESIGN_W, DESIGN_H, assets.pvid.w, assets.pvid.h)
    const btnFont = Array.from(q(el, 'btn').querySelectorAll<HTMLElement>('*'))
      .map((n) => parseFloat(n.style.fontSize))
      .find((v) => v > 0)!
    expect(btnFont).toBeCloseTo(48 * (m.height / ref.height), 3)
  })

  // The "Dynamic date" the generator drops on an end card is a countdown element, and it
  // rides the clip on the same terms as the artwork it is placed against.
  it('locks a dynamic date to the clip in both orientations', () => {
    const fontFrac = (vw: number, vh: number): number => {
      const el = mount(vw, vh)
      const nat = vw > vh ? assets.lvid : assets.pvid
      const m = cover(vw, vh, nat.w, nat.h)
      return parseFloat(q(el, 'date').querySelector<HTMLElement>('.pa-text-inner')!.style.fontSize) / m.height
    }
    const refP = onClip(1080, 1920, 'date')
    const refPFont = fontFrac(1080, 1920)
    for (const [vw, vh] of portrait.slice(1)) {
      const got = onClip(vw, vh, 'date')
      expect(got.fx).toBeCloseTo(refP.fx, 2)
      expect(got.fy).toBeCloseTo(refP.fy, 2)
      expect(fontFrac(vw, vh)).toBeCloseTo(refPFont, 4)
    }
    const wide = onClip(1540, 1135, 'date')
    const wider = onClip(2000, 900, 'date')
    expect(wider.fx).toBeCloseTo(wide.fx, 2)
    expect(wider.fy).toBeCloseTo(wide.fy, 2)
    expect(fontFrac(2000, 900)).toBeCloseTo(fontFrac(1540, 1135), 4)
  })

  it('locks the same elements in landscape, where the FIT frame is a narrow column', () => {
    const wide = onClip(1540, 1135, 'badge')
    const wider = onClip(2000, 900, 'badge')
    expect(wider.fx).toBeCloseTo(wide.fx, 2)
    expect(wider.fy).toBeCloseTo(wide.fy, 2)
    expect(wider.fw).toBeCloseTo(wide.fw, 3)
  })

  // The clip itself must land on the band the elements are measured against, or the two
  // drift apart. Verified against the real template in bugs/…_sip_… at seven viewports:
  // the box below is what its #video-container reports at 390x844.
  it('sizes the clip to the SIP band on an extreme viewport, and full-bleed otherwise', () => {
    const clip = (vw: number, vh: number): CSSStyleDeclaration =>
      mount(vw, vh).querySelector<HTMLVideoElement>('.pa-endscene-video')!.style

    const band = clip(390, 844) // 2.16:1 — past the 1.8 threshold
    expect(parseFloat(band.left)).toBeCloseTo(0, 3)
    expect(parseFloat(band.top)).toBeCloseTo((75.333 / 844) * 100, 2)
    expect(parseFloat(band.width)).toBeCloseTo(100, 3)
    expect(parseFloat(band.height)).toBeCloseTo((693.333 / 844) * 100, 2)
    expect(band.objectFit).toBe('cover')

    const full = clip(1080, 1920) // 1.78:1 — the design frame is never extreme
    expect(full.left).toBe('0px')
    expect(full.top).toBe('0px')
    expect(full.width).toBe('100%')
    expect(full.height).toBe('100%')
  })

  it('leaves elements with no endscene under them on plain FIT layout', () => {
    document.body.innerHTML = ''
    const el = document.createElement('div')
    document.body.appendChild(el)
    const project = makeProject()
    project.scenes[0].elements = project.scenes[0].elements.filter((e) => e.type !== 'endscene')
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign('center')
    computeMetrics(390, 844)
    playProject(project, assets, { mount: el, interactive: true }).relayout()
    const fit = Math.min(390 / DESIGN_W, 844 / DESIGN_H)
    expect(parseFloat(q(el, 'badge').style.width)).toBeCloseTo(100 * fit, 1)
    expect(parseFloat(q(el, 'btn').style.width)).toBeCloseTo(400 * fit, 1)
  })
})
