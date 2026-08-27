// Editor UI preferences (inspector accordion open/closed, layer-group collapse).
// Persisted to localStorage and deliberately kept OUT of the undo/autosave store
// (store.ts snapshots project+assets for history). Mirrors brandkit.ts / theme.ts.

const LS_KEY = 'pa:uistate'

interface DockState {
  w?: number
  collapsed?: boolean
}
interface UIState {
  accordion: Record<string, boolean>
  groupCollapsed: Record<string, boolean>
  dock: Record<string, DockState>
  flags: Record<string, boolean>
}

function load(): UIState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<UIState>
      return { accordion: v.accordion ?? {}, groupCollapsed: v.groupCollapsed ?? {}, dock: v.dock ?? {}, flags: v.flags ?? {} }
    }
  } catch {
    /* ignore */
  }
  return { accordion: {}, groupCollapsed: {}, dock: {}, flags: {} }
}

const cache = load()

function save(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache))
  } catch {
    /* ignore */
  }
}

// Simple on/off view preferences (e.g. whether the canvas draws resize handles).
export function getFlag(id: string, dflt: boolean): boolean {
  return cache.flags[id] ?? dflt
}
export function setFlag(id: string, on: boolean): void {
  cache.flags[id] = on
  save()
}

export function getAccordion(id: string, dflt: boolean): boolean {
  return cache.accordion[id] ?? dflt
}
export function setAccordion(id: string, open: boolean): void {
  cache.accordion[id] = open
  save()
}

export function getGroupCollapsed(id: string): boolean {
  return cache.groupCollapsed[id] ?? false
}
export function setGroupCollapsed(id: string, collapsed: boolean): void {
  cache.groupCollapsed[id] = collapsed
  save()
}
// Dock panel sizing/collapse (Navigator, Inspector), persisted per panel id.
export function getDock(id: string): DockState {
  return cache.dock[id] ?? {}
}
export function setDock(id: string, patch: DockState): void {
  cache.dock[id] = { ...cache.dock[id], ...patch }
  save()
}

/** Drop collapse state for groups that no longer exist, so a reused groupId can't
 * inherit a stale collapsed/expanded flag. Returns true if anything was pruned. */
export function pruneGroupCollapsed(liveIds: Set<string>): boolean {
  let changed = false
  for (const id of Object.keys(cache.groupCollapsed)) {
    if (!liveIds.has(id)) {
      delete cache.groupCollapsed[id]
      changed = true
    }
  }
  if (changed) save()
  return changed
}
