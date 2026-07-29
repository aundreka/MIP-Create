import { describe, expect, it } from 'vitest'
import { anchorFactors, flipbookBoxes, flipbookOpts, resizeBox } from './geometry'
import { createFlipbook } from '../../runtime/games/flipbook'
import { mulberry32, type GameContext } from '../../runtime/games/types'

describe('anchorFactors', () => {
  it('maps anchor names to box-origin factors', () => {
    expect(anchorFactors('center')).toEqual({ ax: 0.5, ay: 0.5 })
    expect(anchorFactors('top-left')).toEqual({ ax: 0, ay: 0 })
    expect(anchorFactors('bottom-right')).toEqual({ ax: 1, ay: 1 })
    expect(anchorFactors('top')).toEqual({ ax: 0.5, ay: 0 })
    expect(anchorFactors('right')).toEqual({ ax: 1, ay: 0.5 })
  })
})

describe('resizeBox — opposite edge stays fixed', () => {
  it('top-left anchor: dragging the east edge moves only the right edge', () => {
    const b = resizeBox({ anchor: 'top-left', x: 100, y: 50, w: 200, h: 100 }, 1, 0, 40, 0)
    expect(b).toEqual({ x: 100, y: 50, w: 240, h: 100 }) // left fixed, right +40
  })
  it('top-left anchor: dragging the west edge moves the left edge, right fixed', () => {
    const b = resizeBox({ anchor: 'top-left', x: 100, y: 50, w: 200, h: 100 }, -1, 0, -40, 0)
    // right was 300; left moves to 60 → x (=left for top-left) = 60, w = 240
    expect(b).toEqual({ x: 60, y: 50, w: 240, h: 100 })
  })
  it('center anchor: east drag moves the center by half the delta (right edge follows pointer)', () => {
    const b = resizeBox({ anchor: 'center', x: 100, y: 50, w: 200, h: 100 }, 1, 0, 40, 0)
    // left edge (0) fixed, right 200→240, so center x = 120, w = 240
    expect(b).toEqual({ x: 120, y: 50, w: 240, h: 100 })
  })
  it('corner drag resizes both axes, anchoring the opposite corner', () => {
    const b = resizeBox({ anchor: 'top-left', x: 0, y: 0, w: 100, h: 100 }, 1, 1, 50, 30)
    expect(b).toEqual({ x: 0, y: 0, w: 150, h: 130 })
  })
  it('clamps to the minimum and keeps the opposite edge fixed', () => {
    const b = resizeBox({ anchor: 'top-left', x: 0, y: 0, w: 100, h: 100 }, -1, 0, 200, 0, 8)
    // dragging left edge way past right → width clamps to 8, right edge (100) fixed
    expect(b.w).toBe(8)
    expect(b.x).toBe(92) // left = right(100) - 8
  })
})

