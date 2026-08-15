import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createThoughtWhack, normalizeThoughtSpawnZones, THOUGHTWHACK_TEMPLATE } from './thoughtwhack'
import { mulberry32, type GameContext } from './types'

interface Game {
  mod: ReturnType<typeof createThoughtWhack>
  root: HTMLDivElement
  played: string[]
  completed: () => boolean
  won: () => boolean
}

function makeGame(params: Record<string, unknown> = {}): Game {
  const root = document.createElement('div')
  Object.defineProperties(root, {
    clientWidth: { value: 320, configurable: true },
    clientHeight: { value: 480, configurable: true },
  })
  document.body.appendChild(root)
  const played: string[] = []
  const ctx: GameContext = {
    root,
    assets: { src: (id?: string) => (id ? `asset:${id}` : '') },
    sfx: { play: (event) => played.push(event) },
    rng: mulberry32(42),
    scale: () => 1,
  }
  const mod = createThoughtWhack()
  mod.mount(ctx, {
    thoughtCount: 3,
    roundSeconds: 5,
    spawnStaggerMs: 0,
    whackedHoldMs: 180,
    fadeMs: 360,
    thoughtImages: ['thought-a', 'thought-b', 'thought-c'],
    whackImage: 'shared-whack',
    spawnZones: [{ x: 5, y: 5, w: 90, h: 70 }],
    ...params,
  })
  let complete = false
  let win = false
  mod.onComplete(() => (complete = true))
  mod.onWin?.(() => (win = true))
  mod.start()
  vi.advanceTimersByTime(20) // spawn + the built-in pop's first frame
  return { mod, root, played, completed: () => complete, won: () => win }
}

const tap = (el: HTMLElement): void => {
  el.dispatchEvent(new Event('pointerdown'))
}

