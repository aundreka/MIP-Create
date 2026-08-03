// Active editing locale (editor-only, not part of the project/undo history). null
// means the base copy (each TextConfig.value). When a locale is active, the canvas
// previews that language and text edits write to TextConfig.i18n[locale]. Reactive
// via useSyncExternalStore so the canvas, inspector and topbar stay in sync.

import { useSyncExternalStore } from 'react'

let active: string | null = null
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

export function setEditLocale(code: string | null): void {
  active = code && code.trim() ? code : null
  emit()
}
export function getEditLocale(): string | null {
  return active
}
export function useEditLocale(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => active,
    () => active,
  )
}

export function subscribeEditLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
