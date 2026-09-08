// The name channel — how a typed-in name reaches every element that displays it,
// including the ones on LATER scenes.
//
// Two mechanics share it: the input box the player types into (nameinput.ts) and
// the read-only display of what they typed (nameresult.ts). They never import each
// other; they meet on a channel name, exactly the way a mechanic meets a progress
// bar in progresschannel.ts. The default channel is 'name', so the overwhelmingly
// common ad — one thing to type, shown in several places — costs the author zero
// wiring. A second channel ('pet2', 'city', …) is only needed when there are two
// separate things to type.
//
// Unlike the progress channel this does NOT live on the scene root: the whole point
// is that the value outlives the scene it was typed on. It lives in a module map, so
// a result mounted in the same tick reads it immediately and every later scene in the
// same play session sees it. Listeners hang off `document`, which every scene shares,
// and every subscriber unhooks in destroy().
//
// A module map and nothing else, deliberately: the name must NOT survive a reload.
// Storing it (sessionStorage) would mean a refresh — or a network replaying the
// creative in the same webview — opened the ad with the last player's dog's name
// already in the box, which reads as broken. A page load is a new player, so the map
// starts empty and the field shows its preview text again. Scene changes never reload
// the document, so cross-scene carry-over costs nothing to keep.

export interface NameDetail {
  /** Which channel changed. */
  channel: string
  /** The raw value as typed — display-casing is each reader's own business. */
  value: string
}

const EVENT = 'pa-name'

/** Values typed since this document loaded. Cleared by a reload, which is the point. */
const values = new Map<string, string>()

/** The node subscribers meet on: `document`, the one thing every scene root shares. */
function host(): EventTarget {
  return document
}

/** What has been typed on this channel, '' when nothing has. */
export function readName(channel: string): string {
  return values.get(channel || 'name') ?? ''
}

/** Publish a new value. Cheap enough to call on every keystroke — that is the point:
 * a result element updates as the player types, not when they finish. */
export function writeName(channel: string, value: string): void {
  const c = channel || 'name'
  if (values.get(c) === value) return
  values.set(c, value)
  host().dispatchEvent(new CustomEvent<NameDetail>(EVENT, { detail: { channel: c, value } }))
}

/** Listen for changes on one channel. Returns the unsubscribe. */
export function onNameChange(channel: string, fn: (value: string) => void): () => void {
  const c = channel || 'name'
  const handler = (e: Event): void => {
    const d = (e as CustomEvent<NameDetail>).detail
    if (d && d.channel === c) fn(d.value)
  }
  host().addEventListener(EVENT, handler)
  return () => host().removeEventListener(EVENT, handler)
}

/** Wipe every channel. A reload does this for free (the map is module state); this is
 * for tests and for a deliberate "play again" reset. Ordinary scene changes must NOT
 * call it, or the name would not carry over. */
export function resetNames(): void {
  values.clear()
}
