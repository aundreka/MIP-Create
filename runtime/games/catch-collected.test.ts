// A product's PLACE IN THE BOX: an element the author positioned inside the box on the
// canvas, hidden while the game runs until that item is caught. The falling copy then turns
// into it — no layout, no packing, exactly where they put it. Layer several over each other
// on the canvas and the box fills up as a stack.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCatch } from './catch'
import { mulberry32, type GameContext } from './types'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect

const BOX = { w: 400, h: 300, left: 340, top: 1200 }
const OFF = 'pa-combo-off'

/** The four sides of an `inset(...)` clip: the top stays the literal rim-is-open marker,
 * the rest are px — positive where the box actually cuts the element, negative where the
 * element does not reach that edge at all. */
function insets(el: HTMLElement): { top: string; right: number; bottom: number; left: number } {
  const parts = /inset\(([^)]+)\)/.exec(el.style.clipPath)?.[1].trim().split(/\s+/) ?? []
  const [top, right, bottom, left] = parts
  return { top, right: parseFloat(right), bottom: parseFloat(bottom), left: parseFloat(left) }
}

function placed(id: string, role: 'item' | 'box' | 'collected', opts: { index?: number; z?: number; at?: DOMRect } = {}): HTMLElement {
  const el = document.createElement('div')
  el.className = 'pa-el'
  el.dataset.id = id
  el.dataset.type = 'image'
  el.dataset.catchRole = role
  if (opts.index) el.dataset.catchIndex = String(opts.index)
  if (opts.z != null) el.style.zIndex = String(opts.z)
  const w = role === 'box' ? BOX.w : 150
  const h = role === 'box' ? BOX.h : 150
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
  const slide = (): number => parseFloat(el.style.translate) || 0
  el.getBoundingClientRect = () =>
    role === 'box'
      ? rect(BOX.left + slide(), BOX.top, BOX.w, BOX.h)
      : opts.at
        ? rect(opts.at.left + slide(), opts.at.top, opts.at.width, opts.at.height)
        : rect(0, 200, w, h)
  return el
}

interface Board {
  paRoot: HTMLElement
  box: HTMLElement
  places: HTMLElement[]
  shown: () => string[]
  /** What is standing loose in the box, packed by the game rather than placed. */
  packed: () => number
  playUntil: (n: number) => void
  /** Keep playing for a while, whatever lands. */
  playUntilCatches: (frames: number) => void
  /** Rebuild the board with these places instead, and report their clips. */
  remount: (places: HTMLElement[]) => void
  /** Run the pending animation frames and timers out. */
  settle: () => void
  /** The falling copy currently flying into its place, if one is. */
  flying: () => HTMLElement | undefined
  /** Play until a place fills, reporting the bottom edge of the copy that was swapped —
   * the deepest THAT copy ever got before turning into its placed art. */
  caughtCopyBottom: () => number
  drag: (x: number) => void
  destroy: () => void
}

