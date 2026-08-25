// Cross-scene morph ("magic move") — see MorphConfig in scene.ts for the authoring
// model. This file is the flight itself.
//
// The work is split in two halves because the caller has to straddle the scene swap:
//
//   planMorphs()     pure, over the two scene DEFS. Resolves defaults and drops pairs
//                    that can't fly (no target, hidden, carry-over). Testable without
//                    a DOM.
//   captureMorphs()  runs on the OUTGOING scene BEFORE anything moves: measures each
//                    source's resting rect, takes a frozen copy of its DOM, and hides
//                    the original so it can't fade out from under the copy.
//   launchMorphs()   runs once the INCOMING scene is laid out: measures the target
//                    rects, hides the targets, and flies the copies onto them.
//
// Everything travels in a single layer above both scene roots, so the ordinary scene
// transition (fade / slide) keeps running underneath without touching the flight.
//
// The layer is addressed through plain HTMLElements rather than StageHandles: the two
// ends live in different stages (and a parked immune element lives in neither), so the
// caller resolves ids to nodes and this file stays out of stage.ts's way.

import type { MorphEffect, MorphScaleMode, SceneDef } from './scene'

export const MORPH_DEFAULT_MS = 600
export const MORPH_DEFAULT_EASING = 'cubic-bezier(.4,0,.2,1)'
/** Above the redirect cover (11000) and both immune tiers, below the carry-over layer (12000). */
export const MORPH_LAYER_Z = 11500
/** Hides an end of the pair for the flight's life. A CLASS, because layoutRec rewrites
 *  inline opacity/display from the element on every layout pass (same reason as .pa-el--t-off). */
export const MORPH_OFF_CLASS = 'pa-morph-off'
/** Fraction of the flight the source keeps for its fade in the 'fade-through' hand-off. */
const THROUGH_SPLIT = 0.45

export interface MorphPlan {
  fromId: string
  toId: string
  effect: MorphEffect
  scaleMode: MorphScaleMode
  endScale: number
  durationMs: number
  delayMs: number
  easing: string
}

/**
 * Which of `from`'s elements morph into `to`'s, with every default resolved.
 *
 * Pairs are dropped rather than half-played: an element whose target scene isn't the
 * one being entered, whose target has gone (deleted, renamed id, pasted copy), or
 * whose either end is hidden or a carry-over has nothing to hand over.
 *
 * Several sources MAY converge on one target (three coins merging into a pile); the
 * runtime keeps the target hidden until the last of them lands.
 */
export function planMorphs(from: SceneDef | null | undefined, to: SceneDef | null | undefined): MorphPlan[] {
  if (!from || !to || from.id === to.id) return []
  const targets = new Map(to.elements.filter((e) => !e.hidden && !e.persist).map((e) => [e.id, e]))
  const out: MorphPlan[] = []
  for (const el of from.elements) {
    const m = el.morph
    if (!m || el.hidden || el.persist) continue
    if (m.toSceneId !== to.id || !m.toElementId) continue
    if (!targets.has(m.toElementId)) continue
    out.push({
      fromId: el.id,
      toId: m.toElementId,
      effect: m.effect ?? 'cross-fade',
      scaleMode: m.scaleMode ?? 'fit',
      endScale: m.endScale && m.endScale > 0 ? m.endScale : 1,
      durationMs: Math.max(0, m.durationMs ?? MORPH_DEFAULT_MS),
      delayMs: Math.max(0, m.delayMs ?? 0),
      easing: m.easing || MORPH_DEFAULT_EASING,
    })
  }
  return out
}

/** A box as centre + size — the form the flight maths actually wants. */
export interface MorphBox {
  cx: number
  cy: number
  w: number
  h: number
}

/**
 * The scale that takes box `a` onto box `b` under `mode`, per axis.
 *
 * 'fit' matches contain-style (the smaller of the two ratios) rather than by width
 * alone: when the two arts have different aspects, matching width leaves the flyer
 * spilling past the thing it is turning into — which is exactly when the seam shows.
 */
