import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

// jsdom gives every element a zero-size rect, which the row-spread tests need to be
// real: how far a neighbour is pushed is derived from the selected option's width.
function stubRect(el: HTMLElement, x: number, y: number, w: number, h: number): void {
  el.getBoundingClientRect = () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect
}

function pointer(type: string, x = 0, y = 0): PointerEvent {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as PointerEvent
}

const GAME_ID = 'config-game'

function game(params: Record<string, unknown>): SceneElement {
  return {
    id: GAME_ID,
    type: 'game-mount',
    name: 'Configurator',
    x: 540,
    y: 1500,
    w: 1000,
    h: 400,
    anchor: 'center',
    zIndex: 1,
    mode: 'fit',
    game: { templateId: 'configurator', hintEnabled: false, params },
  } as SceneElement
}

function option(id: string, group: number, choice: number, assetId: string): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId,
    x: 200 + choice * 200,
    y: 1200,
    w: 160,
    h: 160,
    anchor: 'center',
    zIndex: 5,
    mode: 'fit',
    configRole: { gameId: GAME_ID, role: 'option', group, choice },
  } as SceneElement
}

function display(id = 'product'): SceneElement {
  return {
    id,
    type: 'image',
    name: 'Product',
    assetId: 'placed',
    x: 540,
    y: 600,
    w: 800,
    h: 800,
    anchor: 'center',
    zIndex: 2,
    mode: 'fit',
    configRole: { gameId: GAME_ID, role: 'display' },
  } as SceneElement
}

function bound(id: string, role: 'active' | 'inactive' | 'follow', group: number, choice: number, showOnCanvas?: boolean): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'tick',
    x: 200 + choice * 200,
    y: 1320,
    w: 120,
    h: 40,
    anchor: 'center',
    zIndex: 6,
    mode: 'fit',
    configRole: { gameId: GAME_ID, role, group, choice, showOnCanvas },
  } as SceneElement
}

const ASSETS = {
  placed: { src: 'placed.png', w: 800, h: 800 },
  swatchA: { src: 'a.png', w: 160, h: 160 },
  swatchB: { src: 'b.png', w: 160, h: 160 },
  tick: { src: 'tick.png', w: 120, h: 40 },
  onA: { src: 'a-on.png', w: 200, h: 200 },
  p11: { src: 'p11.png', w: 800, h: 800 },
  p12: { src: 'p12.png', w: 800, h: 800 },
  p21: { src: 'p21.png', w: 800, h: 800 },
  p22: { src: 'p22.png', w: 800, h: 800 },
}

function build(elements: SceneElement[]): ReturnType<typeof buildScene> {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'config', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    kind: 'game',
    elements,
  }
  return buildScene(scene, ASSETS, { mount })
}

