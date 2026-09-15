// Swipe cards: a pile of the author's own placed elements, swiped left or right one at
// a time — the "swipe your style" board.
//
// Same model as the rest of this family (combo, tap to reveal): the mount contributes
// NO visuals. Every card is an ordinary scene element the author placed, sized, rotated
// and cropped on the canvas, then tagged from the game's panel with a `swipeRole`:
//
//   card    one card of the pile, with an `index` that is its place in the play order
//           (1 = the first one up). Where the author put each card is its RESTING slot,
//           so a fanned, tilted pile is arranged by eye rather than by numbers.
//   result  an image that is replaced by the FIRST card swiped right on. It can sit on
//           any scene — usually the end card — because the pick travels over the swipe
//           result channel (swipechannel.ts) rather than through this game. Stage.ts is
//           what applies it; nothing here touches the result element.
//   like    a MARK that fades in on a card while it is dragged right — a heart in its
//   nope    top-left corner, say — and its mirror for a drag left. The author places the
//           mark over ANY card on the canvas, exactly where it should sit on that card;
//           at play the element itself is hidden and a copy of it is put INSIDE every
//           card at the same spot, relative to the card's own box. Being inside, it
//           tilts, scales and flies off with the card with no maths per frame. Any number
//           of each, so a mark can be a badge plus a glow.
//   yes     BUTTONS that swipe the top card for the player: yes throws it right, no
//   no      throws it left. The card leans toward that side for a beat — its mark coming
//           up — before it goes, so a tap reads as the card being swiped rather than
//           vanishing. Everything after that is the ordinary swipe: marks, progress,
//           the result pick and the swipe events.
//
// Two ways to show the pile (`display`):
//   'stack' every card is visible, so the player sees how many are left.
//   'one'   only the card on top is; the next one fades up as each is swiped away.
//
// And two ways for the pile to close up after a swipe (`advance`):
//   'moveUp' each remaining card slides, turns and scales into the slot of the card
//            ahead of it, so the pile keeps its authored shape as it shrinks. While the
//            top card is being dragged the next one already leans toward its new slot,
//            in proportion to how close the drag is to committing.
//   'stay'   every card stays exactly where it was placed.
//
// Everything a drag moves is written as the individual `translate` / `rotate` / `scale`
// properties, never `transform`: layoutRec owns the outer node's transform (its anchor
// translate and authored rotation) and rewrites it on every layout pass. Position rides
// the OUTER node's `translate`, which composes as a pure screen shift on top of it;
// rotation and scale ride the inner .pa-el-anim, whose origin is the visible centre
// (see scaleNode in combo.ts for why the outer one is the wrong place to scale).
//
// Won when every card has been swiped, or earlier via `winSwipes`. Every swipe is one
// step on the progress channel. Three beats are broadcast through the SFX channel, which
// stage.ts fans out to every scene element as an animation phase and a sound binding:
// 'swipeLike' (a card went right), 'swipeNope' (it went left) and 'swipeNext' (the next
// card is up).

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num, str } from './types'
import { COMBO_OFF_CLASS } from './combo'
import { emitProgress, onProgressRequest } from './progresschannel'
import { writeSwipeResult, type SwipeResultFit } from './swipechannel'

/** Hidden by class, not inline style — layoutRec rewrites inline opacity every pass. */
const OFF_CLASS = COMBO_OFF_CLASS

/** A card's resting geometry, measured with none of this game's offsets applied. */
interface Slot {
  /** Visible centre, screen px. */
  cx: number
  cy: number
  /** Untransformed box width, screen px. */
  w: number
  /** Untransformed box height, screen px. */
  h: number
  /** Authored rotation, degrees. */
  rot: number
}

interface Card {
  el: HTMLElement
  /** Play order, 1-based. */
  index: number
  slot: Slot
  gone: boolean
  restOpacity: string
  homePointer: string
  /** This card's copies of the marks, index-aligned with `marks`. */
  stamps: HTMLElement[]
  /** The inline position its inner node had before stamps needed it positioned. */
  hostPosition: string
}

/** A like / nope mark as the author placed it. Never shown in play — only copied. */
interface Mark {
  el: HTMLElement
  kind: 'like' | 'nope'
  canvasShown: boolean
}

/** A Yes / No button. */
interface SwipeButton {
  el: HTMLElement
  dir: 1 | -1
  homePointer: string
  off: (() => void) | null
}

