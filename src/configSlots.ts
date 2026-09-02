// Configurator slot assignment. Which element fills which slot is chosen from the
// GAME's panel, not from each element's own panel, so one screen owns the whole
// wiring — the same arrangement the combo board uses (comboSlots.ts), and for the same
// reason: the roles only mean something relative to each other. That makes assignment a
// small set of rules worth keeping honest and separate from the React tree:
//
//   * an option slot holds at most one element — putting a new one in frees the old one
//   * displays and the three kinds of bound art are LISTS, so several can sit on one
//     option (or, for a display, on the game). Assignment is per element either way —
//     the panel passes the element being changed as `current`, not the group.
//   * an element holds at most one slot — assigning one that already sits somewhere
//     MOVES it rather than cloning the role
//   * a piece of bound art keeps its canvas-visibility flag when it moves
//   * the game roles (configurator / combo / clean / tap / reveal / catch / basket item
//     / plain draggable) are exclusive

import type { ConfigRoleConfig, SceneElement } from '../runtime/scene'

/** One element patch the assignment needs. `configRole: undefined` releases it. */
export interface ConfigSlotEdit {
  id: string
  patch: Partial<SceneElement>
}

export interface AssignConfigArgs {
  /** Element to put in the slot; '' releases the slot. */
  nextId: string
  /** Element currently in the slot, if any. */
  current: SceneElement | undefined
  role: ConfigRoleConfig['role']
  gameId: string
  /** 1-based; omitted for displays, which follow the whole combination. */
  group?: number
  /** 1-based; omitted for displays. */
  choice?: number
  elements: SceneElement[]
}

/** Which roles are bound to one option, and so carry a group + choice. */
const BOUND = new Set<ConfigRoleConfig['role']>(['option', 'active', 'inactive', 'follow'])
/** Which roles play a state the game decides, and so want the show-on-canvas eye. */
const HIDES = new Set<ConfigRoleConfig['role']>(['active', 'inactive'])

/** The element patches that move `nextId` into the slot. Empty when nothing changes. */
export function assignConfigSlot(args: AssignConfigArgs): ConfigSlotEdit[] {
  const { nextId, current, role, gameId, group, choice, elements } = args
  if (current?.id === nextId) return []
  const edits: ConfigSlotEdit[] = []
  if (current) edits.push({ id: current.id, patch: { configRole: undefined } })
  if (!nextId) return edits
  const existing = elements.find((e) => e.id === nextId)
  edits.push({
    id: nextId,
    patch: {
      configRole: {
        gameId,
        role,
        // A display is not addressed to a group or a choice; storing them anyway would
        // leave stale numbers behind when it is moved back onto an option.
        group: BOUND.has(role) ? group : undefined,
        choice: BOUND.has(role) ? choice : undefined,
        // Whether a hidden kind is shown on the canvas is a property of that element's
        // authoring state, not of the slot, so it survives a move.
        showOnCanvas: HIDES.has(role) ? existing?.configRole?.showOnCanvas : undefined,
      },
      basketItem: undefined,
      comboRole: undefined,
      cleanRole: undefined,
      tapRole: undefined,
      revealRole: undefined,
      catchRole: undefined,
      drag: undefined,
    },
  })
  return edits
}

/** Elements assigned to this game — including ones tagged with no game named, which a
 * single-game scene produces. */
export function configMembers(elements: SceneElement[], gameId: string): SceneElement[] {
  return elements.filter((e) => e.configRole && (!e.configRole.gameId || e.configRole.gameId === gameId))
}

/** Elements eligible for a slot: a game mount can't be its own option, and a background
 * can't be tapped or pushed aside. */
export function configCandidates(elements: SceneElement[]): SceneElement[] {
  return elements.filter((e) => e.type !== 'game-mount' && e.type !== 'background' && e.type !== 'handguide')
}

const ROLE_WORD: Record<ConfigRoleConfig['role'], string> = {
  option: 'option',
  display: 'product image',
  active: 'selected art',
  inactive: 'unselected art',
  follow: 'rides along',
}

/** How an element reads in the assignment dropdowns — its name plus the slot it already
 * fills, so picking one that is spoken for is an informed choice. */
