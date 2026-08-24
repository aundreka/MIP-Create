import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

// jsdom gives every element a zero-size rect, which the drop test needs to be real.
function stubRect(el: HTMLElement, x: number, y: number, w: number, h: number): void {
  el.getBoundingClientRect = () =>
    ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect
}

function pointer(type: string, x: number, y: number): PointerEvent {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as PointerEvent
}

const GAME: SceneElement = {
  id: 'combo-game',
  type: 'game-mount',
  name: 'Combo',
  x: 540,
  y: 1400,
  w: 1000,
  h: 500,
  anchor: 'center',
  zIndex: 1,
  mode: 'fit',
  game: {
    templateId: 'combo',
    hintEnabled: false,
    params: { questions: 2, flyMs: 100, advanceDelayMs: 200, dismissMs: 50, zoneX: 0, zoneY: 0, zoneW: 100, zoneH: 100 },
  },
} as SceneElement

const ANCHOR: SceneElement = {
  id: 'anchor',
  type: 'image',
  name: 'Anchor',
  assetId: 'base',
  x: 540,
  y: 500,
  w: 600,
  h: 600,
  anchor: 'center',
  zIndex: 2,
  mode: 'fit',
  comboRole: { gameId: 'combo-game', role: 'anchor' },
} as SceneElement

function option(id: string, question: number, choice: number, assetId: string, layerAssetId?: string): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId,
    x: 300 + choice * 200,
    y: 1200,
    w: 200,
    h: 200,
    anchor: 'center',
    zIndex: 5,
    mode: 'fit',
    comboRole: { gameId: 'combo-game', role: 'option', question, choice, layerAssetId },
  } as SceneElement
}

function title(id: string, question: number): SceneElement {
  return {
    id,
    type: 'text',
    name: id,
    x: 540,
    y: 200,
    anchor: 'center',
    zIndex: 3,
    mode: 'fit',
    text: { value: `Question ${question}`, fontSizePx: 60, color: '#fff' },
    comboRole: { gameId: 'combo-game', role: 'title', question },
  } as SceneElement
}

const ASSETS = {
  base: { src: 'base.png', w: 600, h: 600 },
  optA: { src: 'a.png', w: 200, h: 200 },
  optB: { src: 'b.png', w: 200, h: 200 },
  layerA: { src: 'layer-a.png', w: 400, h: 400 },
  pickSfx: { src: 'pick.mp3', w: 0, h: 0 },
  dropSfx: { src: 'drop.mp3', w: 0, h: 0 },
  nextSfx: { src: 'next.mp3', w: 0, h: 0 },
}

function build(elements: SceneElement[]): ReturnType<typeof buildScene> {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'combo', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    kind: 'game',
    elements,
  }
  return buildScene(scene, ASSETS, { mount })
}

