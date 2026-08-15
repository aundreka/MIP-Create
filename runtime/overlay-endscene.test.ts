// An overlay scene opted into `asEndscene` is the MRAID end card WITHOUT leaving the game:
// it floats over the finished board (its dim/blur shows it through) instead of cutting to a
// full-screen endscene, signals gameEnd, is tap-to-install, and is terminal — its advance
// rule is ignored and it never redirects onward.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { emit, on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Project, SceneDef } from './scene'
import { notifyGameClose, notifyGameEnd, triggerCTA } from './networks'

// Only the three signals scenes.ts fires; everything else stays real so the rest of the
// runtime (cta.ts / endscene.ts share this module) behaves normally.
vi.mock('./networks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./networks')>()),
  notifyGameEnd: vi.fn(),
  notifyGameClose: vi.fn(),
  triggerCTA: vi.fn(),
}))

const textEl = (id: string, extra: Partial<SceneDef['elements'][number]> = {}) => ({
  id, type: 'text' as const, name: id, x: 540, y: 800,
  anchor: 'center' as const, zIndex: 2, mode: 'fit' as const,
  text: { value: id, fontSizePx: 40 },
  ...extra,
})

// game1 (winnable) → card (overlay) → after1. The ONLY difference between the two runs is
// the asEndscene flag on `card`, so the opposite outcomes below are attributable to it.
function makeProject(asEndscene: boolean): Project {
  return {
    meta: {
      schemaVersion: 1, name: 'overlay-endcard', clickUrl: { ios: '', android: '' },
      baseW: 1080, baseH: 1920, bgMatchColor: '#111111',
      header: { heightPx: 120 },
    },
    startSceneId: 'game1',
    scenes: [
      {
        id: 'game1', name: 'Game', kind: 'game',
        elements: [textEl('cell', { reveal: { amount: 5 } })],
        advance: { on: 'gameWin', to: 'card', delayMs: 0 },
        transition: { type: 'none', durationMs: 0 },
      },
      {
        id: 'card', name: 'Card', kind: 'overlay',
        ...(asEndscene ? { asEndscene: true } : {}),
        overlay: { opacity: 0.6, color: '#000000' },
        elements: [textEl('cardtext')],
        // A live rule that WOULD dismiss/redirect a plain overlay — ignored when terminal.
        advance: { on: 'timer', delayMs: 10 },
        transition: { type: 'none', durationMs: 0 },
      },
      {
        id: 'after1', name: 'After', kind: 'game',
        elements: [textEl('after')],
        advance: { on: 'manual' },
        transition: { type: 'none', durationMs: 0 },
      },
    ],
  }
}

const el = (mount: HTMLElement, id: string): HTMLElement | null =>
  mount.querySelector(`.pa-el[data-id="${id}"]`)

describe('overlay scene doubling as the MRAID end card', () => {
  let mount: HTMLElement
  let mgr: { destroy(): void } | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    mount = document.createElement('div')
    document.body.appendChild(mount)
  })

  // Teardown here, not at the end of each test: playProject's 'scene-overlay' subscription
  // lives on the module-global emitter, so a test that fails an assertion before destroying
  // would leak its handler into the next one and mount the overlay twice.
  afterEach(() => {
    mgr?.destroy()
    mgr = null
  })

  // Win the game and let the gameWin advance fire, landing us on `card`.
  const playToCard = (asEndscene: boolean): void => {
    mgr = playProject(makeProject(asEndscene), {}, { mount, interactive: true })
    emit('game-complete')
    vi.runOnlyPendingTimers()
  }

  const headerBand = (): HTMLElement | null => mount.querySelector<HTMLElement>('.pa-header')

  it('floats over the still-mounted game and signals the ad ended', () => {
    playToCard(true)

    // The defining behaviour: the game board is STILL in the DOM under the card, which is
    // what separates this from a plain endscene (that would have replaced the scene).
    expect(el(mount, 'cell')).toBeTruthy()
    expect(el(mount, 'cardtext')).toBeTruthy()
    expect(notifyGameEnd).toHaveBeenCalledTimes(1)
    // Terminal: a reload must restart the ad rather than resume the finished play-through.
    expect(window.sessionStorage.getItem('pa:resume-scene')).toBeNull()
  })

  it('ignores its advance rule — nothing dismisses it and it never redirects', () => {
    playToCard(true)

    // Its rule is timer/10ms. Run everything: a plain overlay would have dismissed and
    // cover-redirected to after1 by now.
    vi.advanceTimersByTime(5000)
    vi.runOnlyPendingTimers()

    expect(el(mount, 'cardtext')).toBeTruthy() // still up
    expect(el(mount, 'cell')).toBeTruthy() // game still behind it
    expect(el(mount, 'after')).toBeNull() // never advanced past the card
    expect(notifyGameClose).not.toHaveBeenCalled() // no tap yet
  })

  it('installs on a tap anywhere over the dim', () => {
    playToCard(true)
    const sfx: string[] = []
    const off = on('sfx', (name: string) => sfx.push(name))

    // The overlay surface spans the stage at z 9000 — a tap on the dim, not on any element.
    const surface = mount.querySelector<HTMLElement>('div[style*="z-index: 9000"]')
    expect(surface).toBeTruthy()
    surface!.dispatchEvent(new Event('pointerdown', { bubbles: true }))

    expect(triggerCTA).toHaveBeenCalledTimes(1)
    expect(notifyGameClose).toHaveBeenCalledTimes(1)
    expect(sfx).toContain('ctaClick')

    off()
  })

  it('hides the date header, like any end card', () => {
    playToCard(true)
    expect(headerBand()?.style.opacity).toBe('0')
  })

  it('without the flag the same overlay still dismisses and redirects onward', () => {
    playToCard(false)

    // Same scene, same timer — but as a plain overlay it hands off to after1.
    expect(el(mount, 'cardtext')).toBeTruthy()
    expect(notifyGameEnd).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5000)
    vi.runOnlyPendingTimers()

    expect(el(mount, 'after')).toBeTruthy()
  })
})
