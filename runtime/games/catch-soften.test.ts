// Elements the author assigns the 'soften' role: a falling item passing behind one is
// blurred and faded, so the element's own art stays legible over the traffic behind it.
// One patch per assigned element sits inside the drops' own layer carrying a
// backdrop-filter, which reworks the items behind it — and only them: `isolation: isolate`
// on the drops container keeps the backdrop art and the rest of the scene out of that
// backdrop. A patch over an element with a picture is masked with it, so the effect follows
// the art instead of hazing a rectangle around it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCatch } from './catch'
import { mulberry32, type GameContext } from './types'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect

/** A placed element as stage.ts builds one, at the layer and kind the author gave it. */
function placed(
  id: string,
  z: number,
  opts: { type?: string; role?: 'box' | 'boxfront' | 'soften' | 'item'; background?: boolean; src?: string; box?: DOMRect } = {},
): HTMLElement {
  const el = document.createElement('div')
  el.className = 'pa-el' + (opts.background ? ' pa-el--background' : '')
  el.dataset.id = id
  el.dataset.type = opts.type ?? 'image'
  if (opts.role) el.dataset.catchRole = opts.role
  el.style.zIndex = String(z)
  if (opts.src !== '') {
    const img = document.createElement('img')
    img.src = opts.src ?? `asset:${id}`
    el.appendChild(img)
  }
  const box = opts.box ?? rect(90, 1200, 900, 300)
  Object.defineProperties(el, {
    offsetWidth: { value: box.width, configurable: true },
    offsetHeight: { value: box.height, configurable: true },
  })
  el.getBoundingClientRect = () => box
  return el
}

interface Scene {
  paRoot: HTMLElement
  drops: HTMLElement
  patch: (elId: string) => HTMLElement | null
  patches: () => HTMLElement[]
  frame: () => void
  destroy: () => void
}

function scene(layers: HTMLElement[], params: Record<string, unknown> = {}): Scene {
  const paRoot = document.createElement('div')
  paRoot.className = 'pa-root'
  Object.defineProperty(paRoot, 'offsetWidth', { value: 1080, configurable: true })
  paRoot.getBoundingClientRect = () => rect(0, 0, 1080, 1920)
  document.body.appendChild(paRoot)
  for (const el of layers) paRoot.appendChild(el)

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
  mod.mount(ctx, { speed: 3, spawnMs: 100, frontBasketWidth: 2000, frontBasketHeight: 150, ...params })
  mod.start()
  mod.relayout?.()

  const drops = paRoot.querySelector<HTMLElement>('[data-id="catch_drops"]')!
  return {
    paRoot,
    drops,
    patch: (elId) => drops.querySelector<HTMLElement>(`[data-id="catch_soften_${elId}"]`),
    patches: () => Array.from(drops.querySelectorAll<HTMLElement>('[data-id^="catch_soften_"]')),
    frame: () => raf?.(32),
    destroy: () => mod.destroy?.(),
  }
}

const bg = () => placed('bg', 0, { type: 'background', background: true })
const box = () => placed('box', 2, { role: 'box' })