export function morphScale(mode: MorphScaleMode, a: MorphBox, b: MorphBox): [number, number] {
  if (mode === 'none' || a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return [1, 1]
  if (mode === 'stretch') return [b.w / a.w, b.h / a.h]
  const k = Math.min(b.w / a.w, b.h / a.h)
  return [k, k]
}

/** Total wall time a plan occupies, including its hold. */
export const morphTotalMs = (p: MorphPlan): number => p.delayMs + p.durationMs

// ---------------------------------------------------------------------------
// DOM half
// ---------------------------------------------------------------------------

export interface MorphCapture {
  plan: MorphPlan
  /** Frozen copy of the source element, not yet in the document. */
  node: HTMLElement
  from: MorphBox
  /** Show the original source again (an overlay dismissing back to its scene). */
  restore(): void
}

export interface MorphRun {
  /** Land everything at once: reveal every target, drop the layer. Idempotent. */
  finish(): void
  /** Un-hide the SOURCE elements. Only their scene knows whether it is coming back. */
  restoreSources(): void
  /** Longest flight in this run, ms — what a caller has to wait for. */
  totalMs: number
}

const hide = (el: HTMLElement): (() => void) => {
  el.classList.add(MORPH_OFF_CLASS)
  return () => el.classList.remove(MORPH_OFF_CLASS)
}

/**
 * The element's RESTING rect — measured with its own animations suppressed.
 *
 * Both ends need this. A source mid-pulse and a target one frame into its entrance
 * are both somewhere other than where they lay out, and a flight aimed at either
 * lands off by however far the animation had carried it. getBoundingClientRect
 * flushes style synchronously, so the suppression is invisible.
 */
export function restingBox(el: HTMLElement): MorphBox | null {
  const nodes = [el, ...Array.from(el.querySelectorAll<HTMLElement>('.pa-el-anim'))]
  const saved = nodes.map((n) => n.style.animation)
  nodes.forEach((n) => (n.style.animation = 'none'))
  const r = el.getBoundingClientRect()
  nodes.forEach((n, i) => (n.style.animation = saved[i]))
  if (r.width < 1 || r.height < 1) return null
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height }
}

/**
 * A copy that holds still. Every animation and transition inside it is killed: a live
 * CTA pulse or lightray sweep would re-offset the copy from the rect we just measured,
 * and the flight IS the animation now.
 */
function freezeClone(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement
  copy.classList.remove(MORPH_OFF_CLASS)
  for (const node of [copy, ...Array.from(copy.querySelectorAll<HTMLElement>('*'))]) {
    node.style.animation = 'none'
    node.style.transition = 'none'
    node.classList.remove('pa-lightray', 'pa-lightray--run')
  }
  copy.style.pointerEvents = 'none'
  return copy
}

/**
 * Freeze the outgoing side. Call BEFORE the old scene starts leaving (exit animations,
 * unparking, the transition itself) — after that the rects are no longer what the
 * player is looking at.
 */
export function captureMorphs(plans: MorphPlan[], resolve: (id: string) => HTMLElement | null | undefined): MorphCapture[] {
  const out: MorphCapture[] = []
  for (const plan of plans) {
    const src = resolve(plan.fromId)
    if (!src) continue
    const from = restingBox(src)
    if (!from) continue // display:none, or nothing measurable to fly
    out.push({ plan, node: freezeClone(src), from, restore: hide(src) })
  }
  return out
}

/**
 * Fly the captured copies onto the incoming scene's elements.
 *
 * `container` is the stage (position:fixed, inset:0) — the same coordinate origin every
 * scene root uses, which is what lets a cloned `.pa-el` keep its own inline left/top and
 * still land where it was, with no re-derived geometry. Each flight then rides a wrapper
 * whose transform-origin sits on the source's centre, so `translate(d) scale(s)` maps
 * that centre exactly onto the target's.
 *
 * Returns null when nothing can fly, so the caller can skip its bookkeeping entirely.
 */
