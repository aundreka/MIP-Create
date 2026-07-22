// Forward-migrate a loaded project to the current schema. This is the single
// entry point every load path runs through (via store.loadProject), so old saved
// projects — from files, the local library, the team server, or version history —
// are upgraded to the shape the current editor expects before they're used.
//
// To evolve the model: bump CURRENT_SCHEMA, add a `from < N` block that transforms
// the project, and the stamp at the end records the new version.

import type { Project } from '../runtime/scene'

export const CURRENT_SCHEMA = 2

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

  return { ...p, meta: { ...p.meta, schemaVersion: CURRENT_SCHEMA } }
}
