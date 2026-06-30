// Merge: drag one item onto another of the SAME tier to combine them into the
// next tier. Reach the goal tier to win. Board starts with exactly enough tier-0
// items to chain up to the goal (2^goalTier of them), so it's always winnable.
// Each tier shows a custom image (or a coloured token with its value). Hint:
// slide one item of the lowest doubled tier onto its twin.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

const PALETTE = ['#64748b', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7']

interface Item {
  el: HTMLDivElement
  tier: number
  alive: boolean
  cx: number
  cy: number
}

function centerOf(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createMerge(): GameModule {
  let ctx: GameContext
  let goalTier = 2
  let tierImgs: string[] = []
  let goalImg = ''
  let size = 80
  let cols = 3
  const items: Item[] = []
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const alive = (): Item[] => items.filter((i) => i.alive)

  const place = (el: HTMLElement, cx: number, cy: number, sz: number): void => {
    el.style.width = sz + 'px'
    el.style.height = sz + 'px'
    el.style.left = cx - sz / 2 + 'px'
    el.style.top = cy - sz / 2 + 'px'
  }

  const paint = (it: Item): void => {
    const img = it.tier >= goalTier ? goalImg || tierImgs[it.tier] : tierImgs[it.tier]
    if (img) {
      it.el.style.background = `center/contain no-repeat url("${img}")`
      it.el.textContent = ''
      it.el.style.borderRadius = '16px'
    } else {
      it.el.style.background = PALETTE[it.tier % PALETTE.length]
      it.el.style.borderRadius = '50%'
      it.el.textContent = String(Math.pow(2, it.tier + 1))
    }
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const live = alive()
    cols = Math.min(live.length, Math.max(2, Math.ceil(Math.sqrt(live.length))))
    const rows = Math.max(1, Math.ceil(live.length / cols))
    size = Math.max(40, Math.min((w / (cols + 0.5)) * 0.78, (h / (rows + 0.5)) * 0.78))
    const stepX = w / (cols + 1)
    const stepY = h / (rows + 1)
    live.forEach((it, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      it.cx = stepX * (c + 1)
      it.cy = stepY * (r + 1)
      it.el.style.fontSize = size * 0.34 + 'px'
      place(it.el, it.cx, it.cy, size)
    })
  }

  const checkWin = (): void => {
    if (!done && items.some((i) => i.alive && i.tier >= goalTier)) {
      done = true
      completeCb?.()
    }
  }

  const merge = (src: Item, dst: Item): void => {
    dst.tier++
    src.alive = false
    src.el.remove()
    paint(dst)
    dst.el.style.transform = 'scale(1.18)'
    window.setTimeout(() => (dst.el.style.transform = 'scale(1)'), 130)
    ctx.sfx.play('correct')
    layout()
    checkWin()
  }

  const attachDrag = (it: Item): void => {
    it.el.style.cursor = 'grab'
    it.el.addEventListener('pointerdown', (e) => {
      if (!it.alive || done) return
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
        const target = alive()
          .filter((o) => o !== it)
          .sort((a, b) => Math.hypot(it.cx - a.cx, it.cy - a.cy) - Math.hypot(it.cx - b.cx, it.cy - b.cy))[0]
        if (target && Math.hypot(it.cx - target.cx, it.cy - target.cy) < size * 0.9 && target.tier === it.tier) {
          merge(it, target)
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
      goalTier = Math.max(1, Math.min(4, num(params.goalTier, 2)))
      tierImgs = (Array.isArray(params.tierImages) ? (params.tierImages as string[]) : []).map((id) => (id ? ctx.assets.src(id) : ''))
      goalImg = ctx.assets.src(params.goalImage as string)
      ctx.root.style.touchAction = 'none'
      const n = Math.pow(2, goalTier) // exactly enough tier-0 items to reach the goal
      for (let i = 0; i < n; i++) {
        const el = document.createElement('div')
        el.style.cssText =
          'position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;box-shadow:0 4px 10px rgba(0,0,0,.3);transition:transform .12s;'
        const it: Item = { el, tier: 0, alive: true, cx: 0, cy: 0 }
        paint(it)
        ctx.root.appendChild(el)
        items.push(it)
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
      const live = alive()
      for (let t = 0; t <= goalTier; t++) {
        const sameTier = live.filter((i) => i.tier === t)
        if (sameTier.length >= 2) return { from: centerOf(sameTier[0].el), to: centerOf(sameTier[1].el), kind: 'slide' }
      }
      return null
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
      items.length = 0
    },
  }
}

export const MERGE_TEMPLATE: GameTemplate = {
  id: 'merge',
  label: 'Merge (combine to upgrade)',
  paramFields: [{ key: 'goalTier', label: 'Goal tier (levels to win)', type: 'number', min: 1, max: 4, step: 1 }],
  assetSlots: [
    { key: 'tierImages', label: 'Lower-tier image', list: true, countParam: 'goalTier' },
    { key: 'goalImage', label: 'Final reward image' },
  ],
  defaultParams: { goalTier: 2, tierImages: [], goalImage: '' },
  // Drag one tier-0 item onto its twin to combine (across the top row of the 2x2 grid).
  defaultHandguide: {
    nodes: [
      { x: 0.33, y: 0.33 },
      { x: 0.66, y: 0.33 },
    ],
    periodMs: 1700,
  },
  create: createMerge,
}
