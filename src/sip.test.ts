import { describe, expect, it } from 'vitest'
import type { Project, SceneDef } from '../runtime/scene'
import { fileBaseName } from './mipName'
import { buildSipProject, endcardScenes } from './sip'

const scene = (id: string, kind: SceneDef['kind'], extra: Partial<SceneDef> = {}): SceneDef => ({
  id,
  name: id,
  kind,
  advance: { on: 'manual' },
  elements: [],
  ...extra,
})

function mip(scenes: SceneDef[], meta: Partial<Project['meta']> = {}): Project {
  return {
    meta: {
      schemaVersion: 2,
      name: 'x',
      clickUrl: { ios: '', android: '' },
      baseW: 1080,
      baseH: 1920,
      client: 'Wolt',
      mip: 'MIP3',
      exportDate: '2026-09-24',
      subconcept: 'dd',
      sessionTimer: { ms: 30000, to: 'lose' },
      variants: [{ id: 'v', name: 'hard', patches: [] }],
      ...meta,
    },
    scenes,
    startSceneId: scenes[0].id,
  }
}

describe('buildSipProject', () => {
  it('keeps only the end card and names the file as a SIP', () => {
    const p = mip([scene('game', 'game'), scene('win', 'overlay'), scene('end', 'endscene')])
    const sip = buildSipProject(p)!
    expect(sip.scenes.map((s) => s.id)).toEqual(['end'])
    expect(sip.startSceneId).toBe('end')
    expect(sip.meta.sessionTimer).toBeUndefined()
    expect(sip.meta.variants).toBeUndefined()
    expect(fileBaseName(sip)).toBe('wolt_acslanot_sip_20260924_03_emily_product_carousel_human_dd_unique')
  })

  it('counts an overlay marked as the end card, and honours meta.sipSceneId', () => {
    const scenes = [scene('game', 'game'), scene('card', 'overlay', { asEndscene: true }), scene('end', 'endscene')]
    expect(endcardScenes(mip(scenes)).map((s) => s.id)).toEqual(['card', 'end'])
    expect(buildSipProject(mip(scenes))!.scenes[0].id).toBe('card')
    expect(buildSipProject(mip(scenes, { sipSceneId: 'end' }))!.scenes[0].id).toBe('end')
    expect(buildSipProject(mip(scenes, { sipSceneId: 'game' }))!.scenes[0].id).toBe('card')
  })

  it('returns null without an end card', () => {
    expect(buildSipProject(mip([scene('game', 'game')]))).toBeNull()
  })
})
