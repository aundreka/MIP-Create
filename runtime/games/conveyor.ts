// Conveyor belt: products ride a belt across the screen; tap the ones matching
// the "wanted" target as they pass. Collect the required number to win. Items
// spawn at the left and move right via the rAF timestamp. Hint: tap the nearest
// matching item on the belt.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7']

interface Item {
  el: HTMLDivElement
  type: number
  x: number
}

export function createConveyor(): GameModule {
  let ctx: GameContext
  let need = 5
  let types = 3
  let speedFrac = 0.4
  let spawnMs = 800
  let imgs: string[] = []
  let belt: HTMLDivElement
  let target: HTMLDivElement
  let label: HTMLDivElement
  const items: Item[] = []
  let w = 300
  let h = 400
  let beltY = 250
  let itemSz = 70
  let pxPerSec = 120
  let raf = 0
  let last = -1
  let spawnTimer = 0
  let collected = 0
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const fill = (el: HTMLElement, type: number): void => {
    if (imgs[type]) el.style.background = `center/contain no-repeat url("${imgs[type]}")`
    else el.style.background = PALETTE[type % PALETTE.length]
  }

  const layout = (): void => {
    w = ctx.root.clientWidth || 300
    h = ctx.root.clientHeight || 400
    beltY = h * 0.55
    itemSz = Math.max(44, Math.min(w * 0.16, h * 0.16))
    pxPerSec = w * speedFrac
    belt.style.left = '0'
    belt.style.width = '100%'
    belt.style.height = itemSz * 1.5 + 'px'
    belt.style.top = beltY - (itemSz * 1.5) / 2 + 'px'
    const tsz = itemSz * 1.1
    target.style.width = tsz + 'px'
    target.style.height = tsz + 'px'
    target.style.left = (w - tsz) / 2 + 'px'
    target.style.top = h * 0.16 + 'px'
    label.style.top = h * 0.16 - 28 + 'px'
    label.style.fontSize = Math.max(13, w * 0.045) + 'px'
    items.forEach((it) => {
      it.el.style.width = itemSz + 'px'
      it.el.style.height = itemSz + 'px'
      it.el.style.top = beltY - itemSz / 2 + 'px'
      it.el.style.left = it.x - itemSz / 2 + 'px'
    })
  }

  const spawn = (): void => {
    if (done) return
    const el = document.createElement('div')
    el.style.cssText = 'position:absolute;border-radius:14px;cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,.35);z-index:2;transition:transform .1s;'
    // ~55% chance to be the target type so the belt stays winnable
    const type = ctx.rng() < 0.55 ? 0 : 1 + Math.floor(ctx.rng() * Math.max(1, types - 1))
    fill(el, type)
    el.style.width = itemSz + 'px'
    el.style.height = itemSz + 'px'
    el.style.top = beltY - itemSz / 2 + 'px'
    const it: Item = { el, type, x: -itemSz }
    el.style.left = it.x - itemSz / 2 + 'px'
    el.addEventListener('pointerdown', () => collect(it))
    ctx.root.appendChild(el)
    items.push(it)
  }

  const removeAt = (i: number): void => {
    items[i].el.remove()
    items.splice(i, 1)
  }

  const collect = (it: Item): void => {
    if (done) return
    const i = items.indexOf(it)
    if (i < 0) return
    if (it.type === 0) {
      collected++
      ctx.sfx.play('collect')
      label.textContent = collected + ' / ' + need
      removeAt(i)
      if (collected >= need && !done) {
        done = true
        cancelAnimationFrame(raf)
        window.clearInterval(spawnTimer)
        ctx.sfx.play('gameWin')
        completeCb?.()
      }
    } else {
      ctx.sfx.play('wrong')
      it.el.style.transform = 'scale(.85)'
      window.setTimeout(() => (it.el.style.transform = 'scale(1)'), 100)
    }
  }

  const tick = (t: number): void => {
    if (done) return
    if (last < 0) last = t
    const dt = Math.min(64, t - last) / 1000
    last = t
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      it.x += pxPerSec * dt
      it.el.style.left = it.x - itemSz / 2 + 'px'
      if (it.x > w + itemSz) removeAt(i)
    }
    raf = requestAnimationFrame(tick)
  }

  return {
    mount(c, params) {
      ctx = c
      need = Math.max(1, Math.min(20, num(params.need, 5)))
      types = Math.max(2, Math.min(5, num(params.types, 3)))
      speedFrac = Math.max(0.15, Math.min(1, num(params.speed, 0.4)))
      spawnMs = Math.max(400, num(params.spawnMs, 800))
      imgs = (Array.isArray(params.itemImages) ? (params.itemImages as string[]) : []).map((id) => (id ? ctx.assets.src(id) : ''))
      ctx.root.style.touchAction = 'none'

      belt = document.createElement('div')
      belt.style.cssText = 'position:absolute;background:repeating-linear-gradient(90deg,#2a3350,#2a3350 24px,#222a44 24px,#222a44 48px);border-top:3px solid #444f73;border-bottom:3px solid #444f73;z-index:1;'
      ctx.root.appendChild(belt)

      label = document.createElement('div')
      label.style.cssText = 'position:absolute;left:0;width:100%;text-align:center;color:#fff;font-weight:800;pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,.5);'
      label.textContent = '0 / ' + need
      ctx.root.appendChild(label)

      target = document.createElement('div')
      target.style.cssText = 'position:absolute;border-radius:14px;box-shadow:0 0 0 3px #fff,0 4px 10px rgba(0,0,0,.4);z-index:2;'
      fill(target, 0)
      ctx.root.appendChild(target)
      layout()
    },
    start() {
      if (started) return
      started = true
      last = -1
      raf = requestAnimationFrame(tick)
      spawn()
      spawnTimer = window.setInterval(spawn, spawnMs)
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      const targets = items.filter((it) => it.type === 0)
      if (!targets.length) return null
      const it = targets.reduce((a, b) => (b.x > a.x ? b : a))
      const r = it.el.getBoundingClientRect()
      const p: Pt = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      cancelAnimationFrame(raf)
      window.clearInterval(spawnTimer)
      ctx.root.innerHTML = ''
      items.length = 0
    },
  }
}

export const CONVEYOR_TEMPLATE: GameTemplate = {
  id: 'conveyor',
  label: 'Conveyor belt (tap the wanted)',
  paramFields: [
    { key: 'need', label: 'Collect to win', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'types', label: 'Product variety', type: 'number', min: 2, max: 5, step: 1 },
    { key: 'speed', label: 'Belt speed (screens/sec)', type: 'number', min: 0.15, max: 1, step: 0.05 },
    { key: 'spawnMs', label: 'Spawn interval (ms)', type: 'number', min: 400, max: 2000, step: 100 },
  ],
  assetSlots: [{ key: 'itemImages', label: 'Product image (1st = wanted)', list: true, countParam: 'types' }],
  defaultParams: { need: 5, types: 3, speed: 0.4, spawnMs: 800, itemImages: [] },
  // Tap an item riding the belt (belt sits at ~0.55 height across the card).
  defaultHandguide: {
    nodes: [{ x: 0.5, y: 0.55 }],
  },
  create: createConveyor,
}
