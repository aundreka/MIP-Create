// Project groups — the layer ABOVE a MIP. In this codebase a `Project` (meta +
// scenes, one library entry) is really ONE MIP; a real-world "project" (brand +
// date + theme, e.g. "Bioma 2026-07 Scratch") groups several MIPs together so you
// can switch between them and share elements across them (see the shared-element
// registry below, used by the "Sync to project" feature).
//
// A group is a small record in localStorage (`pa:groups`). A MIP joins a group by
// carrying the group id on its meta (`ProjectMeta.projectId`); this module never
// imports projects.ts (which owns the MIP index) to stay dependency-free.

import type { SceneElement } from '../runtime/scene'
import type { AssetEntry, AssetMap } from '../runtime/types'
import { getAssetBytes, idbAvailable, putAssetBytes } from './assetStore'

export interface ProjectGroup {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

// One project-shared element (the "Sync to project" registry). `el` is the
// canonical element props (no id, no sync marker); `assetMeta` carries the
// referenced assets' metadata (bytes live in IDB under `group:<groupId>` so the
// localStorage record stays small — matching how MIP assets are split).
export interface SharedElement {
  key: string
  scope: 'scene' | 'all'
  el: Partial<SceneElement>
  assetMeta: Record<string, AssetEntry>
  updatedAt: number
}

const GROUPS_KEY = 'pa:groups'
const SHARED_PREFIX = 'pa:group:' // pa:group:<id>:shared
const sharedLsKey = (groupId: string): string => SHARED_PREFIX + groupId + ':shared'
const assetScope = (groupId: string): string => 'group:' + groupId

function nowTs(): number {
  return Date.now()
}
export function newGroupId(): string {
  return 'g' + nowTs().toString(36) + Math.floor(Math.random() * 1e6).toString(36)
}

function readGroups(): ProjectGroup[] {
  try {
    const raw = localStorage.getItem(GROUPS_KEY)
    const arr = raw ? (JSON.parse(raw) as ProjectGroup[]) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
function writeGroups(list: ProjectGroup[]): void {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(list))
  } catch {
    /* quota */
  }
}

export function listGroups(): ProjectGroup[] {
  return readGroups().sort((a, b) => b.updatedAt - a.updatedAt)
}
export function getGroup(id: string | undefined | null): ProjectGroup | null {
  if (!id) return null
  return readGroups().find((g) => g.id === id) ?? null
}

export function createGroup(name: string): ProjectGroup {
  const g: ProjectGroup = { id: newGroupId(), name: name.trim() || 'Untitled project', createdAt: nowTs(), updatedAt: nowTs() }
  writeGroups([...readGroups(), g])
  return g
}

export function renameGroup(id: string, name: string): void {
  writeGroups(readGroups().map((g) => (g.id === id ? { ...g, name: name.trim() || g.name, updatedAt: nowTs() } : g)))
}

/** Bump a group's updatedAt (e.g. when a member MIP or a shared element changes). */
export function touchGroup(id: string): void {
  writeGroups(readGroups().map((g) => (g.id === id ? { ...g, updatedAt: nowTs() } : g)))
}

/**
 * Resolve a group by exact (case-insensitive) name, creating it if none exists.
 * Used when the user types a project name in Project Settings: typing an existing
 * name joins that project; a new name starts a new one.
 */
export function ensureGroupByName(name: string): ProjectGroup {
  const trimmed = name.trim()
  if (!trimmed) return createGroup('')
  const existing = readGroups().find((g) => g.name.toLowerCase() === trimmed.toLowerCase())
  return existing ?? createGroup(trimmed)
}

// ---- shared-element registry ("Sync to project") --------------------------

// Asset ids one element references (mirrors store.elementAssetIds / export's walk),
// kept here so this module has no store dependency.
function referencedAssetIds(el: Partial<SceneElement>): string[] {
  const ids: (string | undefined)[] = [el.assetId, el.container?.imageId, el.generate?.resultId, el.button?.tapFadeAssetId]
  const nestedStrings = (value: unknown, seen = new Set<unknown>()): void => {
    if (typeof value === 'string') { ids.push(value); return }
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) value.forEach((item) => nestedStrings(item, seen))
    else Object.values(value as Record<string, unknown>).forEach((item) => nestedStrings(item, seen))
  }
  for (const override of Object.values(el.localeOverrides ?? {})) {
    ids.push(override.assetId)
    nestedStrings(override.source)
  }
  if (el.sfx) for (const b of el.sfx) ids.push(b.assetId)
  if (el.game?.params) for (const v of Object.values(el.game.params)) (Array.isArray(v) ? ids.push(...(v as string[])) : ids.push(v as string))
  if (el.endscene) ids.push(el.endscene.portraitVideoId, el.endscene.landscapeVideoId, el.endscene.portraitImageId, el.endscene.landscapeImageId)
  return [...new Set(ids.filter((x): x is string => typeof x === 'string'))]
}

export function readShared(groupId: string): Record<string, SharedElement> {
  try {
    const raw = localStorage.getItem(sharedLsKey(groupId))
    const obj = raw ? (JSON.parse(raw) as Record<string, SharedElement>) : {}
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}
function writeShared(groupId: string, map: Record<string, SharedElement>): void {
  try {
    localStorage.setItem(sharedLsKey(groupId), JSON.stringify(map))
  } catch {
    /* quota — should be rare, bytes are in IDB */
  }
}

/**
 * Write (upsert) the canonical props of a synced element to the group registry.
 * `el` is a live SceneElement (id + sync stripped here); its referenced asset bytes
 * are pushed to IDB (or inlined into the record when IDB is absent).
 */
export async function putSharedElement(groupId: string, el: SceneElement, assets: AssetMap): Promise<void> {
  if (!el.sync) return
  const key = el.sync.key
  const scope = el.sync.scope
  const rest = { ...el } as Partial<SceneElement>
  delete rest.id
  delete rest.sync
  const assetMeta: Record<string, AssetEntry> = {}
  const bytes: Record<string, string> = {}
  for (const aid of referencedAssetIds(el)) {
    const a = assets[aid]
    if (!a) continue
    if (idbAvailable()) {
      assetMeta[aid] = { ...a, src: '' }
      if (a.src) bytes[aid] = a.src
    } else {
      assetMeta[aid] = { ...a } // no IDB: keep bytes inline
    }
  }
  const map = readShared(groupId)
  map[key] = { key, scope, el: rest, assetMeta, updatedAt: nowTs() }
  writeShared(groupId, map)
  touchGroup(groupId)
  const ids = Object.keys(bytes)
  if (ids.length) await putAssetBytes(assetScope(groupId), bytes)
}

export function deleteSharedElement(groupId: string, key: string): void {
  const map = readShared(groupId)
  if (!(key in map)) return
  delete map[key]
  writeShared(groupId, map)
  touchGroup(groupId)
}

/** Rehydrate a shared element's referenced assets (bytes from IDB) into an AssetMap. */
export async function sharedElementAssets(groupId: string, entry: SharedElement): Promise<AssetMap> {
  const out: AssetMap = {}
  const missing: string[] = []
  for (const [aid, a] of Object.entries(entry.assetMeta)) {
    if (a.src) out[aid] = a
    else missing.push(aid)
  }
  if (missing.length && idbAvailable()) {
    const bytes = await getAssetBytes(assetScope(groupId), missing)
    for (const aid of missing) if (bytes[aid] != null) out[aid] = { ...entry.assetMeta[aid], src: bytes[aid] }
  }
  return out
}
