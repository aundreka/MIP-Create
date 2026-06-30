// Tap / Bubbles: tap each bubble to pop it; pop them all to complete. Positions
// are deterministic (ctx.rng) so the layout + hint stay stable. The hint taps the
// nearest un-popped bubble. Optional custom bubble image.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6']

interface Bubble {
  el: HTMLDivElement
  // fractional position within the slot (0..1) so layout scales with the box
  fx: number
  fy: number
  color: string
  popped: boolean
}

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createBubbles(): GameModule {
  let ctx: GameContext
  let count = 6
  let img = ''
  let size = 70
  const bubbles: Bubble[] = []
  let started = false
  let done = false
  let remaining = 0
  let completeCb: (() => void) | null = null

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    size = Math.max(40, Math.min(w, h) * 0.18)
    const m = size * 0.6
    bubbles.forEach((b) => {
      const cx = m + b.fx * (w - 2 * m)
      const cy = m + b.fy * (h - 2 * m)
      b.el.style.width = size + 'px'
      b.el.style.height = size + 'px'
      b.el.style.left = cx - size / 2 + 'px'
      b.el.style.top = cy - size / 2 + 'px'
    })
  }

  const pop = (b: Bubble): void => {
    if (done || b.popped) return
    b.popped = true
    remaining--
    ctx.sfx.play('pop')
    b.el.style.transition = 'transform .18s, opacity .18s'
    b.el.style.transform = 'scale(1.6)'
    b.el.style.opacity = '0'
    b.el.style.pointerEvents = 'none'
    if (remaining <= 0 && !done) {
      done = true
      ctx.sfx.play('gameWin')
      completeCb?.()
    }
  }

  return {
    mount(c, params) {
      ctx = c
      count = Math.max(3, Math.min(12, num(params.count, 6)))
      img = ctx.assets.src(params.bubble as string)
      remaining = count
      ctx.root.style.touchAction = 'none'
      for (let i = 0; i < count; i++) {
        const el = document.createElement('div')
        const color = PALETTE[i % PALETTE.length]
        el.style.cssText = 'position:absolute;box-sizing:border-box;border-radius:50%;cursor:pointer;user-select:none;box-shadow:0 4px 12px rgba(0,0,0,.3);'
        el.style.background = img ? `center/contain no-repeat url("${img}")` : `radial-gradient(circle at 35% 30%, #ffffffaa, ${color})`
        ctx.root.appendChild(el)
        bubbles.push({ el, fx: c.rng(), fy: c.rng(), color, popped: false })
      }
      layout()
    },
    start() {
      if (started) return
      started = true
      bubbles.forEach((b) => b.el.addEventListener('pointerdown', () => pop(b)))
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      const next = bubbles.find((b) => !b.popped)
      if (!next) return null
      const p = center(next.el)
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
      bubbles.length = 0
    },
  }
}

export const BUBBLES_TEMPLATE: GameTemplate = {
  id: 'tap',
  label: 'Tap / pop bubbles',
  paramFields: [{ key: 'count', label: 'Bubbles', type: 'number', min: 3, max: 12, step: 1 }],
  assetSlots: [{ key: 'bubble', label: 'Bubble image (optional)' }],
  defaultParams: { count: 6, bubble: '' },
  // Single tap near the card center (bubbles are scattered randomly across the field).
  defaultHandguide: {
    nodes: [{ x: 0.5, y: 0.5 }],
  },
  create: createBubbles,
}
