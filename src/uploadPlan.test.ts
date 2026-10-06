import { beforeEach, describe, expect, it } from 'vitest'
import type { Project, SceneDef } from '../runtime/scene'
import { allKeys, buildUploadPlan, initialPicks, itemKey, mipLabel, planRequests, pruneKeys, savePicks, selectedCount } from './uploadPlan'

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
      name: 'Memowrite MIP7',
      clickUrl: { ios: '', android: '' },
      baseW: 1080,
      baseH: 1920,
      client: 'Memowrite',
      mip: 'MIP7',
      exportDate: '2026-09-29',
      ...meta,
    },
    scenes,
    startSceneId: scenes[0].id,
  }
}

const withEndcard = (meta: Partial<Project['meta']> = {}): Project => mip([scene('game', 'game'), scene('end', 'endscene')], meta)
const noEndcard = (meta: Partial<Project['meta']> = {}): Project => mip([scene('game', 'game')], meta)

const source = (id: string, project: Project) => ({ id, name: project.meta.name, project })

describe('buildUploadPlan', () => {
  it('offers the MIP, each variant and the SIP, in delivery order', () => {
    const plan = buildUploadPlan([source('p1', withEndcard({ variants: [{ id: 'v1', name: 'hard', patches: [] }] }))])
    expect(plan[0].items.map((i) => [i.kind, i.label])).toEqual([
      ['mip', 'MIP7'],
      ['variant', 'hard'],
      ['sip', 'SIP'],
    ])
    expect(plan[0].items[0].fileName).toBe('memowrite_acslanot_mip_20260929_07_emily_game_unknown_human_none_unique.html')
    expect(plan[0].items[2].fileName).toBe('memowrite_acslanot_sip_20260929_07_emily_product_carousel_human_none_unique.html')
  })

  it('offers no SIP row for a MIP with no end card', () => {
    const plan = buildUploadPlan([source('p1', noEndcard())])
    expect(plan[0].items.map((i) => i.kind)).toEqual(['mip'])
  })

  it('reads the MIP number off meta.mip, and labels an unnumbered MIP plainly', () => {
    expect(mipLabel(noEndcard({ mip: '7' }))).toBe('MIP7')
    expect(mipLabel(noEndcard({ mip: 'mip 7' }))).toBe('MIP7')
    expect(mipLabel(noEndcard({ mip: '' }))).toBe('')
    expect(buildUploadPlan([source('p1', noEndcard({ mip: '' }))])[0].items[0].label).toBe('MIP')
  })
})

describe('planRequests', () => {
  const plan = buildUploadPlan([
    source('p1', withEndcard({ variants: [{ id: 'v1', name: 'hard', patches: [] }] })),
    source('p2', withEndcard({ mip: 'MIP8' })),
  ])

  it('sends "mip1, sip1, mip2" — the batch the ticks describe', () => {
    const picked = new Set([itemKey('p1', 'mip'), itemKey('p1', 'sip'), itemKey('p2', 'mip')])
    expect(planRequests(plan, picked)).toEqual([
      { sourceId: 'p1', mip: true, variantIds: [], sip: true },
      { sourceId: 'p2', mip: true, variantIds: [], sip: false },
    ])
  })

  it('sends a SIP on its own when the MIP is unticked', () => {
    expect(planRequests(plan, new Set([itemKey('p2', 'sip')]))).toEqual([{ sourceId: 'p2', mip: false, variantIds: [], sip: true }])
  })

  it('leaves out a playable with nothing ticked', () => {
    expect(planRequests(plan, new Set([itemKey('p1', 'variant', 'v1')]))).toEqual([
      { sourceId: 'p1', mip: false, variantIds: ['v1'], sip: false },
    ])
  })

  it('counts the ticked files', () => {
    expect(selectedCount(plan, allKeys(plan))).toBe(5)
    expect(selectedCount(plan, new Set([itemKey('p1', 'sip'), 'gone']))).toBe(1)
  })
})

describe('remembered ticks', () => {
  beforeEach(() => localStorage.clear())

  it('starts with everything ticked', () => {
    const plan = buildUploadPlan([source('p1', withEndcard())])
    expect(initialPicks(plan, 'p1')).toEqual(allKeys(plan))
  })

  it('offers the same picks the next time the batch is uploaded', () => {
    const plan = buildUploadPlan([source('p1', withEndcard())])
    savePicks('p1', [itemKey('p1', 'sip')])
    expect([...initialPicks(plan, 'p1')]).toEqual([itemKey('p1', 'sip')])
  })

  it('drops a remembered row that no longer exists, and falls back to all when none is left', () => {
    const plan = buildUploadPlan([source('p1', noEndcard())])
    expect([...pruneKeys(plan, [itemKey('p1', 'sip'), itemKey('p1', 'mip')])]).toEqual([itemKey('p1', 'mip')])
    savePicks('p1', [itemKey('p1', 'sip')]) // the end card was deleted since
    expect(initialPicks(plan, 'p1')).toEqual(allKeys(plan))
  })
})
