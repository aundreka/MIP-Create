// Full local backup / restore. The whole editor lives in localStorage (every key is
// 'pa:'-prefixed) plus the 'pa-assets' IndexedDB store (media bytes). This dumps all
// of it to one self-contained JSON file — projects, MIPs, project groups, versions,
// brand kit, devices, settings and all media — and loads it back. No account or
// cloud needed; it works fully offline and across machines.

import { dumpAllAssetBytes, restoreAssetBytes } from './assetStore'
import { todayLabel } from './mipName'

const LS_PREFIX = 'pa:'
const FORMAT = 'hpl-editor-backup'
const VERSION = 1
// Merged (not overwritten) on restore so a backup ADDS to the current library
// instead of replacing it: the project index and the project-group list.
const INDEX_KEY = 'pa:projects'
const GROUPS_KEY = 'pa:groups'

interface Backup {
  format: string
  version: number
  exportedAt: number
  local: Record<string, string> // every pa:* localStorage entry (project JSON, groups, versions, settings)
  assets: Record<string, string> // '<projectId>/<assetId>' -> data URL (IndexedDB media bytes)
}

/** Snapshot every pa:* localStorage entry + all IndexedDB media into one Blob. */
export async function exportAllData(): Promise<Blob> {
  const local: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(LS_PREFIX)) {
      const v = localStorage.getItem(k)
      if (v != null) local[k] = v
    }
  }
  const assets = await dumpAllAssetBytes()
  const backup: Backup = { format: FORMAT, version: VERSION, exportedAt: Date.now(), local, assets }
  return new Blob([JSON.stringify(backup)], { type: 'application/json' })
}

/** A dated backup filename, e.g. "hpl-editor-backup-2026-07-02.json". */
export function backupFilename(): string {
  return `hpl-editor-backup-${todayLabel()}.json`
}

/** Validate a backup file and report how many projects it holds, WITHOUT writing. */
export function readBackupInfo(json: string): { projects: number; exportedAt: number } {
  let backup: Backup
  try {
    backup = JSON.parse(json) as Backup
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (!backup || backup.format !== FORMAT || !backup.local) {
    throw new Error('That is not an HPL editor backup file.')
  }
  return { projects: parseList(backup.local[INDEX_KEY]).length, exportedAt: backup.exportedAt || 0 }
}

// Union two id-keyed lists, backup entries winning on a duplicate id, so restore
// keeps the current library's projects/groups AND adds the backed-up ones.
function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>()
  for (const it of current) if (it && it.id) byId.set(it.id, it)
  for (const it of incoming) if (it && it.id) byId.set(it.id, it)
  return [...byId.values()]
}

function parseList<T>(raw: string | null | undefined): T[] {
  try {
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

/**
 * Restore a backup file into this library. Everything is written back; the project
 * index and group list are MERGED (backup wins per id) so existing projects survive.
 * Returns how many projects the backup contained. Caller should reload afterwards so
 * the in-memory store re-boots from the restored storage.
 */
export async function importAllData(json: string): Promise<{ projects: number }> {
  let backup: Backup
  try {
    backup = JSON.parse(json) as Backup
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (!backup || backup.format !== FORMAT || !backup.local || typeof backup.local !== 'object') {
    throw new Error('That is not an HPL editor backup file.')
  }

  // Snapshot the current index/group lists before the write so we can merge, not clobber.
  const curIndex = parseList<{ id: string }>(localStorage.getItem(INDEX_KEY))
  const curGroups = parseList<{ id: string }>(localStorage.getItem(GROUPS_KEY))

  for (const [k, v] of Object.entries(backup.local)) {
    if (k.startsWith(LS_PREFIX)) localStorage.setItem(k, v)
  }
  await restoreAssetBytes(backup.assets ?? {})

  const bkIndex = parseList<{ id: string }>(backup.local[INDEX_KEY])
  const bkGroups = parseList<{ id: string }>(backup.local[GROUPS_KEY])
  localStorage.setItem(INDEX_KEY, JSON.stringify(mergeById(curIndex, bkIndex)))
  localStorage.setItem(GROUPS_KEY, JSON.stringify(mergeById(curGroups, bkGroups)))

  return { projects: bkIndex.length }
}
