// Where the falling items sit in the stack. With a PLACED box the order is
// background → box → falling items → box front → everything else: the drops go behind
// every placed element, in front of only the background art and the box, and behind the
// box's own front layer so a catch reads as landing INSIDE the box.
//
// The layers are read off the scene rather than fixed at a number, so the rule holds for
// whatever z-indexes the author used, and the box / drops / front trio is ordered by DOM
// position because three layers rarely fit in the gap the author left.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCatch } from './catch'
import { mulberry32, type GameContext } from './types'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect

/** A placed element as stage.ts builds one, at the layer the author gave it. */
function placed(id: string, z: number, opts: { background?: boolean; role?: 'box' | 'boxfront' } = {}): HTMLElement {
  const el = document.createElement('div')
  el.className = 'pa-el' + (opts.background ? ' pa-el--background' : '')
  el.dataset.id = id
  if (opts.role) el.dataset.catchRole = opts.role
  el.style.zIndex = String(z)
  Object.defineProperties(el, {
    offsetWidth: { value: 900, configurable: true },
    offsetHeight: { value: 300, configurable: true },
  })
  el.getBoundingClientRect = () => rect(90, 1200, 900, 300)
  return el
}

interface Stack {
  paRoot: HTMLElement
  drops: HTMLElement
  z: (el: HTMLElement) => number
  /** Does `over` paint above `under`, by layer first and DOM order on a tie? */
  paintsOver: (over: HTMLElement, under: HTMLElement) => boolean
  destroy: () => void
}

/** Mount the game over a scene made of the given layers. */
function stack(layers: HTMLElement[]): Stack {
  const paRoot = document.createElement('div')
  paRoot.className = 'pa-root'
  Object.defineProperty(paRoot, 'offsetWidth', { value: 1080, configurable: true })
  paRoot.getBoundingClientRect = () => rect(0, 0, 1080, 1920)
  document.body.appendChild(paRoot)
  for (const el of layers) paRoot.appendChild(el)

  const root = document.createElement('div')
  paRoot.appendChild(root)
  vi.stubGlobal('requestAnimationFrame', () => 1)
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
  mod.mount(ctx, { speed: 3, spawnMs: 100, frontBasketWidth: 2000, frontBasketHeight: 150 })
  mod.start()
  mod.relayout?.()

  const drops = paRoot.querySelector<HTMLElement>('[data-id="catch_drops"]')!
  expect(drops).toBeTruthy()
  const z = (el: HTMLElement): number => Number(el.style.zIndex)
  return {
    paRoot,
    drops,
    z,
    paintsOver: (over, under) =>
      z(over) !== z(under) ? z(over) > z(under) : !!(under.compareDocumentPosition(over) & Node.DOCUMENT_POSITION_FOLLOWING),
    destroy: () => mod.destroy?.(),
  }
}

