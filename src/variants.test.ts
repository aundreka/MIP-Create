import { describe, it, expect } from 'vitest'
import { applyVariant, applyVariantPatches, stripVariants } from './variants'
import type { Project, SceneDef, SceneElement, Variant } from '../runtime/scene'

const el = (id: string, extra: Partial<SceneElement> = {}): SceneElement => ({ id, type: 'text', name: id, x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit', ...extra })
const scene = (id: string, els: SceneElement[]): SceneDef => ({ id, name: id, kind: 'overlay', advance: { on: 'manual' }, elements: els })
const project = (): Project => ({
  meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, variants: [{ id: 'v1', name: 'V1', patches: [] }] },
  scenes: [scene('s1', [el('a', { x: 0 })])],
  startSceneId: 's1',
})

describe('applyVariantPatches', () => {
  it('overrides only matching elements', () => {
    const els = [el('a', { x: 1 }), el('b', { x: 2 })]
    const out = applyVariantPatches(els, [{ elementId: 'b', patch: { x: 99 } }])
    expect(out[0].x).toBe(1)
    expect(out[1].x).toBe(99)
  })
  it('returns the same array when there are no patches', () => {
    const els = [el('a')]
    expect(applyVariantPatches(els, [])).toBe(els)
  })
})

describe('applyVariant / stripVariants', () => {
  it('bakes a variant across scenes and strips variant meta', () => {
    const v: Variant = { id: 'v1', name: 'V1', patches: [{ elementId: 'a', patch: { x: 50 } }] }
    const out = applyVariant(project(), v)
    expect(out.scenes[0].elements[0].x).toBe(50)
    expect(out.meta.variants).toBeUndefined()
  })
  it('stripVariants removes variant meta without touching elements', () => {
    const out = stripVariants(project())
    expect(out.meta.variants).toBeUndefined()
    expect(out.scenes[0].elements[0].x).toBe(0)
  })
})
