// Carousel: a horizontal row of choices the player swipes through, where the centre
// slot IS the selection — a choice eases up to `centerScale` as it arrives and back
// down as it leaves, so the enlargement alone marks the pick (deliberately no outline,
// frame or border).
//
// NOTHING IS AUTHORED INSIDE THE GAME BOX. Like combo.ts, the mount contributes one
// invisible thing — here the swipe surface — and every picture is an ordinary scene
// element the author tagged with `carouselRole`, discovered and claimed at mount:
//
//   choice  the thing being chosen. The row is however many of these are assigned.
//   label   optional, one per choice: what it is called. It rides with its own choice,
//           so a name can never end up under the wrong picture. A picture or a TEXT
//           element — and when it is text, the centred one is restyled rather than
//           merely scaled, so the selected choice can carry its own font, size, weight
//           and colour instead of a blown-up copy of the side ones.
//   reveal  optional, one per choice: the art elsewhere on screen that reacts to the
//           selection. Only the selected choice's is up, and they cross-fade.
//
// So art, size, crop, shape and animation are the element's own, and the game decides
// only WHERE things go and WHEN they are up.
//
// AUTHORED AGAINST THE CENTRE. Every element is placed where it belongs when its
// choice is the selected one. The offset it was placed at — measured from the row
// anchor, which is the first choice's own resting centre — is the relationship play
// preserves: in slot `d` the whole group is carried `d` steps sideways and scaled
// together, so a choice and its label travel as one object rather than two things that
// happen to agree.
//
// MOTION — everything runs off one rAF loop over a single float `pos` (the carousel's
// position in choice units). Dragging writes `pos` directly; releasing projects the
// flick velocity forward, rounds to the choice it would land on, and hands that to a
// CRITICALLY DAMPED spring (c = 2√k), which glides in and stops dead without the
// overshoot-wobble a CSS transition-per-step gives. Because the spring keeps the
// release velocity, a flick and its settle are one continuous motion rather than a
// fling followed by a snap. With `loop` on, `pos` is never clamped and each choice's
// offset is taken modulo the count, so the row rotates forever in either direction;
// with it off the ends rubber-band.
//
// Because the row is made of scene elements, nothing clips it: an element is taken off
// screen by `span` (see layout) rather than by the mount's overflow, and that is also
// what keeps the loop's wrap-around out of sight.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

/** Hidden without touching inline display/opacity, both of which layoutRec rewrites on
 * every layout pass. Exported so stage.ts can start a tagged element hidden at build
 * time, before play begins. Mirrors combo's COMBO_OFF_CLASS. */
export const CAROUSEL_OFF_CLASS = 'pa-carousel-off'

// Spring pulling `pos` to the settled choice. Critically damped, so it never
// overshoots — a carousel that bounces past the choice reads as sloppy.
const STIFFNESS = 110
const DAMPING = 2 * Math.sqrt(STIFFNESS)
// How far ahead a release's velocity is projected when choosing the landing choice,
// and the most choices that projection may carry it. Without the cap a hard fling on a
// fast screen throws the row most of the way round, and the player loses track of
// which choice they were on.
const FLICK_PROJECT_S = 0.14
const MAX_FLICK_CARRY = 3

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i

