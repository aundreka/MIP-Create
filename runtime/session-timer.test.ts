// meta.sessionTimer: ONE countdown for the whole play-through. It starts on the player's
// first interaction (not on load), survives every scene change — visiting more screens
// never restarts it — and jumps the flow to the scene it names when it expires.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign } from './responsive'
import type { Project, SceneDef, SessionTimer } from './scene'

const textEl = (id: string) => ({
  id, type: 'text' as const, name: id, x: 540, y: 800,
  anchor: 'center' as const, zIndex: 2, mode: 'fit' as const,
  text: { value: id, fontSizePx: 40 },
})

const scene = (id: string, to: string | undefined, kind: SceneDef['kind'] = 'game'): SceneDef => ({
  id, name: id, kind,
  elements: [textEl(`${id}-t`)],
  advance: to ? { on: 'tap', to, delayMs: 0 } : { on: 'manual' },
  transition: { type: 'none', durationMs: 0 },
})

function makeProject(sessionTimer?: SessionTimer): Project {
  return {
    meta: {
      schemaVersion: 3, name: 'timer', clickUrl: { ios: '', android: '' },
      baseW: 1080, baseH: 1920, bgMatchColor: '#111111', sessionTimer,
    },
    startSceneId: 's1',
    scenes: [scene('s1', 's2'), scene('s2', 's3'), scene('s3', undefined), scene('end', undefined, 'endscene')],
  }
}

const mountEl = (): HTMLElement => {
  const m = document.createElement('div')
  document.body.appendChild(m)
  return m
}
const shown = (): string => document.querySelector('.pa-root')?.textContent ?? ''
const tap = (): void => {
  const root = document.querySelector('.pa-root') as HTMLElement
  root.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}

describe('session timer', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })

  it('does not run before the first interaction', () => {
    playProject(makeProject({ ms: 5000, to: 'end' }), {}, { mount: mountEl(), interactive: true })
    vi.advanceTimersByTime(60_000)
    expect(shown()).toContain('s1-t') // still waiting on the player's first gesture
  })

  it('keeps running across scenes and jumps to the target when it expires', () => {
    playProject(makeProject({ ms: 5000, to: 'end' }), {}, { mount: mountEl(), interactive: true })
    tap() // first interaction: starts the countdown AND advances s1 → s2
    vi.advanceTimersByTime(2000)
    expect(shown()).toContain('s2-t')
    tap() // another screen change — the countdown must NOT restart
    vi.advanceTimersByTime(2000)
    expect(shown()).toContain('s3-t')
    vi.advanceTimersByTime(1100) // 5.1s since the first gesture
    expect(shown()).toContain('end-t')
  })

  it('does nothing when the flow already reached the end card', () => {
    const p = makeProject({ ms: 5000, to: 's1' })
    p.startSceneId = 'end'
    playProject(p, {}, { mount: mountEl(), interactive: true })
    tap()
    vi.advanceTimersByTime(60_000)
    expect(shown()).toContain('end-t') // never navigated back off the end card
  })

  it('is inert without config, and on the static (non-interactive) canvas', () => {
    playProject(makeProject(), {}, { mount: mountEl(), interactive: true })
    tap() // the tap still works the scene's own advance rule (s1 → s2); nothing more
    vi.advanceTimersByTime(60_000)
    expect(shown()).not.toContain('end-t')

    document.body.innerHTML = ''
    playProject(makeProject({ ms: 5000, to: 'end' }), {}, { mount: mountEl(), interactive: false })
    tap()
    vi.advanceTimersByTime(60_000)
    expect(shown()).toContain('s1-t') // the static canvas has no flow at all
  })

  it('stops when the manager is destroyed', () => {
    const mgr = playProject(makeProject({ ms: 5000, to: 'end' }), {}, { mount: mountEl(), interactive: true })
    tap()
    mgr.destroy()
    vi.advanceTimersByTime(60_000)
    expect(document.querySelector('.pa-root')).toBeNull()
  })
})
