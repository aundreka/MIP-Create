// The editable Basket handguide follows the item currently marked by the game
// and mimes a drag to the basket without moving the item itself.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

const PERIOD = 1000
let now = 0

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect
}

function paintFrame(ms: number): void {
  now = ms
  vi.advanceTimersByTime(20)
}

describe('editable handguide: basket mode', () => {
  beforeEach(() => {
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    vi.useFakeTimers()
    now = 0
    vi.stubGlobal('performance', { now: () => now })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(now), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('retargets the animated drag when the next unplaced item changes', () => {
    const guide: SceneElement = {
      id: 'hg',
      type: 'handguide',
      name: 'Hint hand',
      x: 540,
      y: 900,
      w: 60,
      h: 74,
      anchor: 'center',
      zIndex: 9,
      mode: 'fit',
      assetId: 'hand',
      handguide: { mode: 'basket', periodMs: PERIOD },
    }
    const scene: Scene = {
      meta: { schemaVersion: 1, name: 'basket hand', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      elements: [guide],
      kind: 'game',
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const stage = buildScene(scene, { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
    stage.layoutAll()

    const runtimeRoot = host.querySelector('.pa-root') as HTMLElement
    const basket = document.createElement('div')
    basket.dataset.basketTarget = '1'
    basket.getBoundingClientRect = () => rect(160, 180, 80, 120)
    runtimeRoot.appendChild(basket)
    const first = document.createElement('div')
    first.dataset.basketHint = '1'
    first.getBoundingClientRect = () => rect(20, 40, 80, 80)
    runtimeRoot.appendChild(first)

    const guideOuter = host.querySelector('.pa-el[data-id="hg"]') as HTMLElement
    guideOuter.getBoundingClientRect = () => rect(0, 0, 60, 74)
    stage.startGames(true)
    paintFrame(PERIOD * 0.5)

    const visual = guideOuter.querySelector('img') as HTMLElement
    expect(visual.style.transform).toContain('translate(117px,151px)')

    delete first.dataset.basketHint
    const second = document.createElement('div')
    second.dataset.basketHint = '1'
    second.getBoundingClientRect = () => rect(190, 10, 60, 60)
    runtimeRoot.appendChild(second)
    paintFrame(PERIOD * 1.5)
    expect(visual.style.transform).toContain('translate(197px,131px)')
  })
})
