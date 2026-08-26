// Carousel: a horizontal row of choices the player swipes through. The centre
// slot IS the selection — an item eases up to `centerScale` as it arrives and
// back down as it leaves, so the enlargement alone marks the pick (deliberately
// no outline, frame or border).
//
// MOTION — everything runs off one rAF loop over a single float `pos` (the
// carousel's position in item units). Dragging writes `pos` directly; releasing
// projects the flick velocity forward, rounds to the item it would land on, and
// hands that to a CRITICALLY DAMPED spring (c = 2√k), which glides in and stops
// dead without the overshoot-wobble a CSS transition-per-step gives. Because the
// spring keeps the release velocity, a flick and its settle are one continuous
// motion rather than a fling followed by a snap. With `loop` on, `pos` is never
// clamped and each item's offset is taken modulo the count, so the row rotates
// forever in either direction; with it off the ends rubber-band.
//
// TWO STATES, ONE EASING — every option owns its art and its label as ONE unit
// (they share a `wrap` that the slot position moves), so a label never drifts
// away from the choice it names, whichever slot that choice is sitting in. Each
// piece is authored twice: a BASE size/offset it holds in every side slot, and a
// CENTRE size/offset it reaches when selected. Both are driven by the same eased
// `t` (0 at a side slot, 1 dead centre), so the centre choice can be bigger AND
// somewhere else entirely — lifted, nudged, its label pushed clear — while every
// other slot stays exactly as authored, and the trip between the two is smooth.
//
// LINKING — the settled choice is published into a selection group (selection.ts),
// which is the same store the Inspector's "Fill slot" elements read. Give any
// scene element `fill` with this game's group and it swaps its source to the
// carousel's current choice: the swatch stays in the game, the big preview lives
// wherever the author put it.

import { cssFontFamily } from '../font'
import { setPicks } from '../selection'
import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { num, str } from './types'

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']

// Spring pulling `pos` to the settled item. Critically damped, so it never
// overshoots — a carousel that bounces past the choice reads as sloppy.
const STIFFNESS = 110
const DAMPING = 2 * Math.sqrt(STIFFNESS)
// How far ahead a release's velocity is projected when choosing the landing item,
// and the most items that projection may carry it. Without the cap a hard fling on
// a fast screen throws the row most of the way round, and the player loses track of
// which choice they were on.
const FLICK_PROJECT_S = 0.14
const MAX_FLICK_CARRY = 3

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

