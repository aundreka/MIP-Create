// Basket drop: drag either uploaded slot assets or marked scene images into one
// author-defined basket area.
// The basket rectangle is editable on the canvas through the shared zone editor;
// drops inside it (or its configurable snap border) settle into tidy slots. The
// first unplaced item is always marked for both coded and editable handguides.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

interface BasketItem {
  el: HTMLDivElement
  index: number
  aspect: number
  placed: boolean
  slot: number
  cx: number
  cy: number
  startX: number
  startY: number
  w: number
  h: number
  angle: number
}

interface SceneBasketItem {
  el: HTMLDivElement
  index: number
  placed: boolean
  slot: number
  dx: number
  dy: number
  dragging: boolean
  originalZ: string
}

interface Zone {
  x: number
  y: number
  w: number
  h: number
}

const START_POINTS: [number, number][] = [
  [0.16, 0.12],
  [0.5, 0.1],
  [0.84, 0.14],
  [0.14, 0.88],
  [0.5, 0.9],
  [0.86, 0.86],
  [0.08, 0.3],
  [0.92, 0.3],
  [0.07, 0.68],
  [0.93, 0.68],
  [0.3, 0.22],
  [0.7, 0.22],
]

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function clampPct(value: unknown, fallback: number): number {
  return Math.max(0, Math.min(100, num(value, fallback)))
}

