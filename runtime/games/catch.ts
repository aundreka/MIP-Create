// Catch: drag the basket along the bottom to catch items falling from the top.
// Catch the required number to win. Items spawn at random x and fall via the rAF
// timestamp; one that reaches the basket line is caught if it overlaps, else
// missed. Hint: move the basket toward the lowest falling item.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

interface Drop {
  el: HTMLDivElement
  x: number
  y: number
}

export function createCatch(): GameModule {
  let ctx: GameContext
  let need = 5
  let fallPxPerSec = 0
  let spawnMs = 900
  let basket: HTMLDivElement
  let label: HTMLDivElement
  const drops: Drop[] = []
  let basketX = 150
  let basketY = 360
  let basketW = 110
  let itemSz = 56
  let w = 300
  let h = 400
  let raf = 0
  let last = -1
  let spawnTimer = 0
  let caught = 0
  let started = false
  let done = false
  let itemImg = ''
  let completeCb: (() => void) | null = null

  const layout = (): void => {
    w = ctx.root.clientWidth || 300
    h = ctx.root.clientHeight || 400
    basketW = Math.max(70, w * 0.22)
    itemSz = Math.max(36, w * 0.12)
    basketY = h - basketW * 0.7
    if (basketX === 150) basketX = w / 2
    basket.style.width = basketW + 'px'
    basket.style.height = basketW * 0.7 + 'px'
    basket.style.top = basketY + 'px'
    basket.style.left = basketX - basketW / 2 + 'px'
    label.style.fontSize = Math.max(14, w * 0.05) + 'px'
    fallPxPerSec = h * fallFrac
    drops.forEach((d) => {
      d.el.style.width = itemSz + 'px'
      d.el.style.height = itemSz + 'px'
      d.el.style.left = d.x - itemSz / 2 + 'px'
      d.el.style.top = d.y - itemSz / 2 + 'px'
    })
  }

  let fallFrac = 0.55

  const spawn = (): void => {
    if (done) return
    const el = document.createElement('div')
    el.style.cssText = 'position:absolute;border-radius:50%;box-shadow:0 3px 8px rgba(0,0,0,.3);'
    el.style.background = itemImg ? `center/contain no-repeat url("${itemImg}")` : 'radial-gradient(circle at 38% 32%,#fff8,#f43f5e)'
    ctx.root.appendChild(el)
    const x = itemSz + ctx.rng() * (w - 2 * itemSz)
    const d: Drop = { el, x, y: -itemSz }
    el.style.width = itemSz + 'px'
    el.style.height = itemSz + 'px'
    el.style.left = d.x - itemSz / 2 + 'px'
    el.style.top = d.y - itemSz / 2 + 'px'
    drops.push(d)
  }

  const removeDrop = (i: number): void => {
    drops[i].el.remove()
    drops.splice(i, 1)
  }

  const tick = (t: number): void => {
    if (done) return
    if (last < 0) last = t
    const dt = Math.min(64, t - last) / 1000
    last = t
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]
      d.y += fallPxPerSec * dt
      d.el.style.top = d.y - itemSz / 2 + 'px'
      if (d.y >= basketY) {
        const hit = Math.abs(d.x - basketX) < basketW / 2 + itemSz * 0.3
        removeDrop(i)
        if (hit) {
          caught++
          ctx.sfx.play('collect')
          label.textContent = caught + ' / ' + need
          if (caught >= need && !done) {
            done = true
            cancelAnimationFrame(raf)
            window.clearInterval(spawnTimer)
            ctx.sfx.play('gameWin')
            completeCb?.()
            return
          }
        } else {
          ctx.sfx.play('wrong')
        }
      }
    }
    raf = requestAnimationFrame(tick)
  }

  return {
    mount(c, params) {
      ctx = c
      need = Math.max(1, Math.min(20, num(params.catches, 5)))
      fallFrac = Math.max(0.2, Math.min(1.5, num(params.speed, 0.55)))
      spawnMs = Math.max(300, num(params.spawnMs, 900))
      itemImg = ctx.assets.src(params.itemImage as string)
      ctx.root.style.touchAction = 'none'

      basket = document.createElement('div')
      basket.style.cssText = 'position:absolute;border-radius:0 0 16px 16px;z-index:3;display:flex;align-items:flex-end;justify-content:center;'
      const basketImg = ctx.assets.src(params.basketImage as string)
      basket.style.background = basketImg ? `bottom/contain no-repeat url("${basketImg}")` : 'linear-gradient(#a16207,#7c4a12)'
      if (!basketImg) basket.style.border = '3px solid #5a3410'
      ctx.root.appendChild(basket)

      label = document.createElement('div')
      label.style.cssText = 'position:absolute;left:50%;top:10px;transform:translateX(-50%);color:#fff;font-weight:800;pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,.5);'
      label.textContent = '0 / ' + need
      ctx.root.appendChild(label)
      layout()
    },
    start() {
      if (started) return
      started = true
      const moveTo = (clientX: number): void => {
        const r = ctx.root.getBoundingClientRect()
        basketX = Math.max(basketW / 2, Math.min(w - basketW / 2, clientX - r.left))
        basket.style.left = basketX - basketW / 2 + 'px'
      }
      let dragging = false
      ctx.root.addEventListener('pointerdown', (e) => {
        dragging = true
        ctx.root.setPointerCapture?.(e.pointerId)
        moveTo(e.clientX)
      })
      ctx.root.addEventListener('pointermove', (e) => dragging && moveTo(e.clientX))
      ctx.root.addEventListener('pointerup', () => (dragging = false))
      last = -1
      raf = requestAnimationFrame(tick)
      spawn()
      spawnTimer = window.setInterval(spawn, spawnMs)
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done || !drops.length) return null
      const lowest = drops.reduce((a, b) => (b.y > a.y ? b : a))
      const from: Pt = { x: 0, y: 0 }
      const r = basket.getBoundingClientRect()
      from.x = r.left + r.width / 2
      from.y = r.top + r.height / 2
      const root = ctx.root.getBoundingClientRect()
      return { from, to: { x: root.left + lowest.x, y: from.y }, kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      cancelAnimationFrame(raf)
      window.clearInterval(spawnTimer)
      ctx.root.innerHTML = ''
      drops.length = 0
    },
  }
}

export const CATCH_TEMPLATE: GameTemplate = {
  id: 'catch',
  label: 'Catch (drag basket)',
  paramFields: [
    { key: 'catches', label: 'Catches to win', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'speed', label: 'Fall speed (screens/sec)', type: 'number', min: 0.2, max: 1.5, step: 0.05 },
    { key: 'spawnMs', label: 'Spawn interval (ms)', type: 'number', min: 300, max: 2500, step: 100 },
  ],
  assetSlots: [
    { key: 'basketImage', label: 'Basket image' },
    { key: 'itemImage', label: 'Falling item image' },
  ],
  defaultParams: { catches: 5, speed: 0.55, spawnMs: 900, basketImage: '', itemImage: '' },
  // Slide the basket left-right along the bottom to line up with falling items.
  defaultHandguide: {
    nodes: [
      { x: 0.3, y: 0.85 },
      { x: 0.7, y: 0.85 },
    ],
    periodMs: 1700,
  },
  create: createCatch,
}
