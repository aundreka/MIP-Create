// Name result: the typed name, drawn inside an area the author draws.
//
// The area IS the game mount's box, which is the whole reason this is a mechanic and
// not a parameter of the name box. Sizing it is dragging its corners on the canvas;
// putting it on the patch stitched onto a harness is dragging it there. Nothing about
// placement is typed into a panel.
//
// Two rotations, and which one an author wants depends on what they are protecting:
//   • The element's own **Angle** (the rotate handle on the canvas) turns the AREA.
//     The fit rectangle tilts with it, so a name set diagonally across a patch gets the
//     full diagonal to grow into. This is the one to reach for.
//   • **Turn the text only** turns the lettering inside an upright area. The fit then
//     has to allow for the turned footprint — a tilted word is wider and taller than
//     the same word straight — which it does, so a long name still cannot escape the
//     rectangle the author drew.
//
// What it shows comes off the name channel, so it needs no connection to the box the
// player typed into — same channel name, and that is the wiring. That is also what
// makes it work on LATER scenes: the value is not owned by the scene the box was on.
// Scene 4 in the mock-up is one of these over the product shot, at its own size and
// its own angle, showing what was typed on scene 1.
//
// The fit is the other half. A patch is a fixed piece of art and "BO" and "BARTHOLOMEW"
// have to live inside the same one, so the text is measured and scaled to the area
// rather than trusted to a font size. `fill the area` scales up as well as down, for
// art where the lettering is meant to fill the space whatever the name.

import type { GameContext, GameModule, GameTemplate } from './types'
import { num, str } from './types'
import { onNameChange, readName } from './namechannel'
import { applyBoxStyle, applyCase, applyTextStyle, boxFields, BOX_DEFAULTS, fitOffset, fitScale, readBoxStyle, readTextStyle, textFields, TEXT_DEFAULTS, type BoxStyle, type FitMode, type TextStyle } from './nametext'

type VAlign = 'top' | 'middle' | 'bottom'

export function createNameResult(): GameModule {
  let ctx: GameContext
  let box: HTMLDivElement
  let pad: HTMLDivElement
  let line: HTMLDivElement
  let word: HTMLSpanElement
  let guide: HTMLDivElement | null = null

  let channel = 'name'
  let emptyText = ''
  let prefix = ''
  let suffix = ''
  let fit: FitMode = 'shrink to fit'
  let minScalePct = 20
  let maxScalePct = 400
  let vAlign: VAlign = 'middle'
  let textAngle = 0
  let skewXDeg = 0
  let showArea = false
  let text: TextStyle
  let boxStyle: BoxStyle

  let value = ''
  let interactive = false
  let offChannel: (() => void) | null = null

  const s = (): number => ctx.scale?.() ?? 1

  /** What the box should read right now: the typed name, or the author's stand-in
   * when nothing has been typed — which is also what makes the element visible (and
   * therefore placeable) on the editor canvas before anyone has typed anything. */
  const display = (): string => {
    const raw = value || emptyText
    if (!raw) return ''
    return prefix + applyCase(raw, text.transform) + suffix
  }

  const render = (): void => {
    word.textContent = display()
    layout()
  }

  const layout = (): void => {
    const k = s()
    const w = ctx.root.clientWidth || 1
    const h = ctx.root.clientHeight || 1
    applyBoxStyle(box, boxStyle, w, h, k)
    const px = boxStyle.padXPx * k
    const py = boxStyle.padYPx * k
    const availW = Math.max(0, w - px * 2)
    const availH = Math.max(0, h - py * 2)
    pad.style.left = px.toFixed(1) + 'px'
    pad.style.right = px.toFixed(1) + 'px'
    pad.style.top = py.toFixed(1) + 'px'
    pad.style.bottom = py.toFixed(1) + 'px'
    pad.style.justifyContent = text.align === 'center' ? 'center' : text.align === 'right' ? 'flex-end' : 'flex-start'
    pad.style.alignItems = vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center'

    applyTextStyle(line, text, k)
    // Wrapping needs a width to wrap AT; a single-line fit must be measured with no
    // width limit at all or the measurement is the box, not the string.
    line.style.maxWidth = text.wrap ? availW.toFixed(1) + 'px' : ''

    line.style.transform = 'none'
    // Measured against the label's TURNED footprint, so a long name at an angle
    // shrinks to stay inside the area instead of running past its corners and being
    // clipped. Fitting the upright box and then rotating the result — which is what
    // this did first — gives the author no control over a long name at all.
    const f = fitScale(line, availW, availH, fit, minScalePct, maxScalePct, textAngle, skewXDeg)
    // Turned labels pivot about their own centre and are then nudged so that footprint
    // lands against the edge the author aligned to (centred, by default, in both axes).
    // A corner origin would swing the visible corners outside the area even at a scale
    // that fits.
    const spun = textAngle !== 0 || skewXDeg !== 0
    line.style.transformOrigin = spun ? 'center center' : (text.align === 'center' ? 'center' : text.align === 'right' ? 'right' : 'left') + ' ' + (vAlign === 'top' ? 'top' : vAlign === 'bottom' ? 'bottom' : 'center')
    const parts: string[] = []
    if (spun) {
      const off = fitOffset(line.offsetWidth || line.scrollWidth, line.offsetHeight || line.scrollHeight, f, textAngle, skewXDeg, text.align, vAlign)
      if (off.dx || off.dy) parts.push(`translate(${off.dx.toFixed(2)}px,${off.dy.toFixed(2)}px)`)
    }
    if (f !== 1) parts.push(`scale(${f.toFixed(4)})`)
    if (textAngle) parts.push(`rotate(${textAngle}deg)`)
    if (skewXDeg) parts.push(`skewX(${skewXDeg}deg)`)
    line.style.transform = parts.length ? parts.join(' ') : 'none'

    if (guide) {
      guide.style.display = showArea && !interactive ? '' : 'none'
      guide.style.borderWidth = Math.max(1, 2 * k).toFixed(1) + 'px'
    }
  }

  return {
    mount(c, params) {
      ctx = c
      const d = ctx.root.ownerDocument ?? document
      channel = str(params.channel, 'name').trim() || 'name'
      emptyText = str(params.emptyText, '')
      prefix = str(params.prefix, '')
      suffix = str(params.suffix, '')
      fit = str(params.fit, 'shrink to fit') as FitMode
      minScalePct = Math.max(1, Math.min(100, num(params.minScalePct, 20)))
      maxScalePct = Math.max(100, num(params.maxScalePct, 400))
      vAlign = str(params.vAlign, 'middle') as VAlign
      textAngle = num(params.textAngle, 0)
      skewXDeg = num(params.skewXDeg, 0)
      showArea = params.showArea === true
      text = readTextStyle(params, 'center')
      boxStyle = readBoxStyle(params)
      value = readName(channel)

      box = d.createElement('div')
      box.dataset.paNameResult = '1'
      box.style.cssText = 'position:absolute;inset:0;box-sizing:border-box;overflow:hidden;pointer-events:none;'
      ctx.root.appendChild(box)

      pad = d.createElement('div')
      pad.style.cssText = 'position:absolute;display:flex;overflow:visible;'
      box.appendChild(pad)

      line = d.createElement('div')
      line.dataset.paNameLine = '1'
      line.style.cssText = 'display:inline-block;will-change:transform;'
      pad.appendChild(line)

      word = d.createElement('span')
      line.appendChild(word)

      // A dashed outline of the area, drawn on the editor canvas only (`showArea` is
      // forced off the moment play starts). Placing lettering on a photographed patch
      // means judging an empty rectangle, and an author should not have to select the
      // element to see where its edges are.
      guide = d.createElement('div')
      guide.dataset.paNameGuide = '1'
      guide.style.cssText = 'position:absolute;inset:0;border:2px dashed rgba(29,44,224,.75);border-radius:inherit;display:none;pointer-events:none;'
      box.appendChild(guide)

      render()
    },

    start(): void {
      interactive = true
      // Live from the first keystroke: this is what makes the patch fill in as the
      // player types rather than when they finish.
      offChannel = onNameChange(channel, (v) => {
        value = v
        render()
      })
      render()
    },

    relayout(): void {
      layout()
    },

    /** Nothing to point a hand at — this box is a readout, not a move. */
    getHint: () => null,

    onComplete(): void {
      // A readout never wins. See nameinput.ts.
    },

    destroy(): void {
      offChannel?.()
      offChannel = null
      box.remove()
      interactive = false
    },
  }
}

