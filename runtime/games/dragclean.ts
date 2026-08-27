// Drag to clean: one placed element is the thing the player drags, the others are
// the mess it wipes away.
//
// Built on exactly the model combo.ts established — the game mount contributes NO
// visuals at all, and every piece on the board is an ordinary scene element the
// author placed, sized, cropped and animated by eye, then tagged with a `cleanRole`:
//
//   draggable  the cloth / sponge / eraser / hand. One per game (the first one
//              tagged wins). It carries under the finger and CANNOT leave the
//              screen — see clampDx/clampDy, which is the difference between a
//              playable that survives a fat-fingered swipe and one that loses its
//              only interactive element off the top of a phone.
//   obstacle   a thing to clean. Any number. When the draggable covers most of one,
//              it is wiped: an authored 'cleanWipe' animation plays on it (and on
//              anything else in the scene that wants to react), a sound fires, and
//              it fades out.
//
// "Covers most of one" is measured as overlap area over the area of the SMALLER of
// the two boxes. That reads correctly in both directions, which a single reading
// does not: a small eraser on a big stain has to be essentially inside the stain
// (70% of the ERASER), while a big cloth over a crumb has to be over the crumb (70%
// of the CRUMB). Testing against the obstacle alone would make a large stain
// literally impossible to clean with a small tool.
//
// The board is won when every obstacle is gone — or earlier, via `winObstacles`,
// which stops on that many the way combo's winPicks does.
//
// It also feeds the progress bar (progressbar.ts) over the progress channel: one
// step per obstacle cleaned, with the obstacle count as the total, so a bar dropped
// into the scene sizes itself to the board with no wiring. If the bar's own step
// count is lower it fills first, and since the stage races every game mount and lets
// the first win own the redirect, the bar is then what ends the scene.
//
// Three beats go out on the SFX channel, which stage.ts fans out to every scene
// element as both an animation phase and a sound binding: 'cleanPick' (the tool is
// picked up), 'cleanWipe' (an obstacle is cleaned) and 'cleanDrop' (the tool is let
// go).

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num, str } from './types'
import { COMBO_OFF_CLASS } from './combo'
import { emitProgress, onProgressRequest } from './progresschannel'

/** The shared "hidden without touching inline display/opacity" class. layoutRec
 * rewrites both of those properties on every layout pass, so an inline hide would be
 * dropped by the next resize; this is a class instead. It is combo's export only
 * because combo needed it first — the rule (stage.ts) is generic. */
const OFF_CLASS = COMBO_OFF_CLASS

interface Obstacle {
  el: HTMLElement
  cleaned: boolean
  /** Inline opacity layoutRec left on it, to be handed back on destroy. */
  restOpacity: string
}

