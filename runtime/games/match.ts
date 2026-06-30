// Match game: drag each item onto its matching target. Each "pair" has an
// identity; if a custom image is assigned (params.images[i]) the item shows that
// image and the target shows a faded "ghost" of it, otherwise a coloured
// circle/ring. The hint knows the pairing (first unmatched item -> its target).

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']

interface Pair {
  id: number
  color: string
  img: string // src or ''
}
interface Cell {
  el: HTMLDivElement
  pairId: number
  cx: number
  cy: number
}

function centerOf(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createMatch(): GameModule {
  let ctx: GameContext
  let count = 4
  const pairs: Pair[] = []
  const slots: Cell[] = []
  const tokens: (Cell & { matched: boolean })[] = []
  let size = 60
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const pairOf = (id: number): Pair => pairs[id]

  const style = (el: HTMLDivElement, p: Pair, ghost: boolean): void => {
    if (p.img) {
      el.style.background = `center/contain no-repeat url("${p.img}")`
      el.style.border = ghost ? '3px dashed rgba(255,255,255,.5)' : 'none'
      el.style.opacity = ghost ? '0.5' : '1'
      el.style.borderRadius = '12px'
    } else {
      el.style.background = ghost ? 'transparent' : p.color
      el.style.border = ghost ? `4px dashed ${p.color}` : 'none'
      el.style.opacity = ghost ? '0.85' : '1'
      el.style.borderRadius = '50%'
    }
  }

  const place = (el: HTMLElement, cx: number, cy: number, sz: number): void => {
    el.style.width = sz + 'px'
    el.style.height = sz + 'px'
    el.style.left = cx - sz / 2 + 'px'
    el.style.top = cy - sz / 2 + 'px'
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    size = Math.max(28, Math.min((w / count) * 0.62, h * 0.16))
    const step = w / (count + 1)
    slots.forEach((s, i) => {
      s.cx = step * (i + 1)
      s.cy = h * 0.2
      place(s.el, s.cx, s.cy, size)
    })
    tokens.forEach((t, i) => {
      if (t.matched) {
        const slot = slots.find((s) => s.pairId === t.pairId)!
        t.cx = slot.cx
        t.cy = slot.cy
      } else {
        t.cx = step * (i + 1)
        t.cy = h * 0.8
      }
      place(t.el, t.cx, t.cy, size)
    })
  }

  const checkWin = (): void => {
    if (!done && tokens.every((t) => t.matched)) {
      done = true
      completeCb?.()
    }
  }

  const attachDrag = (t: (typeof tokens)[number]): void => {
    t.el.style.cursor = 'grab'
    t.el.addEventListener('pointerdown', (e) => {
      if (t.matched || done) return
      e.preventDefault()
      t.el.setPointerCapture(e.pointerId)
      t.el.style.zIndex = '10'
      const rootR = ctx.root.getBoundingClientRect()
      const move = (ev: PointerEvent): void => {
        t.cx = ev.clientX - rootR.left
        t.cy = ev.clientY - rootR.top
        place(t.el, t.cx, t.cy, size)
      }
      const up = (): void => {
        t.el.removeEventListener('pointermove', move)
        t.el.removeEventListener('pointerup', up)
        t.el.style.zIndex = ''
        const target = slots.find((s) => s.pairId === t.pairId)!
        if (Math.hypot(t.cx - target.cx, t.cy - target.cy) < size * 0.95) {
          t.matched = true
          place(t.el, target.cx, target.cy, size)
          t.el.style.opacity = '1'
          t.el.style.cursor = 'default'
          t.el.style.boxShadow = '0 0 0 4px rgba(255,255,255,.5)'
          ctx.sfx.play('correct')
          checkWin()
        } else {
          ctx.sfx.play('wrong')
          layout()
        }
      }
      t.el.addEventListener('pointermove', move)
      t.el.addEventListener('pointerup', up)
    })
  }

  return {
    mount(c, params) {
      ctx = c
      count = Math.max(2, Math.min(6, num(params.count, 4)))
      ctx.root.style.touchAction = 'none'
      const images = Array.isArray(params.images) ? (params.images as string[]) : []
      for (let i = 0; i < count; i++) {
        pairs.push({ id: i, color: PALETTE[i % PALETTE.length], img: images[i] ? ctx.assets.src(images[i]) : '' })
      }
      // slots in order
      for (let i = 0; i < count; i++) {
        const el = document.createElement('div')
        el.style.cssText = 'position:absolute;box-sizing:border-box;'
        style(el, pairOf(i), true)
        ctx.root.appendChild(el)
        slots.push({ el, pairId: i, cx: 0, cy: 0 })
      }
      // tokens shuffled
      const order = pairs.map((p) => p.id)
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.rng() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      for (const pid of order) {
        const el = document.createElement('div')
        el.style.cssText = 'position:absolute;box-sizing:border-box;box-shadow:0 4px 10px rgba(0,0,0,.3);'
        style(el, pairOf(pid), false)
        ctx.root.appendChild(el)
        tokens.push({ el, pairId: pid, matched: false, cx: 0, cy: 0 })
      }
      layout()
    },
    start() {
      if (started) return
      started = true
      tokens.forEach(attachDrag)
    },
    relayout: layout,
    getHint(): HintMove | null {
      const t = tokens.find((x) => !x.matched)
      if (!t) return null
      const slot = slots.find((s) => s.pairId === t.pairId)!
      return { from: centerOf(t.el), to: centerOf(slot.el), kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
      pairs.length = 0
      slots.length = 0
      tokens.length = 0
    },
  }
}

export const MATCH_TEMPLATE: GameTemplate = {
  id: 'match',
  label: 'Match (drag to slot)',
  paramFields: [{ key: 'count', label: 'Pairs', type: 'number', min: 2, max: 6, step: 1 }],
  assetSlots: [{ key: 'images', label: 'Item image', list: true, countParam: 'count' }],
  defaultParams: { count: 4, images: [] },
  // Drag a token up from the bottom row (cy~0.8) to its matching slot in the top row (cy~0.2).
  defaultHandguide: {
    nodes: [
      { x: 0.2, y: 0.8 },
      { x: 0.4, y: 0.2 },
    ],
    periodMs: 1700,
  },
  create: createMatch,
}
