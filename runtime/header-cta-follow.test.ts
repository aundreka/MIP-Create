// meta.header.loopFollowsCta — the pinned date/countdown band beats with the CTA button of
// whatever scene is on screen: it copies that element's live loop (its pulse, or an explicit
// loop spec) and restarts it at scene mount, so button and date pulse in phase.
//
// "On screen" is not the same as "listed on the current scene def": a carry-over CTA and the
// CTA of the scene under a floated overlay both keep pulsing across the cut. The band follows
// them there, and — since those buttons never restarted — holds its own cycle rather than
// restarting into a beat that is already half over.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { emit } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { HeaderConfig } from './header'
import type { Project, SceneElement } from './scene'

const cta = (extra: Partial<SceneElement> = {}): SceneElement => ({
  id: 'cta', type: 'cta', name: 'CTA', x: 540, y: 1500, w: 800, h: 170,
  anchor: 'center', zIndex: 40, mode: 'fit',
  cta: { pulse: 'strong' },
  text: { value: 'PLAY NOW', fontSizePx: 60 },
  ...extra,
})

const textEl = (id: string): SceneElement => ({
  id, type: 'text', name: id, x: 540, y: 800,
  anchor: 'center', zIndex: 2, mode: 'fit',
  text: { value: id, fontSizePx: 40 },
})

// scene1 (CTA) → scene2 (no CTA), advanced by a tap on nothing in particular.
function makeProject(header: HeaderConfig, first: SceneElement[]): Project {
  return {
    meta: {
      schemaVersion: 1, name: 'header-cta', clickUrl: { ios: '', android: '' },
      baseW: 1080, baseH: 1920, bgMatchColor: '#111111', header,
    },
    startSceneId: 'scene1',
    scenes: [
      {
        id: 'scene1', name: 'One', kind: 'game', elements: first,
        advance: { on: 'timer', to: 'scene2', delayMs: 10 },
        transition: { type: 'none', durationMs: 0 },
      },
      {
        id: 'scene2', name: 'Two', kind: 'game', elements: [textEl('plain')],
        advance: { on: 'manual' },
        transition: { type: 'none', durationMs: 0 },
      },
    ],
  }
}

describe('header following the CTA pulse', () => {
  let mount: HTMLElement
  let mgr: { destroy(): void } | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    mount = document.createElement('div')
    document.body.appendChild(mount)
  })
  afterEach(() => {
    mgr?.destroy()
    mgr = null
    vi.useRealTimers()
  })

  const play = (header: HeaderConfig, first: SceneElement[] = [cta()]): void => {
    mgr = playProject(makeProject(header, first), {}, { mount, interactive: true })
  }
  const headerAnim = (): string => mount.querySelector<HTMLElement>('.pa-header-text')?.style.animation ?? ''

  it('copies the strong CTA pulse onto the band', () => {
    play({ loopFollowsCta: true })
    expect(headerAnim()).toBe('pa-cta-pulse-strong 900ms ease-in-out 0ms infinite')
  })

  it('copies a custom pulse scale/duration, keyframes and all', () => {
    play({ loopFollowsCta: true }, [cta({ cta: { pulse: 'strong', pulseScale: 1.12, pulseDurationMs: 700 } })])
    // A custom shape gets its own injected @keyframes rule, not the preset's.
    expect(headerAnim()).toMatch(/^pa-cta-p\d+ 700ms ease-in-out 0ms infinite$/)
  })

  it('starts the pulse only after the CTA entrance it is matching', () => {
    play({ loopFollowsCta: true }, [cta({ animations: { entrance: { preset: 'pop', durationMs: 500, delayMs: 120, easing: 'ease-out', trigger: 'onMount' } } })])
    expect(headerAnim()).toBe('pa-cta-pulse-strong 900ms ease-in-out 620ms infinite')
  })

  it('prefers an explicit loop authored on the CTA over its pulse', () => {
    play({ loopFollowsCta: true }, [cta({ animations: { loop: { preset: 'float', durationMs: 2600, delayMs: 0, easing: 'ease-in-out', iterations: 'infinite' } } })])
    expect(headerAnim()).toBe('pa-float 2600ms ease-in-out 0ms infinite normal none')
  })

  it('falls back to the header’s own loop on a scene with no CTA', () => {
    play({ loopFollowsCta: true, loop: { preset: 'pulse', durationMs: 1000, delayMs: 0, easing: 'ease-in-out' } })
    expect(headerAnim()).toBe('pa-cta-pulse-strong 900ms ease-in-out 0ms infinite')

    vi.advanceTimersByTime(50) // scene1 → scene2, which has no CTA
    vi.runOnlyPendingTimers()
    expect(headerAnim()).toBe('pa-pulse 1000ms ease-in-out 0ms infinite normal none')
  })

  it('leaves the band alone when the project did not opt in', () => {
    play({})
    expect(headerAnim()).toBe('')
  })
})

// scene1 (the CTA's home) → scene2. Only scene1 ever lists a CTA, so from scene2 onwards a
// carried CTA is the only thing keeping one on screen.
function carryProject(header: HeaderConfig, ctaEl: SceneElement): Project {
  return {
    meta: {
      schemaVersion: 1, name: 'header-cta-carry', clickUrl: { ios: '', android: '' },
      baseW: 1080, baseH: 1920, bgMatchColor: '#111111', header,
    },
    startSceneId: 'scene1',
    scenes: [
      {
        id: 'scene1', name: 'One', kind: 'game', elements: [textEl('one'), ctaEl],
        advance: { on: 'timer', to: 'scene2', delayMs: 10 },
        transition: { type: 'none', durationMs: 0 },
      },
      {
        id: 'scene2', name: 'Two', kind: 'game', elements: [textEl('two')],
        advance: { on: 'manual' },
        transition: { type: 'none', durationMs: 0 },
      },
    ],
  }
}

