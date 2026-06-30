// Vending machine: a grid of products behind the glass and a "wanted" product on
// the display — tap the matching slot to dispense it and win. A wrong pick just
// shakes. Hint: tap the wanted product's slot.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#f97316']

interface Slot {
  el: HTMLDivElement
  idx: number
}

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createVending(): GameModule {
  let ctx: GameContext
  let count = 6
  let cols = 3
  let targetIdx = 0
  let imgs: string[] = []
  let want: HTMLDivElement
  const slots: Slot[] = []
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const fill = (el: HTMLElement, i: number): void => {
    if (imgs[i]) el.style.background = `center/contain no-repeat url("${imgs[i]}")`
    else {
      el.style.background = PALETTE[i % PALETTE.length]
      el.textContent = String(i + 1)
    }
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const tsz = Math.min(w * 0.22, h * 0.14)
    want.style.width = tsz + 'px'
    want.style.height = tsz + 'px'
    want.style.left = (w - tsz) / 2 + 'px'
    want.style.top = h * 0.08 + 'px'
    const rows = Math.ceil(count / cols)
    const gap = w * 0.04
    const gridTop = h * 0.34
    const sz = Math.min((w - gap * (cols + 1)) / cols, ((h - gridTop) - gap * (rows + 1)) / rows)
    const gw = sz * cols + gap * (cols - 1)
    const x0 = (w - gw) / 2
    slots.forEach((s, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      s.el.style.width = sz + 'px'
      s.el.style.height = sz + 'px'
      s.el.style.left = x0 + c * (sz + gap) + 'px'
      s.el.style.top = gridTop + r * (sz + gap) + 'px'
      s.el.style.fontSize = sz * 0.34 + 'px'
    })
  }

  const pick = (s: Slot): void => {
    if (done) return
    if (s.idx === targetIdx) {
      done = true
      s.el.style.transform = 'scale(1.12)'
      s.el.style.boxShadow = '0 0 0 4px #fff, 0 0 26px 4px rgba(255,211,77,.8)'
      ctx.sfx.play('gameWin')
      window.setTimeout(() => completeCb?.(), 250)
    } else {
      ctx.sfx.play('wrong')
      s.el.style.transform = 'translateX(-5px)'
      window.setTimeout(() => (s.el.style.transform = 'translateX(5px)'), 70)
      window.setTimeout(() => (s.el.style.transform = 'translateX(0)'), 140)
    }
  }

  return {
    mount(c, params) {
      ctx = c
      count = Math.max(4, Math.min(9, num(params.count, 6)))
      cols = count <= 4 ? 2 : 3
      imgs = (Array.isArray(params.productImages) ? (params.productImages as string[]) : []).map((id) => (id ? ctx.assets.src(id) : ''))
      targetIdx = Math.max(0, Math.min(count - 1, Math.floor(num(params.target, Math.floor(c.rng() * count)))))
      ctx.root.style.touchAction = 'none'

      const banner = document.createElement('div')
      banner.style.cssText = 'position:absolute;left:0;top:2%;width:100%;text-align:center;color:#fff;font-weight:800;pointer-events:none;'
      banner.textContent = 'Tap to dispense:'
      ctx.root.appendChild(banner)

      want = document.createElement('div')
      want.style.cssText = 'position:absolute;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;box-shadow:0 0 0 3px #ffd34d,0 4px 10px rgba(0,0,0,.4);'
      fill(want, targetIdx)
      ctx.root.appendChild(want)

      for (let i = 0; i < count; i++) {
        const el = document.createElement('div')
        el.style.cssText =
          'position:absolute;box-sizing:border-box;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;cursor:pointer;transition:transform .1s,box-shadow .2s;box-shadow:0 4px 10px rgba(0,0,0,.3);border:2px solid rgba(255,255,255,.12);'
        fill(el, i)
        ctx.root.appendChild(el)
        slots.push({ el, idx: i })
      }
      layout()
    },
    start() {
      if (started) return
      started = true
      slots.forEach((s) => s.el.addEventListener('pointerdown', () => pick(s)))
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      const p = center(slots[targetIdx].el)
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
      slots.length = 0
    },
  }
}

export const VENDING_TEMPLATE: GameTemplate = {
  id: 'vending',
  label: 'Vending machine (pick the product)',
  paramFields: [
    { key: 'count', label: 'Products', type: 'number', min: 4, max: 9, step: 1 },
    { key: 'target', label: 'Wanted product index', type: 'number', min: 0, max: 8, step: 1 },
  ],
  assetSlots: [{ key: 'productImages', label: 'Product image', list: true, countParam: 'count' }],
  defaultParams: { count: 6, target: 0, productImages: [] },
  // Tap a product slot in the grid (grid starts at ~0.34 height, first slot upper-left).
  defaultHandguide: {
    nodes: [{ x: 0.32, y: 0.44 }],
  },
  create: createVending,
}