function channels(color: string): [number, number, number] | null {
  const m = HEX.exec(color.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Blend two #rgb/#rrggbb colours. Anything else (named, rgba()) hard-switches. */
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

/** Shortest signed distance across a ring of `n` slots, in (-n/2, n/2]. */
export function wrapDelta(d: number, n: number): number {
  if (n <= 0) return d
  let x = ((d % n) + n) % n
  if (x > n / 2) x -= n
  return x
}

/** Which item a release lands on: where the flick carries it, rounded. */
export function landingIndex(pos: number, vel: number): number {
  return Math.round(pos + clamp(vel * FLICK_PROJECT_S, -MAX_FLICK_CARRY, MAX_FLICK_CARRY))
}

interface Item {
  wrap: HTMLDivElement
  art: HTMLDivElement
  label: HTMLDivElement
  /** Set when this option's label is a picture rather than typed text. */
  labelImg: HTMLImageElement | null
  index: number
}

export function createCarousel(): GameModule {
  let ctx: GameContext
  let count = 5
  let images: string[] = []
  let results: string[] = []
  let labels: string[] = []
  let group = 'carousel'
  let loop = true
  let live = true
  let changesToWin = 3
  // Sizes and gaps are DESIGN px, the unit the rest of the editor works in: the number
  // typed is the size drawn, and it does not shift when the game box is resized.
  let itemWpx = 240
  let itemHpx = 240
  let gapXpx = 64
  let gapYpx = 34
  let rowDY = 0
  let centerScale = 1.45
  let sideScale = 1
  let centerDX = 0 // centre-slot art offset, design px
  let centerDY = 0
  let sideOpacity = 1
  let tiltDeg = 0
  let showLabels = true
  let labelSize = 26
  let labelActiveSize = 34
  let labelColor = '#5b6472'
  let labelActiveColor = '#101418'
  let labelWeight = 500
  let labelActiveWeight = 800
  let labelFont = ''
  let labelActiveFont = ''
  let labelImgH = 40 // label picture height in design px (side slots)
  let labelImgCenterScale = 1.25
  let labelDX = 0 // label offset in EVERY slot, design px
  let labelDY = 0
  let labelCenterDX = 0 // label offset once the option is centred
  let labelCenterDY = 0

  const items: Item[] = []
  let w = 300
  let h = 400
  let itemW = 66
  let itemH = 66
  let step = 84
  let gapY = 10
  let span = 4
  let artCy = 48 // art centre, in wrap-local px
  let labelCy = 100 // label centre, in wrap-local px

  // Motion state. `pos` is in item units; `target` is the item it is settling on.
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

  let published = -1
  let settledIdx = 0 // what is at the centre right now (drives the pass-by tick)
  let lastSettled = 0 // what it came to rest on last, so only real changes count
  let changes = 0
  let started = false
  let done = false
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null

  const sc = (): number => ctx.scale?.() ?? 1
  /** `pos` (or any slot number) folded back onto a real item index. */
  const idxOf = (p: number): number => {
    const r = Math.round(p)
    return count > 0 ? ((r % count) + count) % count : 0
  }
  /** A label's own height in this slot state — pictures share one height, typed
   * labels are as tall as their type. */
  const labelHeightOf = (it: Item, centred: boolean): number =>
    it.labelImg ? labelImgH * sc() * (centred ? Math.max(1, labelImgCenterScale) : 1) : (centred ? Math.max(labelSize, labelActiveSize) : labelSize) * sc() * 1.35

  const publish = (i: number): void => {
    if (i === published) return
    published = i
    if (group) setPicks(group, [results[i] || images[i] || ''])
  }

  const layout = (): void => {
    w = ctx.root.clientWidth || 300
    h = ctx.root.clientHeight || 400
    const s0 = sc()
    itemW = Math.max(8, itemWpx * s0)
    itemH = Math.max(8, itemHpx * s0)
    // One slot to the next: the choice plus the gap you asked for. Reading the pitch
    // straight off the two numbers means a gap of 0 really does butt them together.
    step = Math.max(4, itemW + gapXpx * s0)
    gapY = gapYpx * s0
    // Draw only what can actually reach the screen. When looping, an item's offset
    // flips sign at half the ring and it teleports to the other end — keeping the
    // drawn span inside the viewport means that flip always happens out of sight.
    // Centre offsets are excluded on purpose: they only apply to the centre item,
    // which is nowhere near the wrap boundary.
    span = (w / 2 + (itemW * Math.max(sideScale, centerScale)) / 2) / step + 0.02

    // Reserve room for BOTH states of both pieces, then centre that whole envelope
    // in the mount — so lifting or growing the centre choice doesn't shove the row
    // off its own box. Measured from the art's un-offset centre at y = 0.
    const s = sc()
    const baseH = items.length ? Math.max(...items.map((it) => labelHeightOf(it, false))) : 0
    const cenH = items.length ? Math.max(...items.map((it) => labelHeightOf(it, true))) : 0
    labelCy = itemH / 2 + gapY + baseH / 2
    let minY = Math.min((-itemH * sideScale) / 2, (-itemH * centerScale) / 2 + centerDY * s)
    let maxY = Math.max((itemH * sideScale) / 2, (itemH * centerScale) / 2 + centerDY * s)
    if (showLabels) {
      minY = Math.min(minY, labelCy - baseH / 2 + labelDY * s, labelCy - cenH / 2 + labelCenterDY * s)
      maxY = Math.max(maxY, labelCy + baseH / 2 + labelDY * s, labelCy + cenH / 2 + labelCenterDY * s)
    }
    artCy = -minY
    const top = (h - (maxY - minY)) / 2 + rowDY * s

    for (const it of items) {
      it.wrap.style.width = itemW + 'px'
      it.wrap.style.top = top + 'px'
      it.art.style.top = artCy - itemH / 2 + 'px'
      it.art.style.height = itemH + 'px'
      it.art.style.fontSize = itemH * 0.3 + 'px'
      it.art.style.borderRadius = itemH * 0.5 + 'px'
      it.label.style.top = artCy + labelCy + 'px'
      if (it.labelImg) it.labelImg.style.height = labelImgH * s + 'px'
    }
    render()
  }

  const render = (): void => {
    const cx = w / 2 - itemW / 2
    const s = sc()
    for (const it of items) {
      const d = loop ? wrapDelta(it.index - pos, count) : it.index - pos
      const ad = Math.abs(d)
      if (ad > span) {
        it.wrap.style.visibility = 'hidden'
        continue
      }
      it.wrap.style.visibility = 'visible'
      // t = 0 in a side slot, 1 dead centre. One easing drives every difference
      // between the two authored states, so they can differ freely and still
      // travel smoothly into each other.
      const t = smooth(clamp(1 - ad, 0, 1))
      it.wrap.style.transform = `translate3d(${cx + d * step}px,0,0)`
      it.wrap.style.zIndex = String(1000 - Math.round(ad * 100))
      it.wrap.style.opacity = String(sideOpacity + (1 - sideOpacity) * t)
      const z = tiltDeg ? -Math.min(ad, 2) * itemW * 0.2 : 0
      const ry = tiltDeg ? -clamp(d, -1.6, 1.6) * tiltDeg : 0
      const scale = lerp(sideScale, centerScale, t)
      it.art.style.transform = `translate3d(${centerDX * s * t}px,${centerDY * s * t}px,${z}px) rotateY(${ry}deg) scale(${scale})`
      if (!showLabels) continue
      const lx = lerp(labelDX, labelCenterDX, t) * s
      const ly = lerp(labelDY, labelCenterDY, t) * s
      if (it.labelImg) {
        it.label.style.transform = `translate(-50%,-50%) translate(${lx}px,${ly}px) scale(${lerp(1, labelImgCenterScale, t)})`
      } else {
        // Typed labels re-set font-size instead of scaling, so they stay crisp.
        it.label.style.transform = `translate(-50%,-50%) translate(${lx}px,${ly}px)`
        if (labelActiveFont) {
          // A font FAMILY cannot be interpolated, so it swaps at the halfway point — by
          // which time the label is visibly on its way in or out, where a swap reads as
          // intended rather than as a glitch.
          it.label.style.fontFamily = (t > 0.5 ? labelActiveFont : labelFont) || '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
        }
        it.label.style.fontSize = lerp(labelSize, labelActiveSize, t) * s + 'px'
        it.label.style.fontWeight = String(Math.round(lerp(labelWeight, labelActiveWeight, t)))
        it.label.style.color = mix(labelColor, labelActiveColor, t)
      }
    }
  }

  /** The centre item changed mid-swipe: tick, and (when live) swap the linked art. */
  const passCentre = (): void => {
    const i = idxOf(pos)
    if (i === settledIdx && published === i) return
    if (i !== settledIdx) ctx.sfx.play('tap')
    settledIdx = i
    if (live) publish(i)
  }

  const settle = (): void => {
    const i = idxOf(pos)
    publish(i)
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

  /** Aim at a slot number (may sit outside 0..count-1 when looping — that is what
   * lets the row keep turning the short way instead of unwinding). */
  const goTo = (slot: number): void => {
    target = loop ? slot : clamp(slot, 0, count - 1)
    run()
  }

  const onDown = (e: PointerEvent): void => {
    if (done && changesToWin > 0) return
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
    // Finger px/s → item units/s, sign-flipped: dragging left advances the row.
    vel = dt > 0.001 ? -(sampleX - prevSampleX) / dt / step : 0
    if (moved < 6) {
      // A tap, not a swipe: bring whichever item was tapped to the centre.
      const hit = items.find((it) => it.wrap.contains(e.target as Node))
      const base = Math.round(pos)
      goTo(hit ? base + (loop ? wrapDelta(hit.index - base, count) : hit.index - base) : base)
      vel = 0
    } else {
      goTo(landingIndex(pos, vel))
    }
  }

  return {
    mount(c, params) {
      ctx = c
      count = Math.max(2, Math.min(12, Math.round(num(params.count, 5))))
      const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
      const ids = list(params.images)
      images = ids.map((id) => (id ? ctx.assets.src(id) : ''))
      results = list(params.results)
      const labelIds = list(params.labelImages)
      labels = str(params.labels, '')
        .split(',')
        .map((s) => s.trim())
      group = str(params.linkGroup, 'carousel').trim()
      loop = params.loop !== false
      live = params.liveUpdate !== false
      changesToWin = Math.max(0, Math.round(num(params.changesToWin, 3)))
      // Projects authored before these were design px carry the old % of the game
      // width; convert them once here so nothing has to be re-dialled by hand.
      const designW = ctx.root.clientWidth / (sc() || 1) || 1080
      const legacy = (pct: unknown): number | undefined => (typeof pct === 'number' && isFinite(pct) ? (pct / 100) * designW : undefined)
      const legacyW = legacy(params.itemPct)
      itemWpx = clamp(num(params.itemWidthPx, legacyW ?? 240), 4, 4000)
      itemHpx = clamp(num(params.itemHeightPx, itemWpx / clamp(num(params.itemAspect, 1), 0.2, 5)), 4, 4000)
      gapXpx = clamp(num(params.gapPx, legacy(params.gapPct) ?? 64), 0, 4000)
      gapYpx = clamp(num(params.labelGapPx, itemHpx * 0.14), 0, 2000)
      rowDY = clamp(num(params.rowOffsetY, 0), -4000, 4000)
      centerScale = clamp(num(params.centerScale, 1.45), 0.2, 3)
      sideScale = clamp(num(params.sideScale, 1), 0.2, 2)
      centerDX = clamp(num(params.centerOffsetX, 0), -2000, 2000)
      centerDY = clamp(num(params.centerOffsetY, 0), -2000, 2000)
      sideOpacity = clamp(num(params.sideOpacityPct, 100), 0, 100) / 100
      tiltDeg = clamp(num(params.tiltDeg, 0), 0, 70)
      showLabels = params.showLabels !== false
      labelSize = clamp(num(params.labelSizePx, 26), 4, 300)
      labelActiveSize = clamp(num(params.labelActiveSizePx, 34), 4, 300)
      labelColor = str(params.labelColor, '#5b6472')
      labelActiveColor = str(params.labelActiveColor, '#101418')
      labelWeight = clamp(num(params.labelWeight, 500), 100, 900)
      labelActiveWeight = clamp(num(params.labelActiveWeight, 800), 100, 900)
      labelFont = cssFontFamily(str(params.labelFontFamily, ''))
      // Blank means the selected label keeps the same face as the rest.
      labelActiveFont = cssFontFamily(str(params.labelActiveFontFamily, ''))
      labelImgH = clamp(num(params.labelImgHeightPx, 40), 4, 600)
      labelImgCenterScale = clamp(num(params.labelImgCenterScale, 1.25), 0.2, 4)
      labelDX = clamp(num(params.labelOffsetX, 0), -2000, 2000)
      labelDY = clamp(num(params.labelOffsetY, 0), -2000, 2000)
      labelCenterDX = clamp(num(params.labelCenterOffsetX, 0), -2000, 2000)
      labelCenterDY = clamp(num(params.labelCenterOffsetY, 0), -2000, 2000)

      ctx.root.style.touchAction = 'none'
      ctx.root.style.overflow = 'hidden'
      if (tiltDeg) {
        ctx.root.style.perspective = '1200px'
        ctx.root.style.perspectiveOrigin = '50% 50%'
      }
      for (let i = 0; i < count; i++) {
        const wrap = document.createElement('div')
        wrap.style.cssText = 'position:absolute;left:0;top:0;will-change:transform,opacity;transform-style:preserve-3d;'
        const art = document.createElement('div')
        art.style.cssText =
          'position:absolute;left:0;width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;' +
          'color:#fff;font-weight:800;user-select:none;will-change:transform;backface-visibility:hidden;'
        if (images[i]) {
          const img = document.createElement('img')
          img.src = images[i]
          img.alt = ''
          img.draggable = false
          img.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;'
          art.appendChild(img)
        } else {
          art.style.background = PALETTE[i % PALETTE.length]
          art.textContent = String(i + 1)
        }
        // The label rides inside the same wrap as its art, so whichever slot the
        // option travels to, its label travels with it — offsets below are always
        // relative to that option's own art, never to the slot.
        const label = document.createElement('div')
        label.className = 'pa-carousel-label'
        label.style.cssText = 'position:absolute;left:50%;top:0;text-align:center;white-space:nowrap;line-height:1.2;user-select:none;pointer-events:none;will-change:transform;'
        let labelImg: HTMLImageElement | null = null
        const labelSrc = labelIds[i] ? ctx.assets.src(labelIds[i]) : ''
        if (labelSrc) {
          labelImg = document.createElement('img')
          labelImg.src = labelSrc
          labelImg.alt = ''
          labelImg.draggable = false
          // Height-sized, width left to the picture's own aspect: a long wordmark
          // and a short one then read at the same weight, the way type would.
          labelImg.style.cssText = 'display:block;width:auto;pointer-events:none;'
          label.appendChild(labelImg)
        } else {
          label.style.fontFamily = labelFont || '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
          label.textContent = labels[i] ?? ''
        }
        if (!showLabels) label.style.display = 'none'
        wrap.appendChild(art)
        wrap.appendChild(label)
        ctx.root.appendChild(wrap)
        items.push({ wrap, art, label, labelImg, index: i })
      }
      const start = Math.round(num(params.startIndex, -1))
      pos = target = settledIdx = lastSettled = start >= 0 && start < count ? start : Math.floor(count / 2)
      publish(settledIdx)
      layout()
    },
    start() {
      if (started) return
      started = true
      ctx.root.style.cursor = 'grab'
      ctx.root.addEventListener('pointerdown', onDown)
      ctx.root.addEventListener('pointermove', onMove)
      ctx.root.addEventListener('pointerup', onUp)
      ctx.root.addEventListener('pointercancel', onUp)
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done && changesToWin > 0) return null
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
      ctx.root.removeEventListener('pointerdown', onDown)
      ctx.root.removeEventListener('pointermove', onMove)
      ctx.root.removeEventListener('pointerup', onUp)
      ctx.root.removeEventListener('pointercancel', onUp)
      ctx.root.innerHTML = ''
      items.length = 0
    },
  }
}

const labelsOn = (p: Record<string, unknown>): boolean => p.showLabels !== false
/** True once any option has been given a label picture — the picture controls
 * replace the type controls for those options. */
const hasLabelImages = (p: Record<string, unknown>): boolean => Array.isArray(p.labelImages) && (p.labelImages as string[]).some(Boolean)
/** True only when EVERY option has one, i.e. no typed label is left to style. */
const allLabelImages = (p: Record<string, unknown>): boolean => {
  const n = Math.max(2, Math.min(12, Math.round(typeof p.count === 'number' ? p.count : 5)))
  const a = p.labelImages
  return Array.isArray(a) && a.length >= n && (a as string[]).slice(0, n).every(Boolean)
}
const typedLabels = (p: Record<string, unknown>): boolean => labelsOn(p) && !allLabelImages(p)
const pictureLabels = (p: Record<string, unknown>): boolean => labelsOn(p) && hasLabelImages(p)

export const CAROUSEL_TEMPLATE: GameTemplate = {
  id: 'carousel',
  label: 'Carousel (swipe to choose)',
  paramFields: [
    { key: 'count', group: 'Choices', label: 'Choices', type: 'number', min: 2, max: 12, step: 1 },
    { key: 'labels', group: 'Choices', label: 'Labels under each choice (comma-separated)', type: 'text', showIf: typedLabels },
    { key: 'changesToWin', group: 'Choices', label: 'Changes before it counts as won (0 = never, the CTA ends it)', type: 'number', min: 0, max: 12, step: 1 },
    { key: 'loop', group: 'Choices', label: 'Loop around forever', type: 'boolean' },
    { key: 'startIndex', group: 'Choices', label: 'Starting choice (0-based, -1 = middle)', type: 'number', min: -1, max: 11, step: 1 },
    { key: 'itemWidthPx', group: 'Size & spacing', label: 'Choice width (design px)', type: 'number', min: 4, max: 4000, step: 2 },
    { key: 'itemHeightPx', group: 'Size & spacing', label: 'Choice height (design px)', type: 'number', min: 4, max: 4000, step: 2 },
    { key: 'gapPx', group: 'Size & spacing', label: 'Gap between choices (design px)', type: 'number', min: 0, max: 4000, step: 2 },
    { key: 'rowOffsetY', group: 'Size & spacing', label: 'Move the whole row up / down (design px)', type: 'number', min: -4000, max: 4000, step: 2 },
    { key: 'labelGapPx', group: 'Size & spacing', label: 'Gap under the choice, before the label (design px)', type: 'number', min: 0, max: 2000, step: 2, showIf: labelsOn },
    { key: 'sideScale', group: 'Side choices', label: 'Side choices size (×)', type: 'number', min: 0.2, max: 2, step: 0.05 },
    { key: 'sideOpacityPct', group: 'Side choices', label: 'Side choices opacity (%)', type: 'number', min: 0, max: 100, step: 5 },
    { key: 'tiltDeg', group: 'Side choices', label: '3D turn per step (deg, 0 = flat)', type: 'number', min: 0, max: 70, step: 1 },
    { key: 'centerScale', group: 'Centre (selected)', label: 'CENTRE choice size (× — this is the whole selection cue)', type: 'number', min: 0.2, max: 3, step: 0.05 },
    { key: 'centerOffsetX', group: 'Centre (selected)', label: 'CENTRE choice nudge X (design px)', type: 'number', min: -2000, max: 2000, step: 1 },
    { key: 'centerOffsetY', group: 'Centre (selected)', label: 'CENTRE choice nudge Y (design px, − is up)', type: 'number', min: -2000, max: 2000, step: 1 },
    { key: 'showLabels', group: 'Labels', label: 'Show the labels', type: 'boolean' },
    { key: 'labelOffsetX', group: 'Labels', label: 'Label nudge X, every slot (design px)', type: 'number', min: -2000, max: 2000, step: 1, showIf: labelsOn },
    { key: 'labelOffsetY', group: 'Labels', label: 'Label nudge Y, every slot (design px, − is up)', type: 'number', min: -2000, max: 2000, step: 1, showIf: labelsOn },
    { key: 'labelCenterOffsetX', group: 'Labels', label: 'CENTRE label nudge X (design px)', type: 'number', min: -2000, max: 2000, step: 1, showIf: labelsOn },
    { key: 'labelCenterOffsetY', group: 'Labels', label: 'CENTRE label nudge Y (design px, − is up)', type: 'number', min: -2000, max: 2000, step: 1, showIf: labelsOn },
    { key: 'labelFontFamily', group: 'Label text', label: 'Label font', type: 'font', showIf: typedLabels },
    { key: 'labelSizePx', group: 'Label text', label: 'Label size (design px)', type: 'number', min: 4, max: 300, step: 1, showIf: typedLabels },
    { key: 'labelWeight', group: 'Label text', label: 'Label weight', type: 'number', min: 100, max: 900, step: 100, showIf: typedLabels },
    { key: 'labelColor', group: 'Label text', label: 'Label colour', type: 'color', showIf: typedLabels },
    { key: 'labelActiveFontFamily', group: 'Label text', label: 'CENTRE label font (blank = the same one)', type: 'font', showIf: typedLabels },
    { key: 'labelActiveSizePx', group: 'Label text', label: 'CENTRE label size (design px)', type: 'number', min: 4, max: 300, step: 1, showIf: typedLabels },
    { key: 'labelActiveWeight', group: 'Label text', label: 'CENTRE label weight', type: 'number', min: 100, max: 900, step: 100, showIf: typedLabels },
    { key: 'labelActiveColor', group: 'Label text', label: 'CENTRE label colour', type: 'color', showIf: typedLabels },
    { key: 'labelImgHeightPx', group: 'Label images', label: 'Label image height (design px)', type: 'number', min: 4, max: 600, step: 1, showIf: pictureLabels },
    { key: 'labelImgCenterScale', group: 'Label images', label: 'CENTRE label image size (×)', type: 'number', min: 0.2, max: 4, step: 0.05, showIf: pictureLabels },
    { key: 'linkGroup', group: 'Linked image', label: 'Link name — put this in a Fill slot to mirror the choice', type: 'text' },
    { key: 'liveUpdate', group: 'Linked image', label: 'Update the linked element while swiping', type: 'boolean' },
  ],
  assetSlots: [
    { key: 'images', label: 'Choice image', list: true, countParam: 'count' },
    { key: 'labelImages', label: 'Label image', list: true, countParam: 'count' },
    { key: 'results', label: 'Linked element image', list: true, countParam: 'count' },
  ],
  defaultParams: {
    count: 5,
    labels: '',
    linkGroup: 'carousel',
    liveUpdate: true,
    changesToWin: 3,
    loop: true,
    startIndex: -1,
    itemWidthPx: 240,
    itemHeightPx: 240,
    gapPx: 64,
    rowOffsetY: 0,
    labelGapPx: 34,
    sideScale: 1,
    sideOpacityPct: 100,
    tiltDeg: 0,
    centerScale: 1.45,
    centerOffsetX: 0,
    centerOffsetY: 0,
    showLabels: true,
    labelOffsetX: 0,
    labelOffsetY: 0,
    labelCenterOffsetX: 0,
    labelCenterOffsetY: 0,
    labelImgHeightPx: 40,
    labelImgCenterScale: 1.25,
    labelFontFamily: '',
    labelActiveFontFamily: '',
    labelSizePx: 26,
    labelActiveSizePx: 34,
    labelWeight: 500,
    labelActiveWeight: 800,
    labelColor: '#5b6472',
    labelActiveColor: '#101418',
    images: [],
    labelImages: [],
    results: [],
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
