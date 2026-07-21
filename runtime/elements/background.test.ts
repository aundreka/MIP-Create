// Background element: portrait uses the element's assetId; landscape swaps to the
// optional background.landscapeAssetId (and falls back to the portrait art when unset).
// The swap happens in the layout pass, so a rotation re-picks the source with no rebuild.

import { describe, it, expect, beforeEach } from 'vitest'
import { buildScene } from '../stage'
import { computeMetrics, setDesign } from '../responsive'
import type { Scene } from '../scene'
import type { AssetMap } from '../types'

const assets: AssetMap = {
  bgP: { src: 'portrait.png', w: 1080, h: 1920 },
  bgL: { src: 'landscape.png', w: 1920, h: 1080 },
}

const makeScene = (landscapeAssetId?: string): Scene => ({
  meta: { schemaVersion: 1, name: 'bg', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, bgMatchColor: '#000' },
  kind: 'game',
  elements: [
    {
      id: 'bg1', type: 'background', name: 'BG', assetId: 'bgP',
      x: 0, y: 0, anchor: 'top-left', zIndex: 0, mode: 'extend',
      background: { objectFit: 'cover', landscapeAssetId },
    },
  ],
})

describe('background landscape image', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setDesign(1080, 1920)
    computeMetrics(1080, 1920) // portrait
  })

  const img = (mount: HTMLElement): HTMLImageElement => mount.querySelector('.pa-el[data-id="bg1"] img')!

  it('swaps to the landscape asset on rotation and back', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const stage = buildScene(makeScene('bgL'), assets, { mount })
    stage.layoutAll()
    expect(img(mount).getAttribute('src')).toBe('portrait.png')

    computeMetrics(1920, 1080) // rotate to landscape
    stage.layoutAll()
    expect(img(mount).getAttribute('src')).toBe('landscape.png')

    computeMetrics(1080, 1920) // and back
    stage.layoutAll()
    expect(img(mount).getAttribute('src')).toBe('portrait.png')
    stage.destroy()
  })

  it('keeps the portrait art in landscape when no landscape asset is set', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const stage = buildScene(makeScene(), assets, { mount })
    computeMetrics(1920, 1080)
    stage.layoutAll()
    expect(img(mount).getAttribute('src')).toBe('portrait.png')
    stage.destroy()
  })
})
