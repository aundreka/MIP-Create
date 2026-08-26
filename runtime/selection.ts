// Runtime selection store for tap-to-pick. Keyed by group (any free-form category
// name the author chooses — "model", "song", or anything), holding an ORDERED list
// of chosen asset ids so a group can hold as many picks as it has fill slots. A
// module singleton so picks persist across scenes.

const sel = new Map<string, string[]>()
// Anything that mirrors a group (the stage's fill slots) subscribes here, so a
// pick made away from a `pick` element — a carousel game settling on a choice —
// updates the same slots a tap would.
const subs = new Set<(group: string) => void>()

function notify(group: string): void {
  for (const cb of [...subs]) cb(group)
}

export function getPicks(group: string): string[] {
  return sel.get(group) ?? []
}
export function isPicked(group: string, id: string): boolean {
  return (sel.get(group) ?? []).includes(id)
}
/** Toggle a pick in a group. capacity caps how many a group holds (Infinity = no
 * cap); over capacity the oldest pick is dropped (so a 1-slot group behaves as a
 * radio, a 3-slot group holds 3). */
export function togglePick(group: string, id: string | undefined, capacity: number): void {
  if (!id) return
  const arr = (sel.get(group) ?? []).slice()
  const i = arr.indexOf(id)
  if (i >= 0) arr.splice(i, 1)
  else {
    arr.push(id)
    while (Number.isFinite(capacity) && capacity > 0 && arr.length > capacity) arr.shift()
  }
  sel.set(group, arr)
  notify(group)
}
/** Replace a group's picks outright. For sources that own the whole selection
 * rather than toggling one item at a time (a carousel's centre slot). */
export function setPicks(group: string, ids: string[]): void {
  if (!group) return
  sel.set(group, ids.filter(Boolean))
  notify(group)
}
/** Listen for changes to any group. Returns an unsubscribe. */
export function onPicksChanged(cb: (group: string) => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}
export function clearPicks(): void {
  sel.clear()
}
