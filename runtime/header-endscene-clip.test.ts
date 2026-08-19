// The pinned date band rides a full-bleed end card's CLIP, not the FIT frame.
//
// The band is normally glued to the physical top of the screen at the FIT scale — right
// for a game scene, wrong over an end card whose clip is cover-cropped: the card's own
// composition (the artwork the date was placed against) moves and scales with the crop,
// and a band that stayed at the screen top drifted off it. Over such a card the band now
// takes the clip's scale and the clip's top, the same lock every element drawn over the
// card gets (endsceneMediaPos in stage.ts). Everywhere else it is unchanged.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign, setVAlign, scale } from './responsive'
import type { Project, SceneDef } from './scene'

vi.mock('./networks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./networks')>()),
  notifyGameEnd: vi.fn(),
  notifyGameClose: vi.fn(),
  triggerCTA: vi.fn(),
}))

const DESIGN_W = 1080
const DESIGN_H = 1920

// A 3:4 clip against a 9:16 design: cover crops it hard, so any drift is obvious.
const assets = {
  pvid: { src: 'data:video/mp4;base64,', w: 854, h: 1138, kind: 'video' as const },
  lvid: { src: 'data:video/mp4;base64,', w: 1138, h: 854, kind: 'video' as const },
}

const endsceneEl = (fit: 'cover' | 'contain') => ({
  id: 'vid', type: 'endscene' as const, name: 'Card', x: 540, y: 960, w: DESIGN_W, h: DESIGN_H,
  anchor: 'center' as const, zIndex: 1, mode: 'extend' as const,
  endscene: { portraitVideoId: 'pvid', landscapeVideoId: 'lvid', objectFit: fit, loop: true, bgColor: '#000000' },
})

function proj(fit: 'cover' | 'contain' = 'cover', withCard = true): Project {
  const end: SceneDef = {
    id: 'end', name: 'End', kind: 'endscene', showHeader: true,
    elements: withCard ? [endsceneEl(fit)] : [],
    advance: { on: 'manual' },
    transition: { type: 'none', durationMs: 0 },
  }
  return {
    meta: {
      schemaVersion: 1, name: 'header-clip', clickUrl: { ios: '', android: '' },
      baseW: DESIGN_W, baseH: DESIGN_H,
      header: { heightPx: 120, fontSizePx: 64, dateFormat: 'MMMM DD' },
    },
    startSceneId: 'end',
    scenes: [end],
  }
}

const fakeRect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

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
function cover(w: number, h: number, nw: number, nh: number): { top: number; height: number } {
  const f = coverFrame(w, h)
  const k = Math.max(f.width / nw, f.height / nh)
  return { top: f.top + (f.height - nh * k) / 2, height: nh * k }
}

function band(vw: number, vh: number, project = proj()): { top: number; scale: number } {
  document.body.innerHTML = ''
  window.sessionStorage.clear()
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  setDesign(DESIGN_W, DESIGN_H)
  setVAlign('center')
  computeMetrics(vw, vh)
  const mgr = playProject(project, assets, { mount, interactive: true })
  const card = mount.querySelector<HTMLElement>('.pa-el[data-id="vid"]')
  if (card) card.getBoundingClientRect = () => fakeRect(0, 0, vw, vh)
  mgr.relayout()
  const el = mount.querySelector<HTMLElement>('.pa-header')!
  return {
    top: parseFloat(el.style.top) || 0,
    scale: parseFloat(/scale\(([-\d.]+)\)/.exec(el.style.transform)?.[1] ?? '0'),
  }
}

describe('the pinned date band over an endscene card', () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  })

  it('takes the clip’s scale and top instead of the FIT scale and the screen top', () => {
    const b = band(390, 844)
    const m = cover(390, 844, assets.pvid.w, assets.pvid.h)
    const ref = cover(DESIGN_W, DESIGN_H, assets.pvid.w, assets.pvid.h)
    // The design frame is the reference, so the band's scale is the ratio of the two
    // cover scales — NOT the letterboxed FIT scale.
    expect(b.scale).toBeCloseTo(m.height / ref.height, 4)
    // Design y 0 sits this far into the reference clip; the band lands at the same
    // point of the live one. (At this aspect the clip is height-driven, so that point
    // is still the screen top — the SCALE is what has changed.)
    expect(b.top).toBeCloseTo(m.top + ((0 - ref.top) / ref.height) * m.height, 3)

    // On a viewport wide enough that cover crops the clip's TOP away, the band goes with
    // it rather than staying at the screen edge — it belongs to the card, not the screen.
    const wideish = band(1080, 1200)
    const mw = cover(1080, 1200, assets.pvid.w, assets.pvid.h)
    expect(mw.top).toBeLessThan(0)
    expect(wideish.top).toBeCloseTo(mw.top + ((0 - ref.top) / ref.height) * mw.height, 3)
    expect(wideish.top).toBeLessThan(0)
    // That viewport is not extreme, so the clip covers the whole card and its scale is
    // genuinely not the letterboxed FIT scale. (`scale()` is whatever the last band()
    // call computed metrics for — this one.)
    expect(wideish.scale).not.toBeCloseTo(scale(), 3)
  })

  it('holds the same point and size on the clip as the viewport crops', () => {
    const onClip = (vw: number, vh: number): { fy: number; fk: number } => {
      const b = band(vw, vh)
      const nat = vw > vh ? assets.lvid : assets.pvid
      const m = cover(vw, vh, nat.w, nat.h)
      return { fy: (b.top - m.top) / m.height, fk: b.scale / m.height }
    }
    const a = onClip(1080, 1920)
    for (const [vw, vh] of [
      [390, 844],
      [1080, 2400],
    ]) {
      const got = onClip(vw, vh)
      expect(got.fy).toBeCloseTo(a.fy, 3)
      expect(got.fk).toBeCloseTo(a.fk, 5)
    }
  })

  it('locks in landscape too, where the FIT frame is a narrow centred column', () => {
    const onClip = (vw: number, vh: number): { fy: number; fk: number } => {
      const b = band(vw, vh)
      const m = cover(vw, vh, assets.lvid.w, assets.lvid.h)
      return { fy: (b.top - m.top) / m.height, fk: b.scale / m.height }
    }
    const wide = onClip(1540, 1135)
    const wider = onClip(2000, 900)
    expect(wider.fy).toBeCloseTo(wide.fy, 3)
    expect(wider.fk).toBeCloseTo(wide.fk, 5)
  })

  // A contained clip letterboxes, so the composition the date belongs to IS the FIT
  // frame — the same rule the scene elements over a card follow.
  it('stays pinned to the screen top over a contain card', () => {
    const b = band(390, 844, proj('contain'))
    expect(b.top).toBe(0)
    expect(b.scale).toBeCloseTo(scale(), 5)
  })

  it('stays pinned to the screen top when the scene has no card at all', () => {
    const b = band(390, 844, proj('cover', false))
    expect(b.top).toBe(0)
    expect(b.scale).toBeCloseTo(scale(), 5)
  })
})
