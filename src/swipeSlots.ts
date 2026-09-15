// Swipe cards slot assignment. Which elements are the cards, in what order, and which
// image shows the liked card is chosen from the GAME's panel, like the rest of this
// family, so one screen owns the whole wiring.
//
// The rules:
//
//   * CARDS are a list with an order. An element's `index` is its place in the pile;
//     removing one leaves a gap rather than renumbering, and the runtime plays them
//     sorted, so a gap costs nothing.
//   * the RESULT is one element per game and may live on ANY scene — it is normally on
//     the end card. Assigning a new one releases the old one wherever it is.
//   * an element holds at most one role across every game — they all want the pointer.

import type { SceneDef, SceneElement, SwipeRoleConfig } from '../runtime/scene'

/** One element patch the assignment needs. `swipeRole: undefined` releases it. */
export interface SwipeSlotEdit {
  id: string
  patch: Partial<SceneElement>
}

/** Every other game's role, cleared when an element joins this board. */
const OTHER_ROLES: Partial<SceneElement> = {
  comboRole: undefined,
  configRole: undefined,
  cleanRole: undefined,
  tapRole: undefined,
  revealRole: undefined,
  catchRole: undefined,
  basketItem: undefined,
  drag: undefined,
}

/** Put `nextId` in the card slot `current` holds (or a new one at `index`); '' releases. */
export function assignSwipeCard(args: { nextId: string; current: SceneElement | undefined; gameId: string; index: number }): SwipeSlotEdit[] {
  const { nextId, current, gameId, index } = args
  if (current?.id === nextId) return []
  const edits: SwipeSlotEdit[] = []
  if (current) edits.push({ id: current.id, patch: { swipeRole: undefined } })
  if (!nextId) return edits
  edits.push({ id: nextId, patch: { swipeRole: { gameId, role: 'card', index }, ...OTHER_ROLES } })
  return edits
}

/** The roles that are lists rather than a slot: the marks, and the Yes / No buttons. */
export type SwipeExtraRole = 'like' | 'nope' | 'yes' | 'no'

/** Put `nextId` in the mark or button slot `current` holds, or add it as one more of
 * `role`; '' releases `current`. Buttons stay visible — they are part of the screen. */
export function assignSwipeMark(args: { nextId: string; current: SceneElement | undefined; gameId: string; role: SwipeExtraRole }): SwipeSlotEdit[] {
  const { nextId, current, gameId, role } = args
  if (current?.id === nextId) return []
  const edits: SwipeSlotEdit[] = []
  if (current) edits.push({ id: current.id, patch: { swipeRole: undefined } })
  if (!nextId) return edits
  // Shown on the canvas from the start: a mark is placed by eye over a card, so it has to
  // be visible to be placed. The eye in the panel hides it again once it sits right.
  edits.push({ id: nextId, patch: { swipeRole: { gameId, role, showOnCanvas: role === 'like' || role === 'nope' ? true : undefined }, ...OTHER_ROLES } })
  return edits
}

/** Show or hide a mark on the editor canvas. Play always hides it, so this never leaks. */
export function setSwipeMarkCanvasVisible(el: SceneElement, visible: boolean): SwipeSlotEdit {
  return { id: el.id, patch: { swipeRole: { ...(el.swipeRole ?? { role: 'like' }), showOnCanvas: visible || undefined } } }
}

/** This game's marks or buttons of one kind, in scene order. */
export function swipeMarks(elements: SceneElement[], gameId: string, role: SwipeExtraRole): SceneElement[] {
  return elements.filter((e) => mine(e, gameId) && e.swipeRole?.role === role)
}

/** Make `nextId` this game's result, releasing any previous one on any scene. */
export function assignSwipeResult(scenes: SceneDef[], gameId: string, nextId: string): SwipeSlotEdit[] {
  const edits: SwipeSlotEdit[] = swipeResults(scenes, gameId)
    .filter((r) => r.el.id !== nextId)
    .map((r) => ({ id: r.el.id, patch: { swipeRole: undefined } }))
  if (nextId && !swipeResults(scenes, gameId).some((r) => r.el.id === nextId)) {
    edits.push({ id: nextId, patch: { swipeRole: { gameId, role: 'result' }, ...OTHER_ROLES } })
  }
  return edits
}

