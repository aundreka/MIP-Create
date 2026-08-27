// Tap to reveal: tap, and something hidden comes up.
//
// Same model as the rest of this family — the mount contributes NO visuals, and every
// piece is an ordinary scene element the author placed, sized, cropped and animated by
// eye, then tagged with a `revealRole`:
//
//   reveal  the thing that appears. Placed exactly where the author wants it, hidden
//           until its turn, then faded in and LEFT there. This is the game: a board is
//           a list of these, and nothing else is required.
//   cover   OPTIONAL. A thing to tap that brings up specific reveals — a lid, a
//           scratch panel, a numbered door. A reveal that names no cover simply comes
//           up on the next tap anywhere, which is the plain "tap to reveal" board and
//           needs no second element per item.
//
// So the unit of play is a STEP, not a cover: one step is either "tap this cover" or
// "tap anywhere", and a step can bring up several reveals at once — a prize plus a glow
// plus a caption, each separately placed and separately animated. That is what the
// progress bar counts, so three pieces arriving together is one step rather than three.
//
// A cover with no reveal under it is a perfectly good board too: it leaves, and whatever
// the author placed BEHIND it is what shows. That is the "peel the panel off the poster"
// board, and it needs no extra wiring either.
//
// How this differs from tapremove.ts, its close sibling: there the point is the mess
// going away and the replacement is optional decoration on top of that. Here the point
// is the art arriving, and the cover is the optional part — `coverAfter: 'stay'` even
// keeps it in place, for a board where tapping lights something up rather than
// uncovering it.
//
// Won when every step is done, or earlier via `winSteps`. It feeds a progress bar over
// the progress channel exactly as its siblings do.

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
  /** Position in scene order, so steps run in the order the author stacked them. */
  seq: number
  restOpacity: string
  homePointer: string
}

interface Reveal {
  el: HTMLElement
  /** Element id of the cover that brings this up, or '' for "the next tap anywhere". */
  ofId: string
  seq: number
  /** Whether the author left it visible on the editor canvas, so destroy() can put the
   * canvas back exactly as it found it. */
  canvasShown: boolean
  restOpacity: string
}

/**
 * One beat of play: a thing to tap, and what that tap brings up.
 *
 * `cover` null is the plain board — the next tap anywhere does it. Steps rather than
 * covers are what the game counts, because several reveals can arrive on one tap and
 * that should read as one step, not three.
 */
interface Step {
  cover: Cover | null
  reveals: Reveal[]
  seq: number
  done: boolean
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

  /** Whether a tapped cover leaves. 'stay' is the light-it-up board. */
  let coverAfter: 'fade' | 'stay' = 'fade'
  let fadeMs = 280
  let fadeScale = 0.86
  let revealMs = 320
  /** What a reveal grows FROM as it fades in. 1 = no growth, just the fade. */
  let revealFrom = 0.86
  let winSteps = 0
  let progressGameId = ''

  const covers: Cover[] = []
  const reveals: Reveal[] = []
  const steps: Step[] = []
  const timers: number[] = []
  let offRequest: (() => void) | null = null
  let offTap: (() => void) | null = null

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

  const doneCount = (): number => steps.reduce((n, s) => (s.done ? n + 1 : n), 0)
  const target = (): number => Math.max(1, winSteps > 0 ? Math.min(winSteps, steps.length || winSteps) : steps.length)

  const announce = (): void => {
    emitProgress(ctx.root, { gameId: ctx.elementId ?? '', value: doneCount(), total: target(), to: progressGameId })
  }

  /** The step a hint should point at: the first one not yet done. */
  const nextStep = (): Step | undefined => (done ? undefined : steps.find((s) => !s.done))

