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
  mod.mount(ctx, { itemCount: 2, itemImages: ['wide-one', 'two'], pickupScale: 1.2, ...params })
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
  const r = el.getBoundingClientRect()
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

  it('exposes uploaded item slots and a game-aware handguide', () => {
    expect(BASKET_TEMPLATE.defaultParams.itemCount).toBe(6)
    expect(BASKET_TEMPLATE.assetSlots?.map((slot) => slot.key)).toEqual(['itemImages'])
    expect(BASKET_TEMPLATE.defaultHandguide?.mode).toBe('basket')
  })

  it('keeps the basket hit area fully invisible', () => {
    const game = mount()
    expect(game.target.style.opacity).toBe('0')
    expect(game.target.style.backgroundImage).toBe('')
    expect(game.target.style.outline).toBe('none')
    expect(game.target.style.filter).toBe('')
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
    expect(box(game.items[0]).left).toBeCloseTo(targetBox.left, 3)
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

  it('keeps each successful drop at its own release position instead of assigning slots', () => {
    const game = mount({ zoneX: 20, zoneY: 35, zoneW: 60, zoneH: 40 })
    const targetBox = box(game.target)
    const firstDrop = { x: targetBox.left + targetBox.width * 0.68, y: targetBox.top + targetBox.height * 0.4 }
    const secondDrop = { x: targetBox.left + targetBox.width * 0.34, y: targetBox.top + targetBox.height * 0.68 }

    drag(game.items[0], firstDrop)
    drag(game.items[1], secondDrop)

    expect(center(game.items[0]).x).toBeCloseTo(firstDrop.x, 3)
    expect(center(game.items[0]).y).toBeCloseTo(firstDrop.y, 3)
    expect(center(game.items[1]).x).toBeCloseTo(secondDrop.x, 3)
    expect(center(game.items[1]).y).toBeCloseTo(secondDrop.y, 3)
  })

  it('preserves wide uploaded item artwork and aims its hint at the basket', () => {
    const game = mount()
    expect(parseFloat(game.items[0].style.width) / parseFloat(game.items[0].style.height)).toBeCloseTo(4, 3)
    const hint = game.mod.getHint()
    expect(hint?.kind).toBe('slide')
    expect(hint?.from).toEqual(center(game.items[0]))
    expect(hint?.to).toEqual(center(game.target))
  })

  it('uses freely positioned scene image elements instead of internal item slots', () => {
    const stage = document.createElement('div')
    stage.className = 'pa-root'
    document.body.appendChild(stage)
    const baseRects = [
      { left: 10, top: 30, width: 90, height: 40 },
      { left: 210, top: 410, width: 70, height: 55 },
    ]
    const sceneItems = baseRects.map((base, index) => {
      const el = document.createElement('div')
      el.dataset.id = 'scene-item-' + index
      el.dataset.basketSceneItem = '1'
      el.dataset.basketGameId = 'basket-game'
      el.style.zIndex = String(20 + index)
      el.getBoundingClientRect = () => {
        const [dx = 0, dy = 0] = el.style.translate.split(' ').map((value) => parseFloat(value) || 0)
        return {
          x: base.left + dx,
          y: base.top + dy,
          left: base.left + dx,
          top: base.top + dy,
          right: base.left + dx + base.width,
          bottom: base.top + dy + base.height,
          width: base.width,
          height: base.height,
          toJSON: () => ({}),
        } as DOMRect
      }
      stage.appendChild(el)
      return el
    })
    const root = document.createElement('div')
    Object.defineProperties(root, {
      clientWidth: { value: 320, configurable: true },
      clientHeight: { value: 480, configurable: true },
    })
    root.getBoundingClientRect = () => ({ x: 100, y: 20, left: 100, top: 20, right: 420, bottom: 500, width: 320, height: 480, toJSON: () => ({}) })
    stage.appendChild(root)
    const played: string[] = []
    const mod = createBasket()
    mod.mount(
      {
        root,
        assets: { src: () => '', size: () => null },
        sfx: { play: (event) => played.push(event) },
        rng: mulberry32(7),
        scale: () => 1,
        elementId: 'basket-game',
      },
      { itemCount: 6 },
    )
    let complete = false
    mod.onComplete(() => (complete = true))
    mod.start()
    const target = root.querySelector<HTMLElement>('[data-basket-target]')!
    target.getBoundingClientRect = () => {
      const left = 100 + parseFloat(target.style.left)
      const top = 20 + parseFloat(target.style.top)
      const width = parseFloat(target.style.width)
      const height = parseFloat(target.style.height)
      return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect
    }

    expect(root.querySelector('[data-basket-item]')).toBeNull()
    expect(sceneItems[0].dataset.basketHint).toBe('1')
    expect(sceneItems[0].style.width).toBe('')
    const targetBox = target.getBoundingClientRect()
    const firstDrop = { x: targetBox.left + targetBox.width * 0.3, y: targetBox.top + targetBox.height * 0.4 }
    const secondDrop = { x: targetBox.left + targetBox.width * 0.7, y: targetBox.top + targetBox.height * 0.6 }
    drag(sceneItems[0], firstDrop)
    expect(sceneItems[0].dataset.basketPlaced).toBe('1')
    expect(sceneItems[0].style.scale).toBe('1')
    expect(center(sceneItems[0]).x).toBeCloseTo(firstDrop.x, 3)
    expect(center(sceneItems[0]).y).toBeCloseTo(firstDrop.y, 3)
    expect(sceneItems[1].dataset.basketHint).toBe('1')
    expect(complete).toBe(false)

    drag(sceneItems[1], secondDrop)
    expect(center(sceneItems[1]).x).toBeCloseTo(secondDrop.x, 3)
    expect(center(sceneItems[1]).y).toBeCloseTo(secondDrop.y, 3)
    expect(complete).toBe(true)
    expect(played.filter((event) => event === 'itemPickUp')).toHaveLength(2)
    expect(played.filter((event) => event === 'itemPlace')).toHaveLength(2)
    expect(played).toContain('gameWin')
  })
})
