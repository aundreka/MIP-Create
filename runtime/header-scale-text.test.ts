// SceneElement.headerScale: a text element sized the way the pinned header band is
// (header.ts) — the box stays in design px and ONE transform scales it, with an
// unrounded anchor. The band holds its design-space position to two decimals at every
// viewport precisely because nothing inside it is computed per-value; these assert a
// text element gains the same property, while plain FIT text quantises to whole px.

import { describe, it, expect, beforeEach } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign, setVAlign, scale } from './responsive'
import type { Project, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920
const X = 511
const Y = 544
const FONT = 51

function makeProject(headerScale?: boolean): Project {
  const elements: SceneElement[] = [
    {
      id: 'label', type: 'text', name: 'Score', x: X, y: Y, anchor: 'center', zIndex: 6, mode: 'fit',
      headerScale,
      text: { value: '0', fontSizePx: FONT, fontWeight: 400, color: '#fff', align: 'center' },
    },
  ]
  return {
    meta: { schemaVersion: 1, name: 'hdr-scale', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H },
    startSceneId: 'game1',
    scenes: [{ id: 'game1', name: 'Game', kind: 'game', elements, advance: { on: 'manual' } }],
  }
}

const SIZES: Array<[number, number]> = [[1080, 1920], [390, 844], [414, 736], [820, 1180], [1083, 714]]

function mountAt(headerScale?: boolean): { el: () => HTMLElement; relayout: () => void } {
  document.body.innerHTML = ''
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  setDesign(DESIGN_W, DESIGN_H)
  setVAlign('top')
  computeMetrics(DESIGN_W, DESIGN_H)
  const mgr = playProject(makeProject(headerScale), {}, { mount, interactive: true })
  return { el: () => mount.querySelector<HTMLElement>('.pa-el[data-id="label"]')!, relayout: () => mgr.relayout() }
}

describe('headerScale text', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('holds its exact design-space position at every viewport — no pixel rounding', () => {
    const { el, relayout } = mountAt(true)
    for (const [w, h] of SIZES) {
      computeMetrics(w, h)
      relayout()
      const s = scale()
      const offX = (w - DESIGN_W * s) / 2
      // Exact, not within-a-pixel: this is the header band's guarantee.
      expect((parseFloat(el().style.left) - offX) / s).toBeCloseTo(X, 6)
      expect(parseFloat(el().style.top) / s).toBeCloseTo(Y, 6)
    }
  })

  it('scales via one transform, leaving the font in design px', () => {
    const { el, relayout } = mountAt(true)
    computeMetrics(390, 844)
    relayout()
    const s = scale()
    const inner = el().querySelector<HTMLElement>('.pa-text-inner')!
    // Font is NOT pre-multiplied — the transform does it, so the rendered size is exact.
    expect(parseFloat(inner.style.fontSize)).toBe(FONT)
    expect(el().style.transform).toContain(`scale(${s})`)
    expect(el().style.transformOrigin).toBe('0 0')
  })

  it('plain FIT text still rounds to whole pixels (unchanged default)', () => {
    const { el, relayout } = mountAt(undefined)
    computeMetrics(414, 736)
    relayout()
    const s = scale()
    expect(parseFloat(el().style.top)).toBe(Math.round(Y * s))
    expect(parseFloat(el().querySelector<HTMLElement>('.pa-text-inner')!.style.fontSize)).toBeCloseTo(FONT * s, 6)
    expect(el().style.transform).not.toContain('scale(')
  })

  it('beats plain FIT on design-space accuracy at awkward scales', () => {
    const a = mountAt(true)
    const b = mountAt(undefined)
    let worstPinned = 0
    let worstPlain = 0
    for (const [w, h] of SIZES) {
      computeMetrics(w, h)
      a.relayout()
      b.relayout()
      const s = scale()
      worstPinned = Math.max(worstPinned, Math.abs(parseFloat(a.el().style.top) / s - Y))
      worstPlain = Math.max(worstPlain, Math.abs(parseFloat(b.el().style.top) / s - Y))
    }
    expect(worstPinned).toBeLessThan(1e-6)
    expect(worstPlain).toBeGreaterThan(worstPinned)
  })
})
