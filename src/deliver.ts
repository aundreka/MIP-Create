// Delivery builds: the finished single-file HTML for a MIP, its variants and its
// SIP, built with the saved Export modal settings. Shared by Quick export, the
// Upload modal and Push to GitHub so every path ships byte-identical files.

import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import { buildOutputs, fetchRuntimeSrc, fmtBytes, NETWORKS, processAssetsAutoFit, pruneAssets, type Network, type Output } from './export'
import { readExportPrefs, readStoredMediaDefaults } from './exportPrefs'
import { fileBaseName } from './mipName'
import { buildSipProject } from './sip'
import { applyVariant, stripVariants } from './variants'

export const variantSlug = (s: string): string => s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'variant'

export const APPLOVIN: Network = NETWORKS.find((n) => n.name === 'AppLovin') ?? NETWORKS[0]

/** Build `project` under the file stem `name` for `nets`, compressing assets
 * with the saved export settings. */
export async function buildNamedOutputs(project: Project, assets: AssetMap, name: string, nets: Network[], runtimeSrc?: string): Promise<Output[]> {
  const prefs = readExportPrefs()
  const src = runtimeSrc ?? (await fetchRuntimeSrc())
  const named: Project = { ...project, meta: { ...project.meta, name } }
  const { assets: out } = await processAssetsAutoFit(pruneAssets(project, assets), prefs.optimize, prefs.quality / 100, readStoredMediaDefaults(), named, src)
  return buildOutputs(named, out, nets, src).outputs
}

export interface DeliveryFile {
  kind: 'mip' | 'variant' | 'sip'
  /** File name, e.g. "wolt_acslanot_mip_..._unique.html". */
  name: string
  text: string
  bytes: number
  /** AppLovin "Iteration Name" for this file. */
  iteration: string
}

export interface DeliveryBatch {
  files: DeliveryFile[]
  /** Outputs over the 5 MB gate, as "<name> (<size>)"; not in `files`. */
  skipped: string[]
}

/**
 * The AppLovin (MRAID) HTML for one MIP: the base build, then (optionally) one
 * per variant, then (optionally) the SIP cut from its end card. `label` names
 * the MIP in variant iteration names when meta.mip is blank.
 */
export async function buildDeliveryFiles(
  project: Project,
  assets: AssetMap,
  opts: { label?: string; variants?: boolean; sip?: boolean; runtimeSrc?: string } = {},
): Promise<DeliveryBatch> {
  const runtimeSrc = opts.runtimeSrc ?? (await fetchRuntimeSrc())
  const baseName = fileBaseName(project)
  const mipLabel = (project.meta.mip ?? '').trim() || opts.label || baseName
  const batch: DeliveryBatch = { files: [], skipped: [] }

  const one = async (kind: DeliveryFile['kind'], proj: Project, name: string, iteration: string): Promise<void> => {
    const [o] = await buildNamedOutputs(proj, assets, name, [APPLOVIN], runtimeSrc)
    if (!o) return
    if (o.over) {
      batch.skipped.push(`${o.filename} (${fmtBytes(o.bytes)})`)
      return
    }
    batch.files.push({ kind, name: o.filename, text: await (await o.make()).text(), bytes: o.bytes, iteration })
  }

  await one('mip', stripVariants(project), baseName, mipLabel)
  if (opts.variants) {
    for (const v of project.meta.variants ?? []) {
      await one('variant', applyVariant(project, v), `${baseName}_${variantSlug(v.name)}`, `${mipLabel} / ${v.name}`)
    }
  }
  if (opts.sip) {
    const sip = buildSipProject(project)
    if (sip) await one('sip', sip, fileBaseName(sip), `${mipLabel} SIP`)
  }
  return batch
}
