// Combo builder: a drag-to-choose selection game where the whole board is laid
// out on the canvas as ordinary scene elements rather than inside the game box.
//
// The game mount contributes exactly one thing visually — an invisible DROP AREA,
// drawn with the shared canvas zone editor (zoneX/Y/W/H, same as Basket drop).
// Everything else is an ordinary element the author tagged with `comboRole`:
//
//   option  a draggable answer belonging to question N. Only the live question's
//           options are visible and interactive. Dragging one grows it; releasing
//           it inside the drop area picks it.
//   layer   what a pick leaves behind — one element per option, sitting exactly
//           where the author placed it. Hidden until its option is picked, at which
//           point the option flies to it and hands over. Position, size, crop and
//           animation are the element's own, so the composed result is arranged by
//           eye on the canvas rather than by numbers in a panel.
//   title   the question headline. Shown while its question is live and swapped on
//           advance. It never reacts to WHICH option was picked — only to which
//           question is up.
//   caption what the option is CALLED — an item name, a price, a blurb. One element
//           per option, hidden until that option is held and gone again when the
//           drag ends. Unlike drag art it never moves: it appears exactly where the
//           author placed it, so a name plate can sit in a fixed spot on the board.
//   outline a placeholder standing where a pick is about to land — a dashed
//           silhouette, an empty frame, a "your sofa here" ghost. Visible for as
//           long as its question is unanswered, then it dissolves on exactly the
//           curve the layer arrives on, so the two read as one swap rather than a
//           blink. Addressed per option like a layer, but ALL of a question's
//           outlines leave together on a pick, so assigning just one covers the
//           common case of a single shared placeholder for the whole question.
//   anchor  the base art the layers build on top of. Purely the backdrop; it is
//           only consulted as the fly-to target for an option whose question has
//           no layer element assigned yet.
//
// Because each question contributes its own layer rather than a whole flat image,
// the art needed is options x questions rather than options^questions, and a
// combination is composed by dragging layers around the canvas — no lookup table.
//
// Three gameplay beats are broadcast through the SFX channel, which stage.ts fans
// out to every scene element as both an animation phase and a sound binding:
// 'comboPick' (an option is picked up), 'comboDrop' (one is dropped in the area)
// and 'comboNext' (the next question comes up).

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'

interface OptionEl {
  el: HTMLElement
  question: number
  choice: number
  homeZ: string
  dx: number
  dy: number
  dragging: boolean
}

interface DragArtEl {
  el: HTMLElement
  /** Which option this belongs to — drag art is per-option, like a layer. */
  question: number
  choice: number
  canvasShown: boolean
  /** Resting centre, sampled when a drag begins, so riding along is a pure offset. */
  home: Pt
  /** Inline opacity layoutRec left on it, to be handed back after a fade. */
  restOpacity: string
}

interface LayerEl {
  el: HTMLElement
  question: number
  choice: number
  /** Whether the author left it visible on the editor canvas, so destroy() can put
   * the canvas back exactly as it found it. */
  canvasShown: boolean
}

interface CaptionEl {
  el: HTMLElement
  question: number
  choice: number
  canvasShown: boolean
  /** Inline opacity layoutRec left on it, to be handed back after a fade. */
  restOpacity: string
  /** Bumped on every show, so a fade-out scheduled for an earlier hold can't park a
   * caption that has since been brought back up. */
  seq: number
}

interface OutlineEl {
  el: HTMLElement
  question: number
  choice: number
  /** Inline opacity layoutRec left on it, to be handed back after a fade. */
  restOpacity: string
  /** Bumped on every show, so a fade-out scheduled for an earlier question can't
   * park an outline that has since come back up. */
  seq: number
}

interface Zone {
  x: number
  y: number
  w: number
  h: number
}

/** Hidden without touching inline display/opacity — layoutRec rewrites both on every
 * layout pass, so an inline hide would be dropped by the next resize. Exported so
 * stage.ts can start layer elements hidden at build time, before play begins. */
export const COMBO_OFF_CLASS = 'pa-combo-off'
const OFF_CLASS = COMBO_OFF_CLASS

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/**
 * Where to hang a scale so it grows the element ABOUT ITS VISIBLE CENTRE.
 *
 * The outer .pa-el is positioned by layoutRec with `transform: translate(tx%,ty%)`,
 * and the CSS `scale` property composes AFTER that (order: translate, rotate, scale,
 * transform) about `transform-origin: center center` — the centre of the box BEFORE
 * that positional shift. Scaling the outer therefore slides the element by
 * (1-s)·W/2: a 200px option picked up at 1.25x jumps 25px up-left instead of
 * swelling in place, and the same drift throws the flight off its target.
 *
 * The inner .pa-el-anim fills the box and carries no positional transform, so its
 * own origin already IS the visible centre. Scaling there is drift-free, and it
 * leaves the outer's box (and so getBoundingClientRect) at natural size, which is
 * what the fly-to maths wants to measure against.
 */