function channels(color: string): [number, number, number] | null {
  const hex = HEX.exec(color.trim())
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  // The browser hands back rgb() when a colour is read off a live element, which is
  // exactly where a label's authored colour comes from.
  const rgb = RGB.exec(color)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

/** Blend two colours. Anything unparseable (named, a gradient) hard-switches. */
function mix(a: string, b: string, t: number): string {
  const A = channels(a)
  const B = channels(b)
  if (!A || !B) return t < 0.5 ? a : b
  const ch = A.map((v, i) => Math.round(v + (B[i] - v) * t))
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const smooth = (t: number): number => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/**
 * Where to hang a scale so it grows a scene element ABOUT ITS VISIBLE CENTRE.
 *
 * The outer .pa-el is positioned by layoutRec with `transform: translate(tx%,ty%)`,
 * and the CSS `scale` property composes AFTER that about the centre of the box BEFORE
 * that positional shift — so scaling the outer slides the element instead of swelling
 * it in place. The inner .pa-el-anim fills the box and carries no positional
 * transform, so its origin already IS the visible centre. Same reasoning as combo's
 * scaleNode(), and it leaves the outer box measurable at natural size, which is what
 * the slot maths wants.
 */
function scaleNode(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>('.pa-el-anim') ?? el
}

/** Shortest signed distance across a ring of `n` slots, in (-n/2, n/2]. */
export function wrapDelta(d: number, n: number): number {
  if (n <= 0) return d
  let x = ((d % n) + n) % n
  if (x > n / 2) x -= n
  return x
}

/** Which choice a release lands on: where the flick carries it, rounded. */
export function landingIndex(pos: number, vel: number): number {
  return Math.round(pos + clamp(vel * FLICK_PROJECT_S, -MAX_FLICK_CARRY, MAX_FLICK_CARRY))
}

type Role = 'choice' | 'label' | 'reveal'

/** One tagged scene element. The game moves it, scales it and decides when it is up;
 * the element keeps everything else about itself. */
interface RoleEl {
  el: HTMLElement
  role: Role
  /** 0-based, matched to a slot in the row. */
  choice: number
  /** Whether the author left it visible on the editor canvas, so destroy() can put the
   * canvas back exactly as it found it. */
  canvasShown: boolean
  /** Resting centre with our transform cleared — re-sampled on every relayout, since
   * layoutRec repositions the element whenever the viewport changes. */
  home: Pt
  /** Where the author placed it relative to the row anchor. This is the relationship
   * play preserves in every slot. */
  offset: Pt
  /** Half the element's own width, for deciding when it is safely off screen. */
  halfW: number
  /** Inline values we overwrite, handed back on destroy. */
  restTranslate: string
  restTransition: string
  restScale: string
  restFilter: string
  restOpacity: string
  /** Bumped on every show, so a fade-out scheduled for an earlier selection can't park
   * a reveal that has since come back up. */
  seq: number
  /** A text label's inner node, when this element is text rather than a picture. Its
   * font styling is what gets restyled at the centre. */
  textInner: HTMLElement | null
  /** The element's OWN authored type, sampled once in design px so a resize can't make
   * a driven value the new baseline. This is the side-slot state. */
  baseSizeDesign: number
  baseWeight: number
  baseColor: string
  baseFamily: string
}

export function createCarousel(): GameModule {
  let ctx: GameContext
  let loop = true
  let live = true
  let changesToWin = 3
  let stepPct = 28
  let centerScale = 1.45
  let sideScale = 1
  let centerDX = 0 // centre-slot nudge, design px
  let centerDY = 0
  let sideOpacity = 1
  let labelDX = 0 // label nudge in EVERY slot, design px
  let labelDY = 0
  let labelCenterDX = 0 // label nudge once its choice is centred
  let labelCenterDY = 0
  let labelCenterScale = 1
  // Centre-only type overrides for a TEXT label. Empty / 0 means "keep the element's
  // own", so an author who only wants one of them sets only that one.
  let labelCenterFamily = ''
  let labelCenterSize = 0
  let labelCenterWeight = 0
  let labelCenterColor = ''
  let revealFadeMs = 220

  /** Everything claimed, including tags this game could not use, so destroy() releases
   * the lot. */
  const claimed: HTMLElement[] = []
  const choices: RoleEl[] = []
  const labels: RoleEl[] = []
  const reveals: RoleEl[] = []
  const timers: number[] = []
  let count = 0
  /** The row's centre, in screen px: the first choice's own resting centre. Every
   * offset is measured from here. */
  let anchor: Pt = { x: 0, y: 0 }
  let step = 100
  let span = 3

  // Motion state. `pos` is in choice units; `target` is the choice it settles on.
  let pos = 0
  let vel = 0
  let target = 0
  let dragging = false
  let raf = 0
  let lastFrame = -1
  // Pointer samples for the release velocity (two are enough and stay jitter-free).
  let dragId = -1
  let dragStartX = 0
  let dragStartPos = 0
  let moved = 0
  let sampleX = 0
  let sampleT = 0
  let prevSampleX = 0
  let prevSampleT = 0

  let shownReveal = -1
  let settledIdx = 0 // what is at the centre right now (drives the pass-by tick)
  let lastSettled = 0 // what it came to rest on last, so only real changes count
  let changes = 0
  let started = false
  let done = false
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null

  const sc = (): number => ctx.scale?.() ?? 1
  const after = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms))
  }
  const show = (el: HTMLElement): void => el.classList.remove(CAROUSEL_OFF_CLASS)
  const hide = (el: HTMLElement): void => el.classList.add(CAROUSEL_OFF_CLASS)

  /** `pos` (or any slot number) folded back onto a real choice index. */
  const idxOf = (p: number): number => {
    const r = Math.round(p)
    return count > 0 ? ((r % count) + count) % count : 0
  }

  // ---- element discovery ----------------------------------------------------
  // Mirrors combo.ts: walk the stage for tagged elements, honour an explicit game id,
  // and claim anything unaddressed first-come so two carousels in one scene can't
  // fight over the same element.
  const collect = (): void => {
    const stageRoot = ctx.root.closest('.pa-root')
    if (!stageRoot) return
    for (const el of Array.from(stageRoot.querySelectorAll<HTMLElement>('[data-carousel-role]'))) {
      const wanted = el.dataset.carouselGameId
      if (wanted ? wanted !== ctx.elementId : !!el.dataset.carouselClaimedBy) continue
      el.dataset.carouselClaimedBy = ctx.elementId ?? 'carousel'
      claimed.push(el)
      const role = el.dataset.carouselRole as Role
      if (role !== 'choice' && role !== 'label' && role !== 'reveal') continue
      const choice = Math.round(Number(el.dataset.carouselChoice) || 1) - 1
      if (choice < 0) continue
      const rec: RoleEl = {
        el,
        role,
        choice,
        canvasShown: el.dataset.carouselCanvasShow === '1',
        home: { x: 0, y: 0 },
        offset: { x: 0, y: 0 },
        halfW: 0,
        restTranslate: '',
        restTransition: '',
        restScale: '',
        restFilter: '',
        restOpacity: '',
        seq: 0,
        textInner: null,
        baseSizeDesign: 0,
        baseWeight: 400,
        baseColor: '',
        baseFamily: '',
      }
      if (role === 'choice') choices.push(rec)
      else if (role === 'label') labels.push(rec)
      else reveals.push(rec)
    }
    // The row is however many choices are wired up — the count is not a number the
    // author keeps in step by hand.
    choices.sort((a, b) => a.choice - b.choice)
    count = choices.length ? Math.max(...choices.map((c) => c.choice)) + 1 : 0
  }

  const moving = (): RoleEl[] => [...choices, ...labels]

  /** Re-read where layoutRec has put every element with our transform cleared, and take
   * the row anchor and each offset from that. Runs at start and on every relayout,
   * because a resize moves the elements out from under a stale sample — and because
   * offsets are in screen px, re-measuring is also what rescales them. */
  const resample = (): void => {
    const all = moving()
    if (!all.length) return
    for (const r of all) {
      r.el.style.transition = ''
      r.el.style.translate = ''
    }
    // Writes above, reads below: one reflow for the batch rather than one per element.
    const first = choices[0]
    anchor = first ? center(first.el) : { x: 0, y: 0 }
    for (const r of all) {
      const box = r.el.getBoundingClientRect()
      r.home = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      r.offset = { x: r.home.x - anchor.x, y: r.home.y - anchor.y }
      r.halfW = box.width / 2
    }
    layout()
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    step = Math.max(8, (w * stepPct) / 100)
    // Draw only what can reach the screen. Nothing clips a scene element, so this is
    // also what keeps the loop's wrap-around — where an offset flips sign at half the
    // ring and the element teleports to the other end — out of sight.
    const stageRoot = ctx.root.closest<HTMLElement>('.pa-root')
    const view = stageRoot?.getBoundingClientRect()
    const widest = choices.reduce((m, c) => Math.max(m, c.halfW), 0)
    const reach = view ? Math.max(anchor.x - view.left, view.right - anchor.x) : (ctx.root.clientWidth || 300) / 2
    span = (reach + widest * Math.max(sideScale, centerScale)) / step + 0.02
  }

  // ---- reveals --------------------------------------------------------------
  // One per choice, up only while that choice is selected. The resting inline opacity
  // is captured and put back afterwards: layoutRec owns that property (it writes the
  // element's authored opacity on every layout pass), so clearing it outright would
  // silently promote a half-transparent reveal to solid. Same care combo takes in
  // fadeInLayer.
  const showReveal = (i: number): void => {
    if (i === shownReveal) return
    shownReveal = i
    for (const r of reveals) {
      const wanted = r.choice === i
      const up = !r.el.classList.contains(CAROUSEL_OFF_CLASS)
      if (wanted === up) continue
      r.seq++
      const seq = r.seq
      if (revealFadeMs <= 0) {
        r.el.style.opacity = r.restOpacity
        if (wanted) show(r.el)
        else hide(r.el)
        continue
      }
      if (wanted) {
        r.el.style.transition = ''
        r.el.style.opacity = '0'
        show(r.el)
        // Flush the 0 so there is a value to animate FROM; without it the class removal
        // and the 0 -> 1 change collapse into one style recalc and no transition runs.
        void r.el.offsetWidth
        r.el.style.transition = `opacity ${revealFadeMs}ms linear`
        r.el.style.opacity = r.restOpacity || '1'
      } else {
        r.el.style.transition = `opacity ${revealFadeMs}ms linear`
        r.el.style.opacity = '0'
        after(revealFadeMs, () => {
          if (r.seq !== seq) return
          hide(r.el)
          r.el.style.transition = ''
          r.el.style.opacity = r.restOpacity
        })
      }
    }
  }

  // ---- the row --------------------------------------------------------------
  /** Put one element where its choice is now. `t` is 0 in a side slot and 1 dead
   * centre; `k` shrinks the authored relationship along with the choice, which is what
   * keeps a choice and its label reading as one object. */
  const place = (r: RoleEl, d: number, t: number, k: number): void => {
    const s = sc()
    const isLabel = r.role === 'label'
    const x = anchor.x + d * step + r.offset.x * k + centerDX * s * t + (isLabel ? lerp(labelDX, labelCenterDX, t) * s : 0)
    const y = anchor.y + r.offset.y * k + centerDY * s * t + (isLabel ? lerp(labelDY, labelCenterDY, t) * s : 0)
    r.el.style.translate = `${x - r.home.x}px ${y - r.home.y}px`
    // A text label with a centre SIZE set grows by restyling rather than by scaling, so
    // the selected one is set in real type instead of being a blown-up copy of a side
    // one. Everything else — pictures, and text with no size override — scales.
    const restyled = isLabel && r.textInner ? styleText(r, t) : false
    scaleNode(r.el).style.scale = String(restyled ? 1 : isLabel ? k * lerp(1, labelCenterScale, t) : k)
    if (sideOpacity < 1) {
      const o = sideOpacity + (1 - sideOpacity) * t
      r.el.style.filter = [r.restFilter, `opacity(${o})`].filter(Boolean).join(' ')
    }
  }

  /**
   * Restyle a TEXT label between its own type (side slots) and the centre overrides.
   *
   * The element's own type is the SIDE state and the overrides are the CENTRE state.
   * Size and weight interpolate numerically and colour is mixed, so the change rides
   * the same easing everything else does. A font FAMILY cannot be interpolated, so it
   * swaps at the halfway point — by which time the label is already visibly on its way
   * in or out, which is where a swap reads as intended rather than as a glitch.
   *
   * Returns whether it took over sizing: when a centre size is set the label must NOT
   * also be scaled, or the two multiply.
   */
  const styleText = (r: RoleEl, t: number): boolean => {
    const inner = r.textInner!
    const s = sc()
    const sized = labelCenterSize > 0
    if (sized) {
      // The element's OWN type is the side-slot state, at the size it was authored —
      // not that size shrunk. With a centre size set the author is stating both ends
      // outright, and the type they set on the element is the one they want to read in
      // the side slots.
      inner.style.fontSize = lerp(r.baseSizeDesign, labelCenterSize, t) * s + 'px'
    }
    if (labelCenterWeight > 0) inner.style.fontWeight = String(Math.round(lerp(r.baseWeight, labelCenterWeight, t)))
    if (labelCenterColor) inner.style.color = mix(r.baseColor, labelCenterColor, t)
    if (labelCenterFamily) inner.style.fontFamily = t > 0.5 ? labelCenterFamily : r.baseFamily
    return sized
  }

  const render = (): void => {
    // Nothing to drive until play has taken the elements over: mount() also runs on the
    // STATIC EDITOR CANVAS, where an element yanked to its slot would fight the author
    // positioning it.
    if (!started || !count) return
    for (const r of moving()) {
      const d = loop ? wrapDelta(r.choice - pos, count) : r.choice - pos
      const ad = Math.abs(d)
      if (ad > span) {
        hide(r.el)
        continue
      }
      show(r.el)
      const t = smooth(clamp(1 - ad, 0, 1))
      place(r, d, t, centerScale > 0 ? lerp(sideScale, centerScale, t) / centerScale : 1)
    }
  }

  /** The centre choice changed mid-swipe: tick, and (when live) swap the reveal. */
  const passCentre = (): void => {
    const i = idxOf(pos)
    if (i === settledIdx && shownReveal === i) return
    if (i !== settledIdx) ctx.sfx.play('tap')
    settledIdx = i
    if (live) showReveal(i)
  }

  const settle = (): void => {
    const i = idxOf(pos)
    showReveal(i)
    if (i === lastSettled) return // released without moving on — not a change
    lastSettled = i
    if (done || changesToWin <= 0) return
    changes++
    if (changes < changesToWin) return
    done = true
    winCb?.()
    ctx.sfx.play('gameWin')
    completeCb?.()
  }

  const tick = (now: number): void => {
    const dt = lastFrame < 0 ? 1 / 60 : Math.min(0.032, (now - lastFrame) / 1000)
    lastFrame = now
    if (!dragging) {
      vel += (-STIFFNESS * (pos - target) - DAMPING * vel) * dt
      pos += vel * dt
      if (Math.abs(pos - target) < 0.0008 && Math.abs(vel) < 0.01) {
        pos = target
        vel = 0
        lastFrame = -1
        raf = 0
        render()
        passCentre()
        settle()
        return
      }
    }
    if (idxOf(pos) !== settledIdx) passCentre()
    render()
    raf = requestAnimationFrame(tick)
  }

  const run = (): void => {
    if (!raf) {
      lastFrame = -1
      raf = requestAnimationFrame(tick)
    }
  }

  /** Aim at a slot number (may sit outside 0..count-1 when looping — that is what lets
   * the row keep turning the short way instead of unwinding). */
  const goTo = (slot: number): void => {
    target = loop ? slot : clamp(slot, 0, count - 1)
    run()
  }

  const onDown = (e: PointerEvent): void => {
    if (!count || (done && changesToWin > 0)) return
    dragId = e.pointerId
    dragging = true
    moved = 0
    dragStartX = e.clientX
    dragStartPos = pos
    vel = 0
    prevSampleX = sampleX = e.clientX
    prevSampleT = sampleT = e.timeStamp
    ctx.root.setPointerCapture?.(e.pointerId)
    run()
  }

  const onMove = (e: PointerEvent): void => {
    if (!dragging || e.pointerId !== dragId) return
    e.preventDefault()
    const dx = e.clientX - dragStartX
    moved = Math.max(moved, Math.abs(dx))
    const raw = dragStartPos - dx / step
    // Off the ends (no loop): let it stretch, at a third of the finger's travel.
    if (!loop && raw < 0) pos = raw * 0.35
    else if (!loop && raw > count - 1) pos = count - 1 + (raw - (count - 1)) * 0.35
    else pos = raw
    prevSampleX = sampleX
    prevSampleT = sampleT
    sampleX = e.clientX
    sampleT = e.timeStamp
  }

  const onUp = (e: PointerEvent): void => {
    if (!dragging || e.pointerId !== dragId) return
    dragging = false
    dragId = -1
    ctx.root.releasePointerCapture?.(e.pointerId)
    const dt = (sampleT - prevSampleT) / 1000
    // Finger px/s → choice units/s, sign-flipped: dragging left advances the row.
    vel = dt > 0.001 ? -(sampleX - prevSampleX) / dt / step : 0
    if (moved < 6) {
      // A tap, not a swipe: bring whichever choice was tapped to the centre.
      const hit = choices.find((c) => c.el.contains(e.target as Node))
      const base = Math.round(pos)
      goTo(hit ? base + (loop ? wrapDelta(hit.choice - base, count) : hit.choice - base) : base)
      vel = 0
    } else {
      goTo(landingIndex(pos, vel))
    }
  }

  return {
    mount(c, params) {
      ctx = c
      loop = params.loop !== false
      live = params.liveUpdate !== false
      changesToWin = Math.max(0, Math.round(num(params.changesToWin, 3)))
      stepPct = clamp(num(params.stepPct, 28), 2, 100)
      centerScale = clamp(num(params.centerScale, 1.45), 0.2, 3)
      sideScale = clamp(num(params.sideScale, 1), 0.2, 2)
      centerDX = clamp(num(params.centerOffsetX, 0), -2000, 2000)
      centerDY = clamp(num(params.centerOffsetY, 0), -2000, 2000)
      sideOpacity = clamp(num(params.sideOpacityPct, 100), 0, 100) / 100
      labelDX = clamp(num(params.labelOffsetX, 0), -2000, 2000)
      labelDY = clamp(num(params.labelOffsetY, 0), -2000, 2000)
      labelCenterDX = clamp(num(params.labelCenterOffsetX, 0), -2000, 2000)
      labelCenterDY = clamp(num(params.labelCenterOffsetY, 0), -2000, 2000)
      labelCenterScale = clamp(num(params.labelCenterScale, 1), 0.2, 4)
      labelCenterFamily = typeof params.labelCenterFontFamily === 'string' ? params.labelCenterFontFamily.trim() : ''
      labelCenterSize = clamp(num(params.labelCenterFontSizePx, 0), 0, 600)
      labelCenterWeight = clamp(num(params.labelCenterFontWeight, 0), 0, 900)
      labelCenterColor = typeof params.labelCenterFontColor === 'string' ? params.labelCenterFontColor.trim() : ''
      revealFadeMs = clamp(num(params.revealFadeMs, 220), 0, 3000)

      ctx.root.style.touchAction = 'none'
      // Claim the tagged elements here, but drive nothing yet: mount() also runs on the
      // static editor canvas, where the author is still positioning them. start()
      // (interactive only) is what takes them over.
      collect()
      const start = Math.round(num(params.startIndex, -1))
      pos = target = settledIdx = lastSettled = start >= 0 && start < count ? start : Math.floor(count / 2)
    },
    start() {
      if (started) return
      started = true
      for (const r of [...choices, ...labels, ...reveals]) {
        r.restTranslate = r.el.style.translate
        r.restTransition = r.el.style.transition
        r.restScale = scaleNode(r.el).style.scale
        r.restFilter = r.el.style.filter
        r.restOpacity = r.el.style.opacity
      }
      // A text label's own type is its SIDE-SLOT state. Read it once, here, before a
      // frame has been driven — and in design px, so a resize can never promote a
      // driven value to the new baseline. layoutRec rewrites these on every layout
      // pass, which is exactly why they are re-applied per frame rather than once.
      for (const r of labels) {
        const inner = r.el.querySelector<HTMLElement>('.pa-text-inner')
        if (!inner) continue
        r.textInner = inner
        r.baseSizeDesign = (parseFloat(inner.style.fontSize) || 0) / (sc() || 1)
        r.baseWeight = Number(inner.style.fontWeight) || 400
        r.baseColor = inner.style.color || '#ffffff'
        r.baseFamily = inner.style.fontFamily || ''
      }
      // Whatever the author left hidden while positioning, play owns visibility now.
      for (const r of moving()) show(r.el)
      for (const r of reveals) hide(r.el)
      started = true
      resample()
      render()
      if (!count) {
        // Nothing is wired up at all — win rather than stranding the player on a row
        // that can never be swiped, the way an empty combo board does. Deferred by a
        // tick because the host registers onComplete AFTER calling start(), so firing
        // it here and now would be shouting into an empty room.
        if (changesToWin > 0) {
          done = true
          after(0, () => {
            winCb?.()
            completeCb?.()
          })
        }
        return
      }
      showReveal(settledIdx)
      ctx.root.style.cursor = 'grab'
      ctx.root.addEventListener('pointerdown', onDown)
      ctx.root.addEventListener('pointermove', onMove)
      ctx.root.addEventListener('pointerup', onUp)
      ctx.root.addEventListener('pointercancel', onUp)
    },
    relayout() {
      // resample() re-derives the anchor and every offset, then lays out — the row's
      // whole geometry hangs off element boxes that have just moved.
      if (started) {
        resample()
        render()
      } else {
        layout()
      }
    },
    getHint(): HintMove | null {
      if (!count || (done && changesToWin > 0)) return null
      const r = ctx.root.getBoundingClientRect()
      const y = r.top + r.height / 2
      const reach = Math.min(r.width * 0.3, step * 1.2)
      return { from: { x: r.left + r.width / 2 + reach, y }, to: { x: r.left + r.width / 2 - reach, y }, kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      for (const t of timers) window.clearTimeout(t)
      timers.length = 0
      ctx.root.removeEventListener('pointerdown', onDown)
      ctx.root.removeEventListener('pointermove', onMove)
      ctx.root.removeEventListener('pointerup', onUp)
      ctx.root.removeEventListener('pointercancel', onUp)
      for (const r of [...choices, ...labels, ...reveals]) {
        r.el.style.transition = r.restTransition
        r.el.style.translate = r.restTranslate
        r.el.style.filter = r.restFilter
        r.el.style.opacity = r.restOpacity
        scaleNode(r.el).style.scale = r.restScale
        if (r.textInner) {
          // layoutRec owns these; clearing them lets the next layout pass write the
          // element's own authored type back.
          r.textInner.style.fontSize = ''
          r.textInner.style.fontWeight = ''
          r.textInner.style.color = ''
          r.textInner.style.fontFamily = ''
        }
        // Put the canvas back exactly as it was found: an element the author had shown
        // stays shown, one they had hidden stays hidden.
        if (r.canvasShown) show(r.el)
        else hide(r.el)
      }
      for (const el of claimed) delete el.dataset.carouselClaimedBy
      choices.length = 0
      labels.length = 0
      reveals.length = 0
      claimed.length = 0
      count = 0
      shownReveal = -1
      changes = 0
      done = false
      started = false
      ctx.root.innerHTML = ''
    },
  }
}

