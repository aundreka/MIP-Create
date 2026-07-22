// Scratch game: erase the cover (canvas destination-out) to reveal the prize
// underneath; win at a threshold of scratched area. Hint = drag across.

import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { num, str } from './types'
import { emit } from '../emitter'

// Parse an authored brush-intro path: a JSON list of {x,y} points, each a fraction 0..1 of the card.
// Returns [] on anything malformed (the runtime then falls back to a default rub).
const parseBrushPath = (raw: string): { x: number; y: number }[] => {
  if (!raw) return []
  try {
    const a = JSON.parse(raw)
    if (!Array.isArray(a)) return []
    return a
      .filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number')
      .map((p) => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }))
  } catch {
    return []
  }
}

// Cover images decoded ahead of time, keyed by src. A scratch card's cover is painted onto a
// canvas that starts transparent, so if the image is still decoding when the scene mounts, the
// card shows through for a frame — a visible "cover pops in" flash (worst with a transparent
// coverColor). Decoding covers before the scene mounts lets mount() paint the cover on the very
// first frame. Shared across cards (covers are usually the same asset in a multi-card flow).
const coverCache = new Map<string, HTMLImageElement>()

/** Warm the decoded-image cache for a scratch cover so the card paints it flash-free on mount.
 * Call ahead of navigating to the scratch scene (playProject preloads every scratch cover at boot). */
export function preloadScratchCover(src: string): void {
  if (!src || coverCache.has(src)) return
  const img = new Image()
  img.src = src
  coverCache.set(src, img)
  // decode() resolves once the bitmap is ready, so a later drawImage is immediate. Best-effort:
  // older WebViews lack it (the onload path still covers them) and it can reject on detached imgs.
  img.decode?.().catch(() => { /* fall back to onload timing */ })
}

