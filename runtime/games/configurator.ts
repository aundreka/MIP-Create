// Configurator: a tap-to-choose product builder. The whole board is laid out on the
// canvas as ordinary scene elements, exactly the way the Combo builder's is — the game
// mount contributes nothing visible at all and steps out of hit-testing entirely.
//
// What makes it a DIFFERENT mechanic from Combo is the two halves of the sentence it
// was written for: it is TAPPED rather than dragged, and the result is a TABLE rather
// than a stack of layers.
//
//   * tapped   an option is chosen by touching it. Nothing is carried, nothing flies,
//              and every group stays on screen at once — the player can go back and
//              change the colour after choosing the size, which a Combo board (one
//              question at a time, each answered once) cannot express.
//   * table    the composed result is ONE picture chosen by the whole combination,
//              looked up in a table of images that live in the game's own panel, not
//              on the canvas. A dresser in four finishes and three sizes is twelve
//              product shots, and each one replaces the last in the same image element.
//              Combo composes by revealing one placed layer per pick; here the answer
//              to "what does walnut + 5 drawer look like" is a photograph, and no
//              amount of layering will produce it.
//
// Roles an author tags an ordinary element with (`configRole`):
//
//   option    a tappable choice belonging to group G. Every group's options are
//             visible and live at all times. Tapping one selects it and deselects
//             whatever else was chosen in ITS group; the other groups are untouched.
//   display   the product shot. Its <img> source is replaced with whatever the table
//             holds for the current combination, cross-faded. Any number of them: a
//             hero image and a thumbnail both follow the same combination. With no
//             table entry for the combination it falls back to the art the author
//             placed, so a half-filled table still previews.
//   active    extra art that is up only while its option is selected — a tick, a
//             ring, a bold version of the label, a price. Any number per option,
//             each sitting exactly where the author placed it.
//   inactive  the mirror: up only while its option is NOT selected. Pairing an
//             'inactive' plain label with an 'active' bold one is how a label goes
//             bold on selection without either state showing through the other.
//   follow    art that belongs to an option and only ever RIDES ALONG with it — the
//             name written under a swatch. Always visible; it exists so that when the
//             row opens up to make room for a grown selection, the label travels with
//             the swatch it names instead of being left behind.
//
// The table itself is authored in the game's panel rather than on the canvas, because
// its cells are pictures of the WHOLE product, not parts of one — there is nothing to
// arrange. Its keys are flat params:
//
//   img_<c1>_<c2>_…   the product shot for that combination, one choice index per
//                     group, in group order (`img_2_3` = group 1's choice 2 with
//                     group 2's choice 3).
//   on_<g>_<c>        what option <c> of group <g> looks like while it is selected.
//
// SELECTING AN OPTION is deliberately several separate, separately dialled things,
// because the same board wants different amounts of each — and NONE of them needs a
// second picture. A board can be styled entirely from the panel:
//
//   the picture   the option's active art cross-fades in OVER its own, in place, over
//                 `activeFadeMs`. A cross-fade rather than a source swap: swapping the
//                 src blanks the element for a frame while the new file decodes, which
//                 on a swatch row reads as a flicker. Optional — leave it unset and the
//                 rest of this list is what selection looks like.
//                 How BIG that picture is drawn is its own knob, because active art is
//                 so often a different size from the thing it replaces — a swatch with
//                 a ring around it is bigger than the bare swatch by however much ring
//                 the designer drew. `activeArtScale` sets it for the board and
//                 `onScale_<g>_<c>` overrides it for one option, both measured against
//                 the option's own box, so the art is sized by eye without re-exporting
//                 it or resizing the element underneath. `activeArtX` / `activeArtY`
//                 (and `onX_<g>_<c>` / `onY_<g>_<c>`) shift it within that box, in
//                 design px, for art that is not centred on what it replaces — a ring
//                 with a tick hanging off one corner. Neither knob touches the option's
//                 own box, so nothing else on the board moves because of them.
//   the border    a ring drawn AROUND the chosen option instead of a second picture:
//                 `activeBorderColor`, `activeBorderPx`, `activeBorderRadiusPx`, held
//                 `activeBorderGapPx` clear of the art so it reads as a selection ring
//                 rather than a frame painted onto it. It fades on the same curve as
//                 the picture and costs no asset at all, which is the point — most
//                 swatch rows only ever wanted an outline.
//   the size      `activeScale` grows the chosen option about its own centre over
//                 `activeMs`. 1 is the common case — the swatch changes appearance
//                 without moving or growing at all.
//   the place     `activeOffsetX` / `activeOffsetY` nudge the chosen option off its
//                 resting spot, in design px — lifting a selected swatch out of its
//                 row. The art bound to it stays where it is; only the option moves.
//   the room      when it DOES grow, the rest of its row slides out of the way by
//                 exactly what the growth needs, on the same curve — so the gap AROUND
//                 the selection is wider than the gaps between the others, instead of
//                 the grown art colliding with its neighbours. `spreadExtraPx` opens
//                 that gap further, for a ring or a shadow that sits outside the box
//                 (`spread: 'none'` switches the whole thing off).
//
// A combination the table has no picture for is UNAVAILABLE, and `unavailable` says
// how that reads: ignored, dimmed, or hidden outright — which is what makes a fourth
// finish disappear when the size it doesn't come in is chosen. A table with nothing in
// it at all is treated as fully available, so a board still plays while it is built.
//
// Two gameplay beats are broadcast through the SFX channel, which stage.ts fans out to
// every scene element as both an animation phase and a sound binding: 'configSelect'
// (an option is tapped) and 'configChange' (the product shot actually changes — the
// beat worth popping the product on).

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'
// The shared "hidden, but still laid out" class. It is named for the game that first
// needed it; every role-based mechanic hides its off-state elements with it, and
// stage.ts ships the CSS once.
import { COMBO_OFF_CLASS } from './combo'

