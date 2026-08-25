// Background removal for an image asset — a magic-wand flood fill that runs entirely
// in the browser: no service, no API key, nothing uploaded. Playable art is usually a
// product shot or a logo on one flat colour, which is exactly the case a wand handles
// well; anything hairier is a job for the designer's own tool, and the editor stays
// out of the way by keeping the ORIGINAL asset (see AssetEntry.origin) so the cut is
// always reversible.
//
// `removeBackgroundPixels` is a pure pass over RGBA bytes so it can be unit-tested
// without a canvas; everything below it is the canvas glue the modal needs.

export interface RemoveBgPoint {
  /** 0-1 fraction of the image's width / height — resolution-independent, so the same
   * options drive the small live preview and the full-size apply. */
  x: number
  y: number
}

export interface RemoveBgOptions {
  /** How far a pixel's colour may sit from a seed and still count as background,
   * 0-100 (0 = only the exact colour; 100 = everything). Default 18. */
  tolerance?: number
  /** Width of the fade band just past `tolerance`, in the same 0-100 units. Pixels in
   * it fade out instead of being cut hard, which is what keeps the edge from looking
   * like pinking shears. Default 10. */
  softness?: number
  /** Radius, in px, of a blur over the finished alpha — smooths the stair-stepping a
   * per-pixel test leaves on a diagonal edge. 0 = off. Default 1. */
  featherPx?: number
  /** The pixels the author picked as background. Empty/absent = the four corners,
   * which is right for the overwhelming majority of product shots. */
  seeds?: RemoveBgPoint[]
  /** true (default) = cut only the region CONNECTED to a seed, so a white shirt keeps
   * its white. false = cut every pixel matching a seed colour anywhere in the image,
   * which is what a flat-colour logo sheet wants. */
  contiguous?: boolean
}

const MAX_DIST = Math.sqrt(3 * 255 * 255) // white → black, the largest RGB distance
const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)

const DEFAULT_SEEDS: RemoveBgPoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
]

/**
 * Knock the background out of RGBA pixel bytes IN PLACE, and report how many pixels
 * were made fully transparent (0 = nothing matched, which the UI reads as "your
 * tolerance is too low" rather than silently doing nothing).
 */
export function removeBackgroundPixels(data: Uint8ClampedArray, w: number, h: number, opts: RemoveBgOptions = {}): number {
  if (w <= 0 || h <= 0 || data.length < w * h * 4) return 0
  const tol = clamp(opts.tolerance ?? 18, 0, 100)
  const soft = clamp(opts.softness ?? 10, 0, 100)
  const contiguous = opts.contiguous !== false

  // Seeds → the palette of "this is background" colours. A seed on an already
  // transparent pixel carries no colour, so it is dropped rather than matching
  // whatever garbage RGB sits under the transparency.
  const seedPixels: number[] = []
  const colors: number[] = []
  for (const s of opts.seeds?.length ? opts.seeds : DEFAULT_SEEDS) {
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) continue
    const px = Math.round(clamp(s.x, 0, 1) * (w - 1))
    const py = Math.round(clamp(s.y, 0, 1) * (h - 1))
    const p = py * w + px
    seedPixels.push(p)
    if (data[p * 4 + 3] > 8) colors.push(data[p * 4], data[p * 4 + 1], data[p * 4 + 2])
  }
  if (!colors.length) return 0

  // 1 = keep this pixel untouched, 0 = cut it away, in between = the soft rim.
  const keepFactor = (p: number): number => {
    const i = p * 4
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    let best = Infinity
    for (let c = 0; c < colors.length; c += 3) {
      const dr = r - colors[c]
      const dg = g - colors[c + 1]
      const db = b - colors[c + 2]
      const d = ((dr * dr + dg * dg + db * db) ** 0.5 / MAX_DIST) * 100
      if (d < best) best = d
    }
    if (best <= tol) return 0
    if (soft <= 0 || best >= tol + soft) return 1
    return (best - tol) / soft
  }

  let removed = 0
  if (contiguous) {
    // Flood fill from the seeds. Only FULLY matching pixels are pushed back on the
    // stack: a soft-rim pixel is faded where it stands but never spreads, or a long
    // enough gradient would walk the fill straight through the subject.
    const seen = new Uint8Array(w * h)
    const stack: number[] = []
    for (const p of seedPixels) {
      if (seen[p] || keepFactor(p) !== 0) continue
      seen[p] = 1
      stack.push(p)
    }
    while (stack.length) {
      const p = stack.pop() as number
      if (data[p * 4 + 3] !== 0) removed++
      data[p * 4 + 3] = 0
      const x = p % w
      const y = (p - x) / w
      const around = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]
      for (const q of around) {
        if (q < 0 || seen[q]) continue
        const f = keepFactor(q)
        if (f === 0) {
          seen[q] = 1
          stack.push(q)
        } else if (f < 1) {
          seen[q] = 1
          data[q * 4 + 3] = Math.round(data[q * 4 + 3] * f)
        }
      }
    }
  } else {
    for (let p = 0; p < w * h; p++) {
      const f = keepFactor(p)
      if (f >= 1) continue
      if (f === 0 && data[p * 4 + 3] !== 0) removed++
      data[p * 4 + 3] = Math.round(data[p * 4 + 3] * f)
    }
  }

  const feather = Math.round(clamp(opts.featherPx ?? 1, 0, 8))
  if (feather >= 1) blurAlpha(data, w, h, feather)
  // Transparent pixels keep their old RGB, which is invisible on its own but bleeds
  // back as a halo the moment the export re-encodes to lossy WebP or the runtime
  // scales the image. Painting the cut side of the edge with the subject's colour
  // gives the resampler something harmless to blend with.
  bleedEdgeColor(data, w, h, Math.max(2, feather))
  return removed
}

