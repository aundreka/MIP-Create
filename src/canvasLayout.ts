// Per-scene frame positions on the multi-frame canvas (Figma-style). Editor
// layout only — persisted to localStorage, keyed by project + scene, kept out of
// the project/undo store. Scenes without a stored position fall back to an
// auto-row layout computed in EditorCanvas.

import { currentProjectId } from './projects'

const LS_KEY = 'pa:framepos'

export interface FramePos {
  x: number
  y: number
}

type PosMap = Record<string, FramePos>

function load(): PosMap {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw) as PosMap
  } catch {
    /* ignore */
  }
  return {}
}

const cache = load()

function save(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache))
  } catch {
    /* ignore */
  }
}

function key(sceneId: string): string {
  return (currentProjectId() ?? '_') + ':' + sceneId
}

export function getFramePos(sceneId: string): FramePos | null {
  return cache[key(sceneId)] ?? null
}

export function setFramePos(sceneId: string, pos: FramePos): void {
  cache[key(sceneId)] = pos
  save()
}
