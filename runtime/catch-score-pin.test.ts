// The catch score counter must hold the SAME physical position as the pinned
// header band (header.ts) on every device: top = y * FIT scale, measured from the
// physical top of the screen. As a plain FIT text it would instead sit at
// sy(y) = letterbox offset + y * scale, so on a project using meta.vAlign 'center'
// it slides down while the header stays glued to the top.

import { describe, it, expect, beforeEach } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, scale, setDesign, setVAlign } from './responsive'
import type { Project } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920
const SCORE_Y = 150

function makeProject(vAlign?: 'top' | 'center'): Project {
  return {
    meta: {
      schemaVersion: 1,
      name: 'catch-score',
      clickUrl: { ios: '', android: '' },
      baseW: DESIGN_W,
      baseH: DESIGN_H,
      bgMatchColor: '#101a33',
      vAlign,
      header: { heightPx: 170, fontSizePx: 64 },
    },
    startSceneId: 'game',
    scenes: [
      {
        id: 'game',
        name: 'Game',
        kind: 'game',
        advance: { on: 'manual' },
        elements: [
          {
            id: 'score_counter', type: 'text', name: 'Score Counter',
            x: 540, y: SCORE_Y, anchor: 'center', zIndex: 13, mode: 'fit',
            text: { value: '0', fontSizePx: 48, fontWeight: 800, color: '#fff', align: 'center' },
          },
          {
            id: 'basket_bar', type: 'bar', name: 'Footer bar',
            x: 540, y: 1920, h: 170, anchor: 'bottom', zIndex: 10, mode: 'extend', pin: 'bottom',
            bar: { color: '#1b2a4a' },
          },
          {
            id: 'catch_mount', type: 'game-mount', name: 'Catch',
            x: 540, y: 1000, w: 1080, h: 1400, anchor: 'center', zIndex: 5, mode: 'fit',
            game: { templateId: 'catch', params: { itemTypes: 0, catches: 3, spawnMs: 100000 } },
          },
        ],
      },
    ],
  }
}

// Phones, a tablet, a short desktop window and landscape — every letterbox shape.
const SIZES: Array<[number, number]> = [
  [1080, 1920], // design
  [390, 844],   // tall phone
  [414, 736],   // short phone
  [820, 1180],  // tablet (wide aspect -> horizontal letterbox)
  [900, 500],   // landscape
]

function scoreTops(vAlign?: 'top' | 'center'): number[] {
  document.body.innerHTML = ''
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  setDesign(DESIGN_W, DESIGN_H)
  setVAlign(vAlign) // boot()/frame.ts do this from project.meta; playProject does not
  computeMetrics(...SIZES[0])
  const mgr = playProject(makeProject(vAlign), {}, { mount, interactive: true })
  const tops = SIZES.map(([w, h]) => {
    computeMetrics(w, h)
    mgr.relayout()
    const el = mount.querySelector<HTMLElement>('.pa-el[data-id="score_counter"]')!
    // The header's model is a constant design-px distance from the PHYSICAL top,
    // so the score's physical top must be SCORE_Y * scale at every size (within
    // the 1px the layout's integer rounding can move it).
    return parseFloat(el.style.top) - SCORE_Y * scale()
  })
  mgr.destroy()
  return tops
}

describe('catch score counter is pinned like the header band', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('holds a constant scaled distance from the physical top (vAlign top)', () => {
    for (const d of scoreTops('top')) expect(Math.abs(d)).toBeLessThanOrEqual(1)
  })

  it('ignores the vertical letterbox offset (vAlign center)', () => {
    for (const d of scoreTops('center')) expect(Math.abs(d)).toBeLessThanOrEqual(1)
  })

  it('stays put across repeated relayouts with no layout pass drift', () => {
    document.body.innerHTML = ''
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    setDesign(DESIGN_W, DESIGN_H)
    setVAlign('center')
    computeMetrics(390, 844)
    const mgr = playProject(makeProject('center'), {}, { mount, interactive: true })
    const top = () => parseFloat(mount.querySelector<HTMLElement>('.pa-el[data-id="score_counter"]')!.style.top)
    const first = top()
    for (let i = 0; i < 5; i++) mgr.relayout()
    expect(top()).toBeCloseTo(first, 1)
    expect(Math.abs(first - SCORE_Y * scale())).toBeLessThanOrEqual(1)
    mgr.destroy()
  })
})
