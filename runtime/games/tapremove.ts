// Tap to remove: the author places the mess, the player taps it away.
//
// The sibling of dragclean.ts, and built the same way — the game mount contributes NO
// visuals, and every piece on the board is an ordinary scene element the author placed,
// sized, cropped and animated by eye, then tagged with a `tapRole`:
//
//   obstacle  a thing to get rid of. Any number. Tapping it removes it.
//   after     what the obstacle turns INTO, if anything. An element sitting exactly
//             where the author put it, hidden until its obstacle is tapped, then
//             cross-faded up as the obstacle fades out. ANY NUMBER per obstacle, so a
//             cleaned tile plus a sparkle plus a label are three separately placed and
//             separately animated elements rather than one flattened picture. An
//             obstacle with none simply fades to nothing.
//
// Because the replacement is a placed ELEMENT rather than a second image slot in this
// panel, it has its own position, size, crop and animation — a "before" the size of a
// whole wall can become an "after" the size of a sticker, and neither has to pretend to
// be the other's dimensions. It is the same trade combo.ts makes with its layers.
//
// The obstacle keeps its own on-tap animation, because that is an ordinary element
// property (`animations.tap`) that stage.ts already fires for anything tappable — so a
// squash or a wobble on the tap itself needs nothing from this game. What this game
// adds is the 'tapRemove' beat, broadcast when an obstacle actually goes, which any
// element in the scene can hang a sound or an animation on.
//
// Won when the board is clear, or earlier via `winObstacles`. It feeds a progress bar
// (progressbar.ts) over the progress channel exactly as drag-to-clean does: one step
// per obstacle, with the obstacle count as the total, so a bar dropped into the scene
// sizes itself to the board with no wiring at all.

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
  index: number
  removed: boolean
  /** Inline opacity layoutRec left on it, to be handed back on destroy. */
  restOpacity: string
  homePointer: string
}

interface After {
  el: HTMLElement
  index: number
  /** Whether the author left it visible on the editor canvas, so destroy() can put the
   * canvas back exactly as it found it. */
  canvasShown: boolean
  /** Inline opacity layoutRec left on it, to be handed back. */
  restOpacity: string
}

function scaleNode(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>('.pa-el-anim') ?? el
}

