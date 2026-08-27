// Drag to clean + the progress bar it feeds.
//
// The two are tested together because the interesting part of either is the seam:
// the bar's step count comes from the board, and the board's win and the bar's win
// race each other for the redirect.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

// jsdom gives every element a zero-size rect, which the coverage test needs to be
// real. Stubs the .pa-el-anim too — that inner node is what the game measures (it is
// where the pick-up scale lives), and it inherits nothing from its parent's stub.
function stubRect(el: HTMLElement, x: number, y: number, w: number, h: number): void {
  const rect = (): DOMRect => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect
  el.getBoundingClientRect = rect
  const anim = el.querySelector<HTMLElement>('.pa-el-anim')
  if (anim) anim.getBoundingClientRect = rect
}

function pointer(type: string, x: number, y: number, init: { pointerId?: number; pointerType?: string } = {}): PointerEvent {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as PointerEvent
  // jsdom's MouseEvent ignores unknown init keys, so pin them on afterwards.
  for (const [key, value] of Object.entries(init)) Object.defineProperty(ev, key, { value, configurable: true })
  return ev
}

function game(params: Record<string, unknown> = {}): SceneElement {
  return {
    id: 'clean-game',
    type: 'game-mount',
    name: 'Clean',
    x: 540,
    y: 960,
    w: 1000,
    h: 800,
    anchor: 'center',
    zIndex: 1,
    mode: 'fit',
    game: { templateId: 'dragclean', hintEnabled: false, params: { fadeMs: 0, ...params } },
  } as SceneElement
}

function bar(params: Record<string, unknown> = {}, id = 'bar'): SceneElement {
  return {
    id,
    type: 'game-mount',
    name: 'Bar',
    x: 540,
    y: 200,
    w: 900,
    h: 40,
    anchor: 'center',
    zIndex: 2,
    mode: 'fit',
    game: { templateId: 'progressbar', hintEnabled: false, params: { fillMs: 0, popMs: 0, ...params } },
  } as SceneElement
}

function tool(id = 'cloth'): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'cloth',
    x: 200,
    y: 1600,
    w: 200,
    h: 200,
    anchor: 'center',
    zIndex: 9,
    mode: 'fit',
    cleanRole: { gameId: 'clean-game', role: 'draggable' },
  } as SceneElement
}

/** Extra art riding on one obstacle — never cleaned on its own, gone when it goes. */
function part(id: string, ofId: string): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'stain',
    x: 700,
    y: 900,
    w: 60,
    h: 60,
    anchor: 'center',
    zIndex: 6,
    mode: 'fit',
    cleanRole: { gameId: 'clean-game', role: 'attachment', ofId },
  } as SceneElement
}

function mess(id: string, x: number, y: number): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'stain',
    x,
    y,
    w: 200,
    h: 200,
    anchor: 'center',
    zIndex: 5,
    mode: 'fit',
    cleanRole: { gameId: 'clean-game', role: 'obstacle' },
  } as SceneElement
}

const ASSETS = {
  cloth: { src: 'cloth.png', w: 200, h: 200 },
  stain: { src: 'stain.png', w: 200, h: 200 },
  wipeSfx: { src: 'wipe.mp3', w: 0, h: 0 },
}

function build(elements: SceneElement[]): ReturnType<typeof buildScene> {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'clean', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    kind: 'game',
    elements,
  }
  return buildScene(scene, ASSETS, { mount })
}

/** Place the tool and the obstacles on a grid jsdom can actually measure: the tool
 * at the origin, each obstacle 300px further right, all 200x200. */
function place(stage: ReturnType<typeof buildScene>, ids: string[]): Record<string, HTMLElement> {
  const out: Record<string, HTMLElement> = {}
  const toolEl = stage.root.querySelector<HTMLElement>('[data-clean-role="draggable"]')!
  stubRect(toolEl, 0, 0, 200, 200)
  out.tool = toolEl
  ids.forEach((id, i) => {
    const el = stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
    stubRect(el, 300 + i * 300, 0, 200, 200)
    out[id] = el
  })
  return out
}

/** Carry the tool to (x, y) as one gesture. `stubRect` is re-applied along the way
 * because the game measures live rects and jsdom does not move a stubbed one. */
function carry(toolEl: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
  toolEl.dispatchEvent(pointer('pointerdown', from.x, from.y, { pointerId: 1, pointerType: 'touch' }))
  stubRect(toolEl, to.x - 100, to.y - 100, 200, 200)
  window.dispatchEvent(pointer('pointermove', to.x, to.y, { pointerId: 1, pointerType: 'touch' }))
}

