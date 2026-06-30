// Recipe / ingredients: tap the ingredient icons to fill the recipe and reveal
// the product (the "combine into an equation" mechanic). N ghost slots up top, a
// dim product in the middle, and a shuffled tray of ingredients below. Tapping an
// ingredient fills its slot; fill them all and the product is revealed → win.
// Hint: tap the next needed ingredient in the tray.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']

interface Slot {
  el: HTMLDivElement
  ing: number
  filled: boolean
}
interface Tray {
  el: HTMLDivElement
  ing: number
  used: boolean
}

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createRecipe(): GameModule {
  let ctx: GameContext
  let count = 3
  let ingImgs: string[] = []
  let product: HTMLDivElement
  const slots: Slot[] = []
  const tray: Tray[] = []
  let filled = 0
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const bg = (ing: number, ghost: boolean): string => {
    const img = ingImgs[ing]
    if (img) return `center/contain no-repeat url("${img}")`
    return PALETTE[ing % PALETTE.length] + (ghost ? '55' : '')
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const ssz = Math.max(40, Math.min((w / (count + 1)) * 0.8, h * 0.13))
    const step = w / (count + 1)
    slots.forEach((s, i) => {
      s.el.style.width = ssz + 'px'
      s.el.style.height = ssz + 'px'
      s.el.style.left = step * (i + 1) - ssz / 2 + 'px'
      s.el.style.top = h * 0.16 - ssz / 2 + 'px'
    })
    const pd = Math.min(w * 0.5, h * 0.3)
    product.style.width = pd + 'px'
    product.style.height = pd + 'px'
    product.style.left = (w - pd) / 2 + 'px'
    product.style.top = h * 0.46 - pd / 2 + 'px'
    const tsz = Math.max(48, Math.min((w / (count + 1)) * 0.82, h * 0.15))
    tray.forEach((t, i) => {
      t.el.style.width = tsz + 'px'
      t.el.style.height = tsz + 'px'
      t.el.style.left = step * (i + 1) - tsz / 2 + 'px'
      t.el.style.top = h * 0.82 - tsz / 2 + 'px'
    })
  }

  const fillSlot = (ing: number): void => {
    const slot = slots.find((s) => s.ing === ing && !s.filled)
    if (!slot) return
    slot.filled = true
    slot.el.style.background = bg(ing, false)
    slot.el.style.opacity = '1'
    slot.el.style.boxShadow = '0 0 0 3px rgba(255,255,255,.5)'
    filled++
    ctx.sfx.play('correct')
    if (filled >= count && !done) {
      done = true
      product.style.opacity = '1'
      product.style.transform = 'scale(1.12)'
      ctx.sfx.play('gameWin')
      window.setTimeout(() => completeCb?.(), 250)
    }
  }

  const tap = (t: Tray): void => {
    if (done || t.used) return
    t.used = true
    t.el.style.opacity = '0.3'
    t.el.style.pointerEvents = 'none'
    t.el.style.transform = 'scale(.85)'
    fillSlot(t.ing)
  }

  return {
    mount(c, params) {
      ctx = c
      count = Math.max(2, Math.min(5, num(params.count, 3)))
      ingImgs = (Array.isArray(params.ingredients) ? (params.ingredients as string[]) : []).map((id) => (id ? ctx.assets.src(id) : ''))
      ctx.root.style.touchAction = 'none'

      for (let i = 0; i < count; i++) {
        const el = document.createElement('div')
        el.style.cssText = 'position:absolute;box-sizing:border-box;border-radius:50%;border:3px dashed rgba(255,255,255,.4);opacity:.55;'
        el.style.background = bg(i, true)
        ctx.root.appendChild(el)
        slots.push({ el, ing: i, filled: false })
      }

      product = document.createElement('div')
      product.style.cssText = 'position:absolute;border-radius:20px;opacity:.22;transition:opacity .3s,transform .3s;box-shadow:0 8px 24px rgba(0,0,0,.4);'
      const prodImg = ctx.assets.src(params.product as string)
      product.style.background = prodImg ? `center/contain no-repeat url("${prodImg}")` : 'linear-gradient(135deg,#16a34a,#0ea5e9)'
      ctx.root.appendChild(product)

      const order = slots.map((s) => s.ing)
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.rng() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      for (const ing of order) {
        const el = document.createElement('div')
        el.style.cssText = 'position:absolute;box-sizing:border-box;border-radius:50%;cursor:pointer;transition:transform .14s,opacity .2s;box-shadow:0 4px 10px rgba(0,0,0,.3);'
        el.style.background = bg(ing, false)
        ctx.root.appendChild(el)
        tray.push({ el, ing, used: false })
      }
      layout()
    },
    start() {
      if (started) return
      started = true
      tray.forEach((t) => t.el.addEventListener('pointerdown', () => tap(t)))
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      const unfilled = slots.find((s) => !s.filled)
      if (!unfilled) return null
      const t = tray.find((x) => !x.used && x.ing === unfilled.ing)
      if (!t) return null
      const p = center(t.el)
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
      slots.length = 0
      tray.length = 0
    },
  }
}

export const RECIPE_TEMPLATE: GameTemplate = {
  id: 'recipe',
  label: 'Recipe (tap ingredients)',
  paramFields: [{ key: 'count', label: 'Ingredients', type: 'number', min: 2, max: 5, step: 1 }],
  assetSlots: [
    { key: 'ingredients', label: 'Ingredient image', list: true, countParam: 'count' },
    { key: 'product', label: 'Product image' },
  ],
  defaultParams: { count: 3, ingredients: [], product: '' },
  // Tap an ingredient in the bottom tray (first slot of the 3-item row at y~0.82).
  defaultHandguide: {
    nodes: [{ x: 0.25, y: 0.82 }],
  },
  create: createRecipe,
}
