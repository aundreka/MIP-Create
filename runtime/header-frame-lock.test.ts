// Where the band sits vertically when it is NOT riding an endscene clip.
//
// The band belongs to the composition, so design y 0 for the band has to be design y 0
// for everything else: `sy(0)` — the FIT frame's top edge. That is the screen top in a
// top-anchored project (the default), and half the letterbox in a `vAlign:'center'` one.
// The band used to ignore that second term, so on any viewport TALLER than the design
// aspect — every narrow phone against a 9:16 design — it slid up relative to the content
// by half the letterbox: a date composed inside the CTA drifted out of the button and
// onto the background.
//
// The bar art still has to touch the physical screen edge, so the fix keeps the band's
// BOX at top:0 and pads its content down instead. What these assert is therefore the
// content origin — top + paddingTop x scale — held at a constant design-space distance
// from the composition at every viewport.

import { describe, it, expect, afterEach } from 'vitest'
import { mountHeader } from './header'
import { computeMetrics, metrics, setDesign, setVAlign, sy } from './responsive'

const DESIGN_W = 1080
const DESIGN_H = 1920
const HEIGHT = 3519 // the real MIP's trick for a low band: a tall box centres its text

// Narrower than 9:16 (letterboxed top/bottom) plus the design aspect itself.
const VIEWPORTS: Array<[number, number]> = [
  [1080, 1920],
  [442, 951],
  [390, 844],
  [360, 800],
  [430, 932],
]

function mount(opts: Parameters<typeof mountHeader>[1] = {}): { band: HTMLElement; relayout: () => void } {
  const host = document.createElement('div')
  host.className = 'pa-test-mount'
  document.body.appendChild(host)
  const h = mountHeader(host, { heightPx: HEIGHT, fontSizePx: 40, ...opts })
  return { band: host.querySelector<HTMLElement>('.pa-header')!, relayout: h.relayout }
}

const bandScale = (band: HTMLElement): number => parseFloat(/scale\(([-\d.]+)\)/.exec(band.style.transform)?.[1] ?? '0')
/** Screen y of the band's design y 0 — box top plus the bleed padding it scales. */
const originY = (band: HTMLElement): number =>
  (parseFloat(band.style.top) || 0) + (parseFloat(band.style.paddingTop) || 0) * bandScale(band)
/** Screen y of the band's vertically centred text, from the box geometry alone. */
const textMidY = (band: HTMLElement): number => originY(band) + (HEIGHT / 2) * bandScale(band)

afterEach(() => {
  document.body.innerHTML = ''
  setVAlign('top')
})

describe('a band that is not on a clip rides the FIT frame', () => {
  it('puts its design y 0 exactly on sy(0) at every viewport, centred project', () => {
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign('center')
    for (const [vw, vh] of VIEWPORTS) {
      document.body.innerHTML = ''
      computeMetrics(vw, vh)
      const { band } = mount()
      expect(originY(band)).toBeCloseTo(sy(0), 5)
    }
  })

  it('holds the text a constant design distance from the content, centred project', () => {
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign('center')
    // Design-space y of the band's text, measured through the layout the same way any
    // element is: it must come out as the authored HEIGHT/2 on every screen.
    for (const [vw, vh] of VIEWPORTS) {
      document.body.innerHTML = ''
      computeMetrics(vw, vh)
      const { band } = mount()
      const m = metrics()
      expect((textMidY(band) - m.offY) / m.s).toBeCloseTo(HEIGHT / 2, 4)
    }
  })

  it('leaves a top-anchored project (the default) exactly where it was', () => {
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign('top')
    for (const [vw, vh] of VIEWPORTS) {
      document.body.innerHTML = ''
      computeMetrics(vw, vh)
      const { band } = mount()
      expect(parseFloat(band.style.top)).toBe(0)
      expect(parseFloat(band.style.paddingTop) || 0).toBe(0)
      expect(parseFloat(band.style.height)).toBe(HEIGHT) // no bleed added
      expect(originY(band)).toBe(0)
    }
  })

  it('bleeds the bar art up to the physical screen top in a centred project', () => {
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign('center')
    computeMetrics(390, 844)
    const { band } = mount({ bgColor: '#123456' })
    const m = metrics()
    // The box still starts at the screen edge, and the strip above the frame is painted.
    expect(parseFloat(band.style.top)).toBe(0)
    expect(band.style.backgroundColor).toBe('rgb(18, 52, 86)')
    expect(parseFloat(band.style.paddingTop)).toBeCloseTo(m.offY / m.s, 4)
    // Padding is on top of the authored height, so the bar's own band is undiminished.
    expect(parseFloat(band.style.height)).toBeCloseTo(HEIGHT + m.offY / m.s, 4)
  })

  it('does not paint the band itself when there is nothing to bleed over', () => {
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign('top')
    computeMetrics(390, 844)
    const { band } = mount({ bgColor: '#123456' })
    // Top-anchored: the surface alone carries the colour, so a transform entrance still
    // animates the whole bar in rather than revealing a static painted box.
    expect(band.style.backgroundColor).toBe('')
    expect(band.querySelector<HTMLElement>('.pa-header-surface')!.style.backgroundColor).toBe('rgb(18, 52, 86)')
  })

  it('follows the frame across a rotation, not just at mount', () => {
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign('center')
    computeMetrics(390, 844)
    const { band, relayout } = mount()
    computeMetrics(844, 390) // landscape: the frame is height-driven, no vertical letterbox
    relayout()
    expect(originY(band)).toBeCloseTo(sy(0), 5)
    computeMetrics(360, 800)
    relayout()
    expect(originY(band)).toBeCloseTo(sy(0), 5)
  })
})
