import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Scene } from './scene'
import { buildScene } from './stage'

describe('basket game-won sound binding', () => {
  const played: string[] = []
  let off: (() => void) | undefined

  beforeEach(() => {
    document.body.innerHTML = ''
    played.length = 0
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    vi.useFakeTimers()
    off = on('sfx-asset', (id: unknown) => played.push(String(id)))
  })

  afterEach(() => {
    off?.()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('plays the sound authored for When the game is won', () => {
    const scene: Scene = {
      meta: { schemaVersion: 1, name: 'basket sfx', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      kind: 'game',
      elements: [
        {
          id: 'basket-game',
          type: 'game-mount',
          name: 'Basket',
          x: 540,
          y: 960,
          w: 900,
          h: 1200,
          anchor: 'center',
          zIndex: 5,
          mode: 'fit',
          game: { templateId: 'basket', params: { itemCount: 1 }, hintEnabled: false },
          sfx: [{ event: 'onReveal', assetId: 'basket-win' }],
        },
      ],
    }
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const stage = buildScene(scene, { 'basket-win': { src: 'basket-win.mp3', w: 0, h: 0 } }, { mount })
    stage.layoutAll()
    stage.startGames(true)

    const target = mount.querySelector<HTMLElement>('[data-basket-target]')!
    const item = mount.querySelector<HTMLElement>('[data-basket-item]')!
    const from = {
      x: parseFloat(item.style.left) + parseFloat(item.style.width) / 2,
      y: parseFloat(item.style.top) + parseFloat(item.style.height) / 2,
    }
    const to = {
      x: parseFloat(target.style.left) + parseFloat(target.style.width) / 2,
      y: parseFloat(target.style.top) + parseFloat(target.style.height) / 2,
    }
    item.dispatchEvent(new MouseEvent('pointerdown', { clientX: from.x, clientY: from.y, bubbles: true }))
    item.dispatchEvent(new MouseEvent('pointermove', { clientX: to.x, clientY: to.y, bubbles: true }))
    item.dispatchEvent(new MouseEvent('pointerup', { clientX: to.x, clientY: to.y, bubbles: true }))

    expect(item.dataset.basketPlaced).toBe('1')
    expect(played).toEqual(['basket-win'])
    vi.advanceTimersByTime(600)
    expect(played).toEqual(['basket-win'])
    stage.destroy()
  })
})
