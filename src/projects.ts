// Project library — lets the editor hold MANY playables (browser mode), backed by
// localStorage. An index (pa:projects) lists records; each project's data lives at
// pa:proj:<id>. The "current" project id is remembered (pa:lastProject) so a
// reload reopens it. Switching always persists the project being left first.

import type { Project, ProjectMeta, SceneElement } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import type { ProjectData } from './bridge'
import { blankProject, flushSharedToRegistry, getState, loadProject, type TraceState } from './store'
import { deleteProjectAssets, getAssetBytes, idbAvailable, putAssetBytes } from './assetStore'
import { readShared, sharedElementAssets } from './projectGroups'
import { syncMipName } from './mipName'

export interface ProjectRecord {
  id: string
  name: string
  updatedAt: number
  // Denormalized project-group membership (see src/projectGroups.ts) so Home and
  // the top-bar switcher can group MIPs without loading each project's data.
  projectId?: string
  projectName?: string
}

const INDEX_KEY = 'pa:projects'
const DATA_PREFIX = 'pa:proj:'
const LAST_KEY = 'pa:lastProject'
const LEGACY_KEY = 'pa:project'

let currentId: string | null = null

// Asset-byte keys (`${projectId}/${assetId}`) already flushed to IndexedDB this
// session, so the debounced autosave doesn't re-write unchanged media every save.
// Safe because an asset id's `src` is immutable once created (new media → new id).
const flushed = new Set<string>()

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

function writeSlot(id: string, bundle: ProjectData): void {
  try {
    localStorage.setItem(DATA_PREFIX + id, JSON.stringify(bundle))
  } catch {
    /* quota — should be rare now that bytes live in IDB */
  }
}

// Persist a project. With IndexedDB, asset BYTES go to IDB and only metadata
// (w/h/kind/compress, empty src) lands in localStorage — so media-heavy MIPs no
// longer overflow the ~5MB cap. Without IDB, bytes stay inline (today's behavior).
// Only assets WITH a src are written (so re-saving a metadata-only bundle, e.g. a
// rename, never clobbers existing bytes).
//
// WRITE-AHEAD ORDER MATTERS. The stripped bundle (src: '') may only be stored once
// the bytes are CONFIRMED in IDB — otherwise a refused write (quota, a transaction
// abort, a browser blocking site data) erases the sole remaining copy: localStorage
// no longer has it, IDB never got it, and `flushed` would mark it done so no later
// save retries. That silently blanks every image in the project on the next open.
// So: flush to IDB first, and if it refuses, keep the bytes inline in localStorage
// exactly as the no-IDB fallback does.
async function writeData(id: string, data: ProjectData): Promise<void> {
  if (!idbAvailable()) {
    writeSlot(id, data) // no IDB — bytes stay inline
    return
  }
  const meta: AssetMap = {}
  const bytes: Record<string, string> = {}
  for (const [aid, a] of Object.entries(data.assets)) {
    meta[aid] = { ...a, src: '' }
    if (a.src && !flushed.has(id + '/' + aid)) bytes[aid] = a.src // only bytes not already in IDB
  }
  const stripped: ProjectData = { project: data.project, assets: meta, trace: data.trace }
  const ids = Object.keys(bytes)
  // Nothing new to flush: every src is either empty or already confirmed in IDB,
  // so the stripped bundle is safe to store right away (the common autosave).
  if (!ids.length) {
    writeSlot(id, stripped)
    return
  }
  if (await putAssetBytes(id, bytes)) {
    for (const aid of ids) flushed.add(id + '/' + aid)
    writeSlot(id, stripped)
    return
  }
  console.warn(`[projects] IndexedDB refused ${ids.length} asset(s) for ${id}; keeping bytes inline in localStorage`)
  writeSlot(id, data)
}

