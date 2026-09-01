// Editor UI preferences (inspector accordion open/closed, layer-group collapse).
// Persisted to localStorage and deliberately kept OUT of the undo/autosave store
// (store.ts snapshots project+assets for history). Mirrors brandkit.ts / theme.ts.

import { useSyncExternalStore } from 'react'

const LS_KEY = 'pa:uistate'
const PREVIEW_DATE_KEY = 'pa:previewDate'

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

// ---------------------------------------------------------------------------
// Preview date (dynamic holiday). Forces the CANVAS and Preview to render as if it
// were another day, so a designer can compose both states of a holiday label — the
// promo copy and its fallback — without touching the machine clock. A view
// preference like the rest of this module: localStorage, never the undo store, and
// never sent to an export.
// ---------------------------------------------------------------------------
const previewListeners = new Set<() => void>()

function loadPreviewDate(): string | null {
  try {
    const raw = localStorage.getItem(PREVIEW_DATE_KEY)
    return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
  } catch {
    return null
  }
}

let previewDate: string | null = loadPreviewDate()

/** The previewed day as 'YYYY-MM-DD', or null when the editor follows the real clock. */
export function getPreviewDate(): string | null {
  return previewDate
}

export function setPreviewDate(key: string | null): void {
  const next = key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null
  if (next === previewDate) return
  previewDate = next
  try {
    if (next) localStorage.setItem(PREVIEW_DATE_KEY, next)
    else localStorage.removeItem(PREVIEW_DATE_KEY)
  } catch {
    /* ignore */
  }
  previewListeners.forEach((l) => l())
}

export function subscribePreviewDate(fn: () => void): () => void {
  previewListeners.add(fn)
  return () => previewListeners.delete(fn)
}

/** The instant to hand the runtime (frame-protocol `previewNow`), or null for the real
 * clock. LOCAL NOON of the chosen day, not midnight: the label only cares which day it
 * is, and noon can't land on an hour that a DST switch skips. */
export function previewNowMs(): number | null {
  if (!previewDate) return null
  const [y, m, d] = previewDate.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

/** Today as 'YYYY-MM-DD' in the editor's own timezone — the date input's max/reset. */
export function todayKey(): string {
  const now = new Date()
  const p = (n: number): string => (n < 10 ? '0' + n : String(n))
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** React binding for the preview date (same shape as theme.ts's). */
export function usePreviewDate(): string | null {
  return useSyncExternalStore(subscribePreviewDate, getPreviewDate, getPreviewDate)
}
