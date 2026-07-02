// Grid scratch card: N×M independently-scratchable cells.
// Win/lose overlays are either a full project scene (loseSceneId / winSceneId) mounted
// on top of the game via the 'scene-overlay' emitter event, or a simple image overlay.
// The game stays mounted throughout — no scene transition, no state loss.

import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { num, str } from './types'
import { emit } from '../emitter'
import { scale } from '../responsive'

interface CellState {
  el: HTMLDivElement
  canvas: HTMLCanvasElement
  c2d: CanvasRenderingContext2D
  labelEl: HTMLDivElement | null
  won: boolean
  isWin: boolean
  row: number
  col: number
  cellCoverImg: HTMLImageElement | null  // per-cell cover; null = use global
  cellCoverReady: boolean
  // Per-cell win overlay (resolved at mount: cell override || global default).
  // Only meaningful for win cells; lose cells use the shared lose overlay.
  winSceneId: string
  winOverlayImage: string
  winOverlayDurationMs: number
  // Per-cell hint path: the hand rubs between these two points, each normalized 0..1
  // within the cell (default 0.2,0.5 → 0.8,0.5 = a centered horizontal rub).
  hintFrom: { x: number; y: number }
  hintTo: { x: number; y: number }
}

// ---- threshold-driven reveal assets ----------------------------------------
// A dynamic (any-length) list of decorative/informational images that show or
// hide based on overall grid progress = (cells won) / (total cells). Each entry
// is visible while progress is within [showAt, hideAt). To make something
// "disappear" at a point, set hideAt. To make it "reappear" later, add a second
// entry (same src) with a later showAt. Configured via the `revealAssets` param
// as a JSON array, e.g.:
// [{ "src":"myAssetKey", "showAt":0.25, "hideAt":0.75, "x":10, "y":5, "width":30, "height":20 }]
interface RevealAssetCfg {
  src: string
  showAt: number // 0..1 fraction of cells revealed at which the asset becomes visible
  hideAt: number // 0..1 fraction at which it hides again (omit/1 = stays visible once shown)
  x: number // percent, left position within the game root
  y: number // percent, top position within the game root
  width: number // percent width
  height: number // percent height
}
interface RevealAssetState extends RevealAssetCfg {
  el: HTMLImageElement
  visible: boolean
}

const parseRevealAssets = (raw: string): RevealAssetCfg[] => {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: RevealAssetCfg[] = []
  for (const it of parsed) {
    if (!it || typeof it !== 'object') continue
    const rec = it as Record<string, unknown>
    const src = str(rec.src, '')
    if (!src) continue
    out.push({
      src,
      showAt: Math.max(0, Math.min(1, num(rec.showAt, 0))),
      // > 1 sentinel = "no upper bound" (never hides once shown)
      hideAt: rec.hideAt != null && rec.hideAt !== '' ? Math.max(0, Math.min(1, num(rec.hideAt, 1))) : 1.0001,
      x: num(rec.x, 0),
      y: num(rec.y, 0),
      width: num(rec.width, 100),
      height: num(rec.height, 100),
    })
  }
  return out
}

// ---- staggered per-cell entrance -------------------------------------------
// Each cell springs in from the right (+ fades), one at a time. The curve samples
// an underdamped spring (Framer-style stiffness 120 / damping 14 → damping ratio
// ζ≈0.64, a single soft overshoot) so it reads smooth rather than a mechanical
// slide. Sampled once into WAAPI keyframes; the per-cell `delay` does the stagger.
const CELL_ENTER_DUR_MS = 700
const CELL_ENTER_STAGGER_MS = 150 // delay = index * 0.15s
function buildCellEntranceKeyframes(fromPct: number): Keyframe[] {
  const wn = Math.sqrt(120)                  // natural frequency √(k/m), m=1
  const zeta = 14 / (2 * Math.sqrt(120))     // damping ratio c / 2√(km) ≈ 0.64
  const wd = wn * Math.sqrt(1 - zeta * zeta) // damped frequency
  const settleS = 0.7
  const N = 24
  const kf: Keyframe[] = []
  for (let i = 0; i < N; i++) {
    const f = i / N
    const t = f * settleS
    // normalized spring position 0→1 (overshoots slightly past 1, then settles)
    const p = 1 - Math.exp(-zeta * wn * t) * (Math.cos(wd * t) + (zeta * wn / wd) * Math.sin(wd * t))
    kf.push({ offset: f, transform: `translateX(${((1 - p) * fromPct).toFixed(2)}%)`, opacity: Math.max(0, Math.min(1, p)) })
  }
  kf.push({ offset: 1, transform: 'translateX(0)', opacity: 1 })
  return kf
}
const CELL_ENTER_KF = buildCellEntranceKeyframes(28) // start 28% to the right (≈ the 100px on a ~385px card)

