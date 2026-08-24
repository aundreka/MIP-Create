// Combo builder: a drag-to-choose selection game where the whole board is laid
// out on the canvas as ordinary scene elements rather than inside the game box.
//
// The game mount contributes exactly one thing visually — an invisible DROP AREA,
// drawn with the shared canvas zone editor (zoneX/Y/W/H, same as Basket drop).
// Everything else is an ordinary element the author tagged with `comboRole`:
//
//   option  a draggable answer belonging to question N. Only the live question's
//           options are visible and interactive. Dragging one grows it; releasing
//           it inside the drop area picks it, and it flies from the drop area into
//           every anchor, where it lands as question N's LAYER.
//   title   the question headline. Shown while its question is live and swapped on
//           advance. It never reacts to WHICH option was picked — only to which
//           question is up.
//   anchor  the image the picked layers stack onto. The anchor's own art is the
//           base; each answered question adds one layer above it, at that
//           question's authored rect. Any number of anchors may exist and each
//           mirrors the same stack, so a hero and a small preview stay in sync.
//
// Because a question owns a LAYER (not a whole flat image), the art needed is
// options x questions rather than options^questions, and a combination is
// customised by moving that question's layer rect — no combination table.
//
// Three gameplay beats are broadcast through the SFX channel, which stage.ts fans
// out to every scene element as both an animation phase and a sound binding:
// 'comboPick' (an option is picked up), 'comboDrop' (one is dropped in the area)
// and 'comboNext' (the next question comes up).

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

interface LayerRect {
  /** Centre X of the layer, % of the anchor's box. */
  x: number
  /** Centre Y of the layer, % of the anchor's box. */
  y: number
  /** Layer width, % of the anchor's box. Height follows the art's own aspect. */
  w: number
  /** Rotation in degrees. */
  rot: number
}

interface OptionEl {
  el: HTMLElement
  question: number
  choice: number
  layerId: string
  homeZ: string
  dx: number
  dy: number
  dragging: boolean
}

interface AnchorEl {
  el: HTMLElement
  /** The injected overlay that holds this anchor's layer stack. */
  stack: HTMLDivElement
  /** Layer node per question index (0-based); absent until that question is answered. */
  layers: (HTMLImageElement | undefined)[]
}

interface Zone {
  x: number
  y: number
  w: number
  h: number
}

/** Hidden without touching inline display/opacity — layoutRec rewrites both on every
 * layout pass, so an inline hide would be dropped by the next resize. */
const OFF_CLASS = 'pa-combo-off'

const DEFAULT_LAYER: LayerRect = { x: 50, y: 50, w: 100, rot: 0 }

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function clampPct(value: unknown, fallback: number): number {
  return Math.max(0, Math.min(100, num(value, fallback)))
}

/** Per-question layer rects, read from the `layers` param and padded with defaults so a
 * question the author has not positioned yet still lands somewhere sensible. */
function readLayers(raw: unknown, questions: number): LayerRect[] {
  const list = Array.isArray(raw) ? raw : []
  const out: LayerRect[] = []
  for (let i = 0; i < questions; i++) {
    const entry = (list[i] ?? {}) as Record<string, unknown>
    out.push({
      x: clampPct(entry.x, DEFAULT_LAYER.x),
      y: clampPct(entry.y, DEFAULT_LAYER.y),
      w: Math.max(1, Math.min(400, num(entry.w, DEFAULT_LAYER.w))),
      rot: Math.max(-180, Math.min(180, num(entry.rot, DEFAULT_LAYER.rot))),
    })
  }
  return out
}

