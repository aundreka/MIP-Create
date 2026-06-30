// Variant edit-mode must NOT leak into the base. align writes a variant override;
// scene-level + structural ops (bg, lock, convert) are no-ops in variant mode.
import { describe, expect, it, beforeEach } from 'vitest'
import type { Project } from '../runtime/scene'
import { addVariant, alignSelected, convertElement, getState, loadProject, setSceneBg, setSelection, toggleLock } from './store'
import { setActiveVariant } from './variantMode'

const el = () => ({ id: 'a', type: 'text', name: 'a', x: 100, y: 100, w: 100, h: 40, anchor: 'center', zIndex: 1, mode: 'fit', text: { content: 'hi' } })
const makeProject = (): Project =>
  ({
    meta: { schemaVersion: 1, name: 't', baseW: 1080, baseH: 1920, clickUrl: { ios: 'x', android: 'x' }, variants: [] },
    scenes: [{ id: 's1', name: 'One', kind: 'custom', advance: { on: 'tap' }, bgColor: '#111111', elements: [el()] }],
    startSceneId: 's1',
  }) as unknown as Project

const baseEl = () => getState().project.scenes[0].elements[0]
const baseScene = () => getState().project.scenes[0]

describe('variant edit-mode isolation', () => {
  beforeEach(() => {
    setActiveVariant(null)
    loadProject(makeProject(), {}, null)
    setSelection(['a'])
  })

  it('align in variant mode writes a variant override, not the base', () => {
    const vid = addVariant('V1')
    setActiveVariant(vid)
    alignSelected('left')
    // base element untouched
    expect(baseEl().x).toBe(100)
    expect(baseEl().anchor).toBe('center')
    // variant carries the override
    const patch = getState().project.meta.variants!.find((v) => v.id === vid)!.patches.find((p) => p.elementId === 'a')!.patch
    expect(patch.x).toBe(0)
    expect(patch.anchor).toBe('left')
  })

  it('scene background, lock, and convert are no-ops on the base in variant mode', () => {
    const vid = addVariant('V1')
    setActiveVariant(vid)
    setSceneBg('#ffffff')
    toggleLock('a')
    convertElement('a', 'cta')
    expect(baseScene().bgColor).toBe('#111111')
    expect(baseEl().locked).toBeFalsy()
    expect(baseEl().type).toBe('text')
  })

  it('the same ops DO apply to the base when no variant is active', () => {
    alignSelected('left')
    setSceneBg('#ffffff')
    toggleLock('a')
    expect(baseEl().x).toBe(0)
    expect(baseScene().bgColor).toBe('#ffffff')
    expect(baseEl().locked).toBe(true)
  })
})
