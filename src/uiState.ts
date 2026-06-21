// Editor UI preferences (inspector accordion open/closed, layer-group collapse).
// Persisted to localStorage and deliberately kept OUT of the undo/autosave store
// (store.ts snapshots project+assets for history). Mirrors brandkit.ts / theme.ts.

const LS_KEY = 'pa:uistate'

interface UIState {
  accordion: Record<string, boolean>
  groupCollapsed: Record<string, boolean>
}

function load(): UIState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<UIState>
      return { accordion: v.accordion ?? {}, groupCollapsed: v.groupCollapsed ?? {} }
    }
  } catch {
    /* ignore */
  }
  return { accordion: {}, groupCollapsed: {} }
}

const cache = load()

function save(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache))
  } catch {
    /* ignore */
  }
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