const OFF_CLASS = COMBO_OFF_CLASS
/** One curve for growing, for making room and for sliding back, so the selected option
 * and the row opening around it read as a single movement. */
const EASE = 'cubic-bezier(.4,0,.2,1)'

interface OptionEl {
  el: HTMLElement
  group: number
  choice: number
  /** The <img> inside it, when it has one. */
  img: HTMLImageElement | null
  /** The active picture, laid over the option's own and faded in while it is chosen.
   * Built once at start() — which also decodes it — and null when the option has no
   * active art, in which case selection shows only through the ring, the size, the
   * room it is given and its bound state art. */
  overlay: HTMLImageElement | null
  /** The selection ring, when the board is styled rather than pictured. Same lifetime
   * and same fade as the overlay. */
  ring: HTMLElement | null
  /** Resting centre, sampled with no offsets applied, so which side of the selection
   * this option sits on survives every reshuffle. */
  home: Pt
  /** How far it is currently pushed aside to make room, in px along its row's axis.
   * The selected option's own nudge is NOT part of this: it must not feed back into
   * where the row thinks this option rests. */
  offset: number
}

interface DisplayEl {
  el: HTMLElement
  img: HTMLImageElement | null
  /** The art on the canvas, shown whenever the table has nothing for the combination. */
  restSrc: string
}

/** Art bound to one option: 'active' up while it is chosen, 'inactive' up while it is
 * not, 'follow' always up. All three ride along when the row makes room. */
interface ExtraEl {
  el: HTMLElement
  group: number
  choice: number
  when: 'active' | 'inactive' | 'follow'
  /** Whether the author left it visible on the editor canvas, so destroy() can put the
   * canvas back exactly as it found it. */
  canvasShown: boolean
}

