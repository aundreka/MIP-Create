// Scratch-to-reveal: turns any element into a scratch COVER. A canvas coating is
// painted over the cover's box and erased by the pointer (same destination-out
// erosion the scratch game uses). Elements layered behind the cover (lower zIndex,
// within its bounds) that carry `reveal` fire as they're uncovered: each pops a
// money label, plays its `onReveal` sound, and adds to a running tally that drives
// a chosen text element (via the 'set-text' emitter channel). The cover may also be
// its own single reveal target.
//
// Pure (testable) bits — formatMoney / resolveAmount — live at the bottom.

import type { RevealConfig, SceneElement, SfxBinding } from './scene'
import type { RuntimeCtx } from './types'

// Minimal view of stage.ts's internal Rec — only what the coating needs.
export interface CoverRec {
  el: SceneElement
  outer: HTMLDivElement
  content: HTMLElement | null
}

type Emit = (event: string, ...args: unknown[]) => void

function emitBoundSfx(emit: Emit, binding: SfxBinding, loop = false): void {
  const event = loop ? 'sfx-asset-loop-start' : 'sfx-asset'
  if ((binding.delayMs ?? 0) > 0) emit(event, binding.assetId, binding.volume ?? 1, binding.delayMs)
  else emit(event, binding.assetId, binding.volume ?? 1)
}

let stylesInjected = false
function injectRevealStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const s = document.createElement('style')
  s.textContent = `
@keyframes pa-money-pop{
  0%{transform:translate(-50%,-50%) scale(.4);opacity:0}
  18%{transform:translate(-50%,-50%) scale(1.12);opacity:1}
  32%{transform:translate(-50%,-60%) scale(1)}
  100%{transform:translate(-50%,-170%) scale(1);opacity:0}
}
.pa-money{position:absolute;left:0;top:0;z-index:9000;pointer-events:none;font-weight:900;
  white-space:nowrap;text-shadow:0 2px 6px rgba(0,0,0,.45);animation:pa-money-pop 1100ms ease-out forwards;}
`
  document.head.appendChild(s)
}

