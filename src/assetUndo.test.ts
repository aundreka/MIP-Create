// Asset add/compress must be undoable (snapshots now capture the assets map).
// Single history action in its own file so the snapshot isn't coalesced.
import { describe, expect, it } from 'vitest'
import type { Project } from '../runtime/scene'
import { addAsset, getState, loadProject, redo, undo } from './store'

const makeProject = (): Project =>
  ({
    meta: { schemaVersion: 1, name: 't', baseW: 1080, baseH: 1920, clickUrl: { ios: 'x', android: 'x' } },
    scenes: [{ id: 's1', name: 'One', kind: 'overlay', advance: { on: 'tap' }, elements: [] }],
    startSceneId: 's1',
  }) as unknown as Project

describe('asset undo', () => {
  it('adding an asset is undoable and redoable', () => {
    loadProject(makeProject(), {}, null)
    addAsset('x', { src: 'data:1', w: 10, h: 10 })
    expect(getState().assets.x).toBeTruthy()
    undo()
    expect(getState().assets.x).toBeUndefined()
    redo()
    expect(getState().assets.x).toBeTruthy()
  })
})
