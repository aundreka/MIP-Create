// The hold gauge's win sound, end to end: the game reports its win, the host hands
// that to the stage, and the stage plays the sound the AUTHOR bound to this element
// — timed to the "On game won" animation phase rather than fired the instant the
// dial lands. Three seams (game → gameHost → stage), so it is worth one real scene.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScene } from './stage'
import { on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'

const WIN_ASSET = 'sfx_win'

function makeScene(sfx?: SceneElement['sfx']): Scene {
  return {
    meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    kind: 'game',
    elements: [
      {
        id: 'g1', type: 'game-mount', name: 'Gauge', x: 540, y: 900, w: 900, h: 900,
        anchor: 'center', zIndex: 5, mode: 'fit',
        game: { templateId: 'holdgauge', params: { fillSecs: 0.5, sizePx: 700 }, hintEnabled: false },
        sfx,
      } as SceneElement,
    ],
  }
}

describe('hold gauge: the win sound the author bound to the element', () => {
  let played: { id: string; vol: number }[]
  let events: string[]
  let offs: (() => void)[]

  beforeEach(() => {
    document.body.innerHTML = ''
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    played = []
    events = []
    offs = [
      on('sfx-asset', (id: unknown, v: unknown) => played.push({ id: String(id), vol: Number(v ?? 1) })),
      on('sfx', (e: unknown) => events.push(String(e))),
    ]
  })

  afterEach(() => {
    for (const off of offs) off()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  /** Hold until the dial reaches the top. */
  const holdToWin = (): void => {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { clientX: 5, clientY: 5, bubbles: true }))
    vi.advanceTimersByTime(700) // a 0.5s bar, held past the top
  }

  it('plays the element"s own win sound, after the game-won beat', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const stage = buildScene(makeScene([{ event: 'onReveal', assetId: WIN_ASSET, volume: 0.8 }]), { [WIN_ASSET]: { src: 'win.mp3', w: 0, h: 0 } }, { mount })
    stage.layoutAll()
    stage.startGames(true)

    holdToWin()
    // The win has happened, but the sound is deliberately held back to line up with
    // the "On game won" animation phase.
    expect(played).toEqual([])
    vi.advanceTimersByTime(600)
    expect(played).toEqual([{ id: WIN_ASSET, vol: 0.8 }])
    // The project-wide "Game win" event still fires too — the two are separate slots.
    expect(events).toContain('gameWin')
    stage.destroy()
  })

  it('leaves the project-wide win sound alone when nothing is bound to the element', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const stage = buildScene(makeScene(), {}, { mount })
    stage.layoutAll()
    stage.startGames(true)

    holdToWin()
    vi.advanceTimersByTime(600)
    expect(played).toEqual([])
    expect(events).toContain('gameWin')
    stage.destroy()
  })
})
