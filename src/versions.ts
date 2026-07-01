// Per-MIP version history + structural diff. A version snapshots the project
// DESIGN (scenes + meta) — not the asset bytes — so many snapshots stay tiny in
// localStorage; assets are shared and referenced by id (restore keeps the current
// library). The diff is a human-readable list of what changed between two
// projects, used by the History tab to review iterations and restore old ones.

import type { Project, SceneDef, SceneElement } from '../runtime/scene'

export interface VersionEntry {
  id: string
  label: string
  note?: string
  createdAt: number
  project: Project // structure only (assets stripped to keep snapshots small)
}

const KEY = (projectId: string): string => 'pa:ver:' + projectId
const CAP = 40

function read(projectId: string): VersionEntry[] {
  try {
    const raw = localStorage.getItem(KEY(projectId))
    const arr = raw ? (JSON.parse(raw) as VersionEntry[]) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
function write(projectId: string, list: VersionEntry[]): void {
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify(list))
  } catch {
    /* quota — drop the oldest and retry once */
    try {
      localStorage.setItem(KEY(projectId), JSON.stringify(list.slice(0, Math.max(1, Math.floor(list.length / 2)))))
    } catch {
      /* give up */
    }
  }
}

export function listVersions(projectId: string): VersionEntry[] {
  return read(projectId).sort((a, b) => b.createdAt - a.createdAt)
}

export function saveVersion(projectId: string, project: Project, label: string, note: string, at: number): VersionEntry {
  // strip variant metadata's nothing-to-strip; keep meta but it carries no asset bytes
  const entry: VersionEntry = {
    id: 'v' + at.toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    label: label.trim() || `v${read(projectId).length + 1}`,
    note: note.trim() || undefined,
    createdAt: at,
    project: structuredClone(project),
  }
  const list = [entry, ...read(projectId)].slice(0, CAP)
  write(projectId, list)
  return entry
}

export function deleteVersion(projectId: string, versionId: string): void {
  write(projectId, read(projectId).filter((v) => v.id !== versionId))
}

// ---- diff ------------------------------------------------------------------
export interface DiffLine {
  scope: 'meta' | 'scene' | 'element'
  kind: 'add' | 'remove' | 'change'
  text: string
}

const J = (v: unknown): string => JSON.stringify(v ?? null)

function elementChanges(a: SceneElement, b: SceneElement): string[] {
  const ch: string[] = []
  if (a.x !== b.x || a.y !== b.y) ch.push('moved')
  if (a.w !== b.w || a.h !== b.h || a.scale !== b.scale) ch.push('resized')
  if (a.zIndex !== b.zIndex) ch.push('reordered')
  if ((a.blur ?? 0) !== (b.blur ?? 0)) ch.push('blur')
  if (a.type !== b.type) ch.push(`type ${a.type}→${b.type}`)
  if (a.assetId !== b.assetId) ch.push('asset')
  if ((a.hidden ?? false) !== (b.hidden ?? false)) ch.push(b.hidden ? 'hidden' : 'shown')
  if (J(a.text) !== J(b.text)) ch.push('text')
  if (J(a.game) !== J(b.game)) ch.push('game')
  if (J(a.choice) !== J(b.choice)) ch.push('choice')
  if (J(a.handguide) !== J(b.handguide)) ch.push('handguide')
  if (J(a.container) !== J(b.container)) ch.push('container')
  if (J(a.drag) !== J(b.drag) || J(a.slot) !== J(b.slot)) ch.push('drag/slot')
  if (J(a.pick) !== J(b.pick) || J(a.fill) !== J(b.fill) || J(a.generate) !== J(b.generate)) ch.push('select/generate')
  if (J(a.sfx) !== J(b.sfx)) ch.push('sound')
  if (J({ box: a.box, cta: a.cta, animations: a.animations, endscene: a.endscene, countdown: a.countdown, bar: a.bar }) !== J({ box: b.box, cta: b.cta, animations: b.animations, endscene: b.endscene, countdown: b.countdown, bar: b.bar })) ch.push('style')
  return ch
}