export const CAROUSEL_TEMPLATE: GameTemplate = {
  id: 'carousel',
  label: 'Carousel (swipe to choose)',
  paramFields: [
    // 'choices' is editor-only — the number of assignment rows the setup panel offers.
    // The game itself counts whatever elements are tagged, exactly as combo does, so
    // raising it costs nothing until the rows are filled.
    { key: 'choices', label: 'Choice slots', type: 'number', min: 1, max: 24, step: 1 },
    { key: 'changesToWin', label: 'Changes before it counts as won (0 = never, the CTA ends it)', type: 'number', min: 0, max: 12, step: 1 },
    { key: 'loop', label: 'Loop around forever', type: 'boolean' },
    { key: 'startIndex', label: 'Starting choice (0-based, -1 = middle)', type: 'number', min: -1, max: 23, step: 1 },
    { key: 'liveUpdate', label: 'Swap the reveal while swiping', type: 'boolean' },
    { key: 'revealFadeMs', label: 'Reveal cross-fade (ms)', type: 'number', min: 0, max: 3000, step: 20 },
    // --- every slot ---
    { key: 'stepPct', label: 'Spacing per slot (% of the game width)', type: 'number', min: 2, max: 100, step: 1 },
    { key: 'sideScale', label: 'Side choices size (×)', type: 'number', min: 0.2, max: 2, step: 0.05 },
    { key: 'sideOpacityPct', label: 'Side choices opacity (%)', type: 'number', min: 0, max: 100, step: 5 },
    // --- the centre slot only ---
    { key: 'centerScale', label: 'CENTRE choice size (× — this is the whole selection cue)', type: 'number', min: 0.2, max: 3, step: 0.05 },
    { key: 'centerOffsetX', label: 'CENTRE choice nudge X (design px)', type: 'number', min: -2000, max: 2000, step: 1 },
    { key: 'centerOffsetY', label: 'CENTRE choice nudge Y (design px, − is up)', type: 'number', min: -2000, max: 2000, step: 1 },
    // --- labels ---
    { key: 'labelOffsetX', label: 'Label nudge X, every slot (design px)', type: 'number', min: -2000, max: 2000, step: 1 },
    { key: 'labelOffsetY', label: 'Label nudge Y, every slot (design px, − is up)', type: 'number', min: -2000, max: 2000, step: 1 },
    { key: 'labelCenterOffsetX', label: 'CENTRE label nudge X (design px)', type: 'number', min: -2000, max: 2000, step: 1 },
    { key: 'labelCenterOffsetY', label: 'CENTRE label nudge Y (design px, − is up)', type: 'number', min: -2000, max: 2000, step: 1 },
    { key: 'labelCenterScale', label: 'CENTRE label size (× — for picture labels)', type: 'number', min: 0.2, max: 4, step: 0.05 },
    // --- text labels: the centre is set in its own type, not a scaled copy ---
    { key: 'labelCenterFontSizePx', label: 'CENTRE label font size (design px, 0 = just scale it)', type: 'number', min: 0, max: 600, step: 1 },
    { key: 'labelCenterFontFamily', label: 'CENTRE label font (family or uploaded font id, blank = keep)', type: 'text' },
    { key: 'labelCenterFontWeight', label: 'CENTRE label weight (0 = keep)', type: 'number', min: 0, max: 900, step: 100 },
    { key: 'labelCenterFontColor', label: 'CENTRE label colour (blank = keep)', type: 'color' },
  ],
  defaultParams: {
    choices: 5,
    changesToWin: 3,
    loop: true,
    startIndex: -1,
    liveUpdate: true,
    revealFadeMs: 220,
    stepPct: 28,
    sideScale: 1,
    sideOpacityPct: 100,
    centerScale: 1.45,
    centerOffsetX: 0,
    centerOffsetY: 0,
    labelOffsetX: 0,
    labelOffsetY: 0,
    labelCenterOffsetX: 0,
    labelCenterOffsetY: 0,
    labelCenterScale: 1,
    labelCenterFontSizePx: 0,
    labelCenterFontFamily: '',
    labelCenterFontWeight: 0,
    labelCenterFontColor: '',
  },
  // Swipe right→left across the centred row.
  defaultHandguide: {
    nodes: [
      { x: 0.7, y: 0.5 },
      { x: 0.3, y: 0.5 },
    ],
    periodMs: 1700,
  },
  create: createCarousel,
}
