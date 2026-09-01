// Catch slot assignment. Which element is a falling item and which is the check mark is
// chosen from the GAME's panel, not from each element's own — the same arrangement combo
// builder, tap-to-remove and tap-to-reveal use, and for the same reason: the roles only
// mean something relative to each other.
//
// The rules:
//
//   * ITEMS are a LIST — any number, assigned one at a time, and the panel passes the one
//     being changed as `current` rather than the group. An item plays two parts at once:
//     its art is what falls, and it is that item's tick-list entry, sitting at whatever
//     opacity the author gave it until one of its copies is caught.
//   * the BOX is a single slot too, and assigning one replaces the game's own basket
//     rig: where it was dropped on the canvas is where it stays, the height it sits at
//     IS the catch line, and it only ever moves sideways. Its FRONT is an optional second
//     slot — art that travels with the box and paints over the falling items, so a catch
//     lands behind it and reads as going INTO the box.
//   * the CHECK MARK is a single slot for the whole game. It is copied onto each item as
//     that item is caught, so a five-item board needs one assignment rather than five.
//   * an element holds at most one role: naming an item as the check mark MOVES it.
//   * the drag models (catch item / tap role / clean role / combo role / basket item /
//     plain draggable) are exclusive — they all want the same pointer, or the same art.
//
// Removing an item from the middle of the list would renumber the ones after it — and
// the caught-item layout lists (position, angle, scale in the basket) are addressed by
// that number — so `releaseItem` renumbers the whole tail together.

import type { CatchRoleConfig, SceneElement } from '../runtime/scene'

/** One element patch the assignment needs. `catchRole: undefined` releases the element. */
export interface CatchSlotEdit {
  id: string
  patch: Partial<SceneElement>
}

export interface AssignCatchArgs {
  /** Element to put in the slot; '' releases it. */
  nextId: string
  /** Element currently in the slot, if any. */
  current: SceneElement | undefined
  role: CatchRoleConfig['role']
  gameId: string
  /** 1-based. Which falling item this is. Ignored for the box and the check mark. */
  index?: number
  elements: SceneElement[]
}

/** The element patches that move `nextId` into the slot. Empty when nothing changes. */
export function assignCatchSlot(args: AssignCatchArgs): CatchSlotEdit[] {
  const { nextId, current, role, gameId, index, elements } = args
  if (current?.id === nextId) return []
  const edits: CatchSlotEdit[] = []
  if (current) edits.push({ id: current.id, patch: { catchRole: undefined } })
  if (!nextId) return edits
  const existing = elements.find((e) => e.id === nextId)
  edits.push({
    id: nextId,
    patch: {
      catchRole: {
        gameId,
        role,
        index: role === 'item' || role === 'soften' || role === 'collected' ? Math.max(1, Math.round(index ?? 1)) : undefined,
        // Whether the hidden check mark is shown on the canvas is a property of that
        // element's authoring state, not of the slot, so it survives a move.
        showOnCanvas: role === 'check' ? existing?.catchRole?.showOnCanvas : undefined,
      },
      comboRole: undefined,
      cleanRole: undefined,
      tapRole: undefined,
      revealRole: undefined,
      basketItem: undefined,
      drag: undefined,
    },
  })
  return edits
}

/**
 * Drop item `index`, closing the gap.
 *
 * Item numbers are positions in a list, not names, so releasing one from the middle has
 * to slide everything above it down. Doing that here rather than in the panel is what
 * keeps it a rule instead of a bug waiting for someone to delete the second of five.
 */
export function releaseItem(elements: SceneElement[], gameId: string, index: number): CatchSlotEdit[] {
  const edits: CatchSlotEdit[] = []
  for (const e of catchMembers(elements, gameId)) {
    const r = e.catchRole
    // A 'collected' element is addressed by ITS item's number, so it has to slide along with
    // the renumbering — otherwise removing item 2 of five leaves every in-box place attached
    // to the wrong product.
    if (r?.role !== 'item' && r?.role !== 'collected') continue
    const at = r.index ?? 1
    if (at === index) edits.push({ id: e.id, patch: { catchRole: undefined } })
    else if (at > index) edits.push({ id: e.id, patch: { catchRole: { ...r, index: at - 1 } } })
  }
  return edits
}

/** Elements assigned to this game — including ones tagged with no game named, which a
 * single-game scene produces. */
export function catchMembers(elements: SceneElement[], gameId: string): SceneElement[] {
  return elements.filter((e) => e.catchRole && (!e.catchRole.gameId || e.catchRole.gameId === gameId))
}

/** The falling items, in index order. */
export function catchItems(elements: SceneElement[], gameId: string): SceneElement[] {
  return catchMembers(elements, gameId)
    .filter((e) => e.catchRole?.role === 'item')
    .sort((a, b) => (a.catchRole?.index ?? 1) - (b.catchRole?.index ?? 1))
}

/** The one box, if the board has one. */
export function catchBox(elements: SceneElement[], gameId: string): SceneElement | undefined {
  return catchMembers(elements, gameId).find((e) => e.catchRole?.role === 'box')
}

