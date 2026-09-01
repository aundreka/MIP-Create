// Message protocol between the editor (parent) and the embedded runtime
// (inside an <iframe> running frame.ts). Shared by both sides.

import type { Project, Scene } from './scene'
import type { AssetMap } from './types'

export interface FrameRect {
  id: string
  type: string
  x: number // px, relative to the iframe viewport (== the editor overlay)
  y: number
  w: number
  h: number
}

export interface FrameMetrics {
  s: number
  offX: number
  offY: number
  vw: number
  vh: number
}

// `previewNow` is the editor's preview date (ms epoch, local noon of the chosen
// day) — it makes the runtime RENDER dates as if it were that day so a designer can see
// both states of a dynamic holiday. null/omitted = the real clock. Never sent by export.
export type ParentToFrame =
  | { type: 'pa:render'; scene: Scene; assets?: AssetMap | null; interactive?: boolean; locale?: string | null; previewNow?: number | null } // single scene (editor canvas); assets omitted when unchanged
  | { type: 'pa:play'; project: Project; assets: AssetMap; locale?: string | null; previewNow?: number | null } // full flow (preview)
  | { type: 'pa:setHidden'; id: string; hidden: boolean }
  // Timeline panel → canvas frame. ms=null clears the preview (show everything);
  // playing=true runs the timeline for real from `ms`, false freezes that frame.
  | { type: 'pa:seek'; ms: number | null; playing?: boolean }

export type FrameToParent =
  | { type: 'pa:ready' }
  // mediaMs: the longest <video> in the scene, so the editor's timeline ruler can
  // span the footage instead of cutting it off at the default length. 0 = no video
  // (or its metadata hasn't loaded yet — a later pa:layout carries the real value).
  // header: the pinned band's rect on the CANVAS (id '__header'), when this scene shows
  // one. Kept out of `rects` so element selection/marquee logic never sees a non-element.
  | { type: 'pa:layout'; metrics: FrameMetrics; rects: FrameRect[]; mediaMs?: number; header?: FrameRect }
