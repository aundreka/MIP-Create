// SIP builds cut from a MIP: the MIP's end card alone, delivered under the SIP name.
// A project whose only scene is an end card IS a SIP (see isSip in mipName.ts), so
// cutting the flow down to that one scene is all it takes for fileBaseName() to
// switch to "..._acslanot_sip_..._emily_product_<format>_...".

import type { Project, SceneDef } from '../runtime/scene'
import { stripVariants } from './variants'

const isEndcard = (s: SceneDef): boolean => s.kind === 'endscene' || (s.kind === 'overlay' && s.asEndscene === true)

/** The scenes that can ship as a SIP, in flow order. */
export function endcardScenes(project: Pick<Project, 'scenes'>): SceneDef[] {
  return project.scenes.filter(isEndcard)
}

/** The end card the SIP is cut from: meta.sipSceneId when it still names an end
 * card, else the first one in the flow. */
export function sipScene(project: Pick<Project, 'meta' | 'scenes'>): SceneDef | undefined {
  const cards = endcardScenes(project)
  return cards.find((s) => s.id === project.meta.sipSceneId) ?? cards[0]
}

/**
 * The SIP project: the chosen end card as the only scene, with variants stripped
 * and the session timer dropped (its target scene is gone). Returns null when
 * the MIP has no end card. Links to removed scenes need no rewrite: the runtime
 * reads an unknown scene id as "no target".
 */
export function buildSipProject(project: Project): Project | null {
  const scene = sipScene(project)
  if (!scene) return null
  const base = stripVariants(project)
  const { sessionTimer: _timer, ...meta } = base.meta
  return { ...base, meta, scenes: [scene], startSceneId: scene.id }
}