function board(placeCount = 3, itemCount = 3, params: Record<string, unknown> = {}): Board {
  vi.useFakeTimers()
  const paRoot = document.createElement('div')
  paRoot.className = 'pa-root'
  Object.defineProperty(paRoot, 'offsetWidth', { value: 1080, configurable: true })
  paRoot.getBoundingClientRect = () => rect(0, 0, 1080, 1920)
  document.body.appendChild(paRoot)

  const items = Array.from({ length: itemCount }, (_, i) => placed(`shoe${i + 1}`, 'item', { index: i + 1 }))
  // Placed in the box, deliberately out of z order so the pile's own layering is testable.
  const places = Array.from({ length: placeCount }, (_, i) => placed(`in_box_${i + 1}`, 'collected', { index: i + 1, z: 30 - i }))
  const box = placed('box', 'box', { z: 20 })
  for (const el of [...items, ...places, box]) paRoot.appendChild(el)

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
  mod.mount(ctx, { speed: 3, spawnMs: 100, requireUnique: false, catches: 99, itemFallScale: 1, basketLocked: 'Unlocked', ...params })
  mod.start()
  mod.relayout?.()

  let now = 0
  return {
    paRoot,
    box,
    places,
    shown: () => places.filter((el) => !el.classList.contains(OFF)).map((el) => el.dataset.id!),
    packed: () => box.querySelectorAll('div[style*="transform-origin"]').length,
    playUntil: (n) => {
      for (let i = 0; i < 600 && places.filter((el) => !el.classList.contains(OFF)).length < n; i++) {
        vi.advanceTimersByTime(100)
        now += 32
        raf?.(now)
      }
    },
    playUntilCatches: (frames) => {
      for (let i = 0; i < frames * 20; i++) {
        vi.advanceTimersByTime(100)
        now += 32
        raf?.(now)
      }
    },
    remount: (extra) => {
      for (const el of extra) paRoot.appendChild(el)
      mod.destroy?.()
      const m2 = createCatch()
      m2.mount(ctx, { speed: 3, spawnMs: 100, requireUnique: false, catches: 99, itemFallScale: 1, basketLocked: 'Unlocked' })
      m2.start()
      m2.relayout?.()
    },
    caughtCopyBottom: () => {
      const filled = (): number => places.filter((el) => !el.classList.contains(OFF)).length
      for (let i = 0; i < 600; i++) {
        const before = filled()
        // The falling copies are the only unlabelled children — the soften patches carry ids.
        const seen = new Map<HTMLElement, number>()
        for (const d of paRoot.querySelectorAll<HTMLElement>('[data-id="catch_drops"] > div:not([data-id])')) {
          seen.set(d, (parseFloat(d.style.top) || 0) + (parseFloat(d.style.height) || 0))
        }
        vi.advanceTimersByTime(100)
        now += 32
        raf?.(now)
        if (filled() <= before) continue
        // The copy that turned into its place is the one that stopped falling this frame:
        // it is either gone already, or flying into the place under a transition. Copies
        // that MISSED the box are still falling untouched, far below — hence the nearest.
        const caught = [...seen].filter(([el]) => !el.isConnected || el.style.transition !== '').map(([, bottom]) => bottom)
        if (caught.length) return Math.min(...caught)
      }
      return -1
    },
    flying: () =>
      Array.from(paRoot.querySelectorAll<HTMLElement>('[data-id="catch_drops"] > div:not([data-id])')).find((el) => el.style.transition !== ''),
    settle: () => {
      raf?.(now)
      raf?.(now)
      vi.advanceTimersByTime(1000)
    },
    drag: (x) => {
      const down = new Event('pointerdown', { bubbles: true, cancelable: true }) as PointerEvent
      Object.defineProperties(down, { clientX: { value: BOX.left + 10 }, clientY: { value: BOX.top + 10 } })
      box.dispatchEvent(down)
      const move = new Event('pointermove', { bubbles: true }) as PointerEvent
      Object.defineProperties(move, { clientX: { value: x }, clientY: { value: BOX.top + 10 } })
      window.dispatchEvent(move)
    },
    destroy: () => mod.destroy?.(),
  }
}

