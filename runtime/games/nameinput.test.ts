// Behaviour tests for the two name mechanics: what is typed is drawn immediately
// with a caret at the insertion point, it reaches every result box on the same
// channel — including one mounted on a LATER scene, after the box is gone — and the
// built-in keyboard takes over (writing into the same value) when the device one
// never comes up.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNameInput, NAMEINPUT_TEMPLATE, resetKeyboardProbe } from './nameinput'
import { createNameResult, NAMERESULT_TEMPLATE } from './nameresult'
import { readName, resetNames } from './namechannel'
import { rotatedFootprint } from './nametext'
import { mulberry32, type GameContext, type GameModule } from './types'

/** A px style value as a number. */
const px = (v: string): number => parseFloat(v)

/** jsdom lays nothing out — give a node the box the test is reasoning about. */
function stubBox(el: HTMLElement, w: number, h: number): void {
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: h, configurable: true })
}
function stubLine(el: HTMLElement, w: number, h: number): void {
  Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true })
  Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true })
}
/** The scale() factor out of a transform list, 1 when there isn't one. */
const scaleOf = (el: HTMLElement): number => {
  const m = /scale\(([\d.]+)\)/.exec(el.style.transform)
  return m ? parseFloat(m[1]) : 1
}

function ctxFor(root: HTMLElement, played: string[], scale = 1): GameContext {
  return {
    root,
    assets: { src: (id) => (id ? `asset:${id}` : ''), size: () => null },
    sfx: { play: (e) => played.push(e) },
    rng: mulberry32(3),
    scale: () => scale,
  }
}

/** The preview-text span: it follows the caret and the post-caret half of the string. */
const ghostOf = (m: HTMLElement): HTMLElement => m.querySelector('[data-pa-caret]')!.nextElementSibling!.nextElementSibling as HTMLElement

function makeInput(params: Record<string, unknown> = {}, scale = 1) {
  const root = document.createElement('div')
  root.className = 'pa-root' // the pad hangs off the stage root, as it does in a scene
  document.body.appendChild(root)
  const mount = document.createElement('div')
  root.appendChild(mount)
  const played: string[] = []
  const mod = createNameInput()
  mod.mount(ctxFor(mount, played, scale), { ...NAMEINPUT_TEMPLATE.defaultParams, ...params })
  mod.start()
  const input = mount.querySelector('input') as HTMLInputElement
  const caret = mount.querySelector('[data-pa-caret]') as HTMLElement
  return {
    mod,
    root,
    mount,
    input,
    played,
    caret,
    pre: () => (caret.previousElementSibling as HTMLElement).textContent ?? '',
    post: () => (caret.nextElementSibling as HTMLElement).textContent ?? '',
    ghost: () => (caret.nextElementSibling?.nextElementSibling as HTMLElement).textContent ?? '',
    /** Type as the device keyboard would: the real input changes, then tells us. */
    type: (value: string, at = value.length) => {
      input.value = value
      input.setSelectionRange(at, at)
      input.dispatchEvent(new Event('input'))
    },
    tapField: () => mount.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })),
    // The pad is built once at start() and shown/hidden — "is it up" is its display,
    // not its existence.
    keypad: () => root.querySelector('[data-pa-keypad]') as HTMLElement,
    keypadUp: () => (root.querySelector('[data-pa-keypad]') as HTMLElement).style.display !== 'none',
  }
}

function makeResult(params: Record<string, unknown> = {}, interactive = true): { mod: GameModule; mount: HTMLElement; text: () => string; line: () => HTMLElement } {
  const root = document.createElement('div')
  root.className = 'pa-root'
  document.body.appendChild(root)
  const mount = document.createElement('div')
  root.appendChild(mount)
  const mod = createNameResult()
  mod.mount(ctxFor(mount, []), { ...NAMERESULT_TEMPLATE.defaultParams, ...params })
  if (interactive) mod.start()
  const line = mount.querySelector('[data-pa-name-line]') as HTMLElement
  return { mod, mount, line: () => line, text: () => line.textContent ?? '' }
}

