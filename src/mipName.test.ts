import { describe, expect, it, vi } from 'vitest'
import { fileBaseName } from './mipName'
import type { Project } from '../runtime/scene'

function project(overrides: Partial<Project['meta']> = {}, templateId: string | null = 'scratch'): Project {
  return {
    meta: {
      schemaVersion: 2,
      name: 'Test Project',
      clickUrl: { ios: '', android: '' },
      baseW: 1080,
      baseH: 1920,
      client: 'The Loaded Tea Shop',
      mip: 'MIP4',
      exportDate: '2026-07-30',
      ...overrides,
    },
    scenes: [{
      id: 'scene1',
      name: 'Game',
      kind: 'game',
      advance: { on: 'manual' },
      elements: templateId
        ? [{ id: 'game1', type: 'game-mount', name: 'Game', x: 0, y: 0, anchor: 'center', zIndex: 1, mode: 'fit', game: { templateId, params: {} } }]
        : [],
    }],
    startSceneId: 'scene1',
  }
}

describe('fileBaseName', () => {
  it('builds the requested delivery filename format', () => {
    expect(fileBaseName(project())).toBe('the_loaded_tea_shop_acslanot_mip_20260730_04_emily_game_scratch_human_none_unique')
  })

  it('normalizes scratch grid to scratch and uses the mip token for the version slot', () => {
    expect(fileBaseName(project({ mip: 'MIP7', mipVersion: '02' }, 'scratch_grid'))).toBe('the_loaded_tea_shop_acslanot_mip_20260730_07_emily_game_scratch_human_none_unique')
  })

  it('names the mechanic slot unknown when the MIP has no minigame', () => {
    expect(fileBaseName(project({ client: 'Laura Geller', mip: 'MIP2', exportDate: '2026-08-17' }, null)))
      .toBe('laura_geller_acslanot_mip_20260817_02_emily_game_unknown_human_none_unique')
  })

  it('names the dynamic date slot before the unique slot', () => {
    expect(fileBaseName(project({ dynamicDate: 'dd' })))
      .toBe('the_loaded_tea_shop_acslanot_mip_20260730_04_emily_game_scratch_human_dd_unique')
    expect(fileBaseName(project({ dynamicDate: 'dt' })))
      .toBe('the_loaded_tea_shop_acslanot_mip_20260730_04_emily_game_scratch_human_dt_unique')
    expect(fileBaseName(project({ dynamicDate: 'none', unique: false })))
      .toBe('the_loaded_tea_shop_acslanot_mip_20260730_04_emily_game_scratch_human_none_none')
    expect(fileBaseName(project({ dynamicDate: 'dd', unique: true })))
      .toBe('the_loaded_tea_shop_acslanot_mip_20260730_04_emily_game_scratch_human_dd_unique')
  })

  it('ends in none when the MIP is marked non-unique', () => {
    expect(fileBaseName(project({ client: 'Laura Geller', mip: 'MIP2', exportDate: '2026-08-17', unique: false }, null)))
      .toBe('laura_geller_acslanot_mip_20260817_02_emily_game_unknown_human_none_none')
    expect(fileBaseName(project({ unique: true }))).toBe('the_loaded_tea_shop_acslanot_mip_20260730_04_emily_game_scratch_human_none_unique')
  })

  it('names a single endscene project as a sip product carousel', () => {
    const p = project({ client: 'Buckley Belts', mip: 'MIP2', exportDate: '2026-08-14' }, null)
    p.scenes = [{ id: 'end1', name: 'End card', kind: 'endscene', advance: { on: 'manual' }, elements: [] }]
    p.startSceneId = 'end1'
    expect(fileBaseName(p)).toBe('buckley_belts_acslanot_sip_20260814_02_emily_product_carousel_human_none_unique')
    p.meta.sipFormat = 'card'
    expect(fileBaseName(p)).toBe('buckley_belts_acslanot_sip_20260814_02_emily_product_card_human_none_unique')
    p.meta.unique = false
    expect(fileBaseName(p)).toBe('buckley_belts_acslanot_sip_20260814_02_emily_product_card_human_none_none')
  })

  it('treats a lone overlay end card as a sip, but never a multi-scene project', () => {
    const p = project({ client: 'Buckley Belts', mip: 'MIP2', exportDate: '2026-08-14' }, null)
    p.scenes = [{ id: 'end1', name: 'End card', kind: 'overlay', asEndscene: true, advance: { on: 'manual' }, elements: [] }]
    expect(fileBaseName(p)).toBe('buckley_belts_acslanot_sip_20260814_02_emily_product_carousel_human_none_unique')
    p.scenes = [...p.scenes, { id: 'end2', name: 'End card 2', kind: 'endscene', advance: { on: 'manual' }, elements: [] }]
    expect(fileBaseName(p)).toBe('buckley_belts_acslanot_mip_20260814_02_emily_game_unknown_human_none_unique')
  })

  it('keeps the mip name for a lone game scene', () => {
    expect(fileBaseName(project())).toContain('_acslanot_mip_')
  })

  it('falls back to mipDate and today when export pieces are missing', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T09:00:00'))
    expect(fileBaseName(project({ client: '', mip: '', exportDate: '', mipDate: '2026-07-05' }, 'merge'))).toBe('client_acslanot_mip_20260705_00_emily_game_merge_human_none_unique')
    expect(fileBaseName(project({ client: '', mip: '', exportDate: '', mipDate: '' }, 'merge'))).toBe('client_acslanot_mip_20260803_00_emily_game_merge_human_none_unique')
    vi.useRealTimers()
  })
})
