// Pick-a-Box: tap a box to open it and reveal the prize. By default any box wins
// (ad-friendly); set anyWins=0 to make only the winning box pay off (other boxes
// show empty and the player tries again). The hint taps the box that wins.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

interface Box {
  el: HTMLDivElement
  index: number
  opened: boolean
}

export function createPick(): GameModule {
  let ctx: GameContext
  let count = 3
  let winIndex = 0
  let anyWins = true
  let closedImg = ''
  let openImg = ''
  let prizeImg = ''
  const boxes: Box[] = []
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const paint = (b: Box, opened: boolean, win: boolean): void => {
    if (opened) {
      const img = win ? prizeImg || openImg : openImg
      b.el.style.background = img ? `center/contain no-repeat url("${img}")` : win ? '#16a34a' : '#33405e'
      b.el.textContent = img ? '' : win ? '🎁' : '-'
    } else {
      b.el.style.background = closedImg ? `center/contain no-repeat url("${closedImg}")` : '#b9892f'
      b.el.textContent = closedImg ? '' : '?'
    }
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const gap = w * 0.04
    const sz = Math.min((w - gap * (count + 1)) / count, h * 0.5)
    const total = sz * count + gap * (count - 1)
    const x0 = (w - total) / 2
    boxes.forEach((b, i) => {
      b.el.style.width = sz + 'px'
      b.el.style.height = sz + 'px'
      b.el.style.left = x0 + i * (sz + gap) + 'px'
      b.el.style.top = (h - sz) / 2 + 'px'
      b.el.style.fontSize = sz * 0.4 + 'px'
    })
  }

  const open = (b: Box): void => {
    if (done || b.opened) return
    b.opened = true
    const win = anyWins || b.index === winIndex
    // squash, then reveal + pop (glow on a win)
    b.el.style.transform = 'scale(0.85)'
    window.setTimeout(() => {
      paint(b, true, win)
      b.el.style.transform = win ? 'scale(1.12)' : 'scale(1)'
      if (win) b.el.style.boxShadow = '0 0 0 4px rgba(255,255,255,.6), 0 0 30px 4px rgba(255,220,90,.8)'
    }, 120)
    if (win) {
      ctx.sfx.play('gameWin')
      done = true
      window.setTimeout(() => completeCb?.(), 280)
    } else {
      ctx.sfx.play('wrong')
      b.el.style.opacity = '0.6'
    }
  }

  return {
    mount(c, params) {
      ctx = c
      count = Math.max(2, Math.min(4, num(params.count, 3)))
      anyWins = num(params.anyWins, 1) !== 0
      winIndex = Math.max(0, Math.min(count - 1, Math.floor(num(params.winIndex, Math.floor(c.rng() * count)))))
      closedImg = ctx.assets.src(params.boxClosed as string)
      openImg = ctx.assets.src(params.boxOpen as string)
      prizeImg = ctx.assets.src(params.prize as string)
      ctx.root.style.touchAction = 'none'
      for (let i = 0; i < count; i++) {
        const el = document.createElement('div')
        el.style.cssText =
          'position:absolute;box-sizing:border-box;border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;cursor:pointer;user-select:none;transition:transform .18s,box-shadow .2s,opacity .2s;box-shadow:0 6px 16px rgba(0,0,0,.35);'
        const b: Box = { el, index: i, opened: false }
        paint(b, false, false)
        ctx.root.appendChild(el)
        boxes.push(b)
      }
      layout()
    },
    start() {
      if (started) return
      started = true
      boxes.forEach((b) => b.el.addEventListener('pointerdown', () => open(b)))
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      const target = anyWins ? boxes.find((b) => !b.opened) : boxes[winIndex]
      if (!target || target.opened) return null
      const p = center(target.el)
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
      boxes.length = 0
    },
  }
}

export const PICK_TEMPLATE: GameTemplate = {
  id: 'pick',
  label: 'Pick a box',
  paramFields: [
    { key: 'count', label: 'Boxes', type: 'number', min: 2, max: 4, step: 1 },
    { key: 'anyWins', label: 'Any box wins (1/0)', type: 'number', min: 0, max: 1, step: 1 },
    { key: 'winIndex', label: 'Winning box (if not any)', type: 'number', min: 0, max: 3, step: 1 },
  ],
  assetSlots: [
    { key: 'boxClosed', label: 'Closed box image' },
    { key: 'boxOpen', label: 'Open box image' },
    { key: 'prize', label: 'Prize image' },
  ],
  defaultParams: { count: 3, anyWins: 1, winIndex: 0, boxClosed: '', boxOpen: '', prize: '' },
  // Single tap on the centred box row (boxes are centered horizontally at vertical mid, y~0.5).
  defaultHandguide: {
    nodes: [{ x: 0.5, y: 0.5 }],
  },
  create: createPick,
}