export function createScratchGrid(): GameModule {
  let ctx: GameContext
  let cells: CellState[] = []
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null
  let ro: ResizeObserver | null = null
  let coverImg: HTMLImageElement | null = null
  let coverReady = false
  let coverColor = '#9aa3b2'
  let started = false
  let scratchingLocked = false
  let loseSceneId = ''
  let winSceneId = ''
  let loseOverlayImage = ''
  let winOverlayImage = ''
  let loseOverlayDurationMs = 1500
  let winOverlayDurationMs = 800
  let threshold = 0.5
  // 'cover' fills each cell (may crop); 'contain' fits the whole image inside the cell
  // (letterboxed, nothing cut) — applies to cover + reveal-background images.
  let imageFit: 'cover' | 'contain' = 'cover'
  let gridCols = 2
  let gridRows = 2
  let gridEl: HTMLDivElement | null = null
  let basePad = 0
  let baseColGap = 0
  let baseRowGap = 0
  let dprCleanup: (() => void) | null = null
  let revealAssetsState: RevealAssetState[] = []

  // Fraction of cells revealed (won) out of the total — the shared progress metric
  // that drives revealAssetsState visibility.
  const gridProgress = (): number => {
    if (cells.length === 0) return 0
    let won = 0
    for (const c of cells) if (c.won) won++
    return won / cells.length
  }

  const updateRevealAssets = (): void => {
    const p = gridProgress()
    for (const ra of revealAssetsState) {
      const shouldShow = p >= ra.showAt && p < ra.hideAt
      if (shouldShow !== ra.visible) {
        ra.visible = shouldShow
        ra.el.style.opacity = shouldShow ? '1' : '0'
      }
    }
  }

  const fillCellCover = (cell: CellState): void => {
    const { canvas, c2d } = cell
    const w = canvas.width
    const h = canvas.height
    c2d.globalCompositeOperation = 'source-over'
    c2d.clearRect(0, 0, w, h)
    // Per-cell cover takes priority; fall back to shared global cover
    const img = cell.cellCoverImg ?? coverImg
    const ready = cell.cellCoverImg ? cell.cellCoverReady : coverReady
    if (img && ready) {
      if (imageFit === 'contain') {
        // Fit the whole cover inside the cell (no crop). Fill the letterbox with the
        // cover color so the rest stays a scratchable surface — but if the cover color
        // is cleared (empty), leave it transparent so no box leaks around the image.
        if (coverColor) {
          c2d.fillStyle = coverColor
          c2d.fillRect(0, 0, w, h)
        }
        const iw = img.naturalWidth || img.width
        const ih = img.naturalHeight || img.height
        const s = Math.min(w / iw, h / ih)
        const dw = iw * s
        const dh = ih * s
        c2d.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
      } else {
        // True "cover": scale to FILL the cell, cropping overflow — preserves the image's
        // aspect (no stretch/squish), so baked-in text stays readable when the cell aspect
        // changes (e.g. landscape → portrait). Matches CSS object-fit:cover on the reveal.
        const iw = img.naturalWidth || img.width
        const ih = img.naturalHeight || img.height
        const s = Math.max(w / iw, h / ih)
        const dw = iw * s
        const dh = ih * s
        c2d.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
      }
      return
    }
    // No cover image: a cleared cover color leaves the cell transparent.
    if (!coverColor) return
    c2d.fillStyle = coverColor
    c2d.fillRect(0, 0, w, h)
    c2d.fillStyle = 'rgba(255,255,255,0.72)'
    const sz = Math.round(Math.min(w, h) * 0.12)
    c2d.font = `800 ${sz}px -apple-system,Segoe UI,sans-serif`
    c2d.textAlign = 'center'
    c2d.textBaseline = 'middle'
    c2d.fillText('SCRATCH', w / 2, h / 2)
  }

  const measure = (canvas: HTMLCanvasElement): number => {
    const o = document.createElement('canvas')
    o.width = 32
    o.height = 32
    const oc = o.getContext('2d')!
    oc.drawImage(canvas, 0, 0, 32, 32)
    const data = oc.getImageData(0, 0, 32, 32).data
    let clear = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] < 128) clear++
    return clear / (32 * 32)
  }

  const sizeAll = (): void => {
    if (gridEl) {
      // Padding + gaps are authored in DESIGN px — the same space as the element's w/h and
      // the editor's cell hit-testing (EditorCanvas computes cellW with raw gap/colGap).
      // Convert to screen px with the runtime FIT scale (the SAME transform that sizes the
      // game-mount slot), so the grid renders identically at every viewport size, browser
      // zoom level, and devicePixelRatio. The old code locked a reference width from the
      // first layout, so reloading at a different zoom captured a different reference and
      // the padding ballooned / cells shrank / the cover lost resolution.
      const s = scale()
      gridEl.style.padding = (basePad * s).toFixed(1) + 'px'
      gridEl.style.columnGap = (baseColGap * s).toFixed(1) + 'px'
      gridEl.style.rowGap = (baseRowGap * s).toFixed(1) + 'px'
    }
    for (const cell of cells) {
      const { el, canvas, labelEl, won, row, col } = cell
      const cssW = Math.max(2, Math.round(el.clientWidth))
      const cssH = Math.max(2, Math.round(el.clientHeight))
      if (cssW > 2 && labelEl) {
        labelEl.style.fontSize = Math.round(Math.min(cssW, cssH) * 0.12) + 'px'
      }
      // Only round the 4 outer corners of the grid; inner corners stay square
      const r = Math.round(Math.min(cssW, cssH) * 0.09)
      const tl = row === 0 && col === 0 ? r : 0
      const tr = row === 0 && col === gridCols - 1 ? r : 0
      const br = row === gridRows - 1 && col === gridCols - 1 ? r : 0
      const bl = row === gridRows - 1 && col === 0 ? r : 0
      el.style.borderRadius = `${tl}px ${tr}px ${br}px ${bl}px`
      // Keep the canvas's CSS size pinned to the cell every pass (cheap) so it fills the
      // cell exactly even when only the CSS size shifts (e.g. a live browser-zoom resize).
      canvas.style.width = cssW + 'px'
      canvas.style.height = cssH + 'px'
      // Backing store at the FULL device pixel ratio keeps the cover crisp at the current
      // browser-zoom level. In the FIT-scaled viewport the cell SHRINKS in CSS px as zoom
      // (and thus devicePixelRatio) rises, so cssW·dpr — the cell's true physical pixel
      // size — stays bounded; honor it instead of clamping with a hard `min(3, dpr)`
      // ceiling, which clipped the resolution and blurred the cover past ~150% zoom on a
      // 2× display. A pixel-AREA cap still guards memory for a pathologically large cell.
      let dpr = Math.max(1, window.devicePixelRatio || 1)
      const MAX_BACKING_PX = 8_294_400 // 3840×2160 (~33 MB) — far above any real cell
      const area = cssW * cssH * dpr * dpr
      if (area > MAX_BACKING_PX) dpr *= Math.sqrt(MAX_BACKING_PX / area)
      const w = Math.round(cssW * dpr)
      const h = Math.round(cssH * dpr)
      // Reallocate the backing store ONLY when the device-pixel size actually changes —
      // assigning canvas.width/height resets the bitmap, which would wipe in-progress
      // scratching. (Browser zoom that keeps the physical size constant won't reset it.)
      if (w === canvas.width && h === canvas.height) continue
      canvas.width = w
      canvas.height = h
      if (!won && started) fillCellCover(cell)
    }
  }

  // Show a full-screen overlay on the stage container (above all scene elements).
  // Fades out after `durationMs` then calls onDone.
  const showOverlay = (imageSrc: string, durationMs: number, onDone?: () => void): void => {
    const rootEl = ctx.root.closest?.('.pa-root') as HTMLElement | null
    const gameRoot = rootEl ?? ctx.root
    // Mount overlay on the container (.pa-stage) so it lives outside the blurred gameRoot
    const stageContainer = gameRoot.parentElement ?? gameRoot

    const immuneEls = Array.from(gameRoot.querySelectorAll<HTMLElement>('.pa-el--immune'))
    const savedParents = immuneEls.map((el) => el.parentElement)
    const savedZ = immuneEls.map((el) => el.style.zIndex)
    const savedTransform = immuneEls.map((el) => el.style.transform)
    immuneEls.forEach((el) => {
      stageContainer.appendChild(el)
      el.style.zIndex = '10000'
      // Strip translateZ so Chrome's compositor doesn't anti-alias the bar's GPU layer
      // edge against the overlay content (which would show the overlay's bg color as a
      // 1px strip at the bar's top/left edges).
      const t = el.style.transform
      el.style.transform = t.replace(/\s*translateZ\(0\)/gi, '').trim() || 'none'
    })

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:absolute;inset:0;z-index:9000;pointer-events:all;'
    if (imageSrc) {
      const img = document.createElement('img')
      img.src = imageSrc
      img.draggable = false
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;'
      overlay.appendChild(img)
    } else {
      overlay.style.cssText += 'background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;'
    }
    stageContainer.appendChild(overlay)
    window.setTimeout(() => {
      overlay.style.transition = 'opacity 280ms ease'
      overlay.style.opacity = '0'
      window.setTimeout(() => {
        overlay.remove()
        immuneEls.forEach((el, i) => {
          el.style.transform = savedTransform[i]
          el.style.zIndex = savedZ[i]
          const p = savedParents[i]
          if (p) p.appendChild(el)
        })
        onDone?.()
      }, 300)
    }, durationMs)
  }

  // Block all unwon canvases. Sets scratchingLocked so that any ongoing captured
  // pointer/touch that bypasses pointer-events:none can't restart the sfx loop.
  const lockAllCells = (): void => {
    scratchingLocked = true
    ctx.sfx.loopStop?.('drag')
    for (const c of cells) {
      if (!c.won) c.canvas.style.pointerEvents = 'none'
    }
  }

  const unlockAllCells = (): void => {
    scratchingLocked = false
    for (const c of cells) {
      if (!c.won) c.canvas.style.pointerEvents = 'auto'
    }
  }

  const revealCell = (cell: CellState): void => {
    if (cell.won) return
    cell.won = true
    cell.el.dataset.won = '1'
    updateRevealAssets()
    lockAllCells() // stops loop + blocks all canvases immediately
    cell.canvas.style.transition = 'opacity 400ms ease'
    requestAnimationFrame(() => { cell.canvas.style.opacity = '0' })

    if (cell.isWin) {
      winCb?.()
      if (cell.winSceneId) {
        // Redirect straight INTO the win scene (a full transition that covers the game)
        // rather than floating it as a dismissable overlay — the overlay path faded back
        // to the game scene before advancing, causing a game-scene flash. The win scene's
        // own Advance setting now drives the next hop (e.g. tap/timer → end scene).
        window.setTimeout(() => emit('scene-goto', cell.winSceneId), 350)
      } else if (cell.winOverlayImage) {
        window.setTimeout(() => showOverlay(cell.winOverlayImage, cell.winOverlayDurationMs, () => completeCb?.()), 350)
      } else {
        window.setTimeout(() => completeCb?.(), 450)
      }
    } else {
      // Re-enable remaining cells after overlay dismisses
      const afterLoseOverlay = (): void => {
        if (!cells.every((c) => c.won)) unlockAllCells()
      }
      if (loseSceneId) {
        window.setTimeout(() => emit('scene-overlay', { sceneId: loseSceneId, onDone: afterLoseOverlay }), 350)
      } else if (loseOverlayImage) {
        window.setTimeout(() => showOverlay(loseOverlayImage, loseOverlayDurationMs, afterLoseOverlay), 350)
      } else {
        afterLoseOverlay()
      }
      if (cells.every((c) => c.won)) {
        const delay = (loseSceneId || loseOverlayImage) ? loseOverlayDurationMs + 700 : 450
        window.setTimeout(() => completeCb?.(), delay)
      }
    }
  }

  const setupCell = (cell: CellState): void => {
    const { canvas, c2d } = cell
    let lastPt: { x: number; y: number } | null = null
    let moves = 0
    let touchActive = false

    const toCanvas = (cx: number, cy: number): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect()
      return {
        x: ((cx - r.left) / Math.max(1, r.width)) * canvas.width,
        y: ((cy - r.top) / Math.max(1, r.height)) * canvas.height,
      }
    }

    const erodeAt = (x: number, y: number): void => {
      c2d.globalCompositeOperation = 'destination-out'
      c2d.fillStyle = '#000'
      c2d.strokeStyle = '#000'
      const r = Math.max(10, Math.min(canvas.width, canvas.height) * 0.1)
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

    const onMove = (cx: number, cy: number): void => {
      if (cell.won || scratchingLocked) return
      const p = toCanvas(cx, cy)
      erodeAt(p.x, p.y)
      if ((moves++ & 7) === 0 && measure(canvas) >= threshold) revealCell(cell)
    }

    const onEnd = (): void => {
      ctx.sfx.loopStop?.('drag')
      lastPt = null
      if (!cell.won && measure(canvas) >= threshold) revealCell(cell)
    }

    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (cell.won || scratchingLocked) return
        touchActive = true
        ctx.sfx.loopStart?.('drag')
        lastPt = null
        const t = e.changedTouches[0]
        const p = toCanvas(t.clientX, t.clientY)
        erodeAt(p.x, p.y)
        const onTouchMove = (ev: TouchEvent): void => {
          ev.preventDefault()
          onMove(ev.changedTouches[0].clientX, ev.changedTouches[0].clientY)
        }
        const onTouchEnd = (): void => {
          canvas.removeEventListener('touchmove', onTouchMove)
          canvas.removeEventListener('touchend', onTouchEnd)
          canvas.removeEventListener('touchcancel', onTouchEnd)
          touchActive = false
          onEnd()
        }
        canvas.addEventListener('touchmove', onTouchMove, { passive: false })
        canvas.addEventListener('touchend', onTouchEnd)
        canvas.addEventListener('touchcancel', onTouchEnd)
      },
      { passive: true },
    )

    canvas.addEventListener('pointerdown', (e) => {
      if (cell.won || touchActive || e.pointerType === 'touch' || scratchingLocked) return
      e.preventDefault()
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      ctx.sfx.loopStart?.('drag')
      lastPt = null
      const p = toCanvas(e.clientX, e.clientY)
      erodeAt(p.x, p.y)
      const onPointerMove = (ev: PointerEvent): void => onMove(ev.clientX, ev.clientY)
      const onPointerUp = (): void => {
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerup', onPointerUp)
        canvas.removeEventListener('pointercancel', onPointerUp)
        onEnd()
      }
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerUp)
      canvas.addEventListener('pointercancel', onPointerUp)
    })
  }

  return {
    mount(c, params) {
      ctx = c
      const cols = Math.max(1, Math.min(4, num(params.cols, 2)))
      const rows = Math.max(1, Math.min(4, num(params.rows, 2)))
      gridCols = cols
      gridRows = rows
      const total = cols * rows
      threshold = Math.max(0.2, Math.min(0.95, num(params.threshold, 0.5)))
      imageFit = str(params.imageFit as unknown, 'cover') === 'contain' ? 'contain' : 'cover'
      coverColor = str(params.coverColor, '#9aa3b2')
      // Empty string = user cleared the swatch → transparent cell background.
      const winBgColor = str(params.winBgColor, '#1b3a6e') || 'transparent'
      const loseBgColor = str(params.loseBgColor, '#7b1d1d') || 'transparent'
      const winLabel = str(params.winLabel, 'Promo')
      const loseLabel = str(params.loseLabel, 'TRY AGAIN')
      const gap = Math.max(0, num(params.gap, 10))
      loseSceneId = str(params.loseSceneId as unknown, '')
      winSceneId = str(params.winSceneId as unknown, '')
      loseOverlayImage = ctx.assets.src(str(params.loseOverlayImage as unknown, ''))
      winOverlayImage = ctx.assets.src(str(params.winOverlayImage as unknown, ''))
      loseOverlayDurationMs = Math.max(200, num(params.loseOverlayDurationMs as unknown, 1500))
      winOverlayDurationMs = Math.max(200, num(params.winOverlayDurationMs as unknown, 800))
      const rawPattern = str(params.pattern, 'W' + 'L'.repeat(total - 1))
      const coverSrc = ctx.assets.src(str(params.cover, ''))
      const winImageSrc = ctx.assets.src(str(params.winImage, ''))
      const loseImageSrc = ctx.assets.src(str(params.loseImage, ''))

      const isWinCell: boolean[] = []
      for (let i = 0; i < total; i++) {
        const ch = (rawPattern[i] ?? 'L').toUpperCase()
        isWinCell.push(ch === 'W')
      }

      const winTextImageSrc = ctx.assets.src(str(params.winTextImage, ''))
      const loseTextImageSrc = ctx.assets.src(str(params.loseTextImage, ''))

      // Shared reveal content applied to every cell (win AND lose), sitting between the
      // per-cell override and the win/lose-specific fallback.
      const sharedBgSrc = ctx.assets.src(str(params.sharedBg as unknown, ''))
      const sharedTextSrc = ctx.assets.src(str(params.sharedText as unknown, ''))

      // Per-cell overrides: cell0..cell3 images and cell0Label..cell3Label text
      const cellImageSrc = (i: number): string =>
        ctx.assets.src(str(params['cell' + i] as unknown, '')) ||
        sharedBgSrc ||
        (isWinCell[i] ? winImageSrc : loseImageSrc)
      const cellLabel = (i: number): string =>
        str(params['cell' + i + 'Label'] as unknown, '') ||
        (isWinCell[i] ? winLabel : loseLabel)
      // Text-image overlay: a transparent PNG with just the text/offer graphic.
      // Swap only this to A/B test different offers without touching the layout.
      const cellTextImgSrc = (i: number): string =>
        ctx.assets.src(str(params['cell' + i + 'text'] as unknown, '')) ||
        sharedTextSrc ||
        (isWinCell[i] ? winTextImageSrc : loseTextImageSrc)
      const globalTextScale = Math.max(10, Math.min(100, num(params.textScale as unknown, 80)))
      const cellTextScale = (i: number): number => {
        const v = params['cell' + i + 'textScale']
        return v != null && v !== '' ? Math.max(10, Math.min(100, num(v as unknown, globalTextScale))) : globalTextScale
      }

      // Per-cell win overlay overrides (each falls back to the global default).
      const cellWinSceneId = (i: number): string =>
        str(params['cell' + i + 'winSceneId'] as unknown, '') || winSceneId
      const cellWinOverlayImage = (i: number): string =>
        ctx.assets.src(str(params['cell' + i + 'winOverlayImage'] as unknown, '')) || winOverlayImage
      const cellWinOverlayDurationMs = (i: number): number => {
        const v = params['cell' + i + 'winOverlayDurationMs']
        return v != null && v !== '' ? Math.max(200, num(v as unknown, winOverlayDurationMs)) : winOverlayDurationMs
      }

      // Per-cell hint path (start/end points as a 0..1 fraction of the cell).
      const pct = (key: string, d: number): number => {
        const v = params[key]
        return v != null && v !== '' ? Math.max(0, Math.min(1, num(v as unknown, d * 100) / 100)) : d
      }
      const cellHintPath = (i: number): { hintFrom: { x: number; y: number }; hintTo: { x: number; y: number } } => ({
        hintFrom: { x: pct('cell' + i + 'hintFromX', 0.2), y: pct('cell' + i + 'hintFromY', 0.5) },
        hintTo: { x: pct('cell' + i + 'hintToX', 0.8), y: pct('cell' + i + 'hintToY', 0.5) },
      })

      ctx.root.style.overflow = 'hidden'
      ctx.root.style.touchAction = 'none'
      ctx.root.style.position = 'relative'

      const bgImageSrc = ctx.assets.src(str(params.bgImage as unknown, ''))
      if (bgImageSrc) {
        const bgScale = num(params.bgScale as unknown, 100)
        const bgX = num(params.bgX as unknown, 50)
        const bgY = num(params.bgY as unknown, 50)
        const bgEl = document.createElement('div')
        bgEl.style.cssText = `position:absolute;inset:0;pointer-events:none;background:url("${bgImageSrc}") ${bgX}% ${bgY}% / ${bgScale}% no-repeat;`
        ctx.root.appendChild(bgEl)
      }

      const colGap = Math.max(0, num(params.colGap as unknown, gap))
      const rowGap = Math.max(0, num(params.rowGap as unknown, gap))
      const grid = document.createElement('div')
      grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);column-gap:${colGap}px;row-gap:${rowGap}px;padding:${gap}px;width:100%;height:100%;box-sizing:border-box;position:relative;`
      gridEl = grid
      basePad = gap
      baseColGap = colGap
      baseRowGap = rowGap
      ctx.root.appendChild(grid)

      if (coverSrc) {
        coverImg = new Image()
        coverImg.onload = () => {
          coverReady = true
          if (started) for (const cell of cells) if (!cell.won) fillCellCover(cell)
        }
        coverImg.src = coverSrc
      }

      for (let i = 0; i < total; i++) {
        const isWin = isWinCell[i]
        const cellEl = document.createElement('div')
        cellEl.style.cssText = 'position:relative;overflow:hidden;'
        cellEl.dataset.scratchCell = String(i)
        // Expose this cell's hint path so the editable hand-guide element (which reads the
        // DOM, not the game params) rubs along the same per-cell start→end points.
        const hintPath = cellHintPath(i)
        cellEl.dataset.hintFx = String(hintPath.hintFrom.x)
        cellEl.dataset.hintFy = String(hintPath.hintFrom.y)
        cellEl.dataset.hintTx = String(hintPath.hintTo.x)
        cellEl.dataset.hintTy = String(hintPath.hintTo.y)

        const revealDiv = document.createElement('div')
        revealDiv.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:800;color:#fff;user-select:none;-webkit-user-select:none;background:${isWin ? winBgColor : loseBgColor};`

        let labelEl: HTMLDivElement | null = null
        const imgSrc = cellImageSrc(i)
        if (imgSrc) {
          const img = document.createElement('img')
          img.src = imgSrc
          img.draggable = false
          img.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:${imageFit};pointer-events:none;`
          revealDiv.appendChild(img)
        } else {
          labelEl = document.createElement('div')
          labelEl.textContent = cellLabel(i)
          labelEl.style.cssText = 'padding:8%;word-break:break-word;line-height:1.2;white-space:pre-line;'
          revealDiv.appendChild(labelEl)
        }
        // Text image: transparent PNG overlay for the offer text — swap this to
        // change what's shown without touching the background or layout.
        const textSrc = cellTextImgSrc(i)
        if (textSrc) {
          const textImg = document.createElement('img')
          textImg.src = textSrc
          textImg.draggable = false
          const pad = Math.round((100 - cellTextScale(i)) / 2)
          textImg.style.cssText =
            `position:absolute;inset:0;width:100%;height:100%;object-fit:contain;` +
            `pointer-events:none;padding:${pad}%;box-sizing:border-box;`
          revealDiv.appendChild(textImg)
        }
        cellEl.appendChild(revealDiv)

        const canvas = document.createElement('canvas')
        canvas.draggable = false
        // Transparent in editor (reveals are visible); start() makes it opaque for play.
        // No drop-shadow: for a full-bleed cover it's clipped by the cell anyway, but for
        // a cover with transparent corners (e.g. a rounded button PNG) it casts a dark
        // shadow INTO those corners — the "dark corner" artifact. Leave the cover clean.
        canvas.style.cssText =
          'position:absolute;inset:0;touch-action:none;user-select:none;-webkit-user-select:none;' +
          '-webkit-user-drag:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;opacity:0;'
        canvas.addEventListener('dragstart', (e) => e.preventDefault())
        const c2d = canvas.getContext('2d')!
        cellEl.appendChild(canvas)
        grid.appendChild(cellEl)

        const cellState: CellState = {
          el: cellEl, canvas, c2d, labelEl, won: false, isWin,
          row: Math.floor(i / cols), col: i % cols,
          cellCoverImg: null, cellCoverReady: false,
          winSceneId: cellWinSceneId(i),
          winOverlayImage: cellWinOverlayImage(i),
          winOverlayDurationMs: cellWinOverlayDurationMs(i),
          ...hintPath,
        }
        const cellCoverSrc = ctx.assets.src(str(params['cell' + i + 'cover'] as unknown, ''))
        if (cellCoverSrc) {
          const img = new Image()
          img.onload = () => {
            cellState.cellCoverReady = true
            if (started && !cellState.won) fillCellCover(cellState)
          }
          img.src = cellCoverSrc
          cellState.cellCoverImg = img
        }
        cells.push(cellState)
      }

      revealAssetsState = parseRevealAssets(str(params.revealAssets as unknown, '[]')).map((cfg) => {
        const img = document.createElement('img')
        img.draggable = false
        img.style.cssText =
          `position:absolute;left:${cfg.x}%;top:${cfg.y}%;width:${cfg.width}%;height:${cfg.height}%;` +
          'object-fit:contain;pointer-events:none;opacity:0;transition:opacity 300ms ease;z-index:400;'
        const resolved = ctx.assets.src(cfg.src)
        if (resolved) img.src = resolved
        ctx.root.appendChild(img)
        return { ...cfg, el: img, visible: false }
      })
      updateRevealAssets() // set initial visibility (covers any showAt: 0 entries)

      ro = new ResizeObserver(sizeAll)
      ro.observe(ctx.root)
      sizeAll()

      // Re-render at the new devicePixelRatio when browser zoom changes WITHOUT a viewport
      // resize (e.g. the editor's fixed-size preview iframe — only DPR shifts, no resize
      // event fires, so the cover would otherwise stay at the old resolution and look
      // blurry). A resolution media query matches one dppx and fires once when zoom crosses
      // it, so we re-arm a fresh listener after each change. sizeAll's own guard only
      // reallocates the bitmap when the device-pixel size truly changed, so this is cheap
      // and never wipes scratch progress.
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
        const onChange = (): void => { sizeAll(); armDpr() }
        const legacy = mql as unknown as {
          addListener?: (l: () => void) => void
          removeListener?: (l: () => void) => void
        }
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
      started = true
      for (const cell of cells) {
        cell.canvas.style.opacity = '1'
        if (!cell.won) fillCellCover(cell)
      }
      for (const cell of cells) setupCell(cell)
      // Staggered spring entrance: cells slide/fade in from the right, one at a time
      // (row-major order). `fill:'backwards'` holds each cell hidden through its delay
      // so the reveal is truly one-at-a-time, then releases to the natural state. The
      // stagger compresses for large grids so the last cell doesn't lag several seconds.
      if (typeof cells[0]?.el.animate === 'function') {
        const stagger = Math.min(CELL_ENTER_STAGGER_MS, 1600 / Math.max(1, cells.length - 1))
        cells.forEach((cell, i) => {
          cell.el.animate(CELL_ENTER_KF, { duration: CELL_ENTER_DUR_MS, delay: i * stagger, easing: 'linear', fill: 'backwards' })
        })
      }
    },

    relayout: sizeAll,

    getHint(): HintMove | null {
      const cell = cells.find((c) => !c.won)
      if (!cell) return null
      const r = cell.canvas.getBoundingClientRect()
      // Shrink the hint hand so it fits the cell (the hand is a fixed ~46×56px). Short,
      // wide cells in a 1-column / 4-row grid would otherwise get an oversized hand that
      // looks off-center; cap at 1 so normal cells keep the natural size.
      const fit = Math.max(0.45, Math.min(1, Math.min((r.height * 0.62) / 56, (r.width * 0.62) / 46)))
      // The hand rubs along this cell's configured start→end path (defaults to a
      // centered horizontal rub). Points are a 0..1 fraction of the cell.
      return {
        from: { x: r.left + r.width * cell.hintFrom.x, y: r.top + r.height * cell.hintFrom.y },
        to: { x: r.left + r.width * cell.hintTo.x, y: r.top + r.height * cell.hintTo.y },
        kind: 'scratch',
        scale: fit,
      }
    },

    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },

    destroy() {
      started = false
      scratchingLocked = false
      coverImg = null
      coverReady = false
      ro?.disconnect()
      dprCleanup?.()
      dprCleanup = null
      ctx.root.innerHTML = ''
      cells = []
      gridEl = null
      revealAssetsState = []
    },
  }
}

export const SCRATCH_GRID_TEMPLATE: GameTemplate = {
  id: 'scratch_grid',
  label: 'Scratch grid',
  paramFields: [
    { key: 'cols', label: 'Columns', type: 'number', min: 1, max: 4, step: 1 },
    { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 4, step: 1 },
    { key: 'pattern', label: 'Win pattern (W=win, L=lose, left→right top→bottom)', type: 'text' },
    { key: 'coverColor', label: 'Cover color', type: 'color' },
    { key: 'winBgColor', label: 'Win cell background', type: 'color' },
    { key: 'loseBgColor', label: 'Lose cell background', type: 'color' },
    { key: 'winLabel', label: 'Win cell text (fallback)', type: 'text' },
    { key: 'loseLabel', label: 'Lose cell text (fallback)', type: 'text' },
    { key: 'cell0Label', label: 'Cell 1 text override', type: 'text' },
    { key: 'cell1Label', label: 'Cell 2 text override', type: 'text' },
    { key: 'cell2Label', label: 'Cell 3 text override', type: 'text' },
    { key: 'cell3Label', label: 'Cell 4 text override', type: 'text' },
    { key: 'gap', label: 'Outer padding', type: 'number', min: 0, max: 60, step: 2 },
    { key: 'colGap', label: 'Column gap', type: 'number', min: 0, max: 60, step: 2 },
    { key: 'rowGap', label: 'Row gap', type: 'number', min: 0, max: 60, step: 2 },
    { key: 'bgScale', label: 'BG image scale (%)', type: 'number', min: 10, max: 300, step: 5 },
    { key: 'bgX', label: 'BG image X (%)', type: 'number', min: 0, max: 100, step: 5 },
    { key: 'bgY', label: 'BG image Y (%)', type: 'number', min: 0, max: 100, step: 5 },
    { key: 'textScale', label: 'Text overlay scale (%, all cells)', type: 'number', min: 10, max: 100, step: 5 },
    { key: 'loseOverlayDurationMs', label: 'Lose overlay duration (ms)', type: 'number', min: 200, max: 5000, step: 100 },
    { key: 'winOverlayDurationMs', label: 'Win overlay duration (ms)', type: 'number', min: 200, max: 5000, step: 100 },
    { key: 'threshold', label: 'Reveal at (fraction scratched)', type: 'number', min: 0.2, max: 0.9, step: 0.05 },
    {
      key: 'revealAssets',
      label: 'Threshold assets (JSON list: src/showAt/hideAt/x/y/width/height)',
      type: 'text',
    },
  ],
  assetSlots: [
    { key: 'cover', label: 'Cover image (shared fallback)' },
    { key: 'sharedBg', label: 'Shared background reveal (all cells)' },
    { key: 'sharedText', label: 'Shared text overlay (all cells)' },
    { key: 'cell0cover', label: 'Cell 1 cover image' },
    { key: 'cell1cover', label: 'Cell 2 cover image' },
    { key: 'cell2cover', label: 'Cell 3 cover image' },
    { key: 'cell3cover', label: 'Cell 4 cover image' },
    { key: 'cell0', label: 'Cell 1 background image (top-left)' },
    { key: 'cell1', label: 'Cell 2 background image (top-right)' },
    { key: 'cell2', label: 'Cell 3 background image (bottom-left)' },
    { key: 'cell3', label: 'Cell 4 background image (bottom-right)' },
    { key: 'cell0text', label: 'Cell 1 text image overlay' },
    { key: 'cell1text', label: 'Cell 2 text image overlay' },
    { key: 'cell2text', label: 'Cell 3 text image overlay' },
    { key: 'cell3text', label: 'Cell 4 text image overlay' },
    { key: 'winImage', label: 'Win cells background (fallback)' },
    { key: 'loseImage', label: 'Lose cells background (fallback)' },
    { key: 'winTextImage', label: 'Win cells text overlay (fallback)' },
    { key: 'loseTextImage', label: 'Lose cells text overlay (fallback)' },
    { key: 'loseOverlayImage', label: 'Lose overlay image (full-screen)' },
    { key: 'winOverlayImage', label: 'Win overlay image (full-screen)' },
    { key: 'bgImage', label: 'Container background image' },
  ],
  defaultParams: {
    cols: 2,
    rows: 2,
    pattern: 'LWWL',
    winLabel: 'Promo',
    loseLabel: 'TRY\nAGAIN',
    coverColor: '#9aa3b2',
    winBgColor: '#1b3a6e',
    loseBgColor: '#7b1d1d',
    gap: 10,
    colGap: 10,
    rowGap: 10,
    loseSceneId: '',
    winSceneId: '',
    loseOverlayImage: '',
    winOverlayImage: '',
    loseOverlayDurationMs: 1500,
    winOverlayDurationMs: 800,
    bgImage: '', bgScale: 100, bgX: 50, bgY: 50,
    threshold: 0.5,
    imageFit: 'cover',
    cover: '',
    sharedBg: '', sharedText: '',
    cell0cover: '', cell1cover: '', cell2cover: '', cell3cover: '',
    cell0: '', cell1: '', cell2: '', cell3: '',
    cell0text: '', cell1text: '', cell2text: '', cell3text: '',
    cell0textScale: '', cell1textScale: '', cell2textScale: '', cell3textScale: '',
    cell0Label: '', cell1Label: '', cell2Label: '', cell3Label: '',
    cell0winSceneId: '', cell1winSceneId: '', cell2winSceneId: '', cell3winSceneId: '',
    cell0winOverlayImage: '', cell1winOverlayImage: '', cell2winOverlayImage: '', cell3winOverlayImage: '',
    cell0winOverlayDurationMs: '', cell1winOverlayDurationMs: '', cell2winOverlayDurationMs: '', cell3winOverlayDurationMs: '',
    textScale: 80,
    winImage: '', loseImage: '',
    winTextImage: '', loseTextImage: '',
    revealAssets: '[]',
  },
  defaultHandguide: {
    nodes: [
      { x: 0.15, y: 0.25 },
      { x: 0.42, y: 0.25 },
    ],
    periodMs: 1100,
  },
  create: createScratchGrid,
}