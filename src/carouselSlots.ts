// Carousel slot assignment. Which element IS which choice — and which labels it, and
// which art reacts to it from elsewhere on the screen — is chosen from the GAME's
// panel, not from each element's own, so one screen owns the whole wiring. The same
// arrangement comboSlots.ts makes for a Combo board, and the same small set of rules:
//
//   * a slot holds at most one element — putting a new element in frees the old one
//   * an element holds at most one slot — assigning one that already fills another
//     MOVES it rather than cloning the role
//   * an element keeps its canvas-visibility flag when it moves
//   * the drag models (combo role / basket item / plain draggable) are exclusive with
//     a carousel role: an element does one job on the board

import type { CarouselRoleConfig, SceneElement } from '../runtime/scene'

/** One element patch the assignment needs. `carouselRole: undefined` releases it. */
export interface CarouselSlotEdit {
  id: string
  patch: Partial<SceneElement>
}

export interface AssignCarouselArgs {
  /** Element to put in the slot; '' releases the slot. */
  nextId: string
  /** Element currently in the slot, if any. */
  current: SceneElement | undefined
  gameId: string
  role: CarouselRoleConfig['role']
  /** 1-based choice this element belongs to. */
  choice: number
  elements: SceneElement[]
}

/** The element patches that move `nextId` into the slot. Empty when nothing changes. */
export function assignCarouselSlot(args: AssignCarouselArgs): CarouselSlotEdit[] {
  const { nextId, current, gameId, role, choice, elements } = args
  if (current?.id === nextId) return []
  const edits: CarouselSlotEdit[] = []
  if (current) edits.push({ id: current.id, patch: { carouselRole: undefined } })
  if (!nextId) return edits
  const existing = elements.find((e) => e.id === nextId)
  edits.push({
    id: nextId,
    patch: {
      carouselRole: {
        gameId,
        role,
        choice,
        // Whether a label is shown on the canvas is a property of that element's
        // authoring state, not of the slot, so it survives a move.
        showOnCanvas: existing?.carouselRole?.showOnCanvas,
      },
      comboRole: undefined,
      basketItem: undefined,
      drag: undefined,
    },
  })
  return edits
}

/** Elements assigned to this game — including ones tagged with no game named, which a
 * single-game scene produces. */
export function carouselMembers(elements: SceneElement[], gameId: string): SceneElement[] {
  return elements.filter((e) => e.carouselRole && (!e.carouselRole.gameId || e.carouselRole.gameId === gameId))
}

/** The element filling one slot (1-based choice), if any. */
export function carouselSlotFor(elements: SceneElement[], gameId: string, role: CarouselRoleConfig['role'], choice: number): SceneElement | undefined {
  return carouselMembers(elements, gameId).find((e) => e.carouselRole!.role === role && (e.carouselRole!.choice ?? 1) === choice)
}

/** How many choices are actually wired up — the row's real length, which is what the
 * game counts. Never let the panel offer fewer rows than this. */
export function carouselWired(elements: SceneElement[], gameId: string): number {
  return carouselMembers(elements, gameId).reduce((n, e) => Math.max(n, e.carouselRole!.choice ?? 1), 0)
}

/** Elements eligible for a slot: a game mount can't be its own choice, and a
 * background can't be flown around the row. */
export function carouselCandidates(elements: SceneElement[]): SceneElement[] {
  return elements.filter((e) => e.type !== 'game-mount' && e.type !== 'background' && e.type !== 'handguide')
}

/** How an element reads in the assignment dropdowns — its name plus the slot it
 * already fills, so picking one that is spoken for is an informed choice. */
export function carouselOptionLabel(el: SceneElement): string {
  const base = el.name || el.id
  const r = el.carouselRole
  if (r) return `${base} — ${ROLE_WORD[r.role]} ${r.choice ?? 1}`
  if (el.comboRole) return `${base} — in a combo board`
  return base
}

const ROLE_WORD: Record<CarouselRoleConfig['role'], string> = { choice: 'choice', label: 'label', reveal: 'reveal' }

/** Plain-language name for the slot an element fills, for its read-only status line. */
export function carouselSlotSummary(role: CarouselRoleConfig): string {
  const n = role.choice ?? 1
  if (role.role === 'choice') return `choice ${n} in the row`
  if (role.role === 'label') return `the label for choice ${n}`
  return `the art shown while choice ${n} is selected`
}

/** Show or hide one of these on the editor canvas. Authoring-only: play drives every
 * one of them regardless, so this can never leak into the playable. Stored as absent
 * rather than false, to keep saved projects lean. */
export function setCarouselCanvasVisible(el: SceneElement, visible: boolean): CarouselSlotEdit {
  return { id: el.id, patch: { carouselRole: { ...(el.carouselRole ?? { role: 'choice' as const }), showOnCanvas: visible || undefined } } }
}
