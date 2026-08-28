// Which scene the flow actually plays from. The strip's order is NOT the answer — the
// starred `startSceneId` is — so dragging a new opener (an intro overlay) to the front
// has to carry the star with it, or the scene the author put first never plays.
import { describe, expect, it, beforeEach } from 'vitest'
import type { Project } from '../runtime/scene'
import { getState, loadProject, removeScene, reorderScenes, setStartScene } from './store'

const makeProject = (startSceneId: string): Project =>
  ({
    meta: { schemaVersion: 1, name: 't', baseW: 1080, baseH: 1920, clickUrl: { ios: 'x', android: 'x' } },
    scenes: [
      { id: 'game', name: 'Game', kind: 'game', advance: { on: 'gameWin' }, elements: [] },
      { id: 'end', name: 'End', kind: 'endscene', advance: { on: 'manual' }, elements: [] },
      { id: 'intro', name: 'Intro', kind: 'overlay', overlayBase: 'game', advance: { on: 'tap' }, elements: [] },
    ],
    startSceneId,
  }) as unknown as Project

describe('start scene follows a reorder', () => {
  beforeEach(() => loadProject(makeProject('game'), {}, null))

  it('moves the star onto the new opener when it was sitting on the first scene', () => {
    // The author drags the intro overlay from the end of the strip to the front.
    reorderScenes(['intro', 'game', 'end'])
    const p = getState().project
    expect(p.scenes.map((s) => s.id)).toEqual(['intro', 'game', 'end'])
    expect(p.startSceneId).toBe('intro') // the flow opens on the scene now shown first
  })

  it('leaves a star that was deliberately parked on a later scene alone', () => {
    setStartScene('end') // not the first scene — a deliberate choice
    reorderScenes(['intro', 'game', 'end'])
    expect(getState().project.startSceneId).toBe('end')
  })

  it('keeps the star put when the first scene itself did not move', () => {
    reorderScenes(['game', 'intro', 'end'])
    expect(getState().project.startSceneId).toBe('game')
  })

  it('drops an overlay backdrop that points at a deleted scene', () => {
    reorderScenes(['intro', 'game', 'end'])
    removeScene('game')
    expect(getState().project.scenes.find((s) => s.id === 'intro')!.overlayBase).toBeUndefined()
  })
})
