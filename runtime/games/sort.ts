// Sort: drag each item into its matching category bin (sort products into boxes /
// by colour). N bins across the top, the items shuffled in a pile below. Each
// category has a colour and an optional image (shared by its bin + items). Win
// when every item is sorted. Hint: first unsorted item → its bin.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']

interface Bin {
  el: HTMLDivElement
  cat: number
  cx: number
  cy: number
}
interface Item {
  el: HTMLDivElement
  cat: number
  sorted: boolean
  cx: number
  cy: number
}

function centerOf(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createSort(): GameModule {
  let ctx: GameContext
  let bins = 3
  let perBin = 2
  let binImgs: string[] = []
  let itemImgs: string[] = []
  let size = 70
  const binEls: Bin[] = []
  const items: Item[] = []
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const place = (el: HTMLElement, cx: number, cy: number, sz: number): void => {
    el.style.width = sz + 'px'
    el.style.height = sz + 'px'
    el.style.left = cx - sz / 2 + 'px'
    el.style.top = cy - sz / 2 + 'px'
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    size = Math.max(34, Math.min((w / Math.max(bins, perBin + 1)) * 0.7, h * 0.16))
    const binStep = w / (bins + 1)
    const binSz = Math.min(size * 1.3, binStep * 0.82)
    binEls.forEach((b, i) => {
      b.cx = binStep * (i + 1)
      b.cy = h * 0.2
      place(b.el, b.cx, b.cy, binSz)
    })
    const cols = Math.min(items.length, Math.max(3, Math.ceil(items.length / 2)))
    const step = w / (cols + 1)
    let placed = 0
    items.forEach((it) => {
      if (it.sorted) {
        const bin = binEls.find((b) => b.cat === it.cat)!
        it.cx = bin.cx
        it.cy = bin.cy
      } else {
        const col = placed % cols
        const row = Math.floor(placed / cols)
        it.cx = step * (col + 1)
        it.cy = h * 0.68 + row * (size * 1.2)
        placed++
      }
      place(it.el, it.cx, it.cy, size)
    })
  }

  const checkWin = (): void => {
    if (!done && items.every((i) => i.sorted)) {
      done = true
      completeCb?.()
    }
  }

  const paint = (el: HTMLDivElement, cat: number, img: string, bin: boolean): void => {
    if (img) {
      el.style.background = `center/contain no-repeat url("${img}")`
      el.style.borderRadius = bin ? '16px' : '50%'
      el.style.border = bin ? `3px dashed ${PALETTE[cat % PALETTE.length]}` : 'none'
      el.style.opacity = bin ? '0.7' : '1'
    } else if (bin) {
      el.style.background = 'transparent'
      el.style.border = `4px dashed ${PALETTE[cat % PALETTE.length]}`
      el.style.borderRadius = '16px'
    } else {
      el.style.background = PALETTE[cat % PALETTE.length]
      el.style.borderRadius = '50%'
    }
  }

  const attachDrag = (it: Item): void => {
    it.el.style.cursor = 'grab'
    it.el.addEventListener('pointerdown', (e) => {
      if (it.sorted || done) return
      e.preventDefault()
      it.el.setPointerCapture(e.pointerId)
      it.el.style.zIndex = '10'
      const rootR = ctx.root.getBoundingClientRect()
      const move = (ev: PointerEvent): void => {
        it.cx = ev.clientX - rootR.left
        it.cy = ev.clientY - rootR.top
        place(it.el, it.cx, it.cy, size)
      }
      const up = (): void => {
        it.el.removeEventListener('pointermove', move)
        it.el.removeEventListener('pointerup', up)
        it.el.style.zIndex = ''
        const bin = binEls.find((b) => b.cat === it.cat)!
        if (Math.hypot(it.cx - bin.cx, it.cy - bin.cy) < size) {
          it.sorted = true
          it.el.style.cursor = 'default'
          it.el.style.boxShadow = '0 0 0 3px rgba(255,255,255,.5)'
          ctx.sfx.play('correct')
          layout()
          checkWin()
        } else {
          ctx.sfx.play('wrong')
          layout()
        }
      }
      it.el.addEventListener('pointermove', move)
      it.el.addEventListener('pointerup', up)
    })
  }

  return {
    mount(c, params) {
      ctx = c
      bins = Math.max(2, Math.min(4, num(params.bins, 3)))
      perBin = Math.max(1, Math.min(4, num(params.perBin, 2)))
      binImgs = (Array.isArray(params.binImages) ? (params.binImages as string[]) : []).map((id) => (id ? ctx.assets.src(id) : ''))
      itemImgs = (Array.isArray(params.itemImages) ? (params.itemImages as string[]) : []).map((id) => (id ? ctx.assets.src(id) : ''))
      ctx.root.style.touchAction = 'none'

      for (let i = 0; i < bins; i++) {
        const el = document.createElement('div')
        el.style.cssText = 'position:absolute;box-sizing:border-box;'
        paint(el, i, binImgs[i] || '', true)
        ctx.root.appendChild(el)
        binEls.push({ el, cat: i, cx: 0, cy: 0 })
      }
      const cats: number[] = []
      for (let i = 0; i < bins; i++) for (let k = 0; k < perBin; k++) cats.push(i)
      for (let i = cats.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.rng() * (i + 1))
        ;[cats[i], cats[j]] = [cats[j], cats[i]]
      }
      for (const cat of cats) {
        const el = document.createElement('div')
        el.style.cssText = 'position:absolute;box-sizing:border-box;box-shadow:0 4px 10px rgba(0,0,0,.3);'
        paint(el, cat, itemImgs[cat] || '', false)
        ctx.root.appendChild(el)
        items.push({ el, cat, sorted: false, cx: 0, cy: 0 })
      }
      layout()
    },
    start() {
      if (started) return
      started = true
      items.forEach(attachDrag)
    },
    relayout: layout,
    getHint(): HintMove | null {
      const it = items.find((i) => !i.sorted)
      if (!it) return null
      const bin = binEls.find((b) => b.cat === it.cat)!
      return { from: centerOf(it.el), to: centerOf(bin.el), kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
      binEls.length = 0
      items.length = 0
    },
  }
}

export const SORT_TEMPLATE: GameTemplate = {
  id: 'sort',
  label: 'Sort into bins',
  paramFields: [
    { key: 'bins', label: 'Categories', type: 'number', min: 2, max: 4, step: 1 },
    { key: 'perBin', label: 'Items per category', type: 'number', min: 1, max: 4, step: 1 },
  ],
  assetSlots: [
    { key: 'binImages', label: 'Bin image', list: true, countParam: 'bins' },
    { key: 'itemImages', label: 'Item image', list: true, countParam: 'bins' },
  ],
  defaultParams: { bins: 3, perBin: 2, binImages: [], itemImages: [] },
  create: createSort,
}
