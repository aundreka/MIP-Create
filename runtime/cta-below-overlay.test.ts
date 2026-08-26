// The CTA's stacking choice against a floating overlay (win/lose card). Three states,
// not two: above the dim (default), hidden for the card's life (hideOnOverlay), or —
// with belowOverlay — left in the scene root so the card covers it and it reads THROUGH
// the dim. Being immune is what parks an element out of the scene root into pa-stage at
// z:10000; belowOverlay is the opt-out from exactly that.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { emit } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Project, SceneElement } from './scene'

vi.mock('./networks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./networks')>()),
  notifyGameEnd: vi.fn(),
  notifyGameClose: vi.fn(),
  triggerCTA: vi.fn(),
}))

const textEl = (id: string, extra: Partial<SceneElement> = {}): SceneElement => ({
  id, type: 'text', name: id, x: 540, y: 800,
  anchor: 'center', zIndex: 2, mode: 'fit',
  text: { value: id, fontSizePx: 40 },
  ...extra,
})

const ctaEl = (extra: Partial<SceneElement> = {}): SceneElement => ({
  id: 'cta', type: 'cta', name: 'cta', x: 540, y: 1600, w: 600, h: 160,
  anchor: 'center', zIndex: 5, mode: 'fit',
  text: { value: 'PLAY', fontSizePx: 40 },
  ...extra,
})

// game --gameWin--> card (an overlay scene that floats over the finished board).
function makeProject(cta: SceneElement): Project {
  return {
    meta: {
      schemaVersion: 1, name: 'cta-below-overlay', clickUrl: { ios: '', android: '' },
      baseW: 1080, baseH: 1920, bgMatchColor: '#111111',
    },
    startSceneId: 'game',
    scenes: [
      {
        id: 'game', name: 'Game', kind: 'game',
        elements: [textEl('cell', { reveal: { amount: 5 } }), cta],
        advance: { on: 'gameWin', to: 'card', delayMs: 0 },
        transition: { type: 'none', durationMs: 0 },
      },
      {
        id: 'card', name: 'Card', kind: 'overlay',
        overlay: { opacity: 0.6, color: '#000000' },
        elements: [textEl('cardtext')],
        advance: { on: 'manual' },
        transition: { type: 'none', durationMs: 0 },
      },
    ],
  }
}

describe('CTA stacking against a floating overlay', () => {
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

  afterEach(() => {
    mgr?.destroy()
    mgr = null
  })

  const play = (cta: SceneElement): void => {
    mgr = playProject(makeProject(cta), {}, { mount, interactive: true })
  }
  const cta = (): HTMLElement | null => mount.querySelector('.pa-el[data-id="cta"]')
  const gameRoot = (): HTMLElement => mount.querySelector<HTMLElement>('.pa-stage > .pa-root')!
  // Win the game and let the gameWin advance fire, floating `card` over the board.
  const win = (): void => {
    emit('game-complete')
    vi.runOnlyPendingTimers()
  }

  it('by default parks the CTA above the dim, outside the scene root', () => {
    play(ctaEl())
    win()

    expect(mount.querySelector('.pa-el[data-id="cardtext"]')).toBeTruthy() // the card is up
    const el = cta()!
    expect(el.classList.contains('pa-el--immune')).toBe(true)
    expect(gameRoot().contains(el)).toBe(false) // parked into pa-stage
    expect(el.style.zIndex).toBe('10000') // above the overlay's 9000
    expect(el.style.display).not.toBe('none')
  })

  it('with belowOverlay the CTA stays in the scene root, under the dim and still visible', () => {
    play(ctaEl({ belowOverlay: true }))
    win()

    const el = cta()!
    expect(el.classList.contains('pa-el--immune')).toBe(false)
    expect(gameRoot().contains(el)).toBe(true) // never parked — the overlay covers it
    expect(el.style.zIndex).toBe('5') // its authored z, below the overlay's 9000
    expect(el.style.display).not.toBe('none') // …but NOT hidden
  })

  it('belowOverlay overrides an explicit overlayImmune / overlayTop', () => {
    play(ctaEl({ belowOverlay: true, overlayImmune: true, overlayTop: true }))
    win()

    const el = cta()!
    expect(el.classList.contains('pa-el--immune')).toBe(false)
    expect(el.classList.contains('pa-el--immune-top')).toBe(false)
    expect(gameRoot().contains(el)).toBe(true)
  })

  // The carry-over case, which is how the CTA is actually authored in real projects
  // (persist:true — it keeps pulsing across scene cuts). Its layer is a stacking context,
  // so belowOverlay has to move it to a lower LAYER; a per-element z can't reach past it.
  const layerOf = (el: HTMLElement): HTMLElement => el.closest<HTMLElement>('.pa-stage > div[style*="z-index"]')!

  it('a carried-over CTA rides the high layer by default, above the overlay', () => {
    play(ctaEl({ persist: true }))
    win()

    expect(mount.querySelector('.pa-el[data-id="cardtext"]')).toBeTruthy() // card is up
    const el = cta()!
    expect(layerOf(el).style.zIndex).toBe('12000') // above the overlay's 9000
    expect(el.style.display).not.toBe('none')
  })

  it('a carried-over CTA with belowOverlay drops to a layer under the overlay', () => {
    play(ctaEl({ persist: true, belowOverlay: true }))
    win()

    expect(mount.querySelector('.pa-el[data-id="cardtext"]')).toBeTruthy()
    const el = cta()!
    expect(layerOf(el).style.zIndex).toBe('8000') // under the overlay's 9000…
    expect(el.style.display).not.toBe('none') // …and still not hidden
    // Only the tier it belongs to exists — no empty 12000 layer left behind.
    expect(mount.querySelector('.pa-stage > div[style*="z-index: 12000"]')).toBeNull()
  })

  it('still carries across a scene change from the low layer', () => {
    play(ctaEl({ persist: true, belowOverlay: true }))
    const before = cta()
    win()

    expect(cta()).toBe(before) // same DOM node — the pulse never restarted
  })

  it('hideOnOverlay is still the separate "gone for the card’s life" choice', () => {
    play(ctaEl({ hideOnOverlay: true }))
    win()

    expect(cta()!.style.display).toBe('none')
  })
})
