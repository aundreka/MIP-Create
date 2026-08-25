// Runtime-internal types shared by the stage + element renderers.

import type { Scene } from './scene'

/** Per-asset video/audio compression knobs (ffmpeg, applied at export). Each is
 * optional — unset falls back to the export's global default. Mirrors the common
 * AppLovin recipe, e.g. { durationS:5, scale:454, crf:25, maxrate:'536k',
 * bufsize:'1000k', audioKbps:58 }. */
export interface CompressProfile {
  durationS?: number // trim to N seconds (0 / unset = keep full length)
  scale?: number // target MAX width in px (height keeps aspect); never upscales
  crf?: number // x264 constant rate factor 0–51 (lower = higher quality, bigger)
  maxrate?: string // peak bitrate cap, e.g. '536k' / '1.2M'
  bufsize?: string // rate-control buffer, e.g. '1000k'
  audioKbps?: number // audio bitrate in kbps, e.g. 58
}

/** One asset: its source (url / data-URI) and intrinsic design-space size. */
export interface AssetEntry {
  src: string
  w: number
  h: number
  /** 'video' for endscene clips, 'audio' for SFX/BGM, 'html' for an embedded
   * playable (iframe game), 'font' for a custom typeface; absent means a still image. */
  kind?: 'image' | 'video' | 'audio' | 'html' | 'font'
  /** Optional per-asset compression override (video/audio only). */
  compress?: CompressProfile
  /** The asset this one was derived from (background removal). Editor-only — the
   * runtime never reads it; it exists so "restore the original" stays one click
   * away instead of asking the author to re-upload the untouched art. */
  origin?: string
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