describe('name box', () => {
  beforeEach(() => {
    resetNames()
    resetKeyboardProbe()
  })
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('draws the placeholder with a caret before anything is typed', () => {
    const p = makeInput({ placeholder: 'type here' })
    expect(p.ghost()).toBe('type here')
    expect(p.pre()).toBe('')
    expect(p.caret.style.display).toBe('inline-block')
  })

  it('hides the preview text the moment they type, and brings it back if they clear it', () => {
    const p = makeInput({ placeholder: 'type here' })
    p.type('B')
    expect(p.ghost()).toBe('')
    p.type('')
    expect(p.ghost()).toBe('type here')
  })

  it('styles the preview text independently of the typed text', () => {
    const p = makeInput({ placeholder: 'type here', placeholderColor: '#9aa3b2', placeholderFontSizePx: 30, placeholderWeight: 300, placeholderItalic: true, placeholderOpacity: 0.6, fontSizePx: 46 })
    const g = ghostOf(p.mount)
    // px() rather than a string compare: the CSSOM normalises what it is handed
    // ('30.00px' comes back as '30px'), and the number is what the test is about.
    expect(px(g.style.fontSize)).toBe(30) // its own size, not the field's 46
    expect(g.style.fontWeight).toBe('300')
    expect(g.style.fontStyle).toBe('italic')
    expect(g.style.opacity).toBe('0.6')
    expect(g.style.color).toBe('rgb(154, 163, 178)')
  })

  it('leaves a preview property it was given no value for inheriting the field', () => {
    const p = makeInput({ placeholderFontSizePx: 0, placeholderWeight: 0, placeholderFontFamily: '' })
    const g = ghostOf(p.mount)
    expect(g.style.fontSize).toBe('')
    expect(g.style.fontWeight).toBe('')
    expect(g.style.fontFamily).toBe('')
  })

  it('spaces the preview text from the cursor by its own gap, not the cursor gap', () => {
    const p = makeInput({ placeholderGapPx: 12, caretGapPx: 2 })
    // Empty: the cursor stands its right margin down so the preview's gap is the
    // whole distance rather than the two adding up.
    expect(px(ghostOf(p.mount).style.marginLeft)).toBe(12)
    expect(px(p.caret.style.marginRight)).toBe(0)
    p.type('Bo')
    expect(px(p.caret.style.marginRight)).toBe(2) // typed text uses the cursor's gap
  })

  it('scales both gaps with the stage', () => {
    const p = makeInput({ placeholderGapPx: 10, caretGapPx: 4 }, 2)
    expect(px(ghostOf(p.mount).style.marginLeft)).toBe(20)
    expect(px(p.caret.style.marginLeft)).toBe(8)
  })

  it('draws the cursor as a bar, a block or an underline', () => {
    const bar = makeInput({ caretStyle: 'bar', caretWidthPx: 3, fontSizePx: 40, caretHeightPct: 100 })
    expect(px(bar.caret.style.width)).toBe(3)
    expect(px(bar.caret.style.height)).toBe(40)
    const block = makeInput({ caretStyle: 'block', fontSizePx: 40, caretHeightPct: 100 })
    expect(px(block.caret.style.width)).toBe(22) // 0.55em, the width of a character cell
    const under = makeInput({ caretStyle: 'underline', caretWidthPx: 4, fontSizePx: 40 })
    expect(px(under.caret.style.height)).toBe(4) // the weight becomes the THICKNESS
    expect(under.caret.style.alignSelf).toBe('flex-end')
  })

  it('takes the blink speed from the author, and holds steady at 0', () => {
    const blink = makeInput({ caretBlinkMs: 400 })
    expect(blink.caret.style.animation).toContain('400ms')
    const steady = makeInput({ caretBlinkMs: 0 })
    expect(steady.caret.style.animation).toBe('')
  })

  it('draws each keystroke and publishes it to the channel', () => {
    const p = makeInput()
    p.type('Brow')
    expect(p.pre() + p.post()).toBe('Brow')
    expect(p.ghost()).toBe('')
    expect(readName('name')).toBe('Brow')
    expect(p.played).toContain('nameKey')
  })

  it('splits the drawn string at the insertion point, so the caret sits mid-word', () => {
    const p = makeInput()
    p.type('Brownie', 2)
    expect(p.pre()).toBe('Br')
    expect(p.post()).toBe('ownie')
  })

  it('enforces the character limit and the allowed set', () => {
    const p = makeInput({ maxChars: 5, allow: 'letters' })
    p.type('Br0wn!ie')
    expect(readName('name')).toBe('Brwni')
  })

  it('keeps the raw casing on the channel and cases only what it draws', () => {
    const p = makeInput({ textTransform: 'UPPERCASE' })
    p.type('brownie')
    expect(p.pre() + p.post()).toBe('BROWNIE')
    expect(readName('name')).toBe('brownie')
  })

  it('keeps two channels apart', () => {
    const a = makeInput({ channel: 'pet' })
    const b = makeInput({ channel: 'town' })
    a.type('Bo')
    b.type('Leeds')
    expect(readName('pet')).toBe('Bo')
    expect(readName('town')).toBe('Leeds')
  })

  it('re-opens holding the name already typed, so coming back to the scene keeps it', () => {
    const first = makeInput()
    first.type('Brownie')
    first.mod.destroy()
    const again = makeInput()
    expect(again.pre() + again.post()).toBe('Brownie')
    expect(again.input.value).toBe('Brownie')
  })
})