function center(el: HTMLElement): Pt {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/**
 * Where to hang a scale or a fade so it acts on the VISIBLE element.
 *
 * The outer .pa-el is positioned by layoutRec with `transform: translate(tx%,ty%)`, and
 * it rewrites the element's authored opacity onto that node on every layout pass — so
 * an inline opacity written outside is dropped at the next resize, and a scale written
 * outside slides the element by (1-s)·W/2 instead of growing it in place. The inner
 * .pa-el-anim fills the box, carries no positional transform and is not rewritten, so
 * both belong there.
 *
 * The `translate` PROPERTY is a different story: layoutRec writes `transform`, and the
 * two compose, so pushing an element aside is written on the outer node — where it
 * moves the element's whole box, art and all.
 */
function animNode(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>('.pa-el-anim') ?? el
}

/** The <img> an element paints itself with, if any: a plain image, a CTA/button's
 * picture, or the inner picture of a masked container. */
function imgOf(el: HTMLElement): HTMLImageElement | null {
  return el.querySelector<HTMLImageElement>('img.pa-img') ?? el.querySelector<HTMLImageElement>('img')
}

export function createConfigurator(): GameModule {
  let ctx: GameContext
  let params: Record<string, unknown> = {}
  /** How many option groups the board has. Never fewer than are actually tagged. */
  let groups = 1
  let swapMs = 180
  let tapScale = 1.08
  let tapMs = 140
  let activeScale = 1
  let activeMs = 260
  let activeFadeMs = 200
  let activeArtScale = 1
  let activeArtX = 0
  let activeArtY = 0
  let activeOffsetX = 0
  let activeOffsetY = 0
  let borderColor = ''
  let borderPx = 0
  let borderRadiusPx = 0
  let borderGapPx = 0
  let spread: 'none' | 'push' = 'push'
  let spreadExtraPx = 0
  let preselect = true
  let winTaps = 0
  let unavailable: 'ignore' | 'dim' | 'hide' = 'ignore'
  let unavailableOpacity = 0.35

  const options: OptionEl[] = []
  const displays: DisplayEl[] = []
  const extras: ExtraEl[] = []

  const timers: number[] = []
  /** Kept alive only so the browser finishes decoding an incoming product shot before
   * the cross-fade brings it up; dropping the reference can cancel the load. */
  const preloads: HTMLImageElement[] = []

  /** The mount's own outer .pa-el, and the inline pointer-events both it and the inner
   * slot were built with, to be handed back on destroy. */
  let shell: HTMLElement | null = null
  let shellPointerEvents = ''
  let rootPointerEvents = ''

  /** The chosen choice in each group, 1-based; 0 = nothing chosen there yet. Indexed by
   * group number, so index 0 is unused. */
  let sel: number[] = []
  /** Whether the PLAYER has chosen in each group. A pre-selection is a starting state,
   * not a move, so it never counts toward the win. */
  let touched: boolean[] = []
  let taps = 0
  let started = false
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
  const scale = (): number => ctx.scale?.() ?? 1

  // ---- groups and the table ------------------------------------------------
  /** The groups that actually have options tagged, in order. A group the author has
   * not wired up yet is not a dimension of the table: counting it would push every
   * key out of shape and leave the board with no picture it could ever look up. */
  const liveGroups = (): number[] => {
    const seen = new Set(options.map((o) => o.group))
    return Array.from({ length: groups }, (_, i) => i + 1).filter((g) => seen.has(g))
  }

  const optionsIn = (group: number): OptionEl[] => options.filter((o) => o.group === group)

  const choicesIn = (group: number): number[] => Array.from(new Set(optionsIn(group).map((o) => o.choice))).sort((a, b) => a - b)

  const chosenIn = (group: number): OptionEl | undefined => optionsIn(group).find((o) => o.choice === sel[group])

  /** The table key for a combination — one choice index per live group, in group order.
   * `override` swaps a single group's choice, which is how availability is tested
   * without disturbing the live selection. */
  const keyFor = (override?: { group: number; choice: number }): string => {
    const parts = liveGroups().map((g) => (override && override.group === g ? override.choice : (sel[g] ?? 0)))
    return parts.length ? 'img_' + parts.join('_') : ''
  }

  const assetAt = (key: string): string => {
    const v = key ? params[key] : undefined
    return typeof v === 'string' ? v : ''
  }

  /** Whether the author has filled in ANY of the table. An empty one means the board is
   * still being built, and hiding every option on it would leave nothing to tap. */
  let tableEmpty = true
  const scanTable = (): void => {
    tableEmpty = !Object.keys(params).some((k) => /^img(?:_\d+)+$/.test(k) && typeof params[k] === 'string' && params[k])
  }

  /** Can this choice be taken, given what the other groups are set to right now? */
  const isAvailable = (group: number, choice: number): boolean => {
    if (tableEmpty) return true
    // Before every group has been answered there is no full combination to look up, so
    // nothing can be ruled out yet.
    if (liveGroups().some((g) => g !== group && !sel[g])) return true
    return !!assetAt(keyFor({ group, choice }))
  }

  // ---- the selected look ---------------------------------------------------
  // Three parts, each dialled separately: the picture cross-fades, the option grows,
  // and its row opens up by exactly what the growth needs. An author who only wants
  // the picture to change leaves activeScale at 1 and gets no movement at all.

  /** Lay the active picture over the option's own, transparent to begin with. Built at
   * start() rather than on first tap so the file is decoded well before it is wanted —
   * a swatch that pops in a frame late is exactly the seam this is avoiding.
   *
   * It sits in the content's own box at `inset:0`, so it grows, moves and animates with
   * the option as one thing, and is laid out `contain` so active art with a different
   * aspect (a ring, a shadow) keeps its shape instead of being stretched to the box. */
  /** How big this option's active art is drawn, as a multiple of the option's own box:
   * the board's `activeArtScale`, or this option's own `onScale_<g>_<c>` when it has
   * one. Per option because active art is drawn per option — one swatch's ring can be
   * heavier than another's, and the alternative is re-exporting the file. */
  const artScaleOf = (o: OptionEl): number => Math.max(0.1, Math.min(5, num(params[`onScale_${o.group}_${o.choice}`], activeArtScale)))

  /** Where this option's active art sits inside its box, in DESIGN px — the board's
   * offset, or this option's own. Same reasoning as the scale: it is a property of the
   * picture, not of the element it is laid over. */
  const artOffsetOf = (o: OptionEl): Pt => ({
    x: Math.max(-400, Math.min(400, num(params[`onX_${o.group}_${o.choice}`], activeArtX))),
    y: Math.max(-400, Math.min(400, num(params[`onY_${o.group}_${o.choice}`], activeArtY))),
  })

  /** Size and place the active art inside the option's box. Re-applied on every layout
   * pass, because the offset is in design px: an 8px nudge has to stay 8px at the size
   * the board was authored at rather than 8 physical px on a phone.
   *
   * `translate` and `scale` are separate CSS properties and compose in that order, so
   * the nudge is not multiplied by the growth — moving the art 8px means 8px whether it
   * is drawn at 1x or 2x. */
  function styleOverlay(o: OptionEl): void {
    if (!o.overlay) return
    const k = scale()
    const off = artOffsetOf(o)
    const s = artScaleOf(o)
    o.overlay.style.translate = off.x || off.y ? `${off.x * k}px ${off.y * k}px` : ''
    o.overlay.style.scale = s === 1 ? '' : String(s)
  }

  const buildOverlay = (o: OptionEl): void => {
    // Idempotent: the authoring preview in mount() may already have built this one, and
    // a second <img> laid over the first would sit there at full opacity for the rest
    // of the game with nothing tracking it.
    if (o.overlay) return
    const src = ctx.assets.src(String(params[`on_${o.group}_${o.choice}`] ?? '')) || ''
    const host = o.img?.parentElement ?? animNode(o.el)
    if (!src || !host) return
    const img = document.createElement('img')
    img.className = 'pa-config-active'
    img.alt = ''
    img.draggable = false
    img.src = src
    // Sized against the option's box and grown about its own centre, so bigger art
    // spills evenly past the edges instead of pushing off one corner — and the box
    // itself never changes, which is what keeps the neighbours where the author put
    // them until the row is deliberately asked to open up.
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transform-origin:center center;'
    if (!host.style.position) host.style.position = 'relative'
    host.appendChild(img)
    o.overlay = img
    styleOverlay(o)
  }

  /** The selection ring: a box drawn around the option, transparent until it is chosen.
   * Its own element rather than a border on the option, because a border on the option
   * would change what the box measures — and so where every neighbour sits — the moment
   * it appeared. Sized in DESIGN px and re-sized on every relayout, so a 2px ring is 2px
   * at the size the board was authored at rather than 2 physical px on a phone. */
  const buildRing = (o: OptionEl): void => {
    if (o.ring) return // already built by the authoring preview (see buildOverlay)
    const host = o.img?.parentElement ?? animNode(o.el)
    if (!borderColor || borderPx <= 0 || !host) return
    const ring = document.createElement('div')
    ring.className = 'pa-config-ring'
    ring.style.cssText = 'position:absolute;box-sizing:border-box;pointer-events:none;opacity:0;'
    if (!host.style.position) host.style.position = 'relative'
    host.appendChild(ring)
    o.ring = ring
    styleRing(o)
  }

  function styleRing(o: OptionEl): void {
    if (!o.ring) return
    const k = scale()
    const gap = borderGapPx * k
    o.ring.style.inset = `${-gap}px`
    o.ring.style.border = `${borderPx * k}px solid ${borderColor}`
    o.ring.style.borderRadius = `${borderRadiusPx * k}px`
  }

  const paintOverlay = (o: OptionEl, animate: boolean): void => {
    const on = sel[o.group] === o.choice
    const ms = animate ? activeFadeMs : 0
    for (const node of [o.overlay, o.ring]) {
      if (!node) continue
      node.style.transition = ms > 0 ? `opacity ${ms}ms ease` : ''
      node.style.opacity = on ? '1' : '0'
    }
  }

  /** The option's standing size: grown while it is the chosen one. The tap pop rides on
   * top of this as a multiplier, so the two never overwrite each other. */
  const restScale = (o: OptionEl): number => (sel[o.group] === o.choice ? activeScale : 1)

  const setScale = (o: OptionEl, value: number, ms: number): void => {
    const node = animNode(o.el)
    node.style.transition = ms > 0 ? `scale ${ms}ms ${EASE}` : ''
    node.style.scale = value === 1 ? '' : String(value)
  }

  /** The art bound to an option — its label, its tick, its bold caption — all of which
   * slide along with it when its row is pushed aside. */
  const followers = (o: OptionEl): HTMLElement[] => extras.filter((x) => x.group === o.group && x.choice === o.choice).map((x) => x.el)

  /** Which way a group's options run, judged from where the author actually put them:
   * the axis they are more spread out along is the row. */
  const axisOf = (group: number): 'x' | 'y' => {
    const homes = optionsIn(group).map((o) => o.home)
    if (homes.length < 2) return 'x'
    const spanX = Math.max(...homes.map((h) => h.x)) - Math.min(...homes.map((h) => h.x))
    const spanY = Math.max(...homes.map((h) => h.y)) - Math.min(...homes.map((h) => h.y))
    return spanY > spanX ? 'y' : 'x'
  }

  /** Resting centres, taken with the current offsets subtracted back out, so ordering
   * along the row is judged on where the author placed things rather than on where the
   * last selection happened to leave them. */
  const sampleHomes = (): void => {
    const k = scale()
    for (const o of options) {
      const c = center(o.el)
      const axis = axisOf(o.group)
      // Both of the things that move an option have to come back out: the row's spread
      // AND, on the chosen one, its own nudge. Leaving the nudge in would let a lifted
      // swatch drift a little further every time the row was re-measured.
      const chosen = sel[o.group] === o.choice
      const x = c.x - (axis === 'x' ? o.offset : 0) - (chosen ? activeOffsetX * k : 0)
      const y = c.y - (axis === 'y' ? o.offset : 0) - (chosen ? activeOffsetY * k : 0)
      o.home = { x, y }
    }
  }

  /** Where an option is pushed to, and where its bound art is pushed to — which are not
   * the same thing. Both share the row's spread; only the option itself also carries the
   * selected nudge, so lifting a chosen swatch doesn't drag its name plate off its
   * baseline with it. */
  const setOffset = (o: OptionEl, axis: 'x' | 'y', px: number, animate: boolean): void => {
    o.offset = px
    const k = scale()
    const spreadX = axis === 'x' ? px : 0
    const spreadY = axis === 'y' ? px : 0
    const chosen = sel[o.group] === o.choice
    const ms = animate && activeMs > 0 ? `translate ${activeMs}ms ${EASE}` : ''
    o.el.style.transition = ms
    o.el.style.translate = `${spreadX + (chosen ? activeOffsetX * k : 0)}px ${spreadY + (chosen ? activeOffsetY * k : 0)}px`
    for (const el of followers(o)) {
      el.style.transition = ms
      el.style.translate = `${spreadX}px ${spreadY}px`
    }
  }

  /** Open each row up around its selection. Every option on one side of the chosen one
   * slides that way by the same distance, so the gaps between them stay exactly as the
   * author set them and only the gap AROUND the selection grows. */
  const applySpread = (animate: boolean): void => {
    for (const g of liveGroups()) {
      const axis = axisOf(g)
      const chosen = chosenIn(g)
      let distance = 0
      if (spread === 'push' && chosen) {
        // What the growth actually needs: half the extra width it takes up, since it
        // grows about its own centre and eats into both neighbours equally.
        //
        // Both growths count. The option can be scaled up, and its active art can be
        // drawn bigger again on top of that — a ringed swatch is wider than the swatch
        // whether or not the element grew — so the room is measured against whichever
        // of the two ends up widest.
        const r = chosen.el.getBoundingClientRect()
        const size = axis === 'x' ? r.width : r.height
        const grow = Math.max(1, activeScale, chosen.overlay ? activeScale * artScaleOf(chosen) : 1)
        distance = Math.max(0, ((grow - 1) * size) / 2 + spreadExtraPx * scale())
      }
      for (const o of optionsIn(g)) {
        const mine = o.home[axis]
        const theirs = chosen?.home[axis] ?? 0
        const push = !chosen || o === chosen || !distance || mine === theirs ? 0 : mine < theirs ? -distance : distance
        setOffset(o, axis, push, animate)
      }
    }
  }

  // ---- painting ------------------------------------------------------------
  const paintOption = (o: OptionEl, animate: boolean): void => {
    o.el.dataset.configSelected = sel[o.group] === o.choice ? '1' : '0'
    paintOverlay(o, animate)
    setScale(o, restScale(o), animate ? activeMs : 0)
    // An unavailable choice is either untouchable and faded, or gone. Both leave the
    // element in layout, so the row keeps its spacing either way.
    const free = isAvailable(o.group, o.choice)
    if (unavailable === 'hide' && !free) {
      hide(o.el)
      o.el.style.pointerEvents = 'none'
    } else {
      show(o.el)
      o.el.style.pointerEvents = 'auto'
      const node = animNode(o.el)
      if (unavailable === 'dim' && !free) {
        node.style.opacity = String(unavailableOpacity)
        o.el.style.pointerEvents = 'none'
      } else if (node.style.opacity) {
        node.style.opacity = ''
      }
    }
  }

  const paintExtras = (): void => {
    for (const x of extras) {
      if (x.when === 'follow') continue // always up; it only ever moves
      const on = sel[x.group] === x.choice
      if (x.when === 'active' ? on : !on) show(x.el)
      else hide(x.el)
    }
  }

  /** Swap a display over to `src`, cross-faded through transparent so the two pictures
   * trade places rather than snapping. The fade rides on the inner node's opacity —
   * layoutRec owns the outer's (see animNode). */
  const setDisplaySrc = (d: DisplayEl, src: string, animate: boolean): boolean => {
    if (!d.img) return false
    const want = src || d.restSrc
    if (!want || d.img.getAttribute('src') === want) return false
    const node = animNode(d.el)
    if (!animate || swapMs <= 0) {
      d.img.setAttribute('src', want)
      return true
    }
    // Start the decode now, so the picture is ready by the time the fade is half over
    // and the swap doesn't land on an empty frame.
    const pre = new Image()
    pre.src = want
    preloads.push(pre)
    const half = Math.round(swapMs / 2)
    node.style.transition = `opacity ${half}ms ease`
    node.style.opacity = '0'
    after(half, () => {
      d.img?.setAttribute('src', want)
      node.style.opacity = '1'
      after(half, () => {
        node.style.transition = ''
        // layoutRec owns this property; leaving a 1 behind would silently promote a
        // half-transparent display to solid at the next layout pass.
        node.style.opacity = ''
      })
    })
    return true
  }

  /** Look the current combination up and put it on every display. Returns whether the
   * picture actually changed, so the caller knows whether to sound the beat. */
  const paintDisplays = (animate: boolean): boolean => {
    const src = ctx.assets.src(assetAt(keyFor())) || ''
    let changed = false
    for (const d of displays) if (setDisplaySrc(d, src, animate)) changed = true
    return changed
  }

  const repaint = (animate: boolean): boolean => {
    for (const o of options) paintOption(o, animate)
    paintExtras()
    applySpread(animate)
    return paintDisplays(animate)
  }

  // ---- hint ----------------------------------------------------------------
  /** The option a hint should point at: the first available choice in the first group
   * the player has not answered yet. */
  const liveOption = (): OptionEl | undefined => {
    if (done) return undefined
    for (const g of liveGroups()) {
      if (touched[g]) continue
      const pick = optionsIn(g).find((o) => o.choice !== sel[g] && isAvailable(o.group, o.choice))
      if (pick) return pick
    }
    return undefined
  }

  /** Publish it as `data-config-hint`, the way the combo board publishes its live
   * option, so a placed handguide can follow the same attribute. */
  const markHint = (): void => {
    const live = liveOption()
    for (const o of options) {
      if (o === live) o.el.dataset.configHint = '1'
      else delete o.el.dataset.configHint
    }
  }

  // ---- selection -----------------------------------------------------------
  const finish = (): void => {
    if (done) return
    done = true
    markHint()
    ctx.sfx.play('gameWin')
    winCb?.()
    completeCb?.()
  }

  /** Every group answered, or the tap target met — whichever the author asked for. */
  const checkWin = (): void => {
    if (done) return
    if (winTaps > 0) {
      if (taps >= winTaps) finish()
      return
    }
    const live = liveGroups()
    if (live.length && live.every((g) => touched[g])) finish()
  }

  /** Move any group whose choice the new selection has ruled out onto one it still
   * allows. Without this a board with an unavailable combination can be walked into a
   * state that has no picture at all — the player chooses the size the white finish
   * doesn't come in, and the product simply vanishes. */
  const reconcile = (changed: number): void => {
    if (tableEmpty) return
    for (const g of liveGroups()) {
      if (g === changed || !sel[g] || isAvailable(g, sel[g])) continue
      const fallback = choicesIn(g).find((c) => isAvailable(g, c))
      if (fallback) sel[g] = fallback
    }
  }

  /** A quick pop under the finger, on top of whatever standing size the option has, so
   * a tap on the choice already showing still answers the touch. */
  const pop = (o: OptionEl): void => {
    if (tapScale === 1 || tapMs <= 0) return
    setScale(o, restScale(o) * tapScale, tapMs)
    after(tapMs, () => setScale(o, restScale(o), tapMs))
  }

  /** A tap does NOT stop once the game is won. Winning a configurator only unlocks
   * whatever comes next — the CTA, the scene advance — and the player is very likely to
   * keep trying finishes while they look at it. Freezing the board at that moment (the
   * way a combo question does, having actually been answered) would read as a bug. */
  const select = (o: OptionEl): void => {
    pop(o)
    ctx.sfx.play('configSelect')
    const repeat = sel[o.group] === o.choice
    // A repeat tap still counts as answering the group — the player has made that
    // choice their own, whether or not it was already showing.
    taps++
    touched[o.group] = true
    if (!repeat) {
      sel[o.group] = o.choice
      reconcile(o.group)
    }
    if (repaint(true)) ctx.sfx.play('configChange')
    markHint()
    checkWin()
  }

  const attachTap = (o: OptionEl): void => {
    o.el.style.cursor = 'pointer'
    o.el.style.pointerEvents = 'auto'
    o.el.style.touchAction = 'manipulation'
    // iOS raises its own press-and-hold sheet over an image — "Save Image", the
    // selection magnifier — which reads as the board freezing under the finger.
    o.el.style.setProperty('-webkit-touch-callout', 'none')
    o.el.style.setProperty('-webkit-tap-highlight-color', 'transparent')
    o.el.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      select(o)
    })
  }

  // ---- element discovery ---------------------------------------------------
  const collect = (): void => {
    const stageRoot = ctx.root.closest('.pa-root')
    if (!stageRoot) return
    for (const el of Array.from(stageRoot.querySelectorAll<HTMLElement>('[data-config-role]'))) {
      const wanted = el.dataset.configGameId
      // An element addressed to another configurator is not ours; an unaddressed one is
      // claimed first-come so two games in a scene can't fight over it.
      if (wanted ? wanted !== ctx.elementId : !!el.dataset.configClaimedBy) continue
      el.dataset.configClaimedBy = ctx.elementId ?? 'configurator'
      const role = el.dataset.configRole
      const group = Math.max(1, Math.round(Number(el.dataset.configGroup) || 1))
      const choice = Math.max(1, Math.round(Number(el.dataset.configChoice) || 1))
      const img = imgOf(el)
      if (role === 'option') {
        options.push({ el, group, choice, img, overlay: null, ring: null, home: { x: 0, y: 0 }, offset: 0 })
      } else if (role === 'display') {
        displays.push({ el, img, restSrc: img?.getAttribute('src') ?? '' })
      } else if (role === 'active' || role === 'inactive' || role === 'follow') {
        extras.push({ el, group, choice, when: role, canvasShown: el.dataset.configCanvasShow === '1' })
      }
    }
    // Never fewer dimensions than are actually wired: a group tagged past the count in
    // the panel would otherwise be dropped from every table key.
    groups = Math.max(groups, ...options.map((o) => o.group), 1)
  }

  return {
    mount(c, p) {
      ctx = c
      params = p
      groups = Math.max(1, Math.round(num(p.groups, 1)))
      swapMs = Math.max(0, Math.min(3000, num(p.swapMs, 180)))
      tapScale = Math.max(0.5, Math.min(2, num(p.tapScale, 1.08)))
      tapMs = Math.max(0, Math.min(1000, num(p.tapMs, 140)))
      activeScale = Math.max(0.5, Math.min(3, num(p.activeScale, 1)))
      activeMs = Math.max(0, Math.min(3000, num(p.activeMs, 260)))
      activeFadeMs = Math.max(0, Math.min(3000, num(p.activeFadeMs, 200)))
      activeArtScale = Math.max(0.1, Math.min(5, num(p.activeArtScale, 1)))
      activeArtX = Math.max(-400, Math.min(400, num(p.activeArtX, 0)))
      activeArtY = Math.max(-400, Math.min(400, num(p.activeArtY, 0)))
      activeOffsetX = Math.max(-400, Math.min(400, num(p.activeOffsetX, 0)))
      activeOffsetY = Math.max(-400, Math.min(400, num(p.activeOffsetY, 0)))
      borderColor = typeof p.activeBorderColor === 'string' ? p.activeBorderColor : ''
      borderPx = Math.max(0, Math.min(40, num(p.activeBorderPx, 0)))
      borderRadiusPx = Math.max(0, Math.min(999, num(p.activeBorderRadiusPx, 0)))
      borderGapPx = Math.max(-200, Math.min(200, num(p.activeBorderGapPx, 0)))
      spread = String(p.spread ?? 'push') === 'none' ? 'none' : 'push'
      // Negative is allowed: art with a lot of transparent padding already carries its
      // own breathing room, and the row should be able to close back up around it.
      spreadExtraPx = Math.max(-400, Math.min(400, num(p.spreadExtraPx, 0)))
      winTaps = Math.max(0, Math.round(num(p.winTaps, 0)))
      preselect = p.preselect !== false && p.preselect !== 'false'
      const mode = String(p.unavailable ?? 'ignore')
      unavailable = mode === 'dim' || mode === 'hide' ? mode : 'ignore'
      unavailableOpacity = Math.max(0, Math.min(1, num(p.unavailableOpacity, 0.35)))

      // Step the whole mount out of hit-testing. Nothing inside it is ever touched —
      // every interactive piece of a configurator is a tagged scene element sitting
      // outside this box — but the box itself is an author-sized rectangle, invisible
      // and hit-testable by default like any other game mount, and wherever it lands
      // above an option in the layer order it would silently swallow the taps over the
      // overlapping part. See the same note in combo.ts.
      shell = ctx.root.closest<HTMLElement>('.pa-el')
      shellPointerEvents = shell?.style.pointerEvents ?? ''
      rootPointerEvents = ctx.root.style.pointerEvents
      if (shell) shell.style.pointerEvents = 'none'
      ctx.root.style.pointerEvents = 'none'

      collect()
      scanTable()
      // Nothing is selected or hidden here on purpose: mount() also runs on the static
      // editor canvas, where every option and every piece of state art must stay
      // visible and selectable. start() (interactive only) is what collapses the board
      // to one live combination.
      //
      // The one exception is AUTHORING PREVIEW: `canvasPreview` names an option whose
      // selected look should be drawn right here on the canvas ('2_3'), so the size and
      // position of its active art can be dialled in against the real layout instead of
      // in a preview-and-back loop. Only what lives inside the option's own box — the
      // art and the ring — so the canvas never lies about where anything is placed.
      // start() runs in the same synchronous call for real playback and repaints
      // everything from the live selection, so this can never reach a player.
      const preview = String(p.canvasPreview ?? '')
      if (preview) {
        const [pg, pc] = preview.split('_').map((n) => Math.round(Number(n) || 0))
        const target = options.find((opt) => opt.group === pg && opt.choice === pc)
        if (target) {
          buildOverlay(target)
          buildRing(target)
          if (target.overlay) target.overlay.style.opacity = '1'
          if (target.ring) target.ring.style.opacity = '1'
          setScale(target, activeScale, 0)
        }
      }
    },
    start() {
      if (started) return
      started = true
      sel = []
      touched = []
      taps = 0
      const live = liveGroups()
      if (!live.length) {
        // Nothing is wired up at all — win immediately rather than stranding the player
        // on a board with nothing to tap.
        finish()
        return
      }
      for (const o of options) {
        buildOverlay(o)
        buildRing(o)
      }
      sampleHomes()
      // A pre-selection is the state the scene OPENS in: the first choice of every
      // group, so a product is on screen from the first painted frame rather than
      // appearing once the player commits to something.
      if (preselect) for (const g of live) sel[g] = choicesIn(g)[0] ?? 0
      // Instantly, not animated, for the same reason: a board that opens by growing its
      // first swatch in front of the player is a transition nobody asked for.
      repaint(false)
      markHint()
      options.forEach(attachTap)
    },
    relayout() {
      if (!started) return
      // Positions move under the offsets on a resize, so put everything back to rest,
      // re-measure where the author's layout now puts each option, and re-open the row
      // around the selection — all without animation, since a resize is not a beat.
      for (const o of options) {
        setOffset(o, axisOf(o.group), 0, false)
        styleRing(o)
        styleOverlay(o)
      }
      sampleHomes()
      applySpread(false)
    },
    getHint(): HintMove | null {
      const o = liveOption()
      if (!o) return null
      const p = center(o.el)
      return { from: p, to: p, kind: 'tap' }
    },
    getHintTarget(): HTMLElement | null {
      return liveOption()?.el ?? null
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      clearTimers()
      preloads.length = 0
      if (shell) shell.style.pointerEvents = shellPointerEvents
      shell = null
      ctx.root.style.pointerEvents = rootPointerEvents
      ctx.root.innerHTML = ''
      for (const o of options) {
        o.overlay?.remove()
        o.overlay = null
        o.ring?.remove()
        o.ring = null
        o.el.classList.remove(OFF_CLASS)
        o.el.style.pointerEvents = ''
        o.el.style.cursor = ''
        o.el.style.touchAction = ''
        o.el.style.transition = ''
        o.el.style.translate = ''
        o.el.style.removeProperty('-webkit-touch-callout')
        o.el.style.removeProperty('-webkit-tap-highlight-color')
        const node = animNode(o.el)
        node.style.transition = ''
        node.style.scale = ''
        node.style.opacity = ''
        o.offset = 0
        delete o.el.dataset.configSelected
        delete o.el.dataset.configHint
        delete o.el.dataset.configClaimedBy
      }
      for (const d of displays) {
        if (d.img && d.restSrc) d.img.setAttribute('src', d.restSrc)
        const node = animNode(d.el)
        node.style.transition = ''
        node.style.opacity = ''
        delete d.el.dataset.configClaimedBy
      }
      for (const x of extras) {
        // Put the canvas back exactly as it was found: one the author had shown stays
        // shown, one they had hidden stays hidden. A follower was never hidden at all.
        if (x.when === 'follow' || x.canvasShown) x.el.classList.remove(OFF_CLASS)
        else x.el.classList.add(OFF_CLASS)
        x.el.style.transition = ''
        x.el.style.translate = ''
        delete x.el.dataset.configClaimedBy
      }
      options.length = 0
      displays.length = 0
      extras.length = 0
      sel = []
      touched = []
      taps = 0
      done = false
      started = false
    },
  }
}

