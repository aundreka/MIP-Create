// Swipe cards (like / pass): cards from uploads or from placed elements, fitted rather
// than cropped, with no chrome unless the author adds it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

function game(params: Record<string, unknown> = {}, extra: Partial<SceneElement> = {}): SceneElement {
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
    ...extra,
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

/** Drag the top card a long way toward `dir` and let go. */
function swipeTop(stage: ReturnType<typeof buildScene>, dir: 1 | -1): void {
  const card = cardsOf(stage).sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex))[0]
  const ev = (type: string, x: number): PointerEvent => {
    const e = new MouseEvent(type, { clientX: x, clientY: 500, bubbles: true }) as unknown as PointerEvent
    Object.defineProperty(e, 'pointerId', { value: 1 })
    return e
  }
  card.dispatchEvent(ev('pointerdown', 1000))
  window.dispatchEvent(ev('pointermove', 1000 + dir * 2000))
  window.dispatchEvent(ev('pointerup', 1000 + dir * 2000))
  vi.runAllTimers()
}

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

  it('does not clip a card dragged past the game box', () => {
    const stage = build([game({ count: 1, images: ['wide'] })])
    stage.startGames(true)
    expect(stage.root.querySelector<HTMLElement>('[data-id="g"] .pa-game')!.style.overflow).toBe('visible')
  })

  it('plays the sounds bound to a swipe right, a swipe left, the next card and the win', () => {
    const played: string[] = []
    const off = on('sfx-asset', (id: unknown) => played.push(String(id)))
    const sfx = ['swipeLike', 'swipeNope', 'swipeNext', 'onReveal'].map((event) => ({ event, assetId: event + '.mp3' }))
    const stage = build([game({ count: 2, images: ['wide', 'wide'] }, { sfx })])
    stage.startGames(true)
    swipeTop(stage, 1)
    expect(played).toEqual(['swipeLike.mp3', 'swipeNext.mp3'])
    swipeTop(stage, -1)
    expect(played).toEqual(['swipeLike.mp3', 'swipeNext.mp3', 'swipeNope.mp3', 'onReveal.mp3'])
    off()
  })

  it('fires the hover beats as a dragged card leans to each side, once per lean', () => {
    const played: string[] = []
    const off = on('sfx-asset', (id: unknown) => played.push(String(id)))
    const sfx = ['swipeHoverRight', 'swipeHoverLeft'].map((event) => ({ event, assetId: event }))
    const stage = build([game({ count: 1, images: ['wide'] }, { sfx }), photo])
    stage.startGames(true)
    const card = cardsOf(stage)[0]
    const ev = (type: string, x: number): PointerEvent => {
      const e = new MouseEvent(type, { clientX: x, clientY: 500, bubbles: true }) as unknown as PointerEvent
      Object.defineProperty(e, 'pointerId', { value: 1 })
      return e
    }
    card.dispatchEvent(ev('pointerdown', 500))
    for (const x of [520, 560, 600, 500, 400, 420, 500]) window.dispatchEvent(ev('pointermove', x))
    window.dispatchEvent(ev('pointerup', 500))
    expect(played).toEqual(['swipeHoverRight', 'swipeHoverLeft'])
    off()
  })

  it('enlarges an element while the card leans right, and eases it back when the lean ends', () => {
    const grow = { preset: 'enlarge' as const, scaleTo: 1.3, durationMs: 200, delayMs: 0, easing: 'ease-out' }
    const badge = { ...photo, id: 'badge', animations: { swipeHoverRight: grow } } as SceneElement
    const stage = build([game({ count: 1, images: ['wide'] }), badge])
    stage.startGames(true)
    const anim = (): string => stage.root.querySelector<HTMLElement>('[data-id="badge"] .pa-el-anim')!.style.animation
    const card = cardsOf(stage)[0]
    const ev = (type: string, x: number): PointerEvent => {
      const e = new MouseEvent(type, { clientX: x, clientY: 500, bubbles: true }) as unknown as PointerEvent
      Object.defineProperty(e, 'pointerId', { value: 1 })
      return e
    }
    card.dispatchEvent(ev('pointerdown', 500))
    expect(anim()).not.toContain('pa-custom')
    window.dispatchEvent(ev('pointermove', 600))
    const grown = anim()
    expect(grown).toContain('pa-custom')
    // Still leaning right: nothing replays.
    window.dispatchEvent(ev('pointermove', 650))
    expect(anim()).toBe(grown)
    // Back to the middle: a different (shrinking) animation takes over.
    window.dispatchEvent(ev('pointermove', 500))
    expect(anim()).toContain('pa-custom')
    expect(anim()).not.toBe(grown)
    window.dispatchEvent(ev('pointerup', 500))
  })

  it('a single card is won with one swipe', () => {
    const seen: string[] = []
    const off = on('game-complete', () => seen.push('win'))
    const stage = build([game({ count: 1, images: ['wide'] })])
    stage.startGames(true)
    const cards = cardsOf(stage)
    expect(cards).toHaveLength(1)
    swipeTop(stage, 1)
    expect(seen).toEqual(['win'])
    off()
  })
})
