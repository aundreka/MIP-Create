// The scaling contract for the dynamic-holiday label: it changes only the STRING a
// countdown renders, never how that element is laid out. So a {holiday} label must
// sit and scale exactly like any other element — in a game scene, in a floated
// overlay scene and over an endscene card — at every viewport and orientation.
//
// The invariant each test asserts: position and font size, expressed as a fraction
// of the frame the element belongs to (the FIT frame for game/overlay, the live
// cover-cropped clip for an endscene), are the same at every viewport size.
//
// The auto-shrink (`fitWidthPx`) has to hold the same property: the shrink FACTOR is
// a ratio of two lengths that both scale with the layout, so a long label must come
// out the same fraction of the composition on a phone as on a tablet.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, metrics, setDesign, setVAlign } from './responsive'
import { setNowOverride } from './elements/countdown'
import { setPromoCalendar } from './elements/promoCalendar'
import type { Project, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920
const FIT_W = Math.round(DESIGN_W * 0.86)

const CALENDAR = [
  { start: '2026-08-31', end: '2026-09-07', label: 'Labor Day Sale' },
  { start: '2026-11-23', end: '2026-11-30', label: 'Thanksgiving, Black Friday & Cyber Monday Sale' },
]
const SHORT_DAY = new Date(2026, 8, 1).getTime() // "Labor Day Sale"
const LONG_DAY = new Date(2026, 10, 23).getTime() // the longest label in the calendar

// Text has no intrinsic width in jsdom (scrollWidth is always 0), and the auto-shrink
// is defined by MEASURING the string. Stand in a width that is exactly linear in the
// rendered font size — which is what makes the shrink factor viewport-independent in a
// real browser too — so the test exercises the real ratio rather than a stub constant.
Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
  configurable: true,
  get(this: HTMLElement): number {
    return (this.textContent?.length ?? 0) * (parseFloat(this.style.fontSize) || 0) * 0.5
  },
})

const assets = {
  pvid: { src: 'data:video/mp4;base64,', w: 854, h: 1138, kind: 'video' as const },
  lvid: { src: 'data:video/mp4;base64,', w: 1138, h: 854, kind: 'video' as const },
}

const holiday = (id: string, y: number, extra: Partial<SceneElement> = {}, cd: Record<string, unknown> = {}): SceneElement => ({
  id, type: 'countdown', name: id, x: 540, y, anchor: 'center', zIndex: 5, mode: 'fit',
  text: { value: '', fontSizePx: 64, fontWeight: 800, color: '#0a0', align: 'center' },
  countdown: { mode: 'dynamic', dynamicDays: 3, format: '{holiday}', fitWidthPx: FIT_W, ...cd } as SceneElement['countdown'],
  ...extra,
})

// over1 (overlay, starts the flow) floats over game1 — both stages live at once, which
// is what makes the overlay assertions meaningful (relayout has to reach both).
function makeFlow(): Project {
  return {
    meta: { schemaVersion: 1, name: 'holiday-scale', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H, promoCalendar: CALENDAR },
    startSceneId: 'over1',
    scenes: [
      {
        id: 'over1', name: 'Overlay', kind: 'overlay', overlayBase: 'game1',
        overlay: { opacity: 0.6, color: '#000000' },
        elements: [holiday('overFit', 1200)],
        advance: { on: 'manual' },
        transition: { type: 'none', durationMs: 0 },
      },
      {
        id: 'game1', name: 'Game', kind: 'game',
        elements: [holiday('gameFit', 400), holiday('gameHdr', 700, { headerScale: true })],
        advance: { on: 'manual' },
        transition: { type: 'none', durationMs: 0 },
      },
    ],
  }
}

// A 3:4 clip against a 9:16 design — cover crops it hard, so any drift is obvious.
function makeCard(): Project {
  const card: SceneElement = {
    id: 'vid', type: 'endscene', name: 'Card', x: 540, y: 960, w: DESIGN_W, h: DESIGN_H,
    anchor: 'center', zIndex: 1, mode: 'extend',
    endscene: { portraitVideoId: 'pvid', landscapeVideoId: 'lvid', objectFit: 'cover', loop: true, bgColor: '#000000' },
  }
  return {
    meta: { schemaVersion: 1, name: 'holiday-card', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H, vAlign: 'center', promoCalendar: CALENDAR },
    startSceneId: 'end1',
    scenes: [{ id: 'end1', name: 'End', kind: 'endscene', elements: [card, holiday('cardFit', 1300)], advance: { on: 'manual' } }],
  }
}

const q = (mount: HTMLElement, id: string): HTMLElement => document.querySelector<HTMLElement>(`.pa-el[data-id="${id}"]`)!
const inner = (mount: HTMLElement, id: string): HTMLElement => q(mount, id).querySelector<HTMLElement>('.pa-text-inner')!
const fontPx = (mount: HTMLElement, id: string): number => parseFloat(inner(mount, id).style.fontSize)

// --- endscene clip geometry, re-derived here so the test stays an independent
// statement of the rule (mirrors endsceneCoverFrame / endscene-lock.test.ts).
function coverFrame(w: number, h: number): { left: number; top: number; width: number; height: number } {
  if (Math.max(w, h) / Math.min(w, h) <= 1.8) return { left: 0, top: 0, width: w, height: h }
  if (h > w) {
    const bh = w * (16 / 9)
    return { left: 0, top: (h - bh) / 2, width: w, height: bh }
  }
  const bw = h * (16 / 9)
  return { left: (w - bw) / 2, top: 0, width: bw, height: h }
}
function cover(w: number, h: number, nw: number, nh: number): { left: number; top: number; width: number; height: number } {
  const f = coverFrame(w, h)
  const k = Math.max(f.width / nw, f.height / nh)
  return { left: f.left + (f.width - nw * k) / 2, top: f.top + (f.height - nh * k) / 2, width: nw * k, height: nh * k }
}
const fakeRect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

// Position and font as fractions of the FIT frame — the numbers that must not move.
// A headerScale element keeps its box in RAW design px inside one scale(s) transform,
// so its font is already a design-space number and must NOT be divided by s again.
function onFit(mount: HTMLElement, id: string): { fx: number; fy: number; ff: number } {
  const m = metrics()
  const node = q(mount, id)
  const headerScale = node.style.transform.includes('scale(')
  return {
    fx: (parseFloat(node.style.left) - m.offX) / (DESIGN_W * m.s),
    fy: (parseFloat(node.style.top) - m.offY) / (DESIGN_H * m.s),
    ff: headerScale ? fontPx(mount, id) : fontPx(mount, id) / m.s,
  }
}

const VIEWPORTS: [number, number][] = [
  [1080, 1920],
  [540, 960],
  [390, 844],
  [1540, 1135],
  [2000, 900],
]

describe('a {holiday} label scales like every other element', () => {
  let mount: HTMLElement
  let mgr: { destroy(): void; relayout(): void } | null = null

  beforeEach(() => {
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    setPromoCalendar(CALENDAR)
    setNowOverride(SHORT_DAY)
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign(undefined)
    mount = document.createElement('div')
    document.body.appendChild(mount)
  })

  afterEach(() => {
    mgr?.destroy()
    mgr = null
    setNowOverride(null)
  })

  const flow = (vw: number, vh: number): HTMLElement => {
    computeMetrics(vw, vh)
    mgr = playProject(makeFlow(), {}, { mount, interactive: true })
    return mount
  }

  it('renders the label in the game scene AND in the overlay floated over it', () => {
    flow(1080, 1920)
    expect(inner(mount, 'gameFit').textContent).toBe('Labor Day Sale')
    expect(inner(mount, 'overFit').textContent).toBe('Labor Day Sale')
  })

  for (const id of ['gameFit', 'gameHdr', 'overFit']) {
    it(`holds ${id} at the same point and size on the FIT frame at every viewport`, () => {
      flow(1080, 1920)
      const ref = onFit(mount, id)
      mgr!.destroy()
      for (const [vw, vh] of VIEWPORTS.slice(1)) {
        flow(vw, vh)
        const got = onFit(mount, id)
        expect(got.fx).toBeCloseTo(ref.fx, 2)
        expect(got.fy).toBeCloseTo(ref.fy, 2)
        expect(got.ff).toBeCloseTo(ref.ff, 3)
        mgr!.destroy()
      }
      mgr = null
    })
  }

  // The whole point of the shrink: a 46-character label must come out at the same
  // fraction of the composition everywhere, not re-fit itself per screen.
  it('shrinks a long label by the SAME factor at every viewport', () => {
    setNowOverride(LONG_DAY)
    flow(1080, 1920)
    expect(inner(mount, 'gameFit').textContent).toBe('Thanksgiving, Black Friday & Cyber Monday Sale')
    const ref = onFit(mount, 'gameFit')
    const refHdr = onFit(mount, 'gameHdr')
    expect(ref.ff).toBeLessThan(64) // it really did shrink
    mgr!.destroy()
    for (const [vw, vh] of VIEWPORTS.slice(1)) {
      flow(vw, vh)
      expect(onFit(mount, 'gameFit').ff).toBeCloseTo(ref.ff, 3)
      expect(onFit(mount, 'gameHdr').ff).toBeCloseTo(refHdr.ff, 3)
      mgr!.destroy()
    }
    mgr = null
  })

  it('leaves position untouched when the label shrinks', () => {
    flow(1080, 1920)
    const short = onFit(mount, 'gameFit')
    mgr!.destroy()
    setNowOverride(LONG_DAY)
    flow(1080, 1920)
    const long = onFit(mount, 'gameFit')
    expect(long.fx).toBeCloseTo(short.fx, 4)
    expect(long.fy).toBeCloseTo(short.fy, 4)
    expect(long.ff).toBeLessThan(short.ff)
  })

  it('never scales a short label UP to fill the width budget', () => {
    flow(1080, 1920)
    expect(fontPx(mount, 'gameFit')).toBeCloseTo(64, 3) // the authored size, untouched
  })

  // relayout() has to reach floated overlay stages, or the overlay's label would keep
  // the previous viewport's geometry while the scene under it moved.
  it('moves the floated overlay label by exactly the FIT delta on relayout', () => {
    flow(1080, 1920)
    const ref = onFit(mount, 'overFit')
    computeMetrics(390, 844)
    mgr!.relayout()
    const got = onFit(mount, 'overFit')
    expect(got.fx).toBeCloseTo(ref.fx, 2)
    expect(got.fy).toBeCloseTo(ref.fy, 2)
    expect(got.ff).toBeCloseTo(ref.ff, 3)
  })

  it('re-fits the shrink after a relayout, not just on the first pass', () => {
    setNowOverride(LONG_DAY)
    flow(1080, 1920)
    const ref = onFit(mount, 'gameFit')
    computeMetrics(2000, 900)
    mgr!.relayout()
    expect(onFit(mount, 'gameFit').ff).toBeCloseTo(ref.ff, 3)
  })
})