export const CONFIGURATOR_TEMPLATE: GameTemplate = {
  id: 'configurator',
  label: 'Configurator',
  paramFields: [
    // 'groups' and 'options' are both uncapped and both rendered by the editor's own
    // Configurator setup panel, right above the per-group chips.
    { key: 'groups', label: 'Option groups', type: 'number', min: 1, step: 1 },
    { key: 'options', label: 'Options per group', type: 'number', min: 1, step: 1 },
    { key: 'swapMs', label: 'Product cross-fade (ms)', type: 'number', group: 'Feel & timing', min: 0, max: 3000, step: 20 },
    { key: 'activeFadeMs', label: 'Selected art cross-fade (ms)', type: 'number', group: 'Feel & timing', min: 0, max: 3000, step: 20 },
    { key: 'activeScale', label: 'Selected option size (1 = no growth)', type: 'number', group: 'Selected look', min: 0.5, max: 3, step: 0.02 },
    { key: 'activeArtScale', label: 'Selected image size (1 = fills the option)', type: 'number', group: 'Selected look', min: 0.1, max: 5, step: 0.02 },
    { key: 'activeArtX', label: 'Selected image X (px)', type: 'number', group: 'Selected look', min: -400, max: 400, step: 1 },
    { key: 'activeArtY', label: 'Selected image Y (px)', type: 'number', group: 'Selected look', min: -400, max: 400, step: 1 },
    { key: 'activeOffsetX', label: 'Selected nudge X (px)', type: 'number', group: 'Selected look', min: -400, max: 400, step: 1 },
    { key: 'activeOffsetY', label: 'Selected nudge Y (px)', type: 'number', group: 'Selected look', min: -400, max: 400, step: 1 },
    { key: 'activeBorderColor', label: 'Selected border colour', type: 'color', group: 'Selected look' },
    { key: 'activeBorderPx', label: 'Selected border weight (px)', type: 'number', group: 'Selected look', min: 0, max: 40, step: 1 },
    { key: 'activeBorderRadiusPx', label: 'Selected border radius (px)', type: 'number', group: 'Selected look', min: 0, max: 999, step: 1 },
    { key: 'activeBorderGapPx', label: 'Selected border gap (px)', type: 'number', group: 'Selected look', min: -200, max: 200, step: 1 },
    { key: 'spreadExtraPx', label: 'Extra gap around the selection (px)', type: 'number', group: 'Selected look', min: -400, max: 400, step: 2 },
    { key: 'activeMs', label: 'Grow / move / make room (ms)', type: 'number', group: 'Feel & timing', min: 0, max: 3000, step: 20 },
    { key: 'tapScale', label: 'Tap pop scale', type: 'number', group: 'Feel & timing', min: 0.5, max: 2, step: 0.02 },
    { key: 'tapMs', label: 'Tap pop (ms)', type: 'number', group: 'Feel & timing', min: 0, max: 1000, step: 20 },
  ],
  defaultParams: {
    groups: 1,
    // Editor-only: how many option slots the setup panel offers per group. The game
    // counts whatever elements are tagged, so raising it costs nothing until slots
    // are filled.
    options: 1,
    // 0 = won once the player has chosen in every group. Any other number wins on that
    // many taps, however many groups are wired up.
    winTaps: 0,
    // Open on the first choice of every group, so a product is on screen from the first
    // frame instead of appearing once the player commits to something.
    preselect: true,
    // How a choice the table has no picture for reads: left alone, faded and dead, or
    // gone entirely — which is what makes a finish disappear when the size it doesn't
    // come in is chosen.
    unavailable: 'ignore',
    unavailableOpacity: 0.35,
    swapMs: 180,
    // The selected look. 1 = the option changes picture without moving or growing at
    // all, which is the common case; above 1 it grows and its row slides aside to make
    // exactly that much room ('none' switches the row apart).
    activeScale: 1,
    // How big the selected IMAGE is drawn inside the option's box — its own knob,
    // because active art is so often a different size from what it replaces. Per-option
    // overrides ride alongside it as onScale_<group>_<choice>.
    // Authoring only: the option whose selected look is drawn on the canvas while it is
    // being sized ('group_choice'). start() repaints from the live selection, so it can
    // never reach a player.
    canvasPreview: '',
    activeArtScale: 1,
    activeArtX: 0,
    activeArtY: 0,
    activeMs: 260,
    activeFadeMs: 200,
    // The styled selected state, for a board that wants an outline rather than a second
    // picture. No colour = no ring, which is why the weight can sit at a usable default.
    activeBorderColor: '',
    activeBorderPx: 2,
    activeBorderRadiusPx: 0,
    activeBorderGapPx: 4,
    activeOffsetX: 0,
    activeOffsetY: 0,
    spread: 'push',
    spreadExtraPx: 0,
    tapScale: 1.08,
    tapMs: 140,
  },
  defaultHintIdleMs: 3000,
  // Seeds a placed handguide that taps its way through the groups: it follows the live
  // option the game publishes as data-config-hint, moves on as each group is answered,
  // and goes quiet once there is nothing left to choose. The node only sets where the
  // hand starts, before the board has anything to point at.
  defaultHandguide: { mode: 'configurator', nodes: [{ x: 0.5, y: 0.7 }], periodMs: 1100 },
  create: createConfigurator,
}
