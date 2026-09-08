// Behaviour tests for the two name mechanics: what is typed is drawn immediately
// with a caret at the insertion point, it reaches every result box on the same
// channel — including one mounted on a LATER scene, after the box is gone — and the
// built-in keyboard takes over (writing into the same value) when the device one
// never comes up.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNameInput, NAMEINPUT_TEMPLATE, resetKeyboardProbe } from './nameinput'
import { createNameResult, NAMERESULT_TEMPLATE } from './nameresult'
import { readName, resetNames } from './namechannel'
import { mulberry32, type GameContext, type GameModule } from './types'

/** A px style value as a number. */
const px = (v: string): number => parseFloat(v)

function ctxFor(root: HTMLElement, played: string[]): GameContext {
  return {
    root,
    assets: { src: (id) => (id ? `asset:${id}` : ''), size: () => null },
    sfx: { play: (e) => played.push(e) },
    rng: mulberry32(3),
    scale: () => 1,
  }
}

function makeInput(params: Record<string, unknown> = {}) {
  const root = document.createElement('div')
  root.className = 'pa-root' // the pad hangs off the stage root, as it does in a scene
  document.body.appendChild(root)
  const mount = document.createElement('div')
  root.appendChild(mount)
  const played: string[] = []
  const mod = createNameInput()
  mod.mount(ctxFor(mount, played), { ...NAMEINPUT_TEMPLATE.defaultParams, ...params })
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

  it('styles the preview text on its own when it is not matching the typed text', () => {
    const matched = makeInput({ placeholder: 'type here', placeholderColor: '#9aa3b2' })
    const ghostOf = (m: HTMLElement): HTMLElement => (m.querySelector('[data-pa-caret]')!.nextElementSibling!.nextElementSibling as HTMLElement)
    expect(ghostOf(matched.mount).style.fontSize).toBe('') // inherits the typed size
    expect(ghostOf(matched.mount).style.color).toBe('rgb(154, 163, 178)')
    const own = makeInput({ placeholderMatch: false, placeholderFontSizePx: 30, placeholderWeight: 400, placeholderItalic: true, placeholderOpacity: 0.6 })
    const g = ghostOf(own.mount)
    // px() rather than a string compare: the CSSOM normalises what it is handed
    // ('30.00px' comes back as '30px'), and the number is what the test is about.
    expect(px(g.style.fontSize)).toBe(30)
    expect(g.style.fontWeight).toBe('400')
    expect(g.style.fontStyle).toBe('italic')
    expect(g.style.opacity).toBe('0.6')
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