// Attach a scratch coating to a cover element. Returns a disposer.
export function attachScratchCover(
  cover: CoverRec,
  recs: CoverRec[],
  ctx: RuntimeCtx,
  emit: Emit,
  tallies: Map<string, number>,
  rng: () => number,
): () => void {
  injectRevealStyles()
  const cfg = cover.el.scratch ?? {}
  const threshold = clamp(cfg.threshold ?? 0.55, 0.15, 0.95)
  const brushFactor = cfg.brushFactor ?? 0.09

  // The coating IS the cover, so hide the element's own content (otherwise it would
  // block the elements behind it even after the canvas is erased).
  const prevVis = cover.content?.style.visibility ?? ''
  if (cover.content) cover.content.style.visibility = 'hidden'

  const canvas = document.createElement('canvas')
  canvas.style.cssText =
    'position:absolute;touch-action:none;cursor:crosshair;' +
    'border-radius:' + (getComputedStyle(cover.content ?? cover.outer).borderRadius || '0px') + ';'
  // NOTE: no overflow:hidden on the outer — the coating is allowed to extend a few
  // px beyond the cover's own box so it fully hides reveal elements underneath whose
  // box drifts slightly (see sizeCanvas: the canvas is sized to the UNION of the
  // cover box and every reveal target beneath it, killing edge leaks).
  cover.outer.appendChild(canvas)
  const c2d = canvas.getContext('2d')!

  // cover fill — explicit image, else the element's own image, else a solid colour.
  const coverImgId = cfg.coverAssetId || (cover.el.type === 'image' ? cover.el.assetId : undefined)
  const coverSrc = coverImgId ? ctx.src(coverImgId) : ''
  const coverColor = cfg.coverColor ?? '#d9b25b'
  let coverImg: HTMLImageElement | null = null
  let started = false // true once the player has scratched (freezes auto-refill)

  const fill = (): void => {
    const w = canvas.width
    const h = canvas.height
    c2d.globalCompositeOperation = 'source-over'
    c2d.clearRect(0, 0, w, h)
    if (coverImg && coverImg.complete && coverImg.naturalWidth) {
      c2d.drawImage(coverImg, 0, 0, w, h)
    } else {
      c2d.fillStyle = coverColor
      c2d.fillRect(0, 0, w, h)
    }
  }
  // Reveal targets this coating is responsible for hiding: every reveal element
  // stacked BEHIND the cover (lower zIndex). Used to size the coating so it always
  // fully covers them — even when their box drifts from the cover's (the two are
  // independent elements authored separately, so identical images can still end up
  // with slightly different boxes: scale-vs-explicit-w/h, anchor, sub-pixel, etc.).
  const coverTargets = (): CoverRec[] => recs.filter((r) => r !== cover && r.el.reveal && r.el.zIndex < cover.el.zIndex)

  const sizeCanvas = (): void => {
    const cr = cover.outer.getBoundingClientRect()
    if (cr.width < 1 || cr.height < 1) return
    // The stage may be scaled via a CSS transform on an ancestor, so getBoundingClientRect
    // returns viewport px. Convert to the cover's LOCAL (design) px, which is what the
    // canvas's own left/top/width/height use, via clientWidth (layout px) / rect width.
    const sx = cover.outer.clientWidth / cr.width
    const sy = cover.outer.clientHeight / cr.height
    // Union the cover box with every reveal target beneath it.
    let L = cr.left, T = cr.top, R = cr.right, B = cr.bottom
    for (const t of coverTargets()) {
      const tr = t.outer.getBoundingClientRect()
      if (tr.width < 1 || tr.height < 1) continue
      if (tr.left < L) L = tr.left
      if (tr.top < T) T = tr.top
      if (tr.right > R) R = tr.right
      if (tr.bottom > B) B = tr.bottom
    }
    const MARGIN = 1 // local-px safety for sub-pixel rounding on top of the union
    const left = (L - cr.left) * sx - MARGIN
    const top = (T - cr.top) * sy - MARGIN
    const w = Math.max(2, Math.round((R - L) * sx + MARGIN * 2))
    const h = Math.max(2, Math.round((B - T) * sy + MARGIN * 2))
    // Position the coating relative to the cover's own box (it is the offset parent).
    canvas.style.left = left.toFixed(2) + 'px'
    canvas.style.top = top.toFixed(2) + 'px'
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    if (w === canvas.width && h === canvas.height) return
    canvas.width = w
    canvas.height = h
    if (!started) fill()
  }
  if (coverSrc) {
    coverImg = new Image()
    coverImg.onload = () => {
      if (!started) fill()
    }
    coverImg.src = coverSrc
  }
  sizeCanvas()

  // Re-size + re-fill on layout changes — but only before the player has started
  // scratching, so we never wipe their progress mid-play (ads rarely resize then).
  const ro = new ResizeObserver(() => sizeCanvas())
  ro.observe(cover.outer)
  // Also re-sync if a covered reveal element resizes, so the union stays correct.
  for (const t of coverTargets()) ro.observe(t.outer)

  // ---- erosion --------------------------------------------------------------
  let lastPt: { x: number; y: number } | null = null
  const erodeAt = (x: number, y: number): void => {
    c2d.globalCompositeOperation = 'destination-out'
    const r = Math.max(14, Math.min(canvas.width, canvas.height) * brushFactor)
    if (lastPt) {
      c2d.lineWidth = r * 2
      c2d.lineCap = 'round'
      c2d.beginPath()
      c2d.moveTo(lastPt.x, lastPt.y)
      c2d.lineTo(x, y)
      c2d.stroke()
    }
    c2d.beginPath()
    c2d.arc(x, y, r, 0, Math.PI * 2)
    c2d.fill()
    lastPt = { x, y }
  }

  // Cleared fraction inside a target's on-screen rect (downsampled alpha read).
  const meas = document.createElement('canvas')
  meas.width = 18
  meas.height = 18
  const mc = meas.getContext('2d')!
  const clearedFraction = (target: CoverRec): number => {
    const cr = canvas.getBoundingClientRect()
    const tr = target.outer.getBoundingClientRect()
    const fx = canvas.width / Math.max(1, cr.width)
    const fy = canvas.height / Math.max(1, cr.height)
    const x0 = (Math.max(tr.left, cr.left) - cr.left) * fx
    const y0 = (Math.max(tr.top, cr.top) - cr.top) * fy
    const x1 = (Math.min(tr.right, cr.right) - cr.left) * fx
    const y1 = (Math.min(tr.bottom, cr.bottom) - cr.top) * fy
    const sw = x1 - x0
    const sh = y1 - y0
    if (sw <= 1 || sh <= 1) return 0 // no overlap with this cover
    mc.clearRect(0, 0, meas.width, meas.height)
    mc.drawImage(canvas, x0, y0, sw, sh, 0, 0, meas.width, meas.height)
    const data = mc.getImageData(0, 0, meas.width, meas.height).data
    let clear = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] < 128) clear++
    return clear / (meas.width * meas.height)
  }

  // ---- targets --------------------------------------------------------------
  // Cover element itself (if it reveals) + every reveal element stacked beneath it.
  const candidates = (): CoverRec[] => {
    const out: CoverRec[] = []
    if (cover.el.reveal) out.push(cover)
    for (const r of recs) {
      if (r === cover || !r.el.reveal) continue
      if (r.el.zIndex < cover.el.zIndex) out.push(r)
    }
    return out
  }
  const revealed = new Set<CoverRec>()
  let pending = candidates()

  const root = cover.outer.parentElement as HTMLElement | null

  const popMoney = (target: CoverRec, text: string): void => {
    if (!root || target.el.reveal?.popup === false) return
    const tr = target.outer.getBoundingClientRect()
    const rr = root.getBoundingClientRect()
    const big = !!target.el.reveal?.big
    const el = document.createElement('div')
    el.className = 'pa-money'
    el.textContent = text
    el.style.color = target.el.reveal?.color ?? (big ? '#ef4444' : '#ffffff')
    el.style.fontSize = (big ? 0.075 : 0.055) * Math.max(1, rr.width) + 'px'
    el.style.transform = 'translate(-50%,-50%)'
    el.style.left = tr.left - rr.left + tr.width / 2 + 'px'
    el.style.top = tr.top - rr.top + tr.height / 2 + 'px'
    root.appendChild(el)
    window.setTimeout(() => el.remove(), 1200)
  }

  const fireReveal = (target: CoverRec): void => {
    revealed.add(target)
    const rev = target.el.reveal as RevealConfig
    const amount = resolveAmount(rev, rng)
    const currency = rev.currency ?? '$'
    if (amount > 0) popMoney(target, currency + amount.toFixed(2))
    if (rev.tallyId) {
      const sum = (tallies.get(rev.tallyId) ?? 0) + amount
      tallies.set(rev.tallyId, sum)
      emit('set-text', rev.tallyId, formatMoney(sum, currency))
    }
    // sound: the target's bound onReveal sounds, else a gentle default event.
    const bound = (target.el.sfx ?? []).filter((b) => b.event === 'onReveal' && b.assetId)
    if (bound.length) for (const b of bound) emitBoundSfx(emit, b)
    else emit('sfx', 'collect')

    if (revealed.size >= candidates().length && (cover.el.scratch?.advanceOnAllRevealed ?? true)) {
      fadeOut()
      emit('game-win')
    }
  }

  const checkTargets = (): void => {
    if (!pending.length) return
    pending = pending.filter((t) => {
      if (revealed.has(t)) return false
      if (clearedFraction(t) >= threshold) {
        fireReveal(t)
        return false
      }
      return true
    })
  }

  let faded = false
  const fadeOut = (): void => {
    if (faded) return
    faded = true
    canvas.style.transition = 'opacity 450ms ease'
    canvas.style.pointerEvents = 'none'
    requestAnimationFrame(() => (canvas.style.opacity = '0'))
  }

  // ---- pointer wiring -------------------------------------------------------
  let moves = 0
  let scratching = false
  const loopAsset = (cover.el.sfx ?? []).find((b) => b.event === 'whileScratching' && b.assetId)
  const startLoop = (): void => {
    if (loopAsset) emitBoundSfx(emit, loopAsset, true)
    else emit('sfx-loop-start', 'drag')
  }
  const stopLoop = (): void => {
    if (loopAsset) emit('sfx-asset-loop-stop', loopAsset.assetId)
    else emit('sfx-loop-stop', 'drag')
  }

  const local = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * canvas.width, y: ((e.clientY - r.top) / Math.max(1, r.height)) * canvas.height }
  }
  const onMove = (e: PointerEvent): void => {
    const p = local(e)
    erodeAt(p.x, p.y)
    if ((moves++ & 5) === 0) checkTargets()
  }
  const onUp = (e: PointerEvent): void => {
    scratching = false
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
    try {
      canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* not captured */
    }
    lastPt = null
    stopLoop()
    checkTargets()
  }
  const onDown = (e: PointerEvent): void => {
    if (faded) return
    started = true
    scratching = true
    pending = candidates().filter((t) => !revealed.has(t))
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    startLoop()
    lastPt = null
    const p = local(e)
    erodeAt(p.x, p.y)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
  }
  canvas.addEventListener('pointerdown', onDown)

  return () => {
    if (scratching) stopLoop()
    ro.disconnect()
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
    canvas.remove()
    if (cover.content) cover.content.style.visibility = prevVis
  }
}

// ---- pure helpers (unit-tested) -------------------------------------------
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// Money added on a reveal: explicit `amount`, else a random value in
// [randMin,randMax] (2 dp) using the injected rng, else 0.
export function resolveAmount(rev: RevealConfig, rng: () => number): number {
  if (typeof rev.amount === 'number' && isFinite(rev.amount)) return rev.amount
  const lo = rev.randMin
  const hi = rev.randMax
  if (typeof lo === 'number' && typeof hi === 'number' && hi >= lo) {
    return Math.round((lo + rng() * (hi - lo)) * 100) / 100
  }
  return 0
}

export function formatMoney(sum: number, currency = '$'): string {
  return currency + (Math.round(sum * 100) / 100).toFixed(2)
}