describe('a {holiday} label over an endscene card locks to the clip', () => {
  let mount: HTMLElement
  let mgr: { destroy(): void; relayout(): void } | null = null

  beforeEach(() => {
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    setPromoCalendar(CALENDAR)
    setNowOverride(SHORT_DAY)
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign('center')
    mount = document.createElement('div')
    document.body.appendChild(mount)
  })

  afterEach(() => {
    mgr?.destroy()
    mgr = null
    setNowOverride(null)
    setVAlign(undefined)
  })

  // Position and font as fractions of the LIVE cover-cropped clip.
  const onClip = (vw: number, vh: number): { fx: number; fy: number; ff: number } => {
    document.body.innerHTML = ''
    mount = document.createElement('div')
    document.body.appendChild(mount)
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign('center')
    computeMetrics(vw, vh)
    mgr?.destroy()
    mgr = playProject(makeCard(), assets, { mount, interactive: true })
    q(mount, 'vid').getBoundingClientRect = () => fakeRect(0, 0, vw, vh)
    mgr.relayout()
    const nat = vw > vh ? assets.lvid : assets.pvid
    const m = cover(vw, vh, nat.w, nat.h)
    const node = q(mount, 'cardFit')
    return {
      fx: (parseFloat(node.style.left) - m.left) / m.width,
      fy: (parseFloat(node.style.top) - m.top) / m.height,
      ff: fontPx(mount, 'cardFit') / m.height,
    }
  }

  it('holds its point and size on the clip in both orientations', () => {
    const ref = onClip(1080, 1920)
    for (const [vw, vh] of [[540, 960], [390, 844], [1080, 2400]] as [number, number][]) {
      const got = onClip(vw, vh)
      expect(got.fx).toBeCloseTo(ref.fx, 2)
      expect(got.fy).toBeCloseTo(ref.fy, 2)
      expect(got.ff).toBeCloseTo(ref.ff, 4)
    }
    const wide = onClip(1540, 1135)
    const wider = onClip(2000, 900)
    expect(wider.fx).toBeCloseTo(wide.fx, 2)
    expect(wider.fy).toBeCloseTo(wide.fy, 2)
    expect(wider.ff).toBeCloseTo(wide.ff, 4)
  })

  // The clip's own aspect differs between orientations (a portrait cut and a landscape
  // cut of the card), so the comparable quantity across all five viewports is the shrink
  // FACTOR — how far the long label was scaled down relative to the short one measured
  // on the very same screen.
  it('shrinks the longest label by the same factor at every viewport', () => {
    const factorAt = (vw: number, vh: number): number => {
      setNowOverride(SHORT_DAY)
      const short = onClip(vw, vh)
      setNowOverride(LONG_DAY)
      const long = onClip(vw, vh)
      expect(long.fx).toBeCloseTo(short.fx, 4) // shrinking never moves the label
      expect(long.fy).toBeCloseTo(short.fy, 4)
      return long.ff / short.ff
    }
    const ref = factorAt(1080, 1920)
    expect(ref).toBeLessThan(1) // it really did shrink
    for (const [vw, vh] of VIEWPORTS.slice(1)) expect(factorAt(vw, vh)).toBeCloseTo(ref, 4)
  })
})