// The canvas overlay draws the fold line and the cover handles from these helpers,
// while the game itself lays the book out independently — if the two ever drift, you
// would drag a line that doesn't sit on the fold you can see. So compare them
// directly: mount the real game into a stubbed slot and read back what it rendered.
describe('flipbook overlay geometry tracks the game', () => {
  const SLOT = { x: 0, y: 0, w: 400, h: 520 }
  // A 700x1000 cover sitting on 620x1000 right pages, with 580x1000 left pages —
  // deliberately three different widths, since nothing may assume they match.
  const ASSETS = {
    'cover.png': { w: 700, h: 1000 },
    'l1.png': { w: 580, h: 1000 },
    'l2.png': { w: 580, h: 1000 },
    'r1.png': { w: 620, h: 1000 },
    'r2.png': { w: 620, h: 1000 },
  }
  const PARAMS = { cover: 'cover.png', leftPages: ['l1.png', 'l2.png'], rightPages: ['r1.png', 'r2.png'], aspect: 0.6 }
  /** What the canvas overlay computes, for the same params the game is mounted with. */
  const overlay = (extra: Record<string, unknown> = {}): ReturnType<typeof flipbookBoxes> =>
    flipbookBoxes(SLOT, flipbookOpts({ ...PARAMS, ...extra }, ASSETS))

  interface Rendered {
    book: { x: number; w: number; h: number }
    cover: { x: number; y: number; w: number; h: number }
  }

  /** Mount the real game and read the boxes it produced, in slot coordinates. */
  function render(params: Record<string, unknown>): Rendered {
    const root = document.createElement('div')
    document.body.appendChild(root)
    Object.defineProperty(root, 'clientWidth', { value: SLOT.w, configurable: true })
    Object.defineProperty(root, 'clientHeight', { value: SLOT.h, configurable: true })
    const ctx: GameContext = {
      root,
      assets: { src: (id) => (id ? String(id) : ''), size: (id) => (id ? ASSETS[id as keyof typeof ASSETS] ?? null : null) },
      sfx: { play: () => {} },
      rng: mulberry32(1),
      scale: () => 1,
    }
    const mod = createFlipbook()
    mod.mount(ctx, { ...PARAMS, ...params })
    const at = (tag: string): HTMLElement => root.querySelector(`[data-fb="${tag}"]`) as HTMLElement
    const n = (el: HTMLElement, p: 'left' | 'top' | 'width' | 'height'): number => parseFloat(el.style[p]) || 0
    const ul = at('under-left')
    const ur = at('under-right')
    const leaf = at('leaf')
    // The game positions its pages against a fixed fold; reconstruct the open book's
    // box from the two under-pages, which is what the overlay's `book` describes.
    const out: Rendered = {
      book: { x: n(ul, 'left'), w: n(ul, 'width') + n(ur, 'width'), h: n(ul, 'height') },
      cover: { x: n(leaf, 'left'), y: n(leaf, 'top'), w: n(leaf, 'width'), h: n(leaf, 'height') },
    }
    mod.destroy()
    root.remove()
    return out
  }

  /** Every box the overlay draws must land on the box the game rendered. */
  const agree = (extra: Record<string, unknown> = {}): void => {
    const o = overlay(extra)
    const a = render(extra)
    expect(o.book.w).toBeCloseTo(a.book.w, 1)
    expect(o.book.h).toBeCloseTo(a.book.h, 1)
    expect(o.book.x).toBeCloseTo(a.book.x, 1)
    expect(o.cover!.x).toBeCloseTo(a.cover.x, 1)
    expect(o.cover!.y).toBeCloseTo(a.cover.y, 1)
    expect(o.cover!.w).toBeCloseTo(a.cover.w, 1)
    expect(o.cover!.h).toBeCloseTo(a.cover.h, 1)
  }

  for (const bookScale of [100, 160, 50]) it(`agrees at book ${bookScale}%`, () => agree({ bookScale }))
  for (const coverScale of [100, 65, 130]) it(`agrees at cover ${coverScale}%`, () => agree({ coverScale }))
  it('agrees with both moved at once', () => agree({ bookScale: 140, coverScale: 80 }))
  it('agrees with no cover at all', () => {
    const o = overlay({ hasCover: false })
    const a = render({ hasCover: false })
    expect(o.cover).toBeNull()
    expect(o.book.x).toBeCloseTo(a.book.x, 1)
    expect(o.book.w).toBeCloseTo(a.book.w, 1)
  })

  it('sizes each page from its own art, not from a shared ratio', () => {
    const { book, spineX } = overlay()
    // Left 580x1000 and right 620x1000 at the same height ⇒ different widths.
    expect(spineX - book.x).toBeCloseTo(book.h * 0.58, 1)
    expect(book.x + book.w - spineX).toBeCloseTo(book.h * 0.62, 1)
  })

  it('puts the shut cover on the right page, starting at the fold', () => {
    const { cover, spineX, book } = overlay()
    expect(cover!.x).toBeCloseTo(spineX, 3) // it covers the right page, from the fold out
    expect(cover!.w).toBeCloseTo(book.h * 0.7, 1) // and is true to its own 700x1000 art
  })

  it('agrees with the open book centred instead of the cover', () => agree({ anchor: 'spread' }))

  it('centres whichever the anchor names, and keeps the whole open book on screen', () => {
    const onCover = overlay()
    expect(onCover.cover!.x + onCover.cover!.w / 2).toBeCloseTo(SLOT.x + SLOT.w / 2, 1)
    const onSpread = overlay({ anchor: 'spread' })
    expect(onSpread.book.x + onSpread.book.w / 2).toBeCloseTo(SLOT.x + SLOT.w / 2, 1)
  })

  it('falls back to the page-aspect param for art of unknown size', () => {
    const o = flipbookBoxes(SLOT, { pageAspect: 0.5, hasCover: false })
    expect(o.book.w).toBeCloseTo(o.book.h * 1.0, 3) // two 0.5-ratio pages
  })
})
