// Pixel-level image comparison for the QA checker. Pure functions over raw RGBA
// buffers (structural Bitmap, not DOM ImageData) so the whole pipeline is
// unit-testable in node. Perceptual distance is the YIQ metric from pixelmatch
// (brightness-weighted, so anti-aliasing and subtle gradients don't scream),
// and differing pixels are clustered into labelled regions ("point out where")
// via a coarse cell grid + flood fill.

export interface Bitmap {
  data: Uint8ClampedArray // RGBA
  width: number
  height: number
}

export interface DiffRegion {
  x: number
  y: number
  w: number
  h: number
  pixels: number // differing pixels inside the box
}

export interface DiffResult {
  mask: Bitmap // magenta where different, transparent elsewhere (overlay-ready)
  regions: DiffRegion[] // merged boxes, largest first
  diffPixels: number
  totalPixels: number // compared pixels (ignored ones excluded)
  ignoredPixels: number // masked out (e.g. animated zones like a pulsing CTA)
  pct: number // 0..100, over compared pixels only
}

// ---- color -------------------------------------------------------------------

/** Perceptual distance between two RGBA pixels, 0 (same) .. 1 (max). Alpha is
 * composited on white first so transparent-vs-white doesn't count as a diff. */
export function colorDelta(r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): number {
  if (a1 < 255) {
    const k = a1 / 255
    r1 = 255 + (r1 - 255) * k
    g1 = 255 + (g1 - 255) * k
    b1 = 255 + (b1 - 255) * k
  }
  if (a2 < 255) {
    const k = a2 / 255
    r2 = 255 + (r2 - 255) * k
    g2 = 255 + (g2 - 255) * k
    b2 = 255 + (b2 - 255) * k
  }
  const y = (r1 - r2) * 0.29889531 + (g1 - g2) * 0.58662247 + (b1 - b2) * 0.11448223
  const i = (r1 - r2) * 0.59597799 - (g1 - g2) * 0.2741761 - (b1 - b2) * 0.32180189
  const q = (r1 - r2) * 0.21147017 - (g1 - g2) * 0.52261711 + (b1 - b2) * 0.31114694
  // 35215 = max possible weighted distance (black vs white)
  return (0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q) / 35215
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, '0')
  return '#' + h(r) + h(g) + h(b)
}

/** Sample one pixel of a bitmap; returns null outside bounds. */
export function samplePixel(bmp: Bitmap, x: number, y: number): { r: number; g: number; b: number; a: number; hex: string } | null {
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= bmp.width || py >= bmp.height) return null
  const o = (py * bmp.width + px) * 4
  const d = bmp.data
  return { r: d[o], g: d[o + 1], b: d[o + 2], a: d[o + 3], hex: rgbToHex(d[o], d[o + 1], d[o + 2]) }
}

// ---- diff --------------------------------------------------------------------

const CELL = 8 // clustering granularity (compare-space px)

/** Flood-fill marked cells (8-neighbour) into bounding-box regions. */
function clusterCells(cellCount: Uint32Array, cellsW: number, cellsH: number, w: number, h: number, minRegionPixels: number): DiffRegion[] {
  const seen = new Uint8Array(cellsW * cellsH)
  const regions: DiffRegion[] = []
  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      const start = cy * cellsW + cx
      if (!cellCount[start] || seen[start]) continue
      let minX = cx, maxX = cx, minY = cy, maxY = cy, pixels = 0
      const stack = [start]
      seen[start] = 1
      while (stack.length) {
        const c = stack.pop() as number
        const x = c % cellsW
        const y = Math.floor(c / cellsW)
        pixels += cellCount[c]
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= cellsW || ny >= cellsH) continue
            const n = ny * cellsW + nx
            if (cellCount[n] && !seen[n]) {
              seen[n] = 1
              stack.push(n)
            }
          }
        }
      }
      if (pixels < minRegionPixels) continue
      regions.push({ x: minX * CELL, y: minY * CELL, w: Math.min(w, (maxX + 1) * CELL) - minX * CELL, h: Math.min(h, (maxY + 1) * CELL) - minY * CELL, pixels })
    }
  }
  return regions.sort((r1, r2) => r2.pixels - r1.pixels)
}

