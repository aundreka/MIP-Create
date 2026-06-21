// Slider (before / after): a draggable divider wipes the "before" image away to
// reveal the "after" beneath — the classic transformation compare. Drag the
// handle across (past a threshold of travel) to complete. Hint: slide the handle
// to the far edge. Horizontal or vertical.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num, str } from './types'

export function createSlider(): GameModule {
  let ctx: GameContext
  let vertical = false
  let threshold = 0.82
  let pct = 0.5 // start split down the middle; drag toward 0 to reveal "after"
  let wrap: HTMLDivElement
  let beforeWrap: HTMLDivElement
  let handle: HTMLDivElement
  let started = false
  let done = false
  let completeCb: (() => void) | null = null

  const apply = (): void => {
    if (vertical) {
      beforeWrap.style.height = pct * 100 + '%'
      handle.style.top = pct * 100 + '%'
      handle.style.left = '0'
      handle.style.width = '100%'
      handle.style.height = '0'
    } else {
      beforeWrap.style.width = pct * 100 + '%'
      handle.style.left = pct * 100 + '%'
      handle.style.top = '0'
      handle.style.height = '100%'
      handle.style.width = '0'
    }
  }

  const setFromPointer = (clientX: number, clientY: number): void => {
    const r = wrap.getBoundingClientRect()
    pct = vertical ? (clientY - r.top) / Math.max(1, r.height) : (clientX - r.left) / Math.max(1, r.width)
    pct = Math.max(0, Math.min(1, pct))
    apply()
    if (!done && pct <= 1 - threshold) {
      done = true
      ctx.sfx.play('gameWin')
      completeCb?.()
    }
  }

  return {
    mount(c, params) {
      ctx = c
      vertical = str(params.orientation, 'horizontal') === 'vertical'
      threshold = Math.max(0.4, Math.min(0.95, num(params.threshold, 0.82)))
      const before = ctx.assets.src(params.before as string)
      const after = ctx.assets.src(params.after as string)
      ctx.root.style.touchAction = 'none'

      wrap = document.createElement('div')
      wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;border-radius:12px;cursor:ew-resize;background:#222;'
      if (vertical) wrap.style.cursor = 'ns-resize'

      const afterEl = document.createElement('div')
      afterEl.style.cssText = 'position:absolute;inset:0;'
      afterEl.style.background = after ? `center/cover no-repeat url("${after}")` : 'linear-gradient(135deg,#16a34a,#0ea5e9)'

      beforeWrap = document.createElement('div')
      beforeWrap.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:100%;overflow:hidden;'
      const beforeEl = document.createElement('div')
      // sized to the WRAP, not beforeWrap, so the image doesn't squish as it clips
      beforeEl.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;'
      beforeEl.style.background = before ? `center/cover no-repeat url("${before}")` : 'linear-gradient(135deg,#64748b,#334155)'
      // pin the inner image to the wrap's size via 100vw-ish trick: use the wrap as ref
      beforeWrap.appendChild(beforeEl)

      handle = document.createElement('div')
      handle.style.cssText = 'position:absolute;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.3);z-index:3;'
      const grip = document.createElement('div')
      grip.style.cssText =
        'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:36px;height:36px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#333;font-weight:800;'
      grip.textContent = vertical ? '↕' : '↔'
      handle.appendChild(grip)
      // make the handle line thin
      if (vertical) handle.style.borderTop = '3px solid #fff'
      else handle.style.borderLeft = '3px solid #fff'

      wrap.appendChild(afterEl)
      wrap.appendChild(beforeWrap)
      wrap.appendChild(handle)
      ctx.root.appendChild(wrap)
      // keep the before image full-size relative to wrap by re-sizing on layout
      ;(beforeEl as HTMLElement).dataset.fill = '1'
      apply()
    },
    start() {
      if (started) return
      started = true
      let dragging = false
      wrap.addEventListener('pointerdown', (e) => {
        if (done) return
        dragging = true
        wrap.setPointerCapture(e.pointerId)
        setFromPointer(e.clientX, e.clientY)
      })
      wrap.addEventListener('pointermove', (e) => {
        if (dragging && !done) setFromPointer(e.clientX, e.clientY)
      })
      wrap.addEventListener('pointerup', () => (dragging = false))
    },
    relayout() {
      // keep the clipped before-image sized to the full wrap so it never squishes
      const fill = wrap.querySelector<HTMLElement>('[data-fill]')
      if (fill) {
        fill.style.width = wrap.clientWidth + 'px'
        fill.style.height = wrap.clientHeight + 'px'
      }
      apply()
    },
    getHint(): HintMove | null {
      if (done) return null
      const r = handle.getBoundingClientRect()
      const wr = wrap.getBoundingClientRect()
      const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      const to: Pt = vertical ? { x: from.x, y: wr.top + wr.height * 0.1 } : { x: wr.left + wr.width * 0.1, y: from.y }
      return { from, to, kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
    },
  }
}

export const SLIDER_TEMPLATE: GameTemplate = {
  id: 'slider',
  label: 'Slider (before / after)',
  paramFields: [
    { key: 'orientation', label: 'Direction', type: 'select', options: ['horizontal', 'vertical'] },
    { key: 'threshold', label: 'Reveal to win (0-1)', type: 'number', min: 0.4, max: 0.95, step: 0.05 },
  ],
  assetSlots: [
    { key: 'before', label: 'Before image' },
    { key: 'after', label: 'After image' },
  ],
  defaultParams: { orientation: 'horizontal', threshold: 0.82, before: '', after: '' },
  create: createSlider,
}
