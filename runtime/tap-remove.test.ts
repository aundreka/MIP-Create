// Tap to remove: obstacles the player taps away, optionally turning into something
// else, and how it drives (or deliberately does not drive) a progress bar.

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
    id: 'tap-game',
    type: 'game-mount',
    name: 'Tap',
    x: 540,
    y: 960,
    w: 1000,
    h: 800,
    anchor: 'center',
    zIndex: 1,
    mode: 'fit',
    game: { templateId: 'tapremove', hintEnabled: false, params: { fadeMs: 0, crossFadeMs: 0, ...params } },
  } as SceneElement
}

function bar(params: Record<string, unknown> = {}, id = 'bar'): SceneElement {
  return {
    id,
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

function mess(id: string, index: number): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'stain',
    x: 200 + index * 200,
    y: 900,
    w: 180,
    h: 180,
    anchor: 'center',
    zIndex: 5,
    mode: 'fit',
    tapRole: { gameId: 'tap-game', role: 'obstacle', index },
  } as SceneElement
}

function becomes(id: string, index: number, showOnCanvas?: boolean): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'clean',
    x: 200 + index * 200,
    y: 900,
    w: 180,
    h: 180,
    anchor: 'center',
    zIndex: 4,
    mode: 'fit',
    tapRole: { gameId: 'tap-game', role: 'after', index, showOnCanvas },
  } as SceneElement
}

const ASSETS = {
  stain: { src: 'stain.png', w: 180, h: 180 },
  clean: { src: 'clean.png', w: 180, h: 180 },
  popSfx: { src: 'pop.mp3', w: 0, h: 0 },
}

function build(elements: SceneElement[]): ReturnType<typeof buildScene> {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'tap', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    kind: 'game',
    elements,
  }
  return buildScene(scene, ASSETS, { mount })
}

