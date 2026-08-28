// `overlayBase` lets an overlay scene name the scene it floats OVER, instead of always
// dimming whatever happens to be on screen. The case that needs it: an overlay placed
// FIRST in the flow — with no previous scene it would otherwise play as a plain
// full-screen scene, with nothing to dim.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { emit } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Project, SceneDef } from './scene'

const textEl = (id: string, extra: Partial<SceneDef['elements'][number]> = {}) => ({
  id, type: 'text' as const, name: id, x: 540, y: 800,
  anchor: 'center' as const, zIndex: 2, mode: 'fit' as const,
  text: { value: id, fontSizePx: 40 },
  ...extra,
})

const overlayScene = (over: string | undefined): SceneDef => ({
  id: 'intro', name: 'Intro', kind: 'overlay',
  ...(over ? { overlayBase: over } : {}),
  overlay: { opacity: 0.6, color: '#000000' },
  elements: [textEl('introtext')],
  advance: { on: 'tap' },
  transition: { type: 'none', durationMs: 0 },
})

// intro (overlay, starts the flow) → game1 → after1. The only variable is intro.overlayBase.
function makeProject(over: string | undefined): Project {
  return {
    meta: {
      schemaVersion: 1, name: 'overlay-base', clickUrl: { ios: '', android: '' },
      baseW: 1080, baseH: 1920, bgMatchColor: '#111111',
    },
    startSceneId: 'intro',
    scenes: [
      overlayScene(over),
      {
        id: 'game1', name: 'Game', kind: 'game',
        elements: [textEl('cell', { reveal: { amount: 5 } })],
        advance: { on: 'gameWin', to: 'after1', delayMs: 0 },
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

const dim = (mount: HTMLElement): HTMLElement | null =>
  mount.querySelector<HTMLElement>('div[style*="z-index: 9000"]')

describe('overlayBase — the scene an overlay floats over', () => {
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

  // playProject's 'scene-overlay' subscription lives on the module-global emitter, so an
  // assertion failure before teardown would leak the handler into the next test.
  afterEach(() => {
    mgr?.destroy()
    mgr = null
  })

  it('starts the flow floated over its base instead of as a full-screen scene', () => {
    mgr = playProject(makeProject('game1'), {}, { mount, interactive: true })

    expect(el(mount, 'introtext')).toBeTruthy()
    expect(el(mount, 'cell')).toBeTruthy() // the base mounted underneath
    expect(dim(mount)).toBeTruthy() // and the overlay really is floated, not mounted
  })

  it('without overlayBase a start overlay still mounts outright (unchanged default)', () => {
    mgr = playProject(makeProject(undefined), {}, { mount, interactive: true })

    expect(el(mount, 'introtext')).toBeTruthy()
    expect(el(mount, 'cell')).toBeNull() // nothing underneath it
    expect(dim(mount)).toBeNull()
  })

  it('dismissing hands the screen back to the base rather than re-mounting it', () => {
    mgr = playProject(makeProject('game1'), {}, { mount, interactive: true })

    // intro's next scene in order IS game1 (its own base), so this is a plain dismiss —
    // no cover-redirect that would tear the running game down and rebuild it.
    const board = el(mount, 'cell')
    dim(mount)!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.advanceTimersByTime(400)
    vi.runOnlyPendingTimers()

    expect(el(mount, 'introtext')).toBeNull()
    expect(el(mount, 'cell')).toBe(board) // same node — the game was never restarted
    expect(dim(mount)).toBeNull()
  })

  it('leaves the base armed, so the game underneath still drives the flow', () => {
    mgr = playProject(makeProject('game1'), {}, { mount, interactive: true })
    dim(mount)!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.advanceTimersByTime(400)
    vi.runOnlyPendingTimers()

    emit('game-complete')
    vi.runOnlyPendingTimers()

    expect(el(mount, 'after')).toBeTruthy()
  })

  it('brings its base up underneath when it fires mid-flow over another scene', () => {
    // intro floats over game1, but is reached from after1 — the wrong scene is on screen,
    // so the base has to be swapped in beneath it.
    const project = makeProject('game1')
    project.startSceneId = 'after1'
    mgr = playProject(project, {}, { mount, interactive: true })
    expect(el(mount, 'after')).toBeTruthy()

    emit('scene-goto', 'intro')

    expect(el(mount, 'introtext')).toBeTruthy()
    expect(el(mount, 'cell')).toBeTruthy() // base mounted under the overlay
    expect(el(mount, 'after')).toBeNull() // the scene it was called from is gone
  })

  it('falls back to the default when the base id no longer exists', () => {
    mgr = playProject(makeProject('deleted-scene'), {}, { mount, interactive: true })

    expect(el(mount, 'introtext')).toBeTruthy()
    expect(dim(mount)).toBeNull() // mounted outright, exactly as with no overlayBase
  })
})
