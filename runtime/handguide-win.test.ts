// A handguide teaches the gesture the game asks for. Once the game is WON there is
// no gesture left to teach, so the hand has to go — and stay gone. The idle driver
// otherwise brings it back a few seconds later and it mimes away over the win reveal,
// which reads as the ad being stuck.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

function pointer(type: string, x: number, y: number): PointerEvent {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as PointerEvent
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'touch' })) Object.defineProperty(ev, key, { value, configurable: true })
  return ev
}

// 'tapremove' is the cheapest game to actually WIN in jsdom: tap every obstacle.
const game = (): SceneElement =>
  ({
    id: 'tap-game', type: 'game-mount', name: 'Tap', x: 540, y: 960, w: 1000, h: 800,
    anchor: 'center', zIndex: 1, mode: 'fit',
    game: { templateId: 'tapremove', hintEnabled: false, params: { fadeMs: 0, crossFadeMs: 0 } },
  }) as SceneElement

const mess = (id: string, index: number): SceneElement =>
  ({
    id, type: 'image', name: id, assetId: 'stain', x: 200 + index * 200, y: 900, w: 180, h: 180,
    anchor: 'center', zIndex: 5, mode: 'fit',
    tapRole: { gameId: 'tap-game', role: 'obstacle', index },
  }) as SceneElement

const hand = (extra: Partial<SceneElement> = {}): SceneElement =>
  ({
    id: 'hg', type: 'handguide', name: 'Hint hand', x: 540, y: 1400, w: 60, h: 74,
    anchor: 'center', zIndex: 9, mode: 'fit', assetId: 'hand',
    handguide: { mode: 'tap', periodMs: 800 },
    ...extra,
  }) as unknown as SceneElement

const ASSETS = { stain: { src: 'stain.png', w: 180, h: 180 }, hand: { src: 'hand.png', w: 46, h: 56 } }

function build(elements: SceneElement[]): ReturnType<typeof buildScene> {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'win', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    kind: 'game',
    elements,
  }
  const stage = buildScene(scene, ASSETS, { mount })
  stage.layoutAll()
  stage.startGames(true)
  return stage
}

const q = (stage: ReturnType<typeof buildScene>, id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
const handImg = (stage: ReturnType<typeof buildScene>): HTMLElement => stage.root.querySelector<HTMLElement>('.pa-el[data-id="hg"] img')!
// Down AND up: the handguide's idle driver only re-arms its reappear timer once the
// finger has left the screen, so a down-only tap would park it hidden either way.
const tap = (el: HTMLElement): void => {
  el.dispatchEvent(pointer('pointerdown', 10, 10))
  el.dispatchEvent(pointer('pointerup', 10, 10))
}

describe('handguide: the win takes the hand away', () => {
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

  it('hides the hand on the win and never lets the idle timer bring it back', () => {
    const stage = build([game(), mess('m1', 1), mess('m2', 2), hand()])
    expect(handImg(stage).style.opacity).toBe('1')

    tap(q(stage, 'm1')) // mid-game: hidden by the tap, back after the idle beat
    vi.advanceTimersByTime(8000)
    expect(handImg(stage).style.opacity).toBe('1')

    tap(q(stage, 'm2')) // board clear → win
    expect(handImg(stage).style.opacity).toBe('0')
    vi.advanceTimersByTime(30000)
    expect(handImg(stage).style.opacity).toBe('0')
    // And a stray tap afterwards can't restart the idle cycle either.
    tap(stage.root)
    vi.advanceTimersByTime(30000)
    expect(handImg(stage).style.opacity).toBe('0')

    stage.destroy()
  })

  it('leaves a hand the author put ON the win alone', () => {
    // showOnWin is "appear when the game is won" — that hand points at what comes
    // next, so the win is its cue, not its end.
    const stage = build([game(), mess('m1', 1), hand({ showOnWin: true, hidden: true } as Partial<SceneElement>)])

    tap(q(stage, 'm1')) // the board is clear → won
    vi.advanceTimersByTime(30000) // long past the idle beat that brings it back
    expect(handImg(stage).style.opacity).toBe('1')

    stage.destroy()
  })
})