const q = (stage: ReturnType<typeof buildScene>, id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
const tap = (el: HTMLElement): void => void el.dispatchEvent(pointer('pointerdown', 10, 10, { pointerId: 1, pointerType: 'touch' }))
const gone = (el: HTMLElement): boolean => el.classList.contains('pa-combo-off')

describe('tap to remove', () => {
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

  it('tags roles onto placed elements and keeps obstacles tappable', () => {
    const stage = build([game(), mess('m1', 1), becomes('a1', 1)])
    stage.layoutAll()
    stage.startGames(false)

    const m = q(stage, 'm1')
    expect(m.dataset.tapRole).toBe('obstacle')
    expect(m.dataset.tapGameId).toBe('tap-game')
    expect(m.dataset.tapIndex).toBe('1')
    expect(m.style.pointerEvents).not.toBe('none')
    // The obstacle is part of the board the author is arranging, so the canvas keeps
    // it up; its replacement is what the canvas hides until asked.
    expect(gone(m)).toBe(false)
    expect(gone(q(stage, 'a1'))).toBe(true)
  })

  it('keeps a replacement visible on the canvas when the author asks, and hides it in play', () => {
    const stage = build([game(), mess('m1', 1), becomes('a1', 1, true), becomes('a2', 1)])
    stage.layoutAll()
    stage.startGames(false)
    expect(gone(q(stage, 'a1'))).toBe(false) // shown while being positioned
    expect(gone(q(stage, 'a2'))).toBe(true)

    const play = build([game(), mess('m1', 1), becomes('a1', 1, true), becomes('a2', 1)])
    play.layoutAll()
    play.startGames(true)
    // Play always opens with every replacement down, whatever the canvas showed.
    expect(gone(q(play, 'a1'))).toBe(true)
    expect(gone(q(play, 'a2'))).toBe(true)
  })

  it('removes an obstacle on tap and leaves the others alone', () => {
    const stage = build([game(), mess('m1', 1), mess('m2', 2)])
    stage.layoutAll()
    stage.startGames(true)

    tap(q(stage, 'm1'))
    expect(gone(q(stage, 'm1'))).toBe(true)
    expect(gone(q(stage, 'm2'))).toBe(false)
    // Nothing left to tap on something already gone, and nothing falls through it.
    expect(q(stage, 'm1').style.pointerEvents).toBe('none')
  })

  it('brings up every replacement addressed to that obstacle', () => {
    const stage = build([game(), mess('m1', 1), mess('m2', 2), becomes('a1', 1), becomes('a1b', 1), becomes('a2', 2)])
    stage.layoutAll()
    stage.startGames(true)

    tap(q(stage, 'm1'))
    // Both of obstacle 1's pieces arrive together — a result plus a flourish, each
    // placed and animated on its own.
    expect(gone(q(stage, 'a1'))).toBe(false)
    expect(gone(q(stage, 'a1b'))).toBe(false)
    // Obstacle 2's is still waiting for its own tap.
    expect(gone(q(stage, 'a2'))).toBe(true)
  })

  it('is won when the board is clear, and earlier on a win target', () => {
    const seen: string[] = []
    off = on('game-complete', () => seen.push('win'))
    const stage = build([game({ winObstacles: 2 }), mess('m1', 1), mess('m2', 2), mess('m3', 3)])
    stage.layoutAll()
    stage.startGames(true)

    tap(q(stage, 'm1'))
    vi.runAllTimers()
    expect(seen).toEqual([])

    tap(q(stage, 'm2'))
    vi.runAllTimers()
    expect(seen).toEqual(['win'])
    expect(gone(q(stage, 'm3'))).toBe(false) // never had to be removed
  })

  it('counts a rapid triple-tap on one obstacle as one removal', () => {
    // The obstacle is still visibly there for the length of its fade, so a fast tapper
    // WILL hit it again. Without the guard those extra taps each count, and a
    // three-obstacle board can be won by mashing the first one.
    const stage = build([game({ fadeMs: 400 }), bar(), mess('m1', 1), mess('m2', 2), mess('m3', 3)])
    stage.layoutAll()
    stage.startGames(true)
    const progress = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!

    tap(q(stage, 'm1'))
    tap(q(stage, 'm1'))
    tap(q(stage, 'm1'))
    expect(progress.dataset.progressValue).toBe('1')
    expect(q(stage, 'm2').dataset.tapHint).toBe('1')
    expect(q(stage, 'm2').classList.contains('pa-combo-off')).toBe(false)
  })

  it('walks the hint to the next obstacle standing, then goes quiet', () => {
    const stage = build([game(), mess('m1', 1), mess('m2', 2)])
    stage.layoutAll()
    stage.startGames(true)

    expect(q(stage, 'm1').dataset.tapHint).toBe('1')
    tap(q(stage, 'm1'))
    expect(q(stage, 'm1').dataset.tapHint).toBeUndefined()
    expect(q(stage, 'm2').dataset.tapHint).toBe('1')
    tap(q(stage, 'm2'))
    expect(q(stage, 'm2').dataset.tapHint).toBeUndefined()
  })

  it('fans the removal beat out to any element, as sound and animation', () => {
    // Addressed to the SCENE, not the game mount: a counter or a headline reacts to it
    // without being a child of the game.
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
      animations: { tapRemove: { preset: 'pop', durationMs: 200, delayMs: 0, easing: 'ease-out' } },
      sfx: [{ event: 'tapRemove', assetId: 'popSfx' }],
    } as SceneElement

    const heard: string[] = []
    off = on('sfx-asset', (id: unknown) => heard.push(String(id)))
    const stage = build([game(), mess('m1', 1), responder])
    stage.layoutAll()
    stage.startGames(true)
    const anim = stage.root.querySelector<HTMLElement>('[data-id="responder"] .pa-el-anim')!

    tap(q(stage, 'm1'))
    expect(heard).toEqual(['popSfx'])
    expect(anim.style.animation).toContain('pa-pop')
  })

  it('puts the board back on destroy, canvas visibility included', () => {
    const stage = build([game(), mess('m1', 1), becomes('a1', 1, true), becomes('a2', 1)])
    stage.layoutAll()
    stage.startGames(true)
    tap(q(stage, 'm1'))
    expect(gone(q(stage, 'm1'))).toBe(true)

    stage.destroy()
    expect(gone(q(stage, 'm1'))).toBe(false)
    expect(q(stage, 'm1').dataset.tapClaimedBy).toBeUndefined()
    // A replacement the author had shown stays shown; one they had hidden stays hidden.
    expect(gone(q(stage, 'a1'))).toBe(false)
    expect(gone(q(stage, 'a2'))).toBe(true)
  })

  it('fills a progress bar, one step per obstacle', () => {
    const stage = build([game(), bar(), mess('m1', 1), mess('m2', 2), mess('m3', 3)])
    stage.layoutAll()
    stage.startGames(true)
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!

    expect(track.dataset.progressTotal).toBe('3')
    tap(q(stage, 'm1'))
    expect(track.dataset.progressValue).toBe('1')
    tap(q(stage, 'm2'))
    expect(track.dataset.progressValue).toBe('2')
  })
})

describe('progress bar: decorative', () => {
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

  it('ignores every game in the scene', () => {
    const stage = build([game(), bar({ sourceGameId: 'none', steps: 3 }), mess('m1', 1), mess('m2', 2)])
    stage.layoutAll()
    stage.startGames(true)
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!

    tap(q(stage, 'm1'))
    tap(q(stage, 'm2'))
    expect(track.dataset.progressValue).toBe('0')
  })

  it('can never win the scene out from under the mechanic being played', () => {
    const seen: string[] = []
    off = on('game-complete', () => seen.push('win'))
    // A one-step bar next to a two-obstacle board: wired, it would finish first and own
    // the redirect. Decorative, it stays out of the race entirely and the BOARD wins.
    const stage = build([game(), bar({ sourceGameId: 'none', steps: 1 }), mess('m1', 1), mess('m2', 2)])
    stage.layoutAll()
    stage.startGames(true)
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!

    tap(q(stage, 'm1'))
    vi.runAllTimers()
    expect(seen).toEqual([]) // the bar did NOT end it on the first removal
    expect(track.dataset.progressComplete).toBeUndefined()

    tap(q(stage, 'm2'))
    vi.runAllTimers()
    expect(seen).toEqual(['win'])
  })

  it('still renders, so it is usable as artwork', () => {
    const stage = build([game(), bar({ sourceGameId: 'none' }), mess('m1', 1)])
    stage.layoutAll()
    stage.startGames(true)
    expect(stage.root.querySelector('[data-progress-bar]')).not.toBeNull()
    expect(stage.root.querySelector('[data-progress-fill]')).not.toBeNull()
  })
})
