// Tap to reveal: the elements a board brings up, and the taps that bring them.
//
// The load-bearing case is the one with NO covers at all — a list of hidden elements,
// one per tap — since that is the plain board and the one an author reaches for first.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

function pointer(type: string, x: number, y: number, init: { pointerId?: number; pointerType?: string } = {}): PointerEvent {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as PointerEvent
  for (const [key, value] of Object.entries(init)) Object.defineProperty(ev, key, { value, configurable: true })
  return ev
}

function game(params: Record<string, unknown> = {}): SceneElement {
  return {
    id: 'reveal-game',
    type: 'game-mount',
    name: 'Reveal',
    x: 540,
    y: 960,
    w: 1000,
    h: 800,
    anchor: 'center',
    zIndex: 1,
    mode: 'fit',
    game: { templateId: 'tapreveal', hintEnabled: false, params: { fadeMs: 0, revealMs: 0, ...params } },
  } as SceneElement
}

function bar(params: Record<string, unknown> = {}): SceneElement {
  return {
    id: 'bar',
    type: 'game-mount',
    name: 'Bar',
    x: 540,
    y: 200,
    w: 900,
    h: 40,
    anchor: 'center',
    zIndex: 2,
    mode: 'fit',
    game: { templateId: 'progressbar', hintEnabled: false, params: { fillMs: 0, popMs: 0, ...params } },
  } as SceneElement
}

function cover(id: string, n: number): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'lid',
    x: 200 + n * 200,
    y: 900,
    w: 180,
    h: 180,
    anchor: 'center',
    zIndex: 6,
    mode: 'fit',
    revealRole: { gameId: 'reveal-game', role: 'cover' },
  } as SceneElement
}

function prize(id: string, ofId: string, n: number, showOnCanvas?: boolean): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'prize',
    x: 200 + n * 200,
    y: 900,
    w: 180,
    h: 180,
    anchor: 'center',
    zIndex: 4,
    mode: 'fit',
    revealRole: { gameId: 'reveal-game', role: 'reveal', ofId: ofId || undefined, showOnCanvas },
  } as SceneElement
}

const ASSETS = {
  lid: { src: 'lid.png', w: 180, h: 180 },
  prize: { src: 'prize.png', w: 180, h: 180 },
  dingSfx: { src: 'ding.mp3', w: 0, h: 0 },
}

function build(elements: SceneElement[]): ReturnType<typeof buildScene> {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'reveal', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    kind: 'game',
    elements,
  }
  return buildScene(scene, ASSETS, { mount })
}

const q = (s: ReturnType<typeof buildScene>, id: string): HTMLElement => s.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
const tap = (el: HTMLElement): void => void el.dispatchEvent(pointer('pointerdown', 10, 10, { pointerId: 1, pointerType: 'touch' }))
const hidden = (el: HTMLElement): boolean => el.classList.contains('pa-combo-off')