/** Where a card currently sits relative to its own slot. */
interface Pose {
  dx: number
  dy: number
  rot: number
  scale: number
}

const REST: Pose = { dx: 0, dy: 0, rot: 0, scale: 1 }

function scaleNode(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>('.pa-el-anim') ?? el
}

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** The authored rotation layoutRec wrote into the outer transform, in degrees. */
function authoredRotation(el: HTMLElement): number {
  const m = /rotate\((-?[\d.]+)deg\)/.exec(el.style.transform)
  return m ? Number(m[1]) : 0
}

export function createSwipeCards(): GameModule {
  let ctx: GameContext

  let display: 'stack' | 'one' = 'stack'
  let advance: 'moveUp' | 'stay' = 'moveUp'
  /** How far a card has to travel to count, as a share of its width. */
  let thresholdPct = 28
  /** Tilt at one card-width of travel, degrees. */
  let tiltDeg = 12
  /** How much a held card grows. 1 = none. */
  let liftScale = 1.03
  let flingMs = 420
  let returnMs = 380
  let settleMs = 340
  let revealMs = 280
  /** A quick flick commits even short of the threshold. px/ms; 0 = distance only. */
  let flickSpeed = 0.5
  let winSwipes = 0
  let hintDir: 1 | -1 = 1
  let resultFit: SwipeResultFit = 'contain'
  let progressGameId = ''
  /** The scale a mark grows in FROM as it fades up. 1 = a plain fade. */
  let markFrom = 1.2

  const cards: Card[] = []
  const marks: Mark[] = []
  const buttons: SwipeButton[] = []
  const timers: number[] = []
  let offRequest: (() => void) | null = null
  let endDrag: (() => void) | null = null

  let shell: HTMLElement | null = null
  let shellPointerEvents = ''
  let rootPointerEvents = ''

  let started = false
  let done = false
  /** Input is held off while the pile is settling after a swipe. */
  let busy = false
  let dragging = false
  /** A relayout that landed mid-drag is re-measured when the drag ends. */
  let staleSlots = false
  let liked = false
  let swiped = 0
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null

  const after = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms))
  }

  const remaining = (): Card[] => cards.filter((c) => !c.gone)
  const target = (): number => Math.max(1, winSwipes > 0 ? Math.min(winSwipes, cards.length || winSwipes) : cards.length)
  const top = (): Card | undefined => (done ? undefined : remaining()[0])

  const announce = (): void => {
    emitProgress(ctx.root, { gameId: ctx.elementId ?? '', value: swiped, total: target(), to: progressGameId })
  }

  /** Publish the card on top as `data-swipe-hint`, for a placed handguide in
   * 'swipecards' mode — it follows this marker down the pile by itself. */
  const markHint = (): void => {
    const live = busy ? undefined : top()
    for (const c of cards) {
      if (c === live) c.el.dataset.swipeHint = '1'
      else delete c.el.dataset.swipeHint
    }
  }

  // ---- geometry ------------------------------------------------------------
  /** Resting geometry, read with this game's own offsets briefly lifted. Only the
   * outer `translate` affects the outer box; rotate/scale live on the inner node. */
  const measure = (c: Card): void => {
    const el = c.el
    const translate = el.style.translate
    const transition = el.style.transition
    el.style.transition = ''
    el.style.translate = ''
    const p = center(el)
    el.style.translate = translate
    el.style.transition = transition
    c.slot = { cx: p.x, cy: p.y, w: parseFloat(el.style.width) || el.offsetWidth || 1, h: parseFloat(el.style.height) || el.offsetHeight || 1, rot: authoredRotation(el) }
  }

  /** The pose that puts `c` into the slot of the card originally at `position`
   * (0-based), or its own slot when the pile does not move up. */
  const slotPose = (c: Card, position: number): Pose => {
    if (advance === 'stay') return REST
    const s = cards[clamp(position, 0, cards.length - 1)]?.slot ?? c.slot
    return { dx: s.cx - c.slot.cx, dy: s.cy - c.slot.cy, rot: s.rot - c.slot.rot, scale: c.slot.w > 0 ? s.w / c.slot.w : 1 }
  }

  const mix = (a: Pose, b: Pose, t: number): Pose => ({ dx: lerp(a.dx, b.dx, t), dy: lerp(a.dy, b.dy, t), rot: lerp(a.rot, b.rot, t), scale: lerp(a.scale, b.scale, t) })

  const setPose = (c: Card, pose: Pose, ms: number, easing = 'cubic-bezier(.22,.8,.3,1)'): void => {
    const node = scaleNode(c.el)
    const t = ms > 0 ? `${ms}ms ${easing}` : ''
    c.el.style.transition = t ? `translate ${t}` : ''
    node.style.transition = t ? `rotate ${t}, scale ${t}` : ''
    c.el.style.translate = pose.dx || pose.dy ? `${pose.dx.toFixed(2)}px ${pose.dy.toFixed(2)}px` : ''
    node.style.rotate = pose.rot ? `${pose.rot.toFixed(3)}deg` : ''
    node.style.scale = pose.scale !== 1 ? pose.scale.toFixed(4) : ''
  }

  /** Lay every card still in the pile into its slot. `lean` (0..1) is how far the cards
   * behind the top one have already moved toward the slot ahead of them — the drag's
   * progress toward committing. */
  const layPile = (ms: number, lean = 0): void => {
    const rest = remaining()
    rest.forEach((c, k) => {
      if (k === 0) return
      const pose = lean > 0 ? mix(slotPose(c, k), slotPose(c, k - 1), lean) : slotPose(c, k)
      setPose(c, pose, ms)
    })
  }

  /**
   * Stack the cards in play order: card 1 on top.
   *
   * The pile reuses the z-indexes the author's cards ALREADY have, handed out again in
   * play order, so the pile stays exactly as high in the scene as it was arranged and
   * nothing else on the canvas is jumped over. Re-applied after every layout pass,
   * which writes each element's own z back.
   */
  const stackOrder = (): void => {
    const zs = cards.map((c) => Number(c.el.style.zIndex) || 0).sort((a, b) => b - a)
    cards.forEach((c, i) => (c.el.style.zIndex = String(zs[i] ?? 0)))
  }

  // ---- marks ---------------------------------------------------------------
  /**
   * Copy every mark into every card.
   *
   * The copy is the mark's own inner node — its picture, crop and any looping animation —
   * dropped into the card's inner node, which is exactly where this game writes the drag's
   * rotate and scale. So the mark rides the card for free: tilt, lift, fling and the
   * pile moving up all carry it, and there is nothing to keep in step per frame.
   */
  const buildStamps = (): void => {
    for (const m of marks) m.el.classList.add(OFF_CLASS)
    for (const c of cards) {
      const host = scaleNode(c.el)
      c.hostPosition = host.style.position
      if (!host.style.position) host.style.position = 'relative'
      for (const m of marks) {
        const stamp = scaleNode(m.el).cloneNode(true) as HTMLElement
        // Not an animation box of the CARD — scaleNode() looks for that class.
        stamp.classList.remove('pa-el-anim')
        stamp.dataset.swipeMark = m.kind
        stamp.style.position = 'absolute'
        stamp.style.pointerEvents = 'none'
        stamp.style.zIndex = '2'
        stamp.style.opacity = '0'
        stamp.style.transformOrigin = 'center center'
        host.appendChild(stamp)
        c.stamps.push(stamp)
      }
    }
    placeStamps()
  }

  /**
   * Lay each mark into the cards where the author put it — in the frame of the card it
   * was placed over, as percentages of that card's box, so a card of another size gets it
   * in the same corner at the same proportion. Rotation is relative to that card too: a
   * mark placed level on a tilted card stays level with the card's edges, not the screen.
   */
  const placeStamps = (): void => {
    marks.forEach((m, j) => {
      const r = m.el.getBoundingClientRect()
      const mx = r.left + r.width / 2
      const my = r.top + r.height / 2
      const mw = parseFloat(m.el.style.width) || r.width
      const mh = parseFloat(m.el.style.height) || r.height
      // The card it sits over is the one whose centre is nearest.
      let host = cards[0]
      for (const c of cards) if (Math.hypot(c.slot.cx - mx, c.slot.cy - my) < Math.hypot(host.slot.cx - mx, host.slot.cy - my)) host = c
      if (!host) return
      const s = host.slot
      const a = (s.rot * Math.PI) / 180
      const dx = mx - s.cx
      const dy = my - s.cy
      // Undo the card's rotation to land in its own, upright frame.
      const lx = dx * Math.cos(a) + dy * Math.sin(a)
      const ly = -dx * Math.sin(a) + dy * Math.cos(a)
      const left = ((s.w / 2 + lx - mw / 2) / s.w) * 100
      const topPct = ((s.h / 2 + ly - mh / 2) / s.h) * 100
      const rot = authoredRotation(m.el) - s.rot
      for (const c of cards) {
        const st = c.stamps[j]
        if (!st) continue
        st.style.left = left.toFixed(3) + '%'
        st.style.top = topPct.toFixed(3) + '%'
        st.style.width = ((mw / s.w) * 100).toFixed(3) + '%'
        st.style.height = ((mh / s.h) * 100).toFixed(3) + '%'
        st.style.rotate = rot ? rot.toFixed(3) + 'deg' : ''
      }
    })
  }

  /** Show a card's marks for a lean of -1..1 (left..right) — how far the drag is toward
   * committing, so a mark is fully up exactly when letting go would count. */
  const setStamps = (c: Card, lean: number, ms: number): void => {
    c.stamps.forEach((st, j) => {
      const m = marks[j]
      if (!m) return
      const v = clamp(m.kind === 'like' ? lean : -lean, 0, 1)
      const base = m.el.style.opacity === '' ? 1 : clamp(Number(m.el.style.opacity), 0, 1)
      st.style.transition = ms > 0 ? `opacity ${ms}ms ease, scale ${ms}ms ease` : ''
      st.style.opacity = (v * base).toFixed(3)
      st.style.scale = markFrom !== 1 ? lerp(markFrom, 1, v).toFixed(3) : ''
    })
  }

  // ---- play ----------------------------------------------------------------
  const finish = (): void => {
    if (done) return
    done = true
    markHint()
    ctx.sfx.play('gameWin')
    winCb?.()
    completeCb?.()
  }

  /** Bring the new top card up in a one-at-a-time pile. */
  const reveal = (c: Card): void => {
    const pose = slotPose(c, 0)
    if (revealMs <= 0) {
      setPose(c, pose, 0)
      c.el.classList.remove(OFF_CLASS)
      return
    }
    c.restOpacity = c.el.style.opacity
    setPose(c, { ...pose, scale: pose.scale * 0.92 }, 0)
    c.el.style.opacity = '0'
    c.el.classList.remove(OFF_CLASS)
    void c.el.offsetWidth
    setPose(c, pose, revealMs, 'cubic-bezier(.34,1.3,.5,1)')
    c.el.style.transition += `, opacity ${revealMs}ms ease`
    c.el.style.opacity = '1'
    after(revealMs, () => {
      c.el.style.opacity = c.restOpacity
      c.el.style.transition = ''
    })
  }

  /** The picture a liked card hands to the result: its own <img>, whatever it shows. */
  const srcOf = (c: Card): string => {
    const img = c.el.querySelector<HTMLImageElement>('img')
    return img?.currentSrc || img?.getAttribute('src') || ''
  }

  const park = (c: Card): void => {
    c.el.classList.add(OFF_CLASS)
    setPose(c, REST, 0)
    c.el.style.opacity = c.restOpacity
    c.el.style.pointerEvents = 'none'
  }

  /** Throw `c` off the side it was released toward, carrying the drag's momentum. */
  const swipe = (c: Card, dir: 1 | -1, from: Pose, vx: number, vy: number): void => {
    c.gone = true
    swiped++
    busy = true
    c.el.style.pointerEvents = 'none'
    markHint()

    // Off the stage entirely: the card's centre past the scene's edge by a whole
    // diagonal, so no corner of a tilted card is left peeking in.
    const stage = (ctx.root.closest('.pa-root') ?? document.body).getBoundingClientRect()
    const width = stage.width || window.innerWidth || 1080
    const diag = Math.hypot(c.slot.w, c.slot.w * 1.4)
    const edge = dir > 0 ? (stage.left || 0) + width : stage.left || 0
    const dx = edge + dir * diag - c.slot.cx
    const travel = Math.abs(dx - from.dx)
    // Fast flicks finish sooner than a slow drag let go past the line, so the card never
    // decelerates out of the player's hand.
    const speed = Math.abs(vx)
    const ms = Math.round(speed > 0.05 ? clamp(travel / speed, flingMs * 0.45, flingMs) : flingMs)
    const dy = from.dy + clamp(vy, -2, 2) * ms * 0.35
    setPose(c, { dx, dy, rot: from.rot + dir * tiltDeg * 1.6, scale: from.scale }, ms, 'cubic-bezier(.18,.72,.32,1)')
    // A late fade covers stages narrower than the viewport, where "off the edge" can
    // still be on screen.
    c.el.style.transition += `, opacity ${Math.round(ms * 0.4)}ms linear ${Math.round(ms * 0.6)}ms`
    c.el.style.opacity = '0'
    after(ms, () => park(c))

    ctx.sfx.play(dir > 0 ? 'swipeLike' : 'swipeNope')
    if (dir > 0 && !liked) {
      const src = srcOf(c)
      if (src) {
        liked = true
        writeSwipeResult(ctx.elementId ?? '', { src, fit: resultFit })
      }
    }
    announce()

    const next = remaining()[0]
    if (swiped >= target() || !next) {
      after(ms, finish)
      return
    }
    if (display === 'one') reveal(next)
    layPile(settleMs)
    if (display !== 'one') setPose(next, slotPose(next, 0), settleMs)
    // Fired once the next card is actually showing, so an authored 'swipeNext'
    // animation on it plays rather than running while it is still hidden.
    ctx.sfx.play('swipeNext')
    after(Math.min(settleMs, 220), () => {
      busy = false
      markHint()
    })
  }

  /** A Yes / No tap: lean the top card toward `dir` with its mark coming up, then throw
   * it exactly as a released drag would. `busy` goes up at once, so a double tap — or a
   * tap on the other button mid-lean — cannot swipe two cards or reverse this one. */
  const swipeByButton = (dir: 1 | -1): void => {
    const c = top()
    if (!c || busy || dragging) return
    busy = true
    markHint()
    const base = slotPose(c, 0)
    const lean: Pose = { dx: base.dx + dir * c.slot.w * 0.18, dy: base.dy - c.slot.h * 0.01, rot: base.rot + dir * tiltDeg * 0.5, scale: base.scale * liftScale }
    const ms = Math.round(clamp(flingMs * 0.4, 60, 220))
    setPose(c, lean, ms, 'cubic-bezier(.3,.7,.4,1)')
    setStamps(c, dir, ms)
    if (display !== 'one') layPile(ms, 0.6)
    // Thrown with some speed, so it leaves as briskly as a confident swipe would.
    after(ms, () => swipe(c, dir, lean, dir * 1.4, 0))
  }

  const attachButton = (b: SwipeButton): void => {
    b.el.style.pointerEvents = 'auto'
    b.el.style.cursor = 'pointer'
    b.el.style.touchAction = 'manipulation'
    b.el.style.setProperty('-webkit-touch-callout', 'none')
    b.el.style.setProperty('-webkit-tap-highlight-color', 'transparent')
    // pointerdown, like the tap boards: a beat faster than click, it survives the small
    // drag a real thumb makes, and it lands with the element's own on-tap animation.
    const onDown = (): void => swipeByButton(b.dir)
    b.el.addEventListener('pointerdown', onDown)
    b.off = () => b.el.removeEventListener('pointerdown', onDown)
  }

  // ---- dragging ------------------------------------------------------------
  const attach = (c: Card): void => {
    c.el.style.cursor = 'grab'
    c.el.style.touchAction = 'none'
    c.el.style.pointerEvents = 'auto'
    c.el.style.setProperty('-webkit-touch-callout', 'none')
    c.el.style.setProperty('-webkit-tap-highlight-color', 'transparent')
    c.el.addEventListener('pointerdown', (event) => {
      if (done || busy || dragging || c.gone || top() !== c) return
      event.preventDefault()
      const pid = event.pointerId
      dragging = true
      try {
        c.el.setPointerCapture?.(pid)
      } catch {
        // Best effort, exactly as in combo.ts: the listeners sit on window regardless.
      }
      const base = slotPose(c, 0)
      const w = c.slot.w || 1
      const sx = event.clientX
      const sy = event.clientY
      let dx = 0
      let dy = 0
      // Velocity from the last stretch of movement only: a drag that stalled at the line
      // before letting go is not a flick, however fast it started.
      let lastX = sx
      let lastT = Date.now()
      let vx = 0
      let vy = 0
      let lastY = sy
      c.el.style.cursor = 'grabbing'
      const lifted = { ...base, scale: base.scale * liftScale }
      setPose(c, lifted, 140)

      const pose = (): Pose => ({ dx: base.dx + dx, dy: base.dy + dy, rot: base.rot + clamp(dx / w, -1.5, 1.5) * tiltDeg, scale: lifted.scale })

      const move = (ev: PointerEvent): void => {
        if (ev.pointerId !== pid) return
        const now = Date.now()
        const dt = Math.max(1, now - lastT)
        // Light smoothing, so one jittery sample cannot turn a release into a flick.
        vx = vx * 0.3 + ((ev.clientX - lastX) / dt) * 0.7
        vy = vy * 0.3 + ((ev.clientY - lastY) / dt) * 0.7
        lastX = ev.clientX
        lastY = ev.clientY
        lastT = now
        dx = ev.clientX - sx
        dy = ev.clientY - sy
        setPose(c, pose(), 0)
        const lean = clamp(Math.abs(dx) / (w * (thresholdPct / 100)), 0, 1)
        c.el.dataset.swipeLean = dx > 0 ? 'right' : dx < 0 ? 'left' : ''
        setStamps(c, dx / (w * (thresholdPct / 100)), 0)
        if (display !== 'one') layPile(0, lean)
      }

      const stop = (commit: boolean): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        endDrag = null
        dragging = false
        delete c.el.dataset.swipeLean
        if (typeof c.el.releasePointerCapture === 'function' && c.el.hasPointerCapture?.(pid)) {
          try {
            c.el.releasePointerCapture(pid)
          } catch {
            /* already released by the host */
          }
        }
        c.el.style.cursor = 'grab'
        // A stalled hand is not a flick: velocity older than a beat is dropped.
        if (Date.now() - lastT > 90) vx = vy = 0
        const far = Math.abs(dx) >= w * (thresholdPct / 100)
        const flick = flickSpeed > 0 && Math.abs(vx) >= flickSpeed && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) >= w * 0.06
        if (commit && dx !== 0 && (far || flick)) {
          setStamps(c, dx > 0 ? 1 : -1, 120)
          swipe(c, dx > 0 ? 1 : -1, pose(), vx, vy)
        } else {
          // Spring home with a little overshoot, and the pile leans back with it.
          setPose(c, base, returnMs, 'cubic-bezier(.34,1.45,.55,1)')
          setStamps(c, 0, returnMs)
          if (display !== 'one') layPile(returnMs)
        }
        if (staleSlots) after(Math.max(returnMs, flingMs), relayoutPile)
      }

      const up = (ev: PointerEvent): void => {
        if (ev.pointerId !== pid) return
        stop(true)
      }

      endDrag = () => stop(false)
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    })
  }

  /** Re-measure and re-seat the pile after the stage changed size. */
  const relayoutPile = (): void => {
    if (dragging) {
      staleSlots = true
      return
    }
    staleSlots = false
    stackOrder()
    for (const c of cards) measure(c)
    placeStamps()
    remaining().forEach((c, k) => setPose(c, slotPose(c, k), 0))
  }

  // ---- element discovery -----------------------------------------------------
  const collect = (): void => {
    const stageRoot = ctx.root.closest('.pa-root')
    if (!stageRoot) return
    let seq = 0
    const found: (Card & { seq: number })[] = []
    for (const el of Array.from(stageRoot.querySelectorAll<HTMLElement>('[data-swipe-role="card"]'))) {
      const wanted = el.dataset.swipeGameId
      if (wanted ? wanted !== ctx.elementId : !!el.dataset.swipeClaimedBy) continue
      el.dataset.swipeClaimedBy = ctx.elementId ?? 'swipecards'
      found.push({
        el,
        index: Math.max(1, Math.round(Number(el.dataset.swipeIndex) || 0)) || 9999,
        seq: seq++,
        slot: { cx: 0, cy: 0, w: 1, h: 1, rot: 0 },
        gone: false,
        restOpacity: el.style.opacity,
        homePointer: el.style.pointerEvents,
        stamps: [],
        hostPosition: '',
      })
    }
    // Play order is the index; scene order breaks ties, so two cards that somehow share
    // a number still both play instead of one shadowing the other.
    found.sort((a, b) => a.index - b.index || a.seq - b.seq)
    cards.push(...found)

    for (const el of Array.from(stageRoot.querySelectorAll<HTMLElement>('[data-swipe-role="like"], [data-swipe-role="nope"]'))) {
      const wanted = el.dataset.swipeGameId
      if (wanted ? wanted !== ctx.elementId : !!el.dataset.swipeClaimedBy) continue
      el.dataset.swipeClaimedBy = ctx.elementId ?? 'swipecards'
      marks.push({ el, kind: el.dataset.swipeRole === 'nope' ? 'nope' : 'like', canvasShown: el.dataset.swipeCanvasShow === '1' })
    }

    for (const el of Array.from(stageRoot.querySelectorAll<HTMLElement>('[data-swipe-role="yes"], [data-swipe-role="no"]'))) {
      const wanted = el.dataset.swipeGameId
      if (wanted ? wanted !== ctx.elementId : !!el.dataset.swipeClaimedBy) continue
      el.dataset.swipeClaimedBy = ctx.elementId ?? 'swipecards'
      buttons.push({ el, dir: el.dataset.swipeRole === 'no' ? -1 : 1, homePointer: el.style.pointerEvents, off: null })
    }
  }

  return {
    mount(c, params) {
      ctx = c
      display = str(params.display, 'stack') === 'one' ? 'one' : 'stack'
      advance = str(params.advance, 'moveUp') === 'stay' ? 'stay' : 'moveUp'
      thresholdPct = clamp(num(params.thresholdPct, 28), 5, 90)
      tiltDeg = clamp(num(params.tiltDeg, 12), 0, 45)
      liftScale = clamp(num(params.liftScale, 1.03), 1, 1.5)
      flingMs = clamp(num(params.flingMs, 420), 80, 3000)
      returnMs = clamp(num(params.returnMs, 380), 0, 3000)
      settleMs = clamp(num(params.settleMs, 340), 0, 3000)
      revealMs = clamp(num(params.revealMs, 280), 0, 3000)
      flickSpeed = clamp(num(params.flickSpeed, 0.5), 0, 5)
      winSwipes = Math.max(0, Math.round(num(params.winSwipes, 0)))
      hintDir = str(params.hintDir, 'right') === 'left' ? -1 : 1
      const fit = str(params.resultFit, 'contain')
      resultFit = fit === 'cover' || fit === 'fill' ? fit : 'contain'
      progressGameId = str(params.progressGameId, '').trim()
      markFrom = clamp(num(params.markFrom, 1.2), 0.2, 3)

      // Out of hit-testing, like the rest of this family: every card is a scene element
      // outside this box, and an invisible mount above them would eat their touches.
      shell = ctx.root.closest<HTMLElement>('.pa-el')
      shellPointerEvents = shell?.style.pointerEvents ?? ''
      rootPointerEvents = ctx.root.style.pointerEvents
      if (shell) shell.style.pointerEvents = 'none'
      ctx.root.style.pointerEvents = 'none'

      collect()
      // Nothing moves or hides here: mount() also runs on the static editor canvas, where
      // every card must stay where it was placed and selectable.
    },
    start() {
      if (started) return
      started = true
      // A replayed game starts with no pick, so a result on this scene goes back to its
      // placeholder until the player likes something again.
      writeSwipeResult(ctx.elementId ?? '', { src: '', fit: resultFit })
      offRequest = onProgressRequest(ctx.root, announce)
      announce()
      if (!cards.length) {
        finish()
        return
      }
      stackOrder()
      for (const c of cards) measure(c)
      buildStamps()
      cards.forEach((card, k) => {
        if (display === 'one' && k > 0) card.el.classList.add(OFF_CLASS)
        setPose(card, slotPose(card, k), 0)
        attach(card)
      })
      buttons.forEach(attachButton)
      markHint()
    },
    relayout() {
      if (started) relayoutPile()
    },
    getHint(): HintMove | null {
      const c = top()
      if (!c || busy) return null
      const from = center(c.el)
      return { from, to: { x: from.x + hintDir * c.slot.w * 0.6, y: from.y }, kind: 'drag' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      endDrag?.()
      for (const t of timers) window.clearTimeout(t)
      timers.length = 0
      offRequest?.()
      offRequest = null
      if (shell) shell.style.pointerEvents = shellPointerEvents
      shell = null
      ctx.root.style.pointerEvents = rootPointerEvents
      ctx.root.innerHTML = ''
      for (const c of cards) {
        c.el.classList.remove(OFF_CLASS)
        setPose(c, REST, 0)
        c.el.style.opacity = c.restOpacity
        c.el.style.cursor = ''
        c.el.style.pointerEvents = c.homePointer
        c.el.style.removeProperty('-webkit-touch-callout')
        c.el.style.removeProperty('-webkit-tap-highlight-color')
        delete c.el.dataset.swipeHint
        delete c.el.dataset.swipeLean
        delete c.el.dataset.swipeClaimedBy
        for (const st of c.stamps) st.remove()
        c.stamps = []
        scaleNode(c.el).style.position = c.hostPosition
      }
      for (const m of marks) {
        // Put the canvas back as the author left it: shown while positioning, or hidden.
        if (m.canvasShown) m.el.classList.remove(OFF_CLASS)
        else m.el.classList.add(OFF_CLASS)
        delete m.el.dataset.swipeClaimedBy
      }
      marks.length = 0
      for (const b of buttons) {
        b.off?.()
        b.el.style.pointerEvents = b.homePointer
        b.el.style.cursor = ''
        b.el.style.removeProperty('-webkit-touch-callout')
        b.el.style.removeProperty('-webkit-tap-highlight-color')
        delete b.el.dataset.swipeClaimedBy
      }
      buttons.length = 0
      cards.length = 0
      started = false
      done = false
      busy = false
      dragging = false
      liked = false
      swiped = 0
    },
  }
}