/** Move the card at list position `from` to `to` (both 0-based, in play order) and
 * renumber the pile 1..n — which also closes any gaps left by removed cards. */
export function moveSwipeCard(cards: SceneElement[], from: number, to: number): SwipeSlotEdit[] {
  if (from === to || !cards[from] || !cards[to]) return []
  const order = cards.slice()
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  return order.flatMap((e, i) => (e.swipeRole?.index === i + 1 ? [] : [{ id: e.id, patch: { swipeRole: { ...(e.swipeRole as SwipeRoleConfig), index: i + 1 } } }]))
}

const mine = (e: SceneElement, gameId: string): boolean => !!e.swipeRole && (!e.swipeRole.gameId || e.swipeRole.gameId === gameId)

/** This game's cards, in play order (ties in scene order, as the runtime plays them). */
export function swipeCards(elements: SceneElement[], gameId: string): SceneElement[] {
  return elements
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => mine(e, gameId) && e.swipeRole?.role === 'card')
    .sort((a, b) => (a.e.swipeRole?.index ?? 1) - (b.e.swipeRole?.index ?? 1) || a.i - b.i)
    .map(({ e }) => e)
}

/** The next free place at the bottom of the pile. */
export function nextSwipeIndex(elements: SceneElement[], gameId: string): number {
  return swipeCards(elements, gameId).reduce((n, e) => Math.max(n, e.swipeRole?.index ?? 1), 0) + 1
}

/** This game's result elements across every scene (normally one). */
export function swipeResults(scenes: SceneDef[], gameId: string): { scene: SceneDef; el: SceneElement }[] {
  return scenes.flatMap((scene) => scene.elements.filter((e) => mine(e, gameId) && e.swipeRole?.role === 'result').map((el) => ({ scene, el })))
}

/** Elements that can be a card: anything the player could see and grab. */
export function swipeCandidates(elements: SceneElement[]): SceneElement[] {
  return elements.filter((e) => e.type !== 'game-mount' && e.type !== 'background' && e.type !== 'handguide')
}

/** Elements that can show the liked card: images, since the card's picture is swapped in. */
export function swipeResultCandidates(scenes: SceneDef[]): { scene: SceneDef; el: SceneElement }[] {
  return scenes.flatMap((scene) => scene.elements.filter((e) => e.type === 'image').map((el) => ({ scene, el })))
}

/** How an element reads in the dropdowns — its name plus the job it already holds. */
export function swipeOptionLabel(el: SceneElement): string {
  const base = el.name || el.id
  const r = el.swipeRole
  if (r?.role === 'card') return `${base} — card ${r.index ?? 1}`
  if (r?.role === 'result') return `${base} — swipe result`
  if (r?.role === 'like') return `${base} — swipe-right mark`
  if (r?.role === 'nope') return `${base} — swipe-left mark`
  if (r?.role === 'yes') return `${base} — yes button`
  if (r?.role === 'no') return `${base} — no button`
  if (el.comboRole) return `${base} — in the combo board`
  if (el.revealRole) return `${base} — in the tap-to-reveal board`
  if (el.tapRole) return `${base} — in the tap-to-remove board`
  if (el.cleanRole) return `${base} — in the drag-to-clean board`
  if (el.catchRole) return `${base} — in the catch board`
  if (el.basketItem) return `${base} — a basket item`
  if (el.drag) return `${base} — draggable`
  return base
}

/** Plain-language name for the job an element holds, for its read-only status line. */
export function swipeSlotSummary(role: SwipeRoleConfig): string {
  if (role.role === 'result') return 'the image replaced by the first card swiped right on'
  if (role.role === 'like') return 'the mark shown on a card while it is dragged right'
  if (role.role === 'nope') return 'the mark shown on a card while it is dragged left'
  if (role.role === 'yes') return 'a button that swipes the top card right'
  if (role.role === 'no') return 'a button that swipes the top card left'
  return `card ${role.index ?? 1} of the pile`
}
