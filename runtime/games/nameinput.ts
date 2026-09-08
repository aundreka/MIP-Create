// Name box: the field the player types their pet's / their own name into, live.
//
// It is a game mount rather than a variant of the text element for the same reason
// the progress bar is one: it needs a BOX on the canvas (the field's width, height,
// corner radius and position are the whole design of it) and it needs behaviour. What
// it does NOT do is win — an author advances the scene with a CTA, a button or a tap,
// exactly as they would from any other screen, and the arrow in the mock-up is an
// ordinary button element the author places on top. This mechanic's only job is: take
// keystrokes, draw them the way a text element would, and publish them.
//
// Where they go is namechannel.ts. Every "Name result" mount listening on the same
// channel — in this scene, over the product shot, and on every scene after it —
// redraws on each keystroke. The value outlives the scene, so scene 4 shows the name
// typed on scene 1 without either element knowing the other exists.
//
// The caret is drawn, not borrowed. A native caret cannot be styled (colour, weight,
// height are the browser's), does not exist at all when the built-in keyboard is
// driving, and sits wherever the invisible input's own layout puts it rather than
// inside the author's box. Drawing it means one caret in every mode, at the real
// insertion point, in the author's colour.

import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { num, str } from './types'
import { writeName, readName, onNameChange } from './namechannel'
import { applyBoxStyle, applyCase, applyTextStyle, boxFields, BOX_DEFAULTS, ensureCaretCss, fitScale, readBoxStyle, readTextStyle, textFields, TEXT_DEFAULTS, type BoxStyle, type TextStyle } from './nametext'
import { createKeypad, type KeyLayout, type Keypad } from './keypad'
import { cssFontFamily } from '../font'

type AllowMode = 'letters' | 'letters + numbers' | 'letters + numbers + space' | 'anything'
type KeyboardMode = 'auto (device, then built-in)' | 'device only' | 'built-in only'
/** What the insertion point is drawn as: the thin bar every text field uses, the
 * filled block of a terminal, or the underscore of an arcade name-entry screen. */
type CaretStyle = 'bar' | 'block' | 'underline'

/** Once the device keyboard has proved it cannot come up, every later tap in this
 * session goes straight to the built-in pad — the player should not have to sit
 * through the detection delay twice. */
let deviceKeyboardFailed = false

/** Forget that verdict. Only a test (or a deliberate "start over") wants this — in a
 * real session the probe should run once and be believed. */
export function resetKeyboardProbe(): void {
  deviceKeyboardFailed = false
}

