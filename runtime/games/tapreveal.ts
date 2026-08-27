// Tap to reveal: tap a thing, and what was hidden under it comes up.
//
// Same model as the rest of this family — the mount contributes NO visuals, and every
// piece is an ordinary scene element the author placed, sized, cropped and animated by
// eye, then tagged with a `revealRole`:
//
//   cover   the thing the player taps. Any number.
//   reveal  what that tap brings up: an element sitting exactly where the author put
//           it, hidden until its cover is tapped, then faded in and left there. ANY
//           NUMBER per cover, so a prize plus a glow plus a caption are three
//           separately placed and separately animated elements rather than one
//           flattened picture.
//
// A cover with no reveal assigned is not a mistake: the cover leaves and whatever the
// author placed BEHIND it is what the player sees. That is the "scratch off the panel
// to see the poster underneath" board, and it needs no extra wiring — which is why
// this game does not insist on a reveal per cover.
//
// How this differs from tapremove.ts, which is otherwise its close sibling: there the
// point is the mess going away, and the replacement is optional decoration on top of
// that. Here the point is the art arriving, and the COVER is the optional part —
// `coverAfter: 'stay'` keeps it in place, for a board where tapping lights something
// up rather than uncovering it. The two exist separately because the boards read
// differently to an author, and a scene can run both at once.
//
// Won when every cover has been tapped, or earlier via `winCovers`. It feeds a
// progress bar over the progress channel exactly as its siblings do.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num, str } from './types'
import { COMBO_OFF_CLASS } from './combo'
import { emitProgress, onProgressRequest } from './progresschannel'

/** The shared "hidden without touching inline display/opacity" class. layoutRec
 * rewrites both of those properties on every layout pass, so an inline hide would be
 * dropped by the next resize; this is a class instead. */
const OFF_CLASS = COMBO_OFF_CLASS

interface Cover {
  el: HTMLElement
  /** This cover's own element id — what its reveals name to find it. */
  id: string
  tapped: boolean
  /** Inline opacity layoutRec left on it, to be handed back on destroy. */
  restOpacity: string
  homePointer: string
}

