// Find-Match: a flip-to-match memory grid. Tap a tile to flip it; flip two — if
// they're a pair they stay revealed, otherwise they flip back. Match every pair
// to win (revealing the product as the reward). Each pair can show a custom image
// (params.images[i]); the tile back is a colour or a custom image. The hint knows
// the board: it points at the partner of a flipped tile, else at a fresh pair.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num, str } from './types'

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308']

interface Tile {
  el: HTMLDivElement
  front: HTMLDivElement // the face (image / colour) — shown when flipped
  inner: HTMLDivElement
  pairId: number
  matched: boolean
  flipped: boolean
}

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createFlipMatch(): GameModule {
  let ctx: GameContext
  let pairCount = 4
  let cols = 4
  let coverImg = ''
  let coverColor = '#2c3a5a'
  const tiles: Tile[] = []
  let first: Tile | null = null
  let busy = false
  let started = false
  let done = false
  let matchedCount = 0
  let completeCb: (() => void) | null = null

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const rows = Math.ceil(tiles.length / cols)
    const gap = Math.max(6, w * 0.02)
    const sz = Math.min((w - gap * (cols + 1)) / cols, (h - gap * (rows + 1)) / rows)
    const gridW = sz * cols + gap * (cols - 1)
    const gridH = sz * rows + gap * (rows - 1)
    const x0 = (w - gridW) / 2
    const y0 = (h - gridH) / 2
    tiles.forEach((t, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      t.el.style.width = sz + 'px'
      t.el.style.height = sz + 'px'
      t.el.style.left = x0 + c * (sz + gap) + 'px'
      t.el.style.top = y0 + r * (sz + gap) + 'px'
      t.front.style.fontSize = sz * 0.5 + 'px'
    })
  }

  const setFlipped = (t: Tile, on: boolean): void => {
    t.flipped = on
    t.inner.style.transform = on ? 'rotateY(180deg)' : 'rotateY(0deg)'
  }

  const resolvePair = (a: Tile, b: Tile): void => {
    if (a.pairId === b.pairId) {
      a.matched = b.matched = true
      matchedCount++
      ctx.sfx.play('correct')
      ;[a, b].forEach((t) => (t.el.style.boxShadow = '0 0 0 4px rgba(255,255,255,.6)'))
      first = null
      busy = false
      if (matchedCount >= pairCount && !done) {
        done = true
        completeCb?.()
      }
    } else {
      ctx.sfx.play('wrong')
      window.setTimeout(() => {
        setFlipped(a, false)
        setFlipped(b, false)
        first = null
        busy = false
      }, 650)
    }
  }

  const tap = (t: Tile): void => {
    if (done || busy || t.matched || t.flipped) return
    ctx.sfx.play('tap')
    setFlipped(t, true)
    if (!first) {
      first = t
    } else {
      busy = true
      resolvePair(first, t)
    }
  }

  return {
    mount(c, params) {
      ctx = c
      pairCount = Math.max(2, Math.min(8, num(params.pairs, 4)))
      coverImg = ctx.assets.src(params.cover as string)
      coverColor = str(params.coverColor, '#2c3a5a')
      cols = pairCount <= 3 ? pairCount : pairCount <= 4 ? 4 : pairCount <= 6 ? 4 : pairCount <= 8 ? 4 : 5
      ctx.root.style.touchAction = 'none'
      const images = Array.isArray(params.images) ? (params.images as string[]) : []

      const order: number[] = []
      for (let i = 0; i < pairCount; i++) order.push(i, i)
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.rng() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }

      for (const pid of order) {
        const el = document.createElement('div')
        el.style.cssText = 'position:absolute;box-sizing:border-box;cursor:pointer;perspective:600px;border-radius:14px;transition:box-shadow .2s;'
        const inner = document.createElement('div')
        inner.style.cssText = 'position:relative;width:100%;height:100%;transition:transform .4s;transform-style:preserve-3d;'
        const back = document.createElement('div') // shown face-down
        back.style.cssText = 'position:absolute;inset:0;border-radius:14px;backface-visibility:hidden;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.85);font-weight:800;box-shadow:0 4px 10px rgba(0,0,0,.3);'
        back.style.background = coverImg ? `center/cover no-repeat url("${coverImg}")` : coverColor
        if (!coverImg) back.textContent = '?'
        const front = document.createElement('div') // the face / prize
        front.style.cssText = 'position:absolute;inset:0;border-radius:14px;backface-visibility:hidden;transform:rotateY(180deg);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;box-shadow:0 4px 10px rgba(0,0,0,.3);'
        const img = images[pid] ? ctx.assets.src(images[pid]) : ''
        front.style.background = img ? `center/contain no-repeat ${PALETTE[pid % PALETTE.length]}22` : PALETTE[pid % PALETTE.length]
        if (img) front.style.backgroundImage = `url("${img}")`
        inner.appendChild(back)
        inner.appendChild(front)
        el.appendChild(inner)
        ctx.root.appendChild(el)
        tiles.push({ el, front, inner, pairId: pid, matched: false, flipped: false })
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
      // partner of a currently-flipped tile
      if (first) {
        const partner = tiles.find((t) => t !== first && !t.matched && t.pairId === first!.pairId)
        if (partner) {
          const p = center(partner.el)
          return { from: p, to: p, kind: 'tap' }
        }
      }
      // otherwise nudge a fresh unmatched tile
      const next = tiles.find((t) => !t.matched && !t.flipped)
      if (!next) return null
      const p = center(next.el)
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
      tiles.length = 0
      first = null
    },
  }
}

export const FLIPMATCH_TEMPLATE: GameTemplate = {
  id: 'flipmatch',
  label: 'Find match (flip pairs)',
  paramFields: [
    { key: 'pairs', label: 'Pairs', type: 'number', min: 2, max: 8, step: 1 },
    { key: 'coverColor', label: 'Tile back colour', type: 'color' },
  ],
  assetSlots: [
    { key: 'images', label: 'Pair image', list: true, countParam: 'pairs' },
    { key: 'cover', label: 'Tile back image (optional)' },
  ],
  defaultParams: { pairs: 4, coverColor: '#2c3a5a', images: [], cover: '' },
  create: createFlipMatch,
}