describe('thought whacker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('uses thought images plus one shared whack image and defaults to five seconds', () => {
    expect(THOUGHTWHACK_TEMPLATE.defaultParams.roundSeconds).toBe(5)
    expect(THOUGHTWHACK_TEMPLATE.defaultHandguide?.mode).toBe('thoughtwhack')
    expect(THOUGHTWHACK_TEMPLATE.assetSlots?.map((slot) => slot.key)).toEqual(['thoughtImages', 'whackImage', 'handImage'])
    expect(THOUGHTWHACK_TEMPLATE.assetSlots?.some((slot) => slot.key === 'subjectImage')).toBe(false)
    expect(THOUGHTWHACK_TEMPLATE.assetSlots?.some((slot) => slot.key === 'containerImage')).toBe(false)
  })

  it('renders every thought with the two-circle trailing bubble from the reference', () => {
    const g = makeGame()
    const targets = g.root.querySelectorAll<HTMLElement>('[data-tw-target]')
    expect(targets).toHaveLength(3)
    targets.forEach((target) => expect(target.querySelectorAll('[data-tw-tail]')).toHaveLength(2))
  })

  it('aims both trailing circles toward the authored subject marker', () => {
    const g = makeGame({ thoughtCount: 1, subjectX: 90, subjectY: 90 })
    const bubble = g.root.querySelector<HTMLElement>('[data-tw-thought]')!
    const dots = Array.from(g.root.querySelectorAll<HTMLElement>('[data-tw-tail]'))
    const bx = parseFloat(bubble.style.left) + parseFloat(bubble.style.width) / 2
    const by = parseFloat(bubble.style.top) + parseFloat(bubble.style.height) / 2
    const subject = { x: 320 * 0.9, y: 480 * 0.9 }
    for (const dot of dots) {
      const dx = parseFloat(dot.style.left) + parseFloat(dot.style.width) / 2 - bx
      const dy = parseFloat(dot.style.top) + parseFloat(dot.style.height) / 2 - by
      expect(dx * (subject.x - bx) + dy * (subject.y - by)).toBeGreaterThan(0)
    }
  })

  it('uses the one shared whack asset for every thought and emits gameplay events', () => {
    const g = makeGame()
    expect(g.played.filter((event) => event === 'thoughtSpawn')).toHaveLength(3)
    const bubbles = Array.from(g.root.querySelectorAll<HTMLElement>('[data-tw-thought]'))
    tap(bubbles[0])
    tap(bubbles[1])
    expect(bubbles[0].style.backgroundImage).toContain('asset:shared-whack')
    expect(bubbles[1].style.backgroundImage).toContain('asset:shared-whack')
    expect(g.played.filter((event) => event === 'thoughtWhack')).toHaveLength(2)
  })

  it('respawns a whacked thought at a new random point after one second', () => {
    const g = makeGame({ thoughtCount: 2, respawnMs: 1000 })
    const target = g.root.querySelector<HTMLElement>('[data-tw-target]')!
    const bubble = target.querySelector<HTMLElement>('[data-tw-thought]')!
    const before = `${bubble.style.left},${bubble.style.top}`

    tap(bubble)
    vi.advanceTimersByTime(999)
    expect(target.dataset.twState).toBe('gone')

    vi.advanceTimersByTime(1)
    expect(target.dataset.twState).toBe('active')
    expect(`${bubble.style.left},${bubble.style.top}`).not.toBe(before)
    vi.advanceTimersByTime(16)
    expect(g.played.filter((event) => event === 'thoughtSpawn')).toHaveLength(3)
  })

  it('wins only when the whole screen is cleared inside the round duration', () => {
    const g = makeGame()
    const bubbles = Array.from(g.root.querySelectorAll<HTMLElement>('[data-tw-thought]'))
    bubbles.forEach(tap)
    expect(g.won()).toBe(true)
    expect(g.played).toContain('gameWin')
    expect(g.completed()).toBe(false) // lets the last shared whack image show and fade
    vi.advanceTimersByTime(180 + 360)
    expect(g.completed()).toBe(true)
    expect(g.mod.getHint()).toBeNull()
  })

  it('starts the duration on first interaction, then treats reaching it as a win', () => {
    const g = makeGame({ roundSeconds: 1 })
    const first = Array.from(g.root.querySelectorAll<HTMLElement>('[data-tw-thought]')).map((bubble) => `${bubble.style.left},${bubble.style.top}`)
    vi.advanceTimersByTime(5000)
    expect(g.won()).toBe(false)

    g.root.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(999)
    expect(g.won()).toBe(false)
    vi.advanceTimersByTime(1)
    const second = Array.from(g.root.querySelectorAll<HTMLElement>('[data-tw-thought]')).map((bubble) => `${bubble.style.left},${bubble.style.top}`)
    expect(g.won()).toBe(true)
    expect(g.completed()).toBe(true)
    expect(g.played).toContain('gameWin')
    expect(second).toEqual(first)
    Array.from(g.root.querySelectorAll<HTMLElement>('[data-tw-target]')).forEach((target) => {
      expect(target.dataset.twState).toBe('active')
      expect(target.style.opacity).toBe('1')
    })
  })

  it('never overlaps visible thought symbols or their trailing bubbles', () => {
    const g = makeGame({ thoughtCount: 5, thoughtSizePct: 14 })
    const targets = Array.from(g.root.querySelectorAll<HTMLElement>('[data-tw-target]'))
    targets.forEach((target) => expect(target.dataset.twState).toBe('active'))
    const boxes = targets.map((target) => {
      const pieces = Array.from(target.children) as HTMLElement[]
      return pieces.reduce(
        (box, piece) => {
          const left = parseFloat(piece.style.left)
          const top = parseFloat(piece.style.top)
          const width = parseFloat(piece.style.width)
          const height = parseFloat(piece.style.height)
          return {
            left: Math.min(box.left, left),
            top: Math.min(box.top, top),
            right: Math.max(box.right, left + width),
            bottom: Math.max(box.bottom, top + height),
          }
        },
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
      )
    })
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        expect(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top).toBe(false)
      }
    }
  })

  it('aims the animated hint hand at a currently unwhacked thought', () => {
    const g = makeGame({ thoughtCount: 2 })
    const targets = Array.from(g.root.querySelectorAll<HTMLElement>('[data-tw-target]'))
    const firstBubble = targets[0].querySelector<HTMLElement>('[data-tw-thought]')!
    firstBubble.getBoundingClientRect = () => ({ x: 20, y: 40, left: 20, top: 40, right: 100, bottom: 120, width: 80, height: 80, toJSON: () => ({}) })
    expect(g.mod.getHint()).toMatchObject({ from: { x: 60, y: 92 }, to: { x: 60, y: 92 }, kind: 'tap', scale: 0.9 })

    tap(firstBubble)
    const secondBubble = targets[1].querySelector<HTMLElement>('[data-tw-thought]')!
    secondBubble.getBoundingClientRect = () => ({ x: 140, y: 70, left: 140, top: 70, right: 200, bottom: 130, width: 60, height: 60, toJSON: () => ({}) })
    expect(g.mod.getHint()).toMatchObject({ from: { x: 170, y: 109 }, to: { x: 170, y: 109 }, kind: 'tap' })
  })

  it('keeps generated positions inside the author-drawn spawn areas', () => {
    const g = makeGame({ thoughtCount: 1, spawnZones: [{ x: 10, y: 15, w: 30, h: 35 }] })
    const bubble = g.root.querySelector<HTMLElement>('[data-tw-thought]')!
    const centerX = ((parseFloat(bubble.style.left) + parseFloat(bubble.style.width) / 2) / 320) * 100
    const centerY = ((parseFloat(bubble.style.top) + parseFloat(bubble.style.height) / 2) / 480) * 100
    expect(centerX).toBeGreaterThanOrEqual(10)
    expect(centerX).toBeLessThanOrEqual(40)
    expect(centerY).toBeGreaterThanOrEqual(15)
    expect(centerY).toBeLessThanOrEqual(50)
  })

  it('normalizes malformed or missing zones to a safe drawable area', () => {
    expect(normalizeThoughtSpawnZones(null)).toEqual([{ x: 8, y: 8, w: 84, h: 62 }])
    expect(normalizeThoughtSpawnZones([{ x: -10, y: 95, w: 200, h: 50 }])).toEqual([{ x: 0, y: 95, w: 100, h: 5 }])
  })
})