function sceneDiff(a: SceneDef, b: SceneDef, out: DiffLine[]): void {
  if (a.name !== b.name) out.push({ scope: 'scene', kind: 'change', text: `Scene renamed “${a.name}” → “${b.name}”` })
  if (a.advance?.on !== b.advance?.on) out.push({ scope: 'scene', kind: 'change', text: `“${b.name}” advance: ${a.advance?.on} → ${b.advance?.on}` })
  if ((a.transition?.type ?? 'none') !== (b.transition?.type ?? 'none')) out.push({ scope: 'scene', kind: 'change', text: `“${b.name}” transition: ${a.transition?.type ?? 'none'} → ${b.transition?.type ?? 'none'}` })
  const am = new Map(a.elements.map((e) => [e.id, e]))
  const bm = new Map(b.elements.map((e) => [e.id, e]))
  for (const e of a.elements) if (!bm.has(e.id)) out.push({ scope: 'element', kind: 'remove', text: `“${b.name}” · removed ${e.type} “${e.name}”` })
  for (const e of b.elements) if (!am.has(e.id)) out.push({ scope: 'element', kind: 'add', text: `“${b.name}” · added ${e.type} “${e.name}”` })
  for (const e of b.elements) {
    const prev = am.get(e.id)
    if (!prev) continue
    const ch = elementChanges(prev, e)
    if (ch.length) out.push({ scope: 'element', kind: 'change', text: `“${b.name}” · “${e.name}”: ${ch.join(', ')}` })
  }
}

/** Human-readable structural diff a → b (old version → current). */
export function diffProjects(a: Project, b: Project): DiffLine[] {
  const out: DiffLine[] = []
  const ma = a.meta
  const mb = b.meta
  if (ma.name !== mb.name) out.push({ scope: 'meta', kind: 'change', text: `Name: “${ma.name}” → “${mb.name}”` })
  if (ma.baseW !== mb.baseW || ma.baseH !== mb.baseH) out.push({ scope: 'meta', kind: 'change', text: `Canvas: ${ma.baseW}×${ma.baseH} → ${mb.baseW}×${mb.baseH}` })
  if ((ma.client ?? '') !== (mb.client ?? '')) out.push({ scope: 'meta', kind: 'change', text: `Client: “${ma.client ?? '-'}” → “${mb.client ?? '-'}”` })
  if ((ma.mip ?? '') !== (mb.mip ?? '')) out.push({ scope: 'meta', kind: 'change', text: `MIP: “${ma.mip ?? '-'}” → “${mb.mip ?? '-'}”` })
  if ((ma.locales ?? []).join(',') !== (mb.locales ?? []).join(',')) out.push({ scope: 'meta', kind: 'change', text: `Languages: [${(ma.locales ?? []).join(', ')}] → [${(mb.locales ?? []).join(', ')}]` })
  if ((ma.variants?.length ?? 0) !== (mb.variants?.length ?? 0)) out.push({ scope: 'meta', kind: 'change', text: `Variants: ${ma.variants?.length ?? 0} → ${mb.variants?.length ?? 0}` })
  if (J(a.sfx) !== J(b.sfx) || J(a.bgm) !== J(b.bgm)) out.push({ scope: 'meta', kind: 'change', text: 'Sound (events / music) changed' })

  const am = new Map(a.scenes.map((s) => [s.id, s]))
  const bm = new Map(b.scenes.map((s) => [s.id, s]))
  for (const s of a.scenes) if (!bm.has(s.id)) out.push({ scope: 'scene', kind: 'remove', text: `Removed scene “${s.name}”` })
  for (const s of b.scenes) if (!am.has(s.id)) out.push({ scope: 'scene', kind: 'add', text: `Added scene “${s.name}” (${s.elements.length} elements)` })
  for (const s of b.scenes) {
    const prev = am.get(s.id)
    if (prev) sceneDiff(prev, s, out)
  }
  return out
}
