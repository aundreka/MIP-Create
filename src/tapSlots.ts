// Tap to remove slot assignment. Which element is an obstacle and what it turns into
// is chosen from the GAME's panel, not from each element's own — the same arrangement
// combo builder and drag-to-clean use, and for the same reason: the roles only mean
// something relative to each other.
//
// The rules:
//
//   * obstacles are a LIST — any number, assigned one at a time, and the panel passes
//     the one being changed as `current` rather than the group.
//   * an 'after' is addressed to an obstacle by INDEX, and several may share one, so a
//     tile plus a sparkle plus a label all arrive together on the same tap.
//   * an element holds at most one role: naming an obstacle as an 'after' MOVES it.
//   * the drag models (tap role / clean role / combo role / basket item / plain
//     draggable) are exclusive — they all want the same pointer.
//
// Removing an obstacle from the middle of the list would renumber the ones after it and
// orphan their replacements, so `releaseObstacle` renumbers both sides together.

import type { SceneElement, TapRoleConfig } from '../runtime/scene'

/** One element patch the assignment needs. `tapRole: undefined` releases the element. */
export interface TapSlotEdit {
  id: string
  patch: Partial<SceneElement>
}

export interface AssignTapArgs {
  /** Element to put in the slot; '' releases it. */
  nextId: string
  /** Element currently in the slot, if any. */
  current: SceneElement | undefined
  role: TapRoleConfig['role']
  gameId: string
  /** 1-based. Which obstacle this is, or which one an 'after' replaces. */
  index: number
  elements: SceneElement[]
}

/** The element patches that move `nextId` into the slot. Empty when nothing changes. */
export function assignTapSlot(args: AssignTapArgs): TapSlotEdit[] {
  const { nextId, current, role, gameId, index, elements } = args
  if (current?.id === nextId) return []
  const edits: TapSlotEdit[] = []
  if (current) edits.push({ id: current.id, patch: { tapRole: undefined } })
  if (!nextId) return edits
  const existing = elements.find((e) => e.id === nextId)
  edits.push({
    id: nextId,
    patch: {
      tapRole: {
        gameId,
        role,
        index,
        // Whether a hidden replacement is shown on the canvas is a property of that
        // element's authoring state, not of the slot, so it survives a move.
        showOnCanvas: role === 'after' ? existing?.tapRole?.showOnCanvas : undefined,
      },
      comboRole: undefined,
      cleanRole: undefined,
      revealRole: undefined,
      basketItem: undefined,
      configRole: undefined,
      catchRole: undefined,
      drag: undefined,
    },
  })
  return edits
}

/**
 * Drop obstacle `index`, closing the gap.
 *
 * Obstacle numbers are positions in a list, not names, so releasing one from the middle
 * has to slide everything above it down — and take each one's replacements with it, or
 * they would end up addressed to the wrong obstacle (or to none at all). Doing that
 * here rather than in the panel is what keeps it a rule instead of a bug waiting for
 * someone to delete the second of five.
 */
export function releaseObstacle(elements: SceneElement[], gameId: string, index: number): TapSlotEdit[] {
  const edits: TapSlotEdit[] = []
  for (const e of tapMembers(elements, gameId)) {
    const r = e.tapRole
    if (!r) continue
    const at = r.index ?? 1
    if (at === index) {
      // The obstacle itself goes, and so does anything that was standing in for it.
      edits.push({ id: e.id, patch: { tapRole: undefined } })
    } else if (at > index) {
      edits.push({ id: e.id, patch: { tapRole: { ...r, index: at - 1 } } })
    }
  }
  return edits
}

/** Elements assigned to this game — including ones tagged with no game named, which a
 * single-game scene produces. */
export function tapMembers(elements: SceneElement[], gameId: string): SceneElement[] {
  return elements.filter((e) => e.tapRole && (!e.tapRole.gameId || e.tapRole.gameId === gameId))
}

/** The obstacles, in index order. */
export function tapObstacles(elements: SceneElement[], gameId: string): SceneElement[] {
  return tapMembers(elements, gameId)
    .filter((e) => e.tapRole?.role === 'obstacle')
    .sort((a, b) => (a.tapRole?.index ?? 1) - (b.tapRole?.index ?? 1))
}

/** What obstacle `index` turns into — a list, in scene order, since one tap can bring
 * up several separately placed pieces. */
export function tapAfters(elements: SceneElement[], gameId: string, index: number): SceneElement[] {
  return tapMembers(elements, gameId).filter((e) => e.tapRole?.role === 'after' && (e.tapRole.index ?? 1) === index)
}

/** How many obstacle slots the panel should offer: never fewer than are wired up, so a
 * project saved before a count was edited down can't hide live assignments. */
export function tapSlotCount(elements: SceneElement[], gameId: string): number {
  return tapMembers(elements, gameId).reduce((n, e) => Math.max(n, e.tapRole?.index ?? 1), 0)
}

/** Elements eligible for a role: a game mount can't remove itself, a background can't
 * be tapped away, and the hint hand is not part of the board. */
export function tapCandidates(elements: SceneElement[]): SceneElement[] {
  return elements.filter((e) => e.type !== 'game-mount' && e.type !== 'background' && e.type !== 'handguide')
}

/** How an element reads in the assignment dropdowns — its name plus the job it already
 * holds, so picking one that is spoken for is an informed choice. */
export function tapOptionLabel(el: SceneElement): string {
  const base = el.name || el.id
  const r = el.tapRole
  if (r?.role === 'obstacle') return `${base} — obstacle ${r.index ?? 1}`
  if (r?.role === 'after') return `${base} — what obstacle ${r.index ?? 1} becomes`
  if (el.revealRole) return `${base} — in the tap-to-reveal board`
  if (el.cleanRole) return `${base} — in the drag-to-clean board`
  if (el.comboRole) return `${base} — in the combo board`
  if (el.catchRole) return `${base} — in the catch board`
  if (el.basketItem) return `${base} — a basket item`
  if (el.drag) return `${base} — draggable`
  return base
}

/** Plain-language name for the job an element holds, for its read-only status line. */
export function tapSlotSummary(role: TapRoleConfig): string {
  return role.role === 'obstacle' ? `obstacle ${role.index ?? 1}, tapped to remove it` : `what obstacle ${role.index ?? 1} turns into`
}

/** Show or hide a replacement on the editor canvas. Authoring-only: play always starts
 * with all of them hidden, so this can never leak into the playable. Stored as absent
 * rather than false, to keep saved projects lean. */
export function setTapCanvasVisible(el: SceneElement, visible: boolean): TapSlotEdit {
  return { id: el.id, patch: { tapRole: { ...(el.tapRole ?? { role: 'after' }), showOnCanvas: visible || undefined } } }
}
