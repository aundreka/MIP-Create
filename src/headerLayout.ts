// Where a pinned-header placement gets written.
//
// The band's LAYOUT lives at two levels: the project header (meta.header — every scene)
// and one scene's own override (SceneDef.header — that scene only), each with its own
// landscape slot. Dragging on the canvas always writes the SCENE level, so composing one
// scene can never move the band in another; the Header popover's fields stay project-wide,
// and "apply to every scene" promotes a scene's placement up to the project.

import type { HeaderConfig, HeaderOrientationOverride, HeaderSceneOverride } from '../runtime/scene'

/** The runtime's own fallbacks (header.ts applyLayout) — a snapshot has to write these
 * out, not leave them unset, or the orientation would go on inheriting them. */
const HEADER_DEFAULTS = { heightPx: 120, fontSizePx: 64, fontWeight: 500, align: 'center', letterSpacingPx: 0, offsetXPx: 0, offsetYPx: 0 } as const

/**
 * The landscape layout to store when "Separate landscape layout" is switched on: today's
 * RESOLVED portrait layout, defaults included. Snapshotting the resolved values (rather
 * than only the explicitly-set ones) is what makes the two orientations independent — a
 * field left unset would keep inheriting portrait, so changing the portrait font size
 * would still resize the landscape band. `topPaddingPx` is copied only when it is actually
 * set, because setting it at all switches the band from centred to top-anchored text.
 */
export function seedLandscapeHeader(h: HeaderConfig | undefined): HeaderOrientationOverride {
  const seed: HeaderOrientationOverride = {
    heightPx: h?.heightPx ?? HEADER_DEFAULTS.heightPx,
    fontSizePx: h?.fontSizePx ?? HEADER_DEFAULTS.fontSizePx,
    fontWeight: h?.fontWeight ?? HEADER_DEFAULTS.fontWeight,
    align: h?.align ?? HEADER_DEFAULTS.align,
    letterSpacingPx: h?.letterSpacingPx ?? HEADER_DEFAULTS.letterSpacingPx,
    offsetXPx: h?.offsetXPx ?? HEADER_DEFAULTS.offsetXPx,
    offsetYPx: h?.offsetYPx ?? HEADER_DEFAULTS.offsetYPx,
  }
  if (h?.topPaddingPx != null) seed.topPaddingPx = h.topPaddingPx
  return seed
}

/** Drop undefined values (and objects left empty) so a cleared override disappears from
 * the saved JSON instead of lingering as `{}`. */
export function prune<T extends object>(o: T): T | undefined {
  const kept = Object.entries(o).filter(([, v]) => v !== undefined && !(v && typeof v === 'object' && !Object.keys(v).length))
  return kept.length ? (Object.fromEntries(kept) as T) : undefined
}

/** The scene override after placing the band at (x, y) design px, into the slot for the
 * orientation on screen. Undefined = the scene has nothing of its own left and should
 * follow the project layout again. */
export function sceneHeaderOffset(
  cur: HeaderSceneOverride | undefined,
  landscape: boolean,
  x: number | undefined,
  y: number | undefined,
): HeaderSceneOverride | undefined {
  const offsets = { offsetXPx: x || undefined, offsetYPx: y || undefined }
  const base = cur ?? {}
  return prune(landscape ? { ...base, landscape: prune({ ...(base.landscape ?? {}), ...offsets }) } : { ...base, ...offsets })
}

/** The same placement as a patch for the PROJECT header (moves the band in every scene
 * that has no override of its own). */
export function projectHeaderOffset(
  cur: HeaderConfig | undefined,
  landscape: boolean,
  x: number | undefined,
  y: number | undefined,
): Partial<HeaderConfig> {
  const offsets = { offsetXPx: x || undefined, offsetYPx: y || undefined }
  if (!landscape) return offsets
  return { landscape: prune({ ...(cur?.landscape ?? {}), ...offsets }) as HeaderOrientationOverride | undefined }
}

/** The placement a scene currently shows, in the orientation on screen. */
export function sceneOffsetOf(scene: HeaderSceneOverride | undefined, landscape: boolean): { x?: number; y?: number } {
  const slot = landscape ? { ...scene, ...(scene?.landscape ?? {}) } : scene
  return { x: slot?.offsetXPx, y: slot?.offsetYPx }
}
