import { describe, it, expect } from 'vitest'
import { lintEngagement } from './engagement'
import type { Project, SceneDef, SceneElement } from '../../runtime/scene'

const el = (id: string, extra: Partial<SceneElement> = {}): SceneElement => ({ id, type: 'text', name: id, x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit', ...extra })
const scene = (id: string, els: SceneElement[], extra: Partial<SceneDef> = {}): SceneDef => ({ id, name: id, kind: 'overlay', advance: { on: 'manual' }, elements: els, ...extra })
const proj = (scenes: SceneDef[]): Project => ({ meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 }, scenes, startSceneId: scenes[0].id })

describe('lintEngagement', () => {
  it('flags an ad with no interaction', () => {
    const f = lintEngagement(proj([scene('s1', [el('t')])]), {})
    expect(f.some((x) => x.id === 'no-interaction')).toBe(true)
  })
  it('flags a dead-end non-final scene', () => {
    const f = lintEngagement(proj([scene('s1', [el('t')]), scene('s2', [el('c', { type: 'cta' })], { kind: 'endscene' })]), {})
    expect(f.some((x) => x.id === 'stuck:s1')).toBe(true)
  })
  it('flags a missing asset reference', () => {
    const f = lintEngagement(proj([scene('s1', [el('img', { type: 'image', assetId: 'missing' })], { advance: { on: 'tap' } })]), {})
    expect(f.some((x) => x.id === 'asset:img')).toBe(true)
  })
  it('flags advance-on-gameWin without a game', () => {
    const f = lintEngagement(proj([scene('s1', [el('c', { type: 'cta' })], { advance: { on: 'gameWin' } })]), {})
    expect(f.some((x) => x.id === 'nowin:s1')).toBe(true)
  })
  it('is error-free for an interactive scene with a real CTA', () => {
    const f = lintEngagement(proj([scene('s1', [el('c', { type: 'cta', h: 160 })], { advance: { on: 'tap' } })]), {})
    expect(f.filter((x) => x.severity === 'error')).toHaveLength(0)
  })
})