function allowFilter(mode: AllowMode): RegExp | null {
  if (mode === 'anything') return null
  if (mode === 'letters') return /[^\p{L}'-]/gu
  if (mode === 'letters + numbers') return /[^\p{L}\p{N}'-]/gu
  return /[^\p{L}\p{N} '-]/gu
}

export function createNameInput(): GameModule {
  let ctx: GameContext
  let box: HTMLDivElement
  let pad: HTMLDivElement
  let line: HTMLDivElement
  let pre: HTMLSpanElement
  let caret: HTMLSpanElement
  let post: HTMLSpanElement
  let ghost: HTMLSpanElement
  let input: HTMLInputElement | null = null
  let keypad: Keypad | null = null

  // ---- config ----
  let channel = 'name'
  let placeholder = 'type here'
  let placeholderColor = '#9aa3b2'
  let placeholderOpacity = 1
  let placeholderFont = ''
  let placeholderSizePx = 0
  let placeholderWeight = 0
  let placeholderSpacingPx = 0
  let placeholderItalic = false
  /** Distance from the cursor to the preview text, in design px. */
  let placeholderGapPx = 0.5
  let maxChars = 15
  let allow: AllowMode = 'letters + numbers + space'
  let keyboardMode: KeyboardMode = 'auto (device, then built-in)'
  let fallbackMs = 900
  let autoFocus = false
  let caretColor = '#1d2ce0'
  let caretStyle: CaretStyle = 'bar'
  let caretWidthPx = 3
  let caretHeightPct = 112
  /** Space either side of the cursor, between it and the typed text. */
  let caretGapPx = 0.5
  let caretBlinkMs = 1060
  let caretAlways = true
  let minScalePct = 45
  let text: TextStyle
  let boxStyle: BoxStyle
  let keypadInsert: 'UPPERCASE' | 'Capitalized' | 'lowercase' = 'Capitalized'
  let keypadStyle: {
    layout: KeyLayout
    digits: boolean
    bg: string
    keyColor: string
    keyTextColor: string
    keyRadiusPx: number
    heightPct: number
    gapPx: number
    fontFamily: string
    doneLabel: string
    spaceLabel: string
  }

  // ---- state ----
  /** The raw string, exactly as typed. Casing for display is applied per element. */
  let value = ''
  /** Insertion point, as an index into `value`. */
  let caretAt = 0
  let focused = false
  let started = false
  let offChannel: (() => void) | null = null
  let fallbackTimer = 0
  /** The tallest the visual viewport has been — the baseline a keyboard shrinks from. */
  let viewportBase = 0
  let sawTyping = false

  const s = (): number => ctx.scale?.() ?? 1
  const doc = (): Document => ctx.root.ownerDocument ?? document
  const stage = (): HTMLElement => ctx.root.closest<HTMLElement>('.pa-root') ?? ctx.root

  const sanitize = (raw: string): string => {
    const re = allowFilter(allow)
    let out = re ? raw.replace(re, '') : raw
    // Collapse runs of whitespace as they are typed: a double space inside a name is
    // never intentional and it is invisible in the box but very visible on the patch.
    out = out.replace(/\s{2,}/g, ' ').replace(/^\s+/, '')
    return maxChars > 0 ? out.slice(0, maxChars) : out
  }

  /** Publish + repaint. Called on every keystroke from either keyboard. */
  const commit = (next: string, at: number): void => {
    const clean = sanitize(next)
    value = clean
    caretAt = Math.max(0, Math.min(clean.length, at))
    writeName(channel, clean)
    if (input && input.value !== clean) {
      input.value = clean
      try {
        input.setSelectionRange(caretAt, caretAt)
      } catch {
        /* an input that isn't in the document yet rejects a selection — harmless */
      }
    }
    render()
  }

  // ---- painting -------------------------------------------------------------

  const render = (): void => {
    const shown = applyCase(value, text.transform)
    const empty = value.length === 0
    // The caret splits the string, so the two halves are separate nodes and the caret
    // is a real box between them rather than a position guessed from a measurement.
    pre.textContent = empty ? '' : shown.slice(0, caretAt)
    post.textContent = empty ? '' : shown.slice(caretAt)
    ghost.textContent = empty ? placeholder : ''
    ghost.style.display = empty ? '' : 'none'
    const caretOn = caretAlways || focused || (keypad?.isOpen() ?? false)
    caret.style.display = caretOn ? 'inline-block' : 'none'
    layoutText()
  }

  /** Everything that depends on the slot's box or the stage scale. */
  const layoutText = (): void => {
    const k = s()
    const w = ctx.root.clientWidth || 1
    const h = ctx.root.clientHeight || 1
    applyBoxStyle(box, boxStyle, w, h, k)
    const px = boxStyle.padXPx * k
    const py = boxStyle.padYPx * k
    pad.style.left = px.toFixed(1) + 'px'
    pad.style.right = px.toFixed(1) + 'px'
    pad.style.top = py.toFixed(1) + 'px'
    pad.style.bottom = py.toFixed(1) + 'px'
    pad.style.justifyContent = text.align === 'center' ? 'center' : text.align === 'right' ? 'flex-end' : 'flex-start'

    applyTextStyle(line, text, k)
    // The preview text ("type here") is styled independently of the typed text — it is
    // a different piece of copy doing a different job (an instruction, not an answer),
    // and in most designs it is lighter, greyer, sometimes a different face entirely.
    // It is a separate span inside the same line, so anything left at 0/blank simply
    // isn't written and it inherits the field's own value for that one property —
    // which keeps a half-filled block coherent instead of snapping to a default.
    ghost.style.color = placeholderColor
    ghost.style.opacity = placeholderOpacity === 1 ? '' : String(placeholderOpacity)
    ghost.style.fontFamily = placeholderFont ? cssFontFamily(placeholderFont) : ''
    ghost.style.fontSize = placeholderSizePx > 0 ? (placeholderSizePx * k).toFixed(2) + 'px' : ''
    ghost.style.fontWeight = placeholderWeight > 0 ? String(placeholderWeight) : ''
    ghost.style.letterSpacing = placeholderSpacingPx !== 0 ? (placeholderSpacingPx * k).toFixed(2) + 'px' : ''
    ghost.style.fontStyle = placeholderItalic ? 'italic' : ''
    // The gap to the cursor is the preview text's own number, not the cursor's: when
    // the field is empty the cursor drops its right margin so this one value IS the
    // distance, rather than the author having to add two numbers together.
    ghost.style.marginLeft = (placeholderGapPx * k).toFixed(2) + 'px'
    // Cursor shape. Weight, height, colour and blink are all authored; the three
    // shapes differ only in which of those two numbers drives which axis, and where
    // the box sits against the line — a bar and a block are full-height and centred,
    // an underline is `caretWidthPx` THICK and sits under the text.
    const emPx = text.fontSizePx * k
    const fullH = (emPx * caretHeightPct) / 100
    const wide = Math.max(1, emPx * 0.55)
    caret.style.background = caretColor
    caret.style.width = (caretStyle === 'bar' ? Math.max(1, caretWidthPx * k) : wide).toFixed(1) + 'px'
    caret.style.height = (caretStyle === 'underline' ? Math.max(1, caretWidthPx * k) : fullH).toFixed(1) + 'px'
    caret.style.alignSelf = caretStyle === 'underline' ? 'flex-end' : 'center'
    caret.style.marginBottom = caretStyle === 'underline' ? (emPx * 0.08).toFixed(1) + 'px' : '0'
    // Margin, not padding: the caret must occupy real width between itself and the
    // text, and a zero-width box with side padding would collapse the gap. Negative is
    // allowed and useful — it tucks the cursor against the letters.
    // The right margin stands down while the preview text is showing, because that
    // gap belongs to the preview text (above).
    caret.style.marginLeft = (caretGapPx * k).toFixed(2) + 'px'
    caret.style.marginRight = (value.length === 0 ? 0 : caretGapPx * k).toFixed(2) + 'px'

    // The fit is measured unscaled, then applied: a long name shrinks to stay inside
    // the field instead of running out of it, and the caret shrinks with it because
    // it is inside the same scaled line.
    line.style.transform = 'none'
    const f = fitScale(line, Math.max(0, w - px * 2), Math.max(0, h - py * 2), 'shrink to fit', minScalePct, 100)
    line.style.transformOrigin = text.align === 'center' ? 'center center' : text.align === 'right' ? 'right center' : 'left center'
    line.style.transform = f === 1 ? 'none' : `scale(${f.toFixed(4)})`
  }

  // ---- keyboards ------------------------------------------------------------

  const openKeypad = (): void => {
    if (!keypad) return
    deviceKeyboardFailed = true
    if (input) {
      // inputmode=none is the one hint webviews agree on for "focusable, but do not
      // raise the OS keyboard" — and blurring as well means a stray tap on the field
      // can't summon it behind the pad.
      input.inputMode = 'none'
      input.blur()
    }
    keypad.relayout(s())
    keypad.open()
    focused = true
    render()
  }

  const closeKeypad = (): void => {
    keypad?.close()
    focused = false
    render()
  }

  /** Has something happened that only a real keyboard could cause? */
  const keyboardIsUp = (): boolean => {
    if (sawTyping) return true
    const vv = window.visualViewport
    if (!vv || !viewportBase) return false
    return viewportBase - vv.height > viewportBase * 0.15
  }

  const isTouch = (): boolean => {
    try {
      return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
    } catch {
      return 'ontouchstart' in window
    }
  }

  /**
   * A tap on the field.
   *
   * Device first: focus the real input inside the gesture (the only moment a webview
   * will raise a keyboard at all), then wait `fallbackMs`. If by then nothing has
   * typed and the viewport has not been pushed up by a keyboard, the device keyboard
   * is not coming and the built-in pad opens instead. On a mouse-and-keyboard machine
   * there is no viewport shift to look for and the physical keyboard always works, so
   * the fallback never runs there.
   */
  const onFieldTap = (): void => {
    // A tap while the pad is up is a tap on the pad (it sits outside this mount, so
    // this only fires for the field itself) — re-probing there would ask for the
    // device keyboard we already know isn't coming.
    if (keypad?.isOpen()) return
    if (keyboardMode === 'built-in only' || (keyboardMode === 'auto (device, then built-in)' && deviceKeyboardFailed && isTouch())) {
      openKeypad()
      return
    }
    focusInput()
    if (keyboardMode !== 'auto (device, then built-in)' || !isTouch()) return
    window.clearTimeout(fallbackTimer)
    fallbackTimer = window.setTimeout(() => {
      if (!keyboardIsUp()) openKeypad()
    }, Math.max(120, fallbackMs))
  }

  const focusInput = (): void => {
    if (!input) return
    const vv = window.visualViewport
    if (vv) viewportBase = Math.max(viewportBase, vv.height)
    try {
      input.focus({ preventScroll: true })
      input.setSelectionRange(caretAt, caretAt)
    } catch {
      /* focus can be refused outright in a locked-down webview — the fallback covers it */
    }
    focused = true
    render()
  }

  // ---- keypad callbacks -----------------------------------------------------

  const insert = (ch: string): void => {
    const cased = keypadInsert === 'lowercase' ? ch.toLowerCase() : keypadInsert === 'UPPERCASE' ? ch.toUpperCase() : caretAt === 0 || /\s$/.test(value.slice(0, caretAt)) ? ch.toUpperCase() : ch.toLowerCase()
    if (maxChars > 0 && value.length >= maxChars) return
    const next = value.slice(0, caretAt) + cased + value.slice(caretAt)
    const before = value
    commit(next, caretAt + 1)
    if (value !== before) ctx.sfx.play('nameKey')
  }

  const backspace = (): void => {
    if (caretAt <= 0) return
    const next = value.slice(0, caretAt - 1) + value.slice(caretAt)
    commit(next, caretAt - 1)
    ctx.sfx.play('nameKey')
  }

  // ---- input element --------------------------------------------------------

  const syncFromInput = (): void => {
    if (!input) return
    sawTyping = true
    commit(input.value, input.selectionStart ?? input.value.length)
    ctx.sfx.play('nameKey')
  }

  const syncCaret = (): void => {
    if (!input || doc().activeElement !== input) return
    const at = input.selectionStart ?? value.length
    if (at !== caretAt) {
      caretAt = Math.max(0, Math.min(value.length, at))
      render()
    }
  }

  const buildInput = (): void => {
    const el = doc().createElement('input')
    el.type = 'text'
    el.autocomplete = 'off'
    el.spellcheck = false
    el.setAttribute('autocorrect', 'off')
    el.setAttribute('autocapitalize', keypadInsert === 'lowercase' ? 'none' : keypadInsert === 'UPPERCASE' ? 'characters' : 'words')
    el.setAttribute('enterkeyhint', 'done')
    el.setAttribute('aria-label', placeholder || 'name')
    if (maxChars > 0) el.maxLength = maxChars
    el.value = value
    // Invisible, but a REAL input covering the field: it owns focus, the OS keyboard
    // and the selection, while the visible drawing is ours.
    //
    // Three of these declarations are load-bearing rather than cosmetic:
    //   • user-select:text — the runtime's base CSS puts user-select:none on body,
    //     .pa-root AND .pa-el, and an input inside a -webkit-user-select:none subtree
    //     is unfocusable in iOS WebKit. Every playable element inherits that, so the
    //     field has to opt itself back out or the keyboard never comes up at all.
    //   • touch-action:manipulation — the same wrappers set touch-action:none, which
    //     is right for a drag game and wrong for the one element meant to take a tap.
    //   • font-size:16px — iOS zooms the whole page when a focused input's font is
    //     smaller, which would throw the composition off centre mid-type. The text is
    //     transparent, so the size is never seen.
    el.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;background:transparent;' +
      'opacity:0;color:transparent;font-size:16px;caret-color:transparent;outline:none;-webkit-appearance:none;appearance:none;' +
      'user-select:text;-webkit-user-select:text;touch-action:manipulation;pointer-events:auto;'
    el.addEventListener('input', syncFromInput)
    el.addEventListener('keyup', syncCaret)
    el.addEventListener('click', syncCaret)
    el.addEventListener('select', syncCaret)
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        el.blur()
        ctx.sfx.play('nameDone')
      }
    })
    el.addEventListener('focus', () => {
      focused = true
      render()
    })
    el.addEventListener('blur', () => {
      focused = false
      render()
    })
    ctx.root.appendChild(el)
    input = el
  }

  // ---- outside taps ---------------------------------------------------------

  const onStageDown = (e: Event): void => {
    const t = e.target
    if (!(t instanceof Node)) return
    if (ctx.root.contains(t)) return
    if (t instanceof Element && t.closest('[data-pa-keypad]')) return
    if (keypad?.isOpen()) {
      closeKeypad()
      ctx.sfx.play('nameDone')
    }
  }

  const onClickRetry = (): void => {
    if (!input || keypad?.isOpen() || keyboardMode === 'built-in only') return
    if (doc().activeElement !== input) focusInput()
  }

  const onViewportResize = (): void => {
    const vv = window.visualViewport
    if (!vv) return
    viewportBase = Math.max(viewportBase, vv.height)
  }

  return {
    mount(c, params) {
      ctx = c
      const d = doc()
      ensureCaretCss(d)

      channel = str(params.channel, 'name').trim() || 'name'
      placeholder = str(params.placeholder, 'type here')
      placeholderColor = str(params.placeholderColor, '#9aa3b2')
      placeholderOpacity = Math.max(0, Math.min(1, num(params.placeholderOpacity, 1)))
      placeholderFont = str(params.placeholderFontFamily, '')
      placeholderSizePx = Math.max(0, num(params.placeholderFontSizePx, 0))
      placeholderWeight = Math.max(0, num(params.placeholderWeight, 0))
      placeholderSpacingPx = num(params.placeholderLetterSpacingPx, 0)
      placeholderItalic = params.placeholderItalic === true
      placeholderGapPx = num(params.placeholderGapPx, 0.5)
      maxChars = Math.max(0, Math.round(num(params.maxChars, 15)))
      allow = str(params.allow, 'letters + numbers + space') as AllowMode
      keyboardMode = str(params.keyboard, 'auto (device, then built-in)') as KeyboardMode
      fallbackMs = num(params.fallbackMs, 900)
      autoFocus = params.autoFocus === true
      caretColor = str(params.caretColor, '#1d2ce0')
      caretStyle = str(params.caretStyle, 'bar') as CaretStyle
      caretWidthPx = Math.max(0, num(params.caretWidthPx, 3))
      caretHeightPct = Math.max(10, num(params.caretHeightPct, 112))
      caretGapPx = num(params.caretGapPx, 0.5)
      caretBlinkMs = Math.max(0, num(params.caretBlinkMs, 1060))
      caretAlways = params.caretAlways !== false
      minScalePct = Math.max(5, Math.min(100, num(params.minScalePct, 45)))
      keypadInsert = str(params.keypadInsert, 'Capitalized') as typeof keypadInsert
      text = readTextStyle(params, 'left')
      boxStyle = readBoxStyle(params)
      keypadStyle = {
        layout: str(params.keypadLayout, 'QWERTY') as KeyLayout,
        digits: params.keypadDigits === true,
        bg: str(params.keypadBg, 'rgba(18,20,28,.96)'),
        keyColor: str(params.keypadKeyColor, '#3b3f4c'),
        keyTextColor: str(params.keypadKeyTextColor, '#ffffff'),
        keyRadiusPx: Math.max(0, num(params.keypadKeyRadiusPx, 10)),
        heightPct: Math.max(10, Math.min(70, num(params.keypadHeightPct, 34))),
        gapPx: Math.max(0, num(params.keypadGapPx, 8)),
        // The keys follow the field's typeface: a brand font set once carries onto the
        // pad, and a keyboard in a second typeface is a bug rather than a feature.
        fontFamily: text.fontFamily,
        doneLabel: str(params.keypadDoneLabel, 'DONE'),
        spaceLabel: str(params.keypadSpaceLabel, 'space'),
      }

      // A name already typed (the player came back to this scene) wins over the
      // author's prefill; the prefill seeds the channel so the editor canvas and a
      // first run both show something.
      const carried = readName(channel)
      const prefill = sanitize(str(params.prefill, ''))
      value = carried || prefill
      caretAt = value.length
      if (value && !carried) writeName(channel, value)

      ctx.root.style.touchAction = 'manipulation'

      box = d.createElement('div')
      box.dataset.paNameBox = '1'
      box.style.cssText = 'position:absolute;inset:0;box-sizing:border-box;overflow:hidden;'
      ctx.root.appendChild(box)

      pad = d.createElement('div')
      pad.style.cssText = 'position:absolute;display:flex;align-items:center;overflow:hidden;'
      box.appendChild(pad)

      line = d.createElement('div')
      line.style.cssText = 'display:inline-flex;align-items:center;white-space:pre;will-change:transform;'
      pad.appendChild(line)

      pre = d.createElement('span')
      caret = d.createElement('span')
      caret.dataset.paCaret = '1'
      caret.style.cssText = 'display:inline-block;flex:0 0 auto;border-radius:1px;'
      post = d.createElement('span')
      ghost = d.createElement('span')
      line.append(pre, caret, post, ghost)

      render()
    },

    start(): void {
      if (started) return
      started = true
      const d = doc()
      ensureCaretCss(d)
      if (caretBlinkMs > 0) caret.style.animation = `pa-name-blink ${caretBlinkMs}ms steps(1,end) infinite`

      buildInput()
      keypad = createKeypad(stage(), keypadStyle, { char: insert, backspace, done: () => {
        closeKeypad()
        ctx.sfx.play('nameDone')
      } })

      const vv = window.visualViewport
      if (vv) {
        viewportBase = vv.height
        vv.addEventListener('resize', onViewportResize)
      }

      // The whole mount is the hit area, not just the invisible input: an author who
      // insets the text keeps the field's own padding tappable.
      ctx.root.addEventListener('pointerdown', onFieldTap)
      // A second chance inside the same gesture: a few webviews only honour focus()
      // from a click, and asking twice costs nothing when the first attempt worked.
      ctx.root.addEventListener('click', onClickRetry)
      stage().addEventListener('pointerdown', onStageDown, true)

      // Another element on the same channel (a second box in a later scene) writing a
      // value has to reach this one too, or the two would disagree after a back-navigation.
      offChannel = onNameChange(channel, (v) => {
        if (v === value) return
        value = v
        caretAt = v.length
        if (input) input.value = v
        render()
      })

      if (autoFocus) onFieldTap()
      layoutText()
    },

    relayout(): void {
      layoutText()
      keypad?.relayout(s())
    },

    /** Point the hand at the field: this mechanic's only move is "tap here and type". */
    getHint(): HintMove | null {
      const r = ctx.root.getBoundingClientRect()
      const p = { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 }
      return { from: p, to: p, kind: 'tap' }
    },

    onComplete(): void {
      // Deliberately never called back. A name box does not end the scene: the author
      // advances with a CTA, a button or a scene tap, so the player can keep editing
      // until they choose to move on.
    },

    destroy(): void {
      window.clearTimeout(fallbackTimer)
      offChannel?.()
      offChannel = null
      const vv = window.visualViewport
      if (vv) vv.removeEventListener('resize', onViewportResize)
      ctx.root.removeEventListener('pointerdown', onFieldTap)
      ctx.root.removeEventListener('click', onClickRetry)
      stage().removeEventListener('pointerdown', onStageDown, true)
      keypad?.destroy()
      keypad = null
      input?.remove()
      input = null
      box.remove()
      started = false
    },
  }
}

