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
function placed(id: string, role: 'item' | 'check' | 'box', opts: { index?: number; src?: string; x?: number; y?: number; w?: number; size?: number } = {}): HTMLElement {
  const el = document.createElement('div')
  el.className = 'pa-el'
  el.dataset.id = id
  el.dataset.catchRole = role
  if (opts.index) el.dataset.catchIndex = String(opts.index)
  const size = opts.size ?? 100
  const width = opts.w ?? size
  const anim = document.createElement('div')
  anim.className = 'pa-el-anim'
  const img = document.createElement('img')
  img.src = opts.src ?? `asset:${id}`
  anim.appendChild(img)
  el.appendChild(anim)
  Object.defineProperties(el, {
    offsetWidth: { value: width, configurable: true },
    offsetHeight: { value: size, configurable: true },
  })
  // A dragged box reports where its `translate` has taken it, the way a real one does.
  el.getBoundingClientRect = () => rect((opts.x ?? 0) + (parseFloat(el.style.translate) || 0), opts.y ?? 200, width, size)
  return el
}

interface Mounted {
  mod: ReturnType<typeof createCatch>
  paRoot: HTMLElement
  items: HTMLElement[]
  check: HTMLElement
  box: HTMLElement | null
  frame: (ms?: number) => void
  spawn: (n?: number) => void
  completed: () => boolean
  won: () => boolean
  played: string[]
}

function mount(params: Record<string, unknown> = {}, itemCount = 3, withBox = false): Mounted {
  const paRoot = document.createElement('div')
  paRoot.className = 'pa-root'
  Object.defineProperty(paRoot, 'offsetWidth', { value: 1080, configurable: true })
  paRoot.getBoundingClientRect = () => rect(0, 0, 1080, 1920)
  document.body.appendChild(paRoot)

  const items = Array.from({ length: itemCount }, (_, i) => placed(`shoe${i + 1}`, 'item', { index: i + 1, x: 100 + i * 200 }))
  const check = placed('tick', 'check', { size: 60 })
  // A box placed high up the screen, to prove the catch line is ITS height and not the
  // bottom of the screen: 1200..1500 down, 900 wide, centred on 540.
  const box = withBox ? placed('box', 'box', { x: 90, y: 1200, w: 900, size: 300 }) : null
  for (const el of [...items, check, ...(box ? [box] : [])]) paRoot.appendChild(el)

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

  const played: string[] = []
  const ctx: GameContext = {
    root,
    assets: { src: (id) => (id ? `asset:${id}` : ''), size: () => ({ w: 100, h: 100 }) },
    sfx: { play: (event) => played.push(event) },
    rng: mulberry32(42),
    scale: () => 1,
    elementId: 'catch-game',
  } as GameContext

  const mod = createCatch()
  // A basket wide enough that horizontal aim never decides the test: what is under
  // examination is what happens ON a catch, not whether one lands.
  mod.mount(ctx, { speed: 3, spawnMs: 100, frontBasketWidth: 2000, frontBasketHeight: 150, checkFadeMs: 0, caughtFadeMs: 0, ...params })
  let complete = false
  let win = false
  mod.onComplete(() => (complete = true))
  mod.onWin?.(() => (win = true))
  mod.start()
  mod.relayout?.()

  let now = 0
  return {
    mod,
    paRoot,
    items,
    check,
    box,
    frame: (ms = 32) => {
      now += ms
      raf?.(now)
    },
    spawn: (n = 1) => vi.advanceTimersByTime(100 * n),
    completed: () => complete,
    won: () => win,
    played,
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

  it('catches at the height the box was placed at, and only slides it sideways', () => {
    vi.useFakeTimers()
    // The default rig would catch at the bottom of the screen; this box sits at 1200.
    const game = mount({ frontBasketWidth: 300 }, 3, true)
    const box = game.box as HTMLElement
    const top = box.style.top
    game.spawn()

    // Falling, but not yet down to the box: nothing caught.
    for (let i = 0; i < 3; i++) game.frame(16)
    expect(game.paRoot.querySelectorAll('[data-id^="catch_check_"]').length).toBe(0)

    play(game)
    expect(game.completed()).toBe(true)
    // Dragged sideways, never up or down: only the translate property was written, and
    // it carries no vertical component.
    expect(box.style.top).toBe(top)
    expect(box.style.translate === '' || /^-?[\d.]+px$/.test(box.style.translate)).toBe(true)
    // The caught items hang inside the box element itself, not in a basket of the
    // game's own making.
    expect(box.querySelector('div[style*="position: absolute"]')).toBeTruthy()
    expect(game.paRoot.querySelector('[data-id="basket"]')).toBeNull()
  })

  it('throws the items still missing more often than the ones already collected', () => {
    vi.useFakeTimers()
    const game = mount({ uncaughtBias: 8 }, 4)
    // Stop as soon as half the set is in, then count what the next hundred throws are.
    const caughtIds = (): string[] => game.items.filter((el) => el.classList.contains('pa-catch-caught')).map((el) => el.dataset.id as string)
    for (let i = 0; i < 400 && caughtIds().length < 2; i++) {
      game.spawn()
      game.frame()
    }
    const collected = caughtIds()
    expect(collected.length).toBe(2)
    expect(game.completed()).toBe(false)

    const thrown: string[] = []
    for (let i = 0; i < 100; i++) {
      game.spawn()
      const drops = Array.from(game.paRoot.querySelectorAll('img')).filter((img) => !img.closest('.pa-el'))
      const last = drops[drops.length - 1]?.getAttribute('src')
      if (last) thrown.push(last.replace('asset:', ''))
      game.frame(1)
    }
    const missing = thrown.filter((id) => !collected.includes(id)).length
    // Weighted, not forced: the ones already in still turn up, just far less often.
    expect(missing).toBeGreaterThan(thrown.length * 0.6)
    expect(missing).toBeLessThan(thrown.length)
  })

  it('sounds a counting catch apart from any catch, and reports the win', () => {
    vi.useFakeTimers()
    const game = mount()
    play(game)
    expect(game.completed()).toBe(true)
    // A duplicate still lands with a thud ('catch') but does not count ('correct'), so
    // the counting beat can never outnumber the landing one. Both are one per frame
    // however many arrived together, which is why this is a comparison and not a count.
    const correct = game.played.filter((e) => e === 'correct').length
    const anyCatch = game.played.filter((e) => e === 'catch').length
    expect(correct).toBeGreaterThan(0)
    expect(anyCatch).toBeGreaterThan(correct)
    // The element-level "when the game is won" binding needs this callback; the win
    // sound itself is left to the host, which times it against the win animation.
    expect(game.won()).toBe(true)
    expect(game.played).toContain('gameWin')
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