function center(el: HTMLElement): Pt {
  const node = scaleNode(el)
  let r = node.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createTapRemove(): GameModule {
  let ctx: GameContext

  let fadeMs = 300
  let fadeScale = 0.6
  let fadeRotateDeg = 0
  let crossFadeMs = 260
  let winObstacles = 0
  let progressGameId = ''

  const obstacles: Obstacle[] = []
  const afters: After[] = []
  const timers: number[] = []
  let offRequest: (() => void) | null = null

  /** The mount's own outer .pa-el and the inline pointer-events it was built with. */
  let shell: HTMLElement | null = null
  let shellPointerEvents = ''
  let rootPointerEvents = ''

  let started = false
  let done = false
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null

  const after = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms))
  }

  const removedCount = (): number => obstacles.reduce((n, o) => (o.removed ? n + 1 : n), 0)
  const target = (): number => Math.max(1, winObstacles > 0 ? Math.min(winObstacles, obstacles.length || winObstacles) : obstacles.length)

  const aftersFor = (index: number): After[] => afters.filter((a) => a.index === index)

  /** Publish where play has got to, for any progress bar in the scene. */
  const announce = (): void => {
    emitProgress(ctx.root, { gameId: ctx.elementId ?? '', value: removedCount(), total: target(), to: progressGameId })
  }

  /** The obstacle a hint should point at: the first one still standing, in the order
   * the author stacked them. Unlike drag-to-clean there is no tool to measure distance
   * from, so scene order is the only ordering that means anything. */
  const nextObstacle = (): Obstacle | undefined => (done ? undefined : obstacles.find((o) => !o.removed))

  /** Publish it as `data-tap-hint`, the way combo publishes its live option, so a
   * placed handguide in 'tapremove' mode re-targets by itself as the board clears. */
  const markHint = (): void => {
    const next = nextObstacle()
    for (const o of obstacles) {
      if (o === next) o.el.dataset.tapHint = '1'
      else delete o.el.dataset.tapHint
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

  /** Bring an 'after' up from transparent over `ms`, so it arrives as the obstacle on
   * top of it leaves and the two read as one object changing rather than a swap.
   *
   * The resting inline opacity is captured and handed back: layoutRec owns that
   * property (it rewrites the element's authored opacity on every layout pass), so
   * clearing it outright would silently promote a half-transparent element to solid. */
  const fadeIn = (a: After, ms: number): void => {
    a.restOpacity = a.el.style.opacity
    if (ms <= 0) {
      a.el.classList.remove(OFF_CLASS)
      return
    }
    a.el.style.transition = ''
    a.el.style.opacity = '0'
    a.el.classList.remove(OFF_CLASS)
    // Flush the 0 so the browser has a value to animate FROM; without this the class
    // removal and the 0 -> 1 change collapse into one style recalc and nothing runs.
    void a.el.offsetWidth
    a.el.style.transition = `opacity ${ms}ms linear`
    a.el.style.opacity = '1'
    after(ms, () => {
      a.el.style.transition = ''
      a.el.style.opacity = a.restOpacity
    })
  }

  const remove = (o: Obstacle): void => {
    if (o.removed || done) return
    o.removed = true
    // No more taps on something already on its way out, and none falling through to
    // whatever is behind it either.
    o.el.style.pointerEvents = 'none'
    // Broadcast BEFORE the fade so an authored 'tapRemove' animation on the obstacle
    // itself plays while it is still visible, rather than against a transparent box.
    ctx.sfx.play('tapRemove')
    announce()
    markHint()

    // The replacement comes up on a LINEAR pair with the fade-out: eased curves dip in
    // the middle and read as a flicker across the swap.
    for (const a of aftersFor(o.index)) fadeIn(a, Math.min(crossFadeMs, fadeMs || crossFadeMs))

    if (fadeMs > 0) {
      o.el.style.transition = `opacity ${fadeMs}ms linear`
      o.el.style.opacity = '0'
      const node = scaleNode(o.el)
      node.style.transition = `scale ${fadeMs}ms ease, rotate ${fadeMs}ms ease`
      if (fadeScale !== 1) node.style.scale = String(fadeScale)
      if (fadeRotateDeg !== 0) node.style.rotate = `${fadeRotateDeg}deg`
      after(fadeMs, () => park(o))
    } else {
      park(o)
    }
    if (removedCount() >= target()) after(fadeMs, finish)
  }

  /** Put a removed obstacle away for good, handing back the inline properties
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

  const attachTap = (o: Obstacle): void => {
    o.el.style.cursor = 'pointer'
    o.el.style.touchAction = 'manipulation'
    o.el.style.pointerEvents = 'auto'
    // iOS raises its own press-and-hold sheet over an image — "Save Image", the
    // selection magnifier — which on a rapid-tap board fires constantly.
    o.el.style.setProperty('-webkit-touch-callout', 'none')
    o.el.style.setProperty('-webkit-tap-highlight-color', 'transparent')
    // pointerdown rather than click: it is a beat faster, it survives the small drag a
    // real thumb makes (which cancels a click), and it is the same event stage.ts fires
    // the element's own on-tap animation from, so the two land together.
    //
    // Deliberately NOT stopPropagation: the obstacle's authored tap animation and any
    // scene-level tap handling are decoration layered on this, not competitors.
    o.el.addEventListener('pointerdown', () => remove(o))
  }

  // ---- element discovery -----------------------------------------------------
  const collect = (): void => {
    const stageRoot = ctx.root.closest('.pa-root')
    if (!stageRoot) return
    for (const el of Array.from(stageRoot.querySelectorAll<HTMLElement>('[data-tap-role]'))) {
      const wanted = el.dataset.tapGameId
      // An element addressed to another tap-remove game is not ours; an unaddressed one
      // is claimed first-come so two games in a scene can't fight over it.
      if (wanted ? wanted !== ctx.elementId : !!el.dataset.tapClaimedBy) continue
      const index = Math.max(1, Math.round(Number(el.dataset.tapIndex) || 1))
      el.dataset.tapClaimedBy = ctx.elementId ?? 'tapremove'
      if (el.dataset.tapRole === 'obstacle') {
        obstacles.push({ el, index, removed: false, restOpacity: el.style.opacity, homePointer: el.style.pointerEvents })
      } else if (el.dataset.tapRole === 'after') {
        afters.push({ el, index, canvasShown: el.dataset.tapCanvasShow === '1', restOpacity: el.style.opacity })
      }
    }
  }

  return {
    mount(c, params) {
      ctx = c
      fadeMs = Math.max(0, Math.min(3000, num(params.fadeMs, 300)))
      fadeScale = Math.max(0, Math.min(3, num(params.fadeScale, 0.6)))
      fadeRotateDeg = Math.max(-180, Math.min(180, num(params.fadeRotateDeg, 0)))
      crossFadeMs = Math.max(0, Math.min(3000, num(params.crossFadeMs, 260)))
      winObstacles = Math.max(0, Math.round(num(params.winObstacles, 0)))
      progressGameId = str(params.progressGameId, '').trim()

      // Step the whole mount OUT of hit-testing, exactly as the combo board does.
      // Every interactive piece of this game is a tagged scene element sitting OUTSIDE
      // the box. What the mount does have is an author-sized rectangle, invisible but
      // hit-testable by default, which wherever it lands above an obstacle in the layer
      // order would silently swallow the taps over the overlapping part — and on a
      // tap-only board that is the entire game.
      shell = ctx.root.closest<HTMLElement>('.pa-el')
      shellPointerEvents = shell?.style.pointerEvents ?? ''
      rootPointerEvents = ctx.root.style.pointerEvents
      if (shell) shell.style.pointerEvents = 'none'
      ctx.root.style.pointerEvents = 'none'

      collect()
      // Nothing is hidden or revealed here on purpose: mount() also runs on the static
      // editor canvas, where obstacles must stay visible and selectable and each
      // 'after' keeps whatever canvas visibility the author chose for it. start()
      // (interactive only) is what collapses to the opening state.
    },
    start() {
      if (started) return
      started = true
      // Whatever the author left visible while positioning, play starts from the board
      // as the player first sees it: every obstacle up, every replacement not yet.
      for (const a of afters) {
        a.restOpacity = a.el.style.opacity
        a.el.classList.add(OFF_CLASS)
      }
      offRequest = onProgressRequest(ctx.root, announce)
      announce()
      if (!obstacles.length) {
        // Nothing is wired up — win immediately rather than stranding the player on a
        // board that cannot be finished.
        finish()
        return
      }
      obstacles.forEach(attachTap)
      markHint()
    },
    relayout() {
      // Nothing to re-measure: every piece is an ordinary scene element that layoutRec
      // has already repositioned, and this game moves none of them.
    },
    getHint(): HintMove | null {
      const next = nextObstacle()
      if (!next) return null
      const p = center(next.el)
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      for (const t of timers) window.clearTimeout(t)
      timers.length = 0
      offRequest?.()
      offRequest = null
      if (shell) shell.style.pointerEvents = shellPointerEvents
      shell = null
      ctx.root.style.pointerEvents = rootPointerEvents
      ctx.root.innerHTML = ''
      for (const o of obstacles) {
        // An obstacle is always visible on the canvas — there is no per-element
        // authoring flag to put back, just the board as the author arranged it.
        o.el.classList.remove(OFF_CLASS)
        o.el.style.transition = ''
        o.el.style.opacity = o.restOpacity
        o.el.style.cursor = ''
        o.el.style.pointerEvents = o.homePointer
        o.el.style.removeProperty('-webkit-touch-callout')
        o.el.style.removeProperty('-webkit-tap-highlight-color')
        const node = scaleNode(o.el)
        node.style.transition = ''
        node.style.scale = ''
        node.style.rotate = ''
        delete o.el.dataset.tapHint
        delete o.el.dataset.tapClaimedBy
      }
      for (const a of afters) {
        // Put the canvas back exactly as it was found: one the author had shown stays
        // shown, one they had hidden stays hidden.
        if (a.canvasShown) a.el.classList.remove(OFF_CLASS)
        else a.el.classList.add(OFF_CLASS)
        a.el.style.transition = ''
        a.el.style.opacity = a.restOpacity
        delete a.el.dataset.tapClaimedBy
      }
      obstacles.length = 0
      afters.length = 0
      started = false
      done = false
    },
  }
}

export const TAPREMOVE_TEMPLATE: GameTemplate = {
  id: 'tapremove',
  label: 'Tap to remove',
  paramFields: [
    { key: 'winObstacles', label: 'Remove this many to win (0 = all of them)', type: 'number', min: 0, max: 100, step: 1, group: 'Feel' },
    { key: 'fadeMs', label: 'Obstacle fade (ms)', type: 'number', min: 0, max: 3000, step: 20, group: 'Removed obstacle' },
    { key: 'fadeScale', label: 'Shrinks to (1 = stays its size)', type: 'number', min: 0, max: 3, step: 0.05, group: 'Removed obstacle' },
    { key: 'fadeRotateDeg', label: 'Spins by (deg)', type: 'number', min: -180, max: 180, step: 5, group: 'Removed obstacle' },
    { key: 'crossFadeMs', label: 'Replacement fades in over (ms)', type: 'number', min: 0, max: 3000, step: 20, group: 'Removed obstacle' },
  ],
  defaultParams: {
    // 0 = every obstacle on the board. Any other number wins on that many, however
    // many are still standing behind it.
    winObstacles: 0,
    fadeMs: 300,
    fadeScale: 0.6,
    fadeRotateDeg: 0,
    crossFadeMs: 260,
    // '' = every progress bar in the scene hears this game. Name a bar's element id to
    // pin the two together, for a scene with more than one of either.
    progressGameId: '',
  },
  defaultHintIdleMs: 2600,
  // Seeds a placed handguide that taps the next obstacle still standing. The node only
  // sets where the hand starts before the game has anything to point at.
  defaultHandguide: { mode: 'tapremove', nodes: [{ x: 0.5, y: 0.5 }], periodMs: 1000 },
  create: createTapRemove,
}
