// Slider (before / after): a draggable divider wipes the "before" image away to
// reveal the "after" beneath — the classic transformation compare. Drag the
// handle across (past a threshold of travel) to complete. Either end can be the
// winning one, so "drag it all the way right" and "drag it all the way left" are
// both a finish — the before/after compare people actually expect.
//
// Winning always ends on a FULL reveal: the divider wipes the rest of the way to
// the edge by itself, so the threshold is the point the gesture is committed at,
// never the point the image is left half-wiped at.
//
// The divider's line and handle are fully authorable (width, colour, image, size,
// position along the line), because the handle is the only affordance the player
// has and it has to sit inside the art rather than on top of it.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num, str } from './types'

export function createSlider(): GameModule {
  let ctx: GameContext
  let p: Record<string, unknown> = {}
  let vertical = false
  let threshold = 0.82
  let winEdge = 'either'
  let snapMs = 420
  let pct = 0.5 // start split down the middle; drag to either edge to reveal
  let wrap: HTMLDivElement
  let beforeEl: HTMLDivElement
  let line: HTMLDivElement
  let handle: HTMLDivElement
  let started = false
  let done = false
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null
  const timers: number[] = []
  const at = (fn: () => void, ms: number): void => {
    timers.push(window.setTimeout(fn, ms))
  }

  const s = (): number => ctx.scale?.() ?? 1

  /** The divider's position, plus everything pinned to it. */
  const apply = (): void => {
    const cut = (1 - pct) * 100
    beforeEl.style.clipPath = vertical ? `inset(0 0 ${cut}% 0)` : `inset(0 ${cut}% 0 0)`
    const along = Math.max(0, Math.min(100, num(p.handlePos, 50)))
    if (vertical) {
      line.style.top = pct * 100 + '%'
      handle.style.top = pct * 100 + '%'
      handle.style.left = along + '%'
    } else {
      line.style.left = pct * 100 + '%'
      handle.style.left = pct * 100 + '%'
      handle.style.top = along + '%'
    }
  }

  /** Design-px styling — re-run on relayout so the divider scales with the stage. */
  const style = (): void => {
    const k = s()
    const lw = Math.max(0, num(p.lineWidth, 3)) * k
    const lineColor = str(p.lineColor, '#ffffff')
    line.style.background = lw > 0 ? lineColor : 'transparent'
    if (vertical) {
      line.style.width = '100%'
      line.style.height = lw + 'px'
      line.style.left = '0'
      line.style.transform = 'translateY(-50%)'
    } else {
      line.style.height = '100%'
      line.style.width = lw + 'px'
      line.style.top = '0'
      line.style.transform = 'translateX(-50%)'
    }

    const size = Math.max(0, num(p.handleSize, 36)) * (Math.max(1, num(p.handleScale, 100)) / 100) * k
    const img = ctx.assets.src(p.handleImage as string)
    handle.style.width = size + 'px'
    if (img) {
      const nat = ctx.assets.size?.(p.handleImage as string)
      handle.style.height = (nat && nat.w > 0 ? (size * nat.h) / nat.w : size) + 'px'
      handle.style.background = `center/contain no-repeat url("${img}")`
      handle.style.borderRadius = '0'
      handle.style.color = 'transparent'
    } else {
      handle.style.height = size + 'px'
      handle.style.background = str(p.handleColor, '#ffffff')
      handle.style.borderRadius = '50%'
      handle.style.color = str(p.handleIconColor, '#333333')
      handle.style.fontSize = size * 0.5 + 'px'
    }
    handle.style.boxShadow = p.handleShadow === false ? 'none' : `0 ${2 * k}px ${8 * k}px rgba(0,0,0,.4)`
    handle.textContent = img || p.handleArrows === false ? '' : vertical ? '↕' : '↔'
  }

  /** Win: commit, wipe the rest of the way to `edge`, THEN report completion. */
  const finish = (edge: number): void => {
    if (done) return
    done = true
    winCb?.()
    ctx.sfx.play('gameWin')
    // The handguide stops pointing at a handle that is on its way out.
    delete handle.dataset.sliderHandle
    delete wrap.dataset.sliderTrack
    const ms = Math.max(0, snapMs)
    beforeEl.style.transition = `clip-path ${ms}ms ease`
    handle.style.transition = `opacity ${ms}ms ease`
    line.style.transition = `opacity ${ms}ms ease`
    handle.style.opacity = '0'
    line.style.opacity = '0'
    pct = edge
    apply()
    at(() => {
      beforeEl.style.transition = ''
      completeCb?.()
    }, ms)
  }

  const setFromPointer = (clientX: number, clientY: number): void => {
    const r = wrap.getBoundingClientRect()
    pct = vertical ? (clientY - r.top) / Math.max(1, r.height) : (clientX - r.left) / Math.max(1, r.width)
    pct = Math.max(0, Math.min(1, pct))
    apply()
    if (done) return
    // How far the wipe has travelled toward each edge. Reaching the threshold at an
    // allowed edge wins; the remaining sliver is wiped away by finish().
    if (winEdge !== 'right' && 1 - pct >= threshold) finish(0)
    else if (winEdge !== 'left' && pct >= threshold) finish(1)
  }

  /** Where the gesture has to end up, for both the coded hint and a placed handguide. */
  const hintEdge = (): number => {
    if (winEdge === 'right') return 1
    if (winEdge === 'left') return 0
    return pct > 0.5 ? 1 : 0 // 'either': the edge the player is already closer to
  }

  return {
    mount(c, params) {
      ctx = c
      p = params
      vertical = str(params.orientation, 'horizontal') === 'vertical'
      threshold = Math.max(0.4, Math.min(1, num(params.threshold, 0.82)))
      winEdge = str(params.winEdge, 'either')
      snapMs = Math.max(0, num(params.snapMs, 420))
      pct = Math.max(0, Math.min(1, num(params.start, 50) / 100))
      const before = ctx.assets.src(params.before as string)
      const after = ctx.assets.src(params.after as string)
      ctx.root.style.touchAction = 'none'

      // No card of its own: no fill, no corner radius, no frame — just the two
      // images. A game-mount element already carries its own frame/radius controls,
      // so anything forced here would be a second border the author cannot remove.
      wrap = document.createElement('div')
      wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:transparent;'
      wrap.style.cursor = vertical ? 'ns-resize' : 'ew-resize'
      // Read by the placed handguide's 'slider' mode: the track it mimes a drag across.
      wrap.dataset.sliderTrack = '1'
      wrap.dataset.sliderEdge = winEdge
      if (vertical) wrap.dataset.sliderVertical = '1'

      // 'contain' shows the whole image; 'cover' fills the box and crops the overflow.
      const fit = str(params.imageFit, 'cover')
      const afterEl = document.createElement('div')
      afterEl.style.cssText = 'position:absolute;inset:0;'
      afterEl.style.background = after ? `center/${fit} no-repeat url("${after}")` : 'linear-gradient(135deg,#16a34a,#0ea5e9)'

      // Clipped, not resized: a full-size layer with clip-path keeps the before image
      // at the wrap's own size, so it wipes instead of squishing as the divider moves.
      beforeEl = document.createElement('div')
      beforeEl.style.cssText = 'position:absolute;inset:0;'
      beforeEl.style.background = before ? `center/${fit} no-repeat url("${before}")` : 'linear-gradient(135deg,#64748b,#334155)'

      line = document.createElement('div')
      line.style.cssText = 'position:absolute;z-index:3;pointer-events:none;'

      handle = document.createElement('div')
      handle.style.cssText =
        'position:absolute;transform:translate(-50%,-50%);z-index:4;display:flex;align-items:center;justify-content:center;font-weight:800;pointer-events:none;'
      handle.dataset.sliderHandle = '1'

      wrap.appendChild(afterEl)
      wrap.appendChild(beforeEl)
      wrap.appendChild(line)
      wrap.appendChild(handle)
      ctx.root.appendChild(wrap)
      style()
      apply()
    },
    start() {
      if (started) return
      started = true
      let dragging = false
      const stop = (): void => {
        dragging = false
      }
      wrap.addEventListener('pointerdown', (e) => {
        if (done) return
        dragging = true
        wrap.setPointerCapture(e.pointerId)
        setFromPointer(e.clientX, e.clientY)
      })
      wrap.addEventListener('pointermove', (e) => {
        if (dragging && !done) setFromPointer(e.clientX, e.clientY)
      })
      wrap.addEventListener('pointerup', stop)
      wrap.addEventListener('pointercancel', stop)
      wrap.addEventListener('lostpointercapture', stop)
    },
    relayout() {
      style()
      apply()
    },
    getHint(): HintMove | null {
      if (done) return null
      const r = handle.getBoundingClientRect()
      const wr = wrap.getBoundingClientRect()
      const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      const edge = hintEdge()
      // Stop a little short of the wall so the hand stays inside the card.
      const f = edge === 1 ? 0.9 : 0.1
      const to: Pt = vertical ? { x: from.x, y: wr.top + wr.height * f } : { x: wr.left + wr.width * f, y: from.y }
      return { from, to, kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      timers.forEach((t) => window.clearTimeout(t))
      timers.length = 0
      ctx.root.innerHTML = ''
    },
  }
}

export const SLIDER_TEMPLATE: GameTemplate = {
  id: 'slider',
  label: 'Slider (before / after)',
  paramFields: [
    { key: 'orientation', label: 'Direction', type: 'select', options: ['horizontal', 'vertical'], group: 'Play' },
    { key: 'winEdge', label: 'Wins when dragged', type: 'select', options: ['either', 'left', 'right'], group: 'Play' },
    { key: 'start', label: 'Start split', type: 'number', min: 0, max: 100, step: 5, suffix: '%', group: 'Play' },
    { key: 'threshold', label: 'Reveal to win (0-1)', type: 'number', min: 0.4, max: 1, step: 0.05, group: 'Play' },
    { key: 'snapMs', label: 'Finish wipe', type: 'number', min: 0, max: 2000, step: 20, suffix: 'ms', group: 'Play' },
    { key: 'imageFit', label: 'Image fit', type: 'select', options: ['cover', 'contain'], group: 'Play' },

    { key: 'lineWidth', label: 'Line width', type: 'number', min: 0, max: 40, step: 1, suffix: 'px', group: 'Divider' },
    { key: 'lineColor', label: 'Line color', type: 'color', group: 'Divider' },

    { key: 'handleSize', label: 'Handle size', type: 'number', min: 0, max: 300, step: 2, suffix: 'px', group: 'Handle' },
    { key: 'handleScale', label: 'Handle scale', type: 'number', min: 10, max: 400, step: 5, suffix: '%', group: 'Handle' },
    { key: 'handlePos', label: 'Handle position along the line', type: 'number', min: 0, max: 100, step: 1, suffix: '%', group: 'Handle' },
    { key: 'handleColor', label: 'Handle color', type: 'color', group: 'Handle', showIf: (q) => !q.handleImage },
    { key: 'handleIconColor', label: 'Arrow color', type: 'color', group: 'Handle', showIf: (q) => !q.handleImage },
    { key: 'handleArrows', label: 'Show arrows', type: 'boolean', group: 'Handle', showIf: (q) => !q.handleImage },
    { key: 'handleShadow', label: 'Handle shadow', type: 'boolean', group: 'Handle' },
  ],
  assetSlots: [
    { key: 'before', label: 'Before image' },
    { key: 'after', label: 'After image' },
    { key: 'handleImage', label: 'Handle image' },
  ],
  defaultParams: {
    orientation: 'horizontal',
    winEdge: 'either',
    start: 50,
    threshold: 0.82,
    snapMs: 420,
    imageFit: 'cover',
    lineWidth: 3,
    lineColor: '#ffffff',
    handleSize: 36,
    handleScale: 100,
    handlePos: 50,
    handleColor: '#ffffff',
    handleIconColor: '#333333',
    handleArrows: true,
    handleShadow: true,
    handleImage: '',
    before: '',
    after: '',
  },
  // A placed hand grabs the live divider handle and mimes the drag to the winning
  // edge — alternating sides when either end wins, so the loop shows the compare
  // both ways. The node only places the hand's starting position.
  defaultHandguide: {
    mode: 'slider',
    nodes: [{ x: 0.5, y: 0.5 }],
    periodMs: 1700,
  },
  create: createSlider,
}
