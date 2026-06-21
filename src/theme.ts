// Editor theme (light/dark). This controls ONLY the editor chrome — never the
// rendered ad (which lives in an isolated iframe). Persisted to localStorage,
// deliberately kept out of the undo/autosave store. Mirrors brandkit.ts.

import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const LS_KEY = 'pa:theme'

type Listener = () => void
const listeners = new Set<Listener>()

export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw === 'light' || raw === 'dark') return raw
  } catch {
    /* ignore */
  }
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'
  } catch {
    /* ignore */
  }
  return 'dark'
}

export function saveTheme(t: Theme): void {
  try {
    localStorage.setItem(LS_KEY, t)
  } catch {
    /* ignore */
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t)
}

export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'light' ? 'light' : 'dark'
}

// Idempotent: safe to call multiple times (e.g. React StrictMode double-invoke).
export function initTheme(): Theme {
  const t = loadTheme()
  applyTheme(t)
  return t
}

export function setTheme(t: Theme): void {
  applyTheme(t)
  saveTheme(t)
  listeners.forEach((l) => l())
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

// React binding so chrome (theme toggle button, etc.) re-renders on change.
export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => currentTheme(),
    () => 'dark',
  )
}
