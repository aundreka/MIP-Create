// Spin Wheel: tap the wheel/button to spin; it lands on the winning segment and
// completes. Segments are a conic-gradient (or a custom wheel image). The hint is
// a tap on the centre button.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num, str } from './types'

const PALETTE = ['#ef4444', '#f59e0b', '#fde047', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6']

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createSpin(): GameModule {
  let ctx: GameContext
  let segments = 6
  let winIndex = 0
  let turns = 4
  let wheel: HTMLDivElement
  let button: HTMLDivElement
  let spinning = false
  let done = false
  let landedR: number | null = null
  const labels: { lab: HTMLDivElement; mid: number }[] = []
  let completeCb: (() => void) | null = null

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const d = Math.max(120, Math.min(w, h) * 0.82)
    wheel.style.width = d + 'px'
    wheel.style.height = d + 'px'
    wheel.style.left = (w - d) / 2 + 'px'
    wheel.style.top = (h - d) / 2 + 'px'
    const bd = Math.max(40, d * 0.22)
    button.style.width = bd + 'px'
    button.style.height = bd + 'px'
    button.style.left = (w - bd) / 2 + 'px'
    button.style.top = (h - bd) / 2 + 'px'
    button.style.fontSize = bd * 0.26 + 'px'
    // prize labels: placed along each segment's mid-spoke; uprighted once landed
    const rad = d * 0.31
    for (const { lab, mid } of labels) {
      const a = (mid * Math.PI) / 180
      lab.style.left = d / 2 + rad * Math.sin(a) + 'px'
      lab.style.top = d / 2 - rad * Math.cos(a) + 'px'
      lab.style.fontSize = Math.max(9, d * 0.05) + 'px'
      lab.style.transform = `translate(-50%,-50%)` + (landedR != null ? ` rotate(${-landedR}deg)` : '')
    }
  }

  const spin = (): void => {
    if (spinning || done) return
    spinning = true
    ctx.sfx.play('tap')
    const seg = 360 / segments
    const finalR = turns * 360 - (winIndex + 0.5) * seg
    wheel.style.transition = 'transform 3.2s cubic-bezier(.15,.7,.25,1)'
    wheel.style.transform = `rotate(${finalR}deg)`
    const onEnd = (): void => {
      wheel.removeEventListener('transitionend', onEnd)
      if (done) return
      done = true
      landedR = finalR
      layout() // upright the labels at rest
      wheel.style.boxShadow = '0 0 0 6px rgba(255,255,255,.5), 0 0 40px 6px rgba(255,220,90,.85)'
      ctx.sfx.play('gameWin')
      completeCb?.()
    }
    wheel.addEventListener('transitionend', onEnd)
  }

  return {
    mount(c, params) {
      ctx = c
      segments = Math.max(3, Math.min(8, num(params.segments, 6)))
      turns = Math.max(2, Math.min(8, num(params.turns, 4)))
      winIndex = Math.max(0, Math.min(segments - 1, Math.floor(num(params.winIndex, Math.floor(c.rng() * segments)))))
      ctx.root.style.touchAction = 'none'

      wheel = document.createElement('div')
      wheel.style.cssText = 'position:absolute;border-radius:50%;box-shadow:0 8px 28px rgba(0,0,0,.4);transform-origin:center;'
      const wheelImg = ctx.assets.src(params.wheelImage as string)
      if (wheelImg) {
        wheel.style.background = `center/cover no-repeat url("${wheelImg}")`
      } else {
        const seg = 360 / segments
        const stops: string[] = []
        for (let i = 0; i < segments; i++) stops.push(`${PALETTE[i % PALETTE.length]} ${i * seg}deg ${(i + 1) * seg}deg`)
        wheel.style.background = `conic-gradient(${stops.join(',')})`
        wheel.style.border = '6px solid rgba(255,255,255,.85)'
      }
      ctx.root.appendChild(wheel)

      // fixed pointer at the top (points down into the wheel)
      const pointer = document.createElement('div')
      pointer.style.cssText =
        'position:absolute;left:50%;transform:translateX(-50%);top:2%;width:0;height:0;border-left:16px solid transparent;border-right:16px solid transparent;border-top:26px solid #fff;z-index:3;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));'
      ctx.root.appendChild(pointer)

      // prize labels per segment (optional) — children of the wheel so they spin
      // with it; uprighted on landing. Comma-separated `prizes`, cycled.
      const prizes = str(params.prizes, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (prizes.length) {
        const seg = 360 / segments
        for (let i = 0; i < segments; i++) {
          const lab = document.createElement('div')
          lab.textContent = prizes[i % prizes.length]
          lab.style.cssText =
            'position:absolute;color:#fff;font-weight:800;white-space:nowrap;pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,.55);'
          wheel.appendChild(lab)
          labels.push({ lab, mid: (i + 0.5) * seg })
        }
      }

      button = document.createElement('div')
      button.textContent = 'SPIN'
      button.style.cssText =
        'position:absolute;border-radius:50%;background:#fff;color:#111;display:flex;align-items:center;justify-content:center;font-weight:800;box-shadow:0 4px 12px rgba(0,0,0,.4);z-index:4;cursor:pointer;user-select:none;'
      const centerImg = ctx.assets.src(params.centerImage as string)
      if (centerImg) {
        button.textContent = ''
        button.style.background = `center/cover no-repeat url("${centerImg}")`
      }
      ctx.root.appendChild(button)
      layout()
    },
    start() {
      button.addEventListener('pointerdown', spin)
      wheel.addEventListener('pointerdown', spin)
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (spinning || done) return null
      const p = center(button)
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
    },
  }
}

export const SPIN_TEMPLATE: GameTemplate = {
  id: 'spin',
  label: 'Spin wheel (tap to spin)',
  paramFields: [
    { key: 'segments', label: 'Segments', type: 'number', min: 3, max: 8, step: 1 },
    { key: 'winIndex', label: 'Winning segment (0-based)', type: 'number', min: 0, max: 7, step: 1 },
    { key: 'turns', label: 'Spin turns', type: 'number', min: 2, max: 8, step: 1 },
    { key: 'prizes', label: 'Prize labels (comma-separated)', type: 'text' },
  ],
  assetSlots: [
    { key: 'wheelImage', label: 'Wheel image (optional)' },
    { key: 'centerImage', label: 'Center button image (optional)' },
  ],
  defaultParams: { segments: 6, winIndex: 0, turns: 4, prizes: '', wheelImage: '', centerImage: '' },
  // Single tap on the centred SPIN button (wheel + button are centered at the card middle).
  defaultHandguide: {
    nodes: [{ x: 0.5, y: 0.5 }],
  },
  create: createSpin,
}
