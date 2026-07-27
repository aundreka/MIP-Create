// Editor-only timeline transport: the playhead position for the active scene, and
// whether it is running. Kept OUT of the undo-tracked project state (like variantMode)
// — scrubbing is a view action, not a document edit.
//
// The timeline panel writes here; EditorCanvas subscribes and forwards the position
// to the active scene's iframe as a `pa:seek` message, which drives the runtime's
// element in/out windows (see TimingConfig in runtime/scene.ts).

import { useSyncExternalStore } from 'react'
import type { SceneDef, SceneElement } from '../runtime/scene'

export interface TimelineState {
  /** Panel open = the canvas previews the timeline. Closed = every element shown. */
  open: boolean
  ms: number
  playing: boolean
}

let state: TimelineState = { open: false, ms: 0, playing: false }
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

export function getTimeline(): TimelineState {
  return state
}
export function setTimeline(patch: Partial<TimelineState>): void {
  const next = { ...state, ...patch }
  if (next.open === state.open && next.ms === state.ms && next.playing === state.playing) return
  state = next
  emit()
}
export function useTimeline(): TimelineState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
    () => state,
  )
}

// ---- timeline geometry ------------------------------------------------------

/** Default length when a scene has no explicit ruler length and no clips yet. */
export const DEFAULT_TIMELINE_MS = 6000
/** Tail kept past the last clip so there is always somewhere to drag a clip out to. */
const TAIL_MS = 2000

/** End of an element's clip: in + duration, or `null` for an open clip (runs to the end). */
export function clipEnd(el: SceneElement): number | null {
  const t = el.timing
  if (!t) return null
  const d = t.durationMs
  return d != null && d > 0 ? Math.max(0, t.inMs || 0) + d : null
}

/**
 * Ruler length for a scene: the author's explicit `timelineMs` when set, otherwise
 * enough to hold every clip plus a tail. Never shorter than the default, so the ruler
 * doesn't jump around while the first clip is being dragged.
 */
export function timelineLength(sd: SceneDef | undefined): number {
  if (!sd) return DEFAULT_TIMELINE_MS
  if (sd.timelineMs && sd.timelineMs > 0) return sd.timelineMs
  let last = 0
  for (const el of sd.elements) {
    const end = clipEnd(el)
    if (end != null) last = Math.max(last, end)
    else if (el.timing) last = Math.max(last, el.timing.inMs || 0)
  }
  return Math.max(DEFAULT_TIMELINE_MS, Math.ceil((last + TAIL_MS) / 500) * 500)
}
