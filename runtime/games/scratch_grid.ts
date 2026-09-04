// Grid scratch card: N×M independently-scratchable cells.
// Win/lose overlays are either a full project scene (loseSceneId / winSceneId) mounted
// on top of the game via the 'scene-overlay' emitter event, or a simple image overlay.
// The game stays mounted throughout — no scene transition, no state loss.

import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { num, str } from './types'
import { emit } from '../emitter'
import { cssFontFamily } from '../font'
import { scale } from '../responsive'
import { braceBareTokens, renderCountdownFormat } from '../elements/countdown'

interface CellState {
  el: HTMLDivElement
  canvas: HTMLCanvasElement
  c2d: CanvasRenderingContext2D
  labelEl: HTMLDivElement | null
  // Dynamic date rendered inside the reveal (under the cover). Sized in sizeAll
  // as a fraction of the cell's short side, so it scales exactly like the cell art.
  dateEl: HTMLDivElement | null
  won: boolean
  isWin: boolean
  row: number
  col: number
  // Analytic scratch coverage in normalized cell space (COVERAGE_S × COVERAGE_S grid; 1 = cleared).
  // measure() reads THIS, never the canvas — a getImageData readback is farbled/zeroed by Brave's
  // fingerprint shield inside a 3rd-party ad iframe (AppLovin) → false ~100% → instant win on the
  // first touch. The grid is normalized, so it also survives a backing-store resize untouched.
  coverGrid: Uint8Array
  cellCoverImg: HTMLImageElement | null  // per-cell cover; null = use global
  cellCoverReady: boolean
  // Reveal background rendered on its OWN canvas (not an <img>) so it aligns pixel-for-pixel
  // with the cover canvas above it — same element type, size and fit math → no edge leak.
  revealCanvas: HTMLCanvasElement | null
  revealC2d: CanvasRenderingContext2D | null
  revealImg: HTMLImageElement | null
  revealReady: boolean
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

// Opaque stand-in painted over a cell while its configured cover image is still loading (or if
// the load never resolves in a shielded webview). Matches the default cover color so the momentary
// state looks intentional; it's replaced by the real image the instant onload fires.
const COVER_LOAD_FALLBACK = '#9aa3b2'

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

// Resolution of the per-cell analytic coverage grid (see CellState.coverGrid). 64×64 matches the
// old getImageData sample density, so the win threshold feels the same — just without a canvas read.
const COVERAGE_S = 64

// Mark every grid cell whose center falls inside the ellipse (gcx,gcy) radius (grx,gry) as cleared.
// The ellipse (rather than a circle) accounts for a non-square cell mapping onto the uniform grid.
const stampDisc = (grid: Uint8Array, gcx: number, gcy: number, grx: number, gry: number): void => {
  const S = COVERAGE_S
  const rx = Math.max(0.5, grx)
  const ry = Math.max(0.5, gry)
  const x0 = Math.max(0, Math.floor(gcx - rx))
  const x1 = Math.min(S - 1, Math.ceil(gcx + rx))
  const y0 = Math.max(0, Math.floor(gcy - ry))
  const y1 = Math.min(S - 1, Math.ceil(gcy + ry))
  const rx2 = rx * rx
  const ry2 = ry * ry
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const dx = gx + 0.5 - gcx
      const dy = gy + 0.5 - gcy
      if ((dx * dx) / rx2 + (dy * dy) / ry2 <= 1) grid[gy * S + gx] = 1
    }
  }
}

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
  // Reveal zone (shared, normalized 0..1 WITHIN each cell): only clearing inside this
  // rectangle counts toward a cell's threshold; scratching outside it never contributes.
  // Defaults to the whole cell (no gating), so existing grids are unchanged.
  let zoneX = 0
  let zoneY = 0
  let zoneW = 1
  let zoneH = 1
  // 'cover' fills each cell (may crop); 'contain' fits the whole image inside the cell
  // (letterboxed, nothing cut) — applies to cover + reveal-background images.
  let imageFit: 'cover' | 'contain' = 'cover'
  let gridCols = 2
  let gridRows = 2
  let gridEl: HTMLDivElement | null = null
  // Outer-corner rounding as a fraction of the cell's short side. Authored via the
  // cellRadius param (percent); 9% is the historical hardcoded look, 0 = square.
  let cellRadiusFrac = 0.09
  // Dynamic-date font size as a fraction of the cell's short side (see CellState.dateEl).
  let dateSizeFrac = 0.08
  let basePad = 0
  let baseColGap = 0
  let baseRowGap = 0
  let dprCleanup: (() => void) | null = null
  let revealAssetsState: RevealAssetState[] = []

  // ---- brush (optional) ----------------------------------------------------
  // An image that follows the finger/cursor while scratching. The SCRATCH happens at the
  // brush's authored TIP (a point within the image, fraction 0..1), and the erode radius is
  // authored independently — so a paintbrush graphic can have its bristle tip do the clearing
  // while the handle just trails along. Purely visual + the tip offset; the coverage math is
  // unchanged. When no brush image is set, none of this activates (radius still configurable).
  let brushImg: HTMLImageElement | null = null // decoded source (for aspect ratio)
  let brushEl: HTMLImageElement | null = null // the floating visual
  // The brush is mounted on a NON-CLIPPED ancestor (the stage) rather than ctx.root, so it can
  // overflow past the card's edges (a big brush's handle can stick out) instead of being cut off
  // by the game root's overflow:hidden. All positions are computed relative to this host.
  let brushHost: HTMLElement | null = null
  let brushTipX = 0.5 // tip position within the brush image, 0..1 (0.5 = center)
  let brushTipY = 0.5
  let brushRadiusFrac = 0.1 // erode radius as a fraction of the cell's short side (0.1 = old default)
  let brushScaleFrac = 0.4 // brush display width as a fraction of the cell's short side
  let brushSpawnX = 0.5 // resting spawn position, fraction of the card (0.5 = center)
  let brushSpawnY = 0.5
  // Follow mode: instead of a persistent tool the player grabs, the brush stays hidden and
  // appears CENTERED under the finger while scratching, then disappears on release. Any press
  // on a cell starts a scratch (no grab required).
  let brushFollow = false
  let brushIntro = false // play a demo "draw path" rub at the start (like the handguide hint)
  let brushIntroPath: { x: number; y: number }[] = [] // authored path, points as fractions 0..1 of the card
  let brushIntroDurationMs = 1600 // duration of ONE pass along the path (lower = faster)
  let brushIntroLoops = 2 // how many times the path repeats
  let brushIntroAnim: Animation | null = null
  // Per-gesture cache so a pointermove does zero layout reads (toCanvas already forces one).
  let brushRootRect: DOMRect | null = null // brushHost rect
  let brushW = 0 // rendered brush size in px
  let brushH = 0
  let brushCenter: { x: number; y: number } | null = null // current brush center, in client coords
  let brushCardRect: DOMRect | null = null // card (ctx.root) rect, cached per gesture — clamps the brush
  // The brush's resting position as a FRACTION of the card (0..1). This is the source of truth so the
  // brush stays put RELATIVE to the card across AppLovin orientation flips / resizes / zoom (its
  // absolute pixel spot is recomputed from this on every relayout). Starts at the authored spawn.
  let brushFracX = 0.5
  let brushFracY = 0.5
  const brushHostRect = (): DOMRect => (brushHost ?? ctx.root).getBoundingClientRect()

  // Is a press ON the brush? Used to require the player to GRAB the brush and drag it, rather than
  // scratching wherever they tap. Generous padding so it's easy to grab on touch.
  const brushHit = (clientX: number, clientY: number): boolean => {
    if (!brushEl || !brushCenter) return false
    return Math.abs(clientX - brushCenter.x) <= brushW * 0.5 + 18 && Math.abs(clientY - brushCenter.y) <= brushH * 0.5 + 18
  }

  // Size the floating brush to the active cell (cells are uniform), preserving its aspect ratio,
  // and cache the pixel size for moveBrush's tip math.
  const sizeBrush = (cell: CellState): void => {
    if (!brushEl) return
    const short = Math.min(cell.el.clientWidth, cell.el.clientHeight)
    const aspect = brushImg && brushImg.naturalWidth && brushImg.naturalHeight
      ? brushImg.naturalWidth / brushImg.naturalHeight
      : 1
    brushW = Math.max(8, short * brushScaleFrac)
    brushH = brushW / (aspect || 1)
    brushEl.style.width = brushW.toFixed(1) + 'px'
    brushEl.style.height = brushH.toFixed(1) + 'px'
  }

  // Draw the brush CENTERED on the finger (the finger "holds" the brush), so the authored tip can
  // sit somewhere else in the image and reveal there — not under the finger. Pure compositor
  // transform against the gesture-cached rect + size — no layout read per move.
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

  // Record the brush's card-fraction from its CURRENT position — ONLY from a real user drag (where
  // brushCardRect is a valid, freshly-measured card rect). Never called during relayout, so an
  // intermediate/degenerate card rect at orientation-flip time can't corrupt the stored fraction.
  const rememberBrushFrac = (): void => {
    if (!brushCenter || !brushCardRect || brushCardRect.width < 2 || brushCardRect.height < 2) return
    brushFracX = Math.max(0, Math.min(1, (brushCenter.x - brushCardRect.left) / brushCardRect.width))
    brushFracY = Math.max(0, Math.min(1, (brushCenter.y - brushCardRect.top) / brushCardRect.height))
  }

  // Re-place the brush at its stored card-fraction after a layout change (orientation flip, resize,
  // zoom). Keeps its position ABSOLUTE relative to the card. Skips degenerate rects (mid-transition)
  // and never rewrites the stored fraction, so flipping to landscape and back restores it exactly.
  const relayoutBrush = (): void => {
    if (!brushEl || !started || !cells[0]) return
    const card = ctx.root.getBoundingClientRect()
    if (card.width < 2 || card.height < 2) return // mid-transition — don't reposition on a bad rect
    brushRootRect = brushHostRect()
    brushCardRect = card
    sizeBrush(cells[0])
    moveBrush(card.left + brushFracX * card.width, card.top + brushFracY * card.height)
  }

  // Where the scratch actually happens (client coords): the brush's authored tip pixel, which is
  // offset from the finger by (tip − center) × brush size. No brush → the finger itself.
  const brushTip = (clientX: number, clientY: number): { x: number; y: number } => {
    if (!brushEl) return { x: clientX, y: clientY }
    return { x: clientX + (brushTipX - 0.5) * brushW, y: clientY + (brushTipY - 0.5) * brushH }
  }

  // The client-space point the brush rests at (its authored spawn, as a fraction of the card).
  const spawnClient = (): { x: number; y: number } => {
    const rect = ctx.root.getBoundingClientRect()
    return { x: rect.left + brushSpawnX * rect.width, y: rect.top + brushSpawnY * rect.height }
  }

  // Park the brush at its spawn spot and keep it visible. The brush is a persistent tool the player
  // drags, so it never disappears between strokes — only rests where it was left. Then plays the
  // optional intro demo.
  // Signal that the brush is done with its intro and is ready to be pointed at (handguide 'brush' mode
  // waits for this so the hint only appears AFTER the intro animation).
  const markBrushReady = (): void => { if (brushEl) brushEl.dataset.brushReady = '1' }

  const parkBrush = (): void => {
    if (!brushEl || !cells[0]) return
    brushRootRect = brushHostRect()
    brushCardRect = ctx.root.getBoundingClientRect()
    brushFracX = brushSpawnX // rest at the authored spawn (as a card fraction)
    brushFracY = brushSpawnY
    sizeBrush(cells[0])
    const s = spawnClient()
    moveBrush(s.x, s.y)
    if (brushFollow) {
      // Follow mode: hidden at rest. The authored intro demo still plays (visible),
      // then the brush fades away until the finger lands.
      if (brushIntro) {
        brushEl.style.opacity = '1'
        playBrushIntro()
      }
      if (!brushIntroAnim) {
        brushEl.style.opacity = '0'
        markBrushReady()
      }
      return
    }
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

  // Optional start animation: the brush traces the authored path (or a default rub) a few times
  // like the handguide's draw-path hint, then rests. Cancelled the moment the player interacts.
  // The path is a list of points as fractions 0..1 of the card; speed + loops are authored.
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
    brushIntroAnim.onfinish = (): void => {
      brushIntroAnim = null
      const p = spawnClient()
      moveBrush(p.x, p.y)
      if (brushFollow && brushEl) brushEl.style.opacity = '0' // follow mode: demo over — hide until the finger lands
      markBrushReady()
    }
  }

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
    emit('scratch-progress', p) // let scene elements fade in/out at progress thresholds
    for (const ra of revealAssetsState) {
      const shouldShow = p >= ra.showAt && p < ra.hideAt
      if (shouldShow !== ra.visible) {
        ra.visible = shouldShow
        ra.el.style.opacity = shouldShow ? '1' : '0'
      }
    }
  }

  // Draw an image into a canvas ctx with object-fit placement (contain/cover), centered.
  // Used for BOTH the cover canvas and the reveal-background canvas. Because they are the
  // SAME element type at the SAME backing size and use the SAME math, they land on the
  // EXACT same rect in every browser — including AppLovin's old WebView, which rounds a
  // <canvas> differently from an <img> (the source of the reveal "leak"). No stretch, no
  // crop beyond the chosen fit, and the cover keeps its own aspect/corners untouched.
  const drawImageFit = (g: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number): void => {
    const iw = img.naturalWidth || img.width
    const ih = img.naturalHeight || img.height
    if (!iw || !ih) return
    const s = imageFit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)
    const dw = iw * s
    const dh = ih * s
    g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
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
    // A decoded, usable image needs BOTH the ready flag AND real pixels — a load that failed
    // (Brave shield / webview that swallows onerror) can flip ready with naturalWidth still 0.
    if (img && ready && (img.naturalWidth || img.width)) {
      // In contain mode fill the letterbox with the cover color (if set) so it stays a
      // scratchable surface; a cleared color leaves it transparent (no box around the image).
      if (imageFit === 'contain' && coverColor) {
        c2d.fillStyle = coverColor
        c2d.fillRect(0, 0, w, h)
      }
      drawImageFit(c2d, img, w, h)
      return
    }
    // A cover image is CONFIGURED but not yet usable (still downloading on a cold/hard-refresh
    // load, or a load that never resolved in a shielded webview). Paint an OPAQUE fallback so
    // the cell is never left transparent during that window — otherwise the reveal shows through
    // immediately and the very first scratch measures ~100% cleared → instant win. This is the
    // Brave / AppLovin "cover doesn't appear" bug. On the real onload we repaint the image over it.
    if (img) {
      c2d.fillStyle = coverColor || COVER_LOAD_FALLBACK
      c2d.fillRect(0, 0, w, h)
      return
    }
    // Genuinely no cover image configured: a cleared cover color is an intentional transparent cell.
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

  // Snapshot the player's scratched-away holes as an OPAQUE mask so a backing-store
  // realloc (an AppLovin orientation flip resizes the cell, which resets the bitmap) can
  // re-punch them into the freshly repainted cover — preserving progress across rotation
  // instead of resetting it. The mask is opaque exactly where the cover has been cleared
  // (canvas alpha low) and transparent everywhere the cover still stands.
  const captureScratchMask = (cell: CellState): HTMLCanvasElement | null => {
    const { canvas } = cell
    if (canvas.width < 2 || canvas.height < 2) return null
    const m = document.createElement('canvas')
    m.width = canvas.width
    m.height = canvas.height
    const mc = m.getContext('2d')
    if (!mc) return null
    // Fill opaque, then subtract wherever the cover is still present (high alpha) →
    // opaque coverage remains ONLY over the cleared holes.
    mc.fillStyle = '#000'
    mc.fillRect(0, 0, m.width, m.height)
    mc.globalCompositeOperation = 'destination-out'
    mc.drawImage(canvas, 0, 0)
    return m
  }

  // Paint the reveal BACKGROUND onto its own canvas — same size + same fit math as the
  // cover, so the cover sits pixel-perfect over it (no leak). Runs in the editor too (the
  // reveal is visible there), independent of `started`.
  const fillCellReveal = (cell: CellState): void => {
    const g = cell.revealC2d
    const canvas = cell.revealCanvas
    if (!g || !canvas) return
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, canvas.width, canvas.height)
    if (cell.revealImg && cell.revealReady) drawImageFit(g, cell.revealImg, canvas.width, canvas.height)
  }

  // Wipe the reveal canvas to fully transparent. During PLAY the reveal starts empty and is
  // painted in ONLY where the player scratches (paintCellReveal), so unscratched areas —
  // crucially the rounded corners — never carry the reveal image and can't leak past the
  // cover. (In the editor the reveal is filled fully so the designer can see it.)
  const clearCellReveal = (cell: CellState): void => {
    const g = cell.revealC2d
    const canvas = cell.revealCanvas
    if (!g || !canvas) return
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, canvas.width, canvas.height)
  }

  // Reveal the prize image only within the current brush stroke. We first stamp the brush
  // (round-capped line + dot, matching the cover's erosion) to build up an opaque mask on
  // the reveal canvas, then redraw the image with 'source-in' so it survives only where that
  // accumulated mask is — i.e. exactly the scratched region. Everything else (corners
  // included) stays transparent, so there is nothing to leak.
  const paintCellReveal = (
    cell: CellState,
    x: number,
    y: number,
    r: number,
    from: { x: number; y: number } | null,
  ): void => {
    const g = cell.revealC2d
    const canvas = cell.revealCanvas
    if (!g || !canvas || !cell.revealImg || !cell.revealReady) return
    g.globalCompositeOperation = 'source-over'
    g.fillStyle = '#000'
    g.strokeStyle = '#000'
    if (from) {
      g.lineWidth = r * 2
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(from.x, from.y)
      g.lineTo(x, y)
      g.stroke()
    }
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.globalCompositeOperation = 'source-in'
    drawImageFit(g, cell.revealImg, canvas.width, canvas.height)
    g.globalCompositeOperation = 'source-over'
  }

  // Fraction of the reveal ZONE (within this cell) scratched clear, read from the analytic
  // coverGrid — NOT from the canvas. A getImageData readback is farbled/zeroed by Brave's shield
  // in a 3rd-party ad iframe (returns ~0 alpha → false ~100% cleared → instant win on first touch);
  // the grid is populated directly from the erode stroke geometry, so it's immune to that and reads
  // exactly 0 until the player actually scratches inside the zone. Cells outside the zone are ignored.
  const measure = (cell: CellState): number => {
    const S = COVERAGE_S
    const grid = cell.coverGrid
    const x0 = Math.max(0, Math.floor(zoneX * S))
    const y0 = Math.max(0, Math.floor(zoneY * S))
    const x1 = Math.min(S, Math.ceil((zoneX + zoneW) * S))
    const y1 = Math.min(S, Math.ceil((zoneY + zoneH) * S))
    let clear = 0
    let total = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        total++
        if (grid[y * S + x]) clear++
      }
    }
    return total > 0 ? clear / total : 0
  }

  // Deepest point of the still-COVERED (unscratched) area inside a cell's reveal zone.
  // Reads the same analytic coverGrid as measure(). A multi-source BFS treats every
  // scratched cell AND the zone border as distance 0, so the returned point is the one
  // furthest from anything already scratched — i.e. squarely in unscratched cover, never
  // on a scratched pixel like a centroid can be. `clearance` is that distance (in 0..1
  // cell units) so the caller can size the rub to stay inside the covered region.
  // Returns null if the whole zone is already clear.
  const unscratchedTarget = (
    cell: CellState,
  ): { x: number; y: number; clearance: number } | null => {
    const S = COVERAGE_S
    const grid = cell.coverGrid
    const x0 = Math.max(0, Math.floor(zoneX * S))
    const y0 = Math.max(0, Math.floor(zoneY * S))
    const x1 = Math.min(S, Math.ceil((zoneX + zoneW) * S))
    const y1 = Math.min(S, Math.ceil((zoneY + zoneH) * S))
    const w = x1 - x0
    const h = y1 - y0
    if (w <= 0 || h <= 0) return null
    // dist over the zone sub-grid: 0 = scratched (BFS source), -1 = unvisited cover.
    const dist = new Int16Array(w * h).fill(-1)
    let head = 0
    const qx: number[] = []
    const qy: number[] = []
    let coverCount = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const li = (y - y0) * w + (x - x0)
        if (grid[y * S + x]) {
          dist[li] = 0
          qx.push(x - x0); qy.push(y - y0)
        } else {
          coverCount++
        }
      }
    }
    if (coverCount === 0) return null
    // Border cells that touch the zone edge also seed the BFS, so the hand stays away
    // from the very edge (where the cover is thinnest) and aims at the interior.
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        if (dist[ly * w + lx] !== -1) continue
        if (lx === 0 || ly === 0 || lx === w - 1 || ly === h - 1) {
          dist[ly * w + lx] = 0
          qx.push(lx); qy.push(ly)
        }
      }
    }
    // 4-neighbour BFS → each cover cell gets its (approx) distance to the nearest source.
    let bestD = -1
    let bx = x0 + w / 2
    let by = y0 + h / 2
    while (head < qx.length) {
      const cx = qx[head]
      const cy = qy[head]
      head++
      const d = dist[cy * w + cx]
      if (d > bestD) { bestD = d; bx = x0 + cx; by = y0 + cy }
      const nb = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const ni = ny * w + nx
        if (dist[ni] !== -1) continue
        dist[ni] = d + 1
        qx.push(nx); qy.push(ny)
      }
    }
    return { x: (bx + 0.5) / S, y: (by + 0.5) / S, clearance: Math.max(0, bestD) / S }
  }

  // Keep the cell's data-hint-* rub path (read by the handguide's scratch animator in
  // stage.ts) aimed at what's still COVERED, and stamp data-scratch-cov so that animator
  // can pick the most-scratched (closest-to-winning) cell. Until the player has actually
  // scratched this cell we leave the AUTHORED path — that's the initial hand placement;
  // once scratching starts the path becomes dynamic and chases the remaining cover.
  const refreshHintPath = (cell: CellState, cov: number = measure(cell)): void => {
    cell.el.dataset.scratchCov = cov.toFixed(3)
    if (cov <= 0.05) {
      // Untouched (or fully re-covered) → keep pointing along the authored path.
      cell.el.dataset.hintFx = String(cell.hintFrom.x)
      cell.el.dataset.hintFy = String(cell.hintFrom.y)
      cell.el.dataset.hintTx = String(cell.hintTo.x)
      cell.el.dataset.hintTy = String(cell.hintTo.y)
      return
    }
    const target = unscratchedTarget(cell)
    if (!target) return
    // A short rub centered on the deepest covered point, kept within that covered pocket
    // (clearance) and the reveal zone, so the hand rubs over cover — never cleared area.
    const half = Math.max(0.03, Math.min(0.16, target.clearance * 0.8))
    const fx = Math.max(zoneX, Math.min(zoneX + zoneW, target.x - half))
    const tx = Math.max(zoneX, Math.min(zoneX + zoneW, target.x + half))
    const y = Math.max(zoneY, Math.min(zoneY + zoneH, target.y))
    cell.el.dataset.hintFx = fx.toFixed(4)
    cell.el.dataset.hintFy = y.toFixed(4)
    cell.el.dataset.hintTx = tx.toFixed(4)
    cell.el.dataset.hintTy = y.toFixed(4)
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
      if (cssW > 2 && cell.dateEl) {
        cell.dateEl.style.fontSize = Math.max(6, Math.round(Math.min(cssW, cssH) * dateSizeFrac)) + 'px'
      }
      // Only round the 4 outer corners of the grid; inner corners stay square
      const r = Math.round(Math.min(cssW, cssH) * cellRadiusFrac)
      const tl = row === 0 && col === 0 ? r : 0
      const tr = row === 0 && col === gridCols - 1 ? r : 0
      const br = row === gridRows - 1 && col === gridCols - 1 ? r : 0
      const bl = row === gridRows - 1 && col === 0 ? r : 0
      el.style.borderRadius = `${tl}px ${tr}px ${br}px ${bl}px`
      // Keep the canvas's CSS size pinned to the cell every pass (cheap) so it fills the
      // cell exactly even when only the CSS size shifts (e.g. a live browser-zoom resize).
      // width/height:100% (not a rounded px value) so the cover canvas and the reveal canvas
      // fill the identical cell box — AppLovin's WebView would otherwise render a rounded-px
      // box a hair off and leak a ~1px edge sliver.
      canvas.style.width = '100%'
      canvas.style.height = '100%'
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
      // Keep the reveal canvas backing in lockstep with the cover so their fit math matches
      // exactly. Resizing resets the bitmap, so repaint the reveal (in editor + play).
      if (cell.revealCanvas && (cell.revealCanvas.width !== w || cell.revealCanvas.height !== h)) {
        cell.revealCanvas.width = w
        cell.revealCanvas.height = h
        // Resizing resets the bitmap. In play the cover is also refilled fully (below), so keep
        // the reveal empty to match (scratch progress is already reset here); in the editor —
        // or a cell already won — show the full reveal.
        if (started && !won) clearCellReveal(cell)
        else fillCellReveal(cell)
      }
      if (w === canvas.width && h === canvas.height) continue
      // The realloc below resets the bitmap, which would wipe in-progress scratching on an
      // AppLovin rotation (the cell's device-pixel size changes → we land here). Snapshot
      // the cleared holes BEFORE the reset, then re-punch them into the repainted cover so
      // the player's progress survives the orientation flip instead of resetting.
      const scratchMask = !won && started ? captureScratchMask(cell) : null
      canvas.width = w
      canvas.height = h
      if (!won && started) {
        fillCellCover(cell)
        if (scratchMask) {
          cell.c2d.globalCompositeOperation = 'destination-out'
          cell.c2d.drawImage(scratchMask, 0, 0, w, h)
          cell.c2d.globalCompositeOperation = 'source-over'
        }
      }
    }
    relayoutBrush() // keep the brush pinned to its card-fraction across resize / orientation flips
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
      // 1px strip at the bar's top/left edges). style.transform reads back CSSOM-serialized
      // ("translateZ(0px)"), so the regex must accept the 0px form or it silently no-ops.
      const t = el.style.transform
      el.style.transform = t.replace(/\s*translateZ\(0(?:px)?\)/gi, '').trim() || 'none'
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

  // A scene handoff can leave the shared iOS audio element/loop registry in a
  // stale state (especially when the previous touch is cancelled by an overlay).
  // Reset the loop on the new user gesture so loopStart is always permitted to
  // claim and play it again.
  const startScratchSfx = (): void => {
    ctx.sfx.loopStop?.('drag')
    ctx.sfx.loopStart?.('drag')
  }

  const revealCell = (cell: CellState): void => {
    if (cell.won) return
    cell.won = true
    cell.el.dataset.won = '1'
    updateRevealAssets()
    lockAllCells() // stops loop + blocks all canvases immediately
    // Fill in the FULL reveal now (during play only the scratched strokes were painted) so the
    // whole prize is shown as the cover fades away.
    fillCellReveal(cell)
    cell.canvas.style.transition = 'opacity 400ms ease'
    requestAnimationFrame(() => { cell.canvas.style.opacity = '0' })

    if (cell.isWin) {
      fadeBrush() // prize revealed — fade the brush out
      winCb?.()
      if (cell.winSceneId) {
        // Record the chosen win scene, then finish through the ordinary scene-level
        // game-win flow so the current scene's authored Advance delay still applies.
        window.setTimeout(() => {
          emit('scene-goto-after-win', cell.winSceneId)
          completeCb?.()
        }, 350)
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
    // Offset between the brush center and the finger at grab time, so dragging moves the brush by
    // the finger delta (no jump-to-finger). Zero when there's no brush (scratch follows the finger).
    let grabDX = 0
    let grabDY = 0

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
      const r = Math.max(10, Math.min(canvas.width, canvas.height) * brushRadiusFrac)
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
      // Reveal the prize image only within this same brush stroke (see paintCellReveal).
      paintCellReveal(cell, x, y, r, lastPt)
      // Mirror the same erode geometry into the analytic coverage grid that measure() reads
      // (canvas → normalized grid coords). Stamp the round cap at both ends and step discs along
      // the segment so a fast swipe still fills the grid continuously, matching the visual stroke.
      const cw = Math.max(1, canvas.width)
      const ch = Math.max(1, canvas.height)
      const grx = (r / cw) * COVERAGE_S
      const gry = (r / ch) * COVERAGE_S
      const stamp = (px: number, py: number): void =>
        stampDisc(cell.coverGrid, (px / cw) * COVERAGE_S, (py / ch) * COVERAGE_S, grx, gry)
      if (lastPt) {
        const dist = Math.hypot(x - lastPt.x, y - lastPt.y)
        const steps = Math.max(1, Math.ceil(dist / Math.max(1, r * 0.5)))
        for (let i = 1; i < steps; i++) stamp(lastPt.x + (x - lastPt.x) * (i / steps), lastPt.y + (y - lastPt.y) * (i / steps))
        stamp(lastPt.x, lastPt.y)
      }
      stamp(x, y)
      lastPt = { x, y }
    }

    // Begin a stroke: require grabbing the brush (if any). Returns false if the press missed it, so
    // the caller can bail out and NOT scratch. Sets the grab offset + does the first erode.
    const beginStroke = (clientX: number, clientY: number): boolean => {
      if (brushEl && !brushFollow && !brushHit(clientX, clientY)) return false // must grab the brush, not tap anywhere
      brushIntroAnim?.cancel()
      brushIntroAnim = null
      markBrushReady() // player took over — the (possibly interrupted) intro is done
      // Follow mode: no grab offset — the brush centers on the finger and shows up now.
      grabDX = brushEl && !brushFollow && brushCenter ? brushCenter.x - clientX : 0
      grabDY = brushEl && !brushFollow && brushCenter ? brushCenter.y - clientY : 0
      if (brushEl) { brushRootRect = brushHostRect(); brushCardRect = ctx.root.getBoundingClientRect(); sizeBrush(cell) }
      if (brushEl && brushFollow) brushEl.style.opacity = '1'
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

    const onMove = (cx: number, cy: number): void => {
      if (cell.won || scratchingLocked) return
      const bx = cx + grabDX
      const by = cy + grabDY
      moveBrush(bx, by)
      rememberBrushFrac() // user dragged the brush → track its card-fraction
      const c = brushEl && brushCenter ? brushCenter : { x: bx, y: by } // clamped center
      const t = brushTip(c.x, c.y)
      const p = toCanvas(t.x, t.y)
      erodeAt(p.x, p.y)
      if ((moves++ & 7) === 0) {
        const cov = measure(cell)
        if (cov >= threshold) revealCell(cell)
        else refreshHintPath(cell, cov) // keep the hint hand chasing the remaining cover
      }
    }

    const onEnd = (): void => {
      ctx.sfx.loopStop?.('drag')
      lastPt = null
      // Grab mode: the brush stays on screen (persistent draggable tool). Follow
      // mode: it only exists under the finger, so it fades out on release.
      if (brushEl && brushFollow) brushEl.style.opacity = '0'
      if (!cell.won && measure(cell) >= threshold) revealCell(cell)
    }

    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (cell.won || scratchingLocked) return
        const t = e.changedTouches[0]
        lastPt = null
        if (!beginStroke(t.clientX, t.clientY)) return // press missed the brush — ignore
        touchActive = true
        startScratchSfx()
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
      lastPt = null
      if (brushEl && !brushFollow && !brushHit(e.clientX, e.clientY)) return // must grab the brush, not tap anywhere
      e.preventDefault()
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      startScratchSfx()
      beginStroke(e.clientX, e.clientY)
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
      zoneX = Math.max(0, Math.min(1, num(params.zoneX, 0) / 100))
      zoneY = Math.max(0, Math.min(1, num(params.zoneY, 0) / 100))
      zoneW = Math.max(0.02, Math.min(1 - zoneX, num(params.zoneW, 100) / 100))
      zoneH = Math.max(0.02, Math.min(1 - zoneY, num(params.zoneH, 100) / 100))
      imageFit = str(params.imageFit as unknown, 'cover') === 'contain' ? 'contain' : 'cover'
      cellRadiusFrac = Math.max(0, Math.min(50, num(params.cellRadius, 9))) / 100
      // Brush: tip position + erode radius + display size + spawn + intro (all authored).
      brushTipX = Math.max(0, Math.min(1, num(params.brushTipX as unknown, 50) / 100))
      brushTipY = Math.max(0, Math.min(1, num(params.brushTipY as unknown, 50) / 100))
      brushRadiusFrac = Math.max(1, Math.min(50, num(params.brushRadius as unknown, 10))) / 100
      brushScaleFrac = Math.max(5, Math.min(200, num(params.brushScale as unknown, 40))) / 100
      brushSpawnX = Math.max(0, Math.min(1, num(params.brushSpawnX as unknown, 50) / 100))
      brushSpawnY = Math.max(0, Math.min(1, num(params.brushSpawnY as unknown, 50) / 100))
      brushFollow = params.brushFollow === true || params.brushFollow === 'on' || params.brushFollow === 1
      brushIntro = params.brushIntro === true || params.brushIntro === 'on' || params.brushIntro === 1
      brushIntroDurationMs = Math.max(200, num(params.brushIntroDurationMs as unknown, 1600))
      brushIntroLoops = Math.max(1, Math.min(20, Math.round(num(params.brushIntroLoops as unknown, 2))))
      brushIntroPath = parseBrushPath(str(params.brushIntroPath as unknown, ''))
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

      // Dynamic date inside the reveal: a token format string ("MMMM D", "{date}", …)
      // rendered once from today + dateDays. Per-cell override → win/lose fallback;
      // empty everywhere = no date. Position/size are fractions of the CELL, so the
      // date scales exactly like the cell art at every viewport size and zoom.
      const winDateFmt = str(params.winDate as unknown, '')
      const loseDateFmt = str(params.loseDate as unknown, '')
      // Per-cell opt-out: cellNdateOff suppresses the date in that cell even when a
      // win/lose fallback format is set (lets the author choose WHICH cells show it).
      const cellDateOff = (i: number): boolean => {
        const v = params['cell' + i + 'dateOff']
        return v === true || v === 1 || v === '1' || v === 'on'
      }
      const cellDateFmt = (i: number): string =>
        cellDateOff(i) ? '' : str(params['cell' + i + 'date'] as unknown, '') || (isWinCell[i] ? winDateFmt : loseDateFmt)
      const dateDays = Math.max(0, num(params.dateDays as unknown, 0))
      dateSizeFrac = Math.max(2, Math.min(40, num(params.dateSize as unknown, 8))) / 100
      const dateX = Math.max(0, Math.min(100, num(params.dateX as unknown, 50)))
      const dateY = Math.max(0, Math.min(100, num(params.dateY as unknown, 50)))
      const dateColor = str(params.dateColor as unknown, '#ffffff')
      const dateWeight = Math.max(100, Math.min(900, num(params.dateWeight as unknown, 700)))
      const dateFont = str(params.dateFont as unknown, '')
      // Same case control the countdown element has — month names come out of Intl
      // title-cased, so UPPERCASE is the only mode that turns "Jul" into "JUL".
      // The param stores its display label (paramFields options are plain strings).
      const DATE_CASE: Record<string, 'none' | 'title' | 'upper' | 'lower'> = {
        UPPERCASE: 'upper',
        'Capitalize Each Word': 'title',
        lowercase: 'lower',
      }
      const dateCase = DATE_CASE[str(params.dateCase as unknown, '')] ?? 'none'

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
        coverImg.onerror = () => {
          // Fallback: mark cover as ready even if image load fails, so cells aren't transparent.
          // fillCellCover will fall back to coverColor; if that's also empty, shows 'SCRATCH' text.
          coverReady = true
          if (started) for (const cell of cells) if (!cell.won) fillCellCover(cell)
        }
        coverImg.src = coverSrc
        // Cached/decoded images may never fire onload — draw immediately if already ready.
        if (coverImg.complete && coverImg.naturalWidth) {
          coverReady = true
          if (started) for (const cell of cells) if (!cell.won) fillCellCover(cell)
        }
      }

      // Optional brush: a floating image (tip does the scratching) that follows the pointer while
      // dragging. z-index sits above EVERYTHING — reveal assets (400), the win/lose overlay (9000)
      // and the immune header/overlayTop tiers (10000/10050) — so the tool always reads as on top;
      // it never eats pointer events. Sizing/positioning is handled by parkBrush()/beginStroke().
      const brushSrc = ctx.assets.src(str(params.brushImage as unknown, ''))
      if (brushSrc) {
        brushImg = new Image()
        brushImg.onload = () => { /* aspect ratio now available for the next sizeBrush() */ }
        brushImg.src = brushSrc
        brushEl = document.createElement('img')
        brushEl.src = brushSrc
        brushEl.draggable = false
        brushEl.dataset.paBrush = '1' // marker so a handguide's 'point at brush' mode can find it
        brushEl.style.cssText =
          'position:absolute;left:0;top:0;pointer-events:none;opacity:0;z-index:100000;' +
          'will-change:transform;transition:opacity 120ms ease;-webkit-user-drag:none;user-select:none;'
        // Mount on the non-clipped stage container (like the win/lose overlay) so the brush can
        // overflow past the card edges instead of being cut off by ctx.root's overflow:hidden.
        const paRoot = ctx.root.closest?.('.pa-root') as HTMLElement | null
        brushHost = (paRoot ?? ctx.root).parentElement ?? ctx.root
        brushHost.appendChild(brushEl)
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
        let revealCanvas: HTMLCanvasElement | null = null
        let revealC2d: CanvasRenderingContext2D | null = null
        let revealImg: HTMLImageElement | null = null
        const imgSrc = cellImageSrc(i)
        if (imgSrc) {
          // Reveal background on a canvas (mirrors the cover canvas exactly) instead of an
          // <img>, so the cover lines up pixel-for-pixel and can't leak around the edges.
          revealCanvas = document.createElement('canvas')
          revealCanvas.draggable = false
          revealCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;'
          revealC2d = revealCanvas.getContext('2d')
          revealDiv.appendChild(revealCanvas)
          revealImg = new Image()
          revealImg.draggable = false
          // onload + src wired AFTER cellState exists (below), so the handler can reference it.
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
        // Dynamic date: DOM text under the cover canvas, revealed by scratching like
        // the text-image overlay. Rendered once (dates don't tick); font size is set
        // per-resize in sizeAll as a fraction of the cell's short side.
        let dateEl: HTMLDivElement | null = null
        const dateFmt = cellDateFmt(i)
        if (dateFmt) {
          dateEl = document.createElement('div')
          const now = Date.now()
          dateEl.textContent = renderCountdownFormat(braceBareTokens(dateFmt), now + dateDays * 86400000, now, { textCase: dateCase })
          dateEl.style.cssText =
            `position:absolute;left:${dateX}%;top:${dateY}%;transform:translate(-50%,-50%);` +
            'pointer-events:none;white-space:pre-line;text-align:center;line-height:1.15;user-select:none;-webkit-user-select:none;'
          dateEl.style.color = dateColor
          dateEl.style.fontWeight = String(dateWeight)
          if (dateFont) dateEl.style.fontFamily = cssFontFamily(dateFont)
          revealDiv.appendChild(dateEl)
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
          el: cellEl, canvas, c2d, labelEl, dateEl, won: false, isWin,
          row: Math.floor(i / cols), col: i % cols,
          coverGrid: new Uint8Array(COVERAGE_S * COVERAGE_S),
          cellCoverImg: null, cellCoverReady: false,
          revealCanvas, revealC2d, revealImg, revealReady: false,
          winSceneId: cellWinSceneId(i),
          winOverlayImage: cellWinOverlayImage(i),
          winOverlayDurationMs: cellWinOverlayDurationMs(i),
          ...hintPath,
        }
        if (revealImg && imgSrc) {
          const showReveal = (): void => {
            cellState.revealReady = true
            // Editor: show the full reveal. Play: keep it empty until scratched (a cell that
            // has already been won still fills, so its prize stays visible).
            if (!started || cellState.won) fillCellReveal(cellState)
          }
          revealImg.onload = showReveal
          revealImg.src = imgSrc
          // Cached/decoded images may never fire onload — draw immediately if already ready.
          if (revealImg.complete && revealImg.naturalWidth) showReveal()
        }
        const cellCoverSrc = ctx.assets.src(str(params['cell' + i + 'cover'] as unknown, ''))
        if (cellCoverSrc) {
          const img = new Image()
          img.onload = () => {
            cellState.cellCoverReady = true
            if (started && !cellState.won) fillCellCover(cellState)
          }
          img.onerror = () => {
            cellState.cellCoverReady = true
            if (started && !cellState.won) fillCellCover(cellState)
          }
          img.src = cellCoverSrc
          cellState.cellCoverImg = img
          // Cached/decoded images may never fire onload — draw immediately if already ready.
          if (img.complete && img.naturalWidth) {
            cellState.cellCoverReady = true
            if (started && !cellState.won) fillCellCover(cellState)
          }
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
        if (!cell.won) {
          fillCellCover(cell)
          // Start the reveal empty — it's now painted in only where the player scratches, so
          // the rounded corners stay transparent and the reveal can't leak past the cover.
          clearCellReveal(cell)
        }
      }
      for (const cell of cells) setupCell(cell)
      parkBrush() // show the brush at rest from the start — it's a persistent draggable tool
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
      // A grab-mode brush is itself the on-screen tool (point-at-brush is a handguide
      // mode); a follow-mode brush is invisible at rest, so the rub hint still helps.
      if (brushEl && !brushFollow) return null
      // Reappear in the cell the player has scratched the MOST (closest to winning),
      // not just the first unwon cell — so the hand nudges them to finish what they
      // already started. A fully-fresh grid (all coverage 0) falls back to the first
      // unwon cell, keeping the original left-to-right behaviour.
      const unwon = cells.filter((c) => !c.won)
      if (!unwon.length) return null
      let cell = unwon[0]
      let best = -1
      for (const c of unwon) {
        const cov = measure(c)
        if (cov > best) { best = cov; cell = c }
      }
      const r = cell.canvas.getBoundingClientRect()
      // Shrink the hint hand so it fits the cell (the hand is a fixed ~46×56px). Short,
      // wide cells in a 1-column / 4-row grid would otherwise get an oversized hand that
      // looks off-center; cap at 1 so normal cells keep the natural size.
      const fit = Math.max(0.45, Math.min(1, Math.min((r.height * 0.62) / 56, (r.width * 0.62) / 46)))
      // Default to this cell's configured start→end path (a centered horizontal rub).
      // Points are a 0..1 fraction of the cell.
      let fx = cell.hintFrom.x
      let fy = cell.hintFrom.y
      let tx = cell.hintTo.x
      let ty = cell.hintTo.y
      // Once the player has actually started scratching this cell, steer the rub onto
      // the part of the reveal zone that's still covered instead of the authored path.
      if (best > 0.05) {
        const target = unscratchedTarget(cell)
        if (target) {
          // Short horizontal rub centered on the unscratched mass, clamped to the zone.
          const half = Math.min(0.18, zoneW * 0.35)
          fx = Math.max(zoneX, Math.min(zoneX + zoneW, target.x - half))
          tx = Math.max(zoneX, Math.min(zoneX + zoneW, target.x + half))
          fy = ty = Math.max(zoneY, Math.min(zoneY + zoneH, target.y))
        }
      }
      return {
        from: { x: r.left + r.width * fx, y: r.top + r.height * fy },
        to: { x: r.left + r.width * tx, y: r.top + r.height * ty },
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
      brushIntroAnim?.cancel()
      brushIntroAnim = null
      brushEl?.remove() // mounted on the stage host, not ctx.root — remove it explicitly
      brushImg = null
      brushEl = null
      brushHost = null
      brushRootRect = null
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
    { key: 'winDate', label: 'Win cells dynamic date (tokens: dddd MMMM D Do YYYY; empty = off)', type: 'text' },
    { key: 'loseDate', label: 'Lose cells dynamic date', type: 'text' },
    { key: 'cell0date', label: 'Cell 1 date override', type: 'text' },
    { key: 'cell1date', label: 'Cell 2 date override', type: 'text' },
    { key: 'cell2date', label: 'Cell 3 date override', type: 'text' },
    { key: 'cell3date', label: 'Cell 4 date override', type: 'text' },
    { key: 'dateDays', label: 'Date offset (days from today)', type: 'number', min: 0, max: 60, step: 1 },
    { key: 'dateSize', label: 'Date size (% of cell)', type: 'number', min: 2, max: 40, step: 1 },
    { key: 'dateX', label: 'Date X (% of cell)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'dateY', label: 'Date Y (% of cell)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'dateColor', label: 'Date color', type: 'color' },
    { key: 'dateWeight', label: 'Date weight', type: 'number', min: 100, max: 900, step: 100 },
    { key: 'dateCase', label: 'Date case', type: 'select', options: ['As typed', 'UPPERCASE', 'Capitalize Each Word', 'lowercase'] },
    { key: 'dateFont', label: 'Date font (family or uploaded font id)', type: 'text' },
    { key: 'gap', label: 'Outer padding', type: 'number', min: 0, max: 60, step: 2 },
    { key: 'colGap', label: 'Column gap', type: 'number', min: 0, max: 60, step: 2 },
    { key: 'rowGap', label: 'Row gap', type: 'number', min: 0, max: 60, step: 2 },
    { key: 'cellRadius', label: 'Cell corner radius (% of cell, 0 = square)', type: 'number', min: 0, max: 50, step: 1 },
    { key: 'bgScale', label: 'BG image scale (%)', type: 'number', min: 10, max: 300, step: 5 },
    { key: 'bgX', label: 'BG image X (%)', type: 'number', min: 0, max: 100, step: 5 },
    { key: 'bgY', label: 'BG image Y (%)', type: 'number', min: 0, max: 100, step: 5 },
    { key: 'textScale', label: 'Text overlay scale (%, all cells)', type: 'number', min: 10, max: 100, step: 5 },
    { key: 'loseOverlayDurationMs', label: 'Lose overlay duration (ms)', type: 'number', min: 200, max: 5000, step: 100 },
    { key: 'winOverlayDurationMs', label: 'Win overlay duration (ms)', type: 'number', min: 200, max: 5000, step: 100 },
    { key: 'threshold', label: 'Reveal at (fraction scratched)', type: 'number', min: 0.2, max: 0.9, step: 0.05 },
    { key: 'brushRadius', label: 'Brush/scratch radius (% of cell)', type: 'number', min: 1, max: 50, step: 1 },
    { key: 'brushScale', label: 'Brush image size (% of cell)', type: 'number', min: 5, max: 200, step: 5 },
    { key: 'brushTipX', label: 'Brush tip X — reveal point (% of image, 50 = center)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'brushTipY', label: 'Brush tip Y — reveal point (% of image, 50 = center)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'zoneX', label: 'Reveal zone left (%, per cell)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'zoneY', label: 'Reveal zone top (%, per cell)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'zoneW', label: 'Reveal zone width (%, per cell)', type: 'number', min: 2, max: 100, step: 1 },
    { key: 'zoneH', label: 'Reveal zone height (%, per cell)', type: 'number', min: 2, max: 100, step: 1 },
    {
      key: 'revealAssets',
      label: 'Threshold assets (JSON list: src/showAt/hideAt/x/y/width/height)',
      type: 'text',
    },
  ],
  assetSlots: [
    { key: 'cover', label: 'Cover image (shared fallback)' },
    { key: 'brushImage', label: 'Brush image (drag to scratch; optional)' },
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
    cellRadius: 9,
    loseSceneId: '',
    winSceneId: '',
    loseOverlayImage: '',
    winOverlayImage: '',
    loseOverlayDurationMs: 1500,
    winOverlayDurationMs: 800,
    bgImage: '', bgScale: 100, bgX: 50, bgY: 50,
    threshold: 0.5,
    brushImage: '', brushRadius: 10, brushScale: 40, brushTipX: 50, brushTipY: 50,
    brushSpawnX: 50, brushSpawnY: 50, brushFollow: false, brushIntro: false, brushIntroPath: '', brushIntroDurationMs: 1600, brushIntroLoops: 2,
    zoneX: 0, zoneY: 0, zoneW: 100, zoneH: 100,
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