const byId = (stage: ReturnType<typeof buildScene>, id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
const imgOf = (el: HTMLElement): HTMLImageElement => el.querySelector<HTMLImageElement>('img.pa-img')!
const overlayOf = (el: HTMLElement): HTMLImageElement | null => el.querySelector<HTMLImageElement>('img.pa-config-active')
const ringOf = (el: HTMLElement): HTMLElement | null => el.querySelector<HTMLElement>('.pa-config-ring')
const animOf = (el: HTMLElement): HTMLElement => el.querySelector<HTMLElement>('.pa-el-anim')!

/** One group of two swatches, one product image, and a table with a picture per choice. */
const ONE_GROUP = [
  game({ groups: 1, swapMs: 0, activeFadeMs: 0, activeMs: 0, tapMs: 0, img_1: 'p11', img_2: 'p12' }),
  display(),
  option('a1', 1, 1, 'swatchA'),
  option('a2', 1, 2, 'swatchB'),
]

describe('configurator', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('tags roles onto scene elements and keeps options interactive', () => {
    const stage = build(ONE_GROUP)
    stage.layoutAll()
    stage.startGames(false)

    const opt = byId(stage, 'a1')
    expect(opt.dataset.configRole).toBe('option')
    expect(opt.dataset.configGameId).toBe(GAME_ID)
    expect(opt.dataset.configGroup).toBe('1')
    expect(opt.dataset.configChoice).toBe('1')
    // Options must receive pointer events; the generic non-interactive rule would
    // otherwise switch them off because an image is decorative by default.
    expect(opt.style.pointerEvents).not.toBe('none')
    stage.destroy()
  })

  it('opens on the first choice of every group and shows its picture', () => {
    const stage = build(ONE_GROUP)
    stage.layoutAll()
    stage.startGames(true)

    expect(byId(stage, 'a1').dataset.configSelected).toBe('1')
    expect(byId(stage, 'a2').dataset.configSelected).toBe('0')
    expect(imgOf(byId(stage, 'product')).getAttribute('src')).toBe('p11.png')
    stage.destroy()
  })

  it('swaps the product picture when another option is tapped', () => {
    const stage = build(ONE_GROUP)
    stage.layoutAll()
    stage.startGames(true)

    byId(stage, 'a2').dispatchEvent(pointer('pointerdown'))
    expect(byId(stage, 'a2').dataset.configSelected).toBe('1')
    expect(byId(stage, 'a1').dataset.configSelected).toBe('0')
    expect(imgOf(byId(stage, 'product')).getAttribute('src')).toBe('p12.png')
    stage.destroy()
  })

  it('leaves the placed art up for a combination the table has no picture for', () => {
    const stage = build([
      game({ groups: 1, swapMs: 0, img_1: 'p11' }), // nothing for choice 2
      display(),
      option('a1', 1, 1, 'swatchA'),
      option('a2', 1, 2, 'swatchB'),
    ])
    stage.layoutAll()
    stage.startGames(true)
    byId(stage, 'a2').dispatchEvent(pointer('pointerdown'))
    expect(imgOf(byId(stage, 'product')).getAttribute('src')).toBe('placed.png')
    stage.destroy()
  })

  it('looks the picture up by the WHOLE combination across groups', () => {
    const stage = build([
      game({ groups: 2, swapMs: 0, img_1_1: 'p11', img_1_2: 'p12', img_2_1: 'p21', img_2_2: 'p22' }),
      display(),
      option('a1', 1, 1, 'swatchA'),
      option('a2', 1, 2, 'swatchB'),
      option('b1', 2, 1, 'swatchA'),
      option('b2', 2, 2, 'swatchB'),
    ])
    stage.layoutAll()
    stage.startGames(true)
    expect(imgOf(byId(stage, 'product')).getAttribute('src')).toBe('p11.png')

    byId(stage, 'b2').dispatchEvent(pointer('pointerdown'))
    expect(imgOf(byId(stage, 'product')).getAttribute('src')).toBe('p12.png')

    byId(stage, 'a2').dispatchEvent(pointer('pointerdown'))
    expect(imgOf(byId(stage, 'product')).getAttribute('src')).toBe('p22.png')
    stage.destroy()
  })

  it('cross-fades the selected art over the option instead of swapping its source', () => {
    const stage = build([
      game({ groups: 1, swapMs: 0, activeFadeMs: 120, preselect: false, on_1_1: 'onA' }),
      display(),
      option('a1', 1, 1, 'swatchA'),
      option('a2', 1, 2, 'swatchB'),
    ])
    stage.layoutAll()
    stage.startGames(true)

    const opt = byId(stage, 'a1')
    const overlay = overlayOf(opt)!
    // The option's own picture is never touched — the active art rides on top of it.
    expect(overlay.getAttribute('src')).toBe('a-on.png')
    expect(imgOf(opt).getAttribute('src')).toBe('a.png')
    expect(overlay.style.opacity).toBe('0')

    opt.dispatchEvent(pointer('pointerdown'))
    expect(overlay.style.opacity).toBe('1')
    expect(overlay.style.transition).toBe('opacity 120ms ease')
    expect(imgOf(opt).getAttribute('src')).toBe('a.png')

    // Choosing the other swatch takes it back off — and the board keeps answering taps
    // after the win, which on a one-group board lands on the very first one.
    byId(stage, 'a2').dispatchEvent(pointer('pointerdown'))
    expect(overlay.style.opacity).toBe('0')
    stage.destroy()
  })

  it('draws a selection ring from the panel when there is no active image', () => {
    const stage = build([
      game({ groups: 1, swapMs: 0, activeFadeMs: 0, preselect: false, activeBorderColor: '#1b2a4a', activeBorderPx: 3, activeBorderRadiusPx: 12, activeBorderGapPx: 5 }),
      display(),
      option('a1', 1, 1, 'swatchA'),
      option('a2', 1, 2, 'swatchB'),
    ])
    stage.layoutAll()
    stage.startGames(true)

    const ring = ringOf(byId(stage, 'a1'))!
    expect(ring.style.opacity).toBe('0')
    // jsdom normalises the colour on the way in.
    expect(ring.style.borderColor).toBe('rgb(27, 42, 74)')
    // Design px, scaled to the stage — never raw physical px.
    expect(ring.style.borderWidth).not.toBe('')
    expect(ring.style.inset).not.toBe('0px')

    byId(stage, 'a1').dispatchEvent(pointer('pointerdown'))
    expect(ring.style.opacity).toBe('1')
    stage.destroy()
  })

  it('grows the selection and pushes its row aside by what the growth needs', () => {
    const stage = build([
      game({ groups: 1, swapMs: 0, activeMs: 0, tapMs: 0, preselect: false, activeScale: 1.5 }),
      display(),
      option('a1', 1, 1, 'swatchA'),
      option('a2', 1, 2, 'swatchB'),
    ])
    stage.layoutAll()
    // Two 100px-wide swatches side by side, so the push is a real number:
    // (1.5 - 1) * 100 / 2 = 25px each way.
    stubRect(byId(stage, 'a1'), 100, 1200, 100, 100)
    stubRect(byId(stage, 'a2'), 300, 1200, 100, 100)
    stage.startGames(true)

    byId(stage, 'a1').dispatchEvent(pointer('pointerdown'))
    expect(animOf(byId(stage, 'a1')).style.scale).toBe('1.5')
    // The chosen one holds its place; the one to its right moves right to make room.
    expect(byId(stage, 'a1').style.translate).toBe('0px 0px')
    expect(byId(stage, 'a2').style.translate).toBe('25px 0px')
    stage.destroy()
  })

  it('takes the art bound to an option along when its row makes room', () => {
    const stage = build([
      game({ groups: 1, swapMs: 0, activeMs: 0, tapMs: 0, preselect: false, activeScale: 1.5 }),
      display(),
      option('a1', 1, 1, 'swatchA'),
      option('a2', 1, 2, 'swatchB'),
      bound('label2', 'follow', 1, 2),
    ])
    stage.layoutAll()
    stubRect(byId(stage, 'a1'), 100, 1200, 100, 100)
    stubRect(byId(stage, 'a2'), 300, 1200, 100, 100)
    stage.startGames(true)

    byId(stage, 'a1').dispatchEvent(pointer('pointerdown'))
    // The name under the second swatch travels with the swatch it names.
    expect(byId(stage, 'label2').style.translate).toBe('25px 0px')
    stage.destroy()
  })

  it('nudges the chosen option without dragging its label along', () => {
    const stage = build([
      game({ groups: 1, swapMs: 0, activeMs: 0, tapMs: 0, preselect: false, activeOffsetY: -10 }),
      display(),
      option('a1', 1, 1, 'swatchA'),
      bound('label1', 'follow', 1, 1),
    ])
    stage.layoutAll()
    stage.startGames(true)

    byId(stage, 'a1').dispatchEvent(pointer('pointerdown'))
    expect(byId(stage, 'a1').style.translate).not.toBe('0px 0px')
    expect(byId(stage, 'label1').style.translate).toBe('0px 0px')
    stage.destroy()
  })

  it('shows an option’s active art and hides its inactive art, and back again', () => {
    const stage = build([
      game({ groups: 1, swapMs: 0, activeFadeMs: 0, activeMs: 0, tapMs: 0 }),
      display(),
      option('a1', 1, 1, 'swatchA'),
      option('a2', 1, 2, 'swatchB'),
      bound('bold1', 'active', 1, 1),
      bound('plain1', 'inactive', 1, 1),
    ])
    stage.layoutAll()
    stage.startGames(true)

    // Option 1 is the opening selection.
    expect(byId(stage, 'bold1').classList.contains('pa-combo-off')).toBe(false)
    expect(byId(stage, 'plain1').classList.contains('pa-combo-off')).toBe(true)

    byId(stage, 'a2').dispatchEvent(pointer('pointerdown'))
    expect(byId(stage, 'bold1').classList.contains('pa-combo-off')).toBe(true)
    expect(byId(stage, 'plain1').classList.contains('pa-combo-off')).toBe(false)
    stage.destroy()
  })

  it('keeps state art placeable on the editor canvas and restores it on destroy', () => {
    const els = [game({ groups: 1 }), display(), option('a1', 1, 1, 'swatchA'), bound('shown', 'active', 1, 1, true), bound('hidden', 'active', 1, 1)]

    // Editor canvas: the piece the author is positioning stays visible, the other one
    // stays out of the way. start() is never called here.
    const editor = build(els)
    editor.layoutAll()
    editor.startGames(false)
    expect(byId(editor, 'shown').classList.contains('pa-combo-off')).toBe(false)
    expect(byId(editor, 'hidden').classList.contains('pa-combo-off')).toBe(true)
    editor.destroy()

    document.body.innerHTML = ''
    const play = build(els)
    play.layoutAll()
    play.startGames(true)
    const shown = byId(play, 'shown')
    play.destroy()
    // The canvas is left exactly as it was found.
    expect(shown.classList.contains('pa-combo-off')).toBe(false)
  })

  it('hides a choice the table rules out, and moves off one that has been ruled out', () => {
    const stage = build([
      // Group 2's choice 2 exists only with group 1's choice 1.
      game({ groups: 2, swapMs: 0, unavailable: 'hide', img_1_1: 'p11', img_1_2: 'p12', img_2_1: 'p21' }),
      display(),
      option('a1', 1, 1, 'swatchA'),
      option('a2', 1, 2, 'swatchB'),
      option('b1', 2, 1, 'swatchA'),
      option('b2', 2, 2, 'swatchB'),
    ])
    stage.layoutAll()
    stage.startGames(true)
    expect(byId(stage, 'b2').classList.contains('pa-combo-off')).toBe(false)

    // Choosing the finish that doesn't come in that size takes the size away...
    byId(stage, 'b2').dispatchEvent(pointer('pointerdown'))
    byId(stage, 'a2').dispatchEvent(pointer('pointerdown'))
    expect(byId(stage, 'b2').classList.contains('pa-combo-off')).toBe(true)
    // ...and the board falls back to one that exists rather than showing nothing.
    expect(byId(stage, 'b1').dataset.configSelected).toBe('1')
    expect(imgOf(byId(stage, 'product')).getAttribute('src')).toBe('p21.png')
    stage.destroy()
  })

  it('wins once the player has chosen in every group', () => {
    let won = false
    // 'game-win' is intercepted stage-locally by revealOnWin and never reaches the
    // emitter; 'game-complete' is what that reveal pass broadcasts when it finishes.
    const offWin = on('game-complete', () => {
      won = true
    })
    const stage = build([
      game({ groups: 2, swapMs: 0, img_1_1: 'p11', img_1_2: 'p12', img_2_1: 'p21', img_2_2: 'p22' }),
      display(),
      option('a1', 1, 1, 'swatchA'),
      option('a2', 1, 2, 'swatchB'),
      option('b1', 2, 1, 'swatchA'),
      option('b2', 2, 2, 'swatchB'),
    ])
    stage.layoutAll()
    stage.startGames(true)

    // The opening selection is a starting state, not a move: nothing is won by it.
    expect(won).toBe(false)
    byId(stage, 'a2').dispatchEvent(pointer('pointerdown'))
    expect(won).toBe(false)
    byId(stage, 'b2').dispatchEvent(pointer('pointerdown'))
    vi.advanceTimersByTime(4000)
    expect(won).toBe(true)
    offWin()
    stage.destroy()
  })

  it('sizes and places the selected image without moving the option', () => {
    const stage = build([
      game({ groups: 1, swapMs: 0, activeFadeMs: 0, preselect: false, on_1_1: 'onA', activeArtScale: 1.4, activeArtX: 6, onScale_1_2: 2, on_1_2: 'onA' }),
      display(),
      option('a1', 1, 1, 'swatchA'),
      option('a2', 1, 2, 'swatchB'),
    ])
    stage.layoutAll()
    stage.startGames(true)

    // Board-wide size and nudge, applied to the art alone.
    const art1 = overlayOf(byId(stage, 'a1'))!
    expect(art1.style.scale).toBe('1.4')
    expect(art1.style.translate).not.toBe('')
    // The option's own box is untouched, so nothing else on the board moves.
    expect(byId(stage, 'a1').style.translate).toBe('0px 0px')

    // One option overrides the board-wide size for itself.
    expect(overlayOf(byId(stage, 'a2'))!.style.scale).toBe('2')
    stage.destroy()
  })

  it('draws one option’s selected look on the canvas, and never in play', () => {
    const els = [game({ groups: 1, swapMs: 0, preselect: false, on_1_1: 'onA', canvasPreview: '1_1' }), display(), option('a1', 1, 1, 'swatchA'), option('a2', 1, 2, 'swatchB')]

    // Editor canvas: the option being tuned shows its active art, at the size and
    // position it is being given, without start() ever running.
    const editor = build(els)
    editor.layoutAll()
    editor.startGames(false)
    expect(overlayOf(byId(editor, 'a1'))!.style.opacity).toBe('1')
    expect(overlayOf(byId(editor, 'a2'))).toBeNull()
    editor.destroy()

    // Real play: the same board opens on the live selection instead — here nothing is
    // pre-selected, so the authoring preview is gone rather than stuck on.
    document.body.innerHTML = ''
    const play = build(els)
    play.layoutAll()
    play.startGames(true)
    expect(play.root.querySelectorAll('img.pa-config-active').length).toBe(1)
    expect(overlayOf(byId(play, 'a1'))!.style.opacity).toBe('0')
    play.destroy()
  })

  it('publishes the option a hand should tap, and moves it on as groups are answered', () => {
    const stage = build([
      game({ groups: 2, swapMs: 0, img_1_1: 'p11', img_1_2: 'p12', img_2_1: 'p21', img_2_2: 'p22' }),
      display(),
      option('a1', 1, 1, 'swatchA'),
      option('a2', 1, 2, 'swatchB'),
      option('b1', 2, 1, 'swatchA'),
      option('b2', 2, 2, 'swatchB'),
    ])
    stage.layoutAll()
    stage.startGames(true)

    // The first group is unanswered, and the hand is pointed at a choice that would
    // actually change something — never at the one already showing.
    expect(byId(stage, 'a2').dataset.configHint).toBe('1')
    expect(byId(stage, 'a1').dataset.configHint).toBeUndefined()

    byId(stage, 'a2').dispatchEvent(pointer('pointerdown'))
    expect(byId(stage, 'b2').dataset.configHint).toBe('1')
    expect(byId(stage, 'a2').dataset.configHint).toBeUndefined()

    // Nothing left to ask for: the hand has nothing to point at and goes quiet.
    byId(stage, 'b2').dispatchEvent(pointer('pointerdown'))
    expect(stage.root.querySelectorAll('[data-config-hint]').length).toBe(0)
    stage.destroy()
  })

  it('cross-fades the product over swapMs and lands on the new picture', () => {
    const stage = build([game({ groups: 1, swapMs: 200, img_1: 'p11', img_2: 'p12' }), display(), option('a1', 1, 1, 'swatchA'), option('a2', 1, 2, 'swatchB')])
    stage.layoutAll()
    stage.startGames(true)

    byId(stage, 'a2').dispatchEvent(pointer('pointerdown'))
    const node = animOf(byId(stage, 'product'))
    // Half way out first, still on the old picture.
    expect(node.style.opacity).toBe('0')
    expect(imgOf(byId(stage, 'product')).getAttribute('src')).toBe('p11.png')

    vi.advanceTimersByTime(100)
    expect(imgOf(byId(stage, 'product')).getAttribute('src')).toBe('p12.png')
    expect(node.style.opacity).toBe('1')

    vi.advanceTimersByTime(100)
    // The inline opacity is handed back: layoutRec owns that property.
    expect(node.style.opacity).toBe('')
    stage.destroy()
  })

  it('puts every option back the way it found it on destroy', () => {
    const stage = build([game({ groups: 1, swapMs: 0, activeScale: 1.4, on_1_1: 'onA', activeBorderColor: '#fff', activeBorderPx: 2 }), display(), option('a1', 1, 1, 'swatchA')])
    stage.layoutAll()
    stage.startGames(true)
    const opt = byId(stage, 'a1')
    const product = byId(stage, 'product')
    stage.destroy()

    expect(overlayOf(opt)).toBeNull()
    expect(ringOf(opt)).toBeNull()
    expect(imgOf(opt).getAttribute('src')).toBe('a.png')
    expect(imgOf(product).getAttribute('src')).toBe('placed.png')
    expect(animOf(opt).style.scale).toBe('')
    expect(opt.style.translate).toBe('')
    expect(opt.dataset.configSelected).toBeUndefined()
  })
})
