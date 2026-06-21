// Drag-to-target: drag the object into the target zone to complete. The hint
// slides from the object to the target. Optional custom images for both.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createDrag(): GameModule {
  let ctx: GameContext
  let object: HTMLDivElement
  let target: HTMLDivElement
  let size = 90
  let ox = 0
  let oy = 0
  let tx = 0
  let ty = 0
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const place = (el: HTMLElement, cx: number, cy: number, sz: number): void => {
    el.style.width = sz + 'px'
    el.style.height = sz + 'px'
    el.style.left = cx - sz / 2 + 'px'
    el.style.top = cy - sz / 2 + 'px'
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    size = Math.max(48, Math.min(w * 0.26, h * 0.22))
    tx = w / 2
    ty = h * 0.24
    place(target, tx, ty, size * 1.3)
    if (!done) {
      ox = w / 2
      oy = h * 0.8
    } else {
      ox = tx
      oy = ty
    }
    place(object, ox, oy, size)
  }

  return {
    mount(c, params) {
      ctx = c
      ctx.root.style.touchAction = 'none'
      const targetImg = ctx.assets.src(params.target as string)
      const objImg = ctx.assets.src(params.object as string)

      target = document.createElement('div')
      target.style.cssText = 'position:absolute;box-sizing:border-box;border-radius:50%;'
      if (targetImg) {
        target.style.background = `center/contain no-repeat url("${targetImg}")`
        target.style.opacity = '0.85'
      } else {
        target.style.border = '4px dashed rgba(255,255,255,.7)'
        target.style.background = 'rgba(255,255,255,.08)'
      }
      ctx.root.appendChild(target)

      object = document.createElement('div')
      object.style.cssText = 'position:absolute;box-sizing:border-box;border-radius:50%;cursor:grab;box-shadow:0 6px 16px rgba(0,0,0,.4);touch-action:none;'
      object.style.background = objImg ? `center/contain no-repeat url("${objImg}")` : '#3b82f6'
      ctx.root.appendChild(object)
      layout()
    },
    start() {
      if (started) return
      started = true
      object.addEventListener('pointerdown', (e) => {
        if (done) return
        e.preventDefault()
        object.setPointerCapture(e.pointerId)
        object.style.zIndex = '10'
        const rootR = ctx.root.getBoundingClientRect()
        const move = (ev: PointerEvent): void => {
          ox = ev.clientX - rootR.left
          oy = ev.clientY - rootR.top
          place(object, ox, oy, size)
        }
        const up = (): void => {
          object.removeEventListener('pointermove', move)
          object.removeEventListener('pointerup', up)
          object.style.zIndex = ''
          if (Math.hypot(ox - tx, oy - ty) < size * 0.9) {
            done = true
            place(object, tx, ty, size)
            object.style.cursor = 'default'
            ctx.sfx.play('gameWin')
            completeCb?.()
          } else {
            ctx.sfx.play('wrong')
            layout()
          }
        }
        object.addEventListener('pointermove', move)
        object.addEventListener('pointerup', up)
      })
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      return { from: center(object), to: center(target), kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
    },
  }
}

export const DRAG_TEMPLATE: GameTemplate = {
  id: 'drag',
  label: 'Drag to target',
  paramFields: [],
  assetSlots: [
    { key: 'object', label: 'Object image' },
    { key: 'target', label: 'Target image' },
  ],
  defaultParams: { object: '', target: '' },
  create: createDrag,
}
