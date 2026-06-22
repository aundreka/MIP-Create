// Active editing variant (editor-only, not part of undo history). null = the base
// MIP. When a variant is active, the canvas shows base + that variant's overrides,
// and element edits are recorded as the variant's patches (see store.patchElement).
// Reactive via useSyncExternalStore.

import { useSyncExternalStore } from 'react'

let active: string | null = null
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

export function getActiveVariant(): string | null {
  return active
}
export function setActiveVariant(id: string | null): void {
  active = id
  emit()
}
export function useActiveVariant(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => active,
    () => active,
  )
}
