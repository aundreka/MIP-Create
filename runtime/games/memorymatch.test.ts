// Behavior test for the Memory Match game: flip two cards — a pair vanishes and
// lights its tracker symbol, a mismatch flips back — and the hint target
// (data-mm-hint) always points at one card of a pair, then its partner.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryMatch } from './memorymatch'
import { mulberry32, type GameContext } from './types'

const flip = (el: HTMLElement): void => {
  el.dispatchEvent(new Event('pointerdown'))
}

interface Board {
  mod: ReturnType<typeof createMemoryMatch>
  root: HTMLDivElement
  played: string[]
  cards: HTMLElement[]
  pairOf: (el: HTMLElement) => string
  isFlipped: (el: HTMLElement) => boolean
  hinted: () => HTMLElement[]
  completed: () => boolean
}

function makeBoard(params: Record<string, unknown> = {}, stageScale = 1): Board {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const played: string[] = []
  const ctx: GameContext = {
    root,
    assets: { src: () => '' },
    sfx: { play: (e) => played.push(e) },
    rng: mulberry32(42),
    scale: () => stageScale,
  }
  const mod = createMemoryMatch()
  mod.mount(ctx, { pairs: 2, cols: 2, rows: 2, tracker: 'top', ...params })
  mod.start()
  let done = false
  mod.onComplete(() => (done = true))
  const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-mm-card]'))
  return {
    mod,
    root,
    played,
    cards,
    // no images in tests → the front face falls back to the pair number as text
    pairOf: (el) => el.querySelector('div')!.children[1].textContent ?? '',
    isFlipped: (el) => (el.querySelector('div') as HTMLElement).style.transform === 'rotateY(180deg)',
    hinted: () => Array.from(root.querySelectorAll<HTMLElement>('[data-mm-hint]')),
    completed: () => done,
  }
}

