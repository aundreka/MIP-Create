// Swipe cards (like / pass): cards from uploads or from placed elements, fitted rather
// than cropped, with no chrome unless the author adds it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

function game(params: Record<string, unknown> = {}): SceneElement {
  return {
    id: 'g',
    type: 'game-mount',
    name: 'Swipe',
    x: 540,
    y: 960,
    w: 1000,
    h: 1000,
    anchor: 'center',
    zIndex: 1,
    mode: 'fit',
    game: { templateId: 'swipe', hintEnabled: false, params },
  } as SceneElement
}

const photo: SceneElement = { id: 'photo', type: 'image', name: 'Photo', assetId: 'wide', x: 540, y: 300, w: 800, h: 400, anchor: 'center', zIndex: 5, mode: 'fit' } as SceneElement

function build(elements: SceneElement[]): ReturnType<typeof buildScene> {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const scene: Scene = { meta: { schemaVersion: 1, name: 's', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 }, kind: 'game', elements }
  const stage = buildScene(scene, { wide: { src: 'wide.png', w: 800, h: 400 } }, { mount })
  stage.layoutAll()
  return stage
}

const cardsOf = (s: ReturnType<typeof buildScene>): HTMLElement[] =>
  Array.from(s.root.querySelectorAll<HTMLElement>('[data-id="g"] .pa-game > div, [data-id="g"] div[style*="cursor: grab"]')).filter((d) => d.style.cursor === 'grab')

describe('swipe (like / pass)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('fits an uploaded picture instead of cropping it, with no forced chrome', () => {
    const stage = build([game({ count: 1, images: ['wide'] })])
    stage.startGames(true)
    const [card] = cardsOf(stage)
    expect(card.querySelector('img')!.style.objectFit).toBe('contain')
    expect(card.style.boxShadow).toBe('')
    expect(card.style.borderRadius).toBe('')
    expect(card.style.border).toBe('')
  })

  it('applies the chrome the author chose', () => {
    const stage = build([game({ count: 1, images: ['wide'], cardRadius: 20, cardShadow: 'soft', cardBorder: 3, cardBorderColor: '#ff0000' })])
    stage.startGames(true)
    const [card] = cardsOf(stage)
    expect(card.style.borderRadius).not.toBe('')
    expect(card.style.boxShadow).not.toBe('')
    expect(card.style.border).toContain('solid')
  })

  it('uses a placed element as a card, hiding the original in play', () => {
    const stage = build([game({ count: 1, cardElements: ['photo'] }), photo])
    stage.startGames(true)
    const [card] = cardsOf(stage)
    expect(card.querySelector('img')?.getAttribute('src')).toBe('wide.png')
    expect(stage.root.querySelector<HTMLElement>('[data-id="photo"]')!.classList.contains('pa-combo-off')).toBe(true)
  })

  it('a single card is won with one swipe', () => {
    const seen: string[] = []
    const off = on('game-complete', () => seen.push('win'))
    const stage = build([game({ count: 1, images: ['wide'] })])
    stage.startGames(true)
    const cards = cardsOf(stage)
    expect(cards).toHaveLength(1)
    const card = cards[0]
    const ev = (type: string, x: number): PointerEvent => {
      const e = new MouseEvent(type, { clientX: x, clientY: 500, bubbles: true }) as unknown as PointerEvent
      Object.defineProperty(e, 'pointerId', { value: 1 })
      return e
    }
    card.setPointerCapture = () => {}
    card.dispatchEvent(ev('pointerdown', 100))
    card.dispatchEvent(ev('pointermove', 2000))
    card.dispatchEvent(ev('pointerup', 2000))
    vi.runAllTimers()
    expect(seen).toEqual(['win'])
    off()
  })
})