function center(el: HTMLElement): Pt {
  const r = visibleRect(el)
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/**
 * Where to hang a scale so it grows the element ABOUT ITS VISIBLE CENTRE.
 *
 * The outer .pa-el is positioned by layoutRec with `transform: translate(tx%,ty%)`
 * and the CSS `scale` property composes after it about the box's PRE-shift centre,
 * so scaling the outer slides the element by (1-s)·W/2 instead of swelling it in
 * place. The inner .pa-el-anim carries no positional transform, so its own origin
 * already is the visible centre, and a scale hung there is drift-free.
 */
function scaleNode(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>('.pa-el-anim') ?? el
}

/**
 * The box the player SEES.
 *
 * The pick-up growth lives on .pa-el-anim (see scaleNode) and a looping animation
 * authored on an element lives there too, so the outer .pa-el's rect is the box
 * BEFORE any of it. Coverage and the on-screen clamp are both promises made about
 * what is on the glass, so both measure the inner node. It fills the outer exactly,
 * so on an untransformed element the two are the same rect.
 */
function visibleRect(el: HTMLElement): DOMRect {
  const r = scaleNode(el).getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? r : el.getBoundingClientRect()
}

/** Area of the intersection of two rects, 0 when they miss. */
function overlapArea(a: DOMRect, b: DOMRect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

export function createDragClean(): GameModule {
  let ctx: GameContext

  let coverPct = 70
  let pickupScale = 1.08
  let fadeMs = 320
  let fadeScale = 0.6
  let fadeRotateDeg = 0
  let winObstacles = 0
  let clampPadPct = 0
  let progressGameId = ''

  const obstacles: Obstacle[] = []
  let drag: HTMLElement | null = null
  let dragHomeZ = ''

  const timers: number[] = []
  let offRequest: (() => void) | null = null

  /** The mount's own outer .pa-el and the inline pointer-events it was built with. */
  let shell: HTMLElement | null = null
  let shellPointerEvents = ''
  let rootPointerEvents = ''

  let dx = 0
  let dy = 0
  let dragging = false
  let started = false
  let done = false
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null
  /** Tears the live drag down, so destroy() can't strand its window listeners. */
  let endDrag: (() => void) | null = null

  const after = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms))
  }

  const cleanedCount = (): number => obstacles.reduce((n, o) => (o.cleaned ? n + 1 : n), 0)
  const target = (): number => Math.max(1, winObstacles > 0 ? Math.min(winObstacles, obstacles.length || winObstacles) : obstacles.length)

  // ---- the screen, as a box the tool may not leave ---------------------------
  /**
   * The rectangle the draggable has to stay inside.
   *
   * .pa-root is the scene root and spans the whole viewport (it is what the
   * full-width 'extend' path measures its 100% against), but a playable can be
   * embedded in a frame smaller than the window, so the two are intersected rather
   * than trusting either alone.
   */
  const bounds = (): DOMRect => {
    const rootEl = ctx.root.closest<HTMLElement>('.pa-root')
    const r = rootEl?.getBoundingClientRect()
    const vw = window.innerWidth || document.documentElement.clientWidth || 0
    const vh = window.innerHeight || document.documentElement.clientHeight || 0
    if (!r || r.width < 1 || r.height < 1) return new DOMRect(0, 0, vw, vh)
    const left = Math.max(0, r.left)
    const top = Math.max(0, r.top)
    const right = vw > 0 ? Math.min(vw, r.right) : r.right
    const bottom = vh > 0 ? Math.min(vh, r.bottom) : r.bottom
    return new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top))
  }

  /**
   * Clamp a proposed offset so the tool stays on screen.
   *
   * The maths is done against the tool's RESTING rect (its live rect minus the
   * offset it is already carrying) so it does not drift as the drag goes on. When
   * the tool is bigger than the screen on an axis the min crosses the max — there is
   * no legal position — and it is centred on that axis instead of snapping to an
   * edge, which is the only choice that does not look broken.
   */
  const clampAxis = (want: number, homeLow: number, homeHigh: number, boundLow: number, boundHigh: number, slack: number): number => {
    const lo = boundLow - slack - homeLow
    const hi = boundHigh + slack - homeHigh
    if (lo > hi) return (lo + hi) / 2
    return Math.max(lo, Math.min(hi, want))
  }

  const applyOffset = (wantX: number, wantY: number, ease: boolean): void => {
    if (!drag) return
    const rect = visibleRect(drag)
    const home = { left: rect.left - dx, top: rect.top - dy, right: rect.right - dx, bottom: rect.bottom - dy }
    const b = bounds()
    const slackX = (clampPadPct / 100) * rect.width
    const slackY = (clampPadPct / 100) * rect.height
    dx = clampAxis(wantX, home.left, home.right, b.left, b.right, slackX)
    dy = clampAxis(wantY, home.top, home.bottom, b.top, b.bottom, slackY)
    drag.style.transition = ease ? 'translate 180ms ease' : ''
    drag.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`
  }

  // ---- cleaning --------------------------------------------------------------
  /** Publish where play has got to, for any progress bar in the scene. */
  const announce = (): void => {
    emitProgress(ctx.root, { gameId: ctx.elementId ?? '', value: cleanedCount(), total: target(), to: progressGameId })
  }

  /** The obstacle a hint should point at: the nearest one still standing. Nearest
   * rather than first-in-scene-order because the hand is miming a real gesture, and
   * the shortest wipe is the one a player would actually make. */
  const nextObstacle = (): Obstacle | undefined => {
    if (done || !drag) return undefined
    const from = center(drag)
    let best: Obstacle | undefined
    let bestD = Infinity
    for (const o of obstacles) {
      if (o.cleaned) continue
      const c = center(o.el)
      const d = Math.hypot(c.x - from.x, c.y - from.y)
      if (d < bestD) {
        bestD = d
        best = o
      }
    }
    return best
  }

  /** Publish that obstacle as `data-clean-hint`, the way combo publishes its live
   * option. A placed handguide in 'dragclean' mode follows this attribute, so the
   * hand re-targets by itself as obstacles disappear. */
  const markHint = (): void => {
    const next = nextObstacle()
    for (const o of obstacles) {
      if (o === next) o.el.dataset.cleanHint = '1'
      else delete o.el.dataset.cleanHint
    }
  }

  const finish = (): void => {
    if (done) return
    done = true
    markHint()
    ctx.sfx.play('gameWin')
    winCb?.()
    completeCb?.()
  }

  const wipe = (o: Obstacle): void => {
    o.cleaned = true
    // Broadcast BEFORE the fade so an authored 'cleanWipe' animation on the obstacle
    // itself plays while it is still visible, rather than against a transparent box.
    ctx.sfx.play('cleanWipe')
    announce()
    markHint()
    if (fadeMs > 0) {
      o.el.style.transition = `opacity ${fadeMs}ms ease`
      o.el.style.opacity = '0'
      const node = scaleNode(o.el)
      node.style.transition = `scale ${fadeMs}ms ease, rotate ${fadeMs}ms ease`
      if (fadeScale !== 1) node.style.scale = String(fadeScale)
      if (fadeRotateDeg !== 0) node.style.rotate = `${fadeRotateDeg}deg`
      after(fadeMs, () => park(o))
    } else {
      park(o)
    }
    if (cleanedCount() >= target()) after(fadeMs, finish)
  }

  /** Put a cleaned obstacle away for good, handing back the inline properties
   * layoutRec owns so a later layout pass cannot resurrect it half-visible. */
  const park = (o: Obstacle): void => {
    o.el.classList.add(OFF_CLASS)
    o.el.style.transition = ''
    o.el.style.opacity = o.restOpacity
    const node = scaleNode(o.el)
    node.style.transition = ''
    node.style.scale = ''
    node.style.rotate = ''
  }

  /** Wipe every obstacle the tool is now sitting on. Called on every move. */
  const sweep = (): void => {
    if (!drag || done) return
    const d = visibleRect(drag)
    if (d.width <= 0 || d.height <= 0) return
    const dArea = d.width * d.height
    const need = coverPct / 100
    for (const o of obstacles) {
      if (o.cleaned) continue
      const r = visibleRect(o.el)
      // A degenerate box is not a position: an element that has never been laid out
      // measures 0x0 at the document origin, which any tool near the top-left corner
      // would read as a hit.
      if (r.width <= 0 || r.height <= 0) continue
      const area = overlapArea(d, r)
      if (area <= 0) continue
      if (area / Math.min(dArea, r.width * r.height) >= need) wipe(o)
    }
  }

  // ---- dragging --------------------------------------------------------------
  /** One drag at a time, and it belongs to one pointer. A phone supplies stray extra
   * pointers constantly — the hand steadying the device, a palm on the bezel — and
   * without this a second finger starts a second drag that fights the first. */
  let heldPointer: number | undefined

  const attachDrag = (el: HTMLElement): void => {
    el.style.cursor = 'grab'
    el.style.touchAction = 'none'
    el.style.pointerEvents = 'auto'
    // iOS raises its own press-and-hold sheet over an image — "Save Image", the
    // selection magnifier — and steals the gesture several hundred ms after the drag
    // has already begun. There is no event to cancel it from once it opens, so it
    // has to be switched off up front.
    el.style.setProperty('-webkit-touch-callout', 'none')
    el.style.setProperty('-webkit-tap-highlight-color', 'transparent')
    el.addEventListener('pointerdown', (event) => {
      if (done || heldPointer != null) return
      event.preventDefault()
      const pid = event.pointerId
      heldPointer = pid
      dragging = true
      const start = { x: event.clientX, y: event.clientY }
      const base = { x: dx, y: dy }
      try {
        el.setPointerCapture?.(pid)
      } catch {
        // Some playable containers expose the API but reject capture for their
        // synthesized pointer stream. The listeners below sit on window precisely so
        // capture is a nicety, not a requirement.
      }
      el.style.zIndex = '99999'
      el.style.cursor = 'grabbing'
      const node = scaleNode(el)
      node.style.transition = 'scale 140ms ease'
      node.style.scale = String(pickupScale)
      ctx.sfx.play('cleanPick')

      /** Events from any other finger belong to somebody else's gesture. */
      const mine = (ev: PointerEvent): boolean => ev.pointerId === heldPointer

      const move = (moveEvent: PointerEvent): void => {
        if (!mine(moveEvent)) return
        applyOffset(base.x + moveEvent.clientX - start.x, base.y + moveEvent.clientY - start.y, false)
        sweep()
      }

      const stop = (commit: boolean): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', release)
        window.removeEventListener('pointercancel', release)
        endDrag = null
        heldPointer = undefined
        dragging = false
        if (typeof el.releasePointerCapture === 'function' && el.hasPointerCapture?.(pid)) {
          try {
            el.releasePointerCapture(pid)
          } catch {
            /* capture was already released by the host */
          }
        }
        el.style.zIndex = dragHomeZ
        el.style.cursor = 'grab'
        node.style.transition = 'scale 140ms ease'
        node.style.scale = '1'
        // The tool STAYS where it was let go — a cloth put down stays put. Only a
        // teardown (commit false) is silent; a real release is a beat worth hearing.
        if (commit) ctx.sfx.play('cleanDrop')
        markHint()
      }

      // A pointercancel is not a change of mind: iOS Safari raises one on its own
      // whenever it decides the gesture is the browser's. Ending the drag exactly as
      // a release does keeps the tool where the player last saw it instead of
      // stranding it mid-wipe.
      const release = (upEvent: PointerEvent): void => {
        if (!mine(upEvent)) return
        stop(true)
      }

      endDrag = () => stop(false)
      // On window, not on the element: pointer capture is best-effort here (some ad
      // containers refuse it), and without capture a move that leaves the tool's box
      // — which is the whole point of dragging — would never be delivered. Capture,
      // when granted, retargets to the element, from where events still bubble to
      // window, so one pair of listeners covers both.
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', release)
      window.addEventListener('pointercancel', release)
    })
  }

  // ---- element discovery -----------------------------------------------------
  const collect = (): void => {
    const stageRoot = ctx.root.closest('.pa-root')
    if (!stageRoot) return
    for (const el of Array.from(stageRoot.querySelectorAll<HTMLElement>('[data-clean-role]'))) {
      const wanted = el.dataset.cleanGameId
      // An element addressed to another drag-clean game is not ours; an unaddressed
      // one is claimed first-come so two games in a scene can't fight over it.
      if (wanted ? wanted !== ctx.elementId : !!el.dataset.cleanClaimedBy) continue
      const role = el.dataset.cleanRole
      if (role === 'draggable') {
        // One tool per game. A second tagged element is left entirely alone —
        // unclaimed, so a second drag-clean game in the scene can still adopt it.
        if (drag) continue
        el.dataset.cleanClaimedBy = ctx.elementId ?? 'dragclean'
        drag = el
        dragHomeZ = el.style.zIndex
        el.dataset.cleanDrag = '1'
      } else if (role === 'obstacle') {
        el.dataset.cleanClaimedBy = ctx.elementId ?? 'dragclean'
        obstacles.push({ el, cleaned: false, restOpacity: el.style.opacity })
      }
    }
  }

  return {
    mount(c, params) {
      ctx = c
      coverPct = Math.max(5, Math.min(100, num(params.coverPct, 70)))
      pickupScale = Math.max(1, Math.min(2, num(params.pickupScale, 1.08)))
      fadeMs = Math.max(0, Math.min(3000, num(params.fadeMs, 320)))
      fadeScale = Math.max(0, Math.min(3, num(params.fadeScale, 0.6)))
      fadeRotateDeg = Math.max(-180, Math.min(180, num(params.fadeRotateDeg, 0)))
      winObstacles = Math.max(0, Math.round(num(params.winObstacles, 0)))
      clampPadPct = Math.max(0, Math.min(50, num(params.clampPadPct, 0)))
      progressGameId = str(params.progressGameId, '').trim()

      ctx.root.style.touchAction = 'none'

      // Step the whole mount OUT of hit-testing, exactly as the combo board does.
      // Nothing inside it is ever touched: every interactive piece of this game is a
      // tagged scene element sitting OUTSIDE the box. What the mount does have is an
      // author-sized rectangle, invisible but hit-testable by default, which
      // wherever it lands above the tool in the layer order would silently swallow
      // the touches over the overlapping part.
      shell = ctx.root.closest<HTMLElement>('.pa-el')
      shellPointerEvents = shell?.style.pointerEvents ?? ''
      rootPointerEvents = ctx.root.style.pointerEvents
      if (shell) shell.style.pointerEvents = 'none'
      ctx.root.style.pointerEvents = 'none'

      collect()
      // Nothing is hidden or revealed here on purpose: mount() also runs on the
      // static editor canvas, where the tool and every obstacle must stay visible and
      // selectable. start() (interactive only) is what begins play.
    },
    start() {
      if (started) return
      started = true
      // A source has to be able to re-announce: a bar placed above this game in the
      // layer stack starts listening after this first announcement would have gone out.
      offRequest = onProgressRequest(ctx.root, announce)
      announce()
      if (!drag || obstacles.length === 0) {
        // Nothing is wired up — win immediately rather than stranding the player on a
        // board that cannot be finished.
        finish()
        return
      }
      attachDrag(drag)
      markHint()
    },
    relayout() {
      // Re-clamp rather than reset: the tool stays where the player left it, but the
      // screen it must stay inside has just changed size, so a position that was legal
      // before a rotation may not be now.
      if (!dragging) applyOffset(dx, dy, false)
    },
    getHint(): HintMove | null {
      const next = nextObstacle()
      if (!drag || !next) return null
      return { from: center(drag), to: center(next.el), kind: 'drag' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      // Before the timers are cleared, so anything the abandoned drag schedules on
      // its way out goes with the rest rather than firing against a torn-down board.
      endDrag?.()
      for (const t of timers) window.clearTimeout(t)
      timers.length = 0
      offRequest?.()
      offRequest = null
      if (shell) shell.style.pointerEvents = shellPointerEvents
      shell = null
      ctx.root.style.pointerEvents = rootPointerEvents
      ctx.root.innerHTML = ''
      if (drag) {
        drag.style.transition = ''
        drag.style.translate = ''
        drag.style.cursor = ''
        drag.style.pointerEvents = ''
        drag.style.zIndex = dragHomeZ
        drag.style.removeProperty('-webkit-touch-callout')
        drag.style.removeProperty('-webkit-tap-highlight-color')
        const node = scaleNode(drag)
        node.style.transition = ''
        node.style.scale = ''
        delete drag.dataset.cleanDrag
        delete drag.dataset.cleanClaimedBy
      }
      for (const o of obstacles) {
        // An obstacle is always visible on the canvas — there is no per-element
        // authoring flag to put back, just the board as the author arranged it.
        o.el.classList.remove(OFF_CLASS)
        o.el.style.transition = ''
        o.el.style.opacity = o.restOpacity
        const node = scaleNode(o.el)
        node.style.transition = ''
        node.style.scale = ''
        node.style.rotate = ''
        delete o.el.dataset.cleanHint
        delete o.el.dataset.cleanClaimedBy
      }
      obstacles.length = 0
      drag = null
      dx = 0
      dy = 0
      dragging = false
      heldPointer = undefined
      started = false
      done = false
    },
  }
}

export const DRAGCLEAN_TEMPLATE: GameTemplate = {
  id: 'dragclean',
  label: 'Drag to clean',
  paramFields: [
    { key: 'coverPct', label: 'Cover to clean (% of the smaller of the two)', type: 'number', min: 5, max: 100, step: 5, group: 'Feel' },
    { key: 'pickupScale', label: 'Grow while dragging', type: 'number', min: 1, max: 2, step: 0.02, group: 'Feel' },
    { key: 'clampPadPct', label: 'How far off screen it may go (% of its size)', type: 'number', min: 0, max: 50, step: 5, group: 'Feel' },
    { key: 'winObstacles', label: 'Clean this many to win (0 = all of them)', type: 'number', min: 0, max: 100, step: 1, group: 'Feel' },
    { key: 'fadeMs', label: 'Obstacle fade (ms)', type: 'number', min: 0, max: 3000, step: 20, group: 'Cleaned obstacle' },
    { key: 'fadeScale', label: 'Shrinks to (1 = stays its size)', type: 'number', min: 0, max: 3, step: 0.05, group: 'Cleaned obstacle' },
    { key: 'fadeRotateDeg', label: 'Spins by (deg)', type: 'number', min: -180, max: 180, step: 5, group: 'Cleaned obstacle' },
  ],
  defaultParams: {
    coverPct: 70,
    pickupScale: 1.08,
    clampPadPct: 0,
    // 0 = every obstacle on the board. Any other number wins on that many, however
    // many are still standing behind it.
    winObstacles: 0,
    fadeMs: 320,
    fadeScale: 0.6,
    fadeRotateDeg: 0,
    // '' = every progress bar in the scene hears this game. Name a bar's element id
    // to pin the two together, for a scene with more than one of either.
    progressGameId: '',
  },
  defaultHintIdleMs: 3000,
  // Seeds a placed handguide that carries the tool onto the nearest obstacle. The
  // node only sets where the hand starts before the game has anything to point at.
  defaultHandguide: { mode: 'dragclean', nodes: [{ x: 0.5, y: 0.5 }], periodMs: 1800 },
  create: createDragClean,
}
