// Converting an image element to a Button element (and back) is a pure type flip:
// every geometry/layout field stays put so the element doesn't move, resize, or
// rescale, and el.button (the redirect + tap effect) rides across the change.
import { describe, expect, it, beforeEach } from 'vitest'
import type { Project, SceneElement } from '../runtime/scene'
import { activeSceneDef, loadProject, patchElement, setActiveScene, setSelection } from './store'

const image = (): SceneElement =>
  ({
    id: 'img1',
    type: 'image',
    name: 'hero',
    x: 137,
    y: 842,
    w: 480,
    h: 320,
    anchor: 'center',
    zIndex: 5,
    mode: 'fit',
    rotation: 12,
    assetId: 'asset-42',
    box: { radiusPx: 24 },
  }) as unknown as SceneElement

const makeProject = (): Project =>
  ({
    meta: { schemaVersion: 1, name: 't', baseW: 1080, baseH: 1920, clickUrl: { ios: 'x', android: 'x' } },
    scenes: [
      { id: 's1', name: 'One', kind: 'overlay', advance: { on: 'tap' }, elements: [image()] },
      { id: 's2', name: 'Two', kind: 'overlay', advance: { on: 'tap' }, elements: [] },
    ],
    startSceneId: 's1',
  }) as unknown as Project

const GEOMETRY = ['x', 'y', 'w', 'h', 'anchor', 'zIndex', 'mode', 'rotation', 'assetId', 'box'] as const

describe('convert image ↔ button', () => {
  beforeEach(() => {
    loadProject(makeProject(), {}, null)
    setActiveScene('s1')
    setSelection(['img1'])
  })

  it('converting to a button keeps every geometry/layout field identical', () => {
    const before = activeSceneDef().elements[0]
    patchElement('img1', { type: 'button', button: before.button ?? {} })
    const after = activeSceneDef().elements[0]
    expect(after.type).toBe('button')
    for (const k of GEOMETRY) expect(after[k]).toEqual(before[k])
  })

  it('carries the redirect + tap effect across the conversion', () => {
    patchElement('img1', { button: { targetSceneId: 's2', tapEffect: 'glow' } })
    const cfg = activeSceneDef().elements[0].button
    patchElement('img1', { type: 'button', button: cfg })
    expect(activeSceneDef().elements[0].button).toEqual({ targetSceneId: 's2', tapEffect: 'glow' })
  })

  it('round-trips back to an image without moving or resizing', () => {
    const before = activeSceneDef().elements[0]
    patchElement('img1', { type: 'button', button: before.button ?? {} })
    patchElement('img1', { type: 'image' })
    const after = activeSceneDef().elements[0]
    expect(after.type).toBe('image')
    for (const k of GEOMETRY) expect(after[k]).toEqual(before[k])
  })
})
