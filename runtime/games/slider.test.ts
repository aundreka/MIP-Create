// Behavior test for the Slider (before/after) game: winning always ends on a FULL
// reveal (the divider wipes the rest of the way to the edge, leaving no sliver of
// the losing image), EITHER end can be the winning one, and the line/handle are
// styled from the authored params.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSlider } from './slider'
import { mulberry32, type GameContext } from './types'

const WRAP_W = 400
const WRAP_H = 600

interface Card {
  mod: ReturnType<typeof createSlider>
  wrap: HTMLDivElement
  before: HTMLDivElement
  line: HTMLDivElement
  handle: HTMLDivElement
  played: string[]
  loops: string[]
  completed: () => boolean
  won: () => boolean
  drag: (fx: number, fy?: number) => void
  press: (fx: number, fy?: number) => void
  release: (type?: string) => void
}

function makeCard(params: Record<string, unknown> = {}): Card {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const played: string[] = []
  const loops: string[] = []
  const ctx: GameContext = {
    root,
    assets: { src: (id) => (id ? String(id) : ''), size: () => ({ w: 100, h: 50 }) },
    sfx: { play: (e) => played.push(e), loopStart: (e) => loops.push('start:' + e), loopStop: (e) => loops.push('stop:' + e) },
    rng: mulberry32(1),
    scale: () => 1,
  }
  const mod = createSlider()
  mod.mount(ctx, { before: 'b.png', after: 'a.png', ...params })
  const wrap = root.firstElementChild as HTMLDivElement
  // jsdom has no layout: give the card a box so pointer -> fraction maths works.
  wrap.getBoundingClientRect = () => ({ left: 0, top: 0, width: WRAP_W, height: WRAP_H, right: WRAP_W, bottom: WRAP_H, x: 0, y: 0, toJSON: () => ({}) })
  Object.defineProperty(wrap, 'setPointerCapture', { value: () => {}, configurable: true })
  mod.start()
  let done = false
  mod.onComplete(() => (done = true))
  let win = false
  mod.onWin?.(() => (win = true))
  const kids = Array.from(wrap.children) as HTMLDivElement[]
  // [after, before, line, handle]
  const press = (fx: number, fy = 0.5): void => {
    wrap.dispatchEvent(new PointerEvent('pointerdown', { clientX: fx * WRAP_W, clientY: fy * WRAP_H, pointerId: 1, bubbles: true }))
    wrap.dispatchEvent(new PointerEvent('pointermove', { clientX: fx * WRAP_W, clientY: fy * WRAP_H, pointerId: 1, bubbles: true }))
  }
  const release = (type = 'pointerup'): void => {
    wrap.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true }))
  }
  const drag = (fx: number, fy = 0.5): void => {
    press(fx, fy)
    release()
  }
  return { mod, wrap, before: kids[1], line: kids[2], handle: kids[3], played, loops, completed: () => done, won: () => win, drag, press, release }
}

/** How much of the "before" layer is still showing (0-100), off its clip-path. A
 * full reveal is exactly 0 (the after image is whole) or exactly 100 (the before
 * image is) — anything between is the half-wiped sliver this game must never end on. */
function shown(before: HTMLElement): number {
  const m = /inset\(([^)]+)\)/.exec(before.style.clipPath)
  const parts = (m?.[1] ?? '0% 0% 0% 0%').trim().split(/\s+/)
  // horizontal clips from the right (2nd value), vertical from the bottom (3rd).
  return 100 - Math.max(parseFloat(parts[1] ?? '0'), parseFloat(parts[2] ?? '0'))
}