describe('a product’s place in the box', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('starts empty — every place is hidden once play begins', () => {
    const b = board()
    expect(b.shown()).toEqual([])
  })

  it('fills a place when its own item is caught', () => {
    const b = board()
    b.playUntil(1)
    expect(b.shown().length).toBeGreaterThan(0)
    for (const id of b.shown()) expect(id).toMatch(/^in_box_/)
  })

  it('leaves the falling copy out of the box — the product turns INTO its place', () => {
    // Nothing is packed loose in the box: the placed element is the product now.
    const b = board()
    b.playUntil(2)
    expect(b.packed()).toBe(0)
  })

  it('keeps a place filled once it is filled', () => {
    const b = board()
    b.playUntil(1)
    const first = b.shown()[0]
    b.playUntil(3)
    expect(b.shown()).toContain(first)
  })

  it('packs an item loose when it has no place assigned', () => {
    // Only two of the three items were given a place; the third still has to go somewhere.
    const b = board(2, 3)
    for (let i = 0; i < 600 && b.packed() === 0; i++) b.playUntil(99)
    expect(b.packed()).toBeGreaterThan(0)
  })

  it('slides what the box holds along with the box', () => {
    const b = board()
    b.playUntil(1)
    b.drag(200)
    const slide = b.box.style.translate
    expect(parseFloat(slide)).not.toBe(0)
    for (const el of b.places) expect(el.style.translate).toBe(slide)
  })

  it('stacks the places in the order the author layered them', () => {
    // They share the rig's layer, so their own order is DOM order — lowest authored z first,
    // which keeps a pile stacking the way it looks on the canvas.
    const b = board()
    const ids = Array.from(b.paRoot.children)
      .filter((el) => (el as HTMLElement).dataset.id?.startsWith('in_box_'))
      .map((el) => (el as HTMLElement).dataset.id)
    expect(ids).toEqual(['in_box_3', 'in_box_2', 'in_box_1']) // authored z 28, 29, 30
  })

  it('paints them over the falling items and under the box front', () => {
    const b = board()
    const drops = b.paRoot.querySelector<HTMLElement>('[data-id="catch_drops"]')!
    const after = Array.from(b.paRoot.children).indexOf(b.places[0])
    const dropsAt = Array.from(b.paRoot.children).indexOf(drops)
    expect(b.places[0].style.zIndex).toBe(drops.style.zIndex) // same layer
    expect(after).toBeGreaterThan(dropsAt) // ordered after, so painted over
  })

  it('trims a product that reaches past the box’s sides or floor', () => {
    // 60px out on the left and 140 below the floor: both cut back to the box. A positive
    // inset is a real cut; the right edge is well inside, so its inset stays negative.
    const b = board(0)
    const over = placed('spill', 'collected', { index: 1, z: 25, at: rect(BOX.left - 60, BOX.top + 100, 300, BOX.h + 40) })
    b.remount([over])
    const cut = insets(over)
    expect(cut.left).toBeCloseTo(60, 3)
    expect(cut.bottom).toBeCloseTo(140, 3)
    expect(cut.right).toBeLessThan(0)
    expect(cut.top).toBe('-100%') // the rim is never a cut
  })

  it('lets a product stand proud of the box’s top', () => {
    // Rising out of the rim is what a box full of products looks like — only the sides and
    // the floor hold. This one starts 80px ABOVE the box and nothing is trimmed for it.
    const b = board(0)
    const tall = placed('tall', 'collected', { index: 1, z: 25, at: rect(BOX.left + 20, BOX.top - 80, 100, 200) })
    b.remount([tall])
    const cut = insets(tall)
    expect(cut.top).toBe('-100%')
    for (const side of [cut.left, cut.right, cut.bottom]) expect(side).toBeLessThanOrEqual(0)
  })

  it('leaves a product that already fits uncut', () => {
    const b = board(0)
    const inside = placed('fits', 'collected', { index: 1, z: 25, at: rect(BOX.left + 20, BOX.top + 20, 100, 100) })
    b.remount([inside])
    const cut = insets(inside)
    for (const side of [cut.left, cut.right, cut.bottom]) expect(side).toBeLessThanOrEqual(0)
  })

  it('brings the copy inside the box before it flies, rather than cutting it', () => {
    // A copy is caught the moment it touches the rim, which the hit test allows with part of
    // it still past the box's side. Clipping that overhang cut a product that was not even
    // in the box yet; it is moved instead — centred between the walls, the one position that
    // always fits — and nothing is clipped.
    const b = board()
    b.playUntil(1)
    const flying = b.flying()!
    expect(flying.style.clipPath).toBe('')
    const left = parseFloat(flying.style.left)
    const width = parseFloat(flying.style.width)
    expect(left).toBeGreaterThanOrEqual(BOX.left)
    expect(left + width).toBeLessThanOrEqual(BOX.left + BOX.w)
    expect(left + width / 2).toBeCloseTo(BOX.left + BOX.w / 2, 3) // centred in the box
  })

  it('shrinks a copy that is wider than the box to fit between its walls', () => {
    // 500 wide falling into a 400 box: it cannot be centred into fitting, so it scales down.
    const b = board(3, 3, { itemFallScale: 500 / 150 })
    b.playUntil(1)
    const flying = b.flying()!
    expect(parseFloat(flying.style.width)).toBeCloseTo(BOX.w, 3)
    expect(parseFloat(flying.style.left)).toBeCloseTo(BOX.left, 3)
  })

  it('does not grow a placed product when its item is caught again', () => {
    // Scaling it up is what pushed it out past the rim, and it sits exactly where the author
    // put it — growing it, even for a moment, is the one thing it must not do.
    const b = board(1, 1)
    b.playUntil(1)
    const place = b.places[0]
    const at = place.style.transform
    b.playUntilCatches(4) // keep catching the same product
    expect(place.style.transform).toBe(at)
  })

  it('swaps the moment the copy touches the box, not once it is inside', () => {
    // The deepest the falling copy ever gets is its bottom edge meeting the rim. Seeing it
    // sink into the box and only then become its placed art is the thing being fixed here.
    const b = board()
    const bottom = b.caughtCopyBottom()
    expect(bottom).toBeGreaterThan(0) // it really did fall, and really was caught
    expect(bottom).toBeLessThanOrEqual(BOX.top + 1) // and never got past the rim
  })

  it('still sinks in when a catch depth is asked for', () => {
    // The knob that restores the old feel — and the proof the test above is measuring the
    // real thing rather than passing on a technicality.
    const b = board(3, 3, { catchDepth: 0.5 })
    expect(b.caughtCopyBottom()).toBeGreaterThan(BOX.top + 1)
  })

  it('cross-dissolves the copy into its place rather than blinking', () => {
    // The copy flies to the place's own box while fading out, and the place fades in under
    // it. Both halves have to be running: a swap where only one animates still blinks.
    const b = board()
    b.playUntil(1)
    const place = b.places.find((el) => !el.classList.contains(OFF))!
    expect(place.style.transition).toContain('opacity')
    const flying = b.flying()
    expect(flying).toBeTruthy()
    expect(flying!.style.transition).toContain('left')
    expect(flying!.style.transition).toContain('opacity')
  })

  it('lands the copy on the place’s own box, then drops it', () => {
    const b = board()
    b.playUntil(1)
    const place = b.places.find((el) => !el.classList.contains(OFF))!
    const flying = b.flying()!
    b.settle() // let the two animation frames and the timers run out
    // It flew to exactly where the product now sits, and cleaned itself up afterwards.
    expect(flying.isConnected).toBe(false)
    expect(place.style.transition).toBe('') // and the place is back to plain styling
  })

  it('swaps instantly when the animation is turned off', () => {
    const b = board(3, 3, { placeMs: 0 })
    b.playUntil(1)
    expect(b.flying()).toBeUndefined()
    expect(b.places.some((el) => !el.classList.contains(OFF))).toBe(true)
  })

  it('hands every place back on destroy', () => {
    const b = board()
    b.playUntil(1)
    b.destroy()
    for (const el of b.places) {
      expect(el.classList.contains(OFF)).toBe(false)
      expect(el.style.translate).toBe('')
      expect(el.dataset.catchClaimedBy).toBeUndefined()
    }
    expect(b.places.map((el) => el.style.zIndex)).toEqual(['30', '29', '28'])
  })
})
