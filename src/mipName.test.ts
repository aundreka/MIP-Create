import { describe, expect, it, vi } from 'vitest'
import { fileBaseName, mipFolderName, mipName } from './mipName'
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
    scenes: [
      {
        id: 'scene1',
        name: 'Game',
        kind: 'game',
        advance: { on: 'manual' },
        elements: templateId ? [{ id: 'game1', type: 'game-mount', name: 'Game', x: 0, y: 0, anchor: 'center', zIndex: 1, mode: 'fit', game: { templateId, params: {} } }] : [],
      },
    ],
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
    expect(fileBaseName(project({ client: 'Laura Geller', mip: 'MIP2', exportDate: '2026-08-17' }, null))).toBe(
      'laura_geller_acslanot_mip_20260817_02_emily_game_unknown_human_none_unique',
    )
  })

  it('names the subconcept slot before the unique slot', () => {
    const stem = 'the_loaded_tea_shop_acslanot_mip_20260730_04_emily_game_scratch_human'
    for (const subconcept of ['dd', 'dt', 'dh', 'dtd', 'none'] as const) {
      expect(fileBaseName(project({ subconcept }))).toBe(`${stem}_${subconcept}_unique`)
    }
    expect(fileBaseName(project({ subconcept: 'none', unique: false }))).toBe(`${stem}_none_none`)
    expect(fileBaseName(project({ subconcept: 'dd', unique: true }))).toBe(`${stem}_dd_unique`)
    expect(fileBaseName(project({ subconcept: 'dtd', unique: false }))).toBe(`${stem}_dtd_none`)
  })

  it('ends in none when the MIP is marked non-unique', () => {
    expect(fileBaseName(project({ client: 'Laura Geller', mip: 'MIP2', exportDate: '2026-08-17', unique: false }, null))).toBe(
      'laura_geller_acslanot_mip_20260817_02_emily_game_unknown_human_none_none',
    )
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
    expect(fileBaseName(project({ client: '', mip: '', exportDate: '', mipDate: '2026-07-05' }, 'merge'))).toBe(
      'client_acslanot_mip_20260705_00_emily_game_merge_human_none_unique',
    )
    expect(fileBaseName(project({ client: '', mip: '', exportDate: '', mipDate: '' }, 'merge'))).toBe('client_acslanot_mip_20260803_00_emily_game_merge_human_none_unique')
    vi.useRealTimers()
  })
})

describe('mipName', () => {
  it('joins Client + MIP + Date, keeping a stored mipDate authoritative', () => {
    expect(mipName({ client: 'Bioma', mip: 'MIP3', mipDate: '2026-07-01', name: 'x' })).toBe('Bioma MIP3 2026-07-01')
  })

  it('falls back to exportDate, then today, when mipDate is blank but an identity is set', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T09:00:00'))
    expect(mipName({ client: 'Bioma', mip: 'MIP3', mipDate: '', exportDate: '2026-07-30', name: 'x' })).toBe('Bioma MIP3 2026-07-30')
    expect(mipName({ client: 'Bioma', mip: '', mipDate: '', exportDate: '', name: 'x' })).toBe('Bioma 2026-08-03')
    vi.useRealTimers()
  })

  it('keeps the free-text name fallback when no identity is set, dateless', () => {
    expect(mipName({ client: '', mip: '', mipDate: '', exportDate: '2026-07-30', name: 'My draft' })).toBe('My draft')
    expect(mipName({ client: '', mip: '', mipDate: '', name: '' })).toBe('Untitled')
  })
})

describe('mipFolderName', () => {
  it('names the folder MIP<n> - <MECHANIC> in capitals', () => {
    expect(mipFolderName(project({ mip: 'MIP1' }, 'scratch'))).toBe('MIP1 - SCRATCH')
    expect(mipFolderName(project({ mip: 'mip 03' }, 'scratch_grid'))).toBe('MIP3 - SCRATCH')
    expect(mipFolderName(project({ mip: 'MIP2' }, 'tap_reveal'))).toBe('MIP2 - TAP REVEAL')
  })

  it('prefers the Game name override and strips folder-illegal characters', () => {
    expect(mipFolderName(project({ mip: 'MIP1', gameName: 'Lucky: Scratch/Win' }))).toBe('MIP1 - LUCKY SCRATCH WIN')
  })

  it('falls back to the list position without MIP digits, and drops the suffix without a game', () => {
    expect(mipFolderName(project({ mip: '' }, null), 4)).toBe('MIP5')
  })

  it('names a SIP folder SIP', () => {
    const sip = project({ mip: 'MIP2' }, null)
    sip.scenes[0].kind = 'endscene'
    expect(mipFolderName(sip)).toBe('MIP2 - SIP')
  })
})
