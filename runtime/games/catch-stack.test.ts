// The box collects products: a caught item goes IN the box and stays there. Each arrival
// joins the row already standing on the box's floor and the whole row is re-fitted, so the
// box visibly fills up instead of items spilling over its sides or piling on one spot.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCatch } from './catch'
import { mulberry32, type GameContext } from './types'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect

const BOX = { w: 400, h: 300, left: 340, top: 1200 }

function placed(id: string, role: 'item' | 'box', opts: { index?: number; w?: number; h?: number } = {}): HTMLElement {
  const el = document.createElement('div')
  el.className = 'pa-el'
  el.dataset.id = id
  el.dataset.type = 'image'
  el.dataset.catchRole = role
  if (opts.index) el.dataset.catchIndex = String(opts.index)
  const w = role === 'box' ? BOX.w : (opts.w ?? 150)
  const h = role === 'box' ? BOX.h : (opts.h ?? 150)
  const anim = document.createElement('div')
  anim.className = 'pa-el-anim'
  const img = document.createElement('img')
  img.src = `asset:${id}`
  anim.appendChild(img)
  el.appendChild(anim)
  Object.defineProperties(el, {
    offsetWidth: { value: w, configurable: true },
    offsetHeight: { value: h, configurable: true },
  })
  el.getBoundingClientRect = () =>
    role === 'box' ? rect(BOX.left + (parseFloat(el.style.translate) || 0), BOX.top, BOX.w, BOX.h) : rect(0, 200, w, h)
  return el
}

interface Board {
  box: HTMLElement
  /** The products standing in the box, left to right. */
  inBox: () => { left: number; top: number; w: number; h: number }[]
  play: (frames?: number) => void
  /** Run until the box holds at least `n` products (or we give up). */
  playUntil: (n: number) => void
  relayout: () => void
}

function board(params: Record<string, unknown> = {}, itemCount = 3, withBox = true): Board {
  vi.useFakeTimers()
  const paRoot = document.createElement('div')
  paRoot.className = 'pa-root'
  Object.defineProperty(paRoot, 'offsetWidth', { value: 1080, configurable: true })
  paRoot.getBoundingClientRect = () => rect(0, 0, 1080, 1920)
  document.body.appendChild(paRoot)

  const items = Array.from({ length: itemCount }, (_, i) => placed(`shoe${i + 1}`, 'item', { index: i + 1 }))
  const box = placed('box', 'box')
  for (const el of [...items, ...(withBox ? [box] : [])]) paRoot.appendChild(el)

  const root = document.createElement('div')
  paRoot.appendChild(root)
  let raf: FrameRequestCallback | null = null
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    raf = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})

  const ctx: GameContext = {
    root,
    assets: { src: (id) => (id ? `asset:${id}` : ''), size: () => ({ w: 100, h: 100 }) },
    sfx: { play: () => {} },
    rng: mulberry32(42),
    scale: () => 1,
    elementId: 'catch-game',
  } as GameContext

  const mod = createCatch()
  mod.mount(ctx, {
    speed: 3, spawnMs: 100, requireUnique: false, catches: 99, itemFallScale: 1, caughtFadeMs: 0,
    // The rig's own basket, used when no box element is placed.
    frontBasketWidth: BOX.w, frontBasketHeight: BOX.h,
    ...params,
  })
  mod.start()
  mod.relayout?.()

  let now = 0
  const px = (v: string): number => parseFloat(v) || 0
  const holder = withBox ? box : (paRoot.querySelector<HTMLElement>('[data-id="basket"]') as HTMLElement)
  return {
    box: holder,
    inBox: () =>
      Array.from(holder.querySelectorAll<HTMLElement>('div[style*="width"]'))
        .filter((el) => el.style.transformOrigin === 'bottom center')
        .map((el) => ({ left: px(el.style.left), top: px(el.style.top), w: px(el.style.width), h: px(el.style.height) }))
        .sort((a, b) => a.left - b.left),
    play: (frames = 120) => {
      for (let i = 0; i < frames; i++) {
        vi.advanceTimersByTime(100)
        now += 32
        raf?.(now)
      }
    },
    playUntil: (n) => {
      for (let i = 0; i < 600 && holder.querySelectorAll('div[style*="transform-origin"]').length < n; i++) {
        vi.advanceTimersByTime(100)
        now += 32
        raf?.(now)
      }
    },
    relayout: () => mod.relayout?.(),
  }
}