export const NAMERESULT_TEMPLATE: GameTemplate = {
  id: 'nameresult',
  label: 'Name result (shows what was typed)',
  paramFields: [
    { key: 'channel', group: 'Name', label: 'Channel (must match the name box)', type: 'text' },
    { key: 'emptyText', group: 'Name', label: 'Shown before anything is typed', type: 'text' },
    { key: 'prefix', group: 'Name', label: 'Prefix', type: 'text' },
    { key: 'suffix', group: 'Name', label: 'Suffix', type: 'text' },
    ...textFields('Text'),
    { key: 'wrap', group: 'Text', label: 'Wrap onto more lines', type: 'boolean' },
    { key: 'fit', group: 'Area', label: 'Fit to the area', type: 'select', options: ['shrink to fit', 'fill the area', 'never resize'] },
    { key: 'minScalePct', group: 'Area', label: 'Shrink limit %', type: 'number', min: 1, max: 100, step: 5, showIf: (p) => str(p.fit, '') !== 'never resize' },
    { key: 'maxScalePct', group: 'Area', label: 'Grow limit %', type: 'number', min: 100, max: 1000, step: 10, showIf: (p) => str(p.fit, '') === 'fill the area' },
    { key: 'vAlign', group: 'Area', label: 'Vertical align', type: 'select', options: ['top', 'middle', 'bottom'] },
    { key: 'textAngle', group: 'Area', label: 'Turn the text only (Angle turns the area)', type: 'number', min: -180, max: 180, step: 1 },
    { key: 'skewXDeg', group: 'Area', label: 'Slant', type: 'number', min: -60, max: 60, step: 1 },
    { key: 'showArea', group: 'Area', label: 'Outline the area on the canvas', type: 'boolean' },
    ...boxFields('Area box'),
  ],
  defaultParams: {
    ...TEXT_DEFAULTS,
    ...BOX_DEFAULTS,
    channel: 'name',
    emptyText: 'NAME',
    prefix: '',
    suffix: '',
    fontSizePx: 64,
    fontWeight: 800,
    color: '#ffffff',
    align: 'center',
    textTransform: 'UPPERCASE',
    wrap: false,
    fit: 'shrink to fit',
    minScalePct: 20,
    maxScalePct: 400,
    vAlign: 'middle',
    textAngle: 0,
    skewXDeg: 0,
    // Off by default: the outline is a placement aid, and scene thumbnails and the
    // flow preview are non-interactive too — they should not all sprout dashed boxes.
    showArea: false,
  },
  create: createNameResult,
}