describe('name box — keyboards', () => {
  beforeEach(() => {
    resetNames()
    resetKeyboardProbe()
    // jsdom is not a touch device and has no visualViewport, so the probe would never
    // run: declare touch support the way a phone webview does.
    Object.defineProperty(window, 'ontouchstart', { value: null, configurable: true })
  })
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    delete (window as unknown as Record<string, unknown>).ontouchstart
  })

  it('asks for the device keyboard first and only falls back when nothing comes up', () => {
    vi.useFakeTimers()
    const p = makeInput({ fallbackMs: 900 })
    p.tapField()
    expect(document.activeElement).toBe(p.input)
    expect(p.keypadUp()).toBe(false)
    vi.advanceTimersByTime(950)
    expect(p.keypadUp()).toBe(true)
  })

  it('does not fall back when the device keyboard produces typing', () => {
    vi.useFakeTimers()
    const p = makeInput({ fallbackMs: 900 })
    p.tapField()
    p.type('B')
    vi.advanceTimersByTime(950)
    expect(p.keypadUp()).toBe(false)
  })

  it('built-in keys write into the same value the device keyboard would', () => {
    const p = makeInput({ keyboard: 'built-in only' })
    p.tapField()
    const pad = p.keypad()
    const press = (label: string): void => {
      const key = [...pad.querySelectorAll('div')].find((el) => el.textContent === label)
      key!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    }
    press('B')
    press('O')
    expect(readName('name')).toBe('Bo') // 'Capitalized' entry: first letter up, rest down
    expect(p.pre()).toBe('Bo')
    press('⌫')
    expect(readName('name')).toBe('B')
  })

  it('the built-in keyboard closes on DONE', () => {
    const p = makeInput({ keyboard: 'built-in only', keypadDoneLabel: 'DONE' })
    p.tapField()
    const pad = p.keypad()
    const done = [...pad.querySelectorAll('div')].find((el) => el.textContent === 'DONE')
    done!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(pad.style.display).toBe('none')
    expect(p.played).toContain('nameDone')
  })
})

