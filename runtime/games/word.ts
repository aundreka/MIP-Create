// Word: spell the target word by tapping its letters in order. Empty slots up
// top, a shuffled tray of letter tiles below; tapping the correct next letter
// fills the next slot, a wrong one shakes. Spell it all to win (revealing the
// product). Hint: tap the next correct letter.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { str } from './types'

interface Slot {
  el: HTMLDivElement
  ch: string
}
interface Tile {
  el: HTMLDivElement
  ch: string
  used: boolean
}

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createWord(): GameModule {
  let ctx: GameContext
  let word = 'PLAY'
  let product: HTMLDivElement | null = null
  const slots: Slot[] = []
  const tiles: Tile[] = []
  let filled = 0
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const n = slots.length
    const cols = Math.min(n, 6)
    const gap = w * 0.025
    const sz = Math.min((w - gap * (cols + 1)) / cols, h * 0.13)
    const rowW = sz * n + gap * (n - 1)
    const x0 = (w - rowW) / 2
    slots.forEach((s, i) => {
      s.el.style.width = sz + 'px'
      s.el.style.height = sz + 'px'
      s.el.style.left = x0 + i * (sz + gap) + 'px'
      s.el.style.top = h * 0.16 + 'px'
      s.el.style.fontSize = sz * 0.5 + 'px'
    })
    if (product) {
      const pd = Math.min(w * 0.45, h * 0.26)
      product.style.width = pd + 'px'
      product.style.height = pd + 'px'
      product.style.left = (w - pd) / 2 + 'px'
      product.style.top = h * 0.42 + 'px'
    }
    const tn = tiles.length
    const tcols = Math.min(tn, 6)
    const trowW = sz * tcols + gap * (tcols - 1)
    const tx0 = (w - trowW) / 2
    tiles.forEach((t, i) => {
      const c = i % tcols
      const r = Math.floor(i / tcols)
      t.el.style.width = sz + 'px'
      t.el.style.height = sz + 'px'
      t.el.style.left = tx0 + c * (sz + gap) + 'px'
      t.el.style.top = h * 0.74 + r * (sz + gap) + 'px'
      t.el.style.fontSize = sz * 0.5 + 'px'
    })
  }

  const tap = (t: Tile): void => {
    if (done || t.used) return
    if (t.ch === word[filled]) {
      t.used = true
      t.el.style.opacity = '0.25'
      t.el.style.pointerEvents = 'none'
      const slot = slots[filled]
      slot.el.textContent = t.ch
      slot.el.style.background = '#16a34a'
      filled++
      ctx.sfx.play('correct')
      if (filled >= word.length && !done) {
        done = true
        if (product) {
          product.style.opacity = '1'
          product.style.transform = 'scale(1.1)'
        }
        ctx.sfx.play('gameWin')
        window.setTimeout(() => completeCb?.(), 250)
      }
    } else {
      ctx.sfx.play('wrong')
      t.el.style.transform = 'translateY(-4px)'
      window.setTimeout(() => (t.el.style.transform = 'translateY(0)'), 110)
    }
  }

  return {
    mount(c, params) {
      ctx = c
      word = str(params.word, 'PLAY').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PLAY'
      ctx.root.style.touchAction = 'none'

      for (let i = 0; i < word.length; i++) {
        const el = document.createElement('div')
        el.style.cssText =
          'position:absolute;box-sizing:border-box;border-radius:10px;border:2px dashed rgba(255,255,255,.4);background:#2c3a5a;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;'
        ctx.root.appendChild(el)
        slots.push({ el, ch: word[i] })
      }

      const prodImg = ctx.assets.src(params.product as string)
      if (prodImg) {
        product = document.createElement('div')
        product.style.cssText = 'position:absolute;border-radius:18px;opacity:.2;transition:opacity .3s,transform .3s;box-shadow:0 8px 24px rgba(0,0,0,.4);'
        product.style.background = `center/contain no-repeat url("${prodImg}")`
        ctx.root.appendChild(product)
      }

      const letters = word.split('')
      for (let i = letters.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.rng() * (i + 1))
        ;[letters[i], letters[j]] = [letters[j], letters[i]]
      }
      for (const ch of letters) {
        const el = document.createElement('div')
        el.style.cssText =
          'position:absolute;box-sizing:border-box;border-radius:10px;background:#f59e0b;display:flex;align-items:center;justify-content:center;color:#1b2333;font-weight:800;cursor:pointer;transition:transform .12s,opacity .2s;box-shadow:0 4px 10px rgba(0,0,0,.3);'
        el.textContent = ch
        ctx.root.appendChild(el)
        tiles.push({ el, ch, used: false })
      }
      layout()
    },
    start() {
      if (started) return
      started = true
      tiles.forEach((t) => t.el.addEventListener('pointerdown', () => tap(t)))
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      const t = tiles.find((x) => !x.used && x.ch === word[filled])
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
      tiles.length = 0
    },
  }
}

export const WORD_TEMPLATE: GameTemplate = {
  id: 'word',
  label: 'Word (spell it)',
  paramFields: [{ key: 'word', label: 'Word to spell', type: 'text' }],
  assetSlots: [{ key: 'product', label: 'Reward image (optional)' }],
  defaultParams: { word: 'PLAY', product: '' },
  // Tap a letter tile in the tray (tiles sit at ~0.74+ height; first tile left of center).
  defaultHandguide: {
    nodes: [{ x: 0.32, y: 0.8 }],
  },
  create: createWord,
}