describe('the box collects the products it catches', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stands what it catches inside the box, the bottom row on its floor', () => {
    const b = board()
    b.play()
    const held = b.inBox()
    expect(held.length).toBeGreaterThan(1)
    for (const p of held) {
      expect(p.left).toBeGreaterThanOrEqual(0) // inside the left wall
      expect(p.left + p.w).toBeLessThanOrEqual(BOX.w) // and the right one
      expect(p.top).toBeGreaterThanOrEqual(0) // never poking out of the top
      expect(p.top + p.h).toBeLessThanOrEqual(BOX.h * 0.9 + 0.001) // never through the floor
    }
    // Something is actually standing ON the floor — the collection rests in the box rather
    // than floating somewhere inside it.
    expect(Math.max(...held.map((p) => p.top + p.h))).toBeCloseTo(BOX.h * 0.9, 3)
  })

  it('keeps them side by side rather than stacked on one spot', () => {
    const b = board()
    b.playUntil(3)
    const held = b.inBox()
    expect(held.length).toBeGreaterThan(1)
    // Few enough to be one row: each product starts where the last one ended.
    for (let i = 1; i < held.length; i++) expect(held[i].left).toBeGreaterThanOrEqual(held[i - 1].left + held[i - 1].w)
  })

  it('takes more and more without ever spilling over the sides', () => {
    const b = board()
    b.playUntil(2)
    const first = b.inBox()
    b.play(300)
    const later = b.inBox()
    expect(later.length).toBeGreaterThan(first.length)
    for (const p of later) {
      expect(p.left).toBeGreaterThanOrEqual(0)
      expect(p.left + p.w).toBeLessThanOrEqual(BOX.w)
      expect(p.top).toBeGreaterThanOrEqual(0)
    }
  })

  it('shrinks the products once the box is filling up', () => {
    const b = board()
    b.playUntil(2)
    const first = b.inBox()[0].w
    b.play(300)
    // A row's worth fits at full size; a boxful does not, so everything scales down
    // together rather than the last arrivals hanging over the rim.
    expect(b.inBox()[0].w).toBeLessThan(first)
  })

  it('keeps everything it has collected — nothing leaves the box', () => {
    const b = board()
    b.playUntil(3)
    const n = b.inBox().length
    b.play(200)
    expect(b.inBox().length).toBeGreaterThanOrEqual(n)
  })

  it('re-fits the row on a layout pass', () => {
    const b = board()
    b.play()
    const before = b.inBox()
    b.relayout()
    expect(b.inBox()).toEqual(before) // same box, same fit — stable, not drifting
  })

  it('draws what it collected at a real size — not scaled to nothing', () => {
    // The bug this guards: an empty "Caught Scales" field parsed as [0] rather than an
    // empty list, so every product landed at scale 0 and the box never appeared to collect
    // anything at all.
    const b = board()
    b.playUntil(2)
    for (const p of b.inBox()) {
      expect(p.w).toBeGreaterThan(0)
      expect(p.h).toBeGreaterThan(0)
    }
  })

  it('stands them in the built-in basket too, not just a placed box', () => {
    // The rig has no measured box: its size is the authored basket width/height. Reading
    // the placed box's measurements left every rig board's products unplaced — piled at the
    // container's origin behind the basket art, which reads as them vanishing on the way in.
    const b = board({}, 3, false)
    b.playUntil(2)
    const held = b.inBox()
    expect(held.length).toBeGreaterThan(1)
    for (const p of held) {
      expect(p.w).toBeGreaterThan(0)
      expect(p.left).toBeGreaterThanOrEqual(0)
      expect(p.left + p.w).toBeLessThanOrEqual(BOX.w)
    }
    expect(Math.max(...held.map((p) => p.top + p.h))).toBeCloseTo(BOX.h * 0.9, 3)
  })

  it('keeps a product it has caught for the rest of the game', () => {
    // Identity, not a count: the same node has to still be in the box, still sized, long
    // after it landed — no cleanup pass may reclaim it as if it were still falling.
    const b = board()
    b.playUntil(1)
    const first = b.box.querySelector<HTMLElement>('div[style*="transform-origin"]')!
    expect(first).toBeTruthy()
    b.play(400)
    expect(first.isConnected).toBe(true)
    expect(b.box.contains(first)).toBe(true)
    expect(parseFloat(first.style.width)).toBeGreaterThan(0)
    expect(first.style.opacity).toBe('1')
  })

  it('leaves the hand-placed offsets alone in Manual', () => {
    // The older per-item path: the author says exactly where each product sits.
    const b = board({ caughtStack: 'Manual', caughtItemXs: '0', caughtItemYs: '-5', caughtItemScales: '0.7' })
    b.play()
    const held = b.inBox()
    expect(held.length).toBeGreaterThan(0)
    for (const p of held) expect(p.top).toBeCloseTo(-5, 3) // the authored Y, not the box floor
  })
})