/** The element standing in for item `index` once it has been caught — its place in the box.
 * Addressed by the ITEM's number, so clearing one never renumbers the others. */
export function catchCollected(elements: SceneElement[], gameId: string, index: number): SceneElement | undefined {
  return catchMembers(elements, gameId).find((e) => e.catchRole?.role === 'collected' && (e.catchRole.index ?? 1) === index)
}

/** The elements the falling items are softened behind, in slot order. */
export function catchSoften(elements: SceneElement[], gameId: string): SceneElement[] {
  return catchMembers(elements, gameId)
    .filter((e) => e.catchRole?.role === 'soften')
    .sort((a, b) => (a.catchRole?.index ?? 1) - (b.catchRole?.index ?? 1))
}

/** Drop soften slot `index`, closing the gap. Nothing is addressed BY these numbers — they
 * only keep the panel's rows stable — but they still have to stay a run without holes, or
 * the row after the one removed would come back as an empty slot. */
export function releaseSoften(elements: SceneElement[], gameId: string, index: number): CatchSlotEdit[] {
  const edits: CatchSlotEdit[] = []
  for (const e of catchMembers(elements, gameId)) {
    const r = e.catchRole
    if (r?.role !== 'soften') continue
    const at = r.index ?? 1
    if (at === index) edits.push({ id: e.id, patch: { catchRole: undefined } })
    else if (at > index) edits.push({ id: e.id, patch: { catchRole: { ...r, index: at - 1 } } })
  }
  return edits
}

/** The box's front layer, if one is assigned — the art the falling items pass behind. */
export function catchBoxFront(elements: SceneElement[], gameId: string): SceneElement | undefined {
  return catchMembers(elements, gameId).find((e) => e.catchRole?.role === 'boxfront')
}

/** The one check mark, if the board has one. */
export function catchCheck(elements: SceneElement[], gameId: string): SceneElement | undefined {
  return catchMembers(elements, gameId).find((e) => e.catchRole?.role === 'check')
}

/** How many item slots the panel should offer: never fewer than are wired up, so a
 * project saved before a count was edited down can't hide live assignments. */
export function catchSlotCount(elements: SceneElement[], gameId: string): number {
  return catchMembers(elements, gameId).reduce((n, e) => Math.max(n, e.catchRole?.role === 'item' ? (e.catchRole.index ?? 1) : 0), 0)
}

/** Elements eligible for a role: a game mount can't fall into its own basket, a
 * background can't be caught, and the hint hand is not part of the board. */
export function catchCandidates(elements: SceneElement[]): SceneElement[] {
  return elements.filter((e) => e.type !== 'game-mount' && e.type !== 'background' && e.type !== 'handguide')
}

/** How an element reads in the assignment dropdowns — its name plus the job it already
 * holds, so picking one that is spoken for is an informed choice. */
export function catchOptionLabel(el: SceneElement): string {
  const base = el.name || el.id
  const r = el.catchRole
  if (r?.role === 'item') return `${base} — falling item ${r.index ?? 1}`
  if (r?.role === 'check') return `${base} — the check mark`
  if (r?.role === 'box') return `${base} — the box`
  if (r?.role === 'boxfront') return `${base} — the front of the box`
  if (r?.role === 'soften') return `${base} — items soften behind it`
  if (r?.role === 'collected') return `${base} — item ${r.index ?? 1} in the box`
  if (el.tapRole) return `${base} — in the tap-to-remove board`
  if (el.revealRole) return `${base} — in the tap-to-reveal board`
  if (el.cleanRole) return `${base} — in the drag-to-clean board`
  if (el.comboRole) return `${base} — in the combo board`
  if (el.basketItem) return `${base} — a basket item`
  if (el.drag) return `${base} — draggable`
  return base
}

/** Plain-language name for the job an element holds, for its read-only status line. */
export function catchSlotSummary(role: CatchRoleConfig): string {
  if (role.role === 'item') return `falling item ${role.index ?? 1}, and its tick in the row`
  if (role.role === 'box') return 'the box — it catches at the height you placed it, and only moves sideways'
  if (role.role === 'boxfront') return 'the front of the box — it rides with the box, and the falling items pass behind it'
  if (role.role === 'soften') return 'falling items blur and fade while passing behind it, so its art stays legible'
  if (role.role === 'collected') return `item ${role.index ?? 1}'s place in the box — it appears there once that item is caught`
  return 'the check mark stamped on each item as it is caught'
}

/** Show or hide the check mark on the editor canvas. Authoring-only: play always keeps
 * the element itself hidden and stamps copies of it instead, so this can never leak into
 * the playable. Stored as absent rather than false, to keep saved projects lean. */
export function setCatchCanvasVisible(el: SceneElement, visible: boolean): CatchSlotEdit {
  return { id: el.id, patch: { catchRole: { ...(el.catchRole ?? { role: 'check' }), showOnCanvas: visible || undefined } } }
}
