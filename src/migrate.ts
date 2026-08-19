// Forward-migrate a loaded project to the current schema. This is the single
// entry point every load path runs through (via store.loadProject), so old saved
// projects — from files, the local library, the team server, or version history —
// are upgraded to the shape the current editor expects before they're used.
//
// To evolve the model: bump CURRENT_SCHEMA, add a `from < N` block that transforms
// the project, and the stamp at the end records the new version.

import type { HeaderOrientationOverride, HeaderSceneOverride, Project } from '../runtime/scene'

export const CURRENT_SCHEMA = 3

export function migrateProject(project: Project): Project {
  if (!project || !project.meta) return project
  const from = typeof project.meta.schemaVersion === 'number' ? project.meta.schemaVersion : 0
  if (from >= CURRENT_SCHEMA) return project

  let p = project

  // v0 → v1: the first versioned schema. Older saves predate `schemaVersion`
  // (treated as 0); they're already shape-compatible, so there's nothing to
  // transform yet — just stamp the version.

  // v1 → v2: 'win' and 'custom' scene kinds merged into 'overlay'.
  if (from < 2) {
    p = {
      ...p,
      scenes: p.scenes.map((s) => {
        const k = s.kind as string
        if (k === 'win' || k === 'custom') return { ...s, kind: 'overlay' as const }
        return s
      }),
    }
  }

  // v2 → v3: a scene's header layout was stored FLAT (applying to both orientations) with
  // an optional nested `landscape`. It is now two independent slots — SceneDef.header
  // .portrait / .landscape — so composing one orientation can never shift the other. Fold
  // the old shape into both slots: the rendered result is identical, and from here on the
  // two are separate. See src/headerLayout.ts.
  if (from < 3) {
    p = {
      ...p,
      scenes: p.scenes.map((s) => {
        const h = s.header as (HeaderSceneOverride & HeaderOrientationOverride) | undefined
        if (!h) return s
        const { portrait, landscape, ...flat } = h
        if (!Object.keys(flat).length) return s // already the new shape
        const both = { ...flat, ...portrait }
        return { ...s, header: { portrait: both, landscape: { ...flat, ...landscape } } }
      }),
    }
  }

  return { ...p, meta: { ...p.meta, schemaVersion: CURRENT_SCHEMA } }
}
