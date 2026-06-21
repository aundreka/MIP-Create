// Spin-to-catch: an object orbits the centre; tap it to catch it. Catch it the
// required number of times to win (each catch it jumps to a new angle and speeds
// up a touch). Time-based motion via the rAF timestamp. Hint: tap the object's
// current position.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

export function createSpinCatch(): GameModule {
  let ctx: GameContext
  let need = 3
  let speed = 200 // deg/sec
  let ring: HTMLDivElement
  let hub: HTMLDivElement
  let obj: HTMLDivElement
  let label: HTMLDivElement
  let angle = 0
  let radius = 80
  let cx = 150
  let cy = 200
  let osize = 56
  let raf = 0
  let last = -1
  let caught = 0
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const d = Math.min(w, h) * 0.78
    radius = d / 2
    cx = w / 2
    cy = h / 2
    osize = Math.max(40, d * 0.16)
    ring.style.width = d + 'px'
    ring.style.height = d + 'px'
    ring.style.left = cx - d / 2 + 'px'
    ring.style.top = cy - d / 2 + 'px'
    const hd = Math.max(44, d * 0.26)
    hub.style.width = hd + 'px'
    hub.style.height = hd + 'px'
    hub.style.left = cx - hd / 2 + 'px'
    hub.style.top = cy - hd / 2 + 'px'
    hub.style.fontSize = hd * 0.22 + 'px'
    obj.style.width = osize + 'px'
    obj.style.height = osize + 'px'
    placeObj()
  }

  const placeObj = (): void => {
    const a = (angle * Math.PI) / 180
    const x = cx + radius * Math.sin(a)
    const y = cy - radius * Math.cos(a)
    obj.style.left = x - osize / 2 + 'px'
    obj.style.top = y - osize / 2 + 'px'
  }

  const tick = (t: number): void => {
    if (done) return
    if (last < 0) last = t
    const dt = Math.min(64, t - last)
    last = t
    angle = (angle + (speed * dt) / 1000) % 360
    placeObj()
    raf = requestAnimationFrame(tick)
  }

  const setLabel = (): void => {
    label.textContent = caught + ' / ' + need
  }

  const catchIt = (): void => {
    if (done) return
    caught++
    ctx.sfx.play('collect')
    setLabel()
    obj.style.transform = 'scale(1.3)'
    window.setTimeout(() => (obj.style.transform = 'scale(1)'), 120)
    if (caught >= need) {
      done = true
      cancelAnimationFrame(raf)
      ctx.sfx.play('gameWin')
      completeCb?.()
      return
    }
    angle = (angle + 90 + ctx.rng() * 180) % 360
    speed += 30
    placeObj()
  }

  return {
    mount(c, params) {
      ctx = c
      need = Math.max(1, Math.min(8, num(params.catches, 3)))
      speed = Math.max(60, Math.min(600, num(params.speed, 200)))
      angle = ctx.rng() * 360
      ctx.root.style.touchAction = 'none'

      ring = document.createElement('div')
      ring.style.cssText = 'position:absolute;border-radius:50%;border:3px dashed rgba(255,255,255,.35);box-sizing:border-box;'

      hub = document.createElement('div')
      hub.style.cssText =
        'position:absolute;border-radius:50%;background:rgba(255,255,255,.1);border:2px solid rgba(255,255,255,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;'
      const hubImg = ctx.assets.src(params.centerImage as string)
      if (hubImg) hub.style.background = `center/cover no-repeat url("${hubImg}")`
      label = document.createElement('div')
      label.style.cssText = 'pointer-events:none;'
      hub.appendChild(label)

      obj = document.createElement('div')
      obj.style.cssText = 'position:absolute;border-radius:50%;cursor:pointer;transition:transform .12s;box-shadow:0 4px 12px rgba(0,0,0,.4);z-index:3;'
      const objImg = ctx.assets.src(params.objectImage as string)
      obj.style.background = objImg ? `center/contain no-repeat url("${objImg}")` : 'radial-gradient(circle at 35% 30%,#fff8,#f59e0b)'

      ctx.root.appendChild(ring)
      ctx.root.appendChild(hub)
      ctx.root.appendChild(obj)
      setLabel()
      layout()
    },
    start() {
      if (started) return
      started = true
      obj.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        catchIt()
      })
      last = -1
      raf = requestAnimationFrame(tick)
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      const r = obj.getBoundingClientRect()
      const p: Pt = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      cancelAnimationFrame(raf)
      ctx.root.innerHTML = ''
    },
  }
}

export const SPINCATCH_TEMPLATE: GameTemplate = {
  id: 'spincatch',
  label: 'Spin to catch (tap orbiting)',
  paramFields: [
    { key: 'catches', label: 'Catches to win', type: 'number', min: 1, max: 8, step: 1 },
    { key: 'speed', label: 'Orbit speed (deg/s)', type: 'number', min: 60, max: 600, step: 20 },
  ],
  assetSlots: [
    { key: 'objectImage', label: 'Orbiting object image' },
    { key: 'centerImage', label: 'Center image (optional)' },
  ],
  defaultParams: { catches: 3, speed: 200, objectImage: '', centerImage: '' },
  create: createSpinCatch,
}
