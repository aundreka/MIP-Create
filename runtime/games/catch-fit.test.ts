// A caught item is inside the box, so it may not be wider than the box.
//
// These cover the MANUAL path — caught Xs/Ys/scales typed per item, where the author places
// each product themselves and can ask for something that doesn't fit. (In the default Auto
// mode the box packs its own collection and the fit is guaranteed by construction; see
// catch-stack.test.ts.) Two mechanisms, because neither covers the other's case: the
// authored scale is capped to whatever fits, so an oversized item shrinks rather than being
// sliced; and the caught-items layer is clipped to the box's width, so an authored X offset
// cannot push a perfectly-fitting item out sideways. The clip is horizontal only — items are
// meant to stand proud of the box's top rim.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCatch } from './catch'
import { mulberry32, type GameContext } from './types'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect

const BOX_W = 400
const BOX_LEFT = 340

/** A placed element as stage.ts builds one. */
function placed(id: string, role: 'item' | 'box', opts: { index?: number; w?: number; h?: number } = {}): HTMLElement {
  const el = document.createElement('div')
  el.className = 'pa-el'
  el.dataset.id = id
  el.dataset.catchRole = role
  if (opts.index) el.dataset.catchIndex = String(opts.index)
  const w = opts.w ?? 100
  const h = opts.h ?? 100
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
    role === 'box' ? rect(BOX_LEFT + (parseFloat(el.style.translate) || 0), 1200, BOX_W, 300) : rect(0, 200, w, h)
  return el
}

interface Board {
  paRoot: HTMLElement
  box: HTMLElement
  /** The caught items sitting inside the box, in the order they landed. */
  caught: () => HTMLElement[]
  play: () => void
}

/** A board whose items fall at `itemFallScale` x their placed size, into a 400px box. */
function board(params: Record<string, unknown>, itemW = 100): Board {
  vi.useFakeTimers()
  const paRoot = document.createElement('div')
  paRoot.className = 'pa-root'
  Object.defineProperty(paRoot, 'offsetWidth', { value: 1080, configurable: true })
  paRoot.getBoundingClientRect = () => rect(0, 0, 1080, 1920)
  document.body.appendChild(paRoot)

  const items = [placed('shoe1', 'item', { index: 1, w: itemW }), placed('shoe2', 'item', { index: 2, w: itemW })]
  const box = placed('box', 'box')
  for (const el of [...items, box]) paRoot.appendChild(el)

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
  mod.mount(ctx, { speed: 3, spawnMs: 100, requireUnique: false, catches: 4, caughtFadeMs: 0, caughtStack: 'Manual', ...params })
  mod.start()
  mod.relayout?.()

  let now = 0
  return {
    paRoot,
    box,
    caught: () => Array.from(box.querySelectorAll<HTMLElement>('div[style*="transform"]')).filter((el) => el.style.transformOrigin === 'bottom center'),
    play: () => {
      for (let i = 0; i < 400; i++) {
        vi.advanceTimersByTime(100)
        now += 32
        raf?.(now)
      }
    },
  }
}

/** The scale a landed item ended up drawn at. */
const scaleOf = (el: HTMLElement): number => Number(/scale\(([-\d.]+)\)/.exec(el.style.transform)?.[1])

describe('caught items stay inside the box', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('leaves an item that already fits at the scale the author asked for', () => {
    // 100px placed x 2 fall scale = 200px, at 0.7 = 140px in a 400px box. Room to spare.
    const b = board({ itemFallScale: 2, caughtItemScales: '0.7' })
    b.play()
    const landed = b.caught()
    expect(landed.length).toBeGreaterThan(0)
    for (const el of landed) expect(scaleOf(el)).toBeCloseTo(0.7, 5)
  })

  it('shrinks an item that would hang over the sides', () => {
    // 300px placed x 2 = 600px falling. At the authored 1.0 it would be 600 wide in a
    // 400 box; capped to exactly 400/600.
    const b = board({ itemFallScale: 2, caughtItemScales: '1' }, 300)
    b.play()
    const landed = b.caught()
    expect(landed.length).toBeGreaterThan(0)
    for (const el of landed) {
      expect(scaleOf(el)).toBeCloseTo(BOX_W / 600, 5)
      expect(Number(el.style.width.replace('px', '')) * scaleOf(el)).toBeLessThanOrEqual(BOX_W)
    }
  })

  it('measures a rotated item by the width it really occupies', () => {
    // 200x200 falling, turned 45°: it spans 200·√2 ≈ 283, not 200. The cap has to see the
    // corner-to-corner span, or a tilted item pokes out at exactly the authored scale.
    const b = board({ itemFallScale: 2, caughtItemScales: '2', caughtItemAngles: '45' })
    b.play()
    const landed = b.caught()
    expect(landed.length).toBeGreaterThan(0)
    const span = 200 * Math.SQRT2
    for (const el of landed) expect(scaleOf(el)).toBeCloseTo(BOX_W / span, 4)
  })

  it('clips the caught layer to the box width, leaving the top rim open', () => {
    // The size cap cannot stop an authored X offset from pushing a fitting item out, so
    // the layer is clipped too — sideways only, since items are meant to stand proud.
    const b = board({ itemFallScale: 2, caughtItemScales: '0.7', caughtItemXs: '400' })
    b.play()
    const layer = b.box.querySelector<HTMLElement>('div[style*="clip-path"]')
    expect(layer).toBeTruthy()
    expect(layer!.style.clipPath).toBe('inset(-100% 0px -100% 0px)')
  })
})
