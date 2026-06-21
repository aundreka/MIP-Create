// Slots: tap SPIN to roll three reels; they land on a matching row (a forced
// jackpot) and you win. Each reel is a tall strip translated to land the winning
// symbol on the payline, with staggered stop times. Hint: tap the spin button.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num, str } from './types'

const DEFAULT_SYMBOLS = ['🍒', '🔔', '⭐', '7️⃣', '🍋', '💎']
const REPEATS = 8

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createSlots(): GameModule {
  let ctx: GameContext
  let symbols: string[] = DEFAULT_SYMBOLS
  let winSym = 0
  let reels: HTMLDivElement[] = []
  let strips: HTMLDivElement[] = []
  let machine: HTMLDivElement
  let button: HTMLDivElement
  let symbolH = 90
  let spinning = false
  let done = false
  let completeCb: (() => void) | null = null

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const mw = Math.min(w * 0.9, h * 0.7)
    symbolH = mw / 3.4
    machine.style.width = mw + 'px'
    machine.style.height = symbolH + 'px'
    machine.style.left = (w - mw) / 2 + 'px'
    machine.style.top = h * 0.32 + 'px'
    reels.forEach((reel, i) => {
      reel.style.width = mw / 3 - 8 + 'px'
      reel.style.height = symbolH + 'px'
      reel.style.left = i * (mw / 3) + 4 + 'px'
      const strip = strips[i]
      Array.from(strip.children).forEach((ch) => {
        ;(ch as HTMLElement).style.height = symbolH + 'px'
        ;(ch as HTMLElement).style.fontSize = symbolH * 0.6 + 'px'
      })
      if (!spinning && !done) strip.style.transform = 'translateY(0px)'
    })
    const bw = mw * 0.5
    button.style.width = bw + 'px'
    button.style.left = (w - bw) / 2 + 'px'
    button.style.top = h * 0.32 + symbolH + 24 + 'px'
  }

  const spin = (): void => {
    if (spinning || done) return
    spinning = true
    ctx.sfx.play('tap')
    const S = symbols.length
    let landed = 0
    strips.forEach((strip, i) => {
      const finalIndex = (REPEATS - 1) * S + winSym
      const dur = 1400 + i * 450
      strip.style.transition = `transform ${dur}ms cubic-bezier(.15,.65,.25,1)`
      strip.style.transform = `translateY(${-finalIndex * symbolH}px)`
      const onEnd = (): void => {
        strip.removeEventListener('transitionend', onEnd)
        landed++
        ctx.sfx.play('pop')
        if (landed >= strips.length && !done) {
          done = true
          machine.style.boxShadow = '0 0 0 4px #ffd34d, 0 0 30px 4px rgba(255,211,77,.8)'
          ctx.sfx.play('gameWin')
          completeCb?.()
        }
      }
      strip.addEventListener('transitionend', onEnd)
    })
  }

  const symbolEl = (sym: number): HTMLDivElement => {
    const el = document.createElement('div')
    el.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;box-sizing:border-box;'
    el.textContent = symbols[sym]
    return el
  }

  return {
    mount(c, params) {
      ctx = c
      const custom = str(params.symbols, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      symbols = custom.length >= 2 ? custom : DEFAULT_SYMBOLS
      winSym = Math.max(0, Math.min(symbols.length - 1, Math.floor(num(params.winSymbol, Math.floor(c.rng() * symbols.length)))))
      ctx.root.style.touchAction = 'none'

      machine = document.createElement('div')
      machine.style.cssText =
        'position:absolute;display:flex;overflow:hidden;background:#10172e;border:4px solid #ffd34d;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.5);transition:box-shadow .2s;'
      reels = []
      strips = []
      for (let i = 0; i < 3; i++) {
        const reel = document.createElement('div')
        reel.style.cssText = 'position:absolute;top:0;overflow:hidden;background:#fff;border-radius:8px;'
        const strip = document.createElement('div')
        strip.style.cssText = 'will-change:transform;'
        for (let r = 0; r < REPEATS; r++) for (let s = 0; s < symbols.length; s++) strip.appendChild(symbolEl(s))
        reel.appendChild(strip)
        machine.appendChild(reel)
        reels.push(reel)
        strips.push(strip)
      }
      ctx.root.appendChild(machine)

      button = document.createElement('div')
      button.textContent = 'SPIN'
      button.style.cssText =
        'position:absolute;height:52px;border-radius:26px;background:#16a34a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.4);user-select:none;'
      ctx.root.appendChild(button)
      layout()
    },
    start() {
      button.addEventListener('pointerdown', spin)
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
      reels = []
      strips = []
    },
  }
}

export const SLOTS_TEMPLATE: GameTemplate = {
  id: 'slots',
  label: 'Slot machine (tap to spin)',
  paramFields: [
    { key: 'symbols', label: 'Symbols (comma-separated emoji/text)', type: 'text' },
    { key: 'winSymbol', label: 'Winning symbol index', type: 'number', min: 0, max: 8, step: 1 },
  ],
  defaultParams: { symbols: '', winSymbol: 0 },
  create: createSlots,
}