/** Separable box blur over the alpha channel only (RGB is left alone). */
function blurAlpha(data: Uint8ClampedArray, w: number, h: number, r: number): void {
  const n = w * h
  const src = new Float32Array(n)
  const tmp = new Float32Array(n)
  for (let p = 0; p < n; p++) src[p] = data[p * 4 + 3]
  const win = r * 2 + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let k = -r; k <= r; k++) sum += src[row + clamp(x + k, 0, w - 1)]
      tmp[row + x] = sum / win
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0
      for (let k = -r; k <= r; k++) sum += tmp[clamp(y + k, 0, h - 1) * w + x]
      data[(y * w + x) * 4 + 3] = Math.round(sum / win)
    }
  }
}

/** Grow the surviving pixels' COLOUR (never their alpha) `steps` px into the cut. */
function bleedEdgeColor(data: Uint8ClampedArray, w: number, h: number, steps: number): void {
  const n = w * h
  const solid = new Uint8Array(n)
  for (let p = 0; p < n; p++) solid[p] = data[p * 4 + 3] > 0 ? 1 : 0
  for (let step = 0; step < steps; step++) {
    const snap = solid.slice()
    const filled: number[] = []
    for (let p = 0; p < n; p++) {
      if (snap[p]) continue
      const x = p % w
      const y = (p - x) / w
      let r = 0
      let g = 0
      let b = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w || (!dx && !dy)) continue
          const q = ny * w + nx
          if (!snap[q]) continue
          r += data[q * 4]
          g += data[q * 4 + 1]
          b += data[q * 4 + 2]
          count++
        }
      }
      if (!count) continue
      data[p * 4] = Math.round(r / count)
      data[p * 4 + 1] = Math.round(g / count)
      data[p * 4 + 2] = Math.round(b / count)
      filled.push(p)
    }
    if (!filled.length) return
    for (const p of filled) solid[p] = 1
  }
}

// ---- canvas glue (browser only) --------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image failed to load'))
    img.src = src
  })
}

/**
 * Decode an image to pixels, optionally shrunk so its longest side is `maxDim` —
 * the live preview re-runs the wand on every slider tick, and a 4000px hero would
 * turn that into a slideshow.
 */
export async function loadImagePixels(src: string, maxDim?: number): Promise<ImageData> {
  const img = await loadImage(src)
  const nw = img.naturalWidth || 1
  const nh = img.naturalHeight || 1
  const k = maxDim && Math.max(nw, nh) > maxDim ? maxDim / Math.max(nw, nh) : 1
  const w = Math.max(1, Math.round(nw * k))
  const h = Math.max(1, Math.round(nh * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/** PNG data-URL for pixels — PNG, not WebP, because the cut is worthless without
 * lossless alpha; the export's own optimiser re-encodes it later. */
export function pixelsToDataUrl(pixels: ImageData): string {
  const c = document.createElement('canvas')
  c.width = pixels.width
  c.height = pixels.height
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.putImageData(pixels, 0, 0)
  return c.toDataURL('image/png')
}

/** Run the wand over a copy of `pixels` and hand back the result (originals intact). */
export function removedBackgroundCopy(pixels: ImageData, opts: RemoveBgOptions): { pixels: ImageData; removed: number } {
  const copy = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)
  const removed = removeBackgroundPixels(copy.data, copy.width, copy.height, opts)
  return { pixels: copy, removed }
}

/** Decode → cut → re-encode, at the image's own resolution. Used by Apply. */
export async function removeBackgroundFromSrc(src: string, opts: RemoveBgOptions): Promise<{ src: string; w: number; h: number; removed: number }> {
  const pixels = await loadImagePixels(src)
  const removed = removeBackgroundPixels(pixels.data, pixels.width, pixels.height, opts)
  return { src: pixelsToDataUrl(pixels), w: pixels.width, h: pixels.height, removed }
}
