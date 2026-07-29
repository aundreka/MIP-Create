// Behavior test for the Flipbook page-turn game. The things that matter and have
// each been wrong at some point: the art is drawn true to its own scale and never
// sliced or stretched; the shut cover sits ON the right page; the fold is a fixed
// point and the book never translates (a book that slides sideways as it opens does
// not read as a book); a turn lands exactly on the next opening's left page; and the
// last turn wins exactly once.

import { afterEach, describe, expect, it } from 'vitest'
import { createFlipbook } from './flipbook'
import { mulberry32, type GameContext } from './types'

const VW = 400
const VH = 520
// Cover, left pages and right pages are three DIFFERENT widths on purpose — nothing
// may assume a cover is one page wide, or that the two pages match.
const ART: Record<string, { w: number; h: number }> = {
  'cover.png': { w: 700, h: 1000 },
  'l1.png': { w: 580, h: 1000 },
  'l2.png': { w: 580, h: 1000 },
  'r1.png': { w: 620, h: 1000 },
  'r2.png': { w: 620, h: 1000 },
}
const PAGES = { cover: 'cover.png', leftPages: ['l1.png', 'l2.png'], rightPages: ['r1.png', 'r2.png'] }

interface Book {
  mod: ReturnType<typeof createFlipbook>
  root: HTMLDivElement
  played: string[]
  completed: () => boolean
  won: () => boolean
  at: (tag: string) => HTMLElement
  img: (tag: string) => string
  angle: () => number
}

function makeBook(params: Record<string, unknown> = {}): Book {
  const root = document.createElement('div')
  document.body.appendChild(root)
  // jsdom has no layout: stub the slot's box so the book can size itself.
  Object.defineProperty(root, 'clientWidth', { value: VW, configurable: true })
  Object.defineProperty(root, 'clientHeight', { value: VH, configurable: true })
  const played: string[] = []
  const ctx: GameContext = {
    root,
    assets: { src: (id) => (id ? String(id) : ''), size: (id) => (id ? ART[id] ?? null : null) },
    sfx: { play: (e) => played.push(e) },
    rng: mulberry32(7),
    scale: () => 1,
  }
  const mod = createFlipbook()
  mod.mount(ctx, { flipMs: 200, ...PAGES, ...params }) // 200ms is the module's floor
  mod.start()
  let done = false
  let win = false
  mod.onComplete(() => (done = true))
  mod.onWin?.(() => (win = true))
  const at = (tag: string): HTMLElement => root.querySelector(`[data-fb="${tag}"]`) as HTMLElement
  return {
    mod,
    root,
    played,
    completed: () => done,
    won: () => win,
    at,
    img: (tag) => (/url\("?([^")]*)"?\)/.exec(at(tag).style.backgroundImage) ?? ['', ''])[1],
    angle: () => {
      const m = /rotateY\((-?[\d.]+)deg\)/.exec(at('leaf').style.transform)
      return m ? parseFloat(m[1]) : NaN
    },
  }
}

const ev = (type: string, clientX: number): MouseEvent => new MouseEvent(type, { clientX, bubbles: true })
const px = (b: Book, tag: string, prop: 'width' | 'height' | 'left' | 'top'): number => parseFloat(b.at(tag).style[prop])
/** The fold: the right page's left edge, which is also the leaf's hinge. */
const fold = (b: Book): number => px(b, 'under-right', 'left')
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const settle = (): Promise<void> => wait(320)

function drag(b: Book, dx: number): void {
  b.root.dispatchEvent(ev('pointerdown', 300))
  b.root.dispatchEvent(ev('pointermove', 300 - dx))
  b.root.dispatchEvent(ev('pointerup', 300 - dx))
}

const BH = VH * 0.98

