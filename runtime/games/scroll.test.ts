// Behavior test for the Scrollable page game: the tall page renders with a
// sticky CTA that lands near the page bottom, tapping the CTA fires the store
// click (ctaClick sfx), reaching the scroll-depth threshold completes the game
// once, and the pointer-drag fallback scrolls (standing down on pointercancel).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScroll } from './scroll'
import { mulberry32, type GameContext } from './types'

interface Page {
  mod: ReturnType<typeof createScroll>
  root: HTMLDivElement
  scroller: HTMLDivElement
  btn: HTMLButtonElement
  played: string[]
  completed: () => boolean
}

function makePage(params: Record<string, unknown> = {}, opts: { vw?: number; vh?: number } = {}): Page {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const played: string[] = []
  const ctx: GameContext = {
    root,
    assets: { src: (id) => (id ? String(id) : '') },
    sfx: { play: (e) => played.push(e) },
    rng: mulberry32(42),
    scale: () => 1,
  }
  const mod = createScroll()
  mod.mount(ctx, params)
  const scroller = root.firstElementChild as HTMLDivElement
  // jsdom has no layout: stub the scroller's box + scroll extent (page = 2.5 screens).
  const vw = opts.vw ?? 400
  const vh = opts.vh ?? 800
  let scrollTop = 0
  Object.defineProperty(scroller, 'clientWidth', { value: vw, configurable: true })
  Object.defineProperty(scroller, 'clientHeight', { value: vh, configurable: true })
  Object.defineProperty(scroller, 'scrollHeight', { value: vh * 2.5, configurable: true })
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = Math.max(0, Math.min(vh * 1.5, v))
    },
    configurable: true,
  })
  mod.start()
  let done = false
  mod.onComplete(() => (done = true))
  return { mod, root, scroller, btn: root.querySelector('button')!, played, completed: () => done }
}

describe('scrollable page', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders a placeholder page and a styled text CTA when no assets are set', () => {
    const p = makePage()
    expect(p.root.textContent).toContain('Add a page image')
    expect(p.btn.textContent).toBe('SHOP NOW')
    expect(p.btn.style.borderRadius).toBe('999px')
    const wrap = p.btn.parentElement!
    expect(wrap.style.position).toBe('sticky')
  })

  it('lands the CTA with its bottom at ctaLand% of the page height', () => {
    const p = makePage({ ctaLand: 90, ctaHeight: 100, ctaFloat: 20 })
    p.mod.relayout() // stubbed sizes are in place now
    const wrap = p.btn.parentElement!
    const pageH = 800 * 2.5 // placeholder page = 2.5 screens
    // flow top = landBottom - ctaH ⇒ margin-top = landBottom - ctaH - pageH
    expect(parseFloat(wrap.style.marginTop)).toBeCloseTo(0.9 * pageH - 100 - pageH, 1)
    expect(parseFloat(wrap.style.height)).toBeCloseTo(100, 1)
    expect(parseFloat(wrap.style.bottom)).toBeCloseTo(20, 1)
  })

  it('fires the store click-through sfx on CTA tap', () => {
    const p = makePage()
    p.btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(p.played).toContain('ctaClick')
  })

  it('completes once when scrolled past the win depth', () => {
    const p = makePage({ completeAt: 90 })
    const fire = (): boolean => p.scroller.dispatchEvent(new Event('scroll'))
    p.scroller.scrollTop = 800 // 800/1200 max = 66% — not yet
    fire()
    expect(p.completed()).toBe(false)
    p.scroller.scrollTop = 1150 // 96% — past the threshold
    fire()
    expect(p.completed()).toBe(true)
  })

  it('never completes when the win depth is off (0)', () => {
    const p = makePage({ completeAt: 0 })
    p.scroller.scrollTop = 1200
    p.scroller.dispatchEvent(new Event('scroll'))
    expect(p.completed()).toBe(false)
  })

  it('drag fallback scrolls the page and stands down on pointercancel', () => {
    const p = makePage()
    const at = (type: string, clientY: number): MouseEvent => new MouseEvent(type, { clientY })
    p.scroller.dispatchEvent(at('pointerdown', 500))
    p.scroller.dispatchEvent(at('pointermove', 300)) // finger up 200px = scroll down 200px
    expect(p.scroller.scrollTop).toBe(200)
    // Native scroll takes the gesture: further moves must not scroll.
    p.scroller.dispatchEvent(at('pointercancel', 300))
    p.scroller.dispatchEvent(at('pointermove', 100))
    expect(p.scroller.scrollTop).toBe(200)
  })

  it('hints an upward drag while scrollable, nothing once done', () => {
    const p = makePage({ completeAt: 50 })
    const hint = p.mod.getHint()
    expect(hint?.kind).toBe('slide')
    expect(hint!.to.y).toBeLessThan(hint!.from.y)
    p.scroller.scrollTop = 1200
    p.scroller.dispatchEvent(new Event('scroll'))
    expect(p.completed()).toBe(true)
    expect(p.mod.getHint()).toBeNull()
  })
})
