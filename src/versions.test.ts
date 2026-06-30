import { describe, it, expect } from 'vitest'
import { diffProjects } from './versions'
import type { Project, SceneDef, SceneElement } from '../runtime/scene'

const el = (id: string, extra: Partial<SceneElement> = {}): SceneElement => ({ id, type: 'text', name: id, x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit', ...extra })
const scene = (id: string, els: SceneElement[], extra: Partial<SceneDef> = {}): SceneDef => ({ id, name: id, kind: 'overlay', advance: { on: 'manual' }, elements: els, ...extra })
const proj = (scenes: SceneDef[], meta: Partial<Project['meta']> = {}): Project => ({ meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, ...meta }, scenes, startSceneId: scenes[0]?.id ?? 's1' })

describe('diffProjects', () => {
  it('reports nothing for identical projects', () => {
    const a = proj([scene('s1', [el('t', { x: 10 })])])
    expect(diffProjects(a, structuredClone(a))).toHaveLength(0)
  })

  it('detects a moved element', () => {
    const a = proj([scene('s1', [el('t', { x: 10 })])])
    const b = proj([scene('s1', [el('t', { x: 99 })])])
    const lines = diffProjects(a, b)
    expect(lines.some((l) => l.scope === 'element' && l.kind === 'change' && /moved/.test(l.text))).toBe(true)
  })

  it('detects added and removed scenes', () => {
    const a = proj([scene('s1', [el('t')])])
    const b = proj([scene('s1', [el('t')]), scene('s2', [el('u')])])
    const lines = diffProjects(a, b)
    expect(lines.some((l) => l.scope === 'scene' && l.kind === 'add')).toBe(true)
    expect(diffProjects(b, a).some((l) => l.scope === 'scene' && l.kind === 'remove')).toBe(true)
  })

  it('detects meta + text changes', () => {
    const a = proj([scene('s1', [el('t', { text: { value: 'Hi', fontSizePx: 40 } })])], { mip: 'MIP1' })
    const b = proj([scene('s1', [el('t', { text: { value: 'Hello', fontSizePx: 40 } })])], { mip: 'MIP2' })
    const lines = diffProjects(a, b)
    expect(lines.some((l) => l.scope === 'meta' && /MIP/.test(l.text))).toBe(true)
    expect(lines.some((l) => l.scope === 'element' && /text/.test(l.text))).toBe(true)
  })
})