export function createScratch(): GameModule {
  let ctx: GameContext
  let coverColor = '#9aa3b2'
  let threshold = 0.6
  let canvas: HTMLCanvasElement
  let c2d: CanvasRenderingContext2D
  let prize: HTMLDivElement
  let started = false
  let won = false
  let scratching = false
  let ro: ResizeObserver | null = null
  let dprCleanup: (() => void) | null = null // tears down the browser-zoom (DPR) re-render listener
  let winCb: (() => void) | null = null
  let completeCb: (() => void) | null = null
  let lastPt: { x: number; y: number } | null = null
  let moves = 0
  let coverImg: HTMLImageElement | null = null
  let coverReady = false
  // The prize/reveal sits BENEATH the cover canvas. Until the cover has actually painted an
  // occluding frame, showing the prize would let it flash through (e.g. a transparent-color
  // cover whose image is still loading when the scene fades in). Keep the prize hidden until
  // markCovered() confirms the cover is down.
  let coverPainted = false
  // Reveal sizing. The COVER image is ALWAYS drawn 'contain' (whole image fit inside the card,
  // aspect-preserved). 'follow' (default) sizes the reveal to exactly the cover's contained rect and
  // stretches it to fill — so the prize sits directly under the cover and matches its shape. 'fit'
  // instead shows the reveal at its natural aspect, freely positioned/scaled (double-click on canvas)
  // via the revealScale/X/Y transform. Either way the cover stays contain.
  let fitMode: 'follow' | 'fit' = 'follow'
  let revealScale = 1
  let revealX = 0
  let revealY = 0
  // Reveal zone: only clearing WITHIN this rectangle counts toward the win threshold.
  // Scratching anywhere outside it never contributes. Normalized 0..1 of the card;
  // defaults to the whole card (no gating, so existing cards are unchanged).
  let zoneX = 0
  let zoneY = 0
  let zoneW = 1
  let zoneH = 1

  // ---- brush (optional) ----------------------------------------------------
  // An image that follows the finger/cursor while scratching. The SCRATCH happens at the
  // brush's authored TIP (a point within the image, fraction 0..1); the erode radius and the
  // brush's display size are authored independently. Purely visual + the tip offset — the
  // coverage math is unchanged. No brush image set → nothing shows (radius still configurable).
  let brushImg: HTMLImageElement | null = null
  let brushEl: HTMLImageElement | null = null
  // Mounted on a non-clipped ancestor (the stage) so the brush can overflow past the card edges
  // instead of being cut off by ctx.root's overflow:hidden. Positions are relative to this host.
  let brushHost: HTMLElement | null = null
  let brushTipX = 0.5
  let brushTipY = 0.5
  let brushRadiusFrac = 0.09 // erode radius as a fraction of the card's short side (0.09 = old default)
  let brushScaleFrac = 0.4 // brush display width as a fraction of the card's short side
  let brushSpawnX = 0.5 // resting spawn position, fraction of the card
  let brushSpawnY = 0.5
  let brushIntro = false // play a demo "draw path" rub at the start (like the handguide hint)
  let brushIntroPath: { x: number; y: number }[] = [] // authored path, points as fractions 0..1 of the card
  let brushIntroDurationMs = 1600 // duration of ONE pass along the path (lower = faster)
  let brushIntroLoops = 2 // how many times the path repeats
  let brushIntroAnim: Animation | null = null
  // Per-gesture cache so a move does no extra layout reads (toCanvas already forces one).
  let brushRootRect: DOMRect | null = null // brushHost rect
  let brushW = 0
  let brushH = 0
  let brushCenter: { x: number; y: number } | null = null // current brush center, client coords
  let brushCardRect: DOMRect | null = null // card (ctx.root) rect, cached per gesture — clamps the brush
  // Brush resting position as a FRACTION of the card (0..1) — the source of truth so the brush stays
  // put RELATIVE to the card across orientation flips / resizes / zoom (recomputed on every relayout).
  let brushFracX = 0.5
  let brushFracY = 0.5
  const brushHostRect = (): DOMRect => (brushHost ?? ctx.root).getBoundingClientRect()

  // Is a press ON the brush? Requires the player to GRAB and drag the brush instead of scratching
  // wherever they tap. Generous padding so it's easy to grab on touch.
  const brushHit = (clientX: number, clientY: number): boolean => {
    if (!brushEl || !brushCenter) return false
    return Math.abs(clientX - brushCenter.x) <= brushW * 0.5 + 18 && Math.abs(clientY - brushCenter.y) <= brushH * 0.5 + 18
  }

  const sizeBrush = (): void => {
    if (!brushEl) return
    const short = Math.min(ctx.root.clientWidth, ctx.root.clientHeight)
    const aspect = brushImg && brushImg.naturalWidth && brushImg.naturalHeight
      ? brushImg.naturalWidth / brushImg.naturalHeight
      : 1
    brushW = Math.max(8, short * brushScaleFrac)
    brushH = brushW / (aspect || 1)
    brushEl.style.width = brushW.toFixed(1) + 'px'
    brushEl.style.height = brushH.toFixed(1) + 'px'
  }

  // Draw the brush CENTERED on the finger, so the authored tip can sit elsewhere in the image and
  // reveal there — not under the finger.
  const moveBrush = (clientX: number, clientY: number): void => {
    if (!brushEl || !brushRootRect) return
    // Keep the brush CENTER within the card so at least ~half of it always stays over the card —
    // part may overflow the edges, but never the whole brush.
    let cx = clientX
    let cy = clientY
    if (brushCardRect) {
      cx = Math.max(brushCardRect.left, Math.min(brushCardRect.right, cx))
      cy = Math.max(brushCardRect.top, Math.min(brushCardRect.bottom, cy))
    }
    const left = cx - brushRootRect.left - 0.5 * brushW
    const top = cy - brushRootRect.top - 0.5 * brushH
    brushEl.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`
    brushCenter = { x: cx, y: cy } // the (clamped) center — used for grab hit-testing + the scratch tip
  }

  // Record the brush's card-fraction from its CURRENT position — ONLY from a real user drag (valid,
  // fresh card rect). Never during relayout, so a degenerate rect mid-flip can't corrupt it.
  const rememberBrushFrac = (): void => {
    if (!brushCenter || !brushCardRect || brushCardRect.width < 2 || brushCardRect.height < 2) return
    brushFracX = Math.max(0, Math.min(1, (brushCenter.x - brushCardRect.left) / brushCardRect.width))
    brushFracY = Math.max(0, Math.min(1, (brushCenter.y - brushCardRect.top) / brushCardRect.height))
  }

  // Re-place the brush at its stored card-fraction after a layout change (orientation flip, resize,
  // zoom). Skips degenerate rects (mid-transition) and never rewrites the stored fraction, so
  // flipping to landscape and back restores the brush exactly.
  const relayoutBrush = (): void => {
    if (!brushEl || !started) return
    const card = ctx.root.getBoundingClientRect()
    if (card.width < 2 || card.height < 2) return // mid-transition — don't reposition on a bad rect
    brushRootRect = brushHostRect()
    brushCardRect = card
    sizeBrush()
    moveBrush(card.left + brushFracX * card.width, card.top + brushFracY * card.height)
  }

  // Where the scratch happens (client coords): the brush's authored tip pixel, offset from the
  // finger by (tip − center) × brush size. No brush → the finger itself.
  const brushTip = (clientX: number, clientY: number): { x: number; y: number } => {
    if (!brushEl) return { x: clientX, y: clientY }
    return { x: clientX + (brushTipX - 0.5) * brushW, y: clientY + (brushTipY - 0.5) * brushH }
  }

  // The client-space point the brush rests at (its authored spawn, as a fraction of the card).
  const spawnClient = (): { x: number; y: number } => {
    const rect = ctx.root.getBoundingClientRect()
    return { x: rect.left + brushSpawnX * rect.width, y: rect.top + brushSpawnY * rect.height }
  }

  // Park the brush at its spawn spot and keep it visible — a persistent tool the player drags, so
  // it never disappears between strokes. Then plays the optional intro demo.
  // Signal that the brush finished its intro and is ready to be pointed at (handguide 'brush' mode).
  const markBrushReady = (): void => { if (brushEl) brushEl.dataset.brushReady = '1' }

  const parkBrush = (): void => {
    if (!brushEl) return
    brushRootRect = brushHostRect()
    brushCardRect = ctx.root.getBoundingClientRect()
    brushFracX = brushSpawnX // rest at the authored spawn (as a card fraction)
    brushFracY = brushSpawnY
    sizeBrush()
    const s = spawnClient()
    moveBrush(s.x, s.y)
    brushEl.style.opacity = '1'
    playBrushIntro()
    if (!brushIntroAnim) markBrushReady() // no intro playing → ready immediately
  }

  // Fade the brush away on win — its job is done. Matches the cover's reveal fade.
  const fadeBrush = (): void => {
    if (!brushEl) return
    brushIntroAnim?.cancel()
    brushIntroAnim = null
    brushEl.style.transition = 'opacity 400ms ease'
    brushEl.style.opacity = '0'
  }

  // Optional start animation: a demo rub across the spawn area a couple of times (like the
  // handguide draw-path hint), then rests. Cancelled the moment the player interacts.
  const playBrushIntro = (): void => {
    if (!brushEl || !brushIntro || typeof brushEl.animate !== 'function') return
    const rect = ctx.root.getBoundingClientRect()
    const host = brushHostRect()
    const xf = (cx: number, cy: number): string => {
      const left = cx - host.left - 0.5 * brushW
      const top = cy - host.top - 0.5 * brushH
      return `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`
    }
    // Start AND end each pass at the spawn point so the brush eases back to rest gracefully
    // (and loops without a jump) instead of teleporting from the last path point.
    const s = spawnClient()
    const spawnXf = xf(s.x, s.y)
    let mid: string[]
    if (brushIntroPath.length >= 2) {
      mid = brushIntroPath.map((p) => xf(rect.left + p.x * rect.width, rect.top + p.y * rect.height))
    } else {
      const amp = rect.width * 0.22 // default: a horizontal rub across the spawn point
      mid = [xf(s.x - amp, s.y), xf(s.x + amp, s.y), xf(s.x - amp, s.y)]
    }
    const kf: Keyframe[] = [spawnXf, ...mid, spawnXf].map((t) => ({ transform: t }))
    brushIntroAnim?.cancel()
    brushIntroAnim = brushEl.animate(kf, { duration: brushIntroDurationMs, iterations: brushIntroLoops, easing: 'ease-in-out' })
    brushIntroAnim.onfinish = (): void => { brushIntroAnim = null; const p = spawnClient(); moveBrush(p.x, p.y); markBrushReady() }
  }

  // The cover image's 'contain' rect within the card, as fractions 0..1 (whole image fit inside,
  // aspect-preserved, centered). No cover image → the whole card. The reveal is sized to this rect
  // in 'follow' mode so the prize sits exactly under the cover.
  const coverContainRect = (): { x: number; y: number; w: number; h: number } => {
    const cw = Math.max(1, ctx.root.clientWidth)
    const ch = Math.max(1, ctx.root.clientHeight)
    const iw = coverImg?.naturalWidth || 0
    const ih = coverImg?.naturalHeight || 0
    if (!iw || !ih) return { x: 0, y: 0, w: 1, h: 1 }
    const s = Math.min(cw / iw, ch / ih)
    const dw = iw * s
    const dh = ih * s
    return { x: (cw - dw) / 2 / cw, y: (ch - dh) / 2 / ch, w: dw / cw, h: dh / ch }
  }

  // Position the reveal to follow the cover's contain rect (stretched to fill it). In 'fit' mode the
  // reveal keeps its own full-card box + manual transform, so leave it alone.
  const positionReveal = (): void => {
    if (!prize || fitMode === 'fit') return
    const r = coverContainRect()
    prize.style.inset = 'auto'
    prize.style.left = (r.x * 100).toFixed(3) + '%'
    prize.style.top = (r.y * 100).toFixed(3) + '%'
    prize.style.width = (r.w * 100).toFixed(3) + '%'
    prize.style.height = (r.h * 100).toFixed(3) + '%'
  }

  const fillCover = (): void => {
    const w = canvas.width
    const h = canvas.height
    c2d.globalCompositeOperation = 'source-over'
    c2d.clearRect(0, 0, w, h)
    if (coverImg && coverReady && (coverImg.naturalWidth || coverImg.width)) {
      // Cover is ALWAYS contain (whole image fit inside, aspect-preserved). Optionally fill the
      // letterbox with the cover color so those margins stay a scratchable surface too.
      const r = coverContainRect()
      if (coverColor) {
        c2d.fillStyle = coverColor
        c2d.fillRect(0, 0, w, h)
      }
      c2d.drawImage(coverImg, r.x * w, r.y * h, r.w * w, r.h * h)
      return
    }
    // No cover image: a cleared cover color leaves the cell fully transparent (see-through) —
    // no fill and no placeholder text.
    if (!coverColor) return
    c2d.fillStyle = coverColor
    c2d.fillRect(0, 0, w, h)
    c2d.fillStyle = 'rgba(255,255,255,0.85)'
    c2d.font = `${Math.round(Math.min(w, h) * 0.07)}px -apple-system, Segoe UI, sans-serif`
    c2d.textAlign = 'center'
    c2d.textBaseline = 'middle'
    c2d.fillText('Scratch to reveal', w / 2, h / 2)
  }

  // Reveal the prize once the cover is confirmed on screen — hidden until now so it can't
  // flash through a not-yet-painted (transparent / still-loading) cover during scene entry.
  const markCovered = (): void => {
    if (coverPainted) return
    coverPainted = true
    if (prize) prize.style.visibility = 'visible'
  }

  const sizeCanvas = (): void => {
    relayoutBrush() // keep the brush pinned to its card-fraction across resize / orientation flips
    const cssW = Math.max(2, Math.round(ctx.root.clientWidth))
    const cssH = Math.max(2, Math.round(ctx.root.clientHeight))
    // Back the cover canvas at the FULL device-pixel ratio so it stays crisp at any browser-zoom /
    // DPR — otherwise it renders at CSS px and blurs as you zoom in. A pixel-area cap guards memory.
    let dpr = Math.max(1, window.devicePixelRatio || 1)
    const MAX_BACKING_PX = 8_294_400 // 3840×2160 (~33 MB)
    const area = cssW * cssH * dpr * dpr
    if (area > MAX_BACKING_PX) dpr *= Math.sqrt(MAX_BACKING_PX / area)
    const w = Math.round(cssW * dpr)
    const h = Math.round(cssH * dpr)
    // width/height:100% (not px) so the canvas fills the card exactly at every zoom level.
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    if (w === canvas.width && h === canvas.height) return
    canvas.width = w
    canvas.height = h
    lastPt = null
    positionReveal() // card aspect may have changed → keep the reveal on the cover's contain rect
    if (!won) fillCover()
  }

  const erodeAt = (x: number, y: number): void => {
    c2d.globalCompositeOperation = 'destination-out'
    // Must be fully opaque — destination-out uses the source alpha to determine
    // how much to erase; a semi-transparent fill would leave ghost opacity behind.
    c2d.fillStyle = '#000'
    c2d.strokeStyle = '#000'
    const r = Math.max(14, Math.min(canvas.width, canvas.height) * brushRadiusFrac)
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

  // Fraction of the reveal ZONE that has been scratched clear (alpha < 128). Pixels
  // outside the zone are ignored entirely, so scratching there can never trip the
  // threshold. Sampled at 64×64 so a small zone still has enough pixels to measure.
  const measure = (): number => {
    const S = 64
    const o = document.createElement('canvas')
    o.width = S
    o.height = S
    const oc = o.getContext('2d')!
    oc.drawImage(canvas, 0, 0, S, S)
    const data = oc.getImageData(0, 0, S, S).data
    const x0 = Math.max(0, Math.floor(zoneX * S))
    const y0 = Math.max(0, Math.floor(zoneY * S))
    const x1 = Math.min(S, Math.ceil((zoneX + zoneW) * S))
    const y1 = Math.min(S, Math.ceil((zoneY + zoneH) * S))
    let clear = 0
    let total = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        total++
        if (data[(y * S + x) * 4 + 3] < 128) clear++
      }
    }
    return total > 0 ? clear / total : 0
  }

  const reveal = (): void => {
    if (won) return
    won = true
    emit('scratch-progress', 1) // fully revealed → drive any threshold-based element fades
    if (winCb) winCb() // fires immediately at win — for SFX that should not be delayed
    ctx.sfx.loopStop?.('drag') // stop the scratching loop on win
    fadeBrush() // prize revealed — fade the brush out
    canvas.style.pointerEvents = 'none'
    // Fade the cover away smoothly instead of clearing it instantly. The prize sits
    // beneath the canvas, so fading the canvas opacity to 0 dissolves into the reveal.
    canvas.style.transition = 'opacity 450ms ease'
    requestAnimationFrame(() => {
      canvas.style.opacity = '0'
    })
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      c2d.globalCompositeOperation = 'source-over'
      c2d.clearRect(0, 0, canvas.width, canvas.height)
      completeCb?.() // win SFX fires centrally on completion (stage revealOnWin)
    }
    canvas.addEventListener('transitionend', finish, { once: true })
    window.setTimeout(finish, 650) // fallback if transitionend never fires
  }

  return {
    mount(c, params) {
      ctx = c
      coverColor = str(params.coverColor, '#9aa3b2')
      threshold = Math.max(0.2, Math.min(0.95, num(params.threshold, 0.6)))
      fitMode = str(params.fit, 'follow') === 'fit' ? 'fit' : 'follow'
      revealScale = Math.max(0.05, num(params.revealScale, 1))
      revealX = num(params.revealX, 0)
      revealY = num(params.revealY, 0)
      zoneX = Math.max(0, Math.min(1, num(params.zoneX, 0) / 100))
      zoneY = Math.max(0, Math.min(1, num(params.zoneY, 0) / 100))
      zoneW = Math.max(0.02, Math.min(1 - zoneX, num(params.zoneW, 100) / 100))
      zoneH = Math.max(0.02, Math.min(1 - zoneY, num(params.zoneH, 100) / 100))
      brushTipX = Math.max(0, Math.min(1, num(params.brushTipX, 50) / 100))
      brushTipY = Math.max(0, Math.min(1, num(params.brushTipY, 50) / 100))
      brushRadiusFrac = Math.max(1, Math.min(50, num(params.brushRadius, 9))) / 100
      brushScaleFrac = Math.max(5, Math.min(200, num(params.brushScale, 40))) / 100
      brushSpawnX = Math.max(0, Math.min(1, num(params.brushSpawnX, 50) / 100))
      brushSpawnY = Math.max(0, Math.min(1, num(params.brushSpawnY, 50) / 100))
      brushIntro = params.brushIntro === true || params.brushIntro === 'on' || params.brushIntro === 1
      brushIntroDurationMs = Math.max(200, num(params.brushIntroDurationMs, 1600))
      brushIntroLoops = Math.max(1, Math.min(20, Math.round(num(params.brushIntroLoops, 2))))
      brushIntroPath = parseBrushPath(str(params.brushIntroPath, ''))
      const label = str(params.label, 'YOU WIN!')
      const prizeSrc = ctx.assets.src(str(params.prize, ''))
      const coverSrc = ctx.assets.src(str(params.cover, ''))
      const cursorMode = str(params.cursor, 'inherit')
      const cursorAssetSrc = ctx.assets.src(str(params.cursorAsset, ''))
      const shadowBlur = num(params.shadowBlur, 0)
      const shadowX = num(params.shadowX, 0)
      const shadowY = num(params.shadowY, 4)
      const shadowColor = str(params.shadowColor, 'rgba(0,0,0,0.45)') // '' = no shadow (transparent)
      ctx.root.style.touchAction = 'none'
      ctx.root.style.overflow = 'hidden'

      // Reveal background: transparent by default (no forced dark card). Set a color to fill behind
      // the prize image (e.g. as the letterbox in 'contain'); empty = see-through to the scene.
      const revealBg = str(params.revealBgColor, '') || 'transparent'
      prize = document.createElement('div')
      prize.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;' +
        `background:${revealBg};color:#fff;font-weight:800;text-align:center;visibility:hidden;` +
        'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;'
      if (prizeSrc) {
        if (fitMode === 'fit') {
          // Natural-aspect reveal, positioned/scaled by the saved transform; the card
          // clips the overflow. The editor's reveal overlay renders this identically.
          const img = document.createElement('img')
          img.src = prizeSrc
          img.draggable = false
          img.style.cssText =
            'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;' +
            `transform-origin:center center;transform:translate(${revealX}%,${revealY}%) scale(${revealScale});`
          prize.appendChild(img)
        } else {
          // 'follow': the prize DIV is sized to the cover's contain rect (positionReveal), and the
          // image is stretched to fill it — so the reveal exactly follows the cover's size/shape.
          prize.style.background = `${revealBg} center/100% 100% no-repeat url("${prizeSrc}")`
        }
      } else {
        const span = document.createElement('div')
        span.textContent = label
        span.style.cssText = 'font-size:min(12vw,64px);padding:8%;'
        prize.appendChild(span)
      }
      ctx.root.appendChild(prize)
      positionReveal() // no cover image yet → full card; refined once the cover loads

      if (coverSrc) {
        const cached = coverCache.get(coverSrc)
        if (cached && cached.complete && (cached.naturalWidth || cached.width)) {
          // Already decoded (preloaded ahead of mount): adopt it so sizeCanvas() paints the cover
          // synchronously on the first frame — no transparent gap, no pop-in flash.
          coverImg = cached
          coverReady = true
        } else {
          coverImg = new Image()
          coverImg.onload = () => {
            coverReady = true
            positionReveal() // now the cover aspect is known → size the reveal to its contain rect
            if (!won) fillCover()
            markCovered() // opaque cover image is down → safe to show the prize beneath it
          }
          // Cover art failed to load: don't strand the prize hidden forever. If an opaque
          // coverColor was filled it still hides the prize; otherwise the card is see-through
          // by authoring and the prize is meant to show.
          coverImg.onerror = () => markCovered()
          coverImg.src = coverSrc
          coverCache.set(coverSrc, coverImg) // warm the cache for any later card using this cover
        }
      }

      // Optional brush: a floating image whose authored tip does the scratching. Created hidden;
      // sized/positioned at the first touch. z-index sits above EVERYTHING — the win/lose overlay
      // (9000) and the immune header/overlayTop tiers (10000/10050) — and never eats pointer events.
      const brushSrc = ctx.assets.src(str(params.brushImage, ''))
      if (brushSrc) {
        brushImg = new Image()
        brushImg.src = brushSrc
        brushEl = document.createElement('img')
        brushEl.src = brushSrc
        brushEl.draggable = false
        brushEl.dataset.paBrush = '1' // marker so a handguide's 'point at brush' mode can find it
        brushEl.style.cssText =
          'position:absolute;left:0;top:0;pointer-events:none;opacity:0;z-index:100000;' +
          'will-change:transform;transition:opacity 120ms ease;-webkit-user-drag:none;user-select:none;'
        // Mount on the non-clipped stage container so the brush can overflow past the card edges.
        const paRoot = ctx.root.closest?.('.pa-root') as HTMLElement | null
        brushHost = (paRoot ?? ctx.root).parentElement ?? ctx.root
        brushHost.appendChild(brushEl)
      }

      canvas = document.createElement('canvas')
      canvas.draggable = false
      canvas.style.cssText =
        'position:absolute;inset:0;touch-action:none;' +
        'user-select:none;-webkit-user-select:none;-webkit-user-drag:none;' +
        '-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;'
      canvas.addEventListener('dragstart', (e) => e.preventDefault())
      if (cursorMode === 'custom' && cursorAssetSrc) {
        canvas.style.cursor = `url("${cursorAssetSrc}") 16 16, crosshair`
      } else if (cursorMode !== 'inherit') {
        canvas.style.cursor = cursorMode === 'default' ? 'default' : cursorMode === 'pointer' ? 'pointer' : 'crosshair'
      }
      // A cleared shadow color = no shadow (transparent), regardless of blur/offset.
      if (shadowColor && (shadowBlur > 0 || shadowX !== 0 || shadowY !== 0)) {
        canvas.style.filter = `drop-shadow(${shadowX}px ${shadowY}px ${shadowBlur}px ${shadowColor})`
      }
      ctx.root.appendChild(canvas)
      c2d = canvas.getContext('2d')!
      sizeCanvas() // paints the initial cover synchronously (coverColor + any preloaded image)
      // Show the prize right away only when nothing async can uncover it: no cover image to wait
      // for, an opaque coverColor already fills the canvas this frame, or the cover image was
      // preloaded and just painted. A still-loading image over a transparent color stays hidden
      // until its onload (handled above) so the reveal never flashes through.
      if (!coverSrc || coverColor || coverReady) markCovered()
      ro = new ResizeObserver(() => sizeCanvas())
      ro.observe(ctx.root)

      // Re-render the cover at the new devicePixelRatio when browser zoom changes WITHOUT a viewport
      // resize (a resolution media query fires once when zoom crosses its dppx, so re-arm a fresh
      // listener after each change). sizeCanvas's own guard only reallocates when the device-pixel
      // size truly changed, so this is cheap and never wipes scratch progress.
      const armDpr = (): void => {
        dprCleanup?.()
        dprCleanup = null
        if (typeof window.matchMedia !== 'function') return
        let mql: MediaQueryList
        try {
          mql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
        } catch {
          return // resolution MQ unsupported (very old WebView) — the resize path still covers it
        }
        const onChange = (): void => { sizeCanvas(); armDpr() }
        const legacy = mql as unknown as { addListener?: (l: () => void) => void; removeListener?: (l: () => void) => void }
        if (mql.addEventListener) mql.addEventListener('change', onChange)
        else legacy.addListener?.(onChange)
        dprCleanup = (): void => {
          if (mql.removeEventListener) mql.removeEventListener('change', onChange)
          else legacy.removeListener?.(onChange)
        }
      }
      armDpr()
    },
    start() {
      if (started) return
      started = true
      parkBrush() // show the brush at rest from the start — it's a persistent draggable tool

      const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
        const r = canvas.getBoundingClientRect()
        return {
          x: ((clientX - r.left) / Math.max(1, r.width)) * canvas.width,
          y: ((clientY - r.top) / Math.max(1, r.height)) * canvas.height,
        }
      }
      // Offset between the brush center and the finger at grab time (drag without a jump).
      let grabDX = 0
      let grabDY = 0
      // Begin a stroke: require grabbing the brush (if any). Returns false if the press missed it.
      const beginStroke = (clientX: number, clientY: number): boolean => {
        if (brushEl && !brushHit(clientX, clientY)) return false // must grab the brush, not tap anywhere
        brushIntroAnim?.cancel()
        brushIntroAnim = null
        markBrushReady() // player took over — the (possibly interrupted) intro is done
        grabDX = brushEl && brushCenter ? brushCenter.x - clientX : 0
        grabDY = brushEl && brushCenter ? brushCenter.y - clientY : 0
        if (brushEl) { brushRootRect = brushHostRect(); brushCardRect = ctx.root.getBoundingClientRect(); sizeBrush() }
        const bx = clientX + grabDX
        const by = clientY + grabDY
        moveBrush(bx, by)
        rememberBrushFrac() // user placed the brush → update its resting card-fraction
        const c = brushEl && brushCenter ? brushCenter : { x: bx, y: by } // clamped center
        const t = brushTip(c.x, c.y)
        const p = toCanvas(t.x, t.y)
        erodeAt(p.x, p.y)
        return true
      }
      const onScratchMove = (clientX: number, clientY: number): void => {
        if (won) return
        const bx = clientX + grabDX
        const by = clientY + grabDY
        moveBrush(bx, by)
        rememberBrushFrac() // user dragged the brush → track its card-fraction
        const c = brushEl && brushCenter ? brushCenter : { x: bx, y: by } // clamped center
        const t = brushTip(c.x, c.y)
        const p = toCanvas(t.x, t.y)
        erodeAt(p.x, p.y)
        if ((moves++ & 7) === 0) {
          const m = measure()
          emit('scratch-progress', m) // fade scene elements in/out at progress thresholds
          if (m >= threshold) reveal()
        }
      }
      const onScratchEnd = (): void => {
        scratching = false
        ctx.sfx.loopStop?.('drag')
        // Brush stays on screen (persistent draggable tool) — no hideBrush() here.
        lastPt = null
        if (!won && measure() >= threshold) reveal()
      }

      // Touch events — primary path on mobile. MRAID/AppLovin reliably delivers
      // these even on the first interaction, unlike synthesized pointer events.
      // NOTE: we do NOT call e.preventDefault() here. Scrolling is already blocked
      // by `touch-action: none` on the parent (.pa-el-anim), so preventDefault() is
      // redundant — and on Android Chrome it prevents the touchstart from being
      // counted as a user activation for audio, breaking SFX on Android.
      // The pointerdown handler guards against double-handling via pointerType check.
      let touchActive = false
      canvas.addEventListener('touchstart', (e) => {
        if (won) return
        const t = e.changedTouches[0]
        lastPt = null
        if (!beginStroke(t.clientX, t.clientY)) return // press missed the brush — ignore
        touchActive = true
        scratching = true
        ctx.sfx.loopStart?.('drag')
        const onMove = (ev: TouchEvent): void => {
          ev.preventDefault() // prevent scroll/pan fighting the scratch gesture
          const t2 = ev.changedTouches[0]
          onScratchMove(t2.clientX, t2.clientY)
        }
        const onEnd = (): void => {
          canvas.removeEventListener('touchmove', onMove)
          canvas.removeEventListener('touchend', onEnd)
          canvas.removeEventListener('touchcancel', onEnd)
          touchActive = false
          onScratchEnd()
        }
        canvas.addEventListener('touchmove', onMove, { passive: false })
        canvas.addEventListener('touchend', onEnd)
        canvas.addEventListener('touchcancel', onEnd)
      }, { passive: true })

      // Pointer events — fallback for mouse / pen (desktop). Skipped when a touch
      // gesture is already active (touchstart has already handled it).
      canvas.addEventListener('pointerdown', (e) => {
        if (won || touchActive || e.pointerType === 'touch') return
        lastPt = null
        if (brushEl && !brushHit(e.clientX, e.clientY)) return // must grab the brush, not tap anywhere
        e.preventDefault() // prevent native drag-start on the canvas element
        try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
        scratching = true
        ctx.sfx.loopStart?.('drag')
        beginStroke(e.clientX, e.clientY)
        const onMove = (ev: PointerEvent): void => onScratchMove(ev.clientX, ev.clientY)
        const onUp = (): void => {
          canvas.removeEventListener('pointermove', onMove)
          canvas.removeEventListener('pointerup', onUp)
          canvas.removeEventListener('pointercancel', onUp)
          onScratchEnd()
        }
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerup', onUp)
        canvas.addEventListener('pointercancel', onUp)
      })
    },
    relayout: sizeCanvas,
    getHint(): HintMove | null {
      if (won || scratching || brushEl) return null // brush is the tool; point-at-brush is a handguide mode
      const r = canvas.getBoundingClientRect()
      const y = r.top + r.height / 2
      return { from: { x: r.left + r.width * 0.22, y }, to: { x: r.left + r.width * 0.78, y }, kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      ro?.disconnect()
      dprCleanup?.()
      dprCleanup = null
      brushIntroAnim?.cancel()
      brushIntroAnim = null
      brushEl?.remove() // mounted on the stage host, not ctx.root — remove it explicitly
      brushImg = null
      brushEl = null
      brushHost = null
      brushRootRect = null
      ctx.root.innerHTML = ''
    },
  }
}

