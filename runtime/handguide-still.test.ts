// The 'still' handguide: placed and left alone. Every other mode drives the hand from
// a rAF loop that writes a transform each frame; 'still' must never start that loop,
// so the hand cannot drift, bounce or scale — it just sits where it was put.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'

function hand(mode: string): SceneElement {
  return {
    id: 'hg', type: 'handguide', name: 'Hint hand', x: 540, y: 900, w: 60, h: 74,
    anchor: 'center', zIndex: 9, mode: 'fit', assetId: 'hand',
    handguide: { mode, nodes: [{ x: 300, y: 900 }], periodMs: 800 },
  } as unknown as SceneElement
}

const scene = (el: SceneElement): Scene => ({
  meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: [el],
  kind: 'game',
})

const ASSETS = { hand: { src: 'hand.png', w: 46, h: 56 } }

function mount(mode: string): { content: HTMLElement; stage: ReturnType<typeof buildScene> } {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene(hand(mode)), ASSETS, { mount: host })
  stage.layoutAll()
  stage.startGames(true)
  return { content: host.querySelector('.pa-el[data-id="hg"] img') as HTMLElement, stage }
}

describe('handguide: still mode', () => {
  beforeEach(() => {
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    vi.spyOn(window, 'requestAnimationFrame')
  })
  afterEach(() => vi.restoreAllMocks())

  it('never starts an animation frame, and writes no transform', () => {
    const { content } = mount('still')
    expect(content).toBeTruthy()
    expect(content.style.opacity).toBe('1') // shown...
    expect(content.style.transform).toBe('') // ...but never moved
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('still animates in every other mode (so the test above means something)', () => {
    mount('slide')
    expect(window.requestAnimationFrame).toHaveBeenCalled()
  })
})
