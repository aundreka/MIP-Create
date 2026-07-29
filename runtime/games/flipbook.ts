// Flipbook: a book that opens and turns its pages. It starts closed on its cover;
// drag the right-hand page toward the spine (or just tap it) and the page swings
// over to reveal the next opening. Turning the LAST page wins, so the reward art
// lives on the final opening and the scene's reveal takes it from there.
//
// ART: one image per PAGE — a left page and a right page for each opening, plus one
// cover. Nothing is ever sliced, stretched or squeezed: every image is drawn at the
// book's height with whatever width its own pixels give it, so the pages are shown
// true to scale. Left and right art that were exported to meet cleanly will meet
// cleanly here, because the fold IS the edge where the two images touch — there is no
// "spine %" to line up.
//
// GEOMETRY: the spine is a FIXED point. The right page sits to its right, the left
// page to its left, and the shut cover sits ON the right page — covering it, which is
// what a shut book does. Opening swings the cover about the spine and to the left,
// uncovering the right page and landing on the left one. Nothing translates: a book
// that slides sideways as it opens does not read as a book.
//
// The turn is a CSS 3D leaf hinged on the spine: one page-sized div with
// transform-origin at its left edge, rotateY(0 -> -180deg), front face = the page (or
// cover) being turned, back face = the left page it becomes. Its box eases from the
// front art's size to the back art's PAST 90 degrees — before that the front is what
// you see, so it must hold its exact shape; after it, only the back shows, so the
// change is invisible and the leaf lands exactly on the left page.
//
// The artwork owns the look: it is already drawn with its own gutter, page edges and
// shadows, so this adds no decoration of its own.

import { emit } from '../emitter'
import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num, str } from './types'

const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
// Ease both ends: the release tween starts from a moving finger and has to settle
// flat against the page under it.
const ease = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)

/** One image: its source and the width/height ratio of its own pixels (0 = unknown). */
interface Art {
  src: string
  ratio: number
}
const NO_ART: Art = { src: '', ratio: 0 }

