// The editor canvas re-renders a scene through StageHandle.update() — an in-place
// path that avoids tearing the DOM down on every keystroke. Preview and export never
// use it; they always build fresh. So anything update() forgets to do shows up as
// "the canvas doesn't match the preview", which is exactly what a game-mount hit:
// update() resized the mount's BOX but never told the game inside, leaving it laid
// out for whatever size it saw at mount.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import { GAME_TEMPLATES } from './games/registry'
import type { GameModule, GameTemplate } from './games/types'
import type { Scene, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920

// A stub template registered into the real registry: it records the slot size it was
// told to lay out for, which is the thing under test.
let seen: { w: number; h: number }[] = []
const PROBE: GameTemplate = {
  id: 'zz_probe',
  label: 'Probe',
  paramFields: [],
  defaultParams: {},
  create(): GameModule {
    let root: HTMLElement
    const note = (): void => void seen.push({ w: root.clientWidth, h: root.clientHeight })
    return {
      mount(ctx) {
        root = ctx.root
        note()
      },
      start() {},
      relayout: note,
      getHint: () => null,
      onComplete() {},
      destroy() {},
    }
  },
}

function gameEl(over: Partial<SceneElement> = {}): SceneElement {
  return {
    id: 'g1', type: 'game-mount', name: 'Game', x: 540, y: 900, w: 900, h: 900,
    anchor: 'center', zIndex: 5, mode: 'fit', game: { templateId: 'zz_probe', params: {} },
    ...over,
  } as SceneElement
}

function makeScene(elements: SceneElement[]): Scene {
  return {
    meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H },
    elements,
    kind: 'game',
  }
}

describe('game-mount stays laid out through the editor update path', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    seen = []
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(DESIGN_W, DESIGN_H)
    if (!GAME_TEMPLATES.some((t) => t.id === PROBE.id)) GAME_TEMPLATES.push(PROBE)
    // jsdom reports 0 for every box, so resolve the inline px the stage wrote: the
    // game slot is width/height:100%, so walk up to the nearest ancestor sized in px.
    const resolve = (el: HTMLElement | null, prop: 'width' | 'height'): number => {
      for (let n = el; n; n = n.parentElement) {
        const v = n.style[prop]
        if (v.endsWith('px')) return parseFloat(v)
      }
      return 0
    }
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return resolve(this, 'width')
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return resolve(this, 'height')
    })
  })

  it('re-lays the game out when update() resizes its mount', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const stage = buildScene(makeScene([gameEl()]), {}, { mount })
    stage.layoutAll()
    stage.startGames(false)
    const atMount = seen[seen.length - 1]
    expect(atMount.w).toBeGreaterThan(0)

    // Resize the element the way the inspector/canvas drag does, then re-render
    // in place — the game must be told about its new box.
    seen = []
    const applied = stage.update(makeScene([gameEl({ w: 450, h: 450 })]), {})
    expect(applied).toBe(true) // the in-place path really is the one being exercised
    const after = seen[seen.length - 1]
    expect(after).toBeDefined()
    expect(after.w).toBeCloseTo(atMount.w / 2, 0)
    expect(after.h).toBeCloseTo(atMount.h / 2, 0)
  })

  it('agrees with a full rebuild — the canvas and the preview see the same box', () => {
    const a = document.createElement('div')
    document.body.appendChild(a)
    const stage = buildScene(makeScene([gameEl()]), {}, { mount: a })
    stage.layoutAll()
    stage.startGames(false)
    stage.update(makeScene([gameEl({ w: 450, h: 450 })]), {})
    const viaUpdate = seen[seen.length - 1]

    seen = []
    const b = document.createElement('div')
    document.body.appendChild(b)
    const fresh = buildScene(makeScene([gameEl({ w: 450, h: 450 })]), {}, { mount: b })
    fresh.layoutAll()
    fresh.startGames(false)
    const viaBuild = seen[seen.length - 1]

    expect(viaUpdate.w).toBeCloseTo(viaBuild.w, 1)
    expect(viaUpdate.h).toBeCloseTo(viaBuild.h, 1)
  })
})