describe('tap to reveal', () => {
  let off: (() => void) | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })

  afterEach(() => {
    off?.()
    off = null
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('tags roles and keeps covers tappable', () => {
    const stage = build([game(), cover('c1', 1), prize('p1', 'c1', 1)])
    stage.layoutAll()
    stage.startGames(false)

    const c = q(stage, 'c1')
    expect(c.dataset.revealRole).toBe('cover')
    expect(c.dataset.revealGameId).toBe('reveal-game')
    expect(q(stage, 'p1').dataset.revealOf).toBe('c1')
    expect(c.style.pointerEvents).not.toBe('none')
    // The cover is part of the board being arranged; the prize is what stays hidden.
    expect(hidden(c)).toBe(false)
    expect(hidden(q(stage, 'p1'))).toBe(true)
  })

  it('brings up every image that cover reveals, and leaves them up', () => {
    const stage = build([game(), cover('c1', 1), cover('c2', 2), prize('p1', 'c1', 1), prize('p1b', 'c1', 1), prize('p2', 'c2', 2)])
    stage.layoutAll()
    stage.startGames(true)

    tap(q(stage, 'c1'))
    expect(hidden(q(stage, 'p1'))).toBe(false)
    expect(hidden(q(stage, 'p1b'))).toBe(false)
    // c2's prize is still waiting for its own tap.
    expect(hidden(q(stage, 'p2'))).toBe(true)

    // Revealed art STAYS — that is the point of the mechanic, as against tap-to-remove.
    tap(q(stage, 'c2'))
    vi.runAllTimers()
    expect(hidden(q(stage, 'p1'))).toBe(false)
    expect(hidden(q(stage, 'p1b'))).toBe(false)
  })

  it('reveals an element with no cover at all, one per tap anywhere', () => {
    // The plain board: nothing to tap ON, just things to bring up. Each tap in the
    // scene takes the next one, in the order the author stacked them.
    const stage = build([game(), prize('p1', '', 1), prize('p2', '', 2)])
    stage.layoutAll()
    stage.startGames(true)
    const root = stage.root

    expect(hidden(q(stage, 'p1'))).toBe(true)
    expect(hidden(q(stage, 'p2'))).toBe(true)

    tap(root)
    expect(hidden(q(stage, 'p1'))).toBe(false)
    expect(hidden(q(stage, 'p2'))).toBe(true) // one per tap, not all at once

    tap(root)
    expect(hidden(q(stage, 'p2'))).toBe(false)
  })

  it('does not spend a free tap when the tap landed on one of its covers', () => {
    // A board that mixes the two: tapping the cover must open the cover's step ONLY.
    // Counting the same gesture twice would burn two steps on one tap.
    const stage = build([game(), cover('c1', 1), prize('p1', 'c1', 1), prize('free', '', 2)])
    stage.layoutAll()
    stage.startGames(true)

    tap(q(stage, 'c1'))
    expect(hidden(q(stage, 'p1'))).toBe(false)
    expect(hidden(q(stage, 'free'))).toBe(true)

    tap(stage.root)
    expect(hidden(q(stage, 'free'))).toBe(false)
  })

  it('does not spend a free tap on a button that navigates away', () => {
    const cta = {
      id: 'cta',
      type: 'cta',
      name: 'CTA',
      x: 540,
      y: 1600,
      w: 700,
      h: 170,
      anchor: 'center',
      zIndex: 12,
      mode: 'fit',
      text: { value: 'PLAY', fontSizePx: 60, color: '#fff' },
    } as SceneElement

    const stage = build([game(), prize('p1', '', 1), cta])
    stage.layoutAll()
    stage.startGames(true)

    tap(stage.root.querySelector<HTMLElement>('.pa-cta')!)
    // The tap that leaves the scene is the button's gesture; spending a step on it is
    // invisible to the player and desyncs the bar from what they actually saw.
    expect(hidden(q(stage, 'p1'))).toBe(true)

    tap(stage.root)
    expect(hidden(q(stage, 'p1'))).toBe(false)
  })

  it('counts a shared cover as one step, not one per image', () => {
    const stage = build([game(), bar(), cover('c1', 1), prize('p1', 'c1', 1), prize('p1b', 'c1', 1), prize('p1c', 'c1', 1)])
    stage.layoutAll()
    stage.startGames(true)
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!

    // Three images, one tap — a prize plus a glow plus a caption is one beat of play.
    expect(track.dataset.progressTotal).toBe('1')
    tap(q(stage, 'c1'))
    expect(track.dataset.progressValue).toBe('1')
  })

  it('points the hint at the game’s own box when there is nothing to tap on', () => {
    const stage = build([game(), prize('p1', '', 1)])
    stage.layoutAll()
    stage.startGames(true)
    // No cover means nothing on screen to aim at, so the marker goes on the mount — an
    // invisible box, but one the author drew and placed for exactly this.
    const slot = stage.root.querySelector<HTMLElement>('.pa-game')!
    expect(slot.dataset.revealHint).toBe('1')

    tap(stage.root)
    expect(slot.dataset.revealHint).toBeUndefined()
  })

  it('a cover with nothing under it just leaves, showing what is behind', () => {
    const stage = build([game(), cover('c1', 1)])
    stage.layoutAll()
    stage.startGames(true)

    tap(q(stage, 'c1'))
    expect(hidden(q(stage, 'c1'))).toBe(true)
  })

  it('keeps the cover in place when the board is a light-it-up', () => {
    const stage = build([game({ coverAfter: 'stay' }), cover('c1', 1), prize('p1', 'c1', 1)])
    stage.layoutAll()
    stage.startGames(true)

    tap(q(stage, 'c1'))
    // The cover stays visible — but inert, so it cannot be counted twice.
    expect(hidden(q(stage, 'c1'))).toBe(false)
    expect(q(stage, 'c1').style.pointerEvents).toBe('none')
    expect(hidden(q(stage, 'p1'))).toBe(false)
  })

  it('counts a rapid triple-tap on one cover once', () => {
    const stage = build([game({ fadeMs: 400 }), bar(), cover('c1', 1), cover('c2', 2), cover('c3', 3)])
    stage.layoutAll()
    stage.startGames(true)
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!

    tap(q(stage, 'c1'))
    tap(q(stage, 'c1'))
    tap(q(stage, 'c1'))
    expect(track.dataset.progressValue).toBe('1')
  })

  it('is won when every cover is open, and earlier on a win target', () => {
    const seen: string[] = []
    off = on('game-complete', () => seen.push('win'))
    const stage = build([game({ winSteps: 2 }), cover('c1', 1), cover('c2', 2), cover('c3', 3)])
    stage.layoutAll()
    stage.startGames(true)

    tap(q(stage, 'c1'))
    vi.runAllTimers()
    expect(seen).toEqual([])

    tap(q(stage, 'c2'))
    vi.runAllTimers()
    expect(seen).toEqual(['win'])
    expect(hidden(q(stage, 'c3'))).toBe(false) // never had to be opened
  })

  it('walks the hint to the next cover still up, then goes quiet', () => {
    // (Covered boards keep the old behaviour: the marker rides the covers.)
    const stage = build([game(), cover('c1', 1), cover('c2', 2)])
    stage.layoutAll()
    stage.startGames(true)

    expect(q(stage, 'c1').dataset.revealHint).toBe('1')
    tap(q(stage, 'c1'))
    expect(q(stage, 'c2').dataset.revealHint).toBe('1')
    tap(q(stage, 'c2'))
    expect(q(stage, 'c2').dataset.revealHint).toBeUndefined()
  })

  it('fans the reveal beat out to any element, as sound and animation', () => {
    const responder = {
      id: 'responder',
      type: 'text',
      name: 'Responder',
      x: 540,
      y: 300,
      anchor: 'center',
      zIndex: 9,
      mode: 'fit',
      text: { value: 'React', fontSizePx: 40, color: '#fff' },
      animations: { tapReveal: { preset: 'pop', durationMs: 200, delayMs: 0, easing: 'ease-out' } },
      sfx: [{ event: 'tapReveal', assetId: 'dingSfx' }],
    } as SceneElement

    const heard: string[] = []
    off = on('sfx-asset', (id: unknown) => heard.push(String(id)))
    const stage = build([game(), cover('c1', 1), responder])
    stage.layoutAll()
    stage.startGames(true)
    const anim = stage.root.querySelector<HTMLElement>('[data-id="responder"] .pa-el-anim')!

    tap(q(stage, 'c1'))
    expect(heard).toEqual(['dingSfx'])
    expect(anim.style.animation).toContain('pa-pop')
  })

  it('fills a progress bar, one step per cover', () => {
    const stage = build([game(), bar(), cover('c1', 1), cover('c2', 2), cover('c3', 3)])
    stage.layoutAll()
    stage.startGames(true)
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!

    expect(track.dataset.progressTotal).toBe('3')
    tap(q(stage, 'c1'))
    expect(track.dataset.progressValue).toBe('1')
  })

  it('puts the board back on destroy, canvas visibility included', () => {
    const stage = build([game(), cover('c1', 1), prize('p1', 'c1', 1, true), prize('p2', 'c1', 1)])
    stage.layoutAll()
    stage.startGames(true)
    tap(q(stage, 'c1'))
    expect(hidden(q(stage, 'c1'))).toBe(true)

    stage.destroy()
    expect(hidden(q(stage, 'c1'))).toBe(false)
    expect(q(stage, 'c1').dataset.revealClaimedBy).toBeUndefined()
    // A reveal the author had shown stays shown; one they had hidden stays hidden.
    expect(hidden(q(stage, 'p1'))).toBe(false)
    expect(hidden(q(stage, 'p2'))).toBe(true)
  })
})
