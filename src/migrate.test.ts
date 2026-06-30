import { describe, expect, it } from 'vitest'
import type { Project } from '../runtime/scene'
import { CURRENT_SCHEMA, migrateProject } from './migrate'

const proj = (schemaVersion?: number): Project =>
  ({
    meta: { ...(schemaVersion === undefined ? {} : { schemaVersion }), name: 't', baseW: 1080, baseH: 1920, clickUrl: { ios: 'x', android: 'x' } },
    scenes: [{ id: 's1', name: 'One', kind: 'overlay', advance: { on: 'tap' }, elements: [] }],
    startSceneId: 's1',
  }) as unknown as Project

describe('migrateProject', () => {
  it('stamps the current schema on a versionless (legacy) project', () => {
    const out = migrateProject(proj(undefined))
    expect(out.meta.schemaVersion).toBe(CURRENT_SCHEMA)
  })

  it('stamps the current schema on an older-version project', () => {
    const out = migrateProject(proj(0))
    expect(out.meta.schemaVersion).toBe(CURRENT_SCHEMA)
  })

  it('leaves a current-version project untouched (same reference)', () => {
    const p = proj(CURRENT_SCHEMA)
    expect(migrateProject(p)).toBe(p)
  })

  it('is idempotent', () => {
    const once = migrateProject(proj(0))
    const twice = migrateProject(once)
    expect(twice.meta.schemaVersion).toBe(CURRENT_SCHEMA)
    expect(twice).toBe(once) // already current → no further copy
  })

  it('preserves scenes and other meta fields', () => {
    const out = migrateProject(proj(0))
    expect(out.scenes).toHaveLength(1)
    expect(out.meta.name).toBe('t')
    expect(out.meta.baseW).toBe(1080)
  })
})