function scaleNode(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>('.pa-el-anim') ?? el
}

function clampPct(value: unknown, fallback: number): number {
  return Math.max(0, Math.min(100, num(value, fallback)))
}

export function createCombo(): GameModule {
  let ctx: GameContext
  let target: HTMLDivElement
  let questions = 1
  let pickupScale = 1.25
  let snapBorderPct = 6
  let advanceDelayMs = 600
  let flyMs = 520
  let landScale = 0.92
  let crossFadeMs = 300
  let dismissMs = 260
  let captionFadeMs = 140
  let zonePct: Zone = { x: 18, y: 60, w: 64, h: 32 }

  const options: OptionEl[] = []
  const layers: LayerEl[] = []
  const dragArt: DragArtEl[] = []
  const captions: CaptionEl[] = []
  const outlines: OutlineEl[] = []
  const anchors: HTMLElement[] = []
  const titles: { el: HTMLElement; question: number }[] = []
  /** Chosen option index per question (0-based question), -1 = unanswered. */
  const answers: number[] = []
  const timers: number[] = []

  /** The mount's own outer .pa-el, and the inline pointer-events both it and the
   * inner slot were built with, to be handed back on destroy. */
  let shell: HTMLElement | null = null
  let shellPointerEvents = ''
  let rootPointerEvents = ''

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

  const optionsFor = (question: number): OptionEl[] => options.filter((o) => o.question === question)

  /** The option a hint should point at: the first one still up for grabs. */
  const liveOption = (): OptionEl | undefined => (done || busy ? undefined : optionsFor(current + 1).find((o) => !o.el.classList.contains(OFF_CLASS)))

  /** Publish that option as `data-combo-hint`, the way the basket game publishes its
   * next unplaced item. An editable handguide element in 'combo' mode follows this
   * attribute, so the placed hand advances by itself as questions go by. */
  const markHint = (): void => {
    const live = liveOption()
    for (const o of options) {
      if (o === live) o.el.dataset.comboHint = '1'
      else delete o.el.dataset.comboHint
    }
  }

  const setOffset = (item: OptionEl, dx: number, dy: number, ease: boolean): void => {
    item.dx = dx
    item.dy = dy
    item.el.style.transition = ease ? `translate ${dismissMs}ms ease` : ''
    item.el.style.translate = `${dx}px ${dy}px`
  }

  /** Scale an element about its visible centre, optionally eased. */
  const setScale = (el: HTMLElement, value: number, ms: number, easing = 'ease'): void => {
    const node = scaleNode(el)
    node.style.transition = ms > 0 ? `scale ${ms}ms ${easing}` : ''
    node.style.scale = String(value)
  }

  const resetOption = (item: OptionEl): void => {
    const node = scaleNode(item.el)
    node.style.transition = ''
    node.style.scale = ''
    item.el.style.transition = ''
    item.el.style.translate = ''
    item.el.style.scale = ''
    item.el.style.opacity = ''
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

  /** `pad` is a FLOOR on the forgiveness border, in px, not an addition to it: an
   * author who dialled snapBorderPct up already has more room than a fingertip
   * needs, and doubling it there would start catching drops nobody aimed. */
  const insideTarget = (x: number, y: number, pad = 0): boolean => {
    const r = target.getBoundingClientRect()
    const root = ctx.root.getBoundingClientRect()
    const border = Math.max((Math.min(root.width || 300, root.height || 400) * snapBorderPct) / 100, pad)
    return x >= r.left - border && x <= r.right + border && y >= r.top - border && y <= r.bottom + border
  }

  // ---- layers --------------------------------------------------------------
  /** The layer element paired with an option — same question, same choice. */
  const layerFor = (option: OptionEl): LayerEl | undefined => layers.find((l) => l.question === option.question && l.choice === option.choice)

  /** Where a picked option should fly to: onto its own layer if it has one, else onto
   * the anchor art, else nowhere (it just fades where it was dropped). */
  const flyTarget = (option: OptionEl): HTMLElement | null => layerFor(option)?.el ?? anchors[0] ?? null

  /** Hide every layer. Real play always starts from a clean anchor, whatever the
   * author left visible on the canvas while positioning them. */
  const hideAllLayers = (): void => {
    for (const l of layers) hide(l.el)
  }

  // ---- drag art ------------------------------------------------------------
  // Optional per-option DRAG PROXY: the thing the player actually carries. While an
  // option with drag art is held, the option's own art is switched off and this rides
  // under the finger in its place — enlarged, and then flown onto the layer at the
  // end. It lets the tray art and the in-hand art be different pictures: a flat
  // swatch in the tray, a big three-quarter render in the hand.
  //
  // The option element itself never moves aside: it stays put as the invisible drag
  // handle, which is what keeps pointer capture, hit-testing against the drop area
  // and the hint marker all working exactly as they do without drag art.
  const dragArtFor = (option: OptionEl): DragArtEl | undefined => dragArt.find((a) => a.question === option.question && a.choice === option.choice)

  /** The element the player sees themselves dragging: the proxy if there is one, else
   * the option itself. Everything downstream — the enlargement, the flight, the
   * cross-fade into the layer — acts on whichever this returns. */
  const proxyFor = (item: OptionEl): HTMLElement => dragArtFor(item)?.el ?? item.el

  const showDragArt = (item: OptionEl): void => {
    const art = dragArtFor(item)
    if (!art) return
    // Sample the resting centre BEFORE moving it: the off class only touches opacity
    // and visibility, so the box is measurable either way, and a fresh sample keeps
    // it correct across resizes.
    art.el.style.transition = ''
    art.el.style.translate = ''
    art.restOpacity = art.el.style.opacity
    art.home = center(art.el)
    show(art.el)
    // The option hands over its appearance for the duration. Opacity rather than the
    // off class, so the element keeps receiving the pointer events it is capturing.
    const node = scaleNode(item.el)
    node.style.transition = ''
    node.style.opacity = '0'
    followDragArt(item)
  }

  const followDragArt = (item: OptionEl): void => {
    const art = dragArtFor(item)
    if (!art) return
    const p = center(item.el)
    art.el.style.translate = `${p.x - art.home.x}px ${p.y - art.home.y}px`
  }

  /** Give the option back its own appearance — a rejected drop, or teardown. */
  const restoreOptionArt = (item: OptionEl, ms = 0): void => {
    const node = scaleNode(item.el)
    node.style.transition = ms > 0 ? `opacity ${ms}ms ease` : ''
    node.style.opacity = ms > 0 ? '1' : ''
    if (ms > 0) after(ms, () => (node.style.opacity = ''))
  }

  /** Put ALL of it away, not just this option's — cheap, and it can't leave a stale
   * proxy on screen if a drag is interrupted between questions. */
  const hideDragArt = (fadeMs = 0): void => {
    for (const art of dragArt) {
      const visible = !art.el.classList.contains(OFF_CLASS)
      if (fadeMs > 0 && visible) {
        art.el.style.transition = `opacity ${fadeMs}ms ease`
        art.el.style.opacity = '0'
        after(fadeMs, () => parkDragArt(art))
      } else {
        parkDragArt(art)
      }
    }
  }

  const parkDragArt = (art: DragArtEl): void => {
    hide(art.el)
    art.el.style.transition = ''
    art.el.style.translate = ''
    // layoutRec owns this property; hand back exactly what it had written.
    art.el.style.opacity = art.restOpacity
    const node = scaleNode(art.el)
    node.style.transition = ''
    node.style.scale = ''
  }

  // ---- captions ------------------------------------------------------------
  // Optional per-option NAME PLATE: an ordinary element — the item's name, a price,
  // a line of copy — that appears while its option is held and leaves when the drag
  // ends. It stays exactly where the author placed it; the drag proxy is what rides
  // the finger. Pick and caption are paired the same way a layer is: same question,
  // same choice.
  const captionFor = (option: OptionEl): CaptionEl | undefined => captions.find((c) => c.question === option.question && c.choice === option.choice)

  const showCaption = (item: OptionEl): void => {
    const cap = captionFor(item)
    if (!cap) return
    // Only sample the resting opacity when it is genuinely at rest: re-grabbing an
    // option mid fade-out would otherwise record the 0 as its authored value.
    if (cap.el.classList.contains(OFF_CLASS)) cap.restOpacity = cap.el.style.opacity
    cap.seq++
    if (captionFadeMs <= 0) {
      show(cap.el)
      return
    }
    cap.el.style.transition = ''
    cap.el.style.opacity = '0'
    show(cap.el)
    // Flush the 0 so there is a value to animate from (see fadeInLayer).
    void cap.el.offsetWidth
    cap.el.style.transition = `opacity ${captionFadeMs}ms ease`
    cap.el.style.opacity = '1'
  }

  /** Put every caption away — cheap, and it can't strand one on screen if a drag is
   * interrupted between questions. */
  const hideCaptions = (fadeMs = 0): void => {
    for (const cap of captions) {
      const visible = !cap.el.classList.contains(OFF_CLASS)
      if (fadeMs > 0 && visible) {
        const seq = cap.seq
        cap.el.style.transition = `opacity ${fadeMs}ms ease`
        cap.el.style.opacity = '0'
        after(fadeMs, () => {
          if (cap.seq === seq) parkCaption(cap)
        })
      } else {
        parkCaption(cap)
      }
    }
  }

  const parkCaption = (cap: CaptionEl): void => {
    hide(cap.el)
    cap.el.style.transition = ''
    // layoutRec owns this property; hand back exactly what it had written.
    cap.el.style.opacity = cap.restOpacity
  }

  // ---- outlines ------------------------------------------------------------
  // Optional per-question PLACEHOLDER: whatever should stand where the pick is about
  // to land — a dashed silhouette, an empty frame, a ghosted preview. It is an
  // ordinary element sitting exactly where the author put it, so it lines up with the
  // layer by eye rather than by numbers, and it is up for as long as its question is
  // unanswered. Unlike a layer it is not addressed by WHICH option won: a question's
  // outlines all leave together the moment a pick lands, so one assigned outline
  // serves a whole question and per-option ones serve a board where each choice lands
  // somewhere different.
  const showOutline = (o: OutlineEl): void => {
    // Only sample the resting opacity while it is genuinely at rest, or a question
    // re-shown mid fade-out would record the 0 as its authored value.
    if (o.el.classList.contains(OFF_CLASS)) o.restOpacity = o.el.style.opacity
    o.seq++
    o.el.style.transition = ''
    o.el.style.opacity = o.restOpacity
    show(o.el)
  }

  const parkOutline = (o: OutlineEl): void => {
    hide(o.el)
    o.el.style.transition = ''
    // layoutRec owns this property; hand back exactly what it had written.
    o.el.style.opacity = o.restOpacity
  }

  /** Take question `question`'s outlines down over `fadeMs`. Called with the layer's
   * cross-fade so the placeholder dissolves as the real thing arrives in its place;
   * a linear pair keeps the combined opacity steady across the swap. */
  const hideOutlines = (question: number, fadeMs = 0): void => {
    for (const o of outlines) {
      if (question > 0 && o.question !== question) continue
      const visible = !o.el.classList.contains(OFF_CLASS)
      if (fadeMs > 0 && visible) {
        const seq = o.seq
        o.el.style.transition = `opacity ${fadeMs}ms linear`
        o.el.style.opacity = '0'
        after(fadeMs, () => {
          if (o.seq === seq) parkOutline(o)
        })
      } else {
        parkOutline(o)
      }
    }
  }

  /** Bring a layer up from transparent over `ms`, so it arrives as the option on top
   * of it fades away and the two read as one object rather than a swap.
   *
   * The resting inline opacity is captured and put back afterwards: layoutRec owns
   * that property (it writes the element's authored opacity on every layout pass), so
   * clearing it outright would silently promote a half-transparent layer to solid. */
  const fadeInLayer = (el: HTMLElement, ms: number): void => {
    if (ms <= 0) {
      show(el)
      return
    }
    const resting = el.style.opacity
    el.style.transition = `opacity ${ms}ms linear`
    el.style.opacity = '0'
    show(el)
    // Flush the 0 so the browser has a start value to animate FROM; without this the
    // class removal and the 0 -> 1 change collapse into one style recalc and no
    // transition runs at all.
    void el.offsetWidth
    el.style.opacity = '1'
    after(ms, () => {
      el.style.transition = ''
      el.style.opacity = resting
    })
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
    // A placeholder is up exactly as long as the question it is holding a space for.
    for (const o of outlines) {
      if (o.question === q + 1 && answers[q] < 0) showOutline(o)
      else parkOutline(o)
    }
  }

  const finish = (): void => {
    if (done) return
    done = true
    target.dataset.comboComplete = '1'
    markHint()
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
    busy = false
    markHint()
    // Fired AFTER the incoming elements are visible, so an authored 'comboNext'
    // animation on them actually plays instead of running while they're hidden.
    ctx.sfx.play('comboNext')
  }

  /** Pick `item` for the current question: dismiss its siblings, fly it into the
   * layer element, hands over to it, then moves on after the authored delay. */
  const choose = (item: OptionEl): void => {
    const q = current
    answers[q] = item.choice
    busy = true
    markHint()
    ctx.sfx.play('comboDrop')

    // The name plate leaves with the options it was naming, rather than hanging over
    // the composed art while the pick flies home.
    hideCaptions(dismissMs)

    for (const other of optionsFor(q + 1)) {
      if (other === item) continue
      other.el.style.transition = `opacity ${dismissMs}ms ease`
      other.el.style.opacity = '0'
      setScale(other.el, 0.7, dismissMs)
      after(dismissMs, () => hide(other.el))
    }

    const layer = layerFor(item)
    const destination = flyTarget(item)
    if (!destination) {
      // Nothing to fly into — still a valid pick, the option just leaves, and the
      // placeholder goes with it rather than outliving the question it belonged to.
      hide(item.el)
      hideOutlines(q + 1, dismissMs)
      after(advanceDelayMs, advance)
      return
    }

    // Fly the option onto the CENTRE of the placed art and shrink it down onto it, so
    // the two are superimposed by the time they trade places.
    //
    // Both rects are natural box geometry: the drag scale lives on the inner node
    // (see scaleNode), so neither the option's pick-up growth nor its landing shrink
    // distorts what is measured here. `home` is the option's resting centre — its
    // live centre minus the drag offset it is carrying — and translating by
    // (target - home) puts its centre exactly on the target's.
    //
    // Size is matched contain-style — the smaller of the two ratios — rather than by
    // width alone: when the option art and the placed art have different aspects,
    // matching width alone leaves the option spilling out past the thing it is
    // supposed to be turning into, which is exactly when the seam shows.
    // Whatever the player was carrying is what flies — the proxy when there is drag
    // art, otherwise the option itself.
    const art = dragArtFor(item)
    const flyer = art?.el ?? item.el
    const to = destination.getBoundingClientRect()
    const rect = flyer.getBoundingClientRect()
    const fit = rect.width > 0 && rect.height > 0 && to.width > 0 && to.height > 0 ? Math.min(to.width / rect.width, to.height / rect.height) : 1
    // The flyer's resting centre. A proxy already knows its own (sampled at pick-up);
    // an option's is its live centre minus the drag offset it is carrying.
    const home = art ? art.home : { x: rect.left + rect.width / 2 - item.dx, y: rect.top + rect.height / 2 - item.dy }
    // The cross-fade occupies the TAIL of the flight, so it is still moving while it
    // dissolves instead of landing and then blinking out.
    const cross = Math.min(crossFadeMs, flyMs)
    const ease = 'cubic-bezier(.4,0,.2,1)'
    flyer.style.transition = `translate ${flyMs}ms ${ease}, opacity ${cross}ms linear ${flyMs - cross}ms`
    flyer.style.translate = `${to.left + to.width / 2 - home.x}px ${to.top + to.height / 2 - home.y}px`
    // Settling a touch UNDER the placed art's size reads as the pick being absorbed
    // into it; landScale 1 lands on an exact size match instead.
    setScale(flyer, Math.max(0.05, fit * landScale), flyMs, ease)
    if (cross > 0) flyer.style.opacity = '0'
    // The option was only ever the drag handle once a proxy took over its look, so it
    // can leave immediately rather than trailing along invisibly.
    if (art) hide(item.el)

    // Start the layer's fade-in at the same moment the flyer starts fading out. A
    // linear pair keeps the combined opacity roughly constant across the swap; eased
    // curves dip in the middle and read as a flicker. The placeholder leaves on the
    // same beat, so what the player sees is the outline BECOMING the finished piece.
    after(flyMs - cross, () => {
      if (layer) fadeInLayer(layer.el, cross)
      hideOutlines(q + 1, cross)
    })

    after(flyMs, () => {
      if (layer) show(layer.el)
      hide(item.el)
      if (art) parkDragArt(art)
      after(advanceDelayMs, advance)
    })
  }

  // ---- dragging ------------------------------------------------------------
  // One drag at a time, and it belongs to one pointer. A phone supplies stray extra
  // pointers constantly — the hand steadying the device, a thumb brushing a sibling
  // option, a palm on the bezel — and without this a second finger starts a second
  // drag that fights the first one over the same drop area.
  let held: OptionEl | null = null
  let heldPointer: number | undefined
  /** Tears the live drag down, so destroy() can't strand its window listeners. */
  let endDrag: (() => void) | null = null

  /** Fingertip forgiveness at the drop area, in px, for touch drags only.
   *
   * snapBorderPct is a share of the board, so on a phone it can work out to a
   * handful of pixels — far under the ~44px a fingertip actually covers. That gap
   * is exactly what makes a release the player saw as dead on target come back as
   * a miss. A mouse needs none of it: the cursor is one pixel and it is visible. */
  const TOUCH_PAD_PX = 22

  /**
   * Is this drag over the drop area?
   *
   * Three chances, because on a touchscreen they genuinely disagree. The finger is
   * what the player AIMS with. The carried art is what they can SEE — and with a
   * drag proxy that is a different element, often much larger than and offset from
   * the option underneath it. The option itself is only the handle, invisible for
   * the whole drag once a proxy has taken over its look, so judging the drop on its
   * centre alone rejects releases that landed on the mark as far as anyone could
   * tell. Any of the three landing inside counts.
   */
  const overTarget = (x: number, y: number, item: OptionEl, pad: number): boolean => {
    if (insideTarget(x, y, pad)) return true
    const c = center(item.el)
    if (insideTarget(c.x, c.y, pad)) return true
    const art = dragArtFor(item)
    if (!art || art.el.classList.contains(OFF_CLASS)) return false
    // A degenerate box is not a position: an element that has never been laid out
    // measures 0x0 at the document origin, which would read as sitting on a drop
    // area placed anywhere near the top-left corner.
    const a = art.el.getBoundingClientRect()
    if (a.width <= 0 || a.height <= 0) return false
    return insideTarget(a.left + a.width / 2, a.top + a.height / 2, pad)
  }

  const attachDrag = (item: OptionEl): void => {
    item.el.style.cursor = 'grab'
    item.el.style.touchAction = 'none'
    item.el.style.pointerEvents = 'auto'
    // iOS raises its own press-and-hold sheet over an image — "Save Image", the
    // selection magnifier — and it steals the gesture mid-drag, several hundred ms
    // after the drag has already begun. There is no event to cancel it from once it
    // decides to open, so it has to be switched off up front.
    item.el.style.setProperty('-webkit-touch-callout', 'none')
    item.el.style.setProperty('-webkit-tap-highlight-color', 'transparent')
    item.el.addEventListener('pointerdown', (event) => {
      if (done || busy || held || item.question !== current + 1 || answers[current] >= 0) return
      event.preventDefault()
      const pid = event.pointerId
      held = item
      heldPointer = pid
      const pad = event.pointerType === 'touch' ? TOUCH_PAD_PX : 0
      try {
        item.el.setPointerCapture?.(event.pointerId)
      } catch {
        // Some playable containers expose the API but reject capture for their
        // synthesized pointer stream. The listeners below sit on window rather than
        // on the element precisely so capture is a nicety, not a requirement.
      }
      item.dragging = true
      const start = { x: event.clientX, y: event.clientY }
      const base = { x: item.dx, y: item.dy }
      // Where the pointer was last seen. A pointercancel can arrive with stale or
      // meaningless coordinates, and that is the one case where the position still
      // has to be judged (see `cancel`), so it is tracked rather than read off the
      // ending event.
      let lastX = event.clientX
      let lastY = event.clientY
      item.el.style.zIndex = '99999'
      item.el.style.cursor = 'grabbing'
      // Swap in the proxy FIRST, so the enlargement lands on whichever element the
      // player is about to be carrying.
      showDragArt(item)
      showCaption(item)
      setScale(proxyFor(item), pickupScale, 140)
      ctx.sfx.play('comboPick')

      /** Events from any other finger belong to somebody else's gesture. */
      const mine = (ev: PointerEvent): boolean => ev.pointerId === heldPointer

      const move = (moveEvent: PointerEvent): void => {
        if (!mine(moveEvent)) return
        lastX = moveEvent.clientX
        lastY = moveEvent.clientY
        setOffset(item, base.x + lastX - start.x, base.y + lastY - start.y, false)
        followDragArt(item)
        target.dataset.comboNear = overTarget(lastX, lastY, item, pad) ? '1' : '0'
      }

      /** `commit` false is teardown — the drag is abandoned without being judged. */
      const stop = (commit: boolean): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', release)
        window.removeEventListener('pointercancel', cancel)
        endDrag = null
        held = null
        heldPointer = undefined
        item.dragging = false
        target.dataset.comboNear = '0'
        // Released before the pick is judged: choose() hides this element, and a
        // capture still outstanding on a hidden node is the sort of thing embedded
        // WebViews handle badly.
        if (typeof item.el.releasePointerCapture === 'function' && item.el.hasPointerCapture?.(pid)) {
          try {
            item.el.releasePointerCapture(pid)
          } catch {
            /* capture was already released by the host */
          }
        }
        if (commit && overTarget(lastX, lastY, item, pad)) {
          item.el.style.pointerEvents = 'none'
          item.el.style.cursor = 'default'
          choose(item)
        } else {
          item.el.style.zIndex = item.homeZ
          item.el.style.cursor = 'grab'
          hideCaptions(captionFadeMs)
          hideDragArt(140)
          restoreOptionArt(item, 140)
          setScale(item.el, 1, 140)
          setOffset(item, 0, 0, true)
        }
      }

      const release = (upEvent: PointerEvent): void => {
        if (!mine(upEvent)) return
        lastX = upEvent.clientX
        lastY = upEvent.clientY
        stop(true)
      }

      // A pointercancel is not a change of mind. iOS Safari raises one on its own
      // whenever it decides the gesture is the browser's — a second finger landing,
      // a system edge swipe, its own scroll heuristic firing a beat late — and the
      // option is left sitting wherever the player had dragged it to. Binning a drag
      // that is ON the drop area at that moment is the most infuriating way for a
      // pick to fail, so a cancel is judged on position exactly like a release: over
      // the area it counts, short of it it springs home.
      const cancel = (cancelEvent: PointerEvent): void => {
        if (!mine(cancelEvent)) return
        stop(true)
      }

      endDrag = () => stop(false)
      // On window, not on the element: pointer capture is best-effort here (some ad
      // containers refuse it), and without capture a move that leaves the option's
      // box — which is the whole point of dragging — would never be delivered.
      // Capture, when it is granted, retargets the events to the element, from where
      // they still bubble to window, so one pair of listeners covers both.
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', release)
      window.addEventListener('pointercancel', cancel)
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
      const choice = Math.max(1, Math.round(Number(el.dataset.comboChoice) || 1))
      if (role === 'option') {
        options.push({ el, question, choice, homeZ: el.style.zIndex, dx: 0, dy: 0, dragging: false })
      } else if (role === 'layer') {
        layers.push({ el, question, choice, canvasShown: el.dataset.comboCanvasShow === '1' })
      } else if (role === 'dragArt') {
        dragArt.push({
          el,
          question,
          choice,
          canvasShown: el.dataset.comboCanvasShow === '1',
          home: { x: 0, y: 0 },
          restOpacity: '',
        })
      } else if (role === 'caption') {
        captions.push({ el, question, choice, canvasShown: el.dataset.comboCanvasShow === '1', restOpacity: el.style.opacity, seq: 0 })
      } else if (role === 'outline') {
        // No canvas-visibility flag: an outline is part of the board the author is
        // arranging, so it stays visible while editing the way an option or a title
        // does, and showQuestion is what collapses it to the live question in play.
        outlines.push({ el, question, choice, restOpacity: el.style.opacity, seq: 0 })
      } else if (role === 'title') {
        titles.push({ el, question })
      } else if (role === 'anchor') {
        anchors.push(el)
      }
    }
  }

  return {
    mount(c, params) {
      ctx = c
      // No ceiling: a funnel can be as long as the author wires up, and a question
      // with nothing tagged for it is skipped rather than stalling (nextPlayable).
      questions = Math.max(1, Math.round(num(params.questions, 1)))
      pickupScale = Math.max(1, Math.min(2, num(params.pickupScale, 1.25)))
      snapBorderPct = Math.max(0, Math.min(25, num(params.snapBorderPct, 6)))
      advanceDelayMs = Math.max(0, Math.min(5000, num(params.advanceDelayMs, 600)))
      flyMs = Math.max(0, Math.min(3000, num(params.flyMs, 520)))
      landScale = Math.max(0.1, Math.min(2, num(params.landScale, 0.92)))
      crossFadeMs = Math.max(0, Math.min(3000, num(params.crossFadeMs, 300)))
      dismissMs = Math.max(0, Math.min(2000, num(params.dismissMs, 260)))
      captionFadeMs = Math.max(0, Math.min(2000, num(params.captionFadeMs, 140)))
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

      // Then step the whole mount OUT of hit-testing.
      //
      // Nothing inside it is ever touched: the drop area above is pointer-events
      // none, and every interactive piece of a combo board — the options — is a
      // tagged scene element sitting OUTSIDE this box entirely. What the mount does
      // have is a box, an author-sized rectangle that is routinely most of the
      // screen, invisible but hit-testable by default like any other game mount.
      // Wherever it lands above an option in the layer order it silently swallows
      // the touches over the overlapping part, and since a combo tray is normally
      // arranged around the drop area that part is usually most of the option: the
      // art looks whole, and only the sliver hanging outside the mount can be picked
      // up. Other games need an interactive mount because the mount IS their play
      // surface. This one doesn't, so the layer order stops mattering.
      shell = ctx.root.closest<HTMLElement>('.pa-el')
      shellPointerEvents = shell?.style.pointerEvents ?? ''
      rootPointerEvents = ctx.root.style.pointerEvents
      if (shell) shell.style.pointerEvents = 'none'
      ctx.root.style.pointerEvents = 'none'

      collect()
      layoutZone()
      // Nothing is hidden or revealed here on purpose: mount() also runs on the
      // static editor canvas, where options and titles must stay visible and
      // selectable, and each layer keeps whatever canvas visibility the author chose
      // for it. start() (interactive only) is what collapses to question 1.
    },
    start() {
      if (started) return
      started = true
      // Whatever the author left visible while positioning, play starts clean.
      hideAllLayers()
      hideDragArt()
      hideCaptions()
      hideOutlines(0)
      current = nextPlayable(0)
      if (current >= questions) {
        // Nothing is wired up at all — win immediately rather than stranding the player.
        showQuestion(current)
        finish()
        return
      }
      showQuestion(current)
      markHint()
      options.forEach(attachDrag)
    },
    relayout() {
      layoutZone()
      for (const item of options) if (!item.dragging && answers[item.question - 1] < 0) setOffset(item, 0, 0, false)
    },
    getHint(): HintMove | null {
      const item = liveOption()
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
      // Before clearTimers, so anything the abandoned drag schedules on its way out
      // is cleared with the rest rather than firing against a torn-down board.
      endDrag?.()
      clearTimers()
      if (shell) shell.style.pointerEvents = shellPointerEvents
      shell = null
      ctx.root.style.pointerEvents = rootPointerEvents
      ctx.root.innerHTML = ''
      for (const item of options) {
        restoreOptionArt(item)
        resetOption(item)
        item.el.classList.remove(OFF_CLASS)
        item.el.style.pointerEvents = ''
        item.el.style.rotate = ''
        item.el.style.removeProperty('-webkit-touch-callout')
        item.el.style.removeProperty('-webkit-tap-highlight-color')
        delete item.el.dataset.comboHint
        delete item.el.dataset.comboClaimedBy
      }
      for (const t of titles) {
        t.el.classList.remove(OFF_CLASS)
        delete t.el.dataset.comboClaimedBy
      }
      for (const l of layers) {
        // Put the canvas back exactly as it was found: a layer the author had shown
        // stays shown, one they had hidden stays hidden.
        if (l.canvasShown) l.el.classList.remove(OFF_CLASS)
        else l.el.classList.add(OFF_CLASS)
        delete l.el.dataset.comboClaimedBy
      }
      for (const art of dragArt) {
        if (art.canvasShown) art.el.classList.remove(OFF_CLASS)
        else art.el.classList.add(OFF_CLASS)
        art.el.style.translate = ''
        art.el.style.transition = ''
        delete art.el.dataset.comboClaimedBy
      }
      for (const cap of captions) {
        if (cap.canvasShown) cap.el.classList.remove(OFF_CLASS)
        else cap.el.classList.add(OFF_CLASS)
        cap.el.style.transition = ''
        cap.el.style.opacity = cap.restOpacity
        delete cap.el.dataset.comboClaimedBy
      }
      for (const o of outlines) {
        // Like an option or a title, an outline is always visible on the canvas —
        // there is no per-element authoring flag to put back, just the board.
        o.el.classList.remove(OFF_CLASS)
        o.el.style.transition = ''
        o.el.style.opacity = o.restOpacity
        delete o.el.dataset.comboClaimedBy
      }
      for (const anchor of anchors) delete anchor.dataset.comboClaimedBy
      options.length = 0
      layers.length = 0
      dragArt.length = 0
      captions.length = 0
      outlines.length = 0
      titles.length = 0
      anchors.length = 0
      answers.length = 0
      current = 0
      held = null
      heldPointer = undefined
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
    // 'questions' and 'options' are both uncapped and both rendered by the editor's
    // own Combo setup panel, right above the per-question chips.
    { key: 'questions', label: 'Questions', type: 'number', min: 1, step: 1 },
    { key: 'options', label: 'Options per question', type: 'number', min: 1, step: 1 },
    { key: 'pickupScale', label: 'Drag grow scale', type: 'number', min: 1, max: 2, step: 0.05 },
    { key: 'snapBorderPct', label: 'Snap border (%)', type: 'number', min: 0, max: 25, step: 1 },
    { key: 'flyMs', label: 'Fly-to-layer (ms)', type: 'number', min: 0, max: 3000, step: 20 },
    { key: 'landScale', label: 'Land scale (1 = exact match)', type: 'number', min: 0.1, max: 2, step: 0.02 },
    { key: 'crossFadeMs', label: 'Cross-fade into the layer (ms)', type: 'number', min: 0, max: 3000, step: 20 },
    { key: 'advanceDelayMs', label: 'Delay before next question (ms)', type: 'number', min: 0, max: 5000, step: 50 },
    { key: 'dismissMs', label: 'Unpicked option exit (ms)', type: 'number', min: 0, max: 2000, step: 20 },
    { key: 'captionFadeMs', label: 'Name plate fade (ms)', type: 'number', min: 0, max: 2000, step: 20 },
  ],
  defaultParams: {
    questions: 1,
    // Editor-only: how many option slots the setup panel offers per question. The
    // game itself counts whatever elements are tagged, so raising it costs nothing
    // until slots are filled.
    options: 1,
    pickupScale: 1.25,
    snapBorderPct: 6,
    flyMs: 520,
    landScale: 0.92,
    crossFadeMs: 300,
    advanceDelayMs: 600,
    dismissMs: 260,
    captionFadeMs: 140,
    zoneX: 18,
    zoneY: 60,
    zoneW: 64,
    zoneH: 32,
  },
  defaultHintIdleMs: 3000,
  // Seeds a placed handguide that follows the live option into the drop area. The
  // node only sets where the hand starts before the game has anything to point at.
  defaultHandguide: { mode: 'combo', nodes: [{ x: 0.3, y: 0.5 }], periodMs: 1900 },
  create: createCombo,
}
