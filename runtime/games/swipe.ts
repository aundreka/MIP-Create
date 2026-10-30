// Swipe: a tinder-style card stack. Drag the top card past a threshold to fling
// it away (left = pass, right = like); the next card surfaces. Clear the whole
// stack to win. Hint: swipe the top card to the right.
//
// Each card shows an uploaded image (`images[i]`) or, when `cardElements[i]` names one,
// a copy of an element already placed on this screen — that element is hidden in play,
// so it reads as having become the card. Either way the picture is fitted into the card
// by `fit` (contain by default, so nothing is cropped). The card itself has no chrome
// unless the author gives it some: radius, shadow, border and fill are all params.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num, str } from './types'
import { COMBO_OFF_CLASS } from './combo'

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']

type Fit = 'contain' | 'cover' | 'fill'

interface Card {
  el: HTMLDivElement
  idx: number
  gone: boolean
  /** The placed element this card copies, hidden while the game plays. */
  source: HTMLElement | null
  /** The copy of `source`, sized to it and scaled into the card on every layout. */
  copy: HTMLElement | null
}

function shadowCss(kind: string, s: number): string {
  if (kind === 'soft') return `0 ${4 * s}px ${12 * s}px rgba(0,0,0,.28)`
  if (kind === 'medium') return `0 ${8 * s}px ${22 * s}px rgba(0,0,0,.4)`
  if (kind === 'strong') return `0 ${14 * s}px ${40 * s}px rgba(0,0,0,.55)`
  return ''
}

/** A still copy of a placed element's visible content, with none of its live motion. */
function copyOf(source: HTMLElement): HTMLElement {
  const inner = source.querySelector<HTMLElement>('.pa-el-anim') ?? source
  const copy = inner.cloneNode(true) as HTMLElement
  copy.classList.remove('pa-el-anim')
  for (const p of ['opacity', 'transform', 'translate', 'rotate', 'scale', 'animation', 'transition', 'filter']) copy.style.removeProperty(p)
  copy.style.position = 'absolute'
  copy.style.left = '50%'
  copy.style.top = '50%'
  copy.style.transformOrigin = 'center center'
  copy.style.pointerEvents = 'none'
  return copy
}

