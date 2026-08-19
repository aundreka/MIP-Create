// Where a pinned-header layout is stored, and the ONLY module that decides it.
//
// Two levels, and nothing in between:
//
//   PROJECT   meta.header            — the band every scene shows by default,
//             meta.header.landscape    with its own landscape layout when enabled.
//
//   SCENE     SceneDef.header.portrait   — two INDEPENDENT slots. A slot belongs to one
//             SceneDef.header.landscape    scene and one orientation; writing it can never
//                                          touch another scene, the other orientation, or
//                                          the project layout.
//
// A scene with no slot for the orientation on screen follows the project layout there.
// Opting a scene in SNAPSHOTS the layout it is currently showing (seedSceneSlot), so from
// that moment nothing edited elsewhere can move it — no partial inheritance, no surprises.
//
// Every editor write (canvas drag, scene panel field, popover field) goes through one of
// the functions below, so the rules live in one place instead of in the components.

import { effectiveHeader, sceneHeaderSlot } from '../runtime/header'
import type { HeaderConfig, HeaderOrientationOverride, HeaderSceneOverride } from '../runtime/scene'

export type Orient = 'portrait' | 'landscape'

/** The orientation the canvas is composing. */
export const orientOf = (landscape: boolean): Orient => (landscape ? 'landscape' : 'portrait')

/** The runtime's own fallbacks (header.ts applyLayout). A snapshot writes these out rather
 * than leaving them unset, or the slot would go on inheriting whatever it was copied from. */
const HEADER_DEFAULTS = { heightPx: 120, fontSizePx: 64, fontWeight: 500, align: 'center', letterSpacingPx: 0, offsetXPx: 0, offsetYPx: 0 } as const

/** Drop undefined values (and objects left empty) so a cleared slot disappears from the
 * saved JSON instead of lingering as `{}`. */
export function prune<T extends object>(o: T): T | undefined {
  const kept = Object.entries(o).filter(([, v]) => v !== undefined && !(v && typeof v === 'object' && !Object.keys(v).length))
  return kept.length ? (Object.fromEntries(kept) as T) : undefined
}

/** Does this scene own the layout for that orientation, or is it following the project? */
export function ownsSlot(scene: HeaderSceneOverride | undefined, orient: Orient): boolean {
  return !!scene?.[orient] && Object.keys(scene[orient]!).length > 0
}

/** The scene's slot for one orientation (undefined = follows the project). */
export function slotOf(scene: HeaderSceneOverride | undefined, orient: Orient): HeaderOrientationOverride | undefined {
  return sceneHeaderSlot(scene, orient === 'landscape')
}

/** The layout actually on screen for a scene in one orientation — project, plus its slot. */
export function resolvedLayout(project: HeaderConfig | undefined, scene: HeaderSceneOverride | undefined, orient: Orient): HeaderConfig {
  return effectiveHeader(project ?? {}, orient === 'landscape', scene)
}

/** A complete snapshot of what the scene shows right now, for that orientation. This is
 * what makes an opted-in scene independent: every field is written out, so a later project
 * edit (or another scene's edit) cannot move it. */
export function seedSlot(project: HeaderConfig | undefined, scene: HeaderSceneOverride | undefined, orient: Orient): HeaderOrientationOverride {
  const from = resolvedLayout(project, scene, orient)
  const seed: HeaderOrientationOverride = {
    heightPx: from.heightPx ?? HEADER_DEFAULTS.heightPx,
    fontSizePx: from.fontSizePx ?? HEADER_DEFAULTS.fontSizePx,
    fontWeight: from.fontWeight ?? HEADER_DEFAULTS.fontWeight,
    align: from.align ?? HEADER_DEFAULTS.align,
    letterSpacingPx: from.letterSpacingPx ?? HEADER_DEFAULTS.letterSpacingPx,
    offsetXPx: from.offsetXPx ?? HEADER_DEFAULTS.offsetXPx,
    offsetYPx: from.offsetYPx ?? HEADER_DEFAULTS.offsetYPx,
  }
  // Only when actually set: giving the band a top padding at all switches its text from
  // vertically centred to top-anchored, so a snapshotted 0 would move the text.
  if (from.topPaddingPx != null) seed.topPaddingPx = from.topPaddingPx
  return seed
}

/** Opt a scene into its own layout for ONE orientation, snapshotting what it shows now.
 * The other orientation is untouched. */
export function withOwnSlot(project: HeaderConfig | undefined, scene: HeaderSceneOverride | undefined, orient: Orient): HeaderSceneOverride {
  return { ...scene, [orient]: seedSlot(project, scene, orient) }
}

/** Hand one orientation back to the project layout. Undefined = the scene owns neither
 * orientation any more and its whole override goes away. */
export function withoutSlot(scene: HeaderSceneOverride | undefined, orient: Orient): HeaderSceneOverride | undefined {
  return prune({ ...scene, [orient]: undefined })
}

/**
 * Merge a layout patch into ONE scene's ONE orientation. A scene that did not own that
 * orientation is seeded first, so the edit lands on a complete snapshot and the result is
 * fully independent — this is the single write path for the canvas drag and the scene panel.
 */
export function patchSlot(
  project: HeaderConfig | undefined,
  scene: HeaderSceneOverride | undefined,
  orient: Orient,
  patch: HeaderOrientationOverride,
): HeaderSceneOverride | undefined {
  const owned = ownsSlot(scene, orient) ? scene! : withOwnSlot(project, scene, orient)
  return prune({ ...owned, [orient]: prune({ ...owned[orient], ...patch }) })
}

/** The project-level patch for a placement (moves every scene that owns no slot). Used by
 * the Header popover and by "use this placement in every scene". */
export function projectLayoutPatch(project: HeaderConfig | undefined, orient: Orient, patch: HeaderOrientationOverride): Partial<HeaderConfig> {
  if (orient === 'portrait') return patch
  return { landscape: { ...(project?.landscape ?? {}), ...patch } }
}

/** How many scenes have their own layout for an orientation — shown in the popover so a
 * project-level edit never looks like it did nothing. */
export function scenesOwning(scenes: { header?: HeaderSceneOverride }[], orient: Orient): number {
  return scenes.filter((s) => ownsSlot(s.header, orient)).length
}
