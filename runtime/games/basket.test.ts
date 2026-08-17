import { afterEach, describe, expect, it } from 'vitest'
import { BASKET_TEMPLATE, createBasket } from './basket'
import { mulberry32, type GameContext } from './types'

interface MountedBasket {
  mod: ReturnType<typeof createBasket>
  root: HTMLDivElement
  target: HTMLDivElement
  items: HTMLDivElement[]
  played: string[]
  completed: () => boolean
  won: () => boolean
}

const box = (el: HTMLElement): DOMRect => {
  const left = parseFloat(el.style.left) || 0
  const top = parseFloat(el.style.top) || 0
  const width = parseFloat(el.style.width) || 0
  const height = parseFloat(el.style.height) || 0
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect
}

function mount(params: Record<string, unknown> = {}): MountedBasket {
  const root = document.createElement('div')
  Object.defineProperties(root, {
    clientWidth: { value: 320, configurable: true },
    clientHeight: { value: 480, configurable: true },
  })
  root.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 480, width: 320, height: 480, toJSON: () => ({}) })
  document.body.appendChild(root)
  const played: string[] = []
  const ctx: GameContext = {
    root,
    assets: {
      src: (id) => (id ? `asset:${id}` : ''),
      size: (id) => (id?.startsWith('wide') ? { w: 400, h: 100 } : { w: 100, h: 100 }),
    },
    sfx: { play: (event) => played.push(event) },
    rng: mulberry32(42),
    scale: () => 1,
  }
  const mod = createBasket()
  mod.mount(ctx, { itemCount: 2, basketImage: 'basket-art', itemImages: ['wide-one', 'two'], pickupScale: 1.2, ...params })
  let complete = false
  let win = false
  mod.onComplete(() => (complete = true))
  mod.onWin?.(() => (win = true))
  mod.start()
  const target = root.querySelector<HTMLElement>('[data-basket-target]') as HTMLDivElement
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-basket-item]')) as HTMLDivElement[]
  target.getBoundingClientRect = () => box(target)
  items.forEach((item) => (item.getBoundingClientRect = () => box(item)))
  return { mod, root, target, items, played, completed: () => complete, won: () => win }
}

function center(el: HTMLElement): { x: number; y: number } {
  const r = box(el)
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function drag(item: HTMLElement, to: { x: number; y: number }): void {
  const from = center(item)
  item.dispatchEvent(new MouseEvent('pointerdown', { clientX: from.x, clientY: from.y, bubbles: true }))
  item.dispatchEvent(new MouseEvent('pointermove', { clientX: to.x, clientY: to.y, bubbles: true }))
  item.dispatchEvent(new MouseEvent('pointerup', { clientX: to.x, clientY: to.y, bubbles: true }))
}

describe('basket drop', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('exposes uploaded basket/item slots and a game-aware handguide', () => {
    expect(BASKET_TEMPLATE.defaultParams.itemCount).toBe(6)
    expect(BASKET_TEMPLATE.assetSlots?.map((slot) => slot.key)).toEqual(['basketImage', 'itemImages'])
    expect(BASKET_TEMPLATE.defaultHandguide?.mode).toBe('basket')
  })

  it('scales up on pick-up, plays both item triggers, and returns after an invalid drop', () => {
    const game = mount()
    const item = game.items[0]
    const original = { left: item.style.left, top: item.style.top }
    const from = center(item)
    item.dispatchEvent(new MouseEvent('pointerdown', { clientX: from.x, clientY: from.y, bubbles: true }))
    expect(item.style.transform).toContain('scale(1.2)')
    expect(game.played).toEqual(['itemPickUp'])

    item.dispatchEvent(new MouseEvent('pointermove', { clientX: 315, clientY: 470, bubbles: true }))
    item.dispatchEvent(new MouseEvent('pointerup', { clientX: 315, clientY: 470, bubbles: true }))
    expect(item.style.transform).toContain('scale(1)')
    expect(item.style.left).toBe(original.left)
    expect(item.style.top).toBe(original.top)
    expect(item.dataset.basketPlaced).toBeUndefined()
    expect(game.played).toEqual(['itemPickUp', 'itemPlace'])
  })

  it('snaps releases inside the border and wins only after every item is placed', () => {
    const game = mount({ zoneX: 20, zoneY: 35, zoneW: 60, zoneH: 40, snapBorderPct: 5 })
    const targetBox = box(game.target)
    // Eight pixels left of the basket is still within the 16px authored snap border.
    drag(game.items[0], { x: targetBox.left - 8, y: targetBox.top + targetBox.height / 2 })
    expect(game.items[0].dataset.basketPlaced).toBe('1')
    expect(game.completed()).toBe(false)
    expect(game.root.querySelector('[data-basket-hint]')).toBe(game.items[1])

    drag(game.items[1], center(game.target))
    expect(game.items[1].dataset.basketPlaced).toBe('1')
    expect(game.completed()).toBe(true)
    expect(game.won()).toBe(true)
    expect(game.played.filter((event) => event === 'itemPickUp')).toHaveLength(2)
    expect(game.played.filter((event) => event === 'itemPlace')).toHaveLength(2)
    expect(game.played).toContain('gameWin')
    expect(game.mod.getHint()).toBeNull()
  })

  it('preserves wide uploaded item artwork and aims its hint at the basket', () => {
    const game = mount()
    expect(parseFloat(game.items[0].style.width) / parseFloat(game.items[0].style.height)).toBeCloseTo(4, 3)
    const hint = game.mod.getHint()
    expect(hint?.kind).toBe('slide')
    expect(hint?.from).toEqual(center(game.items[0]))
    expect(hint?.to).toEqual(center(game.target))
  })
})
