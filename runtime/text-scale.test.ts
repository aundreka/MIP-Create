// Text elements honor the effective `scale` (landscape override included): font size
// multiplies by it. This is text's only per-orientation size channel — fontSizePx is
// shared config — so a landscape layout can size text independently of portrait.

import { describe, it, expect, beforeEach } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import type { Scene } from './scene'

const makeScene = (): Scene => ({
  meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, bgMatchColor: '#000' },
  kind: 'game',
  elements: [
    {
      id: 't1', type: 'text', name: 'T', x: 540, y: 500,
      anchor: 'center', zIndex: 1, mode: 'fit',
      text: { value: 'Hello', fontSizePx: 100 },
      landscape: { scale: 2 },
    },
  ],
})

const fontPx = (mount: HTMLElement): number => {
  const inner = mount.querySelector<HTMLElement>('.pa-el[data-id="t1"] .pa-text-inner') ??
    (mount.querySelector('.pa-el[data-id="t1"] .pa-textbox')?.firstElementChild as HTMLElement)
  return parseFloat(inner.style.fontSize)
}

describe('text landscape scale', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setDesign(1080, 1920)
  })

  it('portrait ignores the landscape scale; landscape doubles the font', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)

    computeMetrics(1080, 1920) // portrait, FIT scale = 1
    const stage = buildScene(makeScene(), {}, { mount })
    stage.layoutAll()
    expect(fontPx(mount)).toBeCloseTo(100, 1)

    computeMetrics(1920, 1080) // landscape, FIT scale = 1080/1920 = 0.5625
    stage.layoutAll()
    expect(fontPx(mount)).toBeCloseTo(100 * 0.5625 * 2, 1) // × landscape scale override

    computeMetrics(1080, 1920) // back to portrait — unchanged
    stage.layoutAll()
    expect(fontPx(mount)).toBeCloseTo(100, 1)
    stage.destroy()
  })
})
