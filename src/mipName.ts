// Canonical MIP naming. A MIP's name is always "<Client> <MIP> <Date>", e.g.
// "Blackgirl Vitamins MIP2 2026-07-01". The export filename uses its own
// delivery-oriented format, but the human-readable MIP identity stays consistent
// across the editor and the team library. The date is fixed per-MIP (set once,
// then editable in Project settings) - it does not silently change day-to-day.

import type { Project, ProjectMeta } from '../runtime/scene'

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

function slugToken(value: string | undefined, fallback: string): string {
  const safe = (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return safe || fallback
}

function compactDateToken(value: string | undefined): string {
  const digits = (value ?? '').replace(/\D+/g, '')
  if (digits.length >= 8) return digits.slice(0, 8)
  return todayLabel().replace(/\D+/g, '')
}

function mipVersionToken(meta: Pick<ProjectMeta, 'mip'>): string {
  const raw = (meta.mip ?? '').trim()
  const digits = raw.match(/\d+/g)?.join('') ?? ''
  return digits ? digits.padStart(2, '0') : '00'
}

function firstGameTemplateId(project: Pick<Project, 'scenes'>): string | undefined {
  for (const scene of project.scenes) {
    for (const el of scene.elements) {
      if (el.type === 'game-mount' && el.game?.templateId) return el.game.templateId
    }
  }
  return undefined
}

// The mechanic slot. A MIP with no game mount has no mechanic to name, so it
// ships as the literal "unknown" rather than a plausible-looking guess.
function exportMechanicToken(project: Pick<Project, 'scenes'>): string {
  const templateId = firstGameTemplateId(project)
  if (!templateId) return 'unknown'
  const aliases: Record<string, string> = {
    scratch: 'scratch',
    scratch_grid: 'scratch',
    match3: 'match3',
    match_3: 'match3',
    'match-three': 'match3',
  }
  return aliases[templateId] ?? slugToken(templateId, 'game')
}

/**
 * A SIP is a build made of ONE scene that is an end card - no game, no flow,
 * just the product surface. It is delivered under its own name (see
 * fileBaseName), so this is the single test both the name and the UI use.
 */
export function isSip(project: Pick<Project, 'scenes'>): boolean {
  if (project.scenes.length !== 1) return false
  const scene = project.scenes[0]
  return scene.kind === 'endscene' || (scene.kind === 'overlay' && scene.asEndscene === true)
}

/**
 * The export file base name. Format:
 * "<client>_acslanot_mip_<date>_<version>_emily_game_<mechanic>_human_<unique>"
 * where `<mechanic>` is "unknown" when the MIP has no game mount, and
 * `<unique>` is "unique" unless Project settings marks the MIP non-unique
 * ("none").
 *
 * A SIP (one scene, and that scene is an end card - see isSip) swaps the two
 * type slots instead: "..._acslanot_sip_..._emily_product_<format>_human_..."
 * where `<format>` is "carousel" (the default) or "card", per meta.sipFormat.
 */
export function fileBaseName(project: Pick<Project, 'meta' | 'scenes'>): string {
  const meta = project.meta
  const client = slugToken(meta.client, 'client')
  const date = compactDateToken(meta.exportDate || meta.mipDate)
  const version = mipVersionToken(meta)
  const unique = meta.unique === false ? 'none' : 'unique'
  const sip = isSip(project)
  const type = sip ? 'sip' : 'mip'
  const kind = sip ? `product_${meta.sipFormat === 'card' ? 'card' : 'carousel'}` : `game_${exportMechanicToken(project)}`
  return `${client}_acslanot_${type}_${date}_${version}_emily_${kind}_human_${unique}`
}
