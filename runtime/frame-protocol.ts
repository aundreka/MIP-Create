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
  | { type: 'pa:render'; scene: Scene; assets: AssetMap; interactive?: boolean; locale?: string | null } // single scene (editor canvas)
  | { type: 'pa:play'; project: Project; assets: AssetMap; locale?: string | null } // full flow (preview)
  | { type: 'pa:setHidden'; id: string; hidden: boolean }

export type FrameToParent =
  | { type: 'pa:ready' }
  | { type: 'pa:layout'; metrics: FrameMetrics; rects: FrameRect[] }