describe('falling items soften behind assigned elements', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('puts a masked patch over an assigned element, blurring and fading what falls behind', () => {
    const logo = placed('logo', 20, { role: 'soften', src: 'asset:logo.png', box: rect(100, 300, 400, 200) })
    const s = scene([bg(), box(), logo], { softenBlurPx: 8 })
    const patch = s.patch('logo')
    expect(patch).toBeTruthy()
    expect(patch!.style.backdropFilter).toBe('blur(8px) opacity(0.4)')
    // Masked with the element's own art: the blur follows the picture, so a logo with
    // transparent corners doesn't get a rectangle of haze around it.
    expect(patch!.style.getPropertyValue('mask-image')).toBe('url("asset:logo.png")')
  })

  it('scopes the backdrop to the drops, so the background stays sharp', () => {
    const s = scene([bg(), box(), placed('logo', 20, { role: 'soften' })], { softenBlurPx: 8 })
    // Without this the backdrop-filter would reach past the drops and blur the scene's
    // background art through the patch.
    expect(s.drops.style.isolation).toBe('isolate')
    expect(s.patch('logo')!.parentElement).toBe(s.drops)
  })

  it('keeps the patch above every drop, including ones spawned later', () => {
    // A backdrop filter only sees what is painted BEHIND it, and drops keep arriving after
    // the patch was appended — so it cannot rely on DOM order.
    const s = scene([bg(), box(), placed('logo', 20, { role: 'soften' })], { softenBlurPx: 8 })
    expect(s.patch('logo')!.style.zIndex).toBe('1')
  })

  it('lays the patch over its element’s box', () => {
    const logo = placed('logo', 20, { role: 'soften', box: rect(120, 340, 400, 200) })
    const s = scene([bg(), box(), logo], { softenBlurPx: 8 })
    const patch = s.patch('logo')!
    expect([patch.style.left, patch.style.top, patch.style.width, patch.style.height]).toEqual(['120px', '340px', '400px', '200px'])
  })

  it('follows an element that moves, on the frame loop', () => {
    const logo = placed('logo', 20, { role: 'soften', box: rect(120, 340, 400, 200) })
    const s = scene([bg(), box(), logo], { softenBlurPx: 8 })
    logo.getBoundingClientRect = () => rect(200, 500, 400, 200)
    s.frame()
    expect([s.patch('logo')!.style.left, s.patch('logo')!.style.top]).toEqual(['200px', '500px'])
  })

  it('skips images the drops already cover', () => {
    // Blurring behind something the drops paint over would soften nothing. An image down on
    // the backdrop's own layer is behind them; one above is not.
    const s = scene([bg(), box(), placed('under', 0, { role: 'soften' }), placed('over', 9, { role: 'soften' })], { softenBlurPx: 8 })
    expect(s.patch('under')).toBeNull()
    expect(s.patch('over')).toBeTruthy()
  })

  it('covers the whole box of an element with no art to mask with', () => {
    // A text block or a plain panel has no picture to follow — the effect takes its rect,
    // which is what it draws anyway.
    const s = scene([bg(), box(), placed('label', 20, { role: 'soften', src: '', box: rect(10, 20, 300, 80) })], { softenBlurPx: 8 })
    const patch = s.patch('label')
    expect(patch).toBeTruthy()
    expect(patch!.style.getPropertyValue('mask-image')).toBe('')
    expect([patch!.style.width, patch!.style.height]).toEqual(['300px', '80px'])
  })

  it('fades without blurring when only the opacity is turned down', () => {
    const s = scene([bg(), box(), placed('logo', 20, { role: 'soften' })], { softenBlurPx: 0, softenOpacity: 0.25 })
    expect(s.patch('logo')!.style.backdropFilter).toBe('opacity(0.25)')
  })

  it('blurs without fading when the opacity is left at full', () => {
    const s = scene([bg(), box(), placed('logo', 20, { role: 'soften' })], { softenBlurPx: 5, softenOpacity: 1 })
    expect(s.patch('logo')!.style.backdropFilter).toBe('blur(5px)')
  })

  it('leaves unassigned elements alone', () => {
    // The whole point of the role: only art the author picked is softened behind.
    const s = scene([bg(), box(), placed('logo', 20, { role: 'soften' }), placed('title', 21), placed('cta', 22)], { softenBlurPx: 8 })
    expect(s.patches().map((p) => p.dataset.id)).toEqual(['catch_soften_logo'])
  })

  it('softens behind the placed items without being asked', () => {
    // The row IS the board — read constantly while copies of those same items rain past
    // behind it — so it comes in without an assignment.
    const item = placed('shoe1', 20, { role: 'item' })
    item.dataset.catchIndex = '1'
    const s = scene([bg(), box(), item, placed('logo', 21, { role: 'soften' })], { softenBlurPx: 8 })
    expect(s.patches().map((p) => p.dataset.id).sort()).toEqual(['catch_soften_logo', 'catch_soften_shoe1'])
  })

  it('is off when neither blur nor fade is asked for, leaving the drops container untouched', () => {
    const s = scene([bg(), box(), placed('logo', 20, { role: 'soften' })], { softenBlurPx: 0, softenOpacity: 1 })
    expect(s.patches()).toHaveLength(0)
    expect(s.drops.style.isolation).toBe('')
  })

  it('is on by default', () => {
    const s = scene([bg(), box(), placed('logo', 20, { role: 'soften' })])
    expect(s.patch('logo')!.style.backdropFilter).toBe('blur(6px) opacity(0.4)')
  })

  it('takes the patches down with the drops on destroy', () => {
    const s = scene([bg(), box(), placed('logo', 20, { role: 'soften' })], { softenBlurPx: 8 })
    expect(s.patches()).toHaveLength(1)
    s.destroy()
    expect(s.paRoot.querySelectorAll('[data-id^="catch_soften_"]')).toHaveLength(0)
  })
})