describe('combo builder', () => {
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

  it('tags roles onto scene elements and keeps options interactive', () => {
    const stage = build([GAME, ANCHOR, title('t1', 1), option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB')])
    stage.layoutAll()
    stage.startGames(false)

    const opt = stage.root.querySelector<HTMLElement>('[data-id="a1"]')!
    expect(opt.dataset.comboRole).toBe('option')
    expect(opt.dataset.comboGameId).toBe('combo-game')
    expect(opt.dataset.comboQuestion).toBe('1')
    expect(opt.dataset.comboChoice).toBe('1')
    // Falls back to the option's own image when no explicit layer art is set.
    expect(opt.dataset.comboLayerAsset).toBe('optA')
    // Options must receive pointer events; the generic non-interactive rule would
    // otherwise switch them off because an image is decorative by default.
    expect(opt.style.pointerEvents).not.toBe('none')
    stage.destroy()
  })

  it('uses explicit layer art over the option image when set', () => {
    const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA', 'layerA')])
    stage.layoutAll()
    stage.startGames(false)
    expect(stage.root.querySelector<HTMLElement>('[data-id="a1"]')!.dataset.comboLayerAsset).toBe('layerA')
    stage.destroy()
  })

  it('previews every question layer on the editor canvas and clears it for real play', () => {
    const els = [GAME, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB'), option('b1', 2, 1, 'layerA')]

    const editor = build(els)
    editor.layoutAll()
    editor.startGames(false)
    // Static canvas: both questions' layers are painted so the inspector's layer
    // rect fields are WYSIWYG.
    expect(editor.root.querySelectorAll('.pa-combo-layer').length).toBe(2)
    editor.destroy()

    document.body.innerHTML = ''
    const play = build(els)
    play.layoutAll()
    play.startGames(true)
    expect(play.root.querySelectorAll('.pa-combo-layer').length).toBe(0)
    play.destroy()
  })

  it('shows only the live question and hides the rest once play starts', () => {
    const stage = build([GAME, ANCHOR, title('t1', 1), title('t2', 2), option('a1', 1, 1, 'optA'), option('b1', 2, 1, 'optB')])
    stage.layoutAll()
    stage.startGames(true)

    const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
    expect(q('t1').classList.contains('pa-combo-off')).toBe(false)
    expect(q('a1').classList.contains('pa-combo-off')).toBe(false)
    expect(q('t2').classList.contains('pa-combo-off')).toBe(true)
    expect(q('b1').classList.contains('pa-combo-off')).toBe(true)
    stage.destroy()
  })

  it('drops an option, stacks it on the anchor, advances, and wins after the last question', () => {
    const responder: SceneElement = {
      id: 'responder',
      type: 'text',
      name: 'Responder',
      x: 540,
      y: 300,
      anchor: 'center',
      zIndex: 9,
      mode: 'fit',
      text: { value: 'React', fontSizePx: 40, color: '#fff' },
      animations: {
        comboPick: { preset: 'pop', durationMs: 200, delayMs: 0, easing: 'ease-out' },
        comboDrop: { preset: 'shake', durationMs: 200, delayMs: 0, easing: 'ease-out' },
        comboNext: { preset: 'float', durationMs: 200, delayMs: 0, easing: 'ease-out' },
      },
      sfx: [
        { event: 'comboPick', assetId: 'pickSfx' },
        { event: 'comboDrop', assetId: 'dropSfx' },
        { event: 'comboNext', assetId: 'nextSfx' },
      ],
    } as SceneElement

    const stage = build([GAME, ANCHOR, responder, title('t1', 1), title('t2', 2), option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB'), option('b1', 2, 1, 'layerA')])
    const heard: string[] = []
    off = on('sfx-asset', (id: unknown) => heard.push(String(id)))
    let won = false
    // 'game-win' is intercepted stage-locally by revealOnWin and never reaches the
    // emitter; 'game-complete' is what that reveal pass broadcasts when it finishes.
    const offWin = on('game-complete', () => {
      won = true
    })

    stage.layoutAll()
    stage.startGames(true)

    const anim = stage.root.querySelector<HTMLElement>('[data-id="responder"] .pa-el-anim')!
    const opt = stage.root.querySelector<HTMLElement>('[data-id="a1"]')!
    const loser = stage.root.querySelector<HTMLElement>('[data-id="a2"]')!
    const target = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
    // Put the option and the drop area on top of each other so the release lands inside.
    stubRect(target, 100, 100, 400, 400)
    stubRect(opt, 200, 200, 100, 100)
    stubRect(stage.root.querySelector<HTMLElement>('[data-id="anchor"]')!, 0, 0, 600, 600)

    opt.dispatchEvent(pointer('pointerdown', 250, 250))
    expect(heard).toContain('pickSfx')
    expect(anim.style.animation).toContain('pa-pop')
    expect(opt.style.scale).toBe('1.25')

    opt.dispatchEvent(pointer('pointerup', 250, 250))
    expect(heard).toContain('dropSfx')
    expect(anim.style.animation).toContain('pa-shake')

    // The unpicked sibling leaves, the picked one flies in and lands as a layer.
    vi.advanceTimersByTime(150)
    expect(loser.classList.contains('pa-combo-off')).toBe(true)
    const layer = stage.root.querySelector<HTMLImageElement>('[data-id="anchor"] .pa-combo-layer')!
    expect(layer.getAttribute('src')).toBe('a.png')
    expect(opt.classList.contains('pa-combo-off')).toBe(true)

    // ...then question 2 comes up.
    vi.advanceTimersByTime(250)
    expect(heard).toContain('nextSfx')
    expect(anim.style.animation).toContain('pa-float')
    expect(stage.root.querySelector<HTMLElement>('[data-id="t2"]')!.classList.contains('pa-combo-off')).toBe(false)
    expect(stage.root.querySelector<HTMLElement>('[data-id="t1"]')!.classList.contains('pa-combo-off')).toBe(true)
    expect(won).toBe(false)

    // Answering the last question wins.
    const last = stage.root.querySelector<HTMLElement>('[data-id="b1"]')!
    stubRect(last, 200, 200, 100, 100)
    last.dispatchEvent(pointer('pointerdown', 250, 250))
    last.dispatchEvent(pointer('pointerup', 250, 250))
    vi.advanceTimersByTime(400)
    expect(stage.root.querySelectorAll('[data-id="anchor"] .pa-combo-layer').length).toBe(2)
    expect(won).toBe(true)

    offWin()
    stage.destroy()
  })

  it('springs an option back home when it is released outside the drop area', () => {
    const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB')])
    stage.layoutAll()
    stage.startGames(true)

    const opt = stage.root.querySelector<HTMLElement>('[data-id="a1"]')!
    const target = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
    stubRect(target, 0, 0, 10, 10)
    stubRect(opt, 800, 800, 100, 100)

    opt.dispatchEvent(pointer('pointerdown', 850, 850))
    opt.dispatchEvent(pointer('pointerup', 850, 850))
    expect(opt.style.translate).toBe('0px 0px')
    expect(opt.style.scale).toBe('1')
    expect(opt.classList.contains('pa-combo-off')).toBe(false)
    expect(stage.root.querySelectorAll('.pa-combo-layer').length).toBe(0)
    stage.destroy()
  })

  it('skips a question with no options tagged rather than stranding the player', () => {
    // questions: 2, but only question 2 is wired up.
    const stage = build([GAME, ANCHOR, title('t2', 2), option('b1', 2, 1, 'optA')])
    let won = false
    off = on('game-complete', () => {
      won = true
    })
    stage.layoutAll()
    stage.startGames(true)

    // Play opens on question 2, not on the empty question 1.
    const live = stage.root.querySelector<HTMLElement>('[data-id="b1"]')!
    expect(live.classList.contains('pa-combo-off')).toBe(false)

    const target = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
    stubRect(target, 100, 100, 400, 400)
    stubRect(live, 200, 200, 100, 100)
    stubRect(stage.root.querySelector<HTMLElement>('[data-id="anchor"]')!, 0, 0, 600, 600)
    live.dispatchEvent(pointer('pointerdown', 250, 250))
    live.dispatchEvent(pointer('pointerup', 250, 250))
    vi.advanceTimersByTime(400)
    expect(won).toBe(true)
    stage.destroy()
  })

  it('restores every enlisted element on destroy', () => {
    const stage = build([GAME, ANCHOR, title('t1', 1), option('a1', 1, 1, 'optA'), option('b1', 2, 1, 'optB')])
    stage.layoutAll()
    stage.startGames(true)
    const hidden = stage.root.querySelector<HTMLElement>('[data-id="b1"]')!
    expect(hidden.classList.contains('pa-combo-off')).toBe(true)
    stage.destroy()
    expect(hidden.classList.contains('pa-combo-off')).toBe(false)
    expect(document.querySelectorAll('.pa-combo-stack').length).toBe(0)
  })
})