export function createSwipe(): GameModule {
  let ctx: GameContext
  let count = 4
  let imgs: string[] = []
  let elementIds: string[] = []
  let fit: Fit = 'contain'
  let radiusPx = 0
  let shadow = 'none'
  let borderPx = 0
  let borderColor = '#ffffff'
  let cardBg = ''
  let rootOverflow = ''
  let cw = 240
  let ch = 320
  const cards: Card[] = []
  let swiped = 0
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const remaining = (): Card[] => cards.filter((c) => !c.gone)

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    cw = Math.min(w * 0.74, h * 0.6)
    ch = cw * 1.3
    const left = (w - cw) / 2
    const top = (h - ch) / 2
    const k = ctx.scale?.() ?? 1
    const rem = remaining()
    rem.forEach((c, depth) => {
      c.el.style.width = cw + 'px'
      c.el.style.height = ch + 'px'
      c.el.style.left = left + 'px'
      c.el.style.top = top + 'px'
      c.el.style.borderRadius = radiusPx > 0 ? radiusPx * k + 'px' : ''
      c.el.style.boxShadow = shadowCss(shadow, k)
      c.el.style.border = borderPx > 0 ? `${borderPx * k}px solid ${borderColor}` : ''
      if (c.copy && c.source) fitCopy(c)
      c.el.style.zIndex = String(100 - depth)
      if (depth === 0) {
        c.el.style.transform = 'translate(0,0) rotate(0deg)'
        c.el.style.pointerEvents = 'auto'
      } else {
        const s = 1 - Math.min(depth, 3) * 0.05
        c.el.style.transform = `translateY(${Math.min(depth, 3) * 14}px) scale(${s})`
        c.el.style.pointerEvents = 'none'
      }
    })
  }

  /** Scale the element copy into the card's inner box by `fit`, centred. */
  const fitCopy = (c: Card): void => {
    const copy = c.copy!
    const src = c.source!
    const w = parseFloat(src.style.width) || src.offsetWidth || 1
    const h = parseFloat(src.style.height) || src.offsetHeight || 1
    const inset = borderPx > 0 ? 2 * borderPx * (ctx.scale?.() ?? 1) : 0
    const bw = Math.max(1, cw - inset)
    const bh = Math.max(1, ch - inset)
    let sx = bw / w
    let sy = bh / h
    if (fit === 'contain') sx = sy = Math.min(sx, sy)
    else if (fit === 'cover') sx = sy = Math.max(sx, sy)
    copy.style.width = w + 'px'
    copy.style.height = h + 'px'
    copy.style.transform = `translate(-50%,-50%) scale(${sx.toFixed(4)},${sy.toFixed(4)})`
  }

  const fling = (c: Card, dir: number): void => {
    c.gone = true
    c.el.style.transition = 'transform .35s ease, opacity .35s ease'
    c.el.style.transform = `translate(${dir * 900}px,40px) rotate(${dir * 22}deg)`
    c.el.style.opacity = '0'
    window.setTimeout(() => c.el.remove(), 360)
    swiped++
    ctx.sfx.play(dir > 0 ? 'correct' : 'tap')
    if (swiped >= count && !done) {
      done = true
      ctx.sfx.play('gameWin')
      completeCb?.()
    } else {
      layout()
    }
  }

  const attach = (c: Card): void => {
    c.el.addEventListener('pointerdown', (e) => {
      if (done || c.gone || remaining()[0] !== c) return
      e.preventDefault()
      c.el.setPointerCapture(e.pointerId)
      c.el.style.transition = 'none'
      const sx = e.clientX
      const sy = e.clientY
      let dx = 0
      const move = (ev: PointerEvent): void => {
        dx = ev.clientX - sx
        const dy = ev.clientY - sy
        c.el.style.transform = `translate(${dx}px,${dy}px) rotate(${dx * 0.05}deg)`
      }
      const up = (): void => {
        c.el.removeEventListener('pointermove', move)
        c.el.removeEventListener('pointerup', up)
        if (Math.abs(dx) > cw * 0.4) fling(c, dx > 0 ? 1 : -1)
        else {
          c.el.style.transition = 'transform .2s ease'
          c.el.style.transform = 'translate(0,0) rotate(0deg)'
        }
      }
      c.el.addEventListener('pointermove', move)
      c.el.addEventListener('pointerup', up)
    })
  }

  return {
    mount(c, params) {
      ctx = c
      count = Math.max(1, Math.min(8, num(params.count, 4)))
      imgs = (Array.isArray(params.images) ? (params.images as string[]) : []).map((id) => (id ? ctx.assets.src(id) : ''))
      elementIds = Array.isArray(params.cardElements) ? (params.cardElements as unknown[]).map((id) => str(id, '')) : []
      const f = str(params.fit, 'contain')
      fit = f === 'cover' || f === 'fill' ? f : 'contain'
      radiusPx = Math.max(0, num(params.cardRadius, 0))
      shadow = str(params.cardShadow, 'none')
      borderPx = Math.max(0, num(params.cardBorder, 0))
      borderColor = str(params.cardBorderColor, '') || '#ffffff'
      cardBg = str(params.cardBg, '')
      ctx.root.style.touchAction = 'none'
      // A dragged or flung card travels well past the game box; clipping it there cuts the
      // card off mid-swipe. The stage itself still clips at the screen edge.
      rootOverflow = ctx.root.style.overflow
      ctx.root.style.overflow = 'visible'
      const stageRoot = ctx.root.closest('.pa-root')
      const shell = ctx.root.closest('.pa-el')
      for (let i = 0; i < count; i++) {
        const el = document.createElement('div')
        el.style.cssText = 'position:absolute;box-sizing:border-box;overflow:hidden;cursor:grab;'
        const id = elementIds[i]
        const found = id && stageRoot ? Array.from(stageRoot.querySelectorAll<HTMLElement>('.pa-el')).find((e) => e.dataset.id === id) : undefined
        const source = found && found !== shell ? found : null
        let copy: HTMLElement | null = null
        if (source) {
          copy = copyOf(source)
          el.appendChild(copy)
        } else if (imgs[i]) {
          const img = document.createElement('img')
          img.src = imgs[i]
          img.alt = ''
          img.draggable = false
          img.style.cssText = `display:block;width:100%;height:100%;object-fit:${fit};pointer-events:none;`
          el.appendChild(img)
        }
        if (cardBg) el.style.background = cardBg
        if (!source && !imgs[i]) {
          // Nothing assigned yet: a labelled swatch, so the empty slot is visible.
          el.style.cssText += 'display:flex;align-items:flex-end;justify-content:center;color:#fff;font-weight:800;font-size:24px;padding-bottom:18px;'
          el.style.background = `linear-gradient(160deg, ${PALETTE[i % PALETTE.length]}, #0008)`
          el.textContent = 'Card ' + (i + 1)
        }
        ctx.root.appendChild(el)
        cards.push({ el, idx: i, gone: false, source, copy })
      }
      layout()
    },
    start() {
      if (started) return
      started = true
      // The placed element now lives on as its card; the original would show twice.
      for (const c of cards) c.source?.classList.add(COMBO_OFF_CLASS)
      cards.forEach(attach)
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      const top = remaining()[0]
      if (!top) return null
      const r = top.el.getBoundingClientRect()
      const from: Pt = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      return { from, to: { x: from.x + r.width, y: from.y }, kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      if (started) for (const c of cards) c.source?.classList.remove(COMBO_OFF_CLASS)
      started = false
      ctx.root.innerHTML = ''
      ctx.root.style.overflow = rootOverflow
      cards.length = 0
    },
  }
}

