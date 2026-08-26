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
  let itemPct = 22
  let gapPct = 6
  let aspect = 1
  let centerScale = 1.45
  let sideScale = 1
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

  const items: Item[] = []
  let w = 300
  let h = 400
  let itemW = 66
  let itemH = 66
  let step = 84
  let bandH = 96
  let gapY = 10
  let span = 4

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

  const publish = (i: number): void => {
    if (i === published) return
    published = i
    if (group) setPicks(group, [results[i] || images[i] || ''])
  }

  const layout = (): void => {
    w = ctx.root.clientWidth || 300
    h = ctx.root.clientHeight || 400
    itemW = Math.max(16, (w * itemPct) / 100)
    itemH = Math.max(16, itemW / aspect)
    step = Math.max(itemW * 0.35, (w * (itemPct + gapPct)) / 100)
    bandH = itemH * Math.max(1, centerScale)
    gapY = itemH * 0.14
    // Draw only what can actually reach the screen. When looping, an item's offset
    // flips sign at half the ring and it teleports to the other end — keeping the
    // drawn span inside the viewport means that flip always happens out of sight.
    span = (w / 2 + (itemW * Math.max(1, centerScale)) / 2) / step + 0.02
    const labelH = showLabels ? labelActiveSize * sc() * 1.35 : 0
    const top = (h - (bandH + (showLabels ? gapY + labelH : 0))) / 2
    const artTop = (bandH - itemH) / 2
    for (const it of items) {
      it.wrap.style.width = itemW + 'px'
      it.wrap.style.top = top + 'px'
      it.art.style.top = artTop + 'px'
      it.art.style.height = itemH + 'px'
      it.art.style.fontSize = itemH * 0.3 + 'px'
      it.art.style.borderRadius = itemH * 0.5 + 'px'
      it.label.style.top = bandH + gapY + 'px'
      it.label.style.width = step * 1.9 + 'px'
      it.label.style.marginLeft = -(step * 1.9 - itemW) / 2 + 'px'
    }
    render()
  }

  const render = (): void => {
    const cx = w / 2 - itemW / 2
    for (const it of items) {
      const d = loop ? wrapDelta(it.index - pos, count) : it.index - pos
      const ad = Math.abs(d)
      if (ad > span) {
        it.wrap.style.visibility = 'hidden'
        continue
      }
      it.wrap.style.visibility = 'visible'
      const t = smooth(clamp(1 - ad, 0, 1))
      const s = sideScale + (centerScale - sideScale) * t
      it.wrap.style.transform = `translate3d(${cx + d * step}px,0,0)`
      it.wrap.style.zIndex = String(1000 - Math.round(ad * 100))
      it.wrap.style.opacity = String(sideOpacity + (1 - sideOpacity) * t)
      const z = tiltDeg ? -Math.min(ad, 2) * itemW * 0.2 : 0
      const ry = tiltDeg ? -clamp(d, -1.6, 1.6) * tiltDeg : 0
      it.art.style.transform = `translateZ(${z}px) rotateY(${ry}deg) scale(${s})`
      if (showLabels) {
        it.label.style.fontSize = (labelSize + (labelActiveSize - labelSize) * t) * sc() + 'px'
        it.label.style.fontWeight = String(Math.round(labelWeight + (labelActiveWeight - labelWeight) * t))
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
      images = list(params.images).map((id) => (id ? ctx.assets.src(id) : ''))
      results = list(params.results)
      labels = str(params.labels, '')
        .split(',')
        .map((s) => s.trim())
      group = str(params.linkGroup, 'carousel').trim()
      loop = params.loop !== false
      live = params.liveUpdate !== false
      changesToWin = Math.max(0, Math.round(num(params.changesToWin, 3)))
      itemPct = clamp(num(params.itemPct, 22), 6, 60)
      gapPct = clamp(num(params.gapPct, 6), 0, 60)
      aspect = clamp(num(params.itemAspect, 1), 0.2, 5)
      centerScale = clamp(num(params.centerScale, 1.45), 1, 3)
      sideScale = clamp(num(params.sideScale, 1), 0.2, 2)
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
        const label = document.createElement('div')
        label.style.cssText = 'position:absolute;left:0;text-align:center;white-space:nowrap;line-height:1.2;user-select:none;pointer-events:none;'
        if (labelFont) label.style.fontFamily = labelFont
        else label.style.fontFamily = '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
        label.textContent = labels[i] ?? ''
        if (!showLabels) label.style.display = 'none'
        wrap.appendChild(art)
        wrap.appendChild(label)
        ctx.root.appendChild(wrap)
        items.push({ wrap, art, label, index: i })
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

export const CAROUSEL_TEMPLATE: GameTemplate = {
  id: 'carousel',
  label: 'Carousel (swipe to choose)',
  paramFields: [
    { key: 'count', label: 'Choices', type: 'number', min: 2, max: 12, step: 1 },
    { key: 'labels', label: 'Labels under each choice (comma-separated)', type: 'text' },
    { key: 'linkGroup', label: 'Link name — put this in a Fill slot to mirror the choice', type: 'text' },
    { key: 'liveUpdate', label: 'Update the linked element while swiping', type: 'boolean' },
    { key: 'changesToWin', label: 'Changes before it counts as won (0 = never, the CTA ends it)', type: 'number', min: 0, max: 12, step: 1 },
    { key: 'loop', label: 'Loop around forever', type: 'boolean' },
    { key: 'startIndex', label: 'Starting choice (0-based, -1 = middle)', type: 'number', min: -1, max: 11, step: 1 },
    { key: 'itemPct', label: 'Choice width (% of the game width)', type: 'number', min: 6, max: 60, step: 1 },
    { key: 'gapPct', label: 'Gap between choices (% of the game width)', type: 'number', min: 0, max: 60, step: 1 },
    { key: 'itemAspect', label: 'Choice aspect (width ÷ height)', type: 'number', min: 0.2, max: 5, step: 0.05 },
    { key: 'centerScale', label: 'Centre choice size (× — this is the whole selection cue)', type: 'number', min: 1, max: 3, step: 0.05 },
    { key: 'sideScale', label: 'Side choices size (×)', type: 'number', min: 0.2, max: 2, step: 0.05 },
    { key: 'sideOpacityPct', label: 'Side choices opacity (%)', type: 'number', min: 0, max: 100, step: 5 },
    { key: 'tiltDeg', label: '3D turn per step (deg, 0 = flat)', type: 'number', min: 0, max: 70, step: 1 },
    { key: 'showLabels', label: 'Show the labels', type: 'boolean' },
    { key: 'labelFontFamily', label: 'Label font (family or uploaded font id)', type: 'text', showIf: (p) => p.showLabels !== false },
    { key: 'labelSizePx', label: 'Label size (design px)', type: 'number', min: 4, max: 300, step: 1, showIf: (p) => p.showLabels !== false },
    { key: 'labelActiveSizePx', label: 'Centre label size (design px)', type: 'number', min: 4, max: 300, step: 1, showIf: (p) => p.showLabels !== false },
    { key: 'labelWeight', label: 'Label weight', type: 'number', min: 100, max: 900, step: 100, showIf: (p) => p.showLabels !== false },
    { key: 'labelActiveWeight', label: 'Centre label weight', type: 'number', min: 100, max: 900, step: 100, showIf: (p) => p.showLabels !== false },
    { key: 'labelColor', label: 'Label colour', type: 'color', showIf: (p) => p.showLabels !== false },
    { key: 'labelActiveColor', label: 'Centre label colour', type: 'color', showIf: (p) => p.showLabels !== false },
  ],
  assetSlots: [
    { key: 'images', label: 'Choice image', list: true, countParam: 'count' },
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
    itemPct: 22,
    gapPct: 6,
    itemAspect: 1,
    centerScale: 1.45,
    sideScale: 1,
    sideOpacityPct: 100,
    tiltDeg: 0,
    showLabels: true,
    labelFontFamily: '',
    labelSizePx: 26,
    labelActiveSizePx: 34,
    labelWeight: 500,
    labelActiveWeight: 800,
    labelColor: '#5b6472',
    labelActiveColor: '#101418',
    images: [],
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