describe('memory match', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    // the "seen this page" marker — cleared so each test starts as a fresh page load
    delete (window as unknown as Record<string, unknown>)['__paMmSeen:0']
  })

  it('deals two cards per pair and one tracker symbol per pair', () => {
    const b = makeBoard({ pairs: 3, cols: 3, rows: 2 })
    expect(b.cards).toHaveLength(6)
    const byPair = new Map<string, number>()
    for (const c of b.cards) byPair.set(b.pairOf(c), (byPair.get(b.pairOf(c)) ?? 0) + 1)
    expect([...byPair.values()]).toEqual([2, 2, 2])
  })

  it('fills a larger grid with random extra symbols, every pair still guaranteed', () => {
    const b = makeBoard({ pairs: 2, cols: 3, rows: 2 }) // 6 cards for 2 pairs → 2 random extras
    expect(b.cards).toHaveLength(6)
    const byPair = new Map<string, number>()
    for (const c of b.cards) byPair.set(b.pairOf(c), (byPair.get(b.pairOf(c)) ?? 0) + 1)
    expect([...byPair.keys()].sort()).toEqual(['1', '2']) // extras reuse the pair symbols
    for (const n of byPair.values()) expect(n).toBeGreaterThanOrEqual(2)
  })

  it('wins once every symbol is lit; leftovers sweep off after the last pair', () => {
    const b = makeBoard({ pairs: 2, cols: 3, rows: 2 })
    for (const pid of ['1', '2']) {
      const pair = b.cards.filter((c) => b.pairOf(c) === pid).slice(0, 2)
      flip(pair[0])
      flip(pair[1])
      vi.advanceTimersByTime(700) // reveal + this pair's vanish, before the endgame sweep
    }
    // The win happened with unpicked extras still on the board — symbols, not cards.
    const remaining = b.cards.filter((c) => c.style.opacity !== '0')
    expect(remaining.length).toBe(2)
    vi.runAllTimers()
    expect(b.completed()).toBe(true)
    expect(b.cards.filter((c) => c.style.opacity !== '0')).toHaveLength(0) // sweep cleared them
  })

  it('hints one card, then re-targets to its partner once flipped', () => {
    const b = makeBoard()
    expect(b.hinted()).toHaveLength(1)
    const target = b.hinted()[0]
    flip(target)
    expect(b.played).toContain('flip')
    expect(b.isFlipped(target)).toBe(true)
    const next = b.hinted()
    expect(next).toHaveLength(1)
    expect(next[0]).not.toBe(target)
    expect(b.pairOf(next[0])).toBe(b.pairOf(target))
  })

  it('matched pairs light their symbol and disappear, leaving space', () => {
    const b = makeBoard()
    const [a] = b.cards
    const partner = b.cards.find((c) => c !== a && b.pairOf(c) === b.pairOf(a))!
    flip(a)
    flip(partner)
    expect(b.played).not.toContain('correct') // not on click…
    vi.advanceTimersByTime(400)
    expect(b.played).toContain('correct') // …only once the flip has settled
    const litLayers = Array.from(b.root.querySelectorAll<HTMLElement>('div')).filter((d) => d.style.opacity === '1' && d.style.transition.includes('opacity'))
    expect(litLayers.length).toBeGreaterThan(0) // a tracker symbol lit up
    vi.runAllTimers()
    expect(a.style.opacity).toBe('0')
    expect(partner.style.opacity).toBe('0')
    expect(a.style.pointerEvents).toBe('none')
  })

  it('mismatches flip back and play the wrong sfx', () => {
    const b = makeBoard()
    const [a] = b.cards
    const other = b.cards.find((c) => b.pairOf(c) !== b.pairOf(a))!
    flip(a)
    flip(other)
    expect(b.played).not.toContain('wrong') // waits for the flip to finish
    vi.advanceTimersByTime(400)
    expect(b.played).toContain('wrong')
    vi.runAllTimers()
    expect(b.isFlipped(a)).toBe(false)
    expect(b.isFlipped(other)).toBe(false)
    expect(a.style.opacity).not.toBe('0')
  })

  it('deals a different random board each fresh game', () => {
    const seq = (b: Board): string => b.cards.map((c) => b.pairOf(c)).join(' ')
    const first = seq(makeBoard({ pairs: 8, cols: 4, rows: 4 }))
    const second = seq(makeBoard({ pairs: 8, cols: 4, rows: 4 }))
    expect(first).not.toBe(second)
  })

  it('restores the same board and progress after a page reload (rotation)', () => {
    const b1 = makeBoard()
    const layout1 = b1.cards.map((c) => b1.pairOf(c)).join(' ')
    const pair = b1.cards.filter((c) => b1.pairOf(c) === '1')
    flip(pair[0])
    flip(pair[1])
    vi.runAllTimers() // resolve the match — progress is saved
    b1.mod.destroy()
    delete (window as unknown as Record<string, unknown>)['__paMmSeen:0'] // simulate the reload
    const b2 = makeBoard()
    expect(b2.cards.map((c) => b2.pairOf(c)).join(' ')).toBe(layout1) // identical layout
    expect(b2.cards.filter((c) => c.style.visibility === 'hidden')).toHaveLength(2) // matched pair stayed gone
    expect(b2.completed()).toBe(false) // game continues from where it was
  })

  it('scales design-px params with the stage scale (game resizes as one unit)', () => {
    const symbolW = (b: Board): string => {
      const row = Array.from(b.root.children).find((e) => !(e as HTMLElement).dataset.mmCard) as HTMLElement
      return (row.children[0] as HTMLElement).style.width
    }
    expect(symbolW(makeBoard())).toBe('34px') // trackerSize default, scale 1
    expect(symbolW(makeBoard({}, 2))).toBe('68px') // same design px at 2× stage scale
  })

  it('transparent fills leave no colour or shadow behind the art', () => {
    const b = makeBoard({ coverFill: 'transparent', faceFill: 'transparent' })
    const back = b.cards[0].querySelector('div')!.children[0] as HTMLElement
    expect(back.style.background).toBe('')
    expect(back.textContent).toBe('') // no "?" placeholder on a transparent cover
    expect(back.style.boxShadow).toBe('none')
  })

  it('completes when every pair is matched', () => {
    const b = makeBoard()
    for (const pid of ['1', '2']) {
      const pair = b.cards.filter((c) => b.pairOf(c) === pid)
      flip(pair[0])
      flip(pair[1])
      vi.runAllTimers()
    }
    expect(b.completed()).toBe(true)
    expect(b.hinted()).toHaveLength(0)
  })
})
