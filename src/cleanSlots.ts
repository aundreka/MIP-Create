// Drag to clean slot assignment. Which element is the tool and which are the mess is
// chosen from the GAME's panel, not from each element's own, so one screen owns the
// whole wiring — the same arrangement combo builder uses (comboSlots.ts), and for
// the same reason: the roles only mean anything relative to each other.
//
// The rules are few enough to state:
//
//   * there is ONE tool. Naming a new one frees whoever held the job before.
//   * obstacles are a LIST — any number, and assignment is per element, so the panel
//     passes the obstacle being changed as `current` rather than the group.
//   * an element holds at most one role: naming one that is already the tool as an
//     obstacle MOVES it rather than cloning it.
//   * the four drag models (clean role / combo role / basket item / plain draggable)
//     are exclusive, because they all want the same pointer.
//
// Nothing here touches an element's LOOK. Position, size, crop, animation and art
// stay the element's own, edited on the canvas exactly as if no game existed — which
// is the whole point of assigning already-placed elements instead of uploading into
// a game panel.

import type { CleanRoleConfig, SceneElement } from '../runtime/scene'

/** One element patch the assignment needs. `cleanRole: undefined` releases it. */
export interface CleanSlotEdit {
  id: string
  patch: Partial<SceneElement>
}

export interface AssignCleanArgs {
  /** Element to put in the role; '' releases it. */
  nextId: string
  /** Element currently in the role, if any. */
  current: SceneElement | undefined
  role: CleanRoleConfig['role']
  gameId: string
}

/** The element patches that move `nextId` into the role. Empty when nothing changes. */
export function assignCleanSlot(args: AssignCleanArgs): CleanSlotEdit[] {
  const { nextId, current, role, gameId } = args
  if (current?.id === nextId) return []
  const edits: CleanSlotEdit[] = []
  if (current) edits.push({ id: current.id, patch: { cleanRole: undefined } })
  if (!nextId) return edits
  edits.push({
    id: nextId,
    patch: {
      cleanRole: { gameId, role },
      // The other three drag models let go of it — they cannot share a pointer.
      comboRole: undefined,
      basketItem: undefined,
      drag: undefined,
    },
  })
  return edits
}

/** Elements assigned to this game — including ones tagged with no game named, which
 * a single-game scene produces. */
export function cleanMembers(elements: SceneElement[], gameId: string): SceneElement[] {
  return elements.filter((e) => e.cleanRole && (!e.cleanRole.gameId || e.cleanRole.gameId === gameId))
}

/** The tool, if one has been named yet. */
export function cleanDraggable(elements: SceneElement[], gameId: string): SceneElement | undefined {
  return cleanMembers(elements, gameId).find((e) => e.cleanRole?.role === 'draggable')
}

/** The mess, in scene order. */
export function cleanObstacles(elements: SceneElement[], gameId: string): SceneElement[] {
  return cleanMembers(elements, gameId).filter((e) => e.cleanRole?.role === 'obstacle')
}

/** Elements eligible for a role: a game mount can't clean itself, a background can't
 * be wiped away, and the hint hand is not part of the board. */
export function cleanCandidates(elements: SceneElement[]): SceneElement[] {
  return elements.filter((e) => e.type !== 'game-mount' && e.type !== 'background' && e.type !== 'handguide')
}

/** How an element reads in the assignment dropdowns — its name plus the job it
 * already holds, so picking one that is spoken for is an informed choice. */
export function cleanOptionLabel(el: SceneElement): string {
  const base = el.name || el.id
  if (el.cleanRole?.role === 'draggable') return `${base} — the tool`
  if (el.cleanRole?.role === 'obstacle') return `${base} — an obstacle`
  if (el.comboRole) return `${base} — in the combo board`
  if (el.basketItem) return `${base} — a basket item`
  if (el.drag) return `${base} — draggable`
  return base
}

/** Plain-language name for the job an element holds, for its read-only status line. */
export function cleanSlotSummary(role: CleanRoleConfig): string {
  return role.role === 'draggable' ? 'the object the player drags' : 'an obstacle to clean up'
}