export function launchMorphs(container: HTMLElement, captures: MorphCapture[], resolveTarget: (id: string) => HTMLElement | null | undefined): MorphRun | null {
  if (!captures.length) return null

  const layer = document.createElement('div')
  layer.style.cssText = `position:absolute;inset:0;z-index:${MORPH_LAYER_Z};pointer-events:none;overflow:hidden;`

  // Targets hidden for the flight, with a landing count each: several sources may
  // converge on one element, and it must stay hidden until the LAST of them arrives.
  const held = new Map<HTMLElement, { show: () => void; pending: number }>()
  const timers: number[] = []
  const started: MorphCapture[] = []
  let totalMs = 0

  for (const cap of captures) {
    const { plan, from } = cap
    const dst = resolveTarget(plan.toId)
    const to = dst ? restingBox(dst) : null
    if (!dst || !to) {
      cap.restore() // no landing pad — put the source back rather than blinking it out
      continue
    }
    started.push(cap)

    const hold = held.get(dst)
    if (hold) hold.pending++
    else held.set(dst, { show: hide(dst), pending: 1 })

    const [fitX, fitY] = morphScale(plan.scaleMode, from, to)
    const dur = plan.durationMs
    const delay = plan.delayMs
    totalMs = Math.max(totalMs, morphTotalMs(plan))

    // The source copy: identity → onto the target.
    const fly = wrap(from, cap.node)
    // Landing a touch over (or under) the target's size before the hand-off is the
    // `endScale` knob; the target itself always ends at its own authored size.
    setTransform(fly, to.cx - from.cx, to.cy - from.cy, fitX * plan.endScale, fitY * plan.endScale, dur, plan.easing, delay)
    layer.appendChild(fly)

    // The target copy, flying the same path backwards so the two are superimposed the
    // whole way. Only the blending effects need one — 'move' hands over at the landing
    // frame instead.
    let ghost: HTMLElement | null = null
    if (plan.effect !== 'move') {
      const [backX, backY] = morphScale(plan.scaleMode, to, from)
      ghost = wrap(to, freezeClone(dst))
      ghost.style.opacity = '0'
      // Start pose: sitting on the SOURCE's box, at the source's size. From there it
      // flies back to identity — its own resting place — as the source flies out to it.
      ghost.style.transform = pose(from.cx - to.cx, from.cy - to.cy, backX, backY)
      setTransform(ghost, 0, 0, 1, 1, dur, plan.easing, delay)
      layer.appendChild(ghost)
    }

    if (plan.effect === 'cross-fade') {
      // A linear pair over the whole flight keeps the combined opacity roughly constant;
      // eased curves dip in the middle and read as a flicker.
      fade(fly, 0, dur, delay, 'linear')
      if (ghost) fade(ghost, 1, dur, delay, 'linear')
    } else if (plan.effect === 'fade-through') {
      const outMs = Math.round(dur * THROUGH_SPLIT)
      fade(fly, 0, outMs, delay, 'linear')
      if (ghost) fade(ghost, 1, dur - outMs, delay + outMs, 'linear')
    }

    // Two frames before flipping: the first commits the start transform, the second
    // makes the change a transition rather than an initial style (same reason
    // applyTransition double-rAFs).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        commit(fly)
        if (ghost) commit(ghost)
      }),
    )

    timers.push(
      window.setTimeout(
        () => {
          fly.remove()
          ghost?.remove()
          const h = held.get(dst)
          if (h && --h.pending <= 0) {
            h.show()
            held.delete(dst)
          }
        },
        delay + dur + 40,
      ),
    )
  }

  if (!started.length) return null
  container.appendChild(layer)

  let done = false
  return {
    totalMs,
    finish() {
      if (done) return
      done = true
      timers.forEach((t) => window.clearTimeout(t))
      timers.length = 0
      held.forEach((h) => h.show())
      held.clear()
      layer.remove()
    },
    restoreSources() {
      started.forEach((c) => c.restore())
    },
  }
}

// ---- wrapper plumbing ------------------------------------------------------
// A flight rides a viewport-sized wrapper rather than the copy itself, so the copy
// keeps every inline style it was cloned with (its own anchor transform included) and
// the flight composes on top instead of fighting it. The wrapper always carries an
// EXPLICIT identity transform: going from `none` to a transform would change whether it
// is a containing block for a position:fixed copy (a parked immune bar), and the copy
// would jump on the first frame.

function wrap(origin: MorphBox, child: HTMLElement): HTMLElement {
  const w = document.createElement('div')
  w.style.cssText =
    `position:absolute;inset:0;transform-origin:${origin.cx}px ${origin.cy}px;` +
    'transform:translate(0px,0px) scale(1,1);will-change:transform,opacity;backface-visibility:hidden;'
  w.appendChild(child)
  return w
}

// The end state is stashed on the node and only written by commit(), so the start
// styles get a frame of their own first.
interface Pending {
  transform?: string
  opacity?: string
  transition: string[]
}
const pending = new WeakMap<HTMLElement, Pending>()
const slot = (n: HTMLElement): Pending => {
  const p = pending.get(n) ?? { transition: [] }
  pending.set(n, p)
  return p
}

const pose = (dx: number, dy: number, sx: number, sy: number): string => `translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px) scale(${sx.toFixed(4)},${sy.toFixed(4)})`

function setTransform(n: HTMLElement, dx: number, dy: number, sx: number, sy: number, ms: number, easing: string, delayMs: number): void {
  const t = pose(dx, dy, sx, sy)
  if (ms <= 0) {
    n.style.transform = t // a zero-length flight is just its end pose
    return
  }
  const p = slot(n)
  p.transform = t
  p.transition.push(`transform ${ms}ms ${easing} ${delayMs}ms`)
}

function fade(n: HTMLElement, to: number, ms: number, delayMs: number, easing: string): void {
  const p = slot(n)
  p.opacity = String(to)
  p.transition.push(`opacity ${Math.max(0, ms)}ms ${easing} ${delayMs}ms`)
}

function commit(n: HTMLElement): void {
  const p = pending.get(n)
  if (!p) return
  pending.delete(n)
  n.style.transition = p.transition.join(', ')
  if (p.transform != null) n.style.transform = p.transform
  if (p.opacity != null) n.style.opacity = p.opacity
}
