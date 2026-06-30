// Pure canvas geometry helpers (unit-tested in geometry.test.ts).

import type { SceneElement } from '../../runtime/scene'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Where the element's (x,y) anchor sits within its box: 0=start, .5=center, 1=end. */
export function anchorFactors(a: SceneElement['anchor']): { ax: number; ay: number } {
  return {
    ax: a.includes('left') ? 0 : a.includes('right') ? 1 : 0.5,
    ay: a.includes('top') ? 0 : a.includes('bottom') ? 1 : 0.5,
  }
}

/** Resize a box by dragging a handle (hx/hy ∈ -1|0|1). Moves only the grabbed
 * edge(s); the opposite edge stays fixed regardless of the element's anchor. The
 * returned (x,y) is the new anchor point so the element re-lays-out in place. */
export function resizeBox(
  start: { anchor: SceneElement['anchor']; x: number; y: number; w: number; h: number },
  hx: -1 | 0 | 1,
  hy: -1 | 0 | 1,
  dx: number,
  dy: number,
  min = 8,
): Box {
  const { ax, ay } = anchorFactors(start.anchor)
  const left0 = start.x - ax * start.w
  const top0 = start.y - ay * start.h
  const right = left0 + start.w
  const bottom = top0 + start.h
  let left = left0
  let top = top0
  let w = start.w
  let h = start.h
  if (hx > 0) w = Math.max(min, start.w + dx)
  else if (hx < 0) ((w = Math.max(min, start.w - dx)), (left = right - w))
  if (hy > 0) h = Math.max(min, start.h + dy)
  else if (hy < 0) ((h = Math.max(min, start.h - dy)), (top = bottom - h))
  return { x: Math.round(left + ax * w), y: Math.round(top + ay * h), w: Math.round(w), h: Math.round(h) }
}