export function createCombo(): GameModule {
  let ctx: GameContext
  let target: HTMLDivElement
  let questions = 3
  let pickupScale = 1.25
  let snapBorderPct = 6
  let advanceDelayMs = 600
  let flyMs = 520
  let dismissMs = 260
  let zonePct: Zone = { x: 18, y: 60, w: 64, h: 32 }

  const options: OptionEl[] = []
  const anchors: AnchorEl[] = []
  const titles: { el: HTMLElement; question: number }[] = []
  /** Chosen option index per question (0-based question), -1 = unanswered. */
  const answers: number[] = []
  const timers: number[] = []

  let current = 0
  let started = false
  let busy = false
  let done = false
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null

  const after = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms))
  }
  const clearTimers = (): void => {
    for (const t of timers) window.clearTimeout(t)
    timers.length = 0
  }

  const show = (el: HTMLElement): void => el.classList.remove(OFF_CLASS)
  const hide = (el: HTMLElement): void => el.classList.add(OFF_CLASS)

  let layerParam: unknown = []
  const layerRects = (): LayerRect[] => readLayers(layerParam, questions)

  const optionsFor = (question: number): OptionEl[] => options.filter((o) => o.question === question)

  const setOffset = (item: OptionEl, dx: number, dy: number, ease: boolean): void => {
    item.dx = dx
    item.dy = dy
    item.el.style.transition = ease ? `translate ${dismissMs}ms ease, scale ${dismissMs}ms ease` : 'scale 140ms ease'
    item.el.style.translate = `${dx}px ${dy}px`
  }

  const resetOption = (item: OptionEl): void => {
    item.el.style.transition = ''
    item.el.style.translate = ''
    item.el.style.scale = ''
    item.el.style.zIndex = item.homeZ
    item.el.style.cursor = ''
    item.dx = 0
    item.dy = 0
    item.dragging = false
  }

  // ---- the drop zone -------------------------------------------------------
  const layoutZone = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const zone: Zone = {
      x: (zonePct.x / 100) * w,
      y: (zonePct.y / 100) * h,
      w: (zonePct.w / 100) * w,
      h: (zonePct.h / 100) * h,
    }
    target.style.left = zone.x + 'px'
    target.style.top = zone.y + 'px'
    target.style.width = zone.w + 'px'
    target.style.height = zone.h + 'px'
  }

  const insideTarget = (x: number, y: number): boolean => {
    const r = target.getBoundingClientRect()
    const root = ctx.root.getBoundingClientRect()
    const border = (Math.min(root.width || 300, root.height || 400) * snapBorderPct) / 100
    return x >= r.left - border && x <= r.right + border && y >= r.top - border && y <= r.bottom + border
  }

  // ---- anchor layers -------------------------------------------------------
  /** Screen rect of question `q`'s layer slot inside a given anchor. */
  const layerSlot = (anchor: AnchorEl, q: number): { cx: number; cy: number; w: number; rot: number } => {
    const rect = anchor.el.getBoundingClientRect()
    const spec = layerRects()[q] ?? DEFAULT_LAYER
    return {
      cx: rect.left + (spec.x / 100) * rect.width,
      cy: rect.top + (spec.y / 100) * rect.height,
      w: (spec.w / 100) * rect.width,
      rot: spec.rot,
    }
  }

  /** Paint question `q`'s layer into every anchor using the chosen option's art. */
  const applyLayer = (q: number, option: OptionEl): void => {
    const src = ctx.assets.src(option.layerId)
    const spec = layerRects()[q] ?? DEFAULT_LAYER
    for (const anchor of anchors) {
      let img = anchor.layers[q]
      if (!img) {
        img = document.createElement('img')
        img.className = 'pa-combo-layer'
        img.alt = ''
        // zIndex by question so a later answer always stacks above an earlier one,
        // independent of the order the nodes happen to be appended in.
        img.style.zIndex = String(q + 1)
        anchor.stack.appendChild(img)
        anchor.layers[q] = img
      }
      img.dataset.comboLayer = String(q + 1)
      img.style.left = spec.x + '%'
      img.style.top = spec.y + '%'
      img.style.width = spec.w + '%'
      img.style.transform = `translate(-50%,-50%) rotate(${spec.rot}deg)`
      if (src) img.src = src
      img.style.display = src ? '' : 'none'
    }
  }

  /** Editor canvas only (start() is never called there): paint every question's layer
   * using its first option's art, so the layer rect fields in the inspector are
   * WYSIWYG instead of blind numbers. Cleared the moment real play begins. */
  const previewLayers = (): void => {
    for (let q = 0; q < questions; q++) {
      const first = optionsFor(q + 1)[0]
      if (first) applyLayer(q, first)
    }
  }

  const clearLayers = (): void => {
    for (const anchor of anchors) {
      anchor.stack.innerHTML = ''
      anchor.layers.length = 0
    }
  }

  /** Re-place every already-painted layer — the rects are %, so this only matters when
   * the author edits them live in the editor. */
  const relayoutLayers = (): void => {
    const rects = layerRects()
    for (const anchor of anchors) {
      anchor.layers.forEach((img, q) => {
        if (!img) return
        const spec = rects[q] ?? DEFAULT_LAYER
        img.style.left = spec.x + '%'
        img.style.top = spec.y + '%'
        img.style.width = spec.w + '%'
        img.style.transform = `translate(-50%,-50%) rotate(${spec.rot}deg)`
      })
    }
  }

  // ---- question flow -------------------------------------------------------
  /** Show question `q`'s title + options and hide every other question's. */
  const showQuestion = (q: number): void => {
    for (const t of titles) {
      if (t.question === q + 1) show(t.el)
      else hide(t.el)
    }
    for (const o of options) {
      if (o.question === q + 1 && answers[q] < 0) show(o.el)
      else hide(o.el)
    }
  }

  const finish = (): void => {
    if (done) return
    done = true
    target.dataset.comboComplete = '1'
    ctx.sfx.play('gameWin')
    winCb?.()
    completeCb?.()
  }

  /** First question at or after `from` that actually has options tagged for it, or
   * `questions` when there are none left. A question the author has not wired up yet
   * would otherwise be a dead end — nothing to drag, so the game could never be won. */
  const nextPlayable = (from: number): number => {
    let q = from
    while (q < questions && optionsFor(q + 1).length === 0) q++
    return q
  }

  const advance = (): void => {
    current = nextPlayable(current + 1)
    if (current >= questions) {
      finish()
      return
    }
    showQuestion(current)
    // Fired AFTER the incoming elements are visible, so an authored 'comboNext'
    // animation on them actually plays instead of running while they're hidden.
    ctx.sfx.play('comboNext')
    busy = false
  }

  /** Pick `item` for the current question: dismiss its siblings, fly it into the
   * anchors as this question's layer, then move on after the authored delay. */
  const choose = (item: OptionEl): void => {
    const q = current
    answers[q] = item.choice
    busy = true
    ctx.sfx.play('comboDrop')

    for (const other of optionsFor(q + 1)) {
      if (other === item) continue
      other.el.style.transition = `opacity ${dismissMs}ms ease, scale ${dismissMs}ms ease`
      other.el.style.scale = '0.7'
      after(dismissMs, () => hide(other.el))
    }

    const anchor = anchors[0]
    if (!anchor) {
      // No anchor authored yet — still a valid pick, just nothing to fly into.
      hide(item.el)
      after(advanceDelayMs, advance)
      return
    }

    const slot = layerSlot(anchor, q)
    const rect = item.el.getBoundingClientRect()
    const scale = rect.width > 0 ? slot.w / rect.width : 1
    // The element's resting centre — its live centre minus the drag offset it carries.
    const home = { x: rect.left + rect.width / 2 - item.dx, y: rect.top + rect.height / 2 - item.dy }
    item.el.style.transition = `translate ${flyMs}ms cubic-bezier(.4,0,.2,1), scale ${flyMs}ms cubic-bezier(.4,0,.2,1), rotate ${flyMs}ms ease`
    item.el.style.translate = `${slot.cx - home.x}px ${slot.cy - home.y}px`
    item.el.style.scale = String(Math.max(0.05, scale))
    if (slot.rot) item.el.style.rotate = `${slot.rot}deg`

    after(flyMs, () => {
      applyLayer(q, item)
      hide(item.el)
      after(advanceDelayMs, advance)
    })
  }

  // ---- dragging ------------------------------------------------------------
  const attachDrag = (item: OptionEl): void => {
    item.el.style.cursor = 'grab'
    item.el.style.touchAction = 'none'
    item.el.style.pointerEvents = 'auto'
    item.el.addEventListener('pointerdown', (event) => {
      if (done || busy || item.question !== current + 1 || answers[current] >= 0) return
      event.preventDefault()
      try {
        item.el.setPointerCapture?.(event.pointerId)
      } catch {
        // Some playable containers expose the API but reject capture for their
        // synthesized pointer stream. Direct listeners still keep the drag usable.
      }
      item.dragging = true
      const start = { x: event.clientX, y: event.clientY }
      const base = { x: item.dx, y: item.dy }
      item.el.style.zIndex = '99999'
      item.el.style.cursor = 'grabbing'
      item.el.style.scale = String(pickupScale)
      ctx.sfx.play('comboPick')

      const move = (moveEvent: PointerEvent): void => {
        setOffset(item, base.x + moveEvent.clientX - start.x, base.y + moveEvent.clientY - start.y, false)
        const p = center(item.el)
        target.dataset.comboNear = insideTarget(p.x, p.y) ? '1' : '0'
      }

      const stop = (eventToRelease: PointerEvent, cancelled: boolean): void => {
        item.el.removeEventListener('pointermove', move)
        item.el.removeEventListener('pointerup', release)
        item.el.removeEventListener('pointercancel', cancel)
        item.dragging = false
        target.dataset.comboNear = '0'
        const p = center(item.el)
        const dropped = !cancelled && insideTarget(p.x, p.y)
        if (dropped) {
          item.el.style.pointerEvents = 'none'
          item.el.style.cursor = 'default'
          choose(item)
        } else {
          item.el.style.zIndex = item.homeZ
          item.el.style.cursor = 'grab'
          item.el.style.scale = '1'
          setOffset(item, 0, 0, true)
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

  // ---- element discovery ---------------------------------------------------
  const collect = (): void => {
    const stageRoot = ctx.root.closest('.pa-root')
    if (!stageRoot) return
    const tagged = Array.from(stageRoot.querySelectorAll<HTMLElement>('[data-combo-role]'))
    for (const el of tagged) {
      const wanted = el.dataset.comboGameId
      // An element addressed to another combo game is not ours; an unaddressed one
      // is claimed first-come so two games in a scene can't fight over it.
      if (wanted ? wanted !== ctx.elementId : !!el.dataset.comboClaimedBy) continue
      el.dataset.comboClaimedBy = ctx.elementId ?? 'combo'
      const role = el.dataset.comboRole
      const question = Math.max(1, Math.round(Number(el.dataset.comboQuestion) || 1))
      if (role === 'option') {
        options.push({
          el,
          question,
          choice: Math.max(1, Math.round(Number(el.dataset.comboChoice) || 1)),
          layerId: el.dataset.comboLayerAsset ?? '',
          homeZ: el.style.zIndex,
          dx: 0,
          dy: 0,
          dragging: false,
        })
      } else if (role === 'title') {
        titles.push({ el, question })
      } else if (role === 'anchor') {
        const host = el.querySelector<HTMLElement>('.pa-el-anim') ?? el
        const stack = document.createElement('div')
        stack.className = 'pa-combo-stack'
        stack.dataset.comboStack = '1'
        host.appendChild(stack)
        anchors.push({ el, stack, layers: [] })
      }
    }
  }

  return {
    mount(c, params) {
      ctx = c
      questions = Math.max(1, Math.min(8, Math.round(num(params.questions, 3))))
      pickupScale = Math.max(1, Math.min(2, num(params.pickupScale, 1.25)))
      snapBorderPct = Math.max(0, Math.min(25, num(params.snapBorderPct, 6)))
      advanceDelayMs = Math.max(0, Math.min(5000, num(params.advanceDelayMs, 600)))
      flyMs = Math.max(0, Math.min(3000, num(params.flyMs, 520)))
      dismissMs = Math.max(0, Math.min(2000, num(params.dismissMs, 260)))
      layerParam = params.layers
      const x = Math.min(98, clampPct(params.zoneX, 18))
      const y = Math.min(98, clampPct(params.zoneY, 60))
      zonePct = {
        x,
        y,
        w: Math.max(2, Math.min(100 - x, clampPct(params.zoneW, 64))),
        h: Math.max(2, Math.min(100 - y, clampPct(params.zoneH, 32))),
      }
      for (let i = 0; i < questions; i++) answers.push(-1)

      ctx.root.style.touchAction = 'none'
      target = document.createElement('div')
      target.dataset.comboTarget = '1'
      target.setAttribute('aria-label', 'Drop area')
      target.style.cssText = 'position:absolute;box-sizing:border-box;pointer-events:none;opacity:0;background-color:transparent;outline:none;'
      ctx.root.appendChild(target)

      collect()
      layoutZone()
      // Nothing is hidden here on purpose: mount() also runs on the static editor
      // canvas, where every question's options and titles must stay visible and
      // selectable. start() (interactive only) is what collapses to question 1.
      previewLayers()
    },
    start() {
      if (started) return
      started = true
      clearLayers()
      current = nextPlayable(0)
      if (current >= questions) {
        // Nothing is wired up at all — win immediately rather than stranding the player.
        showQuestion(current)
        finish()
        return
      }
      showQuestion(current)
      options.forEach(attachDrag)
    },
    relayout() {
      layoutZone()
      relayoutLayers()
      for (const item of options) if (!item.dragging && answers[item.question - 1] < 0) setOffset(item, 0, 0, false)
    },
    getHint(): HintMove | null {
      if (done || busy) return null
      const item = optionsFor(current + 1).find((o) => !o.el.classList.contains(OFF_CLASS))
      if (!item) return null
      return { from: center(item.el), to: center(target), kind: 'drag' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      clearTimers()
      ctx.root.innerHTML = ''
      for (const item of options) {
        resetOption(item)
        item.el.classList.remove(OFF_CLASS)
        item.el.style.pointerEvents = ''
        item.el.style.rotate = ''
        delete item.el.dataset.comboClaimedBy
      }
      for (const t of titles) {
        t.el.classList.remove(OFF_CLASS)
        delete t.el.dataset.comboClaimedBy
      }
      for (const anchor of anchors) {
        anchor.stack.remove()
        delete anchor.el.dataset.comboClaimedBy
      }
      options.length = 0
      titles.length = 0
      anchors.length = 0
      answers.length = 0
      current = 0
      busy = false
      done = false
      started = false
    },
  }
}

export const COMBO_TEMPLATE: GameTemplate = {
  id: 'combo',
  label: 'Combo builder',
  paramFields: [
    { key: 'questions', label: 'Questions', type: 'number', min: 1, max: 8, step: 1 },
    { key: 'pickupScale', label: 'Drag grow scale', type: 'number', min: 1, max: 2, step: 0.05 },
    { key: 'snapBorderPct', label: 'Snap border (%)', type: 'number', min: 0, max: 25, step: 1 },
    { key: 'flyMs', label: 'Fly-to-anchor (ms)', type: 'number', min: 0, max: 3000, step: 20 },
    { key: 'advanceDelayMs', label: 'Delay before next question (ms)', type: 'number', min: 0, max: 5000, step: 50 },
    { key: 'dismissMs', label: 'Unpicked option exit (ms)', type: 'number', min: 0, max: 2000, step: 20 },
  ],
  defaultParams: {
    questions: 3,
    pickupScale: 1.25,
    snapBorderPct: 6,
    flyMs: 520,
    advanceDelayMs: 600,
    dismissMs: 260,
    zoneX: 18,
    zoneY: 60,
    zoneW: 64,
    zoneH: 32,
    layers: [],
  },
  defaultHintIdleMs: 3000,
  create: createCombo,
}