// game --gameWin--> card, an overlay that floats over the still-mounted board.
function overlayProject(header: HeaderConfig, gameEls: SceneElement[], cardEls: SceneElement[]): Project {
  return {
    meta: {
      schemaVersion: 1, name: 'header-cta-overlay', clickUrl: { ios: '', android: '' },
      baseW: 1080, baseH: 1920, bgMatchColor: '#111111', header,
    },
    startSceneId: 'game',
    scenes: [
      {
        id: 'game', name: 'Game', kind: 'game', elements: gameEls,
        advance: { on: 'gameWin', to: 'card', delayMs: 0 },
        transition: { type: 'none', durationMs: 0 },
      },
      {
        id: 'card', name: 'Card', kind: 'overlay', overlay: { opacity: 0.6, color: '#000000' },
        elements: cardEls, advance: { on: 'manual' },
        transition: { type: 'none', durationMs: 0 },
      },
    ],
  }
}

describe('header following a CTA that outlives its scene', () => {
  let mount: HTMLElement
  let mgr: { destroy(): void } | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    mount = document.createElement('div')
    document.body.appendChild(mount)
  })
  afterEach(() => {
    mgr?.destroy()
    mgr = null
    vi.useRealTimers()
  })

  const band = (): HTMLElement => mount.querySelector<HTMLElement>('.pa-header-text')!
  const headerAnim = (): string => band().style.animation
  const PULSE = 'pa-cta-pulse-strong 900ms ease-in-out 0ms infinite'
  // The band keeps its beat by NOT being written to again. Stamp the node with a sentinel
  // first: it survives exactly when the follow left the running animation alone.
  const PROBE = 'pa-probe 1ms linear'
  const probe = (): void => {
    band().style.animation = PROBE
  }

  const playCarry = (header: HeaderConfig, extra: Partial<SceneElement> = {}): void => {
    mgr = playProject(carryProject(header, cta({ persist: true, ...extra })), {}, { mount, interactive: true })
  }
  const advance = (): void => {
    vi.advanceTimersByTime(50)
    vi.runOnlyPendingTimers()
  }
  const playOverlay = (header: HeaderConfig, gameEls: SceneElement[], cardEls: SceneElement[] = [textEl('cardtext')]): void => {
    mgr = playProject(overlayProject(header, gameEls, cardEls), {}, { mount, interactive: true })
  }
  const win = (): void => {
    emit('game-complete')
    vi.runOnlyPendingTimers()
  }

  it('keeps beating with a carry-over CTA on a scene that lists no CTA of its own', () => {
    playCarry({ loopFollowsCta: true })
    expect(headerAnim()).toBe(PULSE)

    advance() // → scene2, whose def has no CTA — the carried button is still on screen

    expect(mount.querySelector('.pa-el[data-id="two"]')).toBeTruthy()
    expect(headerAnim()).toBe(PULSE)
  })

  it('holds its phase across that cut instead of restarting mid-beat', () => {
    playCarry({ loopFollowsCta: true })
    probe()

    advance()

    expect(headerAnim()).toBe(PROBE) // never re-assigned: the cycle ran straight through
  })

  it('drops a carry-over CTA that persistScenes excludes from this scene', () => {
    playCarry({ loopFollowsCta: true, loop: { preset: 'pulse', durationMs: 1000, delayMs: 0, easing: 'ease-in-out' } }, { persistScenes: ['scene1'] })
    expect(headerAnim()).toBe(PULSE)

    advance() // → scene2, where the carried CTA fades out

    expect(headerAnim()).toBe('pa-pulse 1000ms ease-in-out 0ms infinite normal none')
  })

  it('keeps beating with the scene CTA left pulsing above a floated overlay', () => {
    playOverlay({ loopFollowsCta: true }, [textEl('cell'), cta()])
    expect(headerAnim()).toBe(PULSE)
    probe()

    win() // the card floats over the board; the immune CTA stays on top of the dim

    expect(mount.querySelector('.pa-el[data-id="cardtext"]')).toBeTruthy()
    expect(headerAnim()).toBe(PROBE) // same live button, same unbroken cycle
  })

  it('follows a CTA reading through the dim (belowOverlay) just the same', () => {
    playOverlay({ loopFollowsCta: true }, [textEl('cell'), cta({ belowOverlay: true })])
    win()
    expect(headerAnim()).toBe(PULSE)
  })

  it('lets go when the scene CTA opted into hideOnOverlay', () => {
    playOverlay({ loopFollowsCta: true, loop: { preset: 'pulse', durationMs: 1000, delayMs: 0, easing: 'ease-in-out' } }, [textEl('cell'), cta({ hideOnOverlay: true })])
    expect(headerAnim()).toBe(PULSE)

    win() // the button is hidden for the card's life — nothing left to beat with

    expect(headerAnim()).toBe('pa-pulse 1000ms ease-in-out 0ms infinite normal none')
  })

  it('hands the band to an end-card overlay that brings its own CTA', () => {
    playOverlay({ loopFollowsCta: true }, [textEl('cell'), cta({ hideOnOverlay: true })], [
      textEl('cardtext'),
      cta({ id: 'cardcta', cta: { pulse: 'calm' } }),
    ])
    expect(headerAnim()).toBe(PULSE)

    win()

    expect(headerAnim()).toBe('pa-cta-pulse-calm 1600ms ease-in-out 0ms infinite')
  })
})
