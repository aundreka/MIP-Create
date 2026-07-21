// Reuse elements across scenes: copyElementsFromScene clones elements from another
// scene into the active one. Copies keep geometry/asset/animations (independent per
// scene), get fresh ids, strip `sync` (the cross-MIP invariant is one copy per
// scene), and remap groupId so a copied group doesn't couple to the source group.
import { describe, expect, it, beforeEach } from 'vitest'
import type { Project, SceneElement } from '../runtime/scene'
import { activeSceneDef, copyElementsFromScene, loadProject, setActiveScene } from './store'

const el = (id: string, extra: Partial<SceneElement> = {}): SceneElement =>
  ({
    id,
    type: 'image',
    name: id,
    x: 100,
    y: 200,
    w: 300,
    h: 150,
    anchor: 'center',
    zIndex: 3,
    mode: 'fit',
    assetId: 'asset-1',
    ...extra,
  }) as SceneElement

const makeProject = (): Project =>
  ({
    meta: { schemaVersion: 1, name: 't', baseW: 1080, baseH: 1920, clickUrl: { ios: 'x', android: 'x' } },
    scenes: [
      {
        id: 's1',
        name: 'One',
        kind: 'game',
        advance: { on: 'tap' },
        elements: [
          el('bg1', {
            type: 'background',
            zIndex: 0,
            mode: 'extend',
            background: { objectFit: 'cover', landscapeAssetId: 'asset-l' },
            animations: { entrance: { preset: 'fade', durationMs: 400, delayMs: 0, easing: 'ease' } },
          } as Partial<SceneElement>),
          el('a1', { groupId: 'g1', sync: { key: 'k1', scope: 'scene' } }),
          el('a2', { groupId: 'g1' }),
        ],
      },
      { id: 's2', name: 'Two', kind: 'game', advance: { on: 'tap' }, elements: [] },
    ],
    startSceneId: 's1',
  }) as unknown as Project

describe('copyElementsFromScene', () => {
  beforeEach(() => {
    loadProject(makeProject(), {}, null)
    setActiveScene('s2')
  })

  it('copies a background with its config + animations, under a fresh id', () => {
    copyElementsFromScene('s1', ['bg1'])
    const copies = activeSceneDef().elements
    expect(copies).toHaveLength(1)
    const c = copies[0]
    expect(c.id).not.toBe('bg1')
    expect(c.type).toBe('background')
    expect(c.assetId).toBe('asset-1') // same asset — packed once on export
    expect(c.background?.landscapeAssetId).toBe('asset-l')
    expect(c.animations?.entrance?.preset).toBe('fade')
    // source scene keeps its own copy untouched
    setActiveScene('s1')
    expect(activeSceneDef().elements.map((e) => e.id)).toEqual(['bg1', 'a1', 'a2'])
  })

  it('copies are deep — no shared config objects with the source (own animations per scene)', () => {
    copyElementsFromScene('s1', ['bg1'])
    const copy = activeSceneDef().elements[0]
    setActiveScene('s1')
    const source = activeSceneDef().elements[0]
    expect(copy.animations).not.toBe(source.animations)
    expect(copy.background).not.toBe(source.background)
  })

  it('strips sync and remaps groupId consistently', () => {
    copyElementsFromScene('s1', ['a1', 'a2'])
    const [c1, c2] = activeSceneDef().elements
    expect(c1.sync).toBeUndefined()
    expect(c1.groupId).toBeDefined()
    expect(c1.groupId).toBe(c2.groupId)
    expect(c1.groupId).not.toBe('g1')
  })

  it('is a no-op when the source is the active scene or unknown', () => {
    copyElementsFromScene('s2', ['bg1'])
    copyElementsFromScene('nope', ['bg1'])
    expect(activeSceneDef().elements).toHaveLength(0)
  })
})