describe('name result', () => {
  beforeEach(() => {
    resetNames()
    resetKeyboardProbe()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows the author stand-in until something is typed', () => {
    const r = makeResult({ emptyText: 'BROWNIE' })
    expect(r.text()).toBe('BROWNIE')
  })

  it('updates live as the box is typed into', () => {
    const p = makeInput()
    const r = makeResult({ emptyText: 'NAME' })
    p.type('Bro')
    expect(r.text()).toBe('BRO')
    p.type('Brownie')
    expect(r.text()).toBe('BROWNIE')
  })

  it('starts empty on a fresh load — the last player\'s name is not still in the box', () => {
    const p = makeInput()
    p.type('Brownie')
    expect(readName('name')).toBe('Brownie')
    // resetNames() is what a page load does for free: the channel is module state, so
    // a refresh re-runs the module with an empty map. Nothing is persisted anywhere.
    resetNames()
    const reloaded = makeInput({ placeholder: 'type here' })
    expect(reloaded.pre() + reloaded.post()).toBe('')
    expect(reloaded.ghost()).toBe('type here')
    expect(window.sessionStorage.getItem('pa:name:name')).toBeNull()
  })

  it('carries the name into a later scene — the box it came from is long gone', () => {
    const p = makeInput()
    p.type('Brownie')
    p.mod.destroy() // scene 1 is torn down
    const scene4 = makeResult({ emptyText: 'NAME' })
    expect(scene4.text()).toBe('BROWNIE')
  })

  it('follows its own channel, casing, prefix and suffix', () => {
    const p = makeInput({ channel: 'pet' })
    p.type('brownie')
    // The stand-in is cased by the same rule the name is — the default is UPPERCASE.
    const other = makeResult({ channel: 'town', emptyText: 'x' })
    const mine = makeResult({ channel: 'pet', textTransform: 'Capitalized', prefix: 'For ', suffix: '!' })
    expect(other.text()).toBe('X')
    expect(mine.text()).toBe('For Brownie!')
  })

  it('shrinks a turned name to its TURNED footprint, so a long one cannot escape the area', () => {
    // jsdom has no layout, so the line reports whatever we give it: a wide label in a
    // square area. Upright it fits at 1; at 45° its footprint is ~sqrt(2) bigger on
    // both axes and it has to come down to stay inside.
    const r = makeResult({ emptyText: 'BARTHOLOMEW', fit: 'shrink to fit', minScalePct: 1 })
    stubBox(r.mount, 200, 200)
    stubLine(r.line(), 200, 40)
    r.mod.relayout()
    expect(scaleOf(r.line())).toBeCloseTo(1, 2) // upright: already fits exactly

    const spun = makeResult({ emptyText: 'BARTHOLOMEW', fit: 'shrink to fit', minScalePct: 1, textAngle: 45 })
    stubBox(spun.mount, 200, 200)
    stubLine(spun.line(), 200, 40)
    spun.mod.relayout()
    // footprint at 45° = (200+40)/sqrt(2) ≈ 169.7 on each axis → 200/169.7 ≈ 1.18 → capped at 1?
    // No: shrink mode caps at 1 only when it FITS. 169.7 < 200, so it fits and stays 1.
    expect(scaleOf(spun.line())).toBeLessThanOrEqual(1)

    // Now a label too long to fit once turned: the fit must come down below 1.
    const long = makeResult({ emptyText: 'BARTHOLOMEW', fit: 'shrink to fit', minScalePct: 1, textAngle: 45 })
    stubBox(long.mount, 200, 200)
    stubLine(long.line(), 400, 40)
    long.mod.relayout()
    const f = scaleOf(long.line())
    expect(f).toBeLessThan(1)
    // Whatever it chose, the turned footprint must sit inside the area.
    const fp = rotatedFootprint(400 * f, 40 * f, 45, 0)
    expect(fp.w).toBeLessThanOrEqual(200.5)
    expect(fp.h).toBeLessThanOrEqual(200.5)
  })

  it('centres a turned name in the area rather than letting it swing off one edge', () => {
    const r = makeResult({ emptyText: 'BROWNIE', textAngle: 30, align: 'center', vAlign: 'middle', minScalePct: 1 })
    stubBox(r.mount, 300, 300)
    stubLine(r.line(), 200, 50)
    r.mod.relayout()
    const t = r.line().style.transform
    expect(r.line().style.transformOrigin).toBe('center center')
    // Centred in both axes: the nudge that lines the footprint up with the layout box
    // is zero either way, because the pivot is already the centre of both.
    const m = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(t)
    if (m) {
      expect(Math.abs(parseFloat(m[1]))).toBeLessThan(0.01)
      expect(Math.abs(parseFloat(m[2]))).toBeLessThan(0.01)
    }
  })

  it('lands a turned name on the edge it is aligned to, footprint and all', () => {
    const r = makeResult({ emptyText: 'BROWNIE', textAngle: 30, align: 'left', vAlign: 'top', minScalePct: 1 })
    stubBox(r.mount, 300, 300)
    stubLine(r.line(), 200, 50)
    r.mod.relayout()
    const m = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(r.line().style.transform)
    expect(m).not.toBeNull()
    // The footprint is centred on the layout box's centre, so aligning its edge to the
    // box's edge is half the difference between the two — which is NEGATIVE horizontally
    // here: a 200-wide line turned 30° is only 198.2 wide, so its left edge starts
    // inside the box and has to move out to reach the inset.
    const fp = rotatedFootprint(200, 50, 30, 0)
    expect(parseFloat(m![1])).toBeCloseTo((fp.w - 200) / 2, 1)
    expect(parseFloat(m![2])).toBeCloseTo((fp.h - 50) / 2, 1)
    expect(parseFloat(m![2])).toBeGreaterThan(0) // vertically it really is pushed down
  })

  it('puts the angle and the slant on the text, leaving the area itself square', () => {
    const r = makeResult({ emptyText: 'BO', textAngle: -12, skewXDeg: 6 })
    expect(r.line().style.transform).toContain('rotate(-12deg)')
    expect(r.line().style.transform).toContain('skewX(6deg)')
    expect(r.mount.style.transform).toBe('')
  })

  it('only outlines the area on the static canvas, never in play', () => {
    const onCanvas = makeResult({ showArea: true }, false)
    const inPlay = makeResult({ showArea: true }, true)
    const guideOf = (m: HTMLElement): HTMLElement => m.querySelector('[data-pa-name-guide]') as HTMLElement
    expect(guideOf(onCanvas.mount).style.display).toBe('')
    expect(guideOf(inPlay.mount).style.display).toBe('none')
  })
})
