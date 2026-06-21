// Transient editor mode for drawing a handguide's path on the canvas. The
// Inspector starts it (with the element id); the canvas consumes the next drag to
// set the element's start position and the path end, then ends the mode. Reactive
// via useSyncExternalStore so both stay in sync.

import { useSyncExternalStore } from 'react'

let target: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

export function startPathDraw(id: string): void {
  target = id
  emit()
}
export function endPathDraw(): void {
  target = null
  emit()
}
export function pathDrawTarget(): string | null {
  return target
}
export function usePathDraw(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => target,
    () => target,
  )
}