// Fill in any asset `src` that lives in IndexedDB (empty src in the stored bundle).
// An id the store cannot return is an asset that will render as a blank box, so say
// so loudly — silently handing back `src: ''` is what made this class of bug so hard
// to see. Anything still missing stays unflushed, so the next save re-attempts it.
async function rehydrate(id: string, assets: AssetMap): Promise<AssetMap> {
  const missing = Object.entries(assets)
    .filter(([, a]) => !a.src)
    .map(([aid]) => aid)
  if (!missing.length) return assets
  const bytes = await getAssetBytes(id, missing)
  for (const aid of Object.keys(bytes)) flushed.add(id + '/' + aid) // confirmed present in IDB
  const lost = missing.filter((aid) => bytes[aid] == null)
  if (lost.length) console.warn(`[projects] ${lost.length}/${missing.length} asset(s) have no bytes in IndexedDB for ${id}:`, lost)
  const out: AssetMap = {}
  for (const [aid, a] of Object.entries(assets)) out[aid] = a.src ? a : bytes[aid] != null ? { ...a, src: bytes[aid] } : a
  return out
}

function upsertRecord(id: string, name: string, meta?: ProjectMeta): void {
  const list = readIndex().filter((r) => r.id !== id)
  const rec: ProjectRecord = { id, name, updatedAt: now() }
  if (meta?.projectId) rec.projectId = meta.projectId
  if (meta?.projectName) rec.projectName = meta.projectName
  list.push(rec)
  writeIndex(list)
}

/** MIPs that belong to a given project group (most-recent first). */
export function projectsInGroup(groupId: string): ProjectRecord[] {
  return listProjects().filter((r) => r.projectId === groupId)
}

/**
 * Reconcile a MIP's project-shared ("Sync to project") elements against the group
 * registry before it loads: refresh every existing synced element from the shared
 * definition, materialize any that are missing (scope 'all' → one per scene; scope
 * 'scene' → one on the start scene), and merge in the referenced assets. Mutates
 * `project`/`assets` in place. No-op for MIPs not in a project group.
 */
async function reconcileShared(project: Project, assets: AssetMap): Promise<void> {
  const gid = project.meta.projectId
  if (!gid) return
  const shared = readShared(gid)
  const keys = Object.keys(shared)
  if (!keys.length) return
  for (const key of keys) {
    const entry = shared[key]
    const canon = entry.el
    const sa = await sharedElementAssets(gid, entry)
    for (const [aid, a] of Object.entries(sa)) if (!assets[aid]?.src) assets[aid] = a
    let found = false
    for (const sd of project.scenes) {
      sd.elements = sd.elements.map((e) => {
        if (e.sync?.key !== key) return e
        found = true
        return { ...canon, id: e.id, sync: { key, scope: entry.scope } } as SceneElement
      })
    }
    if (entry.scope === 'all') {
      for (const sd of project.scenes) {
        if (sd.elements.some((e) => e.sync?.key === key)) continue
        sd.elements.push({ ...canon, id: `sync_${key}_${sd.id}`, sync: { key, scope: 'all' } } as SceneElement)
        found = true
      }
    } else if (!found) {
      const sd = project.scenes.find((s) => s.id === project.startSceneId) ?? project.scenes[0]
      if (sd) sd.elements.push({ ...canon, id: `sync_${key}_${sd.id}`, sync: { key, scope: 'scene' } } as SceneElement)
    }
  }
}

/** Persist the project currently open in the editor to its slot. Resolves once the
 * asset bytes are flushed (localStorage metadata is written synchronously). */
export function saveCurrent(): Promise<void> {
  if (!currentId) return Promise.resolve()
  flushSharedToRegistry() // backstop: mirror any synced elements to the group registry
  const s = getState()
  const done = writeData(currentId, { project: s.project, assets: s.assets, trace: s.trace })
  upsertRecord(currentId, s.project.meta.name || 'untitled', s.project.meta)
  return done
}

/** Open an existing project (persists the one being left first). */
export async function openProject(id: string): Promise<boolean> {
  const d = loadProjectData(id)
  if (!d) return false
  await saveCurrent()
  const assets = await rehydrate(id, d.assets)
  await reconcileShared(d.project, assets)
  loadProject(d.project, assets, null, d.trace)
  setCurrent(id)
  return true
}