export const SWIPE_TEMPLATE: GameTemplate = {
  id: 'swipe',
  label: 'Swipe cards (like / pass)',
  paramFields: [
    { key: 'count', label: 'Cards', type: 'number', min: 1, max: 8, step: 1 },
    { key: 'fit', label: 'Picture in the card', type: 'select', options: ['contain', 'cover', 'fill'], group: 'Card style' },
    { key: 'cardRadius', label: 'Corner radius', type: 'number', min: 0, max: 200, step: 1, suffix: 'px', group: 'Card style' },
    { key: 'cardShadow', label: 'Shadow', type: 'select', options: ['none', 'soft', 'medium', 'strong'], group: 'Card style' },
    { key: 'cardBorder', label: 'Border', type: 'number', min: 0, max: 40, step: 1, suffix: 'px', group: 'Card style' },
    { key: 'cardBorderColor', label: 'Border colour', type: 'color', group: 'Card style', showIf: (p) => Number(p.cardBorder ?? 0) > 0 },
    { key: 'cardBg', label: 'Card fill', type: 'color', group: 'Card style' },
  ],
  // Each card is cardElements[i] when set (an element on this screen), else images[i].
  assetSlots: [{ key: 'images', label: 'Card image', list: true, countParam: 'count' }],
  // 'contain' fits the whole picture in the card; no chrome until the author adds it.
  defaultParams: { count: 4, images: [], cardElements: [], fit: 'contain', cardRadius: 0, cardShadow: 'none', cardBorder: 0, cardBorderColor: '#ffffff', cardBg: '' },
  // Slide left→right across the centered card (right swipe = like/fling).
  defaultHandguide: {
    nodes: [
      { x: 0.35, y: 0.5 },
      { x: 0.74, y: 0.5 },
    ],
    periodMs: 1700,
  },
  create: createSwipe,
}
