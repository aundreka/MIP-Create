import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeMetrics, setDesign } from './responsive'
import type { Scene } from './scene'
import { buildScene } from './stage'

describe('basket scene image authoring', () => {
  beforeEach(() => {
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('marks basket-item images as interactive and lets the game replace internal slots', () => {
    const scene: Scene = {
      meta: { schemaVersion: 1, name: 'scene items', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      kind: 'game',
      elements: [
        {
          id: 'basket-game',
          type: 'game-mount',
          name: 'Basket',
          x: 540,
          y: 1040,
          w: 900,
          h: 900,
          anchor: 'center',
          zIndex: 5,
          mode: 'fit',
          game: { templateId: 'basket', params: { itemCount: 6 } },
        },
        {
          id: 'gift-one',
          type: 'image',
          name: 'Gift one',
          assetId: 'gift',
          x: 240,
          y: 350,
          w: 220,
          h: 100,
          anchor: 'center',
          zIndex: 10,
          mode: 'fit',
          basketItem: { gameId: 'basket-game' },
        },
      ],
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const stage = buildScene(scene, { gift: { src: 'gift.png', w: 220, h: 100 } }, { mount: host })
    stage.layoutAll()
    stage.startGames(false)

    const item = host.querySelector<HTMLElement>('[data-id="gift-one"]')!
    const game = host.querySelector<HTMLElement>('[data-id="basket-game"] .pa-game')!
    expect(item.dataset.basketSceneItem).toBe('1')
    expect(item.dataset.basketGameId).toBe('basket-game')
    expect(item.style.pointerEvents).not.toBe('none')
    expect(item.dataset.basketHint).toBe('1')
    expect(game.querySelector('[data-basket-item]')).toBeNull()
  })
})