export const NAMEINPUT_TEMPLATE: GameTemplate = {
  id: 'nameinput',
  label: 'Name box (type in)',
  paramFields: [
    { key: 'channel', group: 'Name', label: 'Channel (result boxes must match)', type: 'text' },
    { key: 'prefill', group: 'Name', label: 'Starting text', type: 'text' },

    { key: 'maxChars', group: 'Name', label: 'Max characters (0 = no limit)', type: 'number', min: 0, max: 60, step: 1 },
    { key: 'placeholder', group: 'Preview text', label: 'Preview text (hidden once they type)', type: 'text' },
    { key: 'placeholderColor', group: 'Preview text', label: 'Colour', type: 'color' },
    { key: 'placeholderOpacity', group: 'Preview text', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'placeholderFontFamily', group: 'Preview text', label: 'Font (blank = the typed font)', type: 'font' },
    { key: 'placeholderFontSizePx', group: 'Preview text', label: 'Font size (0 = the typed size)', type: 'number', min: 0, max: 400, step: 1 },
    { key: 'placeholderWeight', group: 'Preview text', label: 'Weight (0 = the typed weight)', type: 'number', min: 0, max: 900, step: 100 },
    { key: 'placeholderLetterSpacingPx', group: 'Preview text', label: 'Letter spacing', type: 'number', min: -20, max: 40, step: 0.5 },
    { key: 'placeholderItalic', group: 'Preview text', label: 'Italic', type: 'boolean' },
    { key: 'placeholderGapPx', group: 'Preview text', label: 'Gap from the cursor', type: 'number', min: -40, max: 200, step: 0.5 },
    { key: 'allow', group: 'Name', label: 'Allowed characters', type: 'select', options: ['letters', 'letters + numbers', 'letters + numbers + space', 'anything'] },
    ...textFields('Text'),
    { key: 'minScalePct', group: 'Text', label: 'Shrink limit %', type: 'number', min: 5, max: 100, step: 5 },
    { key: 'caretStyle', group: 'Cursor', label: 'Cursor shape', type: 'select', options: ['bar', 'block', 'underline'] },
    { key: 'caretColor', group: 'Cursor', label: 'Cursor colour', type: 'color' },
    { key: 'caretWidthPx', group: 'Cursor', label: 'Cursor weight (thickness)', type: 'number', min: 0, max: 20, step: 0.5, showIf: (p) => str(p.caretStyle, 'bar') !== 'block' },
    { key: 'caretHeightPct', group: 'Cursor', label: 'Cursor height % of font', type: 'number', min: 10, max: 300, step: 2, showIf: (p) => str(p.caretStyle, 'bar') !== 'underline' },
    { key: 'caretBlinkMs', group: 'Cursor', label: 'Blink speed — full cycle ms (0 = steady)', type: 'number', min: 0, max: 4000, step: 20 },
    { key: 'caretGapPx', group: 'Cursor', label: 'Gap either side of the cursor', type: 'number', min: -40, max: 200, step: 0.5 },
    { key: 'caretAlways', group: 'Cursor', label: 'Show cursor before they tap', type: 'boolean' },
    ...boxFields('Field box'),
    { key: 'keyboard', group: 'Keyboard', label: 'Keyboard', type: 'select', options: ['auto (device, then built-in)', 'device only', 'built-in only'] },
    { key: 'fallbackMs', group: 'Keyboard', label: 'Wait before falling back (ms)', type: 'number', min: 120, max: 4000, step: 50, showIf: (p) => str(p.keyboard, '') !== 'device only' },
    { key: 'autoFocus', group: 'Keyboard', label: 'Open the keyboard on scene enter', type: 'boolean' },
    { key: 'keypadInsert', group: 'Keyboard', label: 'Letter case entered', type: 'select', options: ['Capitalized', 'UPPERCASE', 'lowercase'] },
    { key: 'keypadLayout', group: 'Built-in keyboard', label: 'Layout', type: 'select', options: ['QWERTY', 'ABC'], showIf: (p) => str(p.keyboard, '') !== 'device only' },
    { key: 'keypadDigits', group: 'Built-in keyboard', label: 'Number row', type: 'boolean', showIf: (p) => str(p.keyboard, '') !== 'device only' },
    { key: 'keypadHeightPct', group: 'Built-in keyboard', label: 'Height % of screen', type: 'number', min: 10, max: 70, step: 1, showIf: (p) => str(p.keyboard, '') !== 'device only' },
    { key: 'keypadBg', group: 'Built-in keyboard', label: 'Backdrop', type: 'color', showIf: (p) => str(p.keyboard, '') !== 'device only' },
    { key: 'keypadKeyColor', group: 'Built-in keyboard', label: 'Key colour', type: 'color', showIf: (p) => str(p.keyboard, '') !== 'device only' },
    { key: 'keypadKeyTextColor', group: 'Built-in keyboard', label: 'Key text', type: 'color', showIf: (p) => str(p.keyboard, '') !== 'device only' },
    { key: 'keypadKeyRadiusPx', group: 'Built-in keyboard', label: 'Key radius', type: 'number', min: 0, max: 60, step: 1, showIf: (p) => str(p.keyboard, '') !== 'device only' },
    { key: 'keypadGapPx', group: 'Built-in keyboard', label: 'Key gap', type: 'number', min: 0, max: 40, step: 1, showIf: (p) => str(p.keyboard, '') !== 'device only' },
    { key: 'keypadDoneLabel', group: 'Built-in keyboard', label: 'Done key label', type: 'text', showIf: (p) => str(p.keyboard, '') !== 'device only' },
    { key: 'keypadSpaceLabel', group: 'Built-in keyboard', label: 'Space key label', type: 'text', showIf: (p) => str(p.keyboard, '') !== 'device only' },
  ],
  defaultParams: {
    ...TEXT_DEFAULTS,
    ...BOX_DEFAULTS,
    channel: 'name',
    prefill: '',
    placeholder: 'type here',
    placeholderColor: '#9aa3b2',
    placeholderOpacity: 1,
    placeholderFontFamily: '',
    placeholderFontSizePx: 0,
    // Lighter than the typed text by default — the mock's grey "type here" reads as an
    // instruction, and a placeholder at the answer's weight reads as an answer.
    placeholderWeight: 400,
    placeholderLetterSpacingPx: 0,
    placeholderItalic: false,
    placeholderGapPx: 0.5,
    maxChars: 15,
    allow: 'letters + numbers + space',
    fontSizePx: 46,
    fontWeight: 600,
    color: '#111827',
    align: 'left',
    minScalePct: 45,
    caretStyle: 'bar',
    caretColor: '#1d2ce0',
    caretWidthPx: 3,
    caretHeightPct: 112,
    caretBlinkMs: 1060,
    caretGapPx: 0.5,
    caretAlways: true,
    boxColor: '#ffffff',
    boxRadiusPx: 10,
    boxPadXPx: 28,
    boxPadYPx: 12,
    boxShadowY: 3,
    boxShadowBlur: 10,
    boxShadowColor: 'rgba(0,0,0,.16)',
    keyboard: 'auto (device, then built-in)',
    fallbackMs: 900,
    autoFocus: false,
    keypadInsert: 'Capitalized',
    keypadLayout: 'QWERTY',
    keypadDigits: false,
    keypadHeightPct: 34,
    keypadBg: 'rgba(18,20,28,.96)',
    keypadKeyColor: '#3b3f4c',
    keypadKeyTextColor: '#ffffff',
    keypadKeyRadiusPx: 10,
    keypadGapPx: 8,
    keypadDoneLabel: 'DONE',
    keypadSpaceLabel: 'space',
  },
  defaultHintIdleMs: 2200,
  create: createNameInput,
}
