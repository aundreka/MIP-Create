// Regression: text/countdown elements are plain FIT content. They must scale
// and keep their designed position relative to other FIT elements at every
// viewport size — same math as images (sy(y) = letterbox + y*scale). A leftover
// `pin` value on a text element (from scenes saved when text pinning existed)
// is deliberately ignored; `pin` is bar-only.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign } from './responsive'
import type { Project, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920

function makeProject(pin?: 'top'): Project {
  const elements: SceneElement[] = [
    // FIT-positioned reference at the same design y as the countdown.
    {
      id: 'ref',
      type: 'cta',
      name: 'Ref',
      x: 540,
      y: 100,
      w: 400,
      h: 120,
      anchor: 'center',
      zIndex: 5,
      mode: 'fit',
      text: { value: 'REF', fontSizePx: 40 },
    },
    {
      id: 'cd',
      type: 'countdown',
      name: 'Countdown',
      x: 540,
      y: 100,
      anchor: 'center',
      zIndex: 6,
      mode: 'fit',
      pin,
      text: { value: '', fontSizePx: 60, fontWeight: 800, color: '#fff', align: 'center' },
      countdown: { mode: 'dynamic', dynamicDays: 1, format: '{hh}:{mm}:{ss}' },
    },
  ]
  return {
    meta: {
      schemaVersion: 1,
      name: 'pinned-text',
      clickUrl: { ios: '', android: '' },
      baseW: DESIGN_W,
      baseH: DESIGN_H,
      bgMatchColor: '#111111',
    },
    startSceneId: 'game1',
    scenes: [{ id: 'game1', name: 'Game', kind: 'game', elements, advance: { on: 'manual' } }],
  }
}

const SIZES: Array<[number, number]> = [
  [390, 844], // taller than the design aspect (spare height at the bottom)
  [390, 600], // height-limited portrait
  [390, 500],
]

/** Lay out at each size; return |cd.top - ref.top| per size. */
function drift(pin?: 'top'): number[] {
  document.body.innerHTML = ''
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  setDesign(DESIGN_W, DESIGN_H)
  computeMetrics(...SIZES[0])
  const mgr = playProject(makeProject(pin), {}, { mount, interactive: true })
  const top = (id: string) => parseFloat(mount.querySelector<HTMLElement>(`.pa-el[data-id="${id}"]`)!.style.top)
  return SIZES.map(([w, h]) => {
    computeMetrics(w, h)
    mgr.relayout()
    return Math.abs(top('cd') - top('ref'))
  })
}

describe('countdown positioning across viewport heights', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('countdown tracks FIT content exactly at every viewport size', () => {
    for (const d of drift(undefined)) expect(d).toBeLessThan(1)
  })

  it('a legacy pin value on a text element is ignored (still plain FIT)', () => {
    for (const d of drift('top')) expect(d).toBeLessThan(1)
  })
})
