// Swipe: a tinder-style card stack. Drag the top card past a threshold to fling
// it away (left = pass, right = like); the next card surfaces. Clear the whole
// stack to win. Hint: swipe the top card to the right.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']

interface Card {
  el: HTMLDivElement
  idx: number
  gone: boolean
}

export function createSwipe(): GameModule {
  let ctx: GameContext
  let count = 4
  let imgs: string[] = []
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
    const rem = remaining()
    rem.forEach((c, depth) => {
      c.el.style.width = cw + 'px'
      c.el.style.height = ch + 'px'
      c.el.style.left = left + 'px'
      c.el.style.top = top + 'px'
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
      count = Math.max(2, Math.min(8, num(params.count, 4)))
      imgs = (Array.isArray(params.images) ? (params.images as string[]) : []).map((id) => (id ? ctx.assets.src(id) : ''))
      ctx.root.style.touchAction = 'none'
      for (let i = 0; i < count; i++) {
        const el = document.createElement('div')
        el.style.cssText =
          'position:absolute;box-sizing:border-box;border-radius:18px;cursor:grab;box-shadow:0 8px 24px rgba(0,0,0,.4);display:flex;align-items:flex-end;justify-content:center;color:#fff;font-weight:800;font-size:24px;padding-bottom:18px;'
        el.style.background = imgs[i] ? `center/cover no-repeat url("${imgs[i]}")` : `linear-gradient(160deg, ${PALETTE[i % PALETTE.length]}, #0008)`
        if (!imgs[i]) el.textContent = 'Card ' + (i + 1)
        ctx.root.appendChild(el)
        cards.push({ el, idx: i, gone: false })
      }
      layout()
    },
    start() {
      if (started) return
      started = true
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
      ctx.root.innerHTML = ''
      cards.length = 0
    },
  }
}

export const SWIPE_TEMPLATE: GameTemplate = {
  id: 'swipe',
  label: 'Swipe cards (like / pass)',
  paramFields: [{ key: 'count', label: 'Cards', type: 'number', min: 2, max: 8, step: 1 }],
  assetSlots: [{ key: 'images', label: 'Card image', list: true, countParam: 'count' }],
  defaultParams: { count: 4, images: [] },
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