export function configOptionLabel(el: SceneElement): string {
  const base = el.name || el.id
  const r = el.configRole
  if (!r) return base
  if (r.role === 'display') return `${base} — product image`
  return `${base} — G${r.group ?? 1} option ${r.choice ?? 1} ${ROLE_WORD[r.role]}`
}

/** Plain-language name for the slot an element fills, for its read-only status line. */
export function configSlotSummary(role: ConfigRoleConfig): string {
  const where = `group ${role.group ?? 1}, option ${role.choice ?? 1}`
  if (role.role === 'display') return 'the product image the table swaps'
  if (role.role === 'option') return where
  if (role.role === 'active') return `art shown while ${where} is selected`
  if (role.role === 'inactive') return `art shown while ${where} is NOT selected`
  return `art that rides along with ${where}`
}

/** Show or hide a state-art element on the editor canvas. Authoring-only: play decides
 * both states from the live selection, so this can never leak into the playable. Stored
 * as absent rather than false, to keep saved projects lean. */
export function setConfigCanvasVisible(el: SceneElement, visible: boolean): ConfigSlotEdit {
  return { id: el.id, patch: { configRole: { ...(el.configRole ?? { role: 'active' }), showOnCanvas: visible || undefined } } }
}

/** The one option element in a slot, if any. */
export function configOption(elements: SceneElement[], gameId: string, group: number, choice: number): SceneElement | undefined {
  return configMembers(elements, gameId).find((e) => e.configRole?.role === 'option' && (e.configRole.group ?? 1) === group && (e.configRole.choice ?? 1) === choice)
}

/** The bound art of one kind on one option — a list, in scene order, since an option can
 * carry several separately placed pieces. */
export function configBound(elements: SceneElement[], gameId: string, role: 'active' | 'inactive' | 'follow', group: number, choice: number): SceneElement[] {
  return configMembers(elements, gameId).filter((e) => e.configRole?.role === role && (e.configRole.group ?? 1) === group && (e.configRole.choice ?? 1) === choice)
}

/** Every display of this game — any number of them all follow the same combination. */
export function configDisplays(elements: SceneElement[], gameId: string): SceneElement[] {
  return configMembers(elements, gameId).filter((e) => e.configRole?.role === 'display')
}

/** Every state-art element of this game, so the panel can offer a show-all / hide-all
 * pair the way the combo panel does for layers. */
export function configStateArt(elements: SceneElement[], gameId: string): SceneElement[] {
  return configMembers(elements, gameId).filter((e) => e.configRole?.role === 'active' || e.configRole?.role === 'inactive')
}

/** How many choices each group has wired up, 1-based by group. Drives both the option
 * rows and the size of the picture table. */
export function configChoiceCounts(elements: SceneElement[], gameId: string, groups: number): number[] {
  const counts = Array.from({ length: groups + 1 }, () => 0)
  for (const e of configMembers(elements, gameId)) {
    const r = e.configRole
    if (!r || r.role !== 'option') continue
    const g = r.group ?? 1
    if (g <= groups) counts[g] = Math.max(counts[g], r.choice ?? 1)
  }
  return counts
}

/** Every combination of the groups that have options, as choice-index tuples in group
 * order — the rows of the picture table. Groups with nothing wired up are not
 * dimensions: the game skips them when it builds a key, so the panel must too, or the
 * cells the author fills in are ones the board will never look up.
 *
 * Ordered so the LAST group varies fastest, which is how a person reads a table: all of
 * walnut's sizes together, then all of pecan's. */
export function configCombos(counts: number[]): number[][] {
  const live = counts.map((n, g) => ({ g, n })).filter((x) => x.g > 0 && x.n > 0)
  if (!live.length) return []
  let out: number[][] = [[]]
  for (const { n } of live) out = out.flatMap((row) => Array.from({ length: n }, (_, i) => [...row, i + 1]))
  return out
}

/** The param key holding the product shot for one combination. Must match the key the
 * runtime builds (see runtime/games/configurator.ts). */
export function configImageKey(combo: number[]): string {
  return 'img_' + combo.join('_')
}

/** The param key holding what one option looks like while it is selected. */
export function configActiveKey(group: number, choice: number): string {
  return `on_${group}_${choice}`
}
