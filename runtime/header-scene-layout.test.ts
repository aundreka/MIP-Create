// SceneDef.header — one scene placing the pinned band somewhere of its own while every
// other scene keeps the project layout. The band is mounted once for the whole flow, so
// this is about it being RE-PLACED as scenes come and go.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { emit } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { HeaderSceneOverride, Project, SceneDef } from './scene'

const text = (id: string): SceneDef['elements'][number] => ({
  id, type: 'text', name: id, x: 540, y: 800, anchor: 'center', zIndex: 2, mode: 'fit',
  text: { value: id, fontSizePx: 40 },
})

// scene1 (project layout) → scene2 (its own) → scene3 (back to the project layout).
function proj(own: HeaderSceneOverride): Project {
  return {
    meta: {
      schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920,
      header: { heightPx: 120, offsetYPx: 20 },
    },
    startSceneId: 'scene1',
    scenes: [
      { id: 'scene1', name: 'One', kind: 'game', elements: [text('a')], advance: { on: 'timer', to: 'scene2', delayMs: 10 }, transition: { type: 'none', durationMs: 0 } },
      { id: 'scene2', name: 'Two', kind: 'game', header: own, elements: [text('b')], advance: { on: 'timer', to: 'scene3', delayMs: 1000 }, transition: { type: 'none', durationMs: 0 } },
      { id: 'scene3', name: 'Three', kind: 'game', elements: [text('c')], advance: { on: 'manual' }, transition: { type: 'none', durationMs: 0 } },
    ],
  }
}

describe('per-scene header layout', () => {
  let mount: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920) // scale 1 — design px land 1:1
    mount = document.createElement('div')
    document.body.appendChild(mount)
  })

  const transform = (): string => mount.querySelector<HTMLElement>('.pa-header')?.style.transform ?? ''
  const height = (): string => mount.querySelector<HTMLElement>('.pa-header')?.style.height ?? ''
  // One hop at a time: the scenes' advance timers are 10ms and 1000ms apart so a single
  // advance can't chain straight through scene2 (which is the one under test).
  const hop = (ms: number): void => {
    vi.advanceTimersByTime(ms)
  }

  it('re-places the band on the scene that owns a layout, and restores it after', () => {
    playProject(proj({ portrait: { offsetYPx: 900, heightPx: 200 } }), {}, { mount, interactive: true })
    expect(transform()).toBe('translateX(-50%) translate(0px, 20px) scale(1)')
    expect(height()).toBe('120px')

    hop(20) // → scene2
    expect(mount.querySelector('.pa-el[data-id="b"]')).toBeTruthy()
    expect(transform()).toBe('translateX(-50%) translate(0px, 900px) scale(1)')
    expect(height()).toBe('200px')

    hop(1100) // → scene3, which follows the project again
    expect(transform()).toBe('translateX(-50%) translate(0px, 20px) scale(1)')
    expect(height()).toBe('120px')
  })

  it('leaves the layout alone in the orientation the scene did not author', () => {
    // The scene only overrides LANDSCAPE, so portrait keeps the project's 20px.
    playProject(proj({ landscape: { offsetYPx: 700 } }), {}, { mount, interactive: true })
    hop(20)
    expect(mount.querySelector('.pa-el[data-id="b"]')).toBeTruthy() // on the scene that authored it
    expect(transform()).toBe('translateX(-50%) translate(0px, 20px) scale(1)')
  })

  it('places the band for a floated overlay scene too', () => {
    const p = proj({})
    p.scenes[1] = { ...p.scenes[1], kind: 'overlay', header: { portrait: { offsetYPx: 640 } }, advance: { on: 'manual' } }
    p.scenes[0] = { ...p.scenes[0], advance: { on: 'gameWin', to: 'scene2', delayMs: 0 } }
    playProject(p, {}, { mount, interactive: true })
    emit('game-complete')
    vi.runOnlyPendingTimers()
    expect(transform()).toBe('translateX(-50%) translate(0px, 640px) scale(1)')
  })
})
