// Resume-scene persistence: mounting a scene records it (AppLovin reloads the page on
// rotation, and boot() re-enters the recorded scene) — but once the game is WON the
// record must die, so a refresh on the win/next scene restarts the ad instead of
// resuming into an already-finished play-through. End cards always clear it.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { emit } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Project, SceneDef } from './scene'

const KEY = 'pa:resume-scene'

const readRecord = (): { id: string } | null => {
  const raw = window.sessionStorage.getItem(KEY)
  return raw ? (JSON.parse(raw) as { id: string }) : null
}

const textEl = (id: string, extra: Partial<SceneDef['elements'][number]> = {}) => ({
  id, type: 'text' as const, name: id, x: 540, y: 800,
  anchor: 'center' as const, zIndex: 2, mode: 'fit' as const,
  text: { value: id, fontSizePx: 40 },
  ...extra,
})

function makeProject(): Project {
  return {
    meta: {
      schemaVersion: 1, name: 'resume', clickUrl: { ios: '', android: '' },
      baseW: 1080, baseH: 1920, bgMatchColor: '#111111',
    },
    startSceneId: 'game1',
    scenes: [
      {
        id: 'game1', name: 'Game', kind: 'game',
        // The reveal marker makes this a "winnable" scene (it can emit game-complete).
        elements: [textEl('cell', { reveal: { amount: 5 } })],
        advance: { on: 'gameWin', to: 'win1', delayMs: 0 },
        transition: { type: 'none', durationMs: 0 },
      },
      {
        id: 'win1', name: 'Win', kind: 'game',
        elements: [textEl('congrats')],
        advance: { on: 'tap', to: 'game2', delayMs: 0 },
        transition: { type: 'none', durationMs: 0 },
      },
      {
        id: 'game2', name: 'Game 2', kind: 'game',
        elements: [textEl('cell2', { reveal: { amount: 5 } })],
        advance: { on: 'gameWin', to: 'end1', delayMs: 0 },
        transition: { type: 'none', durationMs: 0 },
      },
      {
        id: 'end1', name: 'End', kind: 'endscene',
        elements: [textEl('bye')],
        advance: { on: 'manual' },
        transition: { type: 'none', durationMs: 0 },
      },
    ],
  }
}

describe('resume record vs game win', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })

  it('saves the game scene, clears on win, and stays cleared on the next scene', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const mgr = playProject(makeProject(), {}, { mount, interactive: true })

    // Mid-game: the game scene is the resume point (rotation reload re-enters it).
    expect(readRecord()?.id).toBe('game1')

    // Win fires → the record dies immediately (refresh during the celebration restarts).
    emit('game-complete')
    expect(readRecord()).toBeNull()

    // The post-win scene mounts (gameWin advance) and must NOT re-save itself.
    vi.runOnlyPendingTimers()
    expect(mount.querySelector('.pa-el[data-id="congrats"]')).toBeTruthy()
    expect(readRecord()).toBeNull()

    mgr.destroy()
  })

  it('re-arms resume when another game scene mounts, and endscene clears it again', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const mgr = playProject(makeProject(), {}, { mount, interactive: true })

    emit('game-complete') // win game1
    vi.runOnlyPendingTimers() // → win1 (not saved)
    expect(readRecord()).toBeNull()

    // Tap through to game2: a fresh winnable scene is a valid resume point again.
    mount.querySelector('.pa-stage')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.runOnlyPendingTimers()
    expect(mount.querySelector('.pa-el[data-id="cell2"]')).toBeTruthy()
    expect(readRecord()?.id).toBe('game2')

    // Winning game2 → end card: cleared and stays cleared.
    emit('game-complete')
    expect(readRecord()).toBeNull()
    vi.runOnlyPendingTimers()
    expect(mount.querySelector('.pa-el[data-id="bye"]')).toBeTruthy()
    expect(readRecord()).toBeNull()

    mgr.destroy()
  })
})
