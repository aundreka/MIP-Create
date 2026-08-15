import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

describe('thought whacker scene event triggers', () => {
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

  it('replays animation and sound bindings on other scene elements for spawn and whack', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const responder: SceneElement = {
      id: 'responder',
      type: 'text',
      name: 'Responder',
      x: 540,
      y: 300,
      anchor: 'center',
      zIndex: 2,
      mode: 'fit',
      text: { value: 'React!', fontSizePx: 60, color: '#fff' },
      animations: {
        thoughtSpawn: { preset: 'pop', durationMs: 300, delayMs: 0, easing: 'ease-out' },
        thoughtWhack: { preset: 'shake', durationMs: 300, delayMs: 0, easing: 'ease-out' },
      },
      sfx: [
        { event: 'thoughtSpawn', assetId: 'spawn-sfx' },
        { event: 'thoughtWhack', assetId: 'whack-sfx' },
      ],
    } as SceneElement
    const game: SceneElement = {
      id: 'game',
      type: 'game-mount',
      name: 'Thoughts',
      x: 540,
      y: 1000,
      w: 900,
      h: 1100,
      anchor: 'center',
      zIndex: 3,
      mode: 'fit',
      game: {
        templateId: 'thoughtwhack',
        hintEnabled: false,
        params: {
          thoughtCount: 1,
          roundSeconds: 5,
          spawnStaggerMs: 0,
          thoughtImages: ['thought'],
          whackImage: 'whack',
        },
      },
    } as SceneElement
    const scene: Scene = {
      meta: { schemaVersion: 1, name: 'thought-events', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      kind: 'game',
      elements: [responder, game],
    }
    const heard: string[] = []
    off = on('sfx-asset', (id: unknown) => heard.push(String(id)))

    const stage = buildScene(
      scene,
      {
        thought: { src: 'thought.png', w: 200, h: 200 },
        whack: { src: 'whack.png', w: 200, h: 200 },
        'spawn-sfx': { src: 'spawn.mp3', w: 0, h: 0 },
        'whack-sfx': { src: 'whack.mp3', w: 0, h: 0 },
      },
      { mount },
    )
    stage.layoutAll()
    stage.startGames(true)
    vi.advanceTimersByTime(20)

    const anim = stage.root.querySelector<HTMLElement>('.pa-el[data-id="responder"] .pa-el-anim')!
    expect(heard).toContain('spawn-sfx')
    expect(anim.style.animation).toContain('pa-pop')

    stage.root.querySelector<HTMLElement>('[data-tw-thought]')!.dispatchEvent(new Event('pointerdown'))
    expect(heard).toContain('whack-sfx')
    expect(anim.style.animation).toContain('pa-shake')
    stage.destroy()
  })
})
