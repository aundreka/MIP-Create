import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

// jsdom gives every element a zero-size rect, which the drop test needs to be real.
function stubRect(el: HTMLElement, x: number, y: number, w: number, h: number): void {
  el.getBoundingClientRect = () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect
}

/** The scale lives on the inner .pa-el-anim, which carries no positional transform —
 * scaling the outer .pa-el would slide the element by (1-s)·W/2. */
function scaleOf(el: HTMLElement): string {
  return (el.querySelector<HTMLElement>('.pa-el-anim') ?? el).style.scale
}

function transitionOf(el: HTMLElement): string {
  return (el.querySelector<HTMLElement>('.pa-el-anim') ?? el).style.transition
}

function pointer(type: string, x: number, y: number, init: { pointerId?: number; pointerType?: string } = {}): PointerEvent {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as PointerEvent
  // jsdom's MouseEvent ignores unknown init keys, so pin them on afterwards.
  for (const [key, value] of Object.entries(init)) Object.defineProperty(ev, key, { value, configurable: true })
  return ev
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

function option(id: string, question: number, choice: number, assetId: string): SceneElement {
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
    comboRole: { gameId: 'combo-game', role: 'option', question, choice },
  } as SceneElement
}

/** Optional per-option drag proxy: what that option looks like while carried. */
function dragArt(id: string, question: number, choice: number, showOnCanvas?: boolean): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'layerA',
    x: 540,
    y: 1600,
    w: 400,
    h: 120,
    anchor: 'center',
    zIndex: 8,
    mode: 'fit',
    comboRole: { gameId: 'combo-game', role: 'dragArt', question, choice, showOnCanvas },
  } as SceneElement
}

/** Optional per-option name plate: shown where it sits while that option is held. */
/** A name plate that belongs to no option: up while ANY of them is held. */
function sharedCaption(id: string): SceneElement {
  return { ...caption(id, 1, 1), comboRole: { gameId: 'combo-game', role: 'caption', shared: true } } as SceneElement
}

function caption(id: string, question: number, choice: number, showOnCanvas?: boolean): SceneElement {
  return {
    id,
    type: 'text',
    name: id,
    x: 540,
    y: 1000,
    anchor: 'center',
    zIndex: 7,
    mode: 'fit',
    text: { value: `Item ${choice}`, fontSizePx: 40, color: '#fff' },
    comboRole: { gameId: 'combo-game', role: 'caption', question, choice, showOnCanvas },
  } as SceneElement
}

/** A placeholder standing where the pick will land, until it does. */
function outline(id: string, question: number, choice: number): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId: 'layerA',
    x: 540,
    y: 500,
    w: 300,
    h: 300,
    anchor: 'center',
    zIndex: 4,
    mode: 'fit',
    comboRole: { gameId: 'combo-game', role: 'outline', question, choice },
  } as SceneElement
}