export const SCRATCH_TEMPLATE: GameTemplate = {
  id: 'scratch',
  label: 'Scratch card',
  paramFields: [
    { key: 'label', label: 'Reveal text (if no prize image)', type: 'text' },
    { key: 'coverColor', label: 'Cover color (if no cover image)', type: 'color' },
    { key: 'threshold', label: 'Reveal at', type: 'number', min: 0.3, max: 0.9, step: 0.05 },
    { key: 'brushRadius', label: 'Brush/scratch radius (% of card)', type: 'number', min: 1, max: 50, step: 1 },
    { key: 'brushScale', label: 'Brush image size (% of card)', type: 'number', min: 5, max: 200, step: 5 },
    { key: 'brushTipX', label: 'Brush tip X — reveal point (% of image, 50 = center)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'brushTipY', label: 'Brush tip Y — reveal point (% of image, 50 = center)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'zoneX', label: 'Reveal zone left (%)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'zoneY', label: 'Reveal zone top (%)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'zoneW', label: 'Reveal zone width (%)', type: 'number', min: 2, max: 100, step: 1 },
    { key: 'zoneH', label: 'Reveal zone height (%)', type: 'number', min: 2, max: 100, step: 1 },
    { key: 'fit', label: 'Reveal sizing (cover is always contain)', type: 'select', options: ['follow', 'fit'] },
    { key: 'cursor', label: 'Cursor style', type: 'select', options: ['inherit', 'crosshair', 'default', 'pointer', 'custom'] },
    { key: 'shadowBlur', label: 'Shadow blur', type: 'number', min: 0, max: 60, step: 1 },
    { key: 'shadowX', label: 'Shadow offset X', type: 'number', min: -40, max: 40, step: 1 },
    { key: 'shadowY', label: 'Shadow offset Y', type: 'number', min: -40, max: 40, step: 1 },
    { key: 'shadowColor', label: 'Shadow color', type: 'color' },
  ],
  assetSlots: [
    { key: 'prize', label: 'Prize image (revealed)' },
    { key: 'cover', label: 'Cover image (scratched off)' },
    { key: 'brushImage', label: 'Brush image (drag to scratch; optional)' },
    { key: 'cursorAsset', label: 'Custom cursor image (32×32 recommended)' },
  ],
  // revealScale/X/Y are edited by double-clicking the card on the canvas (no inspector
  // field) — they only apply when fit = 'fit'.
  defaultParams: { label: 'YOU WIN!', coverColor: '#9aa3b2', threshold: 0.6, zoneX: 0, zoneY: 0, zoneW: 100, zoneH: 100, fit: 'follow', revealScale: 1, revealX: 0, revealY: 0, revealBgColor: '', prize: '', cover: '', brushImage: '', brushRadius: 9, brushScale: 40, brushTipX: 50, brushTipY: 50, brushSpawnX: 50, brushSpawnY: 50, brushIntro: false, brushIntroPath: '', brushIntroDurationMs: 1600, brushIntroLoops: 2, cursor: 'inherit', cursorAsset: '', shadowBlur: 0, shadowX: 0, shadowY: 4, shadowColor: '#000000' },
  // Zig-zag scratch motion across the card (the editable hint's starting route).
  defaultHandguide: {
    nodes: [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.46 },
      { x: 0.2, y: 0.62 },
      { x: 0.8, y: 0.8 },
    ],
    periodMs: 1900,
  },
  create: createScratch,
}
