// IndexedDB store for asset BYTES (the data-URL `src` of each AssetEntry), keyed
// by `${projectId}/${assetId}`. This keeps large media out of localStorage (~5MB
// per-origin cap) — the project JSON in localStorage then carries only asset
// metadata (w/h/kind/compress) + ids, and bytes are rehydrated on open.
//
// Falls back to a no-op when IndexedDB is unavailable (private mode / old
// embeddings); callers detect this via `idbAvailable()` and keep bytes inline in
// the project JSON, i.e. exactly today's behavior.

const DB_NAME = 'pa-assets'
const STORE = 'assets'

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

// One `indexedDB.open` at a fixed version, resolving null on any failure.
function rawOpen(version?: number): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      // `blocked` fires neither success nor error — without this the promise (and
      // every caller awaiting it, including boot's rehydrate) would hang forever.
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

let dbp: Promise<IDBDatabase | null> | null = null
function openDb(): Promise<IDBDatabase | null> {
  if (dbp) return dbp
  const p: Promise<IDBDatabase | null> = (async () => {
    if (!idbAvailable()) return null
    // Open at whatever version exists (no version arg) so we never *downgrade* —
    // opening at 1 against a higher-versioned DB errors outright.
    const db = await rawOpen()
    if (!db || db.objectStoreNames.contains(STORE)) return db
    // The database exists but has no object store: an upgrade that was interrupted
    // (tab closed mid-`onupgradeneeded`, an aborted upgrade transaction) leaves this
    // behind, and it is silently fatal — `open` succeeds, so nothing reports an
    // error, but every transaction throws NotFoundError, so reads return nothing
    // and writes report failure forever. Repair it by reopening one version higher,
    // which is the only way to get an upgrade transaction and create the store.
    const version = db.version + 1
    db.close()
    return rawOpen(version)
  })()
  dbp = p
  // Never cache a failure: a transient open error (another tab upgrading, a
  // storage hiccup) would otherwise disable the byte store for the whole session
  // and every save would fall back to inline bytes against the 5MB cap.
  void p.then((db) => {
    if (!db && dbp === p) dbp = null
  })
  return p
}

const keyFor = (projectId: string, assetId: string): string => `${projectId}/${assetId}`

/** Persist bytes for the given assets (only the ones passed — never clears others). */
export async function putAssetBytes(projectId: string, bytes: Record<string, string>): Promise<boolean> {
  const ids = Object.keys(bytes)
  if (!ids.length) return true
  const db = await openDb()
  if (!db) return false
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, 'readwrite')
      const s = t.objectStore(STORE)
      for (const aid of ids) s.put(bytes[aid], keyFor(projectId, aid))
      t.oncomplete = () => resolve(true)
      t.onerror = () => resolve(false)
      t.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

/** Read bytes for the given asset ids; missing ones are simply omitted. */
export async function getAssetBytes(projectId: string, assetIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!assetIds.length) return out
  const db = await openDb()
  if (!db) return out
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, 'readonly')
      const s = t.objectStore(STORE)
      let pending = assetIds.length
      for (const aid of assetIds) {
        const r = s.get(keyFor(projectId, aid))
        r.onsuccess = () => {
          if (typeof r.result === 'string') out[aid] = r.result
          if (--pending === 0) resolve(out)
        }
        r.onerror = () => {
          if (--pending === 0) resolve(out)
        }
      }
    } catch {
      resolve(out)
    }
  })
}

/** Dump EVERY stored asset blob as { '<projectId>/<assetId>': dataUrl }, for a
 * full local backup. Empty when IndexedDB is unavailable (bytes then live inline
 * in the project JSON and are captured by the localStorage side of the backup). */
export async function dumpAllAssetBytes(): Promise<Record<string, string>> {
  const db = await openDb()
  if (!db) return {}
  return new Promise((resolve) => {
    const out: Record<string, string> = {}
    try {
      const t = db.transaction(STORE, 'readonly')
      const cur = t.objectStore(STORE).openCursor()
      cur.onsuccess = () => {
        const c = cur.result
        if (c) {
          if (typeof c.value === 'string') out[String(c.key)] = c.value
          c.continue()
        }
      }
      t.oncomplete = () => resolve(out)
      t.onerror = () => resolve(out)
      t.onabort = () => resolve(out)
    } catch {
      resolve(out)
    }
  })
}

/** Write raw '<projectId>/<assetId>' -> dataUrl entries straight back (restore). */
export async function restoreAssetBytes(entries: Record<string, string>): Promise<boolean> {
  const keys = Object.keys(entries)
  if (!keys.length) return true
  const db = await openDb()
  if (!db) return false
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, 'readwrite')
      const s = t.objectStore(STORE)
      for (const k of keys) s.put(entries[k], k)
      t.oncomplete = () => resolve(true)
      t.onerror = () => resolve(false)
      t.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

/** Copy all of one project's asset bytes under a new project id (for duplicate). */
export async function copyProjectAssets(fromId: string, toId: string, assetIds: string[]): Promise<void> {
  const bytes = await getAssetBytes(fromId, assetIds)
  const remapped: Record<string, string> = {}
  for (const aid of assetIds) if (bytes[aid] != null) remapped[aid] = bytes[aid]
  await putAssetBytes(toId, remapped)
}

/** Drop every asset blob belonging to a project (on delete). */
export async function deleteProjectAssets(projectId: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, 'readwrite')
      const s = t.objectStore(STORE)
      const range = IDBKeyRange.bound(`${projectId}/`, `${projectId}/￿`)
      const cur = s.openCursor(range)
      cur.onsuccess = () => {
        const c = cur.result
        if (c) {
          c.delete()
          c.continue()
        }
      }
      t.oncomplete = () => resolve()
      t.onerror = () => resolve()
      t.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}