const q = (s: ReturnType<typeof buildScene>, id: string): HTMLElement => s.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!

describe('drag to clean', () => {
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

  it('tags roles onto placed elements and leaves their visuals alone', () => {
    const stage = build([game(), tool(), mess('m1', 700, 900)])
    stage.layoutAll()
    stage.startGames(false)

    const toolEl = stage.root.querySelector<HTMLElement>('[data-id="cloth"]')!
    const messEl = stage.root.querySelector<HTMLElement>('[data-id="m1"]')!
    expect(toolEl.dataset.cleanRole).toBe('draggable')
    expect(toolEl.dataset.cleanGameId).toBe('clean-game')
    expect(messEl.dataset.cleanRole).toBe('obstacle')
    // The editor canvas keeps everything visible and placeable — the game removes an
    // obstacle only once it has actually been wiped in play.
    expect(messEl.classList.contains('pa-combo-off')).toBe(false)
    // A tagged element must still be able to receive the drag.
    expect(toolEl.style.pointerEvents).not.toBe('none')
  })

  it('cleans an obstacle the tool covers, and leaves one it only clips', () => {
    const stage = build([game({ coverPct: 70 }), tool(), mess('m1', 700, 900), mess('m2', 900, 900)])
    stage.layoutAll()
    stage.startGames(true)
    const els = place(stage, ['m1', 'm2'])

    // Clipping m1 by a quarter of its width is not covering it: the tool spans
    // 150-350 and m1 spans 300-500, so 50 of 200 px overlap — 25%, under the 70%.
    carry(els.tool, { x: 100, y: 100 }, { x: 250, y: 100 })
    expect(els.m1.classList.contains('pa-combo-off')).toBe(false)

    // Landing on it is.
    stubRect(els.tool, 350, 0, 200, 200)
    window.dispatchEvent(pointer('pointermove', 400, 100, { pointerId: 1, pointerType: 'touch' }))
    expect(els.m1.classList.contains('pa-combo-off')).toBe(true)
    expect(els.m2.classList.contains('pa-combo-off')).toBe(false)
  })

  it('cleans a big obstacle with a small tool, and a small one with a big tool', () => {
    const stage = build([game({ coverPct: 70 }), tool(), mess('m1', 700, 900)])
    stage.layoutAll()
    stage.startGames(true)
    const toolEl = stage.root.querySelector<HTMLElement>('[data-clean-role="draggable"]')!
    const messEl = stage.root.querySelector<HTMLElement>('[data-id="m1"]')!
    // A 100x100 tool sitting fully inside a 600x600 stain covers 1.4% of the stain
    // but 100% of itself — which is the reading that makes a big stain cleanable.
    stubRect(toolEl, 0, 0, 100, 100)
    stubRect(messEl, 0, 0, 600, 600)
    toolEl.dispatchEvent(pointer('pointerdown', 50, 50, { pointerId: 1, pointerType: 'touch' }))
    stubRect(toolEl, 200, 200, 100, 100)
    window.dispatchEvent(pointer('pointermove', 250, 250, { pointerId: 1, pointerType: 'touch' }))
    expect(messEl.classList.contains('pa-combo-off')).toBe(true)
  })

  it('cleans a small obstacle with a big tool', () => {
    const stage = build([game({ coverPct: 70 }), tool(), mess('m1', 700, 900)])
    stage.layoutAll()
    stage.startGames(true)
    const toolEl = stage.root.querySelector<HTMLElement>('[data-clean-role="draggable"]')!
    const messEl = stage.root.querySelector<HTMLElement>('[data-id="m1"]')!
    // The mirror image: a 600x600 cloth swept over a 60x60 crumb covers 1% of the
    // cloth and 100% of the crumb, and the smaller-of-the-two reading catches it.
    stubRect(toolEl, 0, 0, 600, 600)
    stubRect(messEl, 700, 200, 60, 60)
    toolEl.dispatchEvent(pointer('pointerdown', 300, 300, { pointerId: 1, pointerType: 'touch' }))
    stubRect(toolEl, 400, 0, 600, 600)
    window.dispatchEvent(pointer('pointermove', 700, 300, { pointerId: 1, pointerType: 'touch' }))
    expect(messEl.classList.contains('pa-combo-off')).toBe(true)
  })

  it('cannot be dragged off screen', () => {
    const stage = build([game(), tool(), mess('m1', 700, 900)])
    stage.layoutAll()
    stage.startGames(true)
    const els = place(stage, ['m1'])
    // The bounds are .pa-root intersected with the viewport, so a playable embedded
    // in a frame smaller than the window is held to the frame. Here jsdom's window is
    // the smaller of the two, which is exactly the case worth pinning.
    stubRect(stage.root, 0, 0, 4000, 4000)
    const maxX = window.innerWidth - 200
    const maxY = window.innerHeight - 200

    els.tool.dispatchEvent(pointer('pointerdown', 100, 100, { pointerId: 1, pointerType: 'touch' }))
    // Hurl it far past the top-left corner. The tool rests at (0,0,200,200), so the
    // furthest left it may go is 0 — the clamp has to swallow the whole overshoot.
    window.dispatchEvent(pointer('pointermove', -900, -900, { pointerId: 1, pointerType: 'touch' }))
    expect(els.tool.style.translate).toBe('0.0px 0.0px')

    window.dispatchEvent(pointer('pointermove', 5000, 5000, { pointerId: 1, pointerType: 'touch' }))
    expect(els.tool.style.translate).toBe(`${maxX.toFixed(1)}px ${maxY.toFixed(1)}px`)
  })

  it('points the hint at the nearest obstacle still standing', () => {
    const stage = build([game(), tool(), mess('m1', 700, 900), mess('m2', 900, 900)])
    stage.layoutAll()
    stage.startGames(true)
    const els = place(stage, ['m1', 'm2'])

    expect(els.m1.dataset.cleanHint).toBe('1')
    expect(els.m2.dataset.cleanHint).toBeUndefined()

    carry(els.tool, { x: 100, y: 100 }, { x: 400, y: 100 })
    // m1 is gone, so the hand re-targets on its own.
    expect(els.m1.classList.contains('pa-combo-off')).toBe(true)
    expect(els.m2.dataset.cleanHint).toBe('1')
  })

  it('wins when every obstacle is cleaned, and earlier on a win target', () => {
    const winSeen: string[] = []
    off = on('game-complete', () => winSeen.push('win'))
    const stage = build([game({ winObstacles: 1 }), tool(), mess('m1', 700, 900), mess('m2', 900, 900)])
    stage.layoutAll()
    stage.startGames(true)
    const els = place(stage, ['m1', 'm2'])

    carry(els.tool, { x: 100, y: 100 }, { x: 400, y: 100 })
    vi.runAllTimers()
    expect(winSeen).toEqual(['win'])
    expect(els.m2.classList.contains('pa-combo-off')).toBe(false) // never had to be cleaned
  })

  it('fans the three gameplay beats out to any element, as sound and animation', () => {
    // The beats are addressed to the SCENE, not to the game mount: a counter, a
    // headline or the obstacle itself can each react without being a child of the
    // game. That is why they go out as element bindings and animation phases rather
    // than on the plain 'sfx' channel.
    const responder = {
      id: 'responder',
      type: 'text',
      name: 'Responder',
      x: 540,
      y: 300,
      anchor: 'center',
      zIndex: 9,
      mode: 'fit',
      text: { value: 'React', fontSizePx: 40, color: '#fff' },
      animations: { cleanWipe: { preset: 'pop', durationMs: 200, delayMs: 0, easing: 'ease-out' } },
      sfx: [
        { event: 'cleanPick', assetId: 'wipeSfx' },
        { event: 'cleanWipe', assetId: 'wipeSfx' },
        { event: 'cleanDrop', assetId: 'wipeSfx' },
      ],
    } as SceneElement

    const heard: string[] = []
    off = on('sfx-asset', (id: unknown) => heard.push(String(id)))
    const stage = build([game(), tool(), mess('m1', 700, 900), responder])
    stage.layoutAll()
    stage.startGames(true)
    const els = place(stage, ['m1'])
    const anim = stage.root.querySelector<HTMLElement>('[data-id="responder"] .pa-el-anim')!

    els.tool.dispatchEvent(pointer('pointerdown', 100, 100, { pointerId: 1, pointerType: 'touch' }))
    expect(heard.length).toBe(1) // cleanPick

    stubRect(els.tool, 300, 0, 200, 200)
    window.dispatchEvent(pointer('pointermove', 400, 100, { pointerId: 1, pointerType: 'touch' }))
    expect(heard.length).toBe(2) // cleanWipe
    // Fired while the obstacle is still visible, so an authored wipe actually plays.
    expect(anim.style.animation).toContain('pa-pop')

    window.dispatchEvent(pointer('pointerup', 400, 100, { pointerId: 1, pointerType: 'touch' }))
    expect(heard.length).toBe(3) // cleanDrop
  })

  it('fades an obstacle’s attachments away with it, and only its own', () => {
    const stage = build([game(), tool(), mess('m1', 700, 900), mess('m2', 900, 900), part('shadow', 'm1'), part('shine', 'm1'), part('other', 'm2')])
    stage.layoutAll()
    stage.startGames(true)
    const els = place(stage, ['m1', 'm2'])

    carry(els.tool, { x: 100, y: 100 }, { x: 400, y: 100 })
    expect(els.m1.classList.contains('pa-combo-off')).toBe(true)
    // Both of m1's pieces go with it, on the same beat.
    expect(q(stage, 'shadow').classList.contains('pa-combo-off')).toBe(true)
    expect(q(stage, 'shine').classList.contains('pa-combo-off')).toBe(true)
    // m2's does not — it belongs to something still standing.
    expect(q(stage, 'other').classList.contains('pa-combo-off')).toBe(false)
  })

  it('never treats an attachment as something to clean', () => {
    const stage = build([game(), bar(), tool(), mess('m1', 700, 900), part('shadow', 'm1')])
    stage.layoutAll()
    stage.startGames(true)
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!
    // One obstacle on the board, not two — an attachment is part of a thing, not a
    // thing. If it counted, the bar would read 1 of 2 and the game could never be won.
    expect(track.dataset.progressTotal).toBe('1')

    const els = place(stage, ['m1'])
    // Park the attachment right under the tool. It must not be hit-tested: the only
    // thing that can end this board is covering the obstacle itself.
    stubRect(q(stage, 'shadow'), 0, 0, 60, 60)
    els.tool.dispatchEvent(pointer('pointerdown', 100, 100, { pointerId: 1, pointerType: 'touch' }))
    window.dispatchEvent(pointer('pointermove', 110, 110, { pointerId: 1, pointerType: 'touch' }))
    expect(track.dataset.progressValue).toBe('0')
    expect(q(stage, 'shadow').classList.contains('pa-combo-off')).toBe(false)
  })

  it('puts attachments back on destroy', () => {
    const stage = build([game(), tool(), mess('m1', 700, 900), part('shadow', 'm1')])
    stage.layoutAll()
    stage.startGames(true)
    const els = place(stage, ['m1'])
    carry(els.tool, { x: 100, y: 100 }, { x: 400, y: 100 })
    expect(q(stage, 'shadow').classList.contains('pa-combo-off')).toBe(true)

    stage.destroy()
    expect(q(stage, 'shadow').classList.contains('pa-combo-off')).toBe(false)
    expect(q(stage, 'shadow').dataset.cleanClaimedBy).toBeUndefined()
  })

  it('restores every obstacle on destroy, so the canvas is left as it was found', () => {
    const stage = build([game(), tool(), mess('m1', 700, 900)])
    stage.layoutAll()
    stage.startGames(true)
    const els = place(stage, ['m1'])
    carry(els.tool, { x: 100, y: 100 }, { x: 400, y: 100 })
    expect(els.m1.classList.contains('pa-combo-off')).toBe(true)

    stage.destroy()
    expect(els.m1.classList.contains('pa-combo-off')).toBe(false)
    expect(els.m1.dataset.cleanClaimedBy).toBeUndefined()
    expect(els.tool.style.translate).toBe('')
  })
})