describe('falling items sit behind the scene, above the background and the box', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('drops one layer under the lowest placed element', () => {
    // Background 0 and box 2 are the floor; content runs from 5 up, so the drops take 4.
    const s = stack([placed('bg', 0, { background: true }), placed('box', 2, { role: 'box' }), placed('title', 5), placed('cta', 20)])
    expect(s.z(s.drops)).toBe(4)
  })

  it('paints over the background and the box, under everything above them', () => {
    const bg = placed('bg', 0, { background: true })
    const box = placed('box', 1, { role: 'box' })
    const title = placed('title', 2)
    const s = stack([bg, box, title])
    // bg 0 / box 1 / title 2 leaves no integer for the drops — they land on the box's
    // layer and win the tie by DOM order, still under the title.
    expect(s.paintsOver(s.drops, bg)).toBe(true)
    expect(s.paintsOver(s.drops, box)).toBe(true)
    expect(s.paintsOver(title, s.drops)).toBe(true)
  })

  it('passes behind the box’s front layer, so a catch lands inside it', () => {
    const box = placed('box', 2, { role: 'box' })
    const front = placed('box_front', 2, { role: 'boxfront' })
    const s = stack([placed('bg', 0, { background: true }), box, front, placed('title', 9)])
    expect(s.paintsOver(s.drops, box)).toBe(true) // in front of the box
    expect(s.paintsOver(front, s.drops)).toBe(true) // behind its front
  })

  it('keeps the front layer under content the author stacked above the box', () => {
    const front = placed('box_front', 2, { role: 'boxfront' })
    const title = placed('title', 9)
    const s = stack([placed('bg', 0, { background: true }), placed('box', 2, { role: 'box' }), front, placed('cta', 20), title])
    // The front is part of the box, not a new top layer: it must not jump the CTA.
    expect(s.paintsOver(title, front)).toBe(true)
  })

  it('stays behind every element in a full scene', () => {
    // The rule, stated directly: everything except the background and the box paints over
    // the drops, whatever layers the author used and whatever order they were added in.
    const bg = placed('bg', 0, { background: true })
    const box = placed('box', 3, { role: 'box' })
    const front = placed('box_front', 3, { role: 'boxfront' })
    const content = [placed('shelf', 4), placed('title', 12), placed('score', 12), placed('cta', 40), placed('logo', 7)]
    const s = stack([bg, box, front, ...content])
    for (const el of content) expect(s.paintsOver(el, s.drops)).toBe(true)
    expect(s.paintsOver(s.drops, bg)).toBe(true)
    expect(s.paintsOver(s.drops, box)).toBe(true)
    expect(s.paintsOver(front, s.drops)).toBe(true)
  })

  it('is not pushed over content by a front layer authored high', () => {
    // The front's own layer says nothing — it is the box's front, and it follows the
    // drops. Counting it as floor would drag them up over the title, which is the exact
    // thing the rule forbids.
    const front = placed('box_front', 90, { role: 'boxfront' })
    const title = placed('title', 10)
    const s = stack([placed('bg', 0, { background: true }), placed('box', 2, { role: 'box' }), front, title])
    expect(s.z(s.drops)).toBe(9)
    expect(s.paintsOver(title, s.drops)).toBe(true) // behind the title, as required
    expect(s.paintsOver(front, s.drops)).toBe(true) // and still under its own front
  })

  it('lowers a box authored above the content instead of riding it up', () => {
    // The drops cannot be both in front of a box on layer 20 and behind a title on layer 3.
    // The flat rule wins: the box comes DOWN to join the rig, and the drops end up behind
    // every element again.
    const shelf = placed('shelf', 3)
    const box = placed('box', 20, { role: 'box' })
    const title = placed('title', 40)
    const s = stack([placed('bg', 0, { background: true }), shelf, box, title])
    expect(s.z(s.drops)).toBe(2)
    expect(s.paintsOver(s.drops, box)).toBe(true) // still in front of the box
    expect(s.paintsOver(shelf, s.drops)).toBe(true) // and now behind the shelf it used to cover
    expect(s.paintsOver(title, s.drops)).toBe(true)
  })

  it('treats the lowest element as the backdrop when the scene has no background type', () => {
    // Plenty of scenes never use the background element type — the backdrop is just a
    // full-bleed image at the bottom of the stack. Counting it as content would push the
    // drops underneath it, where nothing can be seen.
    const backdrop = placed('bg_image', 1)
    const box = placed('box', 20, { role: 'box' })
    const logo = placed('logo', 3)
    const s = stack([backdrop, logo, box, placed('title', 4)])
    expect(s.z(s.drops)).toBe(2)
    expect(s.paintsOver(s.drops, backdrop)).toBe(true) // in front of the backdrop
    expect(s.paintsOver(logo, s.drops)).toBe(true) // behind everything else
  })

  it('gives the box its authored layer back on destroy', () => {
    const box = placed('box', 20, { role: 'box' })
    const s = stack([placed('bg', 0, { background: true }), placed('title', 4), box])
    expect(box.style.zIndex).toBe('3') // lowered onto the rig, one under the title
    s.destroy()
    expect(box.style.zIndex).toBe('20')
  })

  it('treats a high-authored front as part of the box, not as content to stop under', () => {
    const front = placed('box_front', 30, { role: 'boxfront' })
    const s = stack([placed('bg', 0, { background: true }), placed('box', 3, { role: 'box' }), front, placed('title', 40)])
    // Content would have stopped the drops at 29. The front is the box, so it raises the
    // floor instead and the drops go on up to just under the title — with the front
    // re-layered alongside them so it still paints over.
    expect(s.z(s.drops)).toBe(39)
    expect(s.paintsOver(front, s.drops)).toBe(true)
  })

  it('follows the author’s numbering rather than a fixed layer', () => {
    const s = stack([placed('bg', 10, { background: true }), placed('box', 12, { role: 'box' }), placed('title', 40), placed('cta', 60)])
    expect(s.z(s.drops)).toBe(39)
  })

  it('sits on a background parked above the content rather than under it', () => {
    // Pathological scene: the background covers the title. Following the title down to 2
    // would bury the drops behind that background — the one thing the exception exists to
    // prevent — and the title is invisible there anyway. The floor wins.
    const s = stack([placed('bg', 30, { background: true }), placed('box', 1, { role: 'box' }), placed('title', 3)])
    expect(s.z(s.drops)).toBe(30)
  })

  it('skips elements with no layer of their own', () => {
    // z-index:auto stacks in DOM order, always before the container appended last, so an
    // unlayered element must not read as layer 0 and drag the drops below the background.
    const auto = placed('sticker', 0)
    auto.style.zIndex = ''
    const s = stack([placed('bg', 4, { background: true }), placed('box', 4, { role: 'box' }), auto, placed('cta', 9)])
    expect(s.z(s.drops)).toBe(8)
  })

  it('keeps the built-in basket rig’s sandwich when no box is placed', () => {
    // No placed box: the game builds backBasket z:30 / frontBasket z:32 itself, and the
    // drops must stay in the one slot between them rather than dropping to the back.
    const s = stack([placed('bg', 0, { background: true }), placed('title', 5)])
    expect(s.z(s.drops)).toBe(31)
  })

  it('releases a front left over from a cleared box slot', () => {
    // No box: the front has nothing to ride, so it must go back to being an ordinary
    // element rather than sitting claimed with its pointer events switched off.
    const front = placed('box_front', 7, { role: 'boxfront' })
    front.style.pointerEvents = 'auto'
    stack([placed('bg', 0, { background: true }), front])
    expect(front.style.pointerEvents).toBe('auto')
    expect(front.dataset.catchClaimedBy).toBeUndefined()
  })

  it('hands the front layer back untouched on destroy', () => {
    const front = placed('box_front', 7, { role: 'boxfront' })
    front.style.pointerEvents = 'auto'
    const s = stack([placed('bg', 0, { background: true }), placed('box', 2, { role: 'box' }), front])
    s.destroy()
    expect(front.style.zIndex).toBe('7')
    expect(front.style.translate).toBe('')
    expect(front.style.pointerEvents).toBe('auto')
    expect(front.dataset.catchClaimedBy).toBeUndefined()
  })
})
