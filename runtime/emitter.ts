// Tiny pub/sub. Replaces Phaser's `scene.game.events` so networks.ts can be
// framework-agnostic. The runtime subscribes to 'ad-pause' / 'ad-resume' /
// 'ad-mute' / 'ad-volume' (and game/sfx events in later passes).

type Handler = (...args: any[]) => void

const map = new Map<string, Set<Handler>>()

export function on(event: string, fn: Handler): () => void {
  let set = map.get(event)
  if (!set) {
    set = new Set()
    map.set(event, set)
  }
  set.add(fn)
  return () => {
    set?.delete(fn)
  }
}

export function emit(event: string, ...args: any[]): void {
  const set = map.get(event)
  if (!set) return
  for (const fn of [...set]) {
    try {
      fn(...args)
    } catch (e) {
      console.warn('[emit]', event, e)
    }
  }
}
