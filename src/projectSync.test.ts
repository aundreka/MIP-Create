// "Sync to project" — an element shared across every MIP in the project group.
// Covers the store-side behavior: registry write on toggle, scope 'all' materializing
// a copy per scene, edits propagating to every copy, and unsync clearing the registry.
import { describe, expect, it, beforeEach } from 'vitest'
import type { Project } from '../runtime/scene'
import { activeSceneDef, getState, loadProject, patchElement, setActiveScene, setSelection, setSyncScope, toggleSyncToProject } from './store'
import { readShared } from './projectGroups'

const el = (id: string, x = 10) =>
  ({ id, type: 'text', name: id, x, y: 10, w: 100, h: 40, anchor: 'center', zIndex: 1, mode: 'fit', text: { value: 'hi', fontSizePx: 40 } })
const makeProject = (): Project =>
  ({
    meta: { schemaVersion: 1, name: 't', baseW: 1080, baseH: 1920, clickUrl: { ios: 'x', android: 'x' }, projectId: 'g1', projectName: 'Proj' },
    scenes: [
      { id: 's1', name: 'One', kind: 'overlay', advance: { on: 'tap' }, elements: [el('a')] },
      { id: 's2', name: 'Two', kind: 'overlay', advance: { on: 'tap' }, elements: [] },
    ],
    startSceneId: 's1',
  }) as unknown as Project

describe('sync to project', () => {
  beforeEach(() => {
    localStorage.clear()
    loadProject(makeProject(), {}, null)
  })

  it('toggling sync marks the element and registers it in the group registry', () => {
    setActiveScene('s1')
    setSelection(['a'])
    toggleSyncToProject('a')
    const a = activeSceneDef().elements.find((e) => e.id === 'a')!
    expect(a.sync).toBeTruthy()
    const shared = readShared('g1')
    expect(Object.keys(shared)).toHaveLength(1)
    expect(Object.values(shared)[0].el.name).toBe('a')
  })

  it('scope "all" materializes a copy on every scene and edits propagate to all copies', () => {
    setActiveScene('s1')
    setSelection(['a'])
    toggleSyncToProject('a')
    const key = activeSceneDef().elements.find((e) => e.id === 'a')!.sync!.key
    setSyncScope('a', 'all')
    // s2 now carries a synced copy of the same key
    const copy = getState().project.scenes.find((s) => s.id === 's2')!.elements.find((e) => e.sync?.key === key)
    expect(copy).toBeTruthy()
    // editing the original updates the copy on the other scene too (true shared instance)
    patchElement('a', { x: 999 })
    const after = getState().project.scenes.find((s) => s.id === 's2')!.elements.find((e) => e.sync?.key === key)!
    expect(after.x).toBe(999)
  })

  it('switching scope back to "scene" keeps a single copy across the MIP', () => {
    setActiveScene('s1')
    setSelection(['a'])
    toggleSyncToProject('a')
    const key = activeSceneDef().elements.find((e) => e.id === 'a')!.sync!.key
    setSyncScope('a', 'all')
    setSyncScope('a', 'scene')
    const copies = getState().project.scenes.flatMap((s) => s.elements).filter((e) => e.sync?.key === key)
    expect(copies).toHaveLength(1)
  })

  it('unsync drops the marker and clears the registry entry', () => {
    setActiveScene('s1')
    setSelection(['a'])
    toggleSyncToProject('a') // on
    toggleSyncToProject('a') // off
    const a = activeSceneDef().elements.find((e) => e.id === 'a')!
    expect(a.sync).toBeFalsy()
    expect(Object.keys(readShared('g1'))).toHaveLength(0)
  })
})
