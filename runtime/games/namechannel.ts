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
// is that the value outlives the scene it was typed on. It lives in a module map
// (so a result mounted in the same tick reads it immediately) mirrored into
// sessionStorage (so it also survives a scene rebuild, a locale switch, an orientation
// flip, and an MRAID resume that reloads the document). Listeners hang off `document`,
// which every scene shares, and every subscriber unhooks in destroy().

export interface NameDetail {
  /** Which channel changed. */
  channel: string
  /** The raw value as typed — display-casing is each reader's own business. */
  value: string
}

const EVENT = 'pa-name'
const PREFIX = 'pa:name:'

/** Values seen this session. The map is authoritative; storage is its backup. */
const values = new Map<string, string>()

/** Storage is unavailable in some webviews (private mode, blocked cookies) and
 * absent in unit tests — every touch is guarded and a failure just means the value
 * doesn't survive a reload, which is not worth breaking typing over. */
function readStored(channel: string): string {
  try {
    return window.sessionStorage.getItem(PREFIX + channel) ?? ''
  } catch {
    return ''
  }
}

function writeStored(channel: string, value: string): void {
  try {
    if (value) window.sessionStorage.setItem(PREFIX + channel, value)
    else window.sessionStorage.removeItem(PREFIX + channel)
  } catch {
    /* storage unavailable — the in-memory value still drives this session */
  }
}

/** The node subscribers meet on: `document`, the one thing every scene root shares. */
function host(): EventTarget {
  return document
}

/** What has been typed on this channel, '' when nothing has. */
export function readName(channel: string): string {
  const c = channel || 'name'
  const mem = values.get(c)
  if (mem != null) return mem
  const stored = readStored(c)
  values.set(c, stored)
  return stored
}

/** Publish a new value. Cheap enough to call on every keystroke — that is the point:
 * a result element updates as the player types, not when they finish. */
export function writeName(channel: string, value: string): void {
  const c = channel || 'name'
  if (values.get(c) === value) return
  values.set(c, value)
  writeStored(c, value)
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

/** Wipe every channel. Only used by tests and by a deliberate "play again" reset —
 * ordinary scene changes must NOT call this, or the name would not carry over. */
export function resetNames(): void {
  for (const c of values.keys()) writeStored(c, '')
  values.clear()
}
