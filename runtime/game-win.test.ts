import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playProject } from './scenes'
import { buildScene } from './stage'
import { emit } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Project, Scene, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920

const textEl = (id: string, extra: Partial<SceneElement> = {}): SceneElement => ({
  id,
  type: 'text',
  name: id,
  x: 540,
  y: 760,
  anchor: 'center',
  zIndex: 5,
  mode: 'fit',
  text: { value: id, fontSizePx: 60, fontWeight: 700, color: '#fff', align: 'center' },
  ...extra,
} as SceneElement)

describe('game win flow', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(1080, 1920)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits the authored delay before leaving a game-won scene', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const project: Project = {
      meta: { schemaVersion: 1, name: 'delay', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H, bgMatchColor: '#111111' },
      startSceneId: 'game1',
      scenes: [
        {
          id: 'game1',
          name: 'Game',
          kind: 'game',
          elements: [textEl('game')],
          advance: { on: 'gameWin', to: 'after1', delayMs: 2500 },
          transition: { type: 'none', durationMs: 0 },
        },
        {
          id: 'after1',
          name: 'After',
          kind: 'game',
          elements: [textEl('after')],
          advance: { on: 'manual' },
          transition: { type: 'none', durationMs: 0 },
        },
      ],
    }

    const mgr = playProject(project, {}, { mount, interactive: true })
    emit('game-complete')

    expect(mount.querySelector('.pa-el[data-id="after"]')).toBeNull()
    vi.advanceTimersByTime(2499)
    expect(mount.querySelector('.pa-el[data-id="after"]')).toBeNull()
    vi.advanceTimersByTime(1)
    expect(mount.querySelector('.pa-el[data-id="after"]')).toBeTruthy()

    mgr.destroy()
  })

  it('uses the authored game-won delay even when the game picks the destination scene', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const project: Project = {
      meta: { schemaVersion: 1, name: 'delay-override', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H, bgMatchColor: '#111111' },
      startSceneId: 'game1',
      scenes: [
        {
          id: 'game1',
          name: 'Game',
          kind: 'game',
          elements: [textEl('game')],
          advance: { on: 'gameWin', to: 'after1', delayMs: 2500 },
          transition: { type: 'none', durationMs: 0 },
        },
        {
          id: 'after1',
          name: 'After',
          kind: 'game',
          elements: [textEl('after')],
          advance: { on: 'manual' },
          transition: { type: 'none', durationMs: 0 },
        },
        {
          id: 'special1',
          name: 'Special',
          kind: 'game',
          elements: [textEl('special')],
          advance: { on: 'manual' },
          transition: { type: 'none', durationMs: 0 },
        },
      ],
    }

    const mgr = playProject(project, {}, { mount, interactive: true })
    emit('scene-goto-after-win', 'special1')
    emit('game-complete')

    expect(mount.querySelector('.pa-el[data-id="special"]')).toBeNull()
    vi.advanceTimersByTime(2499)
    expect(mount.querySelector('.pa-el[data-id="special"]')).toBeNull()
    vi.advanceTimersByTime(1)
    expect(mount.querySelector('.pa-el[data-id="special"]')).toBeTruthy()
    expect(mount.querySelector('.pa-el[data-id="after"]')).toBeNull()

    mgr.destroy()
  })

  it('does not skip the win overlay after a lose overlay was shown in the same game scene', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const project: Project = {
      meta: { schemaVersion: 1, name: 'lose-then-win', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H, bgMatchColor: '#111111' },
      startSceneId: 'game1',
      scenes: [
        {
          id: 'game1',
          name: 'Game',
          kind: 'game',
          elements: [textEl('game')],
          advance: { on: 'gameWin', to: 'win1', delayMs: 0 },
          transition: { type: 'none', durationMs: 0 },
        },
        {
          id: 'lose1',
          name: 'Lose',
          kind: 'overlay',
          elements: [textEl('lose')],
          advance: { on: 'timer', delayMs: 10 },
          transition: { type: 'none', durationMs: 0 },
        },
        {
          id: 'win1',
          name: 'Win',
          kind: 'overlay',
          elements: [textEl('win')],
          advance: { on: 'timer', delayMs: 1000, to: 'end1' },
          transition: { type: 'none', durationMs: 0 },
        },
        {
          id: 'end1',
          name: 'End',
          kind: 'game',
          elements: [textEl('end')],
          advance: { on: 'manual' },
          transition: { type: 'none', durationMs: 0 },
        },
      ],
    }

    const mgr = playProject(project, {}, { mount, interactive: true })

    emit('scene-overlay', { sceneId: 'lose1' })
    vi.advanceTimersByTime(400)
    expect(mount.querySelector('.pa-el[data-id="lose"]')).toBeNull()
    expect(mount.querySelector('.pa-el[data-id="game"]')).toBeTruthy()

    emit('game-complete')
    vi.advanceTimersByTime(0)

    expect(mount.querySelector('.pa-el[data-id="win"]')).toBeTruthy()
    expect(mount.querySelector('.pa-el[data-id="end"]')).toBeNull()

    mgr.destroy()
  })

  it('keeps legacy on-game-won entrance elements visible before the win', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const scene: Scene = {
      meta: { schemaVersion: 1, name: 'win-trigger', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H },
      kind: 'game',
      elements: [
        textEl('win-copy', {
          animations: {
            entrance: { preset: 'pop', durationMs: 420, delayMs: 0, easing: 'ease-out', trigger: 'onGameWin' },
          },
        }),
      ],
    }

    const stage = buildScene(scene, {}, { mount })
    stage.layoutAll()
    stage.playEntrances()

    expect(stage.get('win-copy')?.outer.style.display).toBe('')
    expect(stage.get('win-copy')?.outer.classList.contains('pa-el--win-wait')).toBe(false)

    stage.destroy()
  })
})
