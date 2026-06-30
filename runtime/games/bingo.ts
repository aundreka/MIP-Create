// Bingo: tap cells to daub them; complete any line (row, column, or diagonal) to
// win and reveal the reward/message. Optional custom cell + daub images. Hint:
// tap an unmarked cell in the line that's closest to completion.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

interface Cell {
  el: HTMLDivElement
  daub: HTMLDivElement
  idx: number
  marked: boolean
}

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createBingo(): GameModule {
  let ctx: GameContext
  let n = 3
  let cellImg = ''
  let markImg = ''
  const cells: Cell[] = []
  let lines: number[][] = []
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const buildLines = (): void => {
    lines = []
    for (let r = 0; r < n; r++) lines.push(Array.from({ length: n }, (_, c) => r * n + c))
    for (let c = 0; c < n; c++) lines.push(Array.from({ length: n }, (_, r) => r * n + c))
    lines.push(Array.from({ length: n }, (_, i) => i * n + i))
    lines.push(Array.from({ length: n }, (_, i) => i * n + (n - 1 - i)))
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const gap = Math.max(5, w * 0.02)
    const sz = Math.min((w - gap * (n + 1)) / n, (h - gap * (n + 1)) / n)
    const grid = sz * n + gap * (n - 1)
    const x0 = (w - grid) / 2
    const y0 = (h - grid) / 2
    cells.forEach((c) => {
      const col = c.idx % n
      const row = Math.floor(c.idx / n)
      c.el.style.width = sz + 'px'
      c.el.style.height = sz + 'px'
      c.el.style.left = x0 + col * (sz + gap) + 'px'
      c.el.style.top = y0 + row * (sz + gap) + 'px'
      c.el.style.fontSize = sz * 0.32 + 'px'
    })
  }

  const checkWin = (): void => {
    if (done) return
    const win = lines.some((ln) => ln.every((i) => cells[i].marked))
    if (win) {
      done = true
      ctx.sfx.play('gameWin')
      completeCb?.()
    }
  }

  const mark = (c: Cell): void => {
    if (done || c.marked) return
    c.marked = true
    c.daub.style.opacity = '1'
    c.daub.style.transform = 'translate(-50%,-50%) scale(1)'
    ctx.sfx.play('pop')
    checkWin()
  }

  return {
    mount(ctxIn, params) {
      ctx = ctxIn
      n = Math.max(3, Math.min(5, num(params.size, 3)))
      cellImg = ctx.assets.src(params.cellImage as string)
      markImg = ctx.assets.src(params.markImage as string)
      ctx.root.style.touchAction = 'none'
      buildLines()
      for (let i = 0; i < n * n; i++) {
        const el = document.createElement('div')
        el.style.cssText =
          'position:absolute;box-sizing:border-box;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;overflow:hidden;box-shadow:0 3px 8px rgba(0,0,0,.3);'
        el.style.background = cellImg ? `center/cover no-repeat url("${cellImg}")` : '#2c3a5a'
        if (!cellImg) el.textContent = String(i + 1)
        const daub = document.createElement('div')
        daub.style.cssText =
          'position:absolute;left:50%;top:50%;width:62%;height:62%;border-radius:50%;transform:translate(-50%,-50%) scale(.4);opacity:0;transition:transform .15s,opacity .15s;'
        daub.style.background = markImg ? `center/contain no-repeat url("${markImg}")` : 'radial-gradient(circle at 40% 35%,#ffd34d,#e0556b)'
        el.appendChild(daub)
        ctx.root.appendChild(el)
        cells.push({ el, daub, idx: i, marked: false })
      }
      layout()
    },
    start() {
      if (started) return
      started = true
      cells.forEach((c) => c.el.addEventListener('pointerdown', () => mark(c)))
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      let best: number[] | null = null
      let bestMarks = -1
      for (const ln of lines) {
        const marks = ln.filter((i) => cells[i].marked).length
        if (marks < ln.length && marks > bestMarks) {
          bestMarks = marks
          best = ln
        }
      }
      if (!best) return null
      const target = best.find((i) => !cells[i].marked)
      if (target == null) return null
      const p = center(cells[target].el)
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
      cells.length = 0
      lines = []
    },
  }
}

export const BINGO_TEMPLATE: GameTemplate = {
  id: 'bingo',
  label: 'Bingo (complete a line)',
  paramFields: [{ key: 'size', label: 'Grid size', type: 'number', min: 3, max: 5, step: 1 }],
  assetSlots: [
    { key: 'cellImage', label: 'Cell image (optional)' },
    { key: 'markImage', label: 'Daub / mark image (optional)' },
  ],
  defaultParams: { size: 3, cellImage: '', markImage: '' },
  // Tap cells to daub a line (centre then a corner of the centred 3x3 grid).
  defaultHandguide: {
    nodes: [
      { x: 0.5, y: 0.5 },
      { x: 0.2, y: 0.2, pauseMs: 300 },
    ],
  },
  create: createBingo,
}
