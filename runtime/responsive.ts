// Coordinate helpers — ported from coinsort/src/utils/responsive.ts.
//
// FIT elements live in a design space of DESIGN_W x DESIGN_H (default 1080x1920,
// the mockup composition) and are FIT (contain) into the viewport so content
// keeps identical proportions and stays fully visible at any size — centered
// horizontally, TOP-ANCHORED vertically (spare height goes to the bottom),
// never cropped.
//
// EXTEND elements (header/footer bars) do NOT fit-letterbox: they cover the full
// viewport width (see coverScale/centerX) so wide screens (landscape / iPad) are
// filled edge-to-edge instead of showing bars. Their vertical scale still tracks
// the FIT scale, so in portrait they match the mockup exactly — only width grows.
//
// Unlike coinsort (which works in device pixels for a canvas), the DOM runtime
// works in CSS pixels — the browser handles DPR, so no DPR math here.

let DESIGN_W = 1080
let DESIGN_H = 1920

let _s = 1
let _offX = 0
let _offY = 0
let _vw = DESIGN_W
let _vh = DESIGN_H

/** Set the design-space dimensions (from scene.meta.baseW/baseH). */
export function setDesign(w: number, h: number): void {
  DESIGN_W = Math.max(1, w)
  DESIGN_H = Math.max(1, h)
}

/** Recompute the design->screen transform for a viewport of vw x vh CSS px. */
export function computeMetrics(vw: number, vh: number): void {
  _vw = vw
  _vh = vh
  _s = Math.min(vw / DESIGN_W, vh / DESIGN_H)
  _offX = (vw - DESIGN_W * _s) / 2
  // TOP-ANCHORED vertically (offY = 0): the design is glued to the top of the
  // screen and any extra vertical space (viewport taller than the design aspect)
  // accumulates at the BOTTOM only. Vertical centering ((vh - DESIGN_H*s) / 2)
  // made the whole composition ride down on tall screens, which reads as
  // "everything moved" next to the header band that is anchored to the physical
  // top of the screen — headers, dates and content must hold a constant scaled
  // distance from the top at every viewport aspect.
  _offY = 0
}

// ---- FIT helpers: content (centered, letterboxed) -------------------------
export const sx = (x: number): number => _offX + x * _s
export const sy = (y: number): number => _offY + y * _s
export const sd = (d: number): number => d * _s

/** Inverse of sx/sy — convert a screen px back to design space (editor). */
export const inverseX = (px: number): number => (px - _offX) / _s
export const inverseY = (px: number): number => (px - _offY) / _s

export const scale = (): number => _s
export const viewW = (): number => _vw
export const viewH = (): number => _vh
export const designW = (): number => DESIGN_W
export const designH = (): number => DESIGN_H

/** Current transform snapshot — used by the editor for screen<->design mapping. */
export function metrics(): { s: number; offX: number; offY: number; vw: number; vh: number } {
  return { s: _s, offX: _offX, offY: _offY, vw: _vw, vh: _vh }
}

/** Whether the viewport is currently wider than tall (landscape). */
export const isLandscape = (): boolean => _vw > _vh

// ---- EXTEND helpers: bars / full-width layers (cover width, fit height) ----
/** Horizontal anchor for extend layers — always screen-center. */
export const centerX = (): number => _vw / 2

/**
 * Uniform draw scale for an extend layer of native width `nativeW`.
 * - Normally tracks the FIT vertical scale (`sd(designScale)`), so in portrait
 *   the layer matches the mockup exactly: same height, centered.
 * - Never smaller than `vw / nativeW`, guaranteeing the layer always reaches
 *   both viewport edges (no side gap) even at extreme-wide aspect ratios.
 */
export const coverScale = (nativeW: number, designScale: number): number =>
  Math.max(sd(designScale), _vw / nativeW)
