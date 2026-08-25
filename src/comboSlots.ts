// Combo builder slot assignment. Which element fills which slot is chosen from the
// GAME's panel, not from each element's own panel, so one screen owns the whole
// wiring. That makes assignment a small set of rules worth keeping honest and
// separate from the React tree:
//
//   * a slot holds at most one element — putting a new element in frees the old one
//   * an element holds at most one slot — assigning one that already sits somewhere
//     MOVES it rather than cloning the role
//   * a layer, drag art or caption keeps its canvas-visibility flag when it moves
//   * the three drag models (combo role / basket item / plain draggable) are exclusive

import type { ComboRoleConfig, SceneElement } from '../runtime/scene'

/** One element patch the assignment needs. `comboRole: undefined` releases the element. */
export interface ComboSlotEdit {
  id: string
  patch: Partial<SceneElement>
}

export interface AssignArgs {
  /** Element to put in the slot; '' releases the slot. */
  nextId: string
  /** Element currently in the slot, if any. */
  current: SceneElement | undefined
  role: ComboRoleConfig['role']
  gameId: string
  /** 1-based; omitted for anchors, which are not per-question. */
  question?: number
  /** 1-based; only for options. */
  choice?: number
  elements: SceneElement[]
}

/** The element patches that move `nextId` into the slot. Empty when nothing changes. */
export function assignComboSlot(args: AssignArgs): ComboSlotEdit[] {
  const { nextId, current, role, gameId, question, choice, elements } = args
  if (current?.id === nextId) return []
  const edits: ComboSlotEdit[] = []
  if (current) edits.push({ id: current.id, patch: { comboRole: undefined } })
  if (!nextId) return edits
  const existing = elements.find((e) => e.id === nextId)
  edits.push({
    id: nextId,
    patch: {
      comboRole: {
        gameId,
        role,
        question,
        choice,
        // Whether one of the hidden kinds is shown on the canvas is a property of
        // that element's authoring state, not of the slot, so it survives a move.
        showOnCanvas: role === 'layer' || role === 'dragArt' || role === 'caption' ? existing?.comboRole?.showOnCanvas : undefined,
      },
      basketItem: undefined,
      drag: undefined,
    },
  })
  return edits
}

/** Elements assigned to this game — including ones tagged with no game named, which
 * a single-game scene produces. */
export function comboMembers(elements: SceneElement[], gameId: string): SceneElement[] {
  return elements.filter((e) => e.comboRole && (!e.comboRole.gameId || e.comboRole.gameId === gameId))
}

/** Elements eligible for a slot: a game mount can't be its own option and a
 * background can't be dragged out of the way. */
export function comboCandidates(elements: SceneElement[]): SceneElement[] {
  return elements.filter((e) => e.type !== 'game-mount' && e.type !== 'background' && e.type !== 'handguide')
}

/** How an element reads in the assignment dropdowns — its name plus the slot it
 * already fills, so picking one that is spoken for is an informed choice. */
export function comboOptionLabel(el: SceneElement): string {
  const base = el.name || el.id
  const r = el.comboRole
  if (!r) return base
  if (r.role === 'anchor') return `${base} — anchor`
  if (r.role === 'title') return `${base} — Q${r.question ?? 1} title`
  if (r.role === 'dragArt') return `${base} — Q${r.question ?? 1} drag art ${r.choice ?? 1}`
  if (r.role === 'caption') return `${base} — Q${r.question ?? 1} name plate ${r.choice ?? 1}`
  if (r.role === 'layer') return `${base} — Q${r.question ?? 1} layer ${r.choice ?? 1}`
  if (r.role === 'outline') return `${base} — Q${r.question ?? 1} outline ${r.choice ?? 1}`
  return `${base} — Q${r.question ?? 1} option ${r.choice ?? 1}`
}

/** Plain-language name for the slot an element fills, for its read-only status line. */
export function comboSlotSummary(role: ComboRoleConfig): string {
  if (role.role === 'anchor') return 'the anchor image'
  if (role.role === 'title') return `question ${role.question ?? 1}'s title`
  if (role.role === 'dragArt') return `what question ${role.question ?? 1}'s option ${role.choice ?? 1} looks like while dragged`
  if (role.role === 'caption') return `the name plate shown while question ${role.question ?? 1}'s option ${role.choice ?? 1} is held`
  if (role.role === 'layer') return `question ${role.question ?? 1}'s layer for option ${role.choice ?? 1}`
  if (role.role === 'outline') return `the placeholder standing where question ${role.question ?? 1}'s pick lands`
  return `question ${role.question ?? 1}, option ${role.choice ?? 1}`
}

/** Show or hide a hidden-by-default element (a layer, drag art, or a caption) on the
 * editor canvas. Authoring-only: play always starts with all of them hidden, so this
 * can never leak into the playable. Stored as absent rather than false, to keep saved
 * projects lean. */
export function setCanvasVisible(el: SceneElement, visible: boolean): ComboSlotEdit {
  return { id: el.id, patch: { comboRole: { ...(el.comboRole ?? { role: 'layer' }), showOnCanvas: visible || undefined } } }
}

/** Every layer of this game, so the panel can offer a show-all / hide-all pair. */
export function comboLayers(elements: SceneElement[], gameId: string): SceneElement[] {
  return comboMembers(elements, gameId).filter((e) => e.comboRole?.role === 'layer')
}
