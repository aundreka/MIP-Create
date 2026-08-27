// The progress channel — how a minigame tells a progress bar it has advanced.
//
// A progress bar is its own game mount, not a feature bolted onto one mechanic, so
// the two have to talk without importing each other. They do it the way the rest of
// this runtime already does cross-element wiring: through the DOM. A source
// dispatches a CustomEvent on the scene root, every bar in that root hears it, and
// the whole thing dies with the scene because the listeners live on a node the
// scene manager throws away.
//
// The default is DELIBERATELY unwired: a bar with no source named listens to every
// source, and a source with no bar named talks to every bar. The overwhelmingly
// common scene is one bar fed by one mechanic, and that should cost the author zero
// clicks. Naming a gameId at either end narrows it, for a board with two of either.
//
// `total` travels with every announcement rather than being configured on the bar,
// which is what lets a bar's step count default to "however many there are" — the
// source is the only side that knows how many obstacles the author actually placed.

/** One announcement: where this scene's play has got to, and how far there is to go. */
export interface ProgressDetail {
  /** Element id of the game mount that produced this. '' when the source has none. */
  gameId: string
  /** Steps completed so far. */
  value: number
  /** Steps there are in total, as the SOURCE counts them. 0 when it cannot say. */
  total: number
  /** Element id of the ONE bar this is addressed to. '' (the default) means every
   * bar in the scene. Filtering exists on both ends because either side may be the
   * one there are two of. */
  to?: string
}

/** `sourceGameId` for a bar that is deliberately fed by nothing at all. Not the empty
 * string, which means "no preference" and therefore takes every source going. */
export const PROGRESS_SOURCE_NONE = 'none'

const PROGRESS_EVENT = 'pa-progress'
const REQUEST_EVENT = 'pa-progress-request'

/** The node both ends meet on: the scene root, or the game's own slot if it is
 * somehow unparented (a unit test mounting a game in isolation). */
export function progressHost(root: HTMLElement): HTMLElement {
  return root.closest<HTMLElement>('.pa-root') ?? root
}

/** Announce where a source has got to. Cheap enough to call on every step. */
export function emitProgress(root: HTMLElement, detail: ProgressDetail): void {
  progressHost(root).dispatchEvent(new CustomEvent<ProgressDetail>(PROGRESS_EVENT, { detail }))
}

export function onProgress(root: HTMLElement, fn: (d: ProgressDetail) => void): () => void {
  const host = progressHost(root)
  const handler = (e: Event): void => fn((e as CustomEvent<ProgressDetail>).detail)
  host.addEventListener(PROGRESS_EVENT, handler)
  return () => host.removeEventListener(PROGRESS_EVENT, handler)
}

/**
 * Ask every source in the scene to say where it is.
 *
 * Mounting order is scene order, so a bar placed above its source in the layer stack
 * starts listening AFTER that source has already announced its opening total — and
 * would sit at "0 of 0" for the whole game. A bar therefore polls once on start()
 * instead of trusting that it was listening in time.
 */
export function requestProgress(root: HTMLElement): void {
  progressHost(root).dispatchEvent(new CustomEvent(REQUEST_EVENT))
}

/** Re-announce when a bar polls. Every source should wire this in start(). */
export function onProgressRequest(root: HTMLElement, fn: () => void): () => void {
  const host = progressHost(root)
  host.addEventListener(REQUEST_EVENT, fn)
  return () => host.removeEventListener(REQUEST_EVENT, fn)
}

/**
 * Whether a bar should accept an announcement.
 *
 * `want` is the source the bar is listening for and `from` is who sent it; `to` is
 * the bar the source addressed it to and `self` is who is asking. Either side may
 * narrow, and an empty string on either is "no preference" — which is the default at
 * both ends, so a scene with one bar and one mechanic needs no wiring at all.
 *
 * `want` of PROGRESS_SOURCE_NONE is the deliberate opposite of the empty default: a
 * bar that listens to NOTHING. Without it "unwired" and "wired to everything" are the
 * same state, so a second bar meant as decoration would silently couple itself to
 * whatever mechanic happened to be in the scene — and, being a game mount that can
 * win, could then end the scene on its own.
 */
export function progressMatches(want: string, from: string, to: string, self: string): boolean {
  if (want === PROGRESS_SOURCE_NONE) return false
  if (want && want !== from) return false
  if (to && to !== self) return false
  return true
}
