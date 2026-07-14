// Canonical MIP naming. A MIP's name is always "<Client> <MIP> <Date>", e.g.
// "Blackgirl Vitamins MIP2 2026-07-01". That same name is what the export writes
// as the file name, so identity stays consistent across the editor, the team
// library and the delivered file. The date is fixed per-MIP (set once, then
// editable in Project settings) — it does not silently change day-to-day.

import type { ProjectMeta } from '../runtime/scene'

/** Today as an ISO date label (YYYY-MM-DD), in local time. */
export function todayLabel(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * The canonical MIP name: Client + MIP + Date, space-joined. Empty parts are
 * skipped so a half-filled MIP still gets a sensible name; when no identity is
 * set at all it falls back to the existing free-text name (or 'Untitled').
 */
export function mipName(meta: Pick<ProjectMeta, 'client' | 'mip' | 'mipDate' | 'name'>): string {
  const parts = [meta.client, meta.mip, meta.mipDate].map((s) => (s ?? '').trim()).filter(Boolean)
  return parts.join(' ') || (meta.name ?? '').trim() || 'Untitled'
}

/**
 * Return `meta` with the canonical name applied: fills a default date (today) the
 * first time the MIP has a client or MIP id, then keeps `meta.name` equal to
 * mipName(). Call this from every meta writer so the name is always in step.
 */
export function syncMipName(meta: ProjectMeta): ProjectMeta {
  const hasIdentity = (meta.client ?? '').trim() !== '' || (meta.mip ?? '').trim() !== ''
  let m = meta
  if (hasIdentity && (meta.mipDate ?? '').trim() === '') m = { ...m, mipDate: todayLabel() }
  const name = mipName(m)
  return name === m.name ? m : { ...m, name }
}

/**
 * The export file's base name: "<Client>_<MIP>" only — no date, no free-text
 * name. Falls back to the canonical mipName() when client/MIP aren't set.
 */
export function fileBaseName(meta: Pick<ProjectMeta, 'client' | 'mip' | 'mipDate' | 'name'>): string {
  const client = (meta.client ?? '').trim()
  const mip = (meta.mip ?? '').trim()
  const base = [client, mip].filter(Boolean).join('_') || mipName(meta)
  return base.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'playable'
}
