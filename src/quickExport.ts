import type { Project } from '../runtime/scene'
import {
  buildOutputs,
  downloadBlob,
  fetchRuntimeSrc,
  NETWORKS,
  processAssetsAutoFit,
  pruneAssets,
} from './export'
import { readExportPrefs, readStoredMediaDefaults } from './exportPrefs'
import { fileBaseName } from './mipName'
import { getState } from './store'
import { applyVariant, stripVariants } from './variants'

const slug = (s: string): string => s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'variant'

function selectedNetworks(names: string[]): typeof NETWORKS {
  const picked = NETWORKS.filter((n) => names.includes(n.name))
  return picked.length ? picked : [NETWORKS.find((n) => n.name === 'AppLovin') ?? NETWORKS[0]]
}

export async function quickExportCurrent(includeVariants = true): Promise<void> {
  const { project, assets } = getState()
  const prefs = readExportPrefs()
  const media = readStoredMediaDefaults()
  const runtimeSrc = await fetchRuntimeSrc()
  const nets = selectedNetworks(prefs.networks)
  const baseName = fileBaseName(project)

  const exportOne = async (proj: Project, name: string): Promise<void> => {
    const named: Project = { ...proj, meta: { ...proj.meta, name } }
    const { assets: out } = await processAssetsAutoFit(
      pruneAssets(proj, assets),
      prefs.optimize,
      prefs.quality / 100,
      media,
      named,
      runtimeSrc,
    )
    const { outputs } = buildOutputs(named, out, nets, runtimeSrc)
    for (const o of outputs) downloadBlob(o.filename, await o.make())
  }

  await exportOne(stripVariants(project), baseName)
  if (!includeVariants) return
  for (const v of project.meta.variants ?? []) await exportOne(applyVariant(project, v), `${baseName}_${slug(v.name)}`)
}
