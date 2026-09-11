// Scratch card: a placed scratcher scratches at its TIP, the finger alone no longer
// scratches, the scratch area clips what can be cleared, and progress goes out to
// progress bars as a fraction of the way to the threshold.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createScratch } from './scratch'
import { onProgress, type ProgressDetail } from './progresschannel'
import type { GameModule } from './types'

type Call = [string, ...number[]]
let calls: Call[] = []
let origGetContext: typeof HTMLCanvasElement.prototype.getContext
let origRect: typeof Element.prototype.getBoundingClientRect
const rects = new Map<Element, () => DOMRect>()

function fakeCtx(): CanvasRenderingContext2D {
  const rec =
    (name: string) =>
    (...a: number[]): void => {
      calls.push([name, ...a])
    }
  return {
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    save: rec('save'),
    restore: rec('restore'),
    clip: rec('clip'),
    rect: rec('rect'),
    arc: rec('arc'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    beginPath: () => {},
    stroke: () => {},
    fill: () => {},
    fillRect: () => {},
    clearRect: () => {},
    fillText: () => {},
    drawImage: () => {},
    // Nothing cleared yet: every sampled pixel fully opaque.
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
  } as unknown as CanvasRenderingContext2D
}

function pointer(type: string, x: number, y: number): Event {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  Object.defineProperty(e, 'pointerType', { value: 'mouse' })
  return e
}

/** A 100×100 card at the origin, and a 40×20 stick at (10,40) whose tip is 90%/50%. */
function setup(params: Record<string, unknown>): { game: GameModule; root: HTMLElement; stick: HTMLElement } {
  const paRoot = document.createElement('div')
  paRoot.className = 'pa-root'
  const gameEl = document.createElement('div')
  gameEl.className = 'pa-el'
  gameEl.dataset.id = 'card'
  const root = document.createElement('div')
  gameEl.appendChild(root)
  const stick = document.createElement('div')
  stick.className = 'pa-el'
  stick.dataset.id = 'stick'
  const anim = document.createElement('div')
  anim.className = 'pa-el-anim'
  stick.appendChild(anim)
  paRoot.append(gameEl, stick)
  document.body.appendChild(paRoot)
  Object.defineProperty(root, 'clientWidth', { value: 100 })
  Object.defineProperty(root, 'clientHeight', { value: 100 })

  rects.set(paRoot, () => new DOMRect(0, 0, 1000, 1000))
  const stickRect = (): DOMRect => {
    const [tx, ty] = (stick.style.translate || '0px 0px').split(' ').map((v) => parseFloat(v) || 0)
    return new DOMRect(10 + tx, 40 + ty, 40, 20)
  }
  rects.set(stick, stickRect)

  const game = createScratch()
  game.mount(
    { root, assets: { src: () => '' }, sfx: { play: () => {} }, rng: Math.random, elementId: 'card' },
    { coverColor: '#999', threshold: 0.5, scratcherId: 'stick', scratcherTipX: 90, scratcherTipY: 50, ...params },
  )
  rects.set(root.querySelector('canvas')!, () => new DOMRect(0, 0, 100, 100))
  game.start()
  const tip = anim.lastElementChild
  if (tip)
    rects.set(tip, () => {
      const s = stickRect()
      return new DOMRect(s.left + s.width * 0.9, s.top + s.height * 0.5, 0, 0)
    })
  calls = []
  return { game, root, stick }
}

describe('scratch card scratcher', () => {
  beforeEach(() => {
    calls = []
    // jsdom has no ResizeObserver; the card only needs one to exist.
    globalThis.ResizeObserver ??= class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    } as unknown as typeof ResizeObserver
    origGetContext = HTMLCanvasElement.prototype.getContext
    origRect = Element.prototype.getBoundingClientRect
    HTMLCanvasElement.prototype.getContext = (() => fakeCtx()) as unknown as typeof HTMLCanvasElement.prototype.getContext
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      const f = rects.get(this)
      return f ? f() : new DOMRect(0, 0, 0, 0)
    }
  })
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext
    Element.prototype.getBoundingClientRect = origRect
    rects.clear()
    document.body.innerHTML = ''
  })

  it('scratches at the tip while dragged, and follows the drag', () => {
    const { game, stick } = setup({})
    window.dispatchEvent(pointer('pointerdown', 20, 50))
    expect(calls.filter((c) => c[0] === 'arc').map((c) => [c[1], c[2]])).toEqual([[46, 50]])
    window.dispatchEvent(pointer('pointermove', 40, 50))
    expect(stick.style.translate).toBe('20.0px 0.0px')
    const arcs = calls.filter((c) => c[0] === 'arc').map((c) => [c[1], c[2]])
    expect(arcs[arcs.length - 1]).toEqual([66, 50])
    window.dispatchEvent(pointer('pointerup', 40, 50))
    game.destroy()
    expect(stick.style.translate).toBe('')
  })

  it('does not scratch with the bare finger when a scratcher is set', () => {
    const { game, root } = setup({})
    const canvas = root.querySelector('canvas')!
    canvas.dispatchEvent(pointer('pointerdown', 80, 90))
    window.dispatchEvent(pointer('pointerdown', 80, 90))
    expect(calls.some((c) => c[0] === 'arc')).toBe(false)
    game.destroy()
  })

  it('clips scratching to the scratch area', () => {
    const { game } = setup({ areaX: 50, areaY: 0, areaW: 50, areaH: 100 })
    window.dispatchEvent(pointer('pointerdown', 20, 50))
    const clipRect = calls.find((c) => c[0] === 'rect')
    expect(clipRect).toEqual(['rect', 50, 0, 50, 100])
    expect(calls.findIndex((c) => c[0] === 'clip')).toBeLessThan(calls.findIndex((c) => c[0] === 'arc'))
    game.destroy()
  })

  it('reports continuous progress to progress bars', () => {
    const got: ProgressDetail[] = []
    const { game, root } = setup({})
    const off = onProgress(root, (d) => got.push(d))
    window.dispatchEvent(pointer('pointerdown', 20, 50))
    window.dispatchEvent(pointer('pointerup', 20, 50))
    expect(got.length).toBeGreaterThan(0)
    expect(got[got.length - 1]).toMatchObject({ gameId: 'card', total: 100, continuous: true })
    off()
    game.destroy()
  })
})
