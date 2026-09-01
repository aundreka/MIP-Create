// Variant application (pure; shared by the canvas preview and the batch export).
// A variant is a set of per-element field overrides on top of the base MIP. Used
// for slightly different mechanics / win conditions / asset swaps of the same MIP.
// Language is NOT a variant — it's resolved at runtime from the browser.

import type { Project, SceneElement, Variant } from '../runtime/scene'
import { usesHolidayToken } from './promoCalendar'

export function applyVariantPatches(elements: SceneElement[], patches: Variant['patches']): SceneElement[] {
  if (!patches.length) return elements
  const byId = new Map(patches.map((p) => [p.elementId, p.patch]))
  return elements.map((e) => {
    const p = byId.get(e.id)
    return p ? { ...e, ...p } : e
  })
}

/** Meta the RUNTIME never reads, dropped on the way out:
 *  - `variants` is an editor-only authoring construct;
 *  - `promoCalendar` is ~3 KB of rows that only the {holiday} token consumes, so a MIP
 *    that doesn't render the token ships without them.
 * Evaluated on the variant-applied project, since a patch can be what introduces (or
 * removes) the token. */
function exportMeta(project: Project): Project['meta'] {
  return {
    ...project.meta,
    variants: undefined,
    promoCalendar: usesHolidayToken(project) ? project.meta.promoCalendar : undefined,
  }
}

/** A concrete project with one variant baked in across all scenes; variant
 * metadata stripped (not needed at runtime). */
export function applyVariant(project: Project, variant: Variant): Project {
  const patched: Project = {
    ...project,
    scenes: project.scenes.map((s) => ({ ...s, elements: applyVariantPatches(s.elements, variant.patches) })),
  }
  return { ...patched, meta: exportMeta(patched) }
}

/** The base project with variant metadata stripped (for the base export). */
export function stripVariants(project: Project): Project {
  return { ...project, meta: exportMeta(project) }
}
