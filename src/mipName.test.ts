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
    expect(fileBaseName(project())).toBe('the_loaded_tea_shop_acslanot_mip_20260730_04_emily_game_scratch_human_unique')
  })

  it('normalizes scratch grid to scratch and uses the mip token for the version slot', () => {
    expect(fileBaseName(project({ mip: 'MIP7', mipVersion: '02' }, 'scratch_grid'))).toBe('the_loaded_tea_shop_acslanot_mip_20260730_07_emily_game_scratch_human_unique')
  })

  it('names the mechanic slot unknown when the MIP has no minigame', () => {
    expect(fileBaseName(project({ client: 'Laura Geller', mip: 'MIP2', exportDate: '2026-08-17' }, null)))
      .toBe('laura_geller_acslanot_mip_20260817_02_emily_game_unknown_human_unique')
  })

  it('ends in none when the MIP is marked non-unique', () => {
    expect(fileBaseName(project({ client: 'Laura Geller', mip: 'MIP2', exportDate: '2026-08-17', unique: false }, null)))
      .toBe('laura_geller_acslanot_mip_20260817_02_emily_game_unknown_human_none')
    expect(fileBaseName(project({ unique: true }))).toBe('the_loaded_tea_shop_acslanot_mip_20260730_04_emily_game_scratch_human_unique')
  })

  it('falls back to mipDate and today when export pieces are missing', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T09:00:00'))
    expect(fileBaseName(project({ client: '', mip: '', exportDate: '', mipDate: '2026-07-05' }, 'merge'))).toBe('client_acslanot_mip_20260705_00_emily_game_merge_human_unique')
    expect(fileBaseName(project({ client: '', mip: '', exportDate: '', mipDate: '' }, 'merge'))).toBe('client_acslanot_mip_20260803_00_emily_game_merge_human_unique')
    vi.useRealTimers()
  })
})
