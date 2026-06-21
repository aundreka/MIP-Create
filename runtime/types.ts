// Runtime-internal types shared by the stage + element renderers.

import type { Scene } from './scene'

/** One asset: its source (url / data-URI) and intrinsic design-space size. */
export interface AssetEntry {
  src: string
  w: number
  h: number
  /** 'video' for endscene clips, 'audio' for SFX/BGM, 'html' for an embedded
   * playable (iframe game); absent means a still image. */
  kind?: 'image' | 'video' | 'audio' | 'html'
}

export type AssetMap = Record<string, AssetEntry>

/** Context handed to element renderers. */
export interface RuntimeCtx {
  scene: Scene
  assets: AssetMap
  /** Resolve an asset id to its source url; '' if missing. */
  src(id?: string): string
  /** Resolve an asset id to its full entry (with intrinsic size). */
  asset(id?: string): AssetEntry | undefined
  /** Emit a runtime event (sfx hooks, cta-click, ...). */
  emit(event: string, ...args: unknown[]): void
}