export function createFlipbook(): GameModule {
  let ctx: GameContext
  let openings = 2
  let hasCover = true
  let bookScale = 1
  let coverScale = 1
  let anchorOn: 'cover' | 'spread' = 'cover'
  let curl = 0 // dog-ear depth on a turning PAGE (the cover never folds)
  let pop = 0.06 // the bounce when the book lands on its last page (0 = none)
  let lastPageDelay = 1000 // how long the 'lastPage' cue waits before sounding
  let popDelay = 0 // how long the bounce waits — its own beat, independent of the cue
  let pageAspect = 0.6 // fallback ratio for art whose size we can't read
  let flipMs = 750
  let shade = false
  let pageColor = '#fdf6e3'
  let coverColor = '#e3c04a'
  let cover: Art = NO_ART
  let lefts: Art[] = []
  let rights: Art[] = []

  let book: HTMLDivElement
  let underLeft: HTMLDivElement
  let underRight: HTMLDivElement
  let leaf: HTMLDivElement
  let leafFront: HTMLDivElement
  let leafBack: HTMLDivElement
  let fold: HTMLDivElement
  let foldArt: HTMLDivElement
  let frontShade: HTMLDivElement
  let backShade: HTMLDivElement

  let bh = 0 // the book's height — the one thing that is laid out
  let sh = 0 // the slot's height, so the book can sit centred in it
  let spineX = 0 // the fold, fixed in slot coordinates
  let state = 0
  let progress = 0 // 0..1 through the flip out of `state`
  let started = false
  let dragging = false
  let animating = false
  let done = false
  // Set the instant the LAST turn is committed to — not when it lands. From then on
  // the book is finished: the win has been reported and the scene is counting down to
  // its redirect, so nothing may flip it back or shut it again.
  let locked = false
  let destroyed = false
  let raf = 0
  let popRaf = 0
  const timers: number[] = []
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null

  const totalStates = (): number => (hasCover ? 1 : 0) + openings
  const isCover = (s: number): boolean => hasCover && s === 0
  /** Index into lefts/rights for a state (only valid when it isn't the cover). */
  const pageIdx = (s: number): number => (hasCover ? s - 1 : s)
  const hasNext = (): boolean => state + 1 < totalStates()

  /** An image's width when drawn at `hScale` of the book's height — its own ratio, so
   * it is never distorted. (The cover is the only thing with an hScale of its own.) */
  const width = (a: Art, hScale = 1): number => bh * hScale * (a.ratio > 0 ? a.ratio : pageAspect)
  const coverW = (): number => width(cover, coverScale)
  const leftArt = (s: number): Art => (isCover(s) ? NO_ART : lefts[pageIdx(s)] ?? NO_ART)
  const rightArt = (s: number): Art => (isCover(s) ? cover : rights[pageIdx(s)] ?? NO_ART)

  /** How far a leaf has morphed into the left page it is becoming: nothing until it
   * passes 90deg (its own face is still what you see, so it must hold its exact size
   * and shape), then all of it by the time it lies flat. */
  const morph = (p: number): number => clamp01((p - 0.5) * 2)
  /** The turning leaf: starts as the page/cover being turned, ends as the left page
   * of the next opening — so it lands on that page exactly. */
  const leafW = (s: number, p: number): number => {
    const from = isCover(s) ? coverW() : width(rightArt(s))
    const to = s + 1 < totalStates() ? width(leftArt(s + 1)) : from
    return from + (to - from) * morph(p)
  }
  const leafH = (s: number, p: number): number => {
    const from = isCover(s) ? bh * coverScale : bh
    return from + (bh - from) * morph(p)
  }

  const div = (css: string, tag: string): HTMLDivElement => {
    const el = document.createElement('div')
    el.style.cssText = css
    el.dataset.fb = tag
    return el
  }

  /** Draw one whole image into a box that is already its own shape, so it fills it
   * exactly and is never distorted at rest. (A turning leaf's box eases toward the
   * next page's shape while only its hidden face is showing — that compression is
   * what foreshortening looks like.) */
  const paint = (el: HTMLDivElement, a: Art, fallback: string): void => {
    if (a.src) {
      el.style.backgroundColor = 'transparent'
      el.style.backgroundImage = `url("${a.src}")`
      el.style.backgroundRepeat = 'no-repeat'
      el.style.backgroundSize = '100% 100%'
      el.style.backgroundPosition = 'center'
    } else {
      el.style.backgroundImage = 'none'
      el.style.backgroundColor = fallback
    }
  }

  /** The crease of the dog-ear, as points from (w, h-f) down to (w-f, h). Paper does
   * not fold on a knife edge, so it is a shallow arc bowing toward the corner rather
   * than a straight diagonal — sampled as a polygon, which every engine clips
   * reliably (unlike clip-path: path()). */
  const crease = (w: number, h: number, f: number): [number, number][] => {
    const ax = w
    const ay = h - f
    const bx = w - f
    const by = h
    // Control point pulled toward the corner: how much the crease bows.
    const cx = (ax + bx) / 2 + f * 0.16
    const cy = (ay + by) / 2 + f * 0.16
    const pts: [number, number][] = []
    for (let i = 0; i <= 8; i++) {
      const t = i / 8
      const u = 1 - t
      pts.push([u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by])
    }
    return pts
  }

  const box = (el: HTMLDivElement, left: number, top: number, w: number, h: number): void => {
    el.style.left = left + 'px'
    el.style.top = top + 'px'
    el.style.width = w + 'px'
    el.style.height = h + 'px'
  }

  const render = (): void => {
    if (!book) return
    const s = state
    const p = progress
    const next = s + 1 < totalStates() ? s + 1 : -1
    const y = sh / 2 - bh / 2 // the pages sit centred in the slot

    // The pages under the leaf: the left page of where we are, and the right page of
    // where we are going (the leaf covers it until the turn lifts).
    const showLeft = isCover(s) && next >= 0 ? leftArt(next) : leftArt(s)
    paint(underLeft, showLeft, pageColor)
    box(underLeft, spineX - width(showLeft), y, width(showLeft), bh)
    // Behind a shut cover there is nothing yet — fade the incoming left page in under
    // the swinging cover so cover art narrower than the page can't leave a hole.
    underLeft.style.opacity = isCover(s) ? String(clamp01((p - 0.5) * 2)) : '1'

    const showRight = next >= 0 ? rightArt(next) : rightArt(s)
    paint(underRight, showRight, pageColor)
    box(underRight, spineX, y, width(showRight), bh)
    // A shut book shows nothing but its cover: cover art rarely fills its box edge to
    // edge (rounded corners, a drop shadow, a margin) and any gap would leak the page
    // staged underneath. Hold it back until the cover actually lifts.
    underRight.style.opacity = isCover(s) ? String(clamp01(p * 5)) : '1'

    // The leaf, hinged on the spine and turning to the left.
    leaf.style.display = next >= 0 ? 'block' : 'none'
    const lw = leafW(s, p)
    const lh = leafH(s, p)
    box(leaf, spineX, sh / 2 - lh / 2, lw, lh)
    leaf.style.transform = `translateZ(${Math.sin(p * Math.PI) * bh * 0.012}px) rotateY(${-p * 180}deg)`
    paint(leafFront, rightArt(s), isCover(s) ? coverColor : pageColor)
    if (next >= 0) paint(leafBack, leftArt(next), pageColor)

    // Paper bends; board does not. A PAGE gets a slight lag in its free edge and — the
    // thing that actually reads as paper — a DOG-EAR: the bottom-right corner is cut
    // clean off the sheet and the flap that came away is drawn folded back over it,
    // showing the sheet's reverse. Both peak side-on and are gone by the time it lies
    // flat. The COVER is left rigid, because a hardback is.
    // NO skew. Shearing the sheet makes its free edge taller, while the 3D rotation is
    // making that same edge shorter — two contradictory depth cues at once, which reads
    // as a crooked rhombus rather than paper. The dog-ear carries the whole cue.
    const bend = isCover(s) ? 0 : curl * Math.sin(p * Math.PI)

    const foldPx = bend * Math.min(lw, lh) * 0.4
    if (foldPx > 0.5 && next >= 0) {
      const poly = crease(lw, lh, foldPx)
        .map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`)
        .join(', ')
      // Take the corner off the sheet along the crease...
      leafFront.style.clipPath = `polygon(0px 0px, ${lw.toFixed(1)}px 0px, ${poly}, 0px ${lh.toFixed(1)}px)`
      // ...and lay the flap that came away back over the gap it left.
      fold.style.display = 'block'
      fold.style.clipPath = `polygon(${poly}, ${lw.toFixed(1)}px ${lh.toFixed(1)}px)`
      paint(foldArt, leftArt(next), pageColor)
      foldArt.style.width = lw + 'px'
      foldArt.style.height = lh + 'px'
      foldArt.style.transform = `matrix(0, 1, -1, 0, ${(lw + lh - foldPx).toFixed(2)}, ${(lh - foldPx).toFixed(2)})`
    } else {
      leafFront.style.clipPath = ''
      fold.style.display = 'none'
    }

    // Off by default — the art is drawn with its own shading. On, the face turning
    // away darkens and the one arriving lightens.
    frontShade.style.opacity = shade ? String(0.05 + 0.45 * p) : '0'
    backShade.style.opacity = shade ? String(0.5 * (1 - p)) : '0'
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    // HEIGHT is the only thing laid out. Every image is then as wide as its own art
    // makes it at that height — true to scale, never squeezed to fit. A wide opening
    // is allowed to run past the slot; the root draws outside its box, so it simply
    // shows on bigger screens.
    sh = h
    bh = h * 0.98 * bookScale
    // Anchor the fold once, and never move it again. `anchor` picks WHAT is centred in
    // the slot: the shut cover (the first thing seen — but then the open book's left
    // page reaches further left, possibly off screen), or the open book (both pages
    // always fit, but the shut cover sits right of centre, as a real book does).
    const openShift = (width(rights[0] ?? NO_ART) - width(lefts[0] ?? NO_ART)) / 2
    spineX = hasCover && anchorOn === 'cover' ? w / 2 - coverW() / 2 : w / 2 - openShift
    book.style.width = w + 'px'
    book.style.height = h + 'px'
    ctx.root.style.perspective = bh * 2 + 'px'
    render()
  }

  const stopRaf = (): void => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  /** A timer that is guaranteed not to outlive the game — a delayed sound firing into
   * a scene that has already moved on would be worse than no sound. */
  const after = (ms: number, fn: () => void): void => {
    timers.push(
      window.setTimeout(() => {
        if (!destroyed) fn()
      }, ms),
    )
  }

  /** The bounce the book gives when it lands on its last page. A DAMPED OSCILLATION
   * driven frame by frame rather than a pair of chained CSS transitions: those meet at
   * the peak with a velocity jump, which is exactly the corner that reads as stiff.
   * This starts and ends at rest (the envelope is zero at both ends) and settles at
   * precisely 1, so it never leaves the book a hair off its size. Scaled about the
   * fold, so it flexes around its spine rather than drifting sideways. */
  const POP_MS = 620
  // sin(3πu)·(1-u)² peaks at ~0.7162 (u ≈ 0.1415); dividing by that makes the first
  // swell land on exactly the percentage asked for.
  const popAt = (u: number): number => (Math.sin(Math.PI * u * 3) * Math.pow(1 - u, 2)) / 0.7162
  const popLastPage = (): void => {
    if (pop <= 0 || !book) return
    book.style.transformOrigin = `${spineX}px 50%`
    const t0 = performance.now()
    const step = (): void => {
      if (destroyed || !book) return
      const u = clamp01((performance.now() - t0) / POP_MS)
      book.style.transform = `scale(${(1 + pop * popAt(u)).toFixed(4)})`
      if (u < 1) popRaf = requestAnimationFrame(step)
      else {
        popRaf = 0
        book.style.transform = 'scale(1)'
      }
    }
    popRaf = requestAnimationFrame(step)
  }

  const animateTo = (target: number, onDone?: () => void): void => {
    stopRaf()
    animating = true
    const from = progress
    const dur = Math.max(60, flipMs * Math.abs(target - from))
    const t0 = performance.now()
    const step = (): void => {
      if (destroyed) return
      const k = clamp01((performance.now() - t0) / dur)
      progress = from + (target - from) * ease(k)
      render()
      if (k < 1) {
        raf = requestAnimationFrame(step)
      } else {
        raf = 0
        animating = false
        progress = target
        render()
        onDone?.()
      }
    }
    raf = requestAnimationFrame(step)
  }

  /** Announce which page is open (1-based: page 1 is the shut cover when there is one)
   * so scene elements bound to a page can show and hide with it. */
  const announce = (): void => emit('book-page', state + 1)

  /** Land the flip: adopt the next state and report the win on the last page. */
  const commit = (): void => {
    state = Math.min(state + 1, totalStates() - 1)
    progress = 0
    render()
    announce()
    if (!hasNext() && !done) {
      done = true
      locked = true // fully open, and staying that way
      // On its own beat — by default the instant the page lands, but it can be held
      // back independently of the sound.
      popDelay > 0 ? after(popDelay, popLastPage) : popLastPage()
      completeCb?.()
    }
  }

  const flipForward = (): void => {
    if (locked) return
    // The win fires as the last page starts its committed swing, not after it lands,
    // so the win sound rides the turn instead of trailing it — and the book locks at
    // the same moment, so the turn it just won on can't be dragged back during the
    // scene's post-win delay.
    const last = state + 2 >= totalStates()
    if (last) {
      locked = true
      winCb?.()
    }
    ctx.sfx.play('flip')
    // A separate cue for the turn that reaches the final page, so the reward reveal can
    // have its own sound without hijacking the ordinary page-turn one. Held back a beat
    // so it lands ON the reveal rather than under the page still turning.
    if (last) after(lastPageDelay, () => ctx.sfx.play('lastPage'))
    animateTo(1, commit)
  }

  const onDown = (e: PointerEvent): void => {
    if (locked || done || animating || !hasNext()) return
    e.preventDefault()
    dragging = true
    const startX = e.clientX
    const travel = Math.max(1, leafW(state, 0) * 0.9)
    let dx = 0
    // Capture keeps the drag alive if the finger leaves the book — but it throws for a
    // pointer id the browser has no live record of (synthesised events, which some ad
    // SDKs and automation produce). Losing capture is survivable; losing the drag is not.
    try {
      ctx.root.setPointerCapture?.(e.pointerId)
    } catch {
      /* no capture — the window-level listeners below still carry the drag */
    }
    const endDrag = (): void => {
      dragging = false
      ctx.root.removeEventListener('pointermove', move)
      ctx.root.removeEventListener('pointerup', up)
      ctx.root.removeEventListener('pointercancel', up)
    }
    const move = (ev: PointerEvent): void => {
      if (!dragging) return
      dx = startX - ev.clientX // leftward drag = turning the page
      progress = clamp01(dx / travel)
      render()
      // Dragged the page all the way over: land it now rather than waiting for the
      // finger to lift. Otherwise the turn LOOKS finished while still uncommitted,
      // and dragging back would undo a page the player has already turned.
      if (progress >= 1) {
        endDrag()
        flipForward()
      }
    }
    const up = (): void => {
      if (!dragging) return
      endDrag()
      // A tap turns the page, and so does ANY leftward swipe however small — the rest
      // of the turn plays out on its own. Only a deliberate drag the OTHER way is
      // read as "no", and even that just settles back to the page you are already on:
      // there is no backward turn, so a book can never be shut again once opened.
      if (dx > -6) flipForward()
      else animateTo(0)
    }
    ctx.root.addEventListener('pointermove', move)
    ctx.root.addEventListener('pointerup', up)
    ctx.root.addEventListener('pointercancel', up)
  }

  return {
    mount(c, params) {
      ctx = c
      openings = Math.max(1, Math.min(6, Math.round(num(params.spreads, 2))))
      hasCover = bool(params.hasCover, true)
      if (!hasCover && openings < 2) openings = 2 // need at least one turn
      bookScale = Math.max(0.2, Math.min(2, num(params.bookScale, 100) / 100))
      coverScale = Math.max(0.2, Math.min(1.5, num(params.coverScale, 100) / 100))
      anchorOn = params.anchor === 'spread' ? 'spread' : 'cover'
      curl = Math.max(0, Math.min(1, num(params.pageCurl, 0) / 100))
      pop = Math.max(0, Math.min(0.4, num(params.lastPagePop, 6) / 100))
      lastPageDelay = Math.max(0, Math.min(5000, num(params.lastPageDelayMs, 1000)))
      popDelay = Math.max(0, Math.min(5000, num(params.lastPagePopDelayMs, 0)))
      pageAspect = Math.max(0.2, Math.min(2, num(params.aspect, 0.6)))
      flipMs = Math.max(200, Math.min(2000, num(params.flipMs, 750)))
      shade = bool(params.shade, false)
      pageColor = str(params.pageColor, '#fdf6e3')
      coverColor = str(params.coverColor, '#e3c04a')

      // Read each image's own pixel size; anything the host can't size gets measured
      // from the image itself and re-laid out once it reports back.
      const pending: Art[] = []
      const art = (id: unknown): Art => {
        const key = typeof id === 'string' ? id : ''
        const src = ctx.assets.src(key)
        const s = key ? ctx.assets.size?.(key) ?? null : null
        const a: Art = { src, ratio: s && s.w > 0 && s.h > 0 ? s.w / s.h : 0 }
        if (src && !a.ratio) pending.push(a)
        return a
      }
      const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
      cover = art(params.cover)
      lefts = Array.from({ length: openings }, (_, i) => art(list(params.leftPages)[i]))
      rights = Array.from({ length: openings }, (_, i) => art(list(params.rightPages)[i]))
      if (typeof Image !== 'undefined')
        for (const a of pending) {
          const probe = new Image()
          probe.onload = (): void => {
            if (destroyed || !probe.naturalWidth || !probe.naturalHeight) return
            a.ratio = probe.naturalWidth / probe.naturalHeight
            layout()
          }
          probe.src = a.src
        }

      ctx.root.style.touchAction = 'none'
      ctx.root.style.perspectiveOrigin = '50% 50%'
      // The game slot clips by default (.pa-game is overflow:hidden). A turning page
      // stands OUT of the book — perspective throws it past the book's top and bottom
      // as it lifts — and an opening can be wider than its slot on purpose, so let
      // this one draw outside its box instead of being cut off.
      ctx.root.style.overflow = 'visible'

      const page = 'position:absolute;box-sizing:border-box;background-repeat:no-repeat;'
      book = div('position:absolute;left:0;top:0;transform-style:preserve-3d;', 'book')
      underLeft = div(page, 'under-left')
      underRight = div(page, 'under-right')
      leaf = div('position:absolute;transform-origin:left center;transform-style:preserve-3d;will-change:transform;', 'leaf')
      const faceCss = 'position:absolute;inset:0;backface-visibility:hidden;background-repeat:no-repeat;overflow:hidden;'
      leafFront = div(faceCss, 'leaf-front')
      // The folded-back corner. It lives on the LEAF, not inside the front face — the
      // face is clipped along the crease, so anything parented to it would be cut away
      // with the corner. backface-visibility ties it to the front: once the page passes
      // 90deg you are looking at its reverse, where there is no flap to see.
      //
      // It spans the whole leaf and is clipped to the flap, so its child can be laid
      // out in plain leaf coordinates — which is what lets the reflection below be
      // written as one honest matrix.
      fold = div('position:absolute;inset:0;display:none;backface-visibility:hidden;overflow:hidden;', 'fold')
      // The flap's skin. A folded corner shows the sheet's REVERSE, reflected across
      // the crease — so this carries the back face's art under the composite of those
      // two mirrors. Working it through for a 45deg crease on a w x h leaf with fold f:
      //
      //   reverse-side printing:  (x,y) -> (w-x, y)          [the back reads correctly
      //                                                       when the page turns]
      //   reflection in the crease: (x,y) -> (-y + w+h-f, -x + w+h-f)
      //
      // Composed and written as a CSS matrix about the origin, that is
      // matrix(0, 1, -1, 0, w+h-f, h-f). It maps the back art's bottom-LEFT corner onto
      // the flap's apex and holds every point of the crease fixed — which is exactly
      // what "the skin lines up" means, and what the old version got wrong.
      foldArt = div('position:absolute;left:0;top:0;transform-origin:0 0;background-repeat:no-repeat;', 'fold-art')
      // Contact shade: darkest in the crease, gone by the flap's tip.
      const foldShade = div(
        'position:absolute;inset:0;pointer-events:none;background:linear-gradient(135deg,rgba(0,0,0,.30),rgba(0,0,0,.06) 45%,rgba(255,255,255,.10));',
        'fold-shade',
      )
      fold.appendChild(foldArt)
      fold.appendChild(foldShade)
      leafBack = div(faceCss + 'transform:rotateY(180deg);', 'leaf-back')
      const shadeCss = 'position:absolute;inset:0;pointer-events:none;'
      frontShade = div(shadeCss + 'background:linear-gradient(270deg,rgba(0,0,0,.55),rgba(0,0,0,0) 55%);', 'front-shade')
      backShade = div(shadeCss + 'background:linear-gradient(90deg,rgba(0,0,0,.55),rgba(0,0,0,0) 55%);', 'back-shade')

      leafFront.appendChild(frontShade)
      leafBack.appendChild(backShade)
      leaf.appendChild(leafFront)
      leaf.appendChild(leafBack)
      leaf.appendChild(fold)
      book.appendChild(underLeft)
      book.appendChild(underRight)
      book.appendChild(leaf)
      ctx.root.appendChild(book)
      layout()
    },
    start() {
      if (started) return
      started = true
      announce() // page 1 is open from the off
      ctx.root.addEventListener('pointerdown', onDown as EventListener)
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done || !hasNext()) return null
      const r = leaf.getBoundingClientRect()
      const y = r.top + r.height * 0.62
      const from: Pt = { x: r.right - r.width * 0.18, y }
      return { from, to: { x: r.left + r.width * 0.12, y }, kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      destroyed = true
      stopRaf()
      if (popRaf) cancelAnimationFrame(popRaf)
      popRaf = 0
      for (const t of timers) window.clearTimeout(t)
      timers.length = 0
      ctx.root.removeEventListener('pointerdown', onDown as EventListener)
      ctx.root.style.perspective = ''
      ctx.root.innerHTML = ''
    },
  }
}

export const FLIPBOOK_TEMPLATE: GameTemplate = {
  id: 'flipbook',
  label: 'Flip the page (book)',
  paramFields: [
    { key: 'spreads', label: 'Page openings', type: 'number', min: 1, max: 6, step: 1 },
    { key: 'hasCover', label: 'Start closed (cover)', type: 'boolean' },
    { key: 'bookScale', label: 'Book size (%)', type: 'number', min: 20, max: 200, step: 1 },
    { key: 'coverScale', label: 'Cover height (% of the pages)', type: 'number', min: 20, max: 150, step: 1 },
    { key: 'anchor', label: 'Centre in the slot', type: 'select', options: ['cover', 'spread'] },
    { key: 'aspect', label: 'Page width ÷ height (only if art size unknown)', type: 'number', min: 0.2, max: 2, step: 0.01 },
    { key: 'flipMs', label: 'Flip duration (ms)', type: 'number', min: 200, max: 2000, step: 50 },
    { key: 'pageCurl', label: 'Page dog-ear (%, 0 = off) — only reads if the two sides differ', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'lastPagePop', label: 'Last-page bounce (%, 0 = none)', type: 'number', min: 0, max: 40, step: 1 },
    { key: 'lastPageDelayMs', label: 'Last-page sound delay (ms)', type: 'number', min: 0, max: 5000, step: 50 },
    { key: 'lastPagePopDelayMs', label: 'Last-page bounce delay (ms)', type: 'number', min: 0, max: 5000, step: 50 },
    { key: 'shade', label: 'Add shading while turning', type: 'boolean' },
    { key: 'coverColor', label: 'Cover colour (no art)', type: 'color' },
    { key: 'pageColor', label: 'Page colour (no art)', type: 'color' },
  ],
  assetSlots: [
    { key: 'cover', label: 'Closed book cover (sits on the right page)' },
    { key: 'leftPages', label: 'Left page', list: true, countParam: 'spreads' },
    { key: 'rightPages', label: 'Right page', list: true, countParam: 'spreads' },
  ],
  defaultParams: {
    spreads: 2,
    hasCover: true,
    bookScale: 100,
    coverScale: 100,
    anchor: 'cover',
    aspect: 0.6,
    flipMs: 750,
    pageCurl: 0,
    lastPagePop: 6,
    lastPageDelayMs: 1000,
    lastPagePopDelayMs: 0,
    shade: false,
    coverColor: '#e3c04a',
    pageColor: '#fdf6e3',
    cover: '',
    leftPages: [],
    rightPages: [],
  },
  // Drag the outer edge of the right page in toward the spine.
  defaultHandguide: {
    nodes: [
      { x: 0.72, y: 0.62 },
      { x: 0.4, y: 0.62 },
    ],
    periodMs: 1700,
  },
  create: createFlipbook,
}
