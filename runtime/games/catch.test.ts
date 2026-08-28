// Catch with PLACED ELEMENTS as the falling items: the row the author arranged on the
// canvas is the board — its art is what falls, each entry is its own tick in the row,
// and one assigned check mark is stamped onto each entry as it is caught.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CATCH_TEMPLATE, createCatch } from './catch'
import { mulberry32, type GameContext } from './types'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect

/** A placed element as stage.ts builds one: an outer .pa-el carrying the role tags, with
 * the element's real <img> inside it. */
function placed(id: string, role: 'item' | 'check', opts: { index?: number; src?: string; x?: number; size?: number } = {}): HTMLElement {
  const el = document.createElement('div')
  el.className = 'pa-el'
  el.dataset.id = id
  el.dataset.catchRole = role
  if (opts.index) el.dataset.catchIndex = String(opts.index)
  const size = opts.size ?? 100
  const anim = document.createElement('div')
  anim.className = 'pa-el-anim'
  const img = document.createElement('img')
  img.src = opts.src ?? `asset:${id}`
  anim.appendChild(img)
  el.appendChild(anim)
  Object.defineProperties(el, {
    offsetWidth: { value: size, configurable: true },
    offsetHeight: { value: size, configurable: true },
  })
  el.getBoundingClientRect = () => rect(opts.x ?? 0, 200, size, size)
  return el
}

interface Mounted {
  mod: ReturnType<typeof createCatch>
  paRoot: HTMLElement
  items: HTMLElement[]
  check: HTMLElement
  frame: (ms?: number) => void
  spawn: (n?: number) => void
  completed: () => boolean
}

function mount(params: Record<string, unknown> = {}, itemCount = 3): Mounted {
  const paRoot = document.createElement('div')
  paRoot.className = 'pa-root'
  Object.defineProperty(paRoot, 'offsetWidth', { value: 1080, configurable: true })
  paRoot.getBoundingClientRect = () => rect(0, 0, 1080, 1920)
  document.body.appendChild(paRoot)

  const items = Array.from({ length: itemCount }, (_, i) => placed(`shoe${i + 1}`, 'item', { index: i + 1, x: 100 + i * 200 }))
  const check = placed('tick', 'check', { size: 60 })
  for (const el of [...items, check]) paRoot.appendChild(el)

  const root = document.createElement('div')
  paRoot.appendChild(root)

  let raf: FrameRequestCallback | null = null
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    raf = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    raf = null
  })

  const ctx: GameContext = {
    root,
    assets: { src: (id) => (id ? `asset:${id}` : ''), size: () => ({ w: 100, h: 100 }) },
    sfx: { play: () => {} },
    rng: mulberry32(42),
    scale: () => 1,
    elementId: 'catch-game',
  } as GameContext

  const mod = createCatch()
  // A basket wide enough that horizontal aim never decides the test: what is under
  // examination is what happens ON a catch, not whether one lands.
  mod.mount(ctx, { speed: 3, spawnMs: 100, frontBasketWidth: 2000, frontBasketHeight: 150, checkFadeMs: 0, caughtFadeMs: 0, ...params })
  let complete = false
  mod.onComplete(() => (complete = true))
  mod.start()
  mod.relayout?.()

  let now = 0
  return {
    mod,
    paRoot,
    items,
    check,
    frame: (ms = 32) => {
      now += ms
      raf?.(now)
    },
    spawn: (n = 1) => vi.advanceTimersByTime(100 * n),
    completed: () => complete,
  }
}

/** Run the board to a finish: spawn, fall, catch, repeat. */
function play(game: Mounted, frames = 400): void {
  for (let i = 0; i < frames && !game.completed(); i++) {
    game.spawn()
    game.frame()
  }
}

describe('catch with placed item elements', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('still offers the uploaded image slots for boards with no placed elements', () => {
    expect(CATCH_TEMPLATE.assetSlots?.map((s) => s.key)).toContain('itemImages')
    expect(CATCH_TEMPLATE.defaultParams.itemFallScale).toBe(2)
  })

  it('falls copies of the placed elements, at the placed size times the scale', () => {
    vi.useFakeTimers()
    const game = mount({ itemFallScale: 2 })
    game.spawn(3)
    const drops = Array.from(game.paRoot.querySelectorAll('img')).filter((img) => !img.closest('.pa-el'))
    expect(drops.length).toBeGreaterThan(0)
    for (const img of drops) expect(['asset:shoe1', 'asset:shoe2', 'asset:shoe3']).toContain(img.getAttribute('src'))
    // 100px on the canvas, scale 2, stage scale 1.
    const dropEl = drops[0].parentElement as HTMLElement
    expect(dropEl.style.width).toBe('200px')
    expect(dropEl.style.height).toBe('200px')
  })

  it('brings each caught item up to full opacity and stamps the check mark on it', () => {
    vi.useFakeTimers()
    const game = mount()
    expect(game.items.every((el) => !el.classList.contains('pa-catch-caught'))).toBe(true)
    // The check mark itself is never on screen in play — only the copies of it.
    expect(game.check.classList.contains('pa-combo-off')).toBe(true)

    play(game)
    expect(game.completed()).toBe(true)
    for (const el of game.items) expect(el.classList.contains('pa-catch-caught')).toBe(true)

    const stamps = Array.from(game.paRoot.querySelectorAll<HTMLElement>('[data-id^="catch_check_"]'))
    expect(stamps.length).toBe(3)
    // Centred on its item (item 1 sits at x 100..200, y 200..300), at the check
    // element's own 60px size.
    const first = game.paRoot.querySelector<HTMLElement>('[data-id="catch_check_1"]') as HTMLElement
    expect(first.style.width).toBe('60px')
    expect(first.style.left).toBe('120px')
    expect(first.style.top).toBe('220px')
  })

  it('is won on one of each placed item, whatever the catches-to-win number says', () => {
    vi.useFakeTimers()
    const game = mount({ catches: 25 }, 3)
    play(game)
    expect(game.completed()).toBe(true)
    expect(game.items.filter((el) => el.classList.contains('pa-catch-caught')).length).toBe(3)
  })

  it('hands the canvas back exactly as it found it', () => {
    vi.useFakeTimers()
    const game = mount()
    play(game)
    game.mod.destroy()
    for (const el of game.items) {
      expect(el.classList.contains('pa-catch-caught')).toBe(false)
      expect(el.dataset.catchClaimedBy).toBeUndefined()
    }
    expect(game.paRoot.querySelectorAll('[data-id^="catch_check_"]').length).toBe(0)
    // Hidden on the canvas is where this one started: the author had not asked to see it.
    expect(game.check.classList.contains('pa-combo-off')).toBe(true)
    expect(game.check.dataset.catchClaimedBy).toBeUndefined()
  })
})
