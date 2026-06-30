// Cross-scene element clipboard + move (the editor's copy/paste/move-to-scene).
import { describe, expect, it, beforeEach } from 'vitest'
import type { Project } from '../runtime/scene'
import { activeSceneDef, copySelected, getState, loadProject, moveSelectedToScene, pasteElements, setActiveScene, setSelection } from './store'

const el = (id: string, x = 10) => ({ id, type: 'text', name: id, x, y: 10, w: 100, h: 40, anchor: 'center', zIndex: 1, mode: 'fit', text: { content: 'hi' } })
const makeProject = (): Project =>
  ({
    meta: { schemaVersion: 1, name: 't', baseW: 1080, baseH: 1920, clickUrl: { ios: 'x', android: 'x' } },
    scenes: [
      { id: 's1', name: 'One', kind: 'overlay', advance: { on: 'tap' }, elements: [el('a')] },
      { id: 's2', name: 'Two', kind: 'overlay', advance: { on: 'tap' }, elements: [] },
    ],
    startSceneId: 's1',
  }) as unknown as Project

describe('cross-scene clipboard', () => {
  beforeEach(() => loadProject(makeProject(), {}, null))

  it('copies a selected element and pastes it into another scene with a fresh id', () => {
    setActiveScene('s1')
    setSelection(['a'])
    copySelected()
    setActiveScene('s2')
    pasteElements()
    const s2 = activeSceneDef()
    expect(s2.id).toBe('s2')
    expect(s2.elements).toHaveLength(1)
    expect(s2.elements[0].id).not.toBe('a') // new id, no collision
    expect(s2.elements[0].name).toBe('a') // content preserved
    // source scene is untouched (copy, not move)
    expect(getState().project.scenes.find((s) => s.id === 's1')!.elements).toHaveLength(1)
  })

  it('moves the selection out of the active scene into the target and follows it', () => {
    setActiveScene('s1')
    setSelection(['a'])
    moveSelectedToScene('s2')
    const p = getState().project
    expect(p.scenes.find((s) => s.id === 's1')!.elements).toHaveLength(0)
    expect(p.scenes.find((s) => s.id === 's2')!.elements).toHaveLength(1)
    expect(getState().activeSceneId).toBe('s2') // follows the move
    expect(getState().selectedIds).toHaveLength(1)
  })

  it('repositions moved elements when a drop position is given (cross-scene drag)', () => {
    setActiveScene('s1')
    setSelection(['a'])
    moveSelectedToScene('s2', { a: { x: 540, y: 960 } })
    const moved = getState().project.scenes.find((s) => s.id === 's2')!.elements[0]
    expect(moved.x).toBe(540) // landed at the drop point, not its original x (10)
    expect(moved.y).toBe(960)
  })

  it('paste can repeat (each paste adds another copy)', () => {
    setActiveScene('s1')
    setSelection(['a'])
    copySelected()
    setActiveScene('s2')
    pasteElements()
    pasteElements()
    const ids = activeSceneDef().elements.map((e) => e.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2) // distinct ids
  })
})