/** A layer is a normal element the author placed where the pick should land. */
function layer(id: string, question: number, choice: number, assetId: string, showOnCanvas?: boolean): SceneElement {
  return {
    id,
    type: 'image',
    name: id,
    assetId,
    x: 540,
    y: 500,
    w: 300,
    h: 300,
    anchor: 'center',
    zIndex: 6,
    mode: 'fit',
    comboRole: { gameId: 'combo-game', role: 'layer', question, choice, showOnCanvas },
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
    // Options must receive pointer events; the generic non-interactive rule would
    // otherwise switch them off because an image is decorative by default.
    expect(opt.style.pointerEvents).not.toBe('none')
    stage.destroy()
  })

  it('starts a layer hidden, and honours showOnCanvas only while editing', () => {
    const els = [GAME, ANCHOR, option('a1', 1, 1, 'optA'), layer('l1', 1, 1, 'layerA', true), layer('l2', 1, 2, 'layerA')]

    // Editor canvas: the layer the author is positioning stays visible, the other
    // one stays out of the way. start() is never called here.
    const editor = build(els)
    editor.layoutAll()
    editor.startGames(false)
    expect(editor.root.querySelector<HTMLElement>('[data-id="l1"]')!.classList.contains('pa-combo-off')).toBe(false)
    expect(editor.root.querySelector<HTMLElement>('[data-id="l2"]')!.classList.contains('pa-combo-off')).toBe(true)
    editor.destroy()

    // Real play: every layer starts hidden regardless, so an authoring convenience
    // can never leak into the playable.
    document.body.innerHTML = ''
    const play = build(els)
    play.layoutAll()
    play.startGames(true)
    expect(play.root.querySelector<HTMLElement>('[data-id="l1"]')!.classList.contains('pa-combo-off')).toBe(true)
    expect(play.root.querySelector<HTMLElement>('[data-id="l2"]')!.classList.contains('pa-combo-off')).toBe(true)
    play.destroy()
  })

  it('restores each layer’s canvas visibility on destroy', () => {
    const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA'), layer('l1', 1, 1, 'layerA', true), layer('l2', 1, 2, 'layerA')])
    stage.layoutAll()
    stage.startGames(true)
    const shown = stage.root.querySelector<HTMLElement>('[data-id="l1"]')!
    const stayHidden = stage.root.querySelector<HTMLElement>('[data-id="l2"]')!
    expect(shown.classList.contains('pa-combo-off')).toBe(true) // play hid it
    stage.destroy()
    // The shown one comes back, the hidden one stays hidden — the canvas is left
    // exactly as it was found.
    expect(shown.classList.contains('pa-combo-off')).toBe(false)
    expect(stayHidden.classList.contains('pa-combo-off')).toBe(true)
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

  it('drops an option, reveals its layer element, advances, and wins after the last question', () => {
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

    const stage = build([
      GAME,
      ANCHOR,
      responder,
      title('t1', 1),
      title('t2', 2),
      option('a1', 1, 1, 'optA'),
      option('a2', 1, 2, 'optB'),
      layer('l-a1', 1, 1, 'layerA'),
      layer('l-a2', 1, 2, 'optB'),
      option('b1', 2, 1, 'optA'),
      layer('l-b1', 2, 1, 'layerA'),
    ])
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
    expect(scaleOf(opt)).toBe('1.25')

    opt.dispatchEvent(pointer('pointerup', 250, 250))
    expect(heard).toContain('dropSfx')
    expect(anim.style.animation).toContain('pa-shake')

    // The unpicked sibling leaves, the picked one flies in and hands over to ITS
    // layer element — and only that one; the loser's layer stays hidden.
    vi.advanceTimersByTime(150)
    expect(loser.classList.contains('pa-combo-off')).toBe(true)
    expect(stage.root.querySelector<HTMLElement>('[data-id="l-a1"]')!.classList.contains('pa-combo-off')).toBe(false)
    expect(stage.root.querySelector<HTMLElement>('[data-id="l-a2"]')!.classList.contains('pa-combo-off')).toBe(true)
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
    // Both picked layers are now showing; the unpicked one never appears.
    const revealed = ['l-a1', 'l-b1'].map((id) => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!)
    expect(revealed.every((n) => !n.classList.contains('pa-combo-off'))).toBe(true)
    expect(stage.root.querySelector<HTMLElement>('[data-id="l-a2"]')!.classList.contains('pa-combo-off')).toBe(true)
    expect(won).toBe(true)

    offWin()
    stage.destroy()
  })

  describe('hand-off to the placed layer', () => {
    /** Drop option `a1` with the given geometry and return the live nodes. */
    function dropOnto(
      params: Record<string, unknown>,
      optRect: [number, number, number, number],
      layerRect: [number, number, number, number],
      layerEl = layer('l-a1', 1, 1, 'layerA'),
    ): { opt: HTMLElement; lay: HTMLElement; loser: HTMLElement; stage: ReturnType<typeof buildScene> } {
      const game = { ...GAME, game: { ...GAME.game!, params: { ...(GAME.game!.params as object), ...params } } } as SceneElement
      const stage = build([game, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB'), layerEl])
      stage.layoutAll()
      stage.startGames(true)
      const opt = stage.root.querySelector<HTMLElement>('[data-id="a1"]')!
      const loser = stage.root.querySelector<HTMLElement>('[data-id="a2"]')!
      const lay = stage.root.querySelector<HTMLElement>('[data-id="l-a1"]')!
      const target = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
      stubRect(target, 0, 0, 1000, 1000)
      stubRect(opt, ...optRect)
      stubRect(lay, ...layerRect)
      opt.dispatchEvent(pointer('pointerdown', optRect[0] + 5, optRect[1] + 5))
      opt.dispatchEvent(pointer('pointerup', optRect[0] + 5, optRect[1] + 5))
      return { opt, lay, loser, stage }
    }

    it('flies the option to the centre of the placed layer', () => {
      // Option centred at (250,250); layer centred at (700,400). The option must
      // travel exactly the difference so the two centres coincide.
      const { opt, stage } = dropOnto({ flyMs: 400, crossFadeMs: 200 }, [200, 200, 100, 100], [600, 300, 200, 200])
      expect(opt.style.translate).toBe('450px 150px')
      stage.destroy()
    })

    it('matches the layer’s size contain-style so it never spills past it', () => {
      // 100x100 option into a 400x200 layer: width ratio 4, height ratio 2. Taking the
      // width ratio would make it 400x400 — 100px of overhang top and bottom right as
      // the two are supposed to be indistinguishable.
      const { opt, stage } = dropOnto({ flyMs: 400, crossFadeMs: 200, landScale: 1 }, [0, 0, 100, 100], [0, 0, 400, 200])
      expect(scaleOf(opt)).toBe('2')
      stage.destroy()
    })

    it('shrinks under the placed art by the land scale', () => {
      // 100x100 option into a 200x200 layer is a 2x fit; landScale 0.9 settles it a
      // touch smaller so the pick reads as being absorbed into the placed art.
      const { opt, stage } = dropOnto({ flyMs: 400, crossFadeMs: 200, landScale: 0.9 }, [0, 0, 100, 100], [0, 0, 200, 200])
      expect(Number(scaleOf(opt))).toBeCloseTo(1.8, 5)
      stage.destroy()
    })

    it('measures the flight against natural boxes, not the picked-up size', () => {
      // The option is held at 1.25x when it is dropped. Because the drag scale lives
      // on the inner node, the outer box stays natural — so a 100x100 option landing
      // on a 100x100 layer is a 1.0 fit, not 1/1.25.
      const { opt, stage } = dropOnto({ flyMs: 400, crossFadeMs: 200, landScale: 1 }, [0, 0, 100, 100], [0, 0, 100, 100])
      expect(Number(scaleOf(opt))).toBeCloseTo(1, 5)
      stage.destroy()
    })

    it('fades the option out over the tail of the flight, while it is still moving', () => {
      const { opt, stage } = dropOnto({ flyMs: 500, crossFadeMs: 200 }, [200, 200, 100, 100], [600, 300, 100, 100])
      expect(opt.style.opacity).toBe('0')
      // 200ms fade starting 300ms in: it dissolves during the last 40% of the travel
      // rather than landing and then blinking out.
      expect(opt.style.transition).toContain('opacity 200ms linear 300ms')
      expect(opt.style.transition).toContain('translate 500ms')
      stage.destroy()
    })

    it('brings the layer up from transparent at the same moment', () => {
      const { lay, stage } = dropOnto({ flyMs: 500, crossFadeMs: 200 }, [200, 200, 100, 100], [600, 300, 100, 100])
      // Still hidden through the opaque part of the flight.
      vi.advanceTimersByTime(290)
      expect(lay.classList.contains('pa-combo-off')).toBe(true)

      // Fade window opens: visible, transitioning, and driven to full.
      vi.advanceTimersByTime(20)
      expect(lay.classList.contains('pa-combo-off')).toBe(false)
      expect(lay.style.transition).toContain('opacity 200ms linear')
      expect(lay.style.opacity).toBe('1')
      stage.destroy()
    })

    it('restores the layer’s authored opacity instead of promoting it to solid', () => {
      // layoutRec writes the authored opacity inline on every layout pass, so the
      // fade has to hand that exact value back rather than clearing the property.
      const translucent = { ...layer('l-a1', 1, 1, 'layerA'), opacity: 0.4 } as SceneElement
      const { lay, stage } = dropOnto({ flyMs: 200, crossFadeMs: 100 }, [0, 0, 100, 100], [0, 0, 100, 100], translucent)
      vi.advanceTimersByTime(150)
      expect(lay.style.opacity).toBe('1')
      vi.advanceTimersByTime(100)
      expect(lay.style.opacity).toBe('0.4')
      stage.destroy()
    })

    it('clamps the cross-fade to the flight so it can never outlast it', () => {
      const { opt, lay, stage } = dropOnto({ flyMs: 120, crossFadeMs: 900 }, [0, 0, 100, 100], [0, 0, 100, 100])
      // Whole flight becomes the fade, with no negative delay — so the layer's
      // fade-in is queued at 0ms and opens on the very next tick.
      expect(opt.style.transition).toContain('opacity 120ms linear 0ms')
      vi.advanceTimersByTime(1)
      expect(lay.classList.contains('pa-combo-off')).toBe(false)
      stage.destroy()
    })

    it('swaps instantly when there is no flight to fade across', () => {
      const { opt, lay, stage } = dropOnto({ flyMs: 0, crossFadeMs: 300 }, [0, 0, 100, 100], [0, 0, 100, 100])
      expect(opt.style.opacity).toBe('')
      vi.advanceTimersByTime(10)
      expect(lay.classList.contains('pa-combo-off')).toBe(false)
      expect(lay.style.opacity).toBe('')
      stage.destroy()
    })

    it('fades the unpicked option out rather than only shrinking it', () => {
      const { loser, stage } = dropOnto({ flyMs: 400, crossFadeMs: 200, dismissMs: 150 }, [0, 0, 100, 100], [0, 0, 100, 100])
      expect(loser.style.opacity).toBe('0')
      expect(scaleOf(loser)).toBe('0.7')
      expect(loser.style.transition).toContain('opacity 150ms')
      expect(transitionOf(loser)).toContain('scale 150ms')
      stage.destroy()
    })
  })

  it('publishes the live option as data-combo-hint and moves it on each pick', () => {
    const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB'), layer('l-a1', 1, 1, 'layerA'), option('b1', 2, 1, 'optA')])
    stage.layoutAll()
    stage.startGames(true)

    const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
    // A placed handguide in 'combo' mode follows this marker, so exactly one option
    // carries it and it always belongs to the live question.
    expect(q('a1').dataset.comboHint).toBe('1')
    expect(q('a2').dataset.comboHint).toBeUndefined()
    expect(q('b1').dataset.comboHint).toBeUndefined()

    const target = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
    stubRect(target, 100, 100, 400, 400)
    stubRect(q('a1'), 200, 200, 100, 100)
    stubRect(q('l-a1'), 0, 0, 100, 100)
    q('a1').dispatchEvent(pointer('pointerdown', 250, 250))
    q('a1').dispatchEvent(pointer('pointerup', 250, 250))

    // Mid-pick there is nothing to point at, so the hand hides rather than lingering
    // over an option that is already flying away.
    expect(q('a1').dataset.comboHint).toBeUndefined()

    vi.advanceTimersByTime(400)
    expect(q('b1').dataset.comboHint).toBe('1')

    // Won: no marker at all.
    stubRect(q('b1'), 200, 200, 100, 100)
    q('b1').dispatchEvent(pointer('pointerdown', 250, 250))
    q('b1').dispatchEvent(pointer('pointerup', 250, 250))
    vi.advanceTimersByTime(400)
    expect(stage.root.querySelectorAll('[data-combo-hint]').length).toBe(0)
    stage.destroy()
  })

  it('scales about the visible centre, so a pick-up swells in place', () => {
    // The outer .pa-el is positioned with transform: translate(tx%,ty%), and the CSS
    // `scale` property composes after it about the UNTRANSFORMED box centre — so
    // scaling the outer slides the element by (1-s)·W/2 (a 200px option at 1.25x
    // jumps 25px up-left). The scale must therefore sit on the inner node.
    const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA')])
    stage.layoutAll()
    stage.startGames(true)
    const opt = stage.root.querySelector<HTMLElement>('[data-id="a1"]')!
    const target = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
    stubRect(target, 0, 0, 10, 10)
    stubRect(opt, 400, 400, 200, 200)
    opt.dispatchEvent(pointer('pointerdown', 500, 500))

    expect(scaleOf(opt)).toBe('1.25')
    // Nothing on the OUTER may carry a scale, or the drift comes back.
    expect(opt.style.scale).toBe('')
    stage.destroy()
  })

  describe('name plate', () => {
    function board(...extra: SceneElement[]): { q: (id: string) => HTMLElement; stage: ReturnType<typeof buildScene> } {
      const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB'), ...extra])
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 10, 10)
      stubRect(q('a1'), 400, 400, 100, 100)
      stubRect(q('a2'), 700, 400, 100, 100)
      return { q, stage }
    }

    it('appears the moment its own option is held, and only its own', () => {
      const { q, stage } = board(caption('name1', 1, 1), caption('name2', 1, 2), caption('name-q2', 2, 1))
      expect(q('name1').classList.contains('pa-combo-off')).toBe(true)

      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      expect(q('name1').classList.contains('pa-combo-off')).toBe(false)
      expect(q('name1').style.opacity).toBe('1')
      expect(q('name2').classList.contains('pa-combo-off')).toBe(true)
      expect(q('name-q2').classList.contains('pa-combo-off')).toBe(true)
      // It stays where the author put it — the drag proxy is what rides the finger.
      expect(q('name1').style.translate).toBe('')
      stage.destroy()
    })

    it('brings up every plate on the held option, not just the first', () => {
      const { q, stage } = board(caption('name', 1, 1), caption('price', 1, 1), caption('blurb', 1, 1), caption('other', 1, 2))
      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      for (const id of ['name', 'price', 'blurb']) expect(q(id).classList.contains('pa-combo-off')).toBe(false)
      expect(q('other').classList.contains('pa-combo-off')).toBe(true)

      // ...and they all leave together.
      q('a1').dispatchEvent(pointer('pointerup', 450, 450))
      vi.advanceTimersByTime(200)
      for (const id of ['name', 'price', 'blurb']) expect(q(id).classList.contains('pa-combo-off')).toBe(true)
      stage.destroy()
    })

    it('brings up a shared plate for whichever option is held', () => {
      const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB'), option('b1', 2, 1, 'optA'), sharedCaption('any')])
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 10, 10)
      stubRect(q('a1'), 400, 400, 100, 100)
      stubRect(q('a2'), 700, 400, 100, 100)
      expect(q('any').classList.contains('pa-combo-off')).toBe(true)

      // Question 1, first option...
      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      expect(q('any').classList.contains('pa-combo-off')).toBe(false)
      q('a1').dispatchEvent(pointer('pointerup', 450, 450))
      vi.advanceTimersByTime(200)
      expect(q('any').classList.contains('pa-combo-off')).toBe(true)

      // ...and the sibling brings up the very same element.
      q('a2').dispatchEvent(pointer('pointerdown', 750, 450))
      expect(q('any').classList.contains('pa-combo-off')).toBe(false)
      stage.destroy()
    })

    it('leaves again when the option is dropped short, and gives its opacity back', () => {
      const { q, stage } = board(caption('name1', 1, 1))
      const plate = q('name1')
      plate.style.opacity = '0.8' // as layoutRec would write an authored opacity

      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      q('a1').dispatchEvent(pointer('pointerup', 450, 450))
      expect(plate.style.opacity).toBe('0')
      vi.advanceTimersByTime(200)
      expect(plate.classList.contains('pa-combo-off')).toBe(true)
      expect(plate.style.opacity).toBe('0.8')
      stage.destroy()
    })

    it('leaves with the options when a pick lands', () => {
      const { q, stage } = board(caption('name1', 1, 1), layer('l-a1', 1, 1, 'layerA'))
      stubRect(q('l-a1'), 600, 600, 200, 60)

      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      q('a1').dispatchEvent(pointer('pointerup', 450, 450))
      // dismissMs is 50 in this scene: gone by the time the flight finishes.
      vi.advanceTimersByTime(400)
      expect(q('name1').classList.contains('pa-combo-off')).toBe(true)
      stage.destroy()
    })

    it('honours showOnCanvas while editing, never during play, and restores it', () => {
      const els = [GAME, ANCHOR, option('a1', 1, 1, 'optA'), caption('name1', 1, 1, true)]
      const editor = build(els)
      editor.layoutAll()
      editor.startGames(false)
      expect(editor.root.querySelector<HTMLElement>('[data-id="name1"]')!.classList.contains('pa-combo-off')).toBe(false)
      editor.destroy()

      document.body.innerHTML = ''
      const play = build(els)
      play.layoutAll()
      play.startGames(true)
      const plate = play.root.querySelector<HTMLElement>('[data-id="name1"]')!
      expect(plate.classList.contains('pa-combo-off')).toBe(true)
      play.destroy()
      expect(plate.classList.contains('pa-combo-off')).toBe(false)
    })
  })

  describe('hold effect', () => {
    const FX_GAME = {
      ...GAME,
      game: {
        ...GAME.game!,
        params: {
          ...GAME.game!.params,
          holdEffectIds: 'anchor, l-a1',
          holdBrightness: 0.6,
          holdSaturation: 0.2,
          holdOpacity: 0.5,
          holdEffectMs: 100,
        },
      },
    } as SceneElement

    function board(): { q: (id: string) => HTMLElement; stage: ReturnType<typeof buildScene> } {
      const stage = build([FX_GAME, ANCHOR, option('a1', 1, 1, 'optA'), layer('l-a1', 1, 1, 'layerA'), title('t1', 1)])
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 10, 10)
      stubRect(q('a1'), 400, 400, 100, 100)
      return { q, stage }
    }

    it('dims the named elements while an option is carried, and only those', () => {
      const { q, stage } = board()
      expect(q('anchor').style.filter).toBe('')

      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      // 1 is the identity, so contrast is left out of the chain entirely.
      expect(q('anchor').style.filter).toBe('brightness(0.6) saturate(0.2) opacity(0.5)')
      expect(q('anchor').style.transition).toBe('filter 100ms ease')
      // A target that is also a layer takes it too — the effect is a list of ids, not a role.
      expect(q('l-a1').style.filter).toBe('brightness(0.6) saturate(0.2) opacity(0.5)')
      // Anything not named is untouched.
      expect(q('t1').style.filter).toBe('')

      // Released short: the board comes straight back up.
      q('a1').dispatchEvent(pointer('pointerup', 450, 450))
      expect(q('anchor').style.filter).toBe('')
      stage.destroy()
    })

    it('lifts the effect when a pick lands, and clears it on destroy', () => {
      const { q, stage } = board()
      stubRect(q('l-a1'), 600, 600, 200, 60)
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 1000, 1000)

      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      expect(q('anchor').style.filter).not.toBe('')
      q('a1').dispatchEvent(pointer('pointerup', 450, 450))
      // The drop lifts it at once, with the name plates and the dismissed options.
      expect(q('anchor').style.filter).toBe('')
      vi.advanceTimersByTime(400)
      const anchorEl = q('anchor')
      stage.destroy()
      expect(anchorEl.style.filter).toBe('')
    })

    it('can start on instead, and lift for good at the first pick', () => {
      const els = [
        {
          ...FX_GAME,
          game: { ...FX_GAME.game!, params: { ...FX_GAME.game!.params, holdEffectWhen: 'untilPick' } },
        } as SceneElement,
        ANCHOR,
        option('a1', 1, 1, 'optA'),
        option('b1', 2, 1, 'optB'),
        layer('l-a1', 1, 1, 'layerA'),
      ]
      const stage = build(els)
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 1000, 1000)
      stubRect(q('a1'), 400, 400, 100, 100)
      stubRect(q('l-a1'), 600, 600, 200, 60)

      // On from the opening frame, and instantly rather than fading down in front of
      // the player.
      expect(q('anchor').style.filter).toBe('brightness(0.6) saturate(0.2) opacity(0.5)')
      expect(q('anchor').style.transition).toBe('')

      // A drag that comes to nothing leaves it exactly as it was: nothing was placed.
      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      q('a1').dispatchEvent(pointer('pointermove', 450, 450))
      expect(q('anchor').style.filter).not.toBe('')
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 1, 1)
      q('a1').dispatchEvent(pointer('pointerup', 450, 450))
      expect(q('anchor').style.filter).not.toBe('')

      // The first pick lifts it...
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 1000, 1000)
      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      q('a1').dispatchEvent(pointer('pointerup', 450, 450))
      expect(q('anchor').style.filter).toBe('')
      vi.advanceTimersByTime(400)

      // ...and the next question never brings it back.
      stubRect(q('b1'), 400, 400, 100, 100)
      q('b1').dispatchEvent(pointer('pointerdown', 450, 450))
      expect(q('anchor').style.filter).toBe('')
      stage.destroy()
    })

    it('can do both: open on, lift at the first pick, and return for every drag after', () => {
      const els = [
        { ...FX_GAME, game: { ...FX_GAME.game!, params: { ...FX_GAME.game!.params, holdEffectWhen: 'both' } } } as SceneElement,
        ANCHOR,
        option('a1', 1, 1, 'optA'),
        option('b1', 2, 1, 'optB'),
        layer('l-a1', 1, 1, 'layerA'),
      ]
      const stage = build(els)
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      const zone = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
      stubRect(zone, 0, 0, 1000, 1000)
      stubRect(q('a1'), 400, 400, 100, 100)
      stubRect(q('l-a1'), 600, 600, 200, 60)
      const muted = 'brightness(0.6) saturate(0.2) opacity(0.5)'

      // Open muted, and a drag that comes to nothing leaves it muted.
      expect(q('anchor').style.filter).toBe(muted)
      stubRect(zone, 0, 0, 1, 1)
      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      window.dispatchEvent(pointer('pointerup', 450, 450))
      expect(q('anchor').style.filter).toBe(muted)

      // The first pick lifts it.
      stubRect(zone, 0, 0, 1000, 1000)
      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      window.dispatchEvent(pointer('pointerup', 450, 450))
      expect(q('anchor').style.filter).toBe('')
      vi.advanceTimersByTime(400)

      // ...and from here it behaves like 'hold': on while carried, off on release.
      stubRect(q('b1'), 400, 400, 100, 100)
      q('b1').dispatchEvent(pointer('pointerdown', 450, 450))
      expect(q('anchor').style.filter).toBe(muted)
      stubRect(zone, 0, 0, 1, 1)
      window.dispatchEvent(pointer('pointerup', 450, 450))
      expect(q('anchor').style.filter).toBe('')
      stage.destroy()
    })

    it('does nothing at all when every knob is at rest', () => {
      const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA')]) // no hold params
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 10, 10)
      stubRect(q('a1'), 400, 400, 100, 100)
      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      expect(q('anchor').style.filter).toBe('')
      expect(q('anchor').style.transition).toBe('')
      stage.destroy()
    })
  })

  describe('drag art', () => {
    function held(art: SceneElement): { art: HTMLElement; opt: HTMLElement; stage: ReturnType<typeof buildScene> } {
      const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA'), art])
      stage.layoutAll()
      stage.startGames(true)
      const opt = stage.root.querySelector<HTMLElement>('[data-id="a1"]')!
      const node = stage.root.querySelector<HTMLElement>(`[data-id="${art.id}"]`)!
      const target = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
      stubRect(target, 0, 0, 10, 10)
      stubRect(opt, 400, 400, 100, 100)
      stubRect(node, 100, 900, 400, 120)
      return { art: node, opt, stage }
    }

    it('shows only the held option’s own proxy, not the sibling’s', () => {
      const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB'), dragArt('cue1', 1, 1), dragArt('cue2', 1, 2), dragArt('cue-q2', 2, 1)])
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      const target = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
      stubRect(target, 0, 0, 10, 10)
      stubRect(q('a1'), 400, 400, 100, 100)
      stubRect(q('a2'), 700, 400, 100, 100)

      q('a1').dispatchEvent(pointer('pointerdown', 450, 450))
      expect(q('cue1').classList.contains('pa-combo-off')).toBe(false)
      expect(q('cue2').classList.contains('pa-combo-off')).toBe(true)
      expect(q('cue-q2').classList.contains('pa-combo-off')).toBe(true)
      q('a1').dispatchEvent(pointer('pointerup', 450, 450))
      vi.advanceTimersByTime(200)

      // The other option brings up its own cue instead.
      q('a2').dispatchEvent(pointer('pointerdown', 750, 450))
      expect(q('cue2').classList.contains('pa-combo-off')).toBe(false)
      expect(q('cue1').classList.contains('pa-combo-off')).toBe(true)
      stage.destroy()
    })

    it('leaves an option with no proxy dragging its own picture', () => {
      const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB'), dragArt('cue1', 1, 1)])
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      const target = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
      stubRect(target, 0, 0, 10, 10)
      stubRect(q('a2'), 700, 400, 100, 100)

      q('a2').dispatchEvent(pointer('pointerdown', 750, 450))
      expect(q('cue1').classList.contains('pa-combo-off')).toBe(true)
      // No proxy for this one, so the option keeps its own art and gets the enlargement.
      expect(q('a2').querySelector<HTMLElement>('.pa-el-anim')!.style.opacity).not.toBe('0')
      expect(scaleOf(q('a2'))).toBe('1.25')
      stage.destroy()
    })

    it('replaces the option’s own picture while it is held, and gives it back on release', () => {
      const { art, opt, stage } = held(dragArt('cue', 1, 1))
      const optArt = opt.querySelector<HTMLElement>('.pa-el-anim')!
      expect(art.classList.contains('pa-combo-off')).toBe(true)

      opt.dispatchEvent(pointer('pointerdown', 450, 450))
      // The proxy is what the player now sees; the option's own art switches off but
      // the element stays interactive, because it is the thing holding the pointer.
      expect(art.classList.contains('pa-combo-off')).toBe(false)
      expect(optArt.style.opacity).toBe('0')
      expect(opt.style.pointerEvents).not.toBe('none')

      // Released outside the drop area: the proxy fades out, the option comes back.
      opt.dispatchEvent(pointer('pointerup', 450, 450))
      expect(optArt.style.opacity).toBe('1')
      vi.advanceTimersByTime(200)
      expect(art.classList.contains('pa-combo-off')).toBe(true)
      expect(art.style.translate).toBe('')
      stage.destroy()
    })

    it('enlarges the proxy rather than the option', () => {
      const { art, opt, stage } = held(dragArt('cue', 1, 1))
      opt.dispatchEvent(pointer('pointerdown', 450, 450))
      expect(scaleOf(art)).toBe('1.25')
      // The option must stay at natural size: it is only the invisible handle now.
      expect(scaleOf(opt)).toBe('')
      stage.destroy()
    })

    it('rides under the finger, wherever it was placed on the canvas', () => {
      const { art, opt, stage } = held(dragArt('cue', 1, 1))
      opt.dispatchEvent(pointer('pointerdown', 450, 450))
      // Resting centre (300,960) sampled at pick-up; option centre is (450,450).
      expect(art.style.translate).toBe('150px -510px')

      stubRect(opt, 600, 300, 100, 100)
      opt.dispatchEvent(pointer('pointermove', 650, 350))
      expect(art.style.translate).toBe('350px -610px')
      stage.destroy()
    })

    it('is the thing that flies onto the layer, not the option', () => {
      const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA'), dragArt('cue', 1, 1), layer('l-a1', 1, 1, 'layerA')])
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      const target = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
      stubRect(target, 0, 0, 1000, 1000)
      stubRect(q('a1'), 200, 200, 100, 100)
      stubRect(q('cue'), 100, 900, 400, 120)
      stubRect(q('l-a1'), 600, 600, 200, 60)

      q('a1').dispatchEvent(pointer('pointerdown', 250, 250))
      q('a1').dispatchEvent(pointer('pointerup', 250, 250))

      // The proxy travels from its own resting centre (300,960) to the layer's (700,630)...
      expect(q('cue').style.translate).toBe('400px -330px')
      // ...shrinking contain-style onto it (400x120 -> 200x60 is 0.5) x landScale.
      expect(Number(scaleOf(q('cue')))).toBeCloseTo(0.5 * 0.92, 5)
      // ...and the option, already invisible, leaves at once rather than trailing along:
      // it keeps the resting 0,0 offset relayout gave it and never takes the flight.
      expect(q('a1').classList.contains('pa-combo-off')).toBe(true)
      expect(q('a1').style.translate).toBe('0px 0px')
      expect(scaleOf(q('a1'))).toBe('')

      vi.advanceTimersByTime(600)
      expect(q('l-a1').classList.contains('pa-combo-off')).toBe(false)
      // The proxy is parked once the hand-off is done.
      expect(q('cue').classList.contains('pa-combo-off')).toBe(true)
      stage.destroy()
    })

    it('honours showOnCanvas while editing but never during play', () => {
      const els = [GAME, ANCHOR, option('a1', 1, 1, 'optA'), dragArt('cue', 1, 1, true)]
      const editor = build(els)
      editor.layoutAll()
      editor.startGames(false)
      expect(editor.root.querySelector<HTMLElement>('[data-id="cue"]')!.classList.contains('pa-combo-off')).toBe(false)
      editor.destroy()

      document.body.innerHTML = ''
      const play = build(els)
      play.layoutAll()
      play.startGames(true)
      expect(play.root.querySelector<HTMLElement>('[data-id="cue"]')!.classList.contains('pa-combo-off')).toBe(true)
      play.destroy()
    })
  })

  it('springs an option back home when it is released outside the drop area', () => {
    const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB'), layer('l-a1', 1, 1, 'layerA')])
    stage.layoutAll()
    stage.startGames(true)

    const opt = stage.root.querySelector<HTMLElement>('[data-id="a1"]')!
    const target = stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!
    stubRect(target, 0, 0, 10, 10)
    stubRect(opt, 800, 800, 100, 100)

    opt.dispatchEvent(pointer('pointerdown', 850, 850))
    opt.dispatchEvent(pointer('pointerup', 850, 850))
    expect(opt.style.translate).toBe('0px 0px')
    expect(scaleOf(opt)).toBe('1')
    expect(opt.classList.contains('pa-combo-off')).toBe(false)
    // Nothing was picked, so no layer was revealed.
    expect(stage.root.querySelector<HTMLElement>('[data-id="l-a1"]')!.classList.contains('pa-combo-off')).toBe(true)
    stage.destroy()
  })

  it('runs more than a handful of questions — the count is open-ended', () => {
    const els: SceneElement[] = [{ ...GAME, game: { ...GAME.game!, params: { ...GAME.game!.params, questions: 12 } } } as SceneElement, ANCHOR]
    for (let n = 1; n <= 12; n++) els.push(option(`q${n}`, n, 1, 'optA'))
    const stage = build(els)
    let won = false
    off = on('game-complete', () => {
      won = true
    })
    stage.layoutAll()
    stage.startGames(true)
    const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
    stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 1000, 1000)

    for (let n = 1; n <= 12; n++) {
      const opt = q(`q${n}`)
      expect(opt.classList.contains('pa-combo-off')).toBe(false)
      stubRect(opt, 200, 200, 100, 100)
      opt.dispatchEvent(pointer('pointerdown', 250, 250))
      opt.dispatchEvent(pointer('pointerup', 250, 250))
      vi.advanceTimersByTime(400)
    }
    expect(won).toBe(true)
    stage.destroy()
  })

  it('supports more than two options in one question', () => {
    const els = [GAME, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB'), option('a3', 1, 3, 'optA'), option('a4', 1, 4, 'optB')]
    const stage = build(els)
    stage.layoutAll()
    stage.startGames(true)
    const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
    stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 1000, 1000)
    for (const id of ['a1', 'a2', 'a3', 'a4']) expect(q(id).classList.contains('pa-combo-off')).toBe(false)

    // Picking the fourth dismisses the other three, whatever their number.
    stubRect(q('a4'), 200, 200, 100, 100)
    q('a4').dispatchEvent(pointer('pointerdown', 250, 250))
    q('a4').dispatchEvent(pointer('pointerup', 250, 250))
    vi.advanceTimersByTime(400)
    for (const id of ['a1', 'a2', 'a3', 'a4']) expect(q(id).classList.contains('pa-combo-off')).toBe(true)
    stage.destroy()
  })

  it('wins on the authored number of picks, leaving the questions behind it unplayed', () => {
    const els: SceneElement[] = [
      { ...GAME, game: { ...GAME.game!, params: { ...GAME.game!.params, questions: 4, winPicks: 2 } } } as SceneElement,
      ANCHOR,
      option('q1', 1, 1, 'optA'),
      option('q2', 2, 1, 'optA'),
      option('q3', 3, 1, 'optA'),
      option('q4', 4, 1, 'optA'),
    ]
    const stage = build(els)
    let won = 0
    off = on('game-complete', () => {
      won++
    })
    stage.layoutAll()
    stage.startGames(true)
    const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
    stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 1000, 1000)

    const place = (id: string): void => {
      stubRect(q(id), 200, 200, 100, 100)
      q(id).dispatchEvent(pointer('pointerdown', 250, 250))
      q(id).dispatchEvent(pointer('pointerup', 250, 250))
      vi.advanceTimersByTime(400)
    }
    place('q1')
    expect(won).toBe(0)
    place('q2')
    expect(won).toBe(1)
    // Question 3 was never brought up, and its option stays off the board.
    expect(q('q3').classList.contains('pa-combo-off')).toBe(true)
    expect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!.dataset.comboComplete).toBe('1')
    stage.destroy()
  })

  describe('jigsaw board', () => {
    /** Every option of the question must be placed, each onto its own placeholder. */
    const JIGSAW = {
      ...GAME,
      game: { ...GAME.game!, params: { ...GAME.game!.params, questions: 1, multiPick: true, dropTarget: 'slot', winPicks: 3 } },
    } as SceneElement

    function board(): { q: (id: string) => HTMLElement; stage: ReturnType<typeof buildScene>; drop: (id: string, x: number, y: number) => void } {
      const stage = build([
        JIGSAW,
        ANCHOR,
        option('p1', 1, 1, 'optA'),
        option('p2', 1, 2, 'optB'),
        option('p3', 1, 3, 'optA'),
        outline('o1', 1, 1),
        outline('o2', 1, 2),
        outline('o3', 1, 3),
      ])
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      // The shared zone sits far away from every placeholder, so a drop that lands is
      // one that landed on the piece's OWN area.
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 1, 1)
      stubRect(q('o1'), 100, 100, 60, 60)
      stubRect(q('o2'), 400, 100, 60, 60)
      stubRect(q('o3'), 700, 100, 60, 60)
      for (const id of ['p1', 'p2', 'p3']) stubRect(q(id), 100, 900, 50, 50)
      const drop = (id: string, x: number, y: number): void => {
        q(id).dispatchEvent(pointer('pointerdown', 120, 920))
        stubRect(q(id), x - 25, y - 25, 50, 50)
        window.dispatchEvent(pointer('pointermove', x, y))
        window.dispatchEvent(pointer('pointerup', x, y))
        vi.advanceTimersByTime(400)
      }
      return { q, stage, drop }
    }

    it('keeps the siblings on the board and stays on the question until all are placed', () => {
      const { q, stage, drop } = board()
      let won = 0
      off = on('game-complete', () => {
        won++
      })

      drop('p1', 130, 130)
      // The piece is gone, its placeholder with it — and the other two are untouched.
      expect(q('p1').classList.contains('pa-combo-off')).toBe(true)
      expect(q('o1').classList.contains('pa-combo-off')).toBe(true)
      expect(q('p2').classList.contains('pa-combo-off')).toBe(false)
      expect(q('p3').classList.contains('pa-combo-off')).toBe(false)
      expect(q('o2').classList.contains('pa-combo-off')).toBe(false)
      expect(won).toBe(0)

      drop('p2', 430, 130)
      expect(q('p2').classList.contains('pa-combo-off')).toBe(true)
      expect(won).toBe(0)

      drop('p3', 730, 130)
      expect(won).toBe(1)
      stage.destroy()
    })

    it('rejects a piece dropped on another piece’s area', () => {
      const { q, stage, drop } = board()
      drop('p1', 730, 130) // p3's placeholder, not p1's
      expect(q('p1').classList.contains('pa-combo-off')).toBe(false)
      expect(q('o1').classList.contains('pa-combo-off')).toBe(false)
      stage.destroy()
    })

    it('falls back to the shared area for a piece with no placeholder of its own', () => {
      const stage = build([JIGSAW, ANCHOR, option('p1', 1, 1, 'optA')]) // no outline, no layer
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 1000, 1000)
      stubRect(q('p1'), 400, 400, 100, 100)
      q('p1').dispatchEvent(pointer('pointerdown', 450, 450))
      window.dispatchEvent(pointer('pointerup', 450, 450))
      vi.advanceTimersByTime(400)
      // Placed rather than stranded: an unwired piece is still droppable.
      expect(q('p1').classList.contains('pa-combo-off')).toBe(true)
      stage.destroy()
    })

    it('points the hint hand at the live piece’s own placeholder', () => {
      const { q, stage } = board()
      expect(q('o1').dataset.comboDrop).toBe('1')
      expect(q('o2').dataset.comboDrop).toBeUndefined()
      stage.destroy()
    })
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

  describe('touch drags', () => {
    /** One option, one layer, and a 10x10 drop area at the origin. */
    function board(params: Record<string, unknown> = {}): { opt: HTMLElement; lay: HTMLElement; picked: () => boolean; stage: ReturnType<typeof buildScene> } {
      const game = { ...GAME, game: { ...GAME.game!, params: { ...(GAME.game!.params as object), ...params } } } as SceneElement
      const stage = build([game, ANCHOR, option('a1', 1, 1, 'optA'), layer('l-a1', 1, 1, 'layerA')])
      stage.layoutAll()
      stage.startGames(true)
      const opt = stage.root.querySelector<HTMLElement>('[data-id="a1"]')!
      const lay = stage.root.querySelector<HTMLElement>('[data-id="l-a1"]')!
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 10, 10)
      stubRect(lay, 0, 0, 100, 100)
      // The pick lands on its layer, so a revealed layer is the pick having counted.
      const picked = (): boolean => {
        vi.advanceTimersByTime(400)
        return !lay.classList.contains('pa-combo-off')
      }
      return { opt, lay, picked, stage }
    }

    it('keeps following the finger after it leaves the option’s box', () => {
      // The move listeners sit on window, not on the option: pointer capture is
      // best-effort inside an ad container, and without it every move past the
      // element's own bounds — which is the whole of a drag — would be lost.
      const { opt, stage } = board()
      stubRect(opt, 400, 400, 100, 100)
      opt.dispatchEvent(pointer('pointerdown', 450, 450))
      document.body.dispatchEvent(pointer('pointermove', 700, 620))
      expect(opt.style.translate).toBe('250px 170px')
      stage.destroy()
    })

    it('treats a pointercancel over the drop area as a pick, not a change of mind', () => {
      // iOS Safari raises pointercancel on its own — a second finger landing, a
      // system edge swipe, its own scroll heuristic firing late — with the option
      // sitting right where the player dragged it. Binning that is the most
      // infuriating way for a pick to fail.
      const { opt, picked, stage } = board()
      stubRect(opt, 0, 0, 10, 10)
      opt.dispatchEvent(pointer('pointerdown', 5, 5))
      opt.dispatchEvent(pointer('pointercancel', 5, 5))
      expect(picked()).toBe(true)
      stage.destroy()
    })

    it('still springs home when the cancel comes in short of the area', () => {
      const { opt, picked, stage } = board()
      stubRect(opt, 800, 800, 100, 100)
      opt.dispatchEvent(pointer('pointerdown', 850, 850))
      opt.dispatchEvent(pointer('pointermove', 860, 860))
      opt.dispatchEvent(pointer('pointercancel', 860, 860))
      expect(opt.style.translate).toBe('0px 0px')
      expect(picked()).toBe(false)
      stage.destroy()
    })

    it('gives a finger extra room at the edge that a mouse doesn’t get', () => {
      // snapBorderPct 0, so the only forgiveness is the fingertip floor. A release
      // 10px past a 10px-wide area is a miss with a cursor and a hit with a thumb.
      const mouse = board({ snapBorderPct: 0 })
      stubRect(mouse.opt, 500, 500, 100, 100)
      mouse.opt.dispatchEvent(pointer('pointerdown', 550, 550, { pointerType: 'mouse' }))
      mouse.opt.dispatchEvent(pointer('pointerup', 20, 5, { pointerType: 'mouse' }))
      expect(mouse.picked()).toBe(false)
      mouse.stage.destroy()

      document.body.innerHTML = ''
      const touch = board({ snapBorderPct: 0 })
      stubRect(touch.opt, 500, 500, 100, 100)
      touch.opt.dispatchEvent(pointer('pointerdown', 550, 550, { pointerType: 'touch' }))
      touch.opt.dispatchEvent(pointer('pointerup', 20, 5, { pointerType: 'touch' }))
      expect(touch.picked()).toBe(true)
      touch.stage.destroy()
    })

    it('accepts a drop the finger is over even when the option’s centre isn’t', () => {
      // What the player aims with is the fingertip; the option element can be an
      // invisible handle sitting well off to one side of the art being carried.
      const { opt, picked, stage } = board({ zoneW: 100, zoneH: 100 })
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 200, 200)
      stubRect(opt, 400, 400, 100, 100)
      opt.dispatchEvent(pointer('pointerdown', 450, 450))
      opt.dispatchEvent(pointer('pointerup', 100, 100))
      expect(picked()).toBe(true)
      stage.destroy()
    })

    it('ignores a second finger while one option is already being dragged', () => {
      // A hand steadying the phone, or a thumb brushing a sibling option, would
      // otherwise open a rival drag fighting the first one over the drop area.
      const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB')])
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 10, 10)
      stubRect(q('a1'), 400, 400, 100, 100)
      stubRect(q('a2'), 700, 400, 100, 100)

      q('a1').dispatchEvent(pointer('pointerdown', 450, 450, { pointerId: 1, pointerType: 'touch' }))
      q('a2').dispatchEvent(pointer('pointerdown', 750, 450, { pointerId: 2, pointerType: 'touch' }))
      expect(scaleOf(q('a2'))).toBe('') // never picked up

      // ...and that second finger's moves don't drive the option the first one holds.
      document.body.dispatchEvent(pointer('pointermove', 900, 900, { pointerId: 2, pointerType: 'touch' }))
      expect(q('a1').style.translate).toBe('0px 0px') // the resting offset relayout wrote
      document.body.dispatchEvent(pointer('pointermove', 500, 500, { pointerId: 1, pointerType: 'touch' }))
      expect(q('a1').style.translate).toBe('50px 50px')

      // The first finger lifting hands the board back: the sibling can be grabbed now.
      document.body.dispatchEvent(pointer('pointerup', 500, 500, { pointerId: 1, pointerType: 'touch' }))
      q('a2').dispatchEvent(pointer('pointerdown', 750, 450, { pointerId: 3, pointerType: 'touch' }))
      expect(scaleOf(q('a2'))).toBe('1.25')
      stage.destroy()
    })

    it('drops a drag that is still live when the board is torn down', () => {
      const { opt, stage } = board()
      stubRect(opt, 400, 400, 100, 100)
      opt.dispatchEvent(pointer('pointerdown', 450, 450))
      stage.destroy()
      // No listeners left on window, and nothing to receive them if there were.
      document.body.dispatchEvent(pointer('pointermove', 900, 900))
      expect(opt.style.translate).toBe('')
    })
  })

  describe('outline', () => {
    /** Board with a placeholder over the landing spot, ready for a drop on a1. */
    function board(...extra: SceneElement[]): { q: (id: string) => HTMLElement; drop: () => void; stage: ReturnType<typeof buildScene> } {
      const game = { ...GAME, game: { ...GAME.game!, params: { ...(GAME.game!.params as object), flyMs: 500, crossFadeMs: 200 } } } as SceneElement
      const stage = build([game, ANCHOR, option('a1', 1, 1, 'optA'), option('a2', 1, 2, 'optB'), layer('l-a1', 1, 1, 'layerA'), ...extra])
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 1000, 1000)
      stubRect(q('a1'), 200, 200, 100, 100)
      stubRect(q('l-a1'), 600, 600, 200, 200)
      const drop = (): void => {
        q('a1').dispatchEvent(pointer('pointerdown', 250, 250))
        q('a1').dispatchEvent(pointer('pointerup', 250, 250))
      }
      return { q, drop, stage }
    }

    it('stands over the landing spot while its question is unanswered', () => {
      const { q, stage } = board(outline('o1', 1, 1), outline('o2', 2, 1))
      expect(q('o1').classList.contains('pa-combo-off')).toBe(false)
      // A later question's placeholder waits its turn rather than piling up.
      expect(q('o2').classList.contains('pa-combo-off')).toBe(true)
      stage.destroy()
    })

    it('dissolves on exactly the curve the layer arrives on', () => {
      const { q, drop, stage } = board(outline('o1', 1, 1))
      drop()
      // Opaque through the travel: the placeholder is still marking the spot.
      vi.advanceTimersByTime(290)
      expect(q('o1').style.opacity).not.toBe('0')

      // Cross-fade window opens — the layer comes up as the outline goes down, both
      // linear so the combined opacity doesn't dip into a flicker.
      vi.advanceTimersByTime(20)
      expect(q('o1').style.transition).toContain('opacity 200ms linear')
      expect(q('o1').style.opacity).toBe('0')
      expect(q('l-a1').style.transition).toContain('opacity 200ms linear')
      expect(q('l-a1').style.opacity).toBe('1')

      vi.advanceTimersByTime(250)
      expect(q('o1').classList.contains('pa-combo-off')).toBe(true)
      stage.destroy()
    })

    it('gives its authored opacity back instead of being promoted to solid', () => {
      // layoutRec rewrites the authored opacity inline on every layout pass, so the
      // fade has to hand that exact value back rather than clearing the property.
      const ghost = { ...outline('o1', 1, 1), opacity: 0.35 } as SceneElement
      const { q, drop, stage } = board(ghost)
      drop()
      vi.advanceTimersByTime(600)
      expect(q('o1').style.opacity).toBe('0.35')
      stage.destroy()
    })

    it('takes the whole question’s placeholders down, not just the winner’s', () => {
      // Outlines are addressed per option so a board where each choice lands somewhere
      // different can mark both spots — but a pick answers the QUESTION, so every
      // placeholder it was holding a space for leaves with it. That is also what lets
      // a single outline stand in for a whole question.
      const { q, drop, stage } = board(outline('o1', 1, 1), outline('o2', 1, 2))
      expect(q('o2').classList.contains('pa-combo-off')).toBe(false)
      drop()
      vi.advanceTimersByTime(600)
      expect(q('o1').classList.contains('pa-combo-off')).toBe(true)
      expect(q('o2').classList.contains('pa-combo-off')).toBe(true)
      stage.destroy()
    })

    it('leaves with the option even when there is no layer to replace it', () => {
      const stage = build([GAME, ANCHOR, option('b1', 1, 1, 'optA'), outline('o1', 1, 1)])
      stage.layoutAll()
      stage.startGames(true)
      const q = (id: string): HTMLElement => stage.root.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      stubRect(stage.root.querySelector<HTMLElement>('[data-combo-target="1"]')!, 0, 0, 1000, 1000)
      stubRect(q('b1'), 200, 200, 100, 100)
      stubRect(q('anchor'), 0, 0, 600, 600)
      q('b1').dispatchEvent(pointer('pointerdown', 250, 250))
      q('b1').dispatchEvent(pointer('pointerup', 250, 250))
      vi.advanceTimersByTime(600)
      expect(q('o1').classList.contains('pa-combo-off')).toBe(true)
      stage.destroy()
    })

    it('comes back to the canvas on destroy, like an option or a title', () => {
      // An outline is part of the board being arranged, so unlike a layer it carries
      // no per-element canvas flag — it is simply visible while editing.
      const { q, drop, stage } = board(outline('o1', 1, 1))
      const node = q('o1')
      drop()
      vi.advanceTimersByTime(600)
      expect(node.classList.contains('pa-combo-off')).toBe(true)
      stage.destroy()
      expect(node.classList.contains('pa-combo-off')).toBe(false)
    })
  })

  it('takes the game mount out of hit-testing, so its box can’t eat an option', () => {
    // The mount is an invisible author-sized rectangle — routinely most of the
    // screen, and a combo tray is normally arranged around the drop area inside it.
    // Interactive by default, it swallows the touches over whatever part of an
    // option it happens to sit above in the layer order, and the art then looks
    // whole while only the part hanging outside it can be picked up. Nothing in
    // there is ever touched, so the whole subtree steps aside.
    const stage = build([GAME, ANCHOR, option('a1', 1, 1, 'optA')])
    stage.layoutAll()
    stage.startGames(true)
    const mount = stage.root.querySelector<HTMLElement>('[data-id="combo-game"]')!
    const slot = mount.querySelector<HTMLElement>('.pa-game')!
    expect(mount.style.pointerEvents).toBe('none')
    expect(slot.style.pointerEvents).toBe('none')
    // The option itself must stay interactive — it is the one thing that is touched.
    expect(stage.root.querySelector<HTMLElement>('[data-id="a1"]')!.style.pointerEvents).toBe('auto')

    stage.destroy()
    // Handed back as found, so a re-mount doesn't inherit a stale override.
    expect(mount.style.pointerEvents).toBe('')
    expect(slot.style.pointerEvents).toBe('')
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
