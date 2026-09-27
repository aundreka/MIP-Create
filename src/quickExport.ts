import type { Project } from '../runtime/scene'
import { downloadBlob, fetchRuntimeSrc, NETWORKS } from './export'
import { readExportPrefs } from './exportPrefs'
import { buildNamedOutputs, variantSlug } from './deliver'
import { fileBaseName } from './mipName'
import { buildSipProject } from './sip'
import { getState } from './store'
import { applyVariant, stripVariants } from './variants'

function selectedNetworks(names: string[]): typeof NETWORKS {
  const picked = NETWORKS.filter((n) => names.includes(n.name))
  return picked.length ? picked : [NETWORKS.find((n) => n.name === 'AppLovin') ?? NETWORKS[0]]
}

export async function quickExportCurrent(includeVariants = true): Promise<void> {
  const { project, assets } = getState()
  const nets = selectedNetworks(readExportPrefs().networks)
  const runtimeSrc = await fetchRuntimeSrc()
  const baseName = fileBaseName(project)

  const exportOne = async (proj: Project, name: string): Promise<void> => {
    for (const o of await buildNamedOutputs(proj, assets, name, nets, runtimeSrc)) downloadBlob(o.filename, await o.make())
  }

  await exportOne(stripVariants(project), baseName)
  if (!includeVariants) return
  for (const v of project.meta.variants ?? []) await exportOne(applyVariant(project, v), `${baseName}_${variantSlug(v.name)}`)
}

/** Quick export the MIP's end card alone, under the SIP file name. */
export async function quickExportSip(): Promise<void> {
  const { project, assets } = getState()
  const sip = buildSipProject(project)
  if (!sip) throw new Error('This MIP has no end card to export as a SIP.')
  const nets = selectedNetworks(readExportPrefs().networks)
  for (const o of await buildNamedOutputs(sip, assets, fileBaseName(sip), nets)) downloadBlob(o.filename, await o.make())
}