/** Create a new project from the given data (or a blank one) and switch to it. */
export async function createProject(data?: { project: Project; assets: AssetMap; trace?: TraceState }): Promise<string> {
  await saveCurrent()
  const d = data ?? blankProject()
  const id = newId()
  loadProject(d.project, d.assets, null, d.trace) // show it immediately
  setCurrent(id)
  await writeData(id, { project: d.project, assets: d.assets, trace: d.trace })
  upsertRecord(id, d.project.meta.name || 'untitled', d.project.meta)
  return id
}

/**
 * Import a MIP pulled from the team server into the local library under a SPECIFIC
 * id (the cloud project id == local id, so a re-publish maps back to the same row)
 * and open it. Overwrites the local slot if it already exists. Persists the
 * project being left first. Used by the Team panel's "Open".
 */
export async function importProjectData(id: string, data: ProjectData): Promise<void> {
  await saveCurrent()
  loadProject(data.project, data.assets, null, data.trace) // data carries src (team pull)
  setCurrent(id)
  await writeData(id, data)
  upsertRecord(id, data.project.meta.name || 'untitled', data.project.meta)
}

export async function duplicateProject(id: string): Promise<string | null> {
  const d = loadProjectData(id)
  if (!d) return null
  await saveCurrent()
  // Copy the source's bytes under the new id (rehydrate then re-split via writeData).
  const assets = await rehydrate(id, d.assets)
  const copy: ProjectData = { project: JSON.parse(JSON.stringify(d.project)), assets, trace: d.trace }
  copy.project.meta = { ...copy.project.meta, name: (copy.project.meta.name || 'untitled') + ' copy' }
  const nid = newId()
  await writeData(nid, copy)
  upsertRecord(nid, copy.project.meta.name, copy.project.meta)
  return nid
}

export function renameProject(id: string, name: string): void {
  const list = readIndex().map((r) => (r.id === id ? { ...r, name } : r))
  writeIndex(list)
  const d = loadProjectData(id)
  if (d) {
    d.project.meta = { ...d.project.meta, name }
    void writeData(id, d) // metadata-only re-save; leaves IDB bytes intact
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
  d.project.meta = syncMipName({ ...d.project.meta, ...patch })
  void writeData(id, d) // metadata-only re-save; leaves IDB bytes intact
  // Keep the library index label in step with the canonical MIP name. Only the
  // name is touched (not updatedAt), so assigning client/MIP doesn't reorder Home.
  writeIndex(readIndex().map((r) => (r.id === id ? { ...r, name: d.project.meta.name } : r)))
  return true
}

/** Load a project with its asset bytes rehydrated from IDB — for thumbnail rendering. */
export async function loadProjectPreview(id: string): Promise<ProjectData | null> {
  const d = loadProjectData(id)
  if (!d) return null
  const assets = await rehydrate(id, d.assets)
  return { project: d.project, assets, trace: d.trace }
}

export function deleteProject(id: string): void {
  writeIndex(readIndex().filter((r) => r.id !== id))
  try {
    localStorage.removeItem(DATA_PREFIX + id)
  } catch {
    /* */
  }
  void deleteProjectAssets(id) // drop the project's bytes from IndexedDB
  for (const k of [...flushed]) if (k.startsWith(id + '/')) flushed.delete(k)
}

/** One-time migration of the old single-project autosave into the library. */
async function migrateLegacy(): Promise<void> {
  if (readIndex().length) return
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return
  try {
    const d = JSON.parse(raw) as ProjectData
    if (d?.project?.scenes) {
      const id = newId()
      await writeData(id, d) // await so the bytes are in IDB before boot rehydrates
      upsertRecord(id, d.project.meta.name || 'untitled', d.project.meta)
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
export async function bootProjects(): Promise<string> {
  await migrateLegacy()

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
      const assets = await rehydrate(id, d.assets)
      await reconcileShared(d.project, assets)
      loadProject(d.project, assets, null, d.trace)
      setCurrent(id)
      return id
    }
  }

  // nothing valid stored — the store already holds a starter; adopt it as project #1
  return createProject(blankProject())
}