/** Compare two same-sized bitmaps. `threshold` is the perceptual delta above
 * which a pixel counts as different (0.05 strict … 0.3 loose); `minRegionPixels`
 * drops speckle regions (anti-aliasing noise) from the report. Pixels set in
 * `ignore` (w*h bytes, e.g. the motionMask of a pulsing CTA) are excluded from
 * both the diff and the accuracy denominator. */
export function diffImages(a: Bitmap, b: Bitmap, threshold = 0.12, minRegionPixels = 24, ignore?: Uint8Array): DiffResult {
  const w = Math.min(a.width, b.width)
  const h = Math.min(a.height, b.height)
  const mask = new Uint8ClampedArray(w * h * 4)
  const cellsW = Math.ceil(w / CELL)
  const cellsH = Math.ceil(h / CELL)
  const cellCount = new Uint32Array(cellsW * cellsH)
  const useIgnore = ignore && ignore.length === w * h ? ignore : null
  let diffPixels = 0
  let ignoredPixels = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (useIgnore && useIgnore[y * w + x]) {
        ignoredPixels++
        continue
      }
      const oa = (y * a.width + x) * 4
      const ob = (y * b.width + x) * 4
      const delta = colorDelta(a.data[oa], a.data[oa + 1], a.data[oa + 2], a.data[oa + 3], b.data[ob], b.data[ob + 1], b.data[ob + 2], b.data[ob + 3])
      if (delta > threshold) {
        diffPixels++
        cellCount[Math.floor(y / CELL) * cellsW + Math.floor(x / CELL)]++
        const om = (y * w + x) * 4
        mask[om] = 255
        mask[om + 1] = 0
        mask[om + 2] = 128
        mask[om + 3] = 200
      }
    }
  }

  const totalPixels = w * h - ignoredPixels
  return {
    mask: { data: mask, width: w, height: h },
    regions: clusterCells(cellCount, cellsW, cellsH, w, h, minRegionPixels).slice(0, 50),
    diffPixels,
    totalPixels,
    ignoredPixels,
    pct: totalPixels ? (diffPixels / totalPixels) * 100 : 0,
  }
}

/** Detect what MOVES between two frames of the SAME source (captured a beat
 * apart): pulsing CTAs, timers, particles. Returns a per-pixel ignore mask for
 * diffImages plus regions to show as "animated — ignored" indicators. The mask
 * is dilated by `dilateCells` grid cells so the full sweep of a pulse (its
 * largest scale) is covered, not just the rim that happened to move. */
export function motionMask(a: Bitmap, b: Bitmap, threshold = 0.05, dilateCells = 1): { mask: Uint8Array; regions: DiffRegion[]; pixels: number } {
  const w = Math.min(a.width, b.width)
  const h = Math.min(a.height, b.height)
  const cellsW = Math.ceil(w / CELL)
  const cellsH = Math.ceil(h / CELL)
  const hot = new Uint8Array(cellsW * cellsH)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const oa = (y * a.width + x) * 4
      const ob = (y * b.width + x) * 4
      if (colorDelta(a.data[oa], a.data[oa + 1], a.data[oa + 2], a.data[oa + 3], b.data[ob], b.data[ob + 1], b.data[ob + 2], b.data[ob + 3]) > threshold) {
        hot[Math.floor(y / CELL) * cellsW + Math.floor(x / CELL)] = 1
      }
    }
  }

  // Dilate hot cells so the animation's full excursion is inside the zone.
  const dilated = new Uint8Array(cellsW * cellsH)
  const cellCount = new Uint32Array(cellsW * cellsH)
  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      if (!hot[cy * cellsW + cx]) continue
      for (let dy = -dilateCells; dy <= dilateCells; dy++) {
        for (let dx = -dilateCells; dx <= dilateCells; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx >= 0 && ny >= 0 && nx < cellsW && ny < cellsH) dilated[ny * cellsW + nx] = 1
        }
      }
    }
  }

  const mask = new Uint8Array(w * h)
  let pixels = 0
  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      const c = cy * cellsW + cx
      if (!dilated[c]) continue
      const x1 = Math.min(w, (cx + 1) * CELL)
      const y1 = Math.min(h, (cy + 1) * CELL)
      let n = 0
      for (let y = cy * CELL; y < y1; y++) for (let x = cx * CELL; x < x1; x++, n++) mask[y * w + x] = 1
      cellCount[c] = n
      pixels += n
    }
  }

  return { mask, regions: clusterCells(cellCount, cellsW, cellsH, w, h, CELL * CELL), pixels }
}