describe('slider (before / after)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('starts split down the middle', () => {
    const c = makeCard()
    expect(shown(c.before)).toBeCloseTo(50, 5)
    expect(c.handle.style.left).toBe('50%')
  })

  it('wipes the rest of the way to the edge on a win, so the reveal is FULL', () => {
    vi.useFakeTimers()
    const c = makeCard({ threshold: 0.82, snapMs: 400 })
    c.drag(0.1) // 90% revealed: past the threshold, but 10% of "before" still showing
    expect(c.played).toContain('gameWin')
    expect(shown(c.before)).toBe(0) // clipped to nothing — the after image is whole
    expect(c.completed()).toBe(false) // completion waits for the wipe
    vi.advanceTimersByTime(400)
    expect(c.completed()).toBe(true)
  })

  it('a threshold of 1 is reachable (no 0.95 cap)', () => {
    const c = makeCard({ threshold: 1, snapMs: 0 })
    c.drag(0.06)
    expect(c.played).not.toContain('gameWin') // 94% is not all the way
    c.drag(0)
    expect(c.played).toContain('gameWin')
    expect(shown(c.before)).toBe(0)
  })

  it('wins at either end by default, revealing whichever image was dragged to', () => {
    const right = makeCard({ snapMs: 0 })
    right.drag(0.95)
    expect(right.played).toContain('gameWin')
    expect(shown(right.before)).toBe(100) // the before image now fills the card

    const left = makeCard({ snapMs: 0 })
    left.drag(0.05)
    expect(left.played).toContain('gameWin')
    expect(shown(left.before)).toBe(0) // and here the after image does
  })

  it('honours a one-way winEdge', () => {
    const c = makeCard({ winEdge: 'left', snapMs: 0 })
    c.drag(0.98)
    expect(c.played).not.toContain('gameWin')
    c.drag(0.02)
    expect(c.played).toContain('gameWin')
  })

  it('completes once, and ignores input after the win', () => {
    const c = makeCard({ snapMs: 0 })
    c.drag(0.02)
    c.drag(0.5)
    c.drag(0.02)
    expect(c.played.filter((e) => e === 'gameWin')).toHaveLength(1)
    expect(shown(c.before)).toBe(0) // the finished wipe is not dragged back open
  })

  it('draws no card of its own — no fill, no corner radius behind the images', () => {
    const c = makeCard()
    expect(c.wrap.style.background).toBe('transparent')
    expect(c.wrap.style.borderRadius).toBe('')
    expect(c.before.style.background).toContain('url("b.png")')
  })

  it('can show the whole image instead of cropping it', () => {
    const cover = makeCard()
    expect(cover.before.style.background).toContain('center / cover')
    const contain = makeCard({ imageFit: 'contain' })
    expect(contain.before.style.background).toContain('center / contain')
  })

  it('loops a sliding sound for as long as the divider is held', () => {
    const c = makeCard({ snapMs: 0 })
    expect(c.loops).toEqual([])
    c.press(0.6)
    // Stop first: a fresh gesture has to be allowed to restart a loop left running.
    expect(c.loops).toEqual(['stop:drag', 'start:drag'])
    c.release()
    expect(c.loops.at(-1)).toBe('stop:drag')
  })

  it('stops the sliding loop on a cancelled gesture, and on destroy', () => {
    const c = makeCard({ snapMs: 0 })
    c.press(0.6)
    c.release('pointercancel')
    expect(c.loops.at(-1)).toBe('stop:drag')
    c.loops.length = 0
    c.release('pointerup') // already up: nothing left to stop
    expect(c.loops).toEqual([])
    c.press(0.6)
    c.mod.destroy()
    expect(c.loops.at(-1)).toBe('stop:drag')
  })

  it('drops the sliding loop the moment the game is won, before the wipe', () => {
    vi.useFakeTimers()
    const c = makeCard({ snapMs: 400 })
    c.press(0.05)
    expect(c.loops.at(-1)).toBe('stop:drag')
    expect(c.won()).toBe(true) // the win fires on the beat, not after the wipe
    expect(c.completed()).toBe(false)
    vi.advanceTimersByTime(400)
    expect(c.completed()).toBe(true)
  })

  it('styles the divider line and handle from the params', () => {
    const c = makeCard({ lineWidth: 8, lineColor: '#ff0000', handleSize: 50, handleScale: 200, handlePos: 80, handleColor: '#00ff00' })
    expect(c.line.style.width).toBe('8px')
    expect(c.line.style.background).toBe('rgb(255, 0, 0)')
    expect(c.handle.style.width).toBe('100px') // 50px at 200%
    expect(c.handle.style.top).toBe('80%')
    expect(c.handle.style.background).toBe('rgb(0, 255, 0)')
  })

  it('uses a handle image at the image aspect, with no circle behind it', () => {
    const c = makeCard({ handleImage: 'h.png', handleSize: 60 })
    expect(c.handle.style.background).toContain('url("h.png")')
    expect(c.handle.style.width).toBe('60px')
    expect(c.handle.style.height).toBe('30px') // 100x50 source
    expect(c.handle.style.borderRadius).toBe('0px')
    expect(c.handle.textContent).toBe('')
  })

  it('scales design-px styling with the stage', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    let k = 1
    const mod = createSlider()
    mod.mount({ root, assets: { src: (id) => (id ? String(id) : '') }, sfx: { play: () => {} }, rng: mulberry32(1), scale: () => k }, { lineWidth: 4, handleSize: 40 })
    const wrap = root.firstElementChild as HTMLDivElement
    const handle = wrap.children[3] as HTMLDivElement
    expect(handle.style.width).toBe('40px')
    k = 2
    mod.relayout()
    expect(handle.style.width).toBe('80px')
    expect((wrap.children[2] as HTMLDivElement).style.width).toBe('8px')
  })

  it('publishes the track and handle a placed handguide follows, and drops them on the win', () => {
    const c = makeCard({ snapMs: 0, winEdge: 'either' })
    expect(c.wrap.dataset.sliderTrack).toBe('1')
    expect(c.wrap.dataset.sliderEdge).toBe('either')
    expect(c.handle.dataset.sliderHandle).toBe('1')
    c.drag(0.02)
    expect(c.handle.dataset.sliderHandle).toBeUndefined()
    expect(c.wrap.dataset.sliderTrack).toBeUndefined()
  })

  it('points the hint at the nearer winning edge', () => {
    const c = makeCard()
    c.handle.getBoundingClientRect = () => ({ left: 200, top: 300, width: 36, height: 36, right: 236, bottom: 336, x: 200, y: 300, toJSON: () => ({}) })
    c.drag(0.7) // closer to the right edge now
    expect(c.mod.getHint()?.to.x).toBeCloseTo(WRAP_W * 0.9, 5)
    c.drag(0.3)
    expect(c.mod.getHint()?.to.x).toBeCloseTo(WRAP_W * 0.1, 5)
  })

  it('wipes vertically when the orientation is vertical', () => {
    const c = makeCard({ orientation: 'vertical', snapMs: 0 })
    expect(c.wrap.dataset.sliderVertical).toBe('1')
    c.drag(0.5, 0.05)
    expect(c.played).toContain('gameWin')
    expect(shown(c.before)).toBe(0)
  })
})