export function createBasket(): GameModule {
  let ctx: GameContext
  let target: HTMLDivElement
  let itemCount = 6
  let itemSizePct = 24
  let pickupScale = 1.1
  let snapBorderPct = 5
  let zonePct: Zone = { x: 12, y: 34, w: 76, h: 43 }
  let zone: Zone = { x: 0, y: 0, w: 0, h: 0 }
  let basketSrc = ''
  const items: BasketItem[] = []
  const sceneItems: SceneBasketItem[] = []
  let started = false
  let done = false
  let placedCount = 0
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null

  const setTransform = (item: BasketItem, scale: number): void => {
    item.el.style.transform = `rotate(${item.angle}deg) scale(${scale})`
  }

  const place = (item: BasketItem, cx: number, cy: number): void => {
    item.cx = cx
    item.cy = cy
    item.el.style.width = item.w + 'px'
    item.el.style.height = item.h + 'px'
    item.el.style.left = cx - item.w / 2 + 'px'
    item.el.style.top = cy - item.h / 2 + 'px'
  }

  const insideZone = (x: number, y: number, border = 0): boolean =>
    x >= zone.x - border && x <= zone.x + zone.w + border && y >= zone.y - border && y <= zone.y + zone.h + border

  const availableStarts = (w: number, h: number): Pt[] => {
    const candidates: Pt[] = START_POINTS.map(([x, y]) => ({ x: x * w, y: y * h }))
    // Add a denser fallback grid for larger item counts or unusually placed baskets.
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) candidates.push({ x: ((col + 0.5) / 4) * w, y: ((row + 0.5) / 4) * h })
    }
    const outside = candidates.filter((p) => !insideZone(p.x, p.y, Math.min(w, h) * 0.04))
    return outside.length ? outside : candidates
  }

  const slotPoint = (slot: number): Pt => {
    const count = sceneItems.length || itemCount
    const ratio = zone.h > 0 ? zone.w / zone.h : 1
    const cols = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * ratio))))
    const rows = Math.max(1, Math.ceil(count / cols))
    const row = Math.floor(slot / cols)
    const rowStart = row * cols
    const rowCount = Math.min(cols, count - rowStart)
    const col = slot - rowStart
    const padX = Math.min(zone.w * 0.12, 24)
    const padY = Math.min(zone.h * 0.14, 24)
    const innerW = Math.max(0, zone.w - padX * 2)
    const innerH = Math.max(0, zone.h - padY * 2)
    return {
      x: zone.x + padX + (innerW * (col + 0.5)) / rowCount,
      y: zone.y + padY + (innerH * (row + 0.5)) / rows,
    }
  }

  const screenSlotPoint = (slot: number): Pt => {
    const r = target.getBoundingClientRect()
    const count = Math.max(1, sceneItems.length)
    const ratio = r.height > 0 ? r.width / r.height : 1
    const cols = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * ratio))))
    const rows = Math.max(1, Math.ceil(count / cols))
    const row = Math.floor(slot / cols)
    const rowStart = row * cols
    const rowCount = Math.min(cols, count - rowStart)
    const col = slot - rowStart
    const padX = Math.min(r.width * 0.12, 24)
    const padY = Math.min(r.height * 0.14, 24)
    return {
      x: r.left + padX + ((r.width - padX * 2) * (col + 0.5)) / rowCount,
      y: r.top + padY + ((r.height - padY * 2) * (row + 0.5)) / rows,
    }
  }

  const activeItems = (): Array<{ el: HTMLDivElement; placed: boolean }> => (sceneItems.length ? sceneItems : items)

  const markHint = (): void => {
    const all = activeItems()
    const next = all.find((item) => !item.placed)
    for (const item of all) {
      if (item === next) item.el.dataset.basketHint = '1'
      else delete item.el.dataset.basketHint
    }
  }

  const setSceneOffset = (item: SceneBasketItem, dx: number, dy: number, ease: boolean): void => {
    item.dx = dx
    item.dy = dy
    item.el.style.transition = ease ? 'translate 180ms ease,scale 140ms ease' : 'scale 140ms ease'
    item.el.style.translate = `${dx}px ${dy}px`
  }

  const snapSceneItem = (item: SceneBasketItem, ease: boolean): void => {
    const current = center(item.el)
    const home = { x: current.x - item.dx, y: current.y - item.dy }
    const slot = screenSlotPoint(item.slot)
    setSceneOffset(item, slot.x - home.x, slot.y - home.y, ease)
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    zone = {
      x: (zonePct.x / 100) * w,
      y: (zonePct.y / 100) * h,
      w: (zonePct.w / 100) * w,
      h: (zonePct.h / 100) * h,
    }
    target.style.left = zone.x + 'px'
    target.style.top = zone.y + 'px'
    target.style.width = zone.w + 'px'
    target.style.height = zone.h + 'px'

    const maxSize = Math.max(28, (Math.min(w, h) * itemSizePct) / 100)
    const starts = availableStarts(w, h)
    items.forEach((item, index) => {
      if (item.aspect >= 1) {
        item.w = maxSize
        item.h = maxSize / item.aspect
      } else {
        item.w = maxSize * item.aspect
        item.h = maxSize
      }
      if (item.placed) {
        const p = slotPoint(item.slot)
        place(item, p.x, p.y)
      } else {
        const p = starts[index % starts.length]
        item.startX = p.x
        item.startY = p.y
        place(item, p.x, p.y)
      }
    })
    sceneItems.forEach((item) => {
      if (item.placed) snapSceneItem(item, false)
      else if (!item.dragging) setSceneOffset(item, 0, 0, false)
    })
  }

  const rootPoint = (event: PointerEvent): Pt => {
    const r = ctx.root.getBoundingClientRect()
    const sx = r.width > 0 ? ctx.root.clientWidth / r.width : 1
    const sy = r.height > 0 ? ctx.root.clientHeight / r.height : 1
    return { x: (event.clientX - r.left) * sx, y: (event.clientY - r.top) * sy }
  }

  const finishIfWon = (): void => {
    if (done || placedCount < activeItems().length) return
    done = true
    target.dataset.basketComplete = '1'
    target.style.filter = 'drop-shadow(0 0 10px rgba(255,255,255,.7))'
    markHint()
    ctx.sfx.play('gameWin')
    winCb?.()
    completeCb?.()
  }

  const insideTargetScreen = (x: number, y: number): boolean => {
    const r = target.getBoundingClientRect()
    const rootRect = ctx.root.getBoundingClientRect()
    const border = (Math.min(rootRect.width || 300, rootRect.height || 400) * snapBorderPct) / 100
    return x >= r.left - border && x <= r.right + border && y >= r.top - border && y <= r.bottom + border
  }

  const paintTargetNear = (near: boolean): void => {
    target.dataset.basketNear = near ? '1' : '0'
    target.style.outline = near ? '3px solid rgba(255,255,255,.9)' : basketSrc ? 'none' : '3px dashed rgba(255,255,255,.65)'
  }

  const attachDrag = (item: BasketItem): void => {
    item.el.addEventListener('pointerdown', (event) => {
      if (done || item.placed) return
      event.preventDefault()
      try {
        item.el.setPointerCapture?.(event.pointerId)
      } catch {
        // Some playable containers expose the API but reject capture for their
        // synthesized pointer stream. Direct listeners still keep the drag usable.
      }
      const start = rootPoint(event)
      const offsetX = start.x - item.cx
      const offsetY = start.y - item.cy
      item.el.style.zIndex = '100'
      item.el.style.cursor = 'grabbing'
      item.el.style.transition = 'transform 140ms ease'
      setTransform(item, pickupScale)
      ctx.sfx.play('itemPickUp')

      const move = (moveEvent: PointerEvent): void => {
        const p = rootPoint(moveEvent)
        place(item, p.x - offsetX, p.y - offsetY)
        const border = (Math.min(ctx.root.clientWidth || 300, ctx.root.clientHeight || 400) * snapBorderPct) / 100
        target.dataset.basketNear = insideZone(item.cx, item.cy, border) ? '1' : '0'
        target.style.outline = target.dataset.basketNear === '1' ? '3px solid rgba(255,255,255,.9)' : basketSrc ? 'none' : '3px dashed rgba(255,255,255,.65)'
      }

      const release = (upEvent: PointerEvent): void => {
        item.el.removeEventListener('pointermove', move)
        item.el.removeEventListener('pointerup', release)
        item.el.removeEventListener('pointercancel', cancel)
        item.el.style.zIndex = String(5 + item.index)
        item.el.style.cursor = 'grab'
        item.el.style.transition = 'left 180ms ease,top 180ms ease,transform 140ms ease'
        setTransform(item, 1)
        target.dataset.basketNear = '0'
        target.style.outline = basketSrc ? 'none' : '3px dashed rgba(255,255,255,.65)'
        const border = (Math.min(ctx.root.clientWidth || 300, ctx.root.clientHeight || 400) * snapBorderPct) / 100
        if (insideZone(item.cx, item.cy, border)) {
          item.placed = true
          item.slot = placedCount++
          item.el.dataset.basketPlaced = '1'
          item.el.style.cursor = 'default'
          item.el.style.pointerEvents = 'none'
        }
        ctx.sfx.play('itemPlace')
        layout()
        markHint()
        finishIfWon()
        if (typeof item.el.releasePointerCapture === 'function' && item.el.hasPointerCapture?.(upEvent.pointerId)) {
          try {
            item.el.releasePointerCapture(upEvent.pointerId)
          } catch {
            /* capture was already released by the host */
          }
        }
      }

      const cancel = (cancelEvent: PointerEvent): void => {
        item.el.removeEventListener('pointermove', move)
        item.el.removeEventListener('pointerup', release)
        item.el.removeEventListener('pointercancel', cancel)
        item.el.style.zIndex = String(5 + item.index)
        item.el.style.cursor = 'grab'
        item.el.style.transition = 'left 180ms ease,top 180ms ease,transform 140ms ease'
        setTransform(item, 1)
        target.dataset.basketNear = '0'
        target.style.outline = basketSrc ? 'none' : '3px dashed rgba(255,255,255,.65)'
        layout()
        if (typeof item.el.releasePointerCapture === 'function' && item.el.hasPointerCapture?.(cancelEvent.pointerId)) {
          try {
            item.el.releasePointerCapture(cancelEvent.pointerId)
          } catch {
            /* capture was already released by the host */
          }
        }
      }

      item.el.addEventListener('pointermove', move)
      item.el.addEventListener('pointerup', release)
      item.el.addEventListener('pointercancel', cancel)
    })
  }

  const attachSceneDrag = (item: SceneBasketItem): void => {
    item.el.style.cursor = 'grab'
    item.el.style.touchAction = 'none'
    item.el.style.pointerEvents = 'auto'
    item.el.style.transformOrigin = 'center'
    item.el.addEventListener('pointerdown', (event) => {
      if (done || item.placed) return
      event.preventDefault()
      try {
        item.el.setPointerCapture?.(event.pointerId)
      } catch {
        /* synthesized pointer stream — direct listeners still work */
      }
      item.dragging = true
      const start = { x: event.clientX, y: event.clientY }
      const base = { x: item.dx, y: item.dy }
      item.el.style.zIndex = '99999'
      item.el.style.cursor = 'grabbing'
      item.el.style.scale = String(pickupScale)
      ctx.sfx.play('itemPickUp')

      const move = (moveEvent: PointerEvent): void => {
        setSceneOffset(item, base.x + moveEvent.clientX - start.x, base.y + moveEvent.clientY - start.y, false)
        const p = center(item.el)
        paintTargetNear(insideTargetScreen(p.x, p.y))
      }

      const stop = (eventToRelease: PointerEvent, cancelled: boolean): void => {
        item.el.removeEventListener('pointermove', move)
        item.el.removeEventListener('pointerup', release)
        item.el.removeEventListener('pointercancel', cancel)
        item.dragging = false
        item.el.style.zIndex = item.originalZ
        item.el.style.cursor = 'grab'
        item.el.style.scale = '1'
        paintTargetNear(false)
        const p = center(item.el)
        if (!cancelled && insideTargetScreen(p.x, p.y)) {
          item.placed = true
          item.slot = placedCount++
          item.el.dataset.basketPlaced = '1'
          item.el.style.cursor = 'default'
          item.el.style.pointerEvents = 'none'
          snapSceneItem(item, true)
          ctx.sfx.play('itemPlace')
          markHint()
          finishIfWon()
        } else {
          setSceneOffset(item, 0, 0, true)
          if (!cancelled) ctx.sfx.play('itemPlace')
        }
        if (typeof item.el.releasePointerCapture === 'function' && item.el.hasPointerCapture?.(eventToRelease.pointerId)) {
          try {
            item.el.releasePointerCapture(eventToRelease.pointerId)
          } catch {
            /* capture was already released by the host */
          }
        }
      }
      const release = (upEvent: PointerEvent): void => stop(upEvent, false)
      const cancel = (cancelEvent: PointerEvent): void => stop(cancelEvent, true)

      item.el.addEventListener('pointermove', move)
      item.el.addEventListener('pointerup', release)
      item.el.addEventListener('pointercancel', cancel)
    })
  }

  return {
    mount(c, params) {
      ctx = c
      itemCount = Math.max(1, Math.min(12, Math.round(num(params.itemCount, 6))))
      itemSizePct = Math.max(6, Math.min(45, num(params.itemSizePct, 24)))
      pickupScale = Math.max(1, Math.min(1.5, num(params.pickupScale, 1.1)))
      snapBorderPct = Math.max(0, Math.min(20, num(params.snapBorderPct, 5)))
      const x = Math.min(98, clampPct(params.zoneX, 12))
      const y = Math.min(98, clampPct(params.zoneY, 34))
      zonePct = {
        x,
        y,
        w: Math.max(2, Math.min(100 - x, clampPct(params.zoneW, 76))),
        h: Math.max(2, Math.min(100 - y, clampPct(params.zoneH, 43))),
      }
      basketSrc = ctx.assets.src(params.basketImage as string)
      const itemIds = Array.isArray(params.itemImages) ? (params.itemImages as string[]) : []
      ctx.root.style.touchAction = 'none'

      target = document.createElement('div')
      target.dataset.basketTarget = '1'
      target.setAttribute('aria-label', 'Basket drop area')
      target.style.cssText =
        'position:absolute;box-sizing:border-box;pointer-events:none;background-position:center;background-repeat:no-repeat;background-size:contain;transition:outline-color 120ms ease,filter 180ms ease;'
      target.style.backgroundImage = basketSrc ? `url("${basketSrc}")` : 'linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.02))'
      target.style.outline = basketSrc ? 'none' : '3px dashed rgba(255,255,255,.65)'
      ctx.root.appendChild(target)

      const stageRoot = ctx.root.closest('.pa-root')
      const candidates = stageRoot ? Array.from(stageRoot.querySelectorAll<HTMLDivElement>('[data-basket-scene-item="1"]')) : []
      for (const el of candidates) {
        const requestedGame = el.dataset.basketGameId
        const claimedBy = el.dataset.basketClaimedBy
        if ((requestedGame && requestedGame !== ctx.elementId) || (!requestedGame && claimedBy)) continue
        if (el.style.display === 'none') continue
        el.dataset.basketClaimedBy = ctx.elementId ?? 'basket'
        el.dataset.basketItem = 'scene:' + (el.dataset.id ?? sceneItems.length)
        sceneItems.push({ el, index: sceneItems.length, placed: false, slot: -1, dx: 0, dy: 0, dragging: false, originalZ: el.style.zIndex })
      }

      for (let index = 0; sceneItems.length === 0 && index < itemCount; index++) {
        const id = itemIds[index] || ''
        const src = ctx.assets.src(id)
        const natural = ctx.assets.size?.(id)
        const rawAspect = natural && natural.w > 0 && natural.h > 0 ? natural.w / natural.h : 1
        const aspect = Math.max(0.2, Math.min(5, rawAspect))
        const el = document.createElement('div')
        el.dataset.basketItem = String(index)
        el.setAttribute('aria-label', `Draggable item ${index + 1}`)
        el.style.cssText =
          'position:absolute;box-sizing:border-box;cursor:grab;touch-action:none;background-position:center;background-repeat:no-repeat;background-size:contain;transform-origin:center;will-change:left,top,transform;filter:drop-shadow(0 4px 5px rgba(0,0,0,.3));'
        el.style.backgroundImage = src ? `url("${src}")` : `radial-gradient(circle at 35% 30%,hsl(${(index * 67) % 360} 90% 72%),hsl(${(index * 67) % 360} 72% 46%))`
        el.style.zIndex = String(5 + index)
        ctx.root.appendChild(el)
        items.push({ el, index, aspect, placed: false, slot: -1, cx: 0, cy: 0, startX: 0, startY: 0, w: 0, h: 0, angle: ((index * 17) % 21) - 10 })
      }
      layout()
      markHint()
    },
    start() {
      if (started) return
      started = true
      if (sceneItems.length) sceneItems.forEach(attachSceneDrag)
      else items.forEach(attachDrag)
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      const item = activeItems().find((candidate) => !candidate.placed)
      if (!item) return null
      return { from: center(item.el), to: center(target), kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
      for (const item of sceneItems) {
        delete item.el.dataset.basketClaimedBy
        delete item.el.dataset.basketItem
        delete item.el.dataset.basketHint
        delete item.el.dataset.basketPlaced
        item.el.style.translate = ''
        item.el.style.scale = ''
        item.el.style.transition = ''
        item.el.style.pointerEvents = ''
      }
      items.length = 0
      sceneItems.length = 0
    },
  }
}