interface Reveal {
  el: HTMLElement
  /** Element id of the cover that brings this up. */
  ofId: string
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

export function createTapReveal(): GameModule {
  let ctx: GameContext

  /** Whether the tapped cover leaves. 'stay' is the light-it-up board. */
  let coverAfter: 'fade' | 'stay' = 'fade'
  let fadeMs = 280
  let fadeScale = 0.86
  let revealMs = 320
  /** What a reveal grows FROM as it fades in. 1 = no growth, just the fade. */
  let revealFrom = 0.86
  let winCovers = 0
  let progressGameId = ''

  const covers: Cover[] = []
  const reveals: Reveal[] = []
  const timers: number[] = []
  let offRequest: (() => void) | null = null

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

  const tappedCount = (): number => covers.reduce((n, c) => (c.tapped ? n + 1 : n), 0)
  const target = (): number => Math.max(1, winCovers > 0 ? Math.min(winCovers, covers.length || winCovers) : covers.length)

  const revealsOf = (c: Cover): Reveal[] => reveals.filter((r) => r.ofId === c.id)

  const announce = (): void => {
    emitProgress(ctx.root, { gameId: ctx.elementId ?? '', value: tappedCount(), total: target(), to: progressGameId })
  }

  /** The cover a hint should point at: the first one still untapped, in the order the
   * author stacked them. */
  const nextCover = (): Cover | undefined => (done ? undefined : covers.find((c) => !c.tapped))

  /** Publish it as `data-reveal-hint`, so a placed handguide in 'tapreveal' mode
   * re-targets by itself as the board is uncovered. */
  const markHint = (): void => {
    const next = nextCover()
    for (const c of covers) {
      if (c === next) c.el.dataset.revealHint = '1'
      else delete c.el.dataset.revealHint
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

  /**
   * Bring a reveal up over `revealMs`, and LEAVE it up.
   *
   * The resting inline opacity is captured and handed back at the end: layoutRec owns
   * that property (it rewrites the element's authored opacity on every layout pass),
   * so clearing it outright would silently promote a half-transparent reveal to solid.
   */
  const show = (r: Reveal): void => {
    r.restOpacity = r.el.style.opacity
    const node = scaleNode(r.el)
    if (revealMs <= 0) {
      r.el.classList.remove(OFF_CLASS)
      return
    }
    r.el.style.transition = ''
    r.el.style.opacity = '0'
    node.style.transition = ''
    if (revealFrom !== 1) node.style.scale = String(revealFrom)
    r.el.classList.remove(OFF_CLASS)
    // Flush the start values so the browser has something to animate FROM; without this
    // the class removal and the 0 -> 1 change collapse into one style recalc and nothing
    // runs at all.
    void r.el.offsetWidth
    r.el.style.transition = `opacity ${revealMs}ms ease`
    r.el.style.opacity = '1'
    node.style.transition = `scale ${revealMs}ms cubic-bezier(.34,1.2,.4,1)`
    node.style.scale = '1'
    after(revealMs, () => {
      r.el.style.transition = ''
      r.el.style.opacity = r.restOpacity
      node.style.transition = ''
      node.style.scale = ''
    })
  }

  const uncover = (c: Cover): void => {
    if (c.tapped || done) return
    c.tapped = true
    // No second tap on something already opened, whether or not the cover is leaving.
    c.el.style.pointerEvents = 'none'
    c.el.style.cursor = 'default'
    // Broadcast BEFORE the cover starts moving, so an authored 'tapReveal' animation on
    // the cover itself plays while it is still visible.
    ctx.sfx.play('tapReveal')
    announce()
    markHint()

    for (const r of revealsOf(c)) show(r)

    if (coverAfter === 'fade') {
      if (fadeMs > 0) {
        c.el.style.transition = `opacity ${fadeMs}ms ease`
        c.el.style.opacity = '0'
        const node = scaleNode(c.el)
        node.style.transition = `scale ${fadeMs}ms ease`
        if (fadeScale !== 1) node.style.scale = String(fadeScale)
        after(fadeMs, () => park(c))
      } else {
        park(c)
      }
    }
    // 'stay' leaves the cover exactly as it is — still on screen, just inert.
    if (tappedCount() >= target()) after(coverAfter === 'fade' ? fadeMs : revealMs, finish)
  }

  const park = (c: Cover): void => {
    c.el.classList.add(OFF_CLASS)
    c.el.style.transition = ''
    c.el.style.opacity = c.restOpacity
    const node = scaleNode(c.el)
    node.style.transition = ''
    node.style.scale = ''
  }

  const attachTap = (c: Cover): void => {
    c.el.style.cursor = 'pointer'
    c.el.style.touchAction = 'manipulation'
    c.el.style.pointerEvents = 'auto'
    // iOS raises its own press-and-hold sheet over an image — "Save Image", the
    // selection magnifier — which on a rapid-tap board fires constantly.
    c.el.style.setProperty('-webkit-touch-callout', 'none')
    c.el.style.setProperty('-webkit-tap-highlight-color', 'transparent')
    // pointerdown rather than click: a beat faster, it survives the small drag a real
    // thumb makes (which cancels a click), and it is the same event stage.ts fires the
    // element's own on-tap animation from, so the two land together.
    c.el.addEventListener('pointerdown', () => uncover(c))
  }

  // ---- element discovery -----------------------------------------------------
  const collect = (): void => {
    const stageRoot = ctx.root.closest('.pa-root')
    if (!stageRoot) return
    for (const el of Array.from(stageRoot.querySelectorAll<HTMLElement>('[data-reveal-role]'))) {
      const wanted = el.dataset.revealGameId
      // An element addressed to another tap-reveal game is not ours; an unaddressed one
      // is claimed first-come so two games in a scene can't fight over it.
      if (wanted ? wanted !== ctx.elementId : !!el.dataset.revealClaimedBy) continue
      el.dataset.revealClaimedBy = ctx.elementId ?? 'tapreveal'
      if (el.dataset.revealRole === 'cover') {
        covers.push({ el, id: el.dataset.id ?? '', tapped: false, restOpacity: el.style.opacity, homePointer: el.style.pointerEvents })
      } else if (el.dataset.revealRole === 'reveal') {
        reveals.push({ el, ofId: el.dataset.revealOf ?? '', canvasShown: el.dataset.revealCanvasShow === '1', restOpacity: el.style.opacity })
      }
    }
  }

  return {
    mount(c, params) {
      ctx = c
      coverAfter = str(params.coverAfter, 'fade') === 'stay' ? 'stay' : 'fade'
      fadeMs = Math.max(0, Math.min(3000, num(params.fadeMs, 280)))
      fadeScale = Math.max(0, Math.min(3, num(params.fadeScale, 0.86)))
      revealMs = Math.max(0, Math.min(3000, num(params.revealMs, 320)))
      revealFrom = Math.max(0, Math.min(3, num(params.revealFrom, 0.86)))
      winCovers = Math.max(0, Math.round(num(params.winCovers, 0)))
      progressGameId = str(params.progressGameId, '').trim()

      // Step the whole mount OUT of hit-testing, exactly as the rest of this family
      // does. Every interactive piece is a tagged scene element sitting OUTSIDE the
      // box; what the mount has is an author-sized rectangle, invisible but
      // hit-testable by default, which wherever it lands above a cover in the layer
      // order would silently swallow the taps over the overlapping part.
      shell = ctx.root.closest<HTMLElement>('.pa-el')
      shellPointerEvents = shell?.style.pointerEvents ?? ''
      rootPointerEvents = ctx.root.style.pointerEvents
      if (shell) shell.style.pointerEvents = 'none'
      ctx.root.style.pointerEvents = 'none'

      collect()
      // Nothing is hidden or revealed here on purpose: mount() also runs on the static
      // editor canvas, where covers must stay visible and selectable and each reveal
      // keeps whatever canvas visibility the author chose for it.
    },
    start() {
      if (started) return
      started = true
      // Whatever the author left visible while positioning, play starts from the board
      // as the player first sees it: every cover up, nothing revealed.
      for (const r of reveals) {
        r.restOpacity = r.el.style.opacity
        r.el.classList.add(OFF_CLASS)
      }
      offRequest = onProgressRequest(ctx.root, announce)
      announce()
      if (!covers.length) {
        // Nothing is wired up — win immediately rather than stranding the player on a
        // board that cannot be finished.
        finish()
        return
      }
      covers.forEach(attachTap)
      markHint()
    },
    relayout() {
      // Nothing to re-measure: every piece is an ordinary scene element that layoutRec
      // has already repositioned, and this game moves none of them.
    },
    getHint(): HintMove | null {
      const next = nextCover()
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
      for (const c of covers) {
        // A cover is always visible on the canvas — there is no per-element authoring
        // flag to put back, just the board as the author arranged it.
        c.el.classList.remove(OFF_CLASS)
        c.el.style.transition = ''
        c.el.style.opacity = c.restOpacity
        c.el.style.cursor = ''
        c.el.style.pointerEvents = c.homePointer
        c.el.style.removeProperty('-webkit-touch-callout')
        c.el.style.removeProperty('-webkit-tap-highlight-color')
        const node = scaleNode(c.el)
        node.style.transition = ''
        node.style.scale = ''
        delete c.el.dataset.revealHint
        delete c.el.dataset.revealClaimedBy
      }
      for (const r of reveals) {
        // Put the canvas back exactly as it was found: one the author had shown stays
        // shown, one they had hidden stays hidden.
        if (r.canvasShown) r.el.classList.remove(OFF_CLASS)
        else r.el.classList.add(OFF_CLASS)
        r.el.style.transition = ''
        r.el.style.opacity = r.restOpacity
        const node = scaleNode(r.el)
        node.style.transition = ''
        node.style.scale = ''
        delete r.el.dataset.revealClaimedBy
      }
      covers.length = 0
      reveals.length = 0
      started = false
      done = false
    },
  }
}

export const TAPREVEAL_TEMPLATE: GameTemplate = {
  id: 'tapreveal',
  label: 'Tap to reveal',
  paramFields: [
    { key: 'winCovers', label: 'Reveal this many to win (0 = all of them)', type: 'number', min: 0, max: 100, step: 1, group: 'Feel' },
    { key: 'coverAfter', label: 'The tapped cover', type: 'select', options: ['fade', 'stay'], group: 'Feel' },
    { key: 'revealMs', label: 'Reveal fades in over (ms)', type: 'number', min: 0, max: 3000, step: 20, group: 'Revealed image' },
    { key: 'revealFrom', label: 'Grows from (1 = no growth)', type: 'number', min: 0, max: 3, step: 0.02, group: 'Revealed image' },
    { key: 'fadeMs', label: 'Cover fade (ms)', type: 'number', min: 0, max: 3000, step: 20, group: 'Cover', showIf: (p) => p.coverAfter !== 'stay' },
    { key: 'fadeScale', label: 'Cover shrinks to (1 = stays its size)', type: 'number', min: 0, max: 3, step: 0.02, group: 'Cover', showIf: (p) => p.coverAfter !== 'stay' },
  ],
  defaultParams: {
    // 0 = every cover on the board. Any other number wins on that many, however many
    // are still up behind them.
    winCovers: 0,
    // 'fade' = the cover leaves (uncovering); 'stay' = it remains in place, inert, and
    // the reveal simply arrives (lighting something up).
    coverAfter: 'fade',
    revealMs: 320,
    revealFrom: 0.86,
    fadeMs: 280,
    fadeScale: 0.86,
    // '' = every progress bar in the scene hears this game. Name a bar's element id to
    // pin the two together, for a scene with more than one of either.
    progressGameId: '',
  },
  defaultHintIdleMs: 2600,
  // Seeds a placed handguide that taps the next cover still up.
  defaultHandguide: { mode: 'tapreveal', nodes: [{ x: 0.5, y: 0.5 }], periodMs: 1000 },
  create: createTapReveal,
}
