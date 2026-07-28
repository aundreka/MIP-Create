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

export type ParentToFrame =
  | { type: 'pa:render'; scene: Scene; assets?: AssetMap | null; interactive?: boolean; locale?: string | null } // single scene (editor canvas); assets omitted when unchanged
  | { type: 'pa:play'; project: Project; assets: AssetMap; locale?: string | null } // full flow (preview)
  | { type: 'pa:setHidden'; id: string; hidden: boolean }
  // Timeline panel → canvas frame. ms=null clears the preview (show everything);
  // playing=true runs the timeline for real from `ms`, false freezes that frame.
  | { type: 'pa:seek'; ms: number | null; playing?: boolean }

export type FrameToParent =
  | { type: 'pa:ready' }
  // mediaMs: the longest <video> in the scene, so the editor's timeline ruler can
  // span the footage instead of cutting it off at the default length. 0 = no video
  // (or its metadata hasn't loaded yet — a later pa:layout carries the real value).
  | { type: 'pa:layout'; metrics: FrameMetrics; rects: FrameRect[]; mediaMs?: number }
