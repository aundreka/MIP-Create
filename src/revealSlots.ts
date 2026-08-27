// Tap to reveal slot assignment. Which element is a cover and what it brings up is
// chosen from the GAME's panel, like the rest of this family, so one screen owns the
// whole wiring.
//
// The rules:
//
//   * covers are a LIST — any number, assigned one at a time.
//   * a REVEAL belongs to one cover and is named by that cover's element ID, not by a
//     position in a list. Nothing renumbers, so un-assigning a cover cannot re-point
//     another one's prize at the wrong spot.
//   * a cover with no reveal is not a mistake: it just leaves, and whatever the author
//     placed behind it is what the player sees.
//   * an element holds at most one role across every game — they all want the pointer.

import type { RevealRoleConfig, SceneElement } from '../runtime/scene'

/** One element patch the assignment needs. `revealRole: undefined` releases it. */
export interface RevealSlotEdit {
  id: string
  patch: Partial<SceneElement>
}

export interface AssignRevealArgs {
  /** Element to put in the role; '' releases it. */
  nextId: string
  /** Element currently in the role, if any. */
  current: SceneElement | undefined
  role: RevealRoleConfig['role']
  gameId: string
  /** 'reveal' only: the cover that brings it up. */
  ofId?: string
  elements: SceneElement[]
}

/** The element patches that move `nextId` into the role. Empty when nothing changes. */
export function assignRevealSlot(args: AssignRevealArgs): RevealSlotEdit[] {
  const { nextId, current, role, gameId, ofId, elements } = args
  if (current?.id === nextId) return []
  const edits: RevealSlotEdit[] = []
  if (current) edits.push({ id: current.id, patch: { revealRole: undefined } })
  if (!nextId) return edits
  const existing = elements.find((e) => e.id === nextId)
  edits.push({
    id: nextId,
    patch: {
      revealRole: {
        gameId,
        role,
        ofId: role === 'reveal' ? ofId : undefined,
        // Whether a hidden reveal is shown on the canvas is a property of that
        // element's authoring state, not of the slot, so it survives a move.
        showOnCanvas: role === 'reveal' ? existing?.revealRole?.showOnCanvas : undefined,
      },
      comboRole: undefined,
      cleanRole: undefined,
      tapRole: undefined,
      basketItem: undefined,
      drag: undefined,
    },
  })
  return edits
}

/** Releasing a cover releases what it was going to reveal, or those pieces are left
 * addressed to an element no longer on the board — inert and invisible in the panel. */
export function releaseCover(elements: SceneElement[], gameId: string, coverId: string): RevealSlotEdit[] {
  return [
    { id: coverId, patch: { revealRole: undefined } },
    ...revealsOf(elements, gameId, coverId).map((e) => ({ id: e.id, patch: { revealRole: undefined } })),
  ]
}

/** Elements assigned to this game — including ones tagged with no game named, which a
 * single-game scene produces. */
export function revealMembers(elements: SceneElement[], gameId: string): SceneElement[] {
  return elements.filter((e) => e.revealRole && (!e.revealRole.gameId || e.revealRole.gameId === gameId))
}

/** The covers, in scene order. */
export function revealCovers(elements: SceneElement[], gameId: string): SceneElement[] {
  return revealMembers(elements, gameId).filter((e) => e.revealRole?.role === 'cover')
}

/** What one cover brings up — a list, since a tap can raise a prize, a glow and a
 * caption, each placed and animated on its own. */
export function revealsOf(elements: SceneElement[], gameId: string, coverId: string): SceneElement[] {
  return revealMembers(elements, gameId).filter((e) => e.revealRole?.role === 'reveal' && e.revealRole.ofId === coverId)
}

/** Elements eligible for a role: a game mount can't cover itself, a background can't be
 * tapped away, and the hint hand is not part of the board. */
export function revealCandidates(elements: SceneElement[]): SceneElement[] {
  return elements.filter((e) => e.type !== 'game-mount' && e.type !== 'background' && e.type !== 'handguide')
}

/** How an element reads in the assignment dropdowns — its name plus the job it already
 * holds, so picking one that is spoken for is an informed choice. */
export function revealOptionLabel(el: SceneElement): string {
  const base = el.name || el.id
  const r = el.revealRole
  if (r?.role === 'cover') return `${base} — a cover`
  if (r?.role === 'reveal') return `${base} — revealed by a cover`
  if (el.tapRole) return `${base} — in the tap-to-remove board`
  if (el.cleanRole) return `${base} — in the drag-to-clean board`
  if (el.comboRole) return `${base} — in the combo board`
  if (el.basketItem) return `${base} — a basket item`
  if (el.drag) return `${base} — draggable`
  return base
}

/** Plain-language name for the job an element holds, for its read-only status line. */
export function revealSlotSummary(role: RevealRoleConfig): string {
  return role.role === 'cover' ? 'a cover the player taps' : 'an image revealed by a cover'
}

/** Show or hide a reveal on the editor canvas. Authoring-only: play always starts with
 * all of them hidden, so this can never leak into the playable. Stored as absent rather
 * than false, to keep saved projects lean. */
export function setRevealCanvasVisible(el: SceneElement, visible: boolean): RevealSlotEdit {
  return { id: el.id, patch: { revealRole: { ...(el.revealRole ?? { role: 'reveal' }), showOnCanvas: visible || undefined } } }
}