describe('progress bar', () => {
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

  it('takes its step count from the game feeding it', () => {
    const stage = build([game(), bar(), tool(), mess('m1', 700, 900), mess('m2', 900, 900), mess('m3', 300, 900)])
    stage.layoutAll()
    stage.startGames(true)

    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!
    expect(track.dataset.progressTotal).toBe('3')
    expect(track.dataset.progressValue).toBe('0')
  })

  it('gains a step per obstacle cleaned', () => {
    const stage = build([game(), bar(), tool(), mess('m1', 700, 900), mess('m2', 900, 900)])
    stage.layoutAll()
    stage.startGames(true)
    const els = place(stage, ['m1', 'm2'])
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!

    carry(els.tool, { x: 100, y: 100 }, { x: 400, y: 100 })
    expect(track.dataset.progressValue).toBe('1')

    stubRect(els.tool, 550, 0, 200, 200)
    window.dispatchEvent(pointer('pointermove', 650, 100, { pointerId: 1, pointerType: 'touch' }))
    expect(track.dataset.progressValue).toBe('2')
  })

  it('wins first when its own step count is lower than the board', () => {
    const winSeen: string[] = []
    off = on('game-complete', () => winSeen.push('win'))
    const stage = build([game(), bar({ steps: 1 }), tool(), mess('m1', 700, 900), mess('m2', 900, 900)])
    stage.layoutAll()
    stage.startGames(true)
    const els = place(stage, ['m1', 'm2'])
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!

    carry(els.tool, { x: 100, y: 100 }, { x: 400, y: 100 })
    vi.runAllTimers()
    expect(track.dataset.progressComplete).toBe('1')
    // The stage races both mounts and the FIRST win owns the redirect, so the
    // still-unfinished board cannot fire a second one.
    expect(winSeen).toEqual(['win'])
  })

  it('ignores a source it was not told to listen to', () => {
    const stage = build([game(), bar({ sourceGameId: 'somebody-else', steps: 4 }), tool(), mess('m1', 700, 900)])
    stage.layoutAll()
    stage.startGames(true)
    const els = place(stage, ['m1'])
    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!

    carry(els.tool, { x: 100, y: 100 }, { x: 400, y: 100 })
    expect(track.dataset.progressValue).toBe('0')
    expect(track.dataset.progressTotal).toBe('4')
  })

  it('builds a continuous fill, not an empty track', () => {
    // The regression this pins: the fill children were rebuilt only when the SEGMENT
    // count changed, and continuous mode wants zero segments — so "already built" and
    // "nothing built yet" both read as zero and the fill was never created at all.
    // The track painted, the fill did not, and the bar looked like it was missing.
    const stage = build([game(), bar(), tool(), mess('m1', 700, 900), mess('m2', 900, 900)])
    stage.layoutAll()
    stage.startGames(true)

    const fill = stage.root.querySelector<HTMLElement>('[data-progress-fill]')
    expect(fill).not.toBeNull()
    expect(fill!.style.background).toBe('rgb(61, 220, 132)')
    expect(fill!.style.width).toBe('0%') // nothing cleaned yet

    const els = place(stage, ['m1', 'm2'])
    carry(els.tool, { x: 100, y: 100 }, { x: 400, y: 100 })
    expect(fill!.style.width).toBe('50%')
  })

  it('shows itself part-filled on the editor canvas, so it can be styled', () => {
    // start() is what zeroes it, and the canvas never calls it: a bar an author has
    // just placed has to show its fill colour, or there is nothing to judge.
    const stage = build([game(), bar({ steps: 4 }), tool(), mess('m1', 700, 900)])
    stage.layoutAll()
    stage.startGames(false)

    const track = stage.root.querySelector<HTMLElement>('[data-progress-bar]')!
    const fill = stage.root.querySelector<HTMLElement>('[data-progress-fill]')!
    expect(track.dataset.progressValue).toBe('2')
    expect(fill.style.width).toBe('50%')
  })

  it('rebuilds the fill when the style is switched between continuous and segmented', () => {
    const stage = build([game(), bar({ fillStyle: 'segmented' }), tool(), mess('m1', 700, 900), mess('m2', 900, 900)])
    stage.layoutAll()
    stage.startGames(true)
    // Two obstacles announced => two segments, and no leftover continuous fill.
    expect(stage.root.querySelectorAll('[data-progress-seg]').length).toBe(2)
    expect(stage.root.querySelector('[data-progress-fill]')).toBeNull()
  })

  it('draws one segment per step in segmented mode', () => {
    const stage = build([game(), bar({ fillStyle: 'segmented' }), tool(), mess('m1', 700, 900), mess('m2', 900, 900), mess('m3', 300, 900)])
    stage.layoutAll()
    stage.startGames(true)

    const segs = stage.root.querySelectorAll('[data-progress-seg]')
    expect(segs.length).toBe(3)
    expect(stage.root.querySelector('[data-progress-fill]')).toBeNull()
  })

  it('never swallows the touches meant for the board behind it', () => {
    const stage = build([game(), bar(), tool(), mess('m1', 700, 900)])
    stage.layoutAll()
    stage.startGames(true)
    const shell = stage.root.querySelector<HTMLElement>('[data-id="bar"]')!
    expect(shell.style.pointerEvents).toBe('none')
  })
})
