// Whack-a-mole: moles pop up from a grid of holes for a short time; tap one to
// whack it. Land the required number of hits to win. Moles rise from inside the
// hole (clipped) and retract if missed. Hint: tap a currently-up mole.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

interface Hole {
  hole: HTMLDivElement // clipping container
  mole: HTMLDivElement
  up: boolean
  retract: number
}

export function createWhack(): GameModule {
  let ctx: GameContext
  let count = 6
  let cols = 3
  let need = 5
  let popMs = 1100
  let gapMs = 700
  let moleImg = ''
  let holeImg = ''
  const holes: Hole[] = []
  let scheduler = 0
  let hits = 0
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const rows = Math.ceil(count / cols)
    const gap = w * 0.05
    const sz = Math.min((w - gap * (cols + 1)) / cols, (h - gap * (rows + 1)) / rows)
    const gw = sz * cols + gap * (cols - 1)
    const gh = sz * rows + gap * (rows - 1)
    const x0 = (w - gw) / 2
    const y0 = (h - gh) / 2
    holes.forEach((ho, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      ho.hole.style.width = sz + 'px'
      ho.hole.style.height = sz + 'px'
      ho.hole.style.left = x0 + c * (sz + gap) + 'px'
      ho.hole.style.top = y0 + r * (sz + gap) + 'px'
    })
  }

  const down = (ho: Hole): void => {
    ho.up = false
    ho.mole.style.transform = 'translateY(135%)'
  }
  const pop = (ho: Hole): void => {
    if (done || ho.up) return
    ho.up = true
    ho.mole.style.transform = 'translateY(8%)'
    window.clearTimeout(ho.retract)
    ho.retract = window.setTimeout(() => down(ho), popMs)
  }
  const whack = (ho: Hole): void => {
    if (done || !ho.up) return
    ho.up = false
    window.clearTimeout(ho.retract)
    ho.mole.style.transform = 'translateY(135%) scale(.8)'
    hits++
    ctx.sfx.play('pop')
    if (hits >= need) {
      done = true
      window.clearInterval(scheduler)
      holes.forEach((h) => window.clearTimeout(h.retract))
      ctx.sfx.play('gameWin')
      completeCb?.()
    }
  }

  return {
    mount(c, params) {
      ctx = c
      count = Math.max(4, Math.min(9, num(params.holes, 6)))
      cols = count <= 4 ? 2 : 3
      need = Math.max(1, Math.min(20, num(params.hits, 5)))
      popMs = Math.max(500, num(params.popMs, 1100))
      gapMs = Math.max(300, num(params.gapMs, 700))
      moleImg = ctx.assets.src(params.moleImage as string)
      holeImg = ctx.assets.src(params.holeImage as string)
      ctx.root.style.touchAction = 'none'

      for (let i = 0; i < count; i++) {
        const hole = document.createElement('div')
        hole.style.cssText = 'position:absolute;box-sizing:border-box;overflow:hidden;border-radius:50% 50% 14px 14px;'
        hole.style.background = holeImg ? `center/cover no-repeat url("${holeImg}")` : 'radial-gradient(ellipse at 50% 75%,#3a2a1a,#5a4326)'
        const mole = document.createElement('div')
        mole.style.cssText =
          'position:absolute;left:8%;top:6%;width:84%;height:84%;border-radius:50%;transform:translateY(135%);transition:transform .14s;cursor:pointer;'
        mole.style.background = moleImg ? `center/contain no-repeat url("${moleImg}")` : 'radial-gradient(circle at 40% 35%,#fff8,#8b5a2b)'
        hole.appendChild(mole)
        ctx.root.appendChild(hole)
        holes.push({ hole, mole, up: false, retract: 0 })
      }
      layout()
    },
    start() {
      if (started) return
      started = true
      holes.forEach((ho) => ho.mole.addEventListener('pointerdown', () => whack(ho)))
      scheduler = window.setInterval(() => {
        if (done) return
        const downHoles = holes.filter((h) => !h.up)
        if (!downHoles.length) return
        pop(downHoles[Math.floor(ctx.rng() * downHoles.length)])
      }, gapMs)
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      const up = holes.find((h) => h.up)
      if (!up) return null
      const r = up.mole.getBoundingClientRect()
      const p: Pt = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      window.clearInterval(scheduler)
      holes.forEach((h) => window.clearTimeout(h.retract))
      ctx.root.innerHTML = ''
      holes.length = 0
    },
  }
}

export const WHACK_TEMPLATE: GameTemplate = {
  id: 'whack',
  label: 'Whack-a-mole',
  paramFields: [
    { key: 'holes', label: 'Holes', type: 'number', min: 4, max: 9, step: 1 },
    { key: 'hits', label: 'Hits to win', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'popMs', label: 'Mole up time (ms)', type: 'number', min: 500, max: 3000, step: 100 },
    { key: 'gapMs', label: 'Pop interval (ms)', type: 'number', min: 300, max: 2000, step: 100 },
  ],
  assetSlots: [
    { key: 'moleImage', label: 'Mole image' },
    { key: 'holeImage', label: 'Hole image' },
  ],
  defaultParams: { holes: 6, hits: 5, popMs: 1100, gapMs: 700, moleImage: '', holeImage: '' },
  // Tap a mole as it pops up (top-row centre hole of the 3-wide grid).
  defaultHandguide: {
    nodes: [{ x: 0.5, y: 0.38 }],
  },
  create: createWhack,
}
