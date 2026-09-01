// Grabbing the placed box. It paints on the rig's layer, low in the scene, so it is not
// necessarily the element under the finger — the game's own mount, a panel, anything the
// author left tappable can sit over it. The drag is therefore picked up by hit testing on
// pa-root in the capture phase: wherever the box paints, a press inside it drags.
// Controls are the exception and keep their taps.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCatch } from './catch'
import { mulberry32, type GameContext } from './types'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect

// The box as placed: 900 wide, centred, low down the screen.
const BOX = rect(90, 1200, 900, 300)

function placed(id: string, z: number, opts: { type?: string; role?: 'box' | 'boxfront'; box?: DOMRect } = {}): HTMLElement {
  const el = document.createElement('div')
  el.className = 'pa-el'
  el.dataset.id = id
  el.dataset.type = opts.type ?? 'image'
  if (opts.role) el.dataset.catchRole = opts.role
  el.style.zIndex = String(z)
  const box = opts.box ?? BOX
  Object.defineProperties(el, {
    offsetWidth: { value: box.width, configurable: true },
    offsetHeight: { value: box.height, configurable: true },
  })
  el.getBoundingClientRect = () => rect(box.left + (parseFloat(el.style.translate) || 0), box.top, box.width, box.height)
  return el
}

interface Board {
  paRoot: HTMLElement
  box: HTMLElement
  /** Press at a point, reporting from `on` (the element that would really receive it). */
  press: (x: number, y: number, on?: HTMLElement) => void
  drag: (x: number) => void
  /** How far the box has been slid, in px. */
  slid: () => number
  relayout: () => void
  destroy: () => void
}

function board(layers: HTMLElement[], box: HTMLElement, stage = rect(0, 0, 1080, 1920)): Board {
  const paRoot = document.createElement('div')
  paRoot.className = 'pa-root'
  Object.defineProperty(paRoot, 'offsetWidth', { value: stage.width, configurable: true })
  paRoot.getBoundingClientRect = () => stage
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
  mod.mount(ctx, { speed: 3, spawnMs: 100, basketLocked: 'Unlocked' })
  mod.start()
  mod.relayout?.()

  const fire = (type: string, x: number, y: number, on: HTMLElement): void => {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
    Object.defineProperties(ev, { clientX: { value: x }, clientY: { value: y } })
    on.dispatchEvent(ev)
  }
  return {
    paRoot,
    relayout: () => mod.relayout?.(),
    box,
    press: (x, y, on = box) => fire('pointerdown', x, y, on),
    drag: (x) => {
      const ev = new Event('pointermove', { bubbles: true }) as PointerEvent
      Object.defineProperties(ev, { clientX: { value: x }, clientY: { value: BOX.top + 10 } })
      window.dispatchEvent(ev)
    },
    slid: () => parseFloat(box.style.translate) || 0,
    destroy: () => mod.destroy?.(),
  }
}

describe('dragging the placed box', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('drags when the press lands on the box itself', () => {
    const box = placed('box', 20, { role: 'box' })
    const b = board([placed('bg', 0), box], box)
    b.press(540, 1300)
    b.drag(300)
    expect(b.slid()).not.toBe(0)
  })

  it('still drags when an interactive element covers the box', () => {
    // The regression this guards: the box is lowered onto the rig's layer, so the game's
    // own mount — which stage.ts leaves tappable — paints over it and receives the press.
    const box = placed('box', 20, { role: 'box' })
    const mount = placed('mount', 30, { type: 'game-mount', box: rect(0, 0, 1080, 1920) })
    const b = board([placed('bg', 0), box, mount], box)
    b.press(540, 1300, mount) // the press really lands on the mount, not the box
    b.drag(300)
    expect(b.slid()).not.toBe(0)
  })

  it('ignores a press outside the box', () => {
    const box = placed('box', 20, { role: 'box' })
    const mount = placed('mount', 30, { type: 'game-mount', box: rect(0, 0, 1080, 1920) })
    const b = board([placed('bg', 0), box, mount], box)
    b.press(540, 200, mount) // up at the top of the screen, nowhere near the box
    b.drag(300)
    expect(b.slid()).toBe(0)
  })

  it('leaves a CTA’s tap alone even where it overlaps the box', () => {
    // An ad's click-out must never be eaten by the game.
    const box = placed('box', 20, { role: 'box' })
    const cta = placed('cta', 30, { type: 'cta', box: BOX })
    const b = board([placed('bg', 0), box, cta], box)
    let tapped = false
    cta.addEventListener('pointerdown', () => (tapped = true))
    b.press(540, 1300, cta)
    b.drag(300)
    expect(tapped).toBe(true)
    expect(b.slid()).toBe(0)
  })

  it('follows the finger in landscape, where the column is letterboxed', () => {
    // A wide stage: the 1080 design column sits in the middle of a 1920-wide viewport. The
    // drag used to be measured from the WINDOW's centre, which in portrait is the column's
    // centre and in landscape is 420px to the right of it — so the box slid off to the left
    // and stayed pinned there.
    const box = placed('box', 20, { role: 'box', box: rect(760, 1200, 400, 300) })
    const b = board([placed('bg', 0), box], box, rect(0, 0, 1920, 1080))
    b.press(960, 1300) // press at the stage's centre, where the box already is
    b.drag(960) // and hold still
    expect(Math.abs(b.slid())).toBeLessThan(1) // the box does not lurch anywhere
    b.drag(1060) // now move 100px right
    expect(b.slid()).toBeCloseTo(100, 0) // and it follows, one for one
  })

  it('keeps its place across a resize instead of jumping or vanishing', () => {
    // A 400-wide box in the 1080 column, so a 200px drag is well inside the walls.
    const box = placed('box', 20, { role: 'box', box: rect(340, 1200, 400, 300) })
    const b = board([placed('bg', 0), box], box)
    b.press(540, 1300)
    b.drag(740) // dragged 200px right of home
    const before = b.slid()
    expect(before).toBeCloseTo(200, 0)
    b.relayout() // a resize / rotation re-lays the box out
    // Still 200 from home, not measured against an origin the box no longer sits at — the
    // error that used to send it off screen.
    expect(b.slid()).toBeCloseTo(before, 0)
  })

  it('takes the box front along with it', () => {
    // The front is part of the box: it has to travel on exactly the same slide, or the box
    // slides out from behind its own front wall.
    const box = placed('box', 20, { role: 'box', box: rect(340, 1200, 400, 300) })
    const front = placed('front', 21, { role: 'boxfront', box: rect(340, 1200, 400, 300) })
    const b = board([placed('bg', 0), box, front], box)
    b.press(540, 1300)
    b.drag(700)
    expect(parseFloat(b.slid().toString())).not.toBe(0)
    expect(front.style.translate).toBe(box.style.translate)
  })

  it('stops listening once the game is torn down', () => {
    const box = placed('box', 20, { role: 'box' })
    const b = board([placed('bg', 0), box], box)
    b.destroy()
    b.press(540, 1300, b.paRoot)
    b.drag(300)
    expect(b.slid()).toBe(0)
  })
})
