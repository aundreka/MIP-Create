// The swipe result channel — how the card a player swiped right on reaches the
// element that shows it, including one on a LATER scene.
//
// The same shape as the name channel (namechannel.ts), for the same reason: the whole
// point is that the value outlives the scene it was chosen on. A Swipe cards game on
// scene 2 decides which card won; the end card on scene 3 is where it is shown. They
// never import each other — the game writes here, and stage.ts points every element
// tagged as a swipe RESULT at the value, both when it is built and live afterwards.
//
// Keyed by the game mount's element id, with '' holding whatever was written last by
// any game, so a result tagged with no game named (or naming a game on a scene that
// no longer exists) still shows the one pick an ordinary ad has.
//
// A module map and nothing else, deliberately: a reload is a new player, and the end
// card must not open showing the last player's favourite look.

export type SwipeResultFit = 'contain' | 'cover' | 'fill'

export interface SwipeResult {
  /** The liked card's image source. '' = nothing liked (yet), show the placeholder. */
  src: string
  /** How the card's picture sits in the result's box, which may be a different shape. */
  fit: SwipeResultFit
}

interface SwipeResultDetail extends SwipeResult {
  gameId: string
}

const EVENT = 'pa-swipe-result'
const EMPTY: SwipeResult = { src: '', fit: 'contain' }

const values = new Map<string, SwipeResult>()

/** What the named game picked, or the latest pick of any game when `gameId` is ''. */
export function readSwipeResult(gameId: string): SwipeResult {
  return values.get(gameId || '') ?? values.get('') ?? EMPTY
}

/** Publish a pick. A `src` of '' clears it — a game that restarts puts results back to
 * their placeholders. */
export function writeSwipeResult(gameId: string, result: SwipeResult): void {
  values.set(gameId, result)
  values.set('', result)
  document.dispatchEvent(new CustomEvent<SwipeResultDetail>(EVENT, { detail: { gameId, ...result } }))
}

/** Listen for picks addressed to one game ('' = any game). Returns the unsubscribe. */
export function onSwipeResult(gameId: string, fn: (result: SwipeResult) => void): () => void {
  const handler = (e: Event): void => {
    const d = (e as CustomEvent<SwipeResultDetail>).detail
    if (d && (!gameId || d.gameId === gameId)) fn({ src: d.src, fit: d.fit })
  }
  document.addEventListener(EVENT, handler)
  return () => document.removeEventListener(EVENT, handler)
}

/** Wipe every pick. For tests and a deliberate "play again"; scene changes must NOT. */
export function resetSwipeResults(): void {
  values.clear()
}
