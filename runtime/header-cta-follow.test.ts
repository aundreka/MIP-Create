// meta.header.loopFollowsCta — the pinned date/countdown band beats with the CTA button of
// whatever scene is on screen: it copies that element's live loop (its pulse, or an explicit
// loop spec) and restarts it at scene mount, so button and date pulse in phase.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
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