export const SWIPECARDS_TEMPLATE: GameTemplate = {
  id: 'swipecards',
  label: 'Swipe cards',
  paramFields: [
    { key: 'display', label: 'Show the pile', type: 'select', options: ['stack', 'one'], group: 'Pile' },
    { key: 'advance', label: 'After a swipe, the cards', type: 'select', options: ['moveUp', 'stay'], group: 'Pile' },
    { key: 'winSwipes', label: 'Swipes to win (0 = every card)', type: 'number', min: 0, max: 100, step: 1, group: 'Pile' },
    { key: 'thresholdPct', label: 'Swipe counts past (% of card width)', type: 'number', min: 5, max: 90, step: 1, group: 'Swipe feel' },
    { key: 'flickSpeed', label: 'Quick flick counts (px/ms, 0 = off)', type: 'number', min: 0, max: 5, step: 0.05, group: 'Swipe feel' },
    { key: 'tiltDeg', label: 'Tilt while dragged (°)', type: 'number', min: 0, max: 45, step: 1, group: 'Swipe feel' },
    { key: 'liftScale', label: 'Grows when grabbed (1 = none)', type: 'number', min: 1, max: 1.5, step: 0.01, group: 'Swipe feel' },
    { key: 'flingMs', label: 'Fly off (ms)', type: 'number', min: 80, max: 3000, step: 20, group: 'Animation' },
    { key: 'returnMs', label: 'Spring back (ms)', type: 'number', min: 0, max: 3000, step: 20, group: 'Animation' },
    { key: 'settleMs', label: 'Pile moves up (ms)', type: 'number', min: 0, max: 3000, step: 20, group: 'Animation', showIf: (p) => p.advance !== 'stay' },
    { key: 'revealMs', label: 'Next card fades in (ms)', type: 'number', min: 0, max: 3000, step: 20, group: 'Animation', showIf: (p) => p.display === 'one' },
    { key: 'markFrom', label: 'Swipe marks grow in from (1 = plain fade)', type: 'number', min: 0.2, max: 3, step: 0.05, group: 'Swipe feel' },
    { key: 'resultFit', label: 'Liked card in the result box', type: 'select', options: ['contain', 'cover', 'fill'], group: 'Result' },
    { key: 'hintDir', label: 'Hint hand swipes', type: 'select', options: ['right', 'left'], group: 'Result' },
  ],
  defaultParams: {
    // 'stack' = every card visible; 'one' = only the top card, the next fades up.
    display: 'stack',
    // 'moveUp' = the pile closes up into the slots ahead; 'stay' = cards keep their place.
    advance: 'moveUp',
    winSwipes: 0,
    thresholdPct: 28,
    flickSpeed: 0.5,
    tiltDeg: 12,
    liftScale: 1.03,
    flingMs: 420,
    returnMs: 380,
    settleMs: 340,
    revealMs: 280,
    markFrom: 1.2,
    resultFit: 'contain',
    hintDir: 'right',
    // '' = every progress bar in the scene hears this game.
    progressGameId: '',
  },
  defaultHintIdleMs: 2600,
  // Seeds a placed handguide that mimes a swipe on whichever card is on top.
  defaultHandguide: { mode: 'swipecards', nodes: [{ x: 0.5, y: 0.5 }], periodMs: 1600 },
  create: createSwipeCards,
}
