// Project library — lets the editor hold MANY playables (browser mode), backed by
// localStorage. An index (pa:projects) lists records; each project's data lives at
// pa:proj:<id>. The "current" project id is remembered (pa:lastProject) so a
// reload reopens it. Switching always persists the project being left first.

import type { Project, ProjectMeta } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import type { ProjectData } from './bridge'
import { blankProject, getState, loadProject, type TraceState } from './store'

export interface ProjectRecord {
  id: string
  name: string
  updatedAt: number
}

const INDEX_KEY = 'pa:projects'
const DATA_PREFIX = 'pa:proj:'
const LAST_KEY = 'pa:lastProject'
const LEGACY_KEY = 'pa:project'

let currentId: string | null = null

function now(): number {
  return Date.now()
}
export function newId(): string {
  return 'p' + now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)
}

function readIndex(): ProjectRecord[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    const arr = raw ? (JSON.parse(raw) as ProjectRecord[]) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
function writeIndex(list: ProjectRecord[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list))
  } catch {
    /* quota */
  }
}

export function listProjects(): ProjectRecord[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt)
}
export function currentProjectId(): string | null {
  return currentId
}
function setCurrent(id: string): void {
  currentId = id
  try {
    localStorage.setItem(LAST_KEY, id)
  } catch {
    /* */
  }
}

export function loadProjectData(id: string): ProjectData | null {
  try {
    const raw = localStorage.getItem(DATA_PREFIX + id)
    if (!raw) return null
    const d = JSON.parse(raw) as ProjectData
    return d?.project?.scenes ? d : null
  } catch {
    return null
  }
}

function writeData(id: string, data: ProjectData): void {
  try {
    localStorage.setItem(DATA_PREFIX + id, JSON.stringify(data))
  } catch {
    /* quota — large data URLs can overflow localStorage */
  }
}

function upsertRecord(id: string, name: string): void {
  const list = readIndex().filter((r) => r.id !== id)
  list.push({ id, name, updatedAt: now() })
  writeIndex(list)
}

/** Persist the project currently open in the editor to its slot. */
export function saveCurrent(): void {
  if (!currentId) return
  const s = getState()
  writeData(currentId, { project: s.project, assets: s.assets, trace: s.trace })
  upsertRecord(currentId, s.project.meta.name || 'untitled')
}

/** Open an existing project (persists the one being left first). */
export function openProject(id: string): boolean {
  const d = loadProjectData(id)
  if (!d) return false
  saveCurrent()
  loadProject(d.project, d.assets, null, d.trace)
  setCurrent(id)
  return true
}

/** Create a new project from the given data (or a blank one) and switch to it. */
export function createProject(data?: { project: Project; assets: AssetMap; trace?: TraceState }): string {
  saveCurrent()
  const d = data ?? blankProject()
  const id = newId()
  writeData(id, { project: d.project, assets: d.assets, trace: d.trace })
  upsertRecord(id, d.project.meta.name || 'untitled')
  loadProject(d.project, d.assets, null, d.trace)
  setCurrent(id)
  return id
}

export function duplicateProject(id: string): string | null {
  const d = loadProjectData(id)
  if (!d) return null
  saveCurrent()
  const copy: ProjectData = JSON.parse(JSON.stringify(d))
  copy.project.meta = { ...copy.project.meta, name: (copy.project.meta.name || 'untitled') + ' copy' }
  const nid = newId()
  writeData(nid, copy)
  upsertRecord(nid, copy.project.meta.name)
  return nid
}

export function renameProject(id: string, name: string): void {
  const list = readIndex().map((r) => (r.id === id ? { ...r, name } : r))
  writeIndex(list)
  const d = loadProjectData(id)
  if (d) {
    d.project.meta = { ...d.project.meta, name }
    writeData(id, d)
  }
}

/**
 * Patch the stored meta of any project (open or not) — used by the QA panel to
 * assign client / MIP to projects in the library without opening each one. For
 * the CURRENTLY-OPEN project prefer the store's patchMeta (keeps undo/in-memory
 * state correct); this writes straight to the persisted slot. The library index
 * (id/name/updatedAt) is untouched, so assigning a client doesn't reorder Home.
 * Mirrors renameProject above. Returns false if the project's data is missing.
 */
export function patchProjectMeta(id: string, patch: Partial<ProjectMeta>): boolean {
  const d = loadProjectData(id)
  if (!d) return false
  d.project.meta = { ...d.project.meta, ...patch }
  writeData(id, d)
  return true
}

export function deleteProject(id: string): void {
  writeIndex(readIndex().filter((r) => r.id !== id))
  try {
    localStorage.removeItem(DATA_PREFIX + id)
  } catch {
    /* */
  }
}

/** One-time migration of the old single-project autosave into the library. */
function migrateLegacy(): void {
  if (readIndex().length) return
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return
  try {
    const d = JSON.parse(raw) as ProjectData
    if (d?.project?.scenes) {
      const id = newId()
      writeData(id, d)
      upsertRecord(id, d.project.meta.name || 'untitled')
      localStorage.removeItem(LEGACY_KEY)
    }
  } catch {
    /* */
  }
}

/**
 * Resolve which project to open on boot: the last-open one, else the most recent,
 * else create a fresh blank project. Loads it into the store and returns its id.
 */
export function bootProjects(): string {
  migrateLegacy()

  // Self-heal: drop index records whose data slot is missing/corrupt (e.g. a
  // write that silently hit the localStorage quota). Otherwise an orphan record
  // could be selected below and crash boot.
  const index = readIndex()
  const valid = index.filter((r) => loadProjectData(r.id))
  if (valid.length !== index.length) writeIndex(valid)

  let lastId: string | null = null
  try {
    lastId = localStorage.getItem(LAST_KEY)
  } catch {
    /* */
  }

  // Try the last-open project first, then the most recent ones — but only ever
  // adopt one whose data actually loads.
  const candidates: string[] = []
  if (lastId) candidates.push(lastId)
  for (const r of listProjects()) if (!candidates.includes(r.id)) candidates.push(r.id)
  for (const id of candidates) {
    const d = loadProjectData(id)
    if (d) {
      loadProject(d.project, d.assets, null, d.trace)
      setCurrent(id)
      return id
    }
  }

  // nothing valid stored — the store already holds a starter; adopt it as project #1
  return createProject(blankProject())
}