describe('flipbook', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  // ---- art is drawn true to scale ------------------------------------------

  it('draws every page at the book height with its own art width, never sliced', () => {
    const b = makeBook({ hasCover: false })
    expect(px(b, 'under-left', 'height')).toBeCloseTo(BH, 1)
    expect(px(b, 'under-left', 'width')).toBeCloseTo(BH * 0.58, 1) // its own 580x1000
    expect(px(b, 'under-right', 'width')).toBeCloseTo(BH * 0.62, 1) // its own 620x1000
    // Whole images, filling boxes already cut to their shape — no slicing, no squeeze.
    for (const tag of ['under-left', 'under-right', 'leaf-front', 'leaf-back'])
      expect(b.at(tag).style.backgroundSize).toBe('100% 100%')
  })

  it('lets the pages meet at the fold with no gap and no overlap', () => {
    const b = makeBook({ hasCover: false })
    expect(px(b, 'under-left', 'left') + px(b, 'under-left', 'width')).toBeCloseTo(fold(b), 3)
  })

  it('sizes the cover from its own art too, scaling width with height', () => {
    const full = makeBook()
    expect(px(full, 'leaf', 'width')).toBeCloseTo(BH * 0.7, 1)
    expect(px(full, 'leaf', 'height')).toBeCloseTo(BH, 1)
    const small = makeBook({ coverScale: 60 })
    expect(px(small, 'leaf', 'height')).toBeCloseTo(BH * 0.6, 1)
    expect(px(small, 'leaf', 'width')).toBeCloseTo(BH * 0.6 * 0.7, 1) // shape held
  })

  it('falls back to the page-aspect param for art of unknown size', () => {
    const b = makeBook({ hasCover: false, aspect: 0.5, leftPages: ['x.png'], rightPages: ['y.png'], spreads: 2 })
    expect(px(b, 'under-left', 'width')).toBeCloseTo(BH * 0.5, 1)
  })

  // ---- the shut book -------------------------------------------------------

  it('sits the shut cover ON the right page, starting at the fold', () => {
    const b = makeBook()
    expect(b.img('leaf-front')).toBe('cover.png')
    expect(px(b, 'leaf', 'left')).toBeCloseTo(fold(b), 3) // it covers the right page
    // ...and nothing else shows: art with transparent margins can't leak the pages.
    expect(b.at('under-left').style.opacity).toBe('0')
    expect(b.at('under-right').style.opacity).toBe('0')
    expect(b.angle()).toBe(0)
  })

  it('centres the shut cover in the slot', () => {
    const b = makeBook()
    expect(px(b, 'leaf', 'left') + px(b, 'leaf', 'width') / 2).toBeCloseTo(VW / 2, 1)
  })

  // ---- the turn ------------------------------------------------------------

  it('never moves the fold — not at any point of the turn', () => {
    const b = makeBook()
    const at0 = fold(b)
    expect(b.at('book').style.transform).toBe('') // the book itself never translates
    const travel = px(b, 'leaf', 'width') * 0.9
    b.root.dispatchEvent(ev('pointerdown', 300))
    for (const f of [0.25, 0.5, 0.75, 1]) {
      b.root.dispatchEvent(ev('pointermove', 300 - travel * f))
      expect(fold(b)).toBeCloseTo(at0, 3)
      expect(px(b, 'leaf', 'left')).toBeCloseTo(at0, 3) // hinged on it, too
    }
  })

  it('holds the cover at its own size until 90°, then lands on the next left page', () => {
    const b = makeBook()
    const travel = px(b, 'leaf', 'width') * 0.9
    b.root.dispatchEvent(ev('pointerdown', 300))
    // Before 90° the cover's own face is what you see, so it must not change shape.
    b.root.dispatchEvent(ev('pointermove', 300 - travel * 0.5))
    expect(px(b, 'leaf', 'width')).toBeCloseTo(BH * 0.7, 1)
    // Flat at 180° it IS the left page of the opening it reveals.
    b.root.dispatchEvent(ev('pointermove', 300 - travel))
    expect(px(b, 'leaf', 'width')).toBeCloseTo(BH * 0.58, 1)
    expect(px(b, 'leaf', 'height')).toBeCloseTo(BH, 1)
  })

  it('stages the next opening under the leaf before it lifts', () => {
    const b = makeBook()
    expect(b.img('under-right')).toBe('r1.png') // revealed as the cover swings off it
    expect(b.img('leaf-back')).toBe('l1.png') // and this is what the cover becomes
  })

  it('turns the page and lands on the next opening', async () => {
    const b = makeBook()
    drag(b, 200)
    expect(b.played).toContain('flip')
    await settle()
    expect(b.angle()).toBe(0)
    expect(b.img('under-left')).toBe('l1.png')
    expect(b.img('leaf-front')).toBe('r1.png') // the right page is now the next leaf
    expect(b.img('leaf-back')).toBe('l2.png')
    expect(b.img('under-right')).toBe('r2.png')
    expect(b.completed()).toBe(false)
  })

  it('turns on the smallest leftward swipe, finishing the turn on its own', async () => {
    const b = makeBook()
    b.root.dispatchEvent(ev('pointerdown', 300))
    b.root.dispatchEvent(ev('pointermove', 290)) // a 10px nudge — nowhere near over
    expect(b.angle()).toBeLessThan(0) // it follows the finger...
    expect(b.angle()).toBeGreaterThan(-30) // ...but has barely moved
    b.root.dispatchEvent(ev('pointerup', 290))
    await settle()
    expect(b.img('under-left')).toBe('l1.png') // ...and still lands the turn
  })

  it('can never be shut again — a backward drag settles onto the page you are on', async () => {
    const b = makeBook()
    drag(b, 200) // open it
    await settle()
    const open = { left: b.img('under-left'), right: b.img('under-right') }
    // Haul it the other way, hard.
    b.root.dispatchEvent(ev('pointerdown', 200))
    b.root.dispatchEvent(ev('pointermove', 600))
    expect(b.angle()).toBe(0) // the page does not come back
    b.root.dispatchEvent(ev('pointerup', 600))
    await settle()
    expect(b.img('under-left')).toBe(open.left)
    expect(b.img('under-right')).toBe(open.right)
    expect(b.img('leaf-front')).not.toBe('cover.png') // the cover is gone for good
  })

  it('turns on a tap as well as a drag', async () => {
    const b = makeBook()
    b.root.dispatchEvent(ev('pointerdown', 300))
    b.root.dispatchEvent(ev('pointerup', 300))
    await settle()
    expect(b.img('under-left')).toBe('l1.png')
  })

  it('wins on the last turn, once, and then stops accepting turns', async () => {
    const b = makeBook()
    drag(b, 200) // cover -> opening 1
    await settle()
    expect(b.won()).toBe(false)
    drag(b, 200) // opening 1 -> opening 2 (the last)
    expect(b.won()).toBe(true) // fires as the committed turn starts, not after it lands
    await settle()
    expect(b.completed()).toBe(true)
    expect(b.at('leaf').style.display).toBe('none')
    expect(b.mod.getHint()).toBeNull()
    const flips = b.played.filter((e) => e === 'flip').length
    drag(b, 200)
    await settle()
    expect(b.played.filter((e) => e === 'flip').length).toBe(flips)
  })

  it('lands a page dragged all the way over, without waiting for the finger', async () => {
    const b = makeBook({ hasCover: false })
    const travel = px(b, 'leaf', 'width') * 0.9
    b.root.dispatchEvent(ev('pointerdown', 300))
    b.root.dispatchEvent(ev('pointermove', 300 - travel)) // fully over, still held
    await settle()
    // Committed on its own — otherwise the turn looks done while it isn't, and
    // dragging back would undo a page the player has already turned.
    expect(b.img('under-left')).toBe('l2.png')
  })

  // ---- once it is won ------------------------------------------------------

  it('sounds a separate cue for the last page, held back so it lands on the reveal', async () => {
    const b = makeBook({ lastPageDelayMs: 120 })
    drag(b, 200) // cover -> opening 1: an ordinary turn
    expect(b.played).toEqual(['flip'])
    await settle()
    drag(b, 200) // opening 1 -> the last opening
    expect(b.played).toEqual(['flip', 'flip']) // not yet — it waits
    await settle()
    expect(b.played).toEqual(['flip', 'flip', 'lastPage'])
  })

  it('never sounds the last-page cue into a scene that has moved on', async () => {
    const b = makeBook({ lastPageDelayMs: 120 })
    drag(b, 200)
    await settle()
    drag(b, 200)
    b.mod.destroy() // the scene redirects before the delay is up
    await settle()
    expect(b.played).not.toContain('lastPage')
  })

  it('bounces the book on the last page — smoothly, settling exactly back', async () => {
    const b = makeBook({ lastPagePop: 10 })
    const book = b.at('book')
    const scaleNow = (): number => parseFloat(/scale\(([\d.]+)\)/.exec(book.style.transform)?.[1] ?? '1')
    drag(b, 200)
    await settle()
    drag(b, 200)
    // Sample the whole bounce at roughly frame rate — it starts the instant the page
    // lands, with no delay of its own.
    const seen: number[] = []
    for (let i = 0; i < 42; i++) {
      await wait(16)
      seen.push(scaleNow())
    }
    expect(Math.max(...seen)).toBeCloseTo(1.1, 2) // it swelled to the 10% asked for
    expect(Math.min(...seen)).toBeLessThan(1) // ...and rebounded past its size, as a bounce does
    // Smooth: no frame jumps by more than a small fraction of the whole travel.
    const steps = seen.slice(1).map((s, i) => Math.abs(s - seen[i]))
    expect(Math.max(...steps)).toBeLessThan(0.05)
    expect(book.style.transformOrigin).toContain('px') // about the fold, not the slot
    expect(scaleNow()).toBe(1) // settles at exactly its own size, never a hair off
  })

  it('holds the bounce back when given its own delay, apart from the sound', async () => {
    const b = makeBook({ lastPagePop: 10, lastPagePopDelayMs: 250, lastPageDelayMs: 0 })
    const book = b.at('book')
    drag(b, 200)
    await settle()
    drag(b, 200)
    await wait(120)
    expect(b.played).toContain('lastPage') // the sound has already gone...
    expect(book.style.transform).toBe('') // ...and the bounce is still waiting
    await wait(250)
    expect(book.style.transform).not.toBe('')
  })

  it('can be told not to bounce at all', async () => {
    const b = makeBook({ lastPagePop: 0, lastPageDelayMs: 50 })
    drag(b, 200)
    await settle()
    drag(b, 200)
    await settle()
    expect(b.at('book').style.transform).toBe('')
  })

  it('locks the book the moment the winning turn starts, not when it lands', async () => {
    const b = makeBook()
    drag(b, 200) // cover -> opening 1
    await settle()
    // The winning turn is now IN FLIGHT: the win has been reported but the page has
    // not landed yet, and the book must already be untouchable.
    const flips = (): number => b.played.filter((e) => e === 'flip').length
    const before = flips()
    drag(b, 200)
    expect(b.won()).toBe(true)
    expect(b.completed()).toBe(false) // still mid-turn
    b.root.dispatchEvent(ev('pointerdown', 300))
    b.root.dispatchEvent(ev('pointermove', 500)) // drag backwards, hard
    b.root.dispatchEvent(ev('pointerup', 500))
    expect(flips()).toBe(before + 1) // only the winning flip was heard
    await settle()
    expect(b.completed()).toBe(true)
  })

  it('stays fully open and unflippable through the post-win delay', async () => {
    const b = makeBook()
    drag(b, 200)
    await settle()
    drag(b, 200)
    await settle()
    expect(b.completed()).toBe(true)
    const open = { left: b.img('under-left'), right: b.img('under-right') }
    // The scene sits on the win for a couple of seconds before redirecting — the book
    // has to survive anything done to it in that window.
    for (let i = 0; i < 3; i++) {
      drag(b, 250)
      b.root.dispatchEvent(ev('pointerdown', 300))
      b.root.dispatchEvent(ev('pointerup', 300))
      await settle()
    }
    expect(b.at('leaf').style.display).toBe('none')
    expect(b.img('under-left')).toBe(open.left)
    expect(b.img('under-right')).toBe(open.right)
    expect(b.angle()).toBe(0)
  })

  // ---- layout --------------------------------------------------------------

  it('scales the whole book, and is never clipped by its slot', () => {
    const b = makeBook({ bookScale: 160 })
    expect(b.root.style.overflow).toBe('visible')
    expect(px(b, 'leaf', 'height')).toBeCloseTo(BH * 1.6, 1)
    expect(px(b, 'leaf', 'height')).toBeGreaterThan(VH) // bigger than its slot, on purpose
  })

  it('hints a slide from the page edge in toward the fold', () => {
    const b = makeBook()
    b.at('leaf').getBoundingClientRect = () => ({ left: 200, right: 392, top: 40, bottom: 486, width: 192, height: 446 }) as DOMRect
    const hint = b.mod.getHint()
    expect(hint?.kind).toBe('slide')
    expect(hint!.to.x).toBeLessThan(hint!.from.x)
    expect(hint!.from.y).toBeCloseTo(hint!.to.y, 5)
  })

  it('draws no decoration of its own — the artwork owns the look', () => {
    const b = makeBook({ hasCover: false })
    expect(b.at('gutter')).toBeNull()
    expect(b.at('shadow')).toBeNull()
    expect(b.at('front-shade').style.opacity).toBe('0')
    expect(b.at('back-shade').style.opacity).toBe('0')
    for (const tag of ['leaf-front', 'leaf-back', 'under-left', 'under-right']) expect(b.at(tag).style.boxShadow).toBe('')
  })

  const halfway = (b: Book): void => {
    const travel = px(b, 'leaf', 'width') * 0.9
    b.root.dispatchEvent(ev('pointerdown', 300))
    b.root.dispatchEvent(ev('pointermove', 300 - travel * 0.5))
  }

  // A turning sheet must never be SHEARED. Skewing makes its free edge taller while
  // the 3D rotation makes that same edge shorter — two contradictory depth cues, and
  // the page reads as a crooked rhombus instead of paper. This is a regression guard.
  it('turns the page with rotation alone — the faces are never sheared', () => {
    for (const opts of [{ hasCover: false }, { hasCover: false, pageCurl: 60 }, {}]) {
      const b = makeBook(opts)
      halfway(b)
      expect(b.at('leaf-front').style.transform).not.toContain('skew')
      expect(b.at('leaf-back').style.transform).not.toContain('skew')
      expect(b.at('leaf').style.transform).toContain('rotateY')
    }
  })

  it('dog-ears a turning page but keeps the cover rigid', () => {
    // The page's bottom-right corner is cut off the sheet and the flap folded back.
    const page = makeBook({ hasCover: false, pageCurl: 60 })
    halfway(page)
    expect(page.at('leaf-front').style.clipPath).toContain('polygon')
    expect(page.at('fold').style.display).toBe('block')
    expect(page.img('fold-art')).toBe('l2.png') // the flap shows the sheet's reverse
    // A hardback cover does not fold — it stays a flat, rigid board.
    const cover = makeBook({ pageCurl: 60 })
    halfway(cover)
    expect(cover.at('leaf-front').style.clipPath).toBe('')
    expect(cover.at('fold').style.display).toBe('none')
  })

  // The whole point of the flap is that its skin LINES UP: it is the sheet's reverse,
  // reflected in the crease. That is one matrix, so it can be checked exactly rather
  // than eyeballed — apply it and see where the corners land.
  it('skins the flap with the reverse reflected in the crease, registered exactly', () => {
    const b = makeBook({ hasCover: false, pageCurl: 60 })
    const travel = px(b, 'leaf', 'width') * 0.9
    b.root.dispatchEvent(ev('pointerdown', 300))
    b.root.dispatchEvent(ev('pointermove', 300 - travel * 0.5))
    const w = px(b, 'leaf', 'width')
    const h = px(b, 'leaf', 'height')
    const m = /matrix\(([^)]+)\)/.exec(b.at('fold-art').style.transform)![1].split(',').map(Number)
    const map = ([x, y]: [number, number]): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
    const f = h - m[5] // the matrix encodes the fold depth
    expect(f).toBeGreaterThan(0)
    // The back art's bottom-LEFT corner is what the turned-up corner reveals; it must
    // land on the flap's apex.
    expect(map([0, h])).toEqual([expect.closeTo(w - f, 1), expect.closeTo(h - f, 1)])
    // And the crease itself must be pinned — both of its ends map to themselves, which
    // is what stops the skin sliding against the page it is folded off.
    expect(map([0, h - f])).toEqual([expect.closeTo(w, 1), expect.closeTo(h - f, 1)])
    expect(map([f, h])).toEqual([expect.closeTo(w - f, 1), expect.closeTo(h, 1)])
  })

  it('creases on a curve, not a knife edge, and only through the turn', () => {
    const b = makeBook({ hasCover: false, pageCurl: 60 })
    expect(b.at('fold').style.display).toBe('none') // at rest
    const travel = px(b, 'leaf', 'width') * 0.9
    b.root.dispatchEvent(ev('pointerdown', 300))
    b.root.dispatchEvent(ev('pointermove', 300 - travel * 0.5))
    // Many points along the crease, and they do not sit on one straight line.
    const pts = [...b.at('fold').style.clipPath.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map((g) => [Number(g[1]), Number(g[2])])
    expect(pts.length).toBeGreaterThan(5)
    const [ax, ay] = pts[0]
    const [bx, by] = pts[pts.length - 2] // last crease point (the final vertex is the corner)
    const offLine = pts.slice(1, -2).map(([x, y]) => Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / Math.hypot(bx - ax, by - ay))
    expect(Math.max(...offLine)).toBeGreaterThan(0.5) // it bows
    const peak = Math.hypot(pts[0][0] - pts[pts.length - 2][0], pts[0][1] - pts[pts.length - 2][1])
    b.root.dispatchEvent(ev('pointermove', 300 - travel * 0.97))
    const late = [...b.at('fold').style.clipPath.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map((g) => [Number(g[1]), Number(g[2])])
    // Creased hardest side-on; flattening out again as the sheet comes to rest.
    expect(Math.hypot(late[0][0] - late[late.length - 2][0], late[0][1] - late[late.length - 2][1])).toBeLessThan(peak)
  })

  it('leaves the page plain by default — the dog-ear is opt-in', () => {
    // Same-colour page art has nothing to show in a fold, so it only reads as a notch
    // cut out of the sheet. Off unless the art actually differs across the sheet.
    const b = makeBook({ hasCover: false })
    halfway(b)
    expect(b.at('fold').style.display).toBe('none')
    expect(b.at('leaf-front').style.clipPath).toBe('')
  })

  it('turns shading on only when asked', () => {
    const b = makeBook({ shade: true })
    expect(parseFloat(b.at('back-shade').style.opacity)).toBeGreaterThan(0)
  })

  it('forces a turnable book when it starts open with only one opening set', () => {
    const b = makeBook({ hasCover: false, spreads: 1 })
    expect(b.at('leaf').style.display).toBe('block')
    expect(b.mod.getHint()).not.toBeNull()
  })
})