export const BASKET_TEMPLATE: GameTemplate = {
  id: 'basket',
  label: 'Basket drop',
  paramFields: [
    { key: 'itemCount', label: 'Items', type: 'number', min: 1, max: 12, step: 1 },
    { key: 'itemSizePct', label: 'Item size (%)', type: 'number', min: 6, max: 45, step: 1 },
    { key: 'pickupScale', label: 'Pick-up scale', type: 'number', min: 1, max: 1.5, step: 0.05 },
    { key: 'snapBorderPct', label: 'Snap border (%)', type: 'number', min: 0, max: 20, step: 1 },
  ],
  assetSlots: [
    { key: 'basketImage', label: 'Basket image' },
    { key: 'itemImages', label: 'Item image', list: true, countParam: 'itemCount' },
  ],
  defaultParams: {
    itemCount: 6,
    itemSizePct: 24,
    pickupScale: 1.1,
    snapBorderPct: 5,
    zoneX: 12,
    zoneY: 34,
    zoneW: 76,
    zoneH: 43,
    basketImage: '',
    itemImages: [],
  },
  defaultHintIdleMs: 3000,
  defaultHandguide: { mode: 'basket', nodes: [{ x: 0.16, y: 0.12 }], periodMs: 1700 },
  create: createBasket,
}
