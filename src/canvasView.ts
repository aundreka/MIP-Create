// Which scenes are shown as frames on the multi-frame canvas. Editor view state,
// persisted per project to localStorage, reactive via useSyncExternalStore so the
// Scenes strip and the canvas stay in sync. The active scene is always rendered
// regardless (you can't hide the frame you're editing).

import { useSyncExternalStore } from 'react'
import { currentProjectId } from './projects'

const LS_KEY = 'pa:scene-hidden'
type HiddenMap = Record<string, string[]> // projectId -> hidden scene ids

function load(): HiddenMap {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const m = raw ? (JSON.parse(raw) as HiddenMap) : {}
    return m && typeof m === 'object' ? m : {}
  } catch {
    return {}
  }
}

const cache = load()
let version = 0
const listeners = new Set<() => void>()

function save(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache))
  } catch {
    /* ignore */
  }
}
function emit(): void {
  version++
  save()
  listeners.forEach((l) => l())
}
function key(): string {
  return currentProjectId() ?? '_'
}
function hiddenArr(): string[] {
  return cache[key()] ?? []
}

export function isSceneHidden(id: string): boolean {
  return hiddenArr().includes(id)
}
export function hiddenCount(): number {
  return hiddenArr().length
}
export function toggleSceneHidden(id: string): void {
  const set = new Set(hiddenArr())
  if (set.has(id)) set.delete(id)
  else set.add(id)
  cache[key()] = [...set]
  emit()
}
export function soloScene(id: string, allIds: string[]): void {
  cache[key()] = allIds.filter((x) => x !== id)
  emit()
}
export function showAllScenes(): void {
  cache[key()] = []
  emit()
}

export function useCanvasView(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
    () => version,
  )
}