  /**
   * Publish where to tap next as `data-reveal-hint`, so a placed handguide in
   * 'tapreveal' or 'pinch' mode re-targets by itself as the board opens up.
   *
   * A step with a cover marks the cover. A coverless step has nothing on screen to
   * point at, so the marker goes on the game's own slot — an invisible box, but one the
   * author drew and positioned, which makes it exactly the right place to mime a tap.
   */
  const markHint = (): void => {
    const next = nextStep()
    for (const c of covers) {
      if (next?.cover === c) c.el.dataset.revealHint = '1'
      else delete c.el.dataset.revealHint
    }
    if (next && !next.cover) ctx.root.dataset.revealHint = '1'
    else delete ctx.root.dataset.revealHint
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
   * that property (it rewrites the element's authored opacity on every layout pass), so
   * clearing it outright would silently promote a half-transparent reveal to solid.
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

  const play = (s: Step): void => {
    if (s.done || done) return
    s.done = true
    const c = s.cover
    if (c) {
      // No second tap on something already opened, whether or not the cover is leaving.
      c.el.style.pointerEvents = 'none'
      c.el.style.cursor = 'default'
    }
    // Broadcast BEFORE the cover starts moving, so an authored 'tapReveal' animation on
    // the cover itself plays while it is still visible.
    ctx.sfx.play('tapReveal')
    announce()
    markHint()

    for (const r of s.reveals) show(r)

    if (c && coverAfter === 'fade') {
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
    if (doneCount() >= target()) after(c && coverAfter === 'fade' ? fadeMs : revealMs, finish)
  }

  const park = (c: Cover): void => {
    c.el.classList.add(OFF_CLASS)
    c.el.style.transition = ''
    c.el.style.opacity = c.restOpacity
    const node = scaleNode(c.el)
    node.style.transition = ''
    node.style.scale = ''
  }

  const attachTap = (c: Cover, s: Step): void => {
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
    c.el.addEventListener('pointerdown', () => play(s))
  }

  /**
   * Taps that belong to no cover, for the boards that have none.
   *
   * Bound on the scene root rather than on this game's own box, because the mount is
   * deliberately outside hit-testing (see mount) and a board like this usually wants the
   * whole screen live anyway. A tap that landed on one of OUR covers is skipped — that
   * cover's own handler is about to run, and counting both would burn two steps on one
   * tap.
   */
  const attachAnywhere = (): void => {
    const host = ctx.root.closest<HTMLElement>('.pa-root')
    if (!host) return
    const onTap = (event: PointerEvent): void => {
      if (done) return
      const hit = event.target as Element | null
      const on = hit?.closest<HTMLElement>('[data-reveal-role="cover"]')
      if (on && covers.some((c) => c.el === on)) return
      // A tap on something that navigates is that button's gesture, not a free reveal.
      // Spending a step on the tap that leaves the scene is invisible to the player and
      // would quietly desync the progress bar from what they actually saw.
      if (hit?.closest('.pa-cta, .pa-choice, button')) return
      const next = steps.find((s) => !s.done && !s.cover)
      if (next) play(next)
    }
    host.addEventListener('pointerdown', onTap)
    offTap = () => host.removeEventListener('pointerdown', onTap)
  }

  // ---- element discovery -----------------------------------------------------
  const collect = (): void => {
    const stageRoot = ctx.root.closest('.pa-root')
    if (!stageRoot) return
    let seq = 0
    for (const el of Array.from(stageRoot.querySelectorAll<HTMLElement>('[data-reveal-role]'))) {
      const wanted = el.dataset.revealGameId
      // An element addressed to another tap-reveal game is not ours; an unaddressed one
      // is claimed first-come so two games in a scene can't fight over it.
      if (wanted ? wanted !== ctx.elementId : !!el.dataset.revealClaimedBy) continue
      el.dataset.revealClaimedBy = ctx.elementId ?? 'tapreveal'
      seq++
      if (el.dataset.revealRole === 'cover') {
        covers.push({ el, id: el.dataset.id ?? '', seq, restOpacity: el.style.opacity, homePointer: el.style.pointerEvents })
      } else if (el.dataset.revealRole === 'reveal') {
        reveals.push({ el, ofId: el.dataset.revealOf ?? '', seq, canvasShown: el.dataset.revealCanvasShow === '1', restOpacity: el.style.opacity })
      }
    }

    // Steps, in the order the author stacked the board. A cover is one step and takes
    // every reveal addressed to it; a reveal addressed to nothing (or to a cover that
    // is no longer assigned) is a step of its own, opened by the next tap anywhere.
    for (const c of covers) steps.push({ cover: c, reveals: reveals.filter((r) => r.ofId === c.id), seq: c.seq, done: false })
    for (const r of reveals) {
      if (covers.some((c) => c.id === r.ofId)) continue
      steps.push({ cover: null, reveals: [r], seq: r.seq, done: false })
    }
    steps.sort((a, b) => a.seq - b.seq)
  }

  return {
    mount(c, params) {
      ctx = c
      coverAfter = str(params.coverAfter, 'fade') === 'stay' ? 'stay' : 'fade'
      fadeMs = Math.max(0, Math.min(3000, num(params.fadeMs, 280)))
      fadeScale = Math.max(0, Math.min(3, num(params.fadeScale, 0.86)))
      revealMs = Math.max(0, Math.min(3000, num(params.revealMs, 320)))
      revealFrom = Math.max(0, Math.min(3, num(params.revealFrom, 0.86)))
      winSteps = Math.max(0, Math.round(num(params.winSteps, 0)))
      progressGameId = str(params.progressGameId, '').trim()

      // Step the whole mount OUT of hit-testing, exactly as the rest of this family
      // does. Every interactive piece is a tagged scene element sitting OUTSIDE the box;
      // what the mount has is an author-sized rectangle, invisible but hit-testable by
      // default, which wherever it lands above a cover in the layer order would silently
      // swallow the taps over the overlapping part.
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
      if (!steps.length) {
        // Nothing is wired up — win immediately rather than stranding the player on a
        // board that cannot be finished.
        finish()
        return
      }
      for (const s of steps) if (s.cover) attachTap(s.cover, s)
      if (steps.some((s) => !s.cover)) attachAnywhere()
      markHint()
    },
    relayout() {
      // Nothing to re-measure: every piece is an ordinary scene element that layoutRec
      // has already repositioned, and this game moves none of them.
    },
    getHint(): HintMove | null {
      const next = nextStep()
      if (!next) return null
      // A coverless step has nothing on screen to point at, so the hand taps the middle
      // of the game's own box — the area the author drew for exactly this.
      const p = center(next.cover?.el ?? ctx.root)
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
      offTap?.()
      offTap = null
      if (shell) shell.style.pointerEvents = shellPointerEvents
      shell = null
      ctx.root.style.pointerEvents = rootPointerEvents
      delete ctx.root.dataset.revealHint
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
      steps.length = 0
      started = false
      done = false
    },
  }
}

export const TAPREVEAL_TEMPLATE: GameTemplate = {
  id: 'tapreveal',
  label: 'Tap to reveal',
  paramFields: [
    { key: 'winSteps', label: 'Reveal this many to win (0 = all of them)', type: 'number', min: 0, max: 100, step: 1, group: 'Feel' },
    { key: 'revealMs', label: 'Reveal fades in over (ms)', type: 'number', min: 0, max: 3000, step: 20, group: 'Revealed image' },
    { key: 'revealFrom', label: 'Grows from (1 = no growth)', type: 'number', min: 0, max: 3, step: 0.02, group: 'Revealed image' },
    { key: 'coverAfter', label: 'A tapped cover', type: 'select', options: ['fade', 'stay'], group: 'Cover' },
    { key: 'fadeMs', label: 'Cover fade (ms)', type: 'number', min: 0, max: 3000, step: 20, group: 'Cover', showIf: (p) => p.coverAfter !== 'stay' },
    { key: 'fadeScale', label: 'Cover shrinks to (1 = stays its size)', type: 'number', min: 0, max: 3, step: 0.02, group: 'Cover', showIf: (p) => p.coverAfter !== 'stay' },
  ],
  defaultParams: {
    // 0 = every step on the board. Any other number wins on that many, however many are
    // still waiting behind them.
    winSteps: 0,
    revealMs: 320,
    revealFrom: 0.86,
    // 'fade' = a tapped cover leaves (uncovering); 'stay' = it remains in place, inert,
    // and the reveal simply arrives (lighting something up). Only applies where an
    // author has actually assigned covers.
    coverAfter: 'fade',
    fadeMs: 280,
    fadeScale: 0.86,
    // '' = every progress bar in the scene hears this game. Name a bar's element id to
    // pin the two together, for a scene with more than one of either.
    progressGameId: '',
  },
  defaultHintIdleMs: 2600,
  // Seeds a placed handguide that taps wherever the next step is.
  defaultHandguide: { mode: 'tapreveal', nodes: [{ x: 0.5, y: 0.5 }], periodMs: 1000 },
  create: createTapReveal,
}
