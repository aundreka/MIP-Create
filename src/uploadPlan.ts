// The upload plan: every file one batch COULD send (each MIP, its variants and
// its SIP), and which of them are ticked. The Upload modal shows this as a
// checklist so a single AppLovin batch can mix and match — "mip1, sip1, mip2"
// with no sip2 — and the ticks are remembered per batch.
//
// Pure: it reads nothing but the projects handed to it, so the modal can feed it
// the open playable from the store or saved ones from the library.

import type { Project } from '../runtime/scene'
import { fileBaseName } from './mipName'
import { buildSipProject } from './sip'
import { variantSlug } from './deliver'

/** One playable the batch can draw files from. */
export interface PlanSource {
  /** Project library id, or 'current' for the open (possibly unsaved) playable. */
  id: string
  name: string
  project: Project
}

export interface PlanItem {
  /** Stable tick key, e.g. "p123|mip", "p123|v|v1", "p123|sip". */
  key: string
  kind: 'mip' | 'variant' | 'sip'
  sourceId: string
  variantId?: string
  /** Row label: "MIP7", a variant name, or "SIP". */
  label: string
  /** The file this row delivers, e.g. "wolt_acslanot_mip_...html". */
  fileName: string
}

export interface PlanGroup {
  id: string
  /** The playable's name, as Home shows it. */
  name: string
  /** "MIP7" when the MIP is numbered, else ''. Used by the Slack message. */
  mip: string
  items: PlanItem[]
}

/** What one source contributes to a delivery build (see buildDeliveryFiles). */
export interface PlanRequest {
  sourceId: string
  mip: boolean
  variantIds: string[]
  sip: boolean
}

export const itemKey = (sourceId: string, kind: PlanItem['kind'], variantId?: string): string => (kind === 'variant' ? `${sourceId}|v|${variantId}` : `${sourceId}|${kind}`)

/** The MIP label from meta.mip ("7" and "mip 7" both read "MIP7"). */
export function mipLabel(project: Project): string {
  const raw = (project.meta.mip ?? '').trim()
  if (!raw) return ''
  const digits = raw.match(/\d+/)?.[0]
  return digits ? `MIP${digits}` : raw
}

/** Every file each source could send, in delivery order: MIP, variants, SIP. */
export function buildUploadPlan(sources: PlanSource[]): PlanGroup[] {
  return sources.map((s) => {
    const base = fileBaseName(s.project)
    const items: PlanItem[] = [{ key: itemKey(s.id, 'mip'), kind: 'mip', sourceId: s.id, label: mipLabel(s.project) || 'MIP', fileName: `${base}.html` }]
    for (const v of s.project.meta.variants ?? []) {
      items.push({
        key: itemKey(s.id, 'variant', v.id),
        kind: 'variant',
        sourceId: s.id,
        variantId: v.id,
        label: v.name,
        fileName: `${base}_${variantSlug(v.name)}.html`,
      })
    }
    const sip = buildSipProject(s.project)
    // No end card, no SIP row — nothing to tick that could not be built.
    if (sip) items.push({ key: itemKey(s.id, 'sip'), kind: 'sip', sourceId: s.id, label: 'SIP', fileName: `${fileBaseName(sip)}.html` })
    return { id: s.id, name: s.name, mip: mipLabel(s.project), items }
  })
}

export const planItems = (plan: PlanGroup[]): PlanItem[] => plan.flatMap((g) => g.items)

/** Every row ticked — what a fresh batch starts from. */
export const allKeys = (plan: PlanGroup[]): Set<string> => new Set(planItems(plan).map((i) => i.key))

/** Drop keys whose row is gone (a deleted variant, a removed end card). */
export const pruneKeys = (plan: PlanGroup[], keys: Iterable<string>): Set<string> => {
  const live = allKeys(plan)
  return new Set([...keys].filter((k) => live.has(k)))
}

/** The ticked rows grouped back into one build request per source. */
export function planRequests(plan: PlanGroup[], selected: Set<string>): PlanRequest[] {
  const out: PlanRequest[] = []
  for (const g of plan) {
    const picked = g.items.filter((i) => selected.has(i.key))
    if (!picked.length) continue
    out.push({
      sourceId: g.id,
      mip: picked.some((i) => i.kind === 'mip'),
      variantIds: picked.filter((i) => i.kind === 'variant').map((i) => i.variantId!),
      sip: picked.some((i) => i.kind === 'sip'),
    })
  }
  return out
}

export const selectedCount = (plan: PlanGroup[], selected: Set<string>): number => planItems(plan).filter((i) => selected.has(i.key)).length

// ---- remembered ticks -------------------------------------------------------
// Per batch (the set of playables the modal was opened with), so re-uploading the
// same set offers the same picks. This browser only; a blocked/full localStorage
// just means the next batch starts with everything ticked.
const PICK_KEY = 'pa:uploadPick:'

export function savePicks(batchKey: string, keys: Iterable<string>): void {
  try {
    localStorage.setItem(PICK_KEY + batchKey, JSON.stringify([...keys]))
  } catch {
    /* storage full or blocked */
  }
}

export function readPicks(batchKey: string): string[] | null {
  try {
    const raw = localStorage.getItem(PICK_KEY + batchKey)
    const arr = raw ? (JSON.parse(raw) as string[]) : null
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

/** Remembered ticks for this batch, pruned to the live rows; everything when new. */
export function initialPicks(plan: PlanGroup[], batchKey: string): Set<string> {
  const saved = readPicks(batchKey)
  if (!saved) return allKeys(plan)
  const kept = pruneKeys(plan, saved)
  // A remembered set that no longer matches anything would open an empty batch.
  return kept.size ? kept : allKeys(plan)
}
