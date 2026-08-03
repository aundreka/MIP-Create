import { describe, expect, it } from 'vitest'
import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import { analyzeAssetFlipUploads, assetFlipRenameErrors, buildAssetFlipData, collectAssetFlipSlots } from './assetFlip'

const project = {
  meta: { schemaVersion: 1, name: 'Scratch', baseW: 1080, baseH: 1920, clickUrl: { ios: '', android: '' }, header: { fontFamily: 'brand_font' } },
  startSceneId: 'game',
  scenes: [{
    id: 'game', name: 'Game', kind: 'game', advance: { on: 'manual' }, elements: [
      { id: 'scratch', type: 'game-mount', name: 'Scratch', x: 0, y: 0, anchor: 'center', zIndex: 1, mode: 'fit', assetId: 'hero', background: { landscapeAssetId: 'hero_landscape' }, game: { templateId: 'scratch_grid', params: { cover: 'scratch_cover', cell0: 'cell_1', cell1: 'cell_2', revealAssets: '[{"src":"threshold_art","showAt":0.5}]' } } },
      { id: 'bar-el', type: 'bar', name: 'Bar', x: 0, y: 0, anchor: 'top', zIndex: 2, mode: 'extend' },
      { id: 'cta-el', type: 'cta', name: 'CTA', x: 0, y: 0, anchor: 'center', zIndex: 3, mode: 'fit' },
    ],
  }],
} as unknown as Project

const image = (src: string) => ({ src, w: 100, h: 100 })
const assets: AssetMap = {
  hero: image('hero'), hero_landscape: image('landscape'), scratch_cover: image('cover'),
  cell_1: image('one'), cell_2: image('two'), bar: image('bar'), cta: image('cta'),
  threshold_art: image('threshold'),
  unused: image('unused'), brand_font: { src: 'font', w: 0, h: 0, kind: 'font' },
}

describe('asset flip', () => {
  it('discovers nested minigame, cell, landscape, and ordinary image references', () => {
    const slots = collectAssetFlipSlots(project, assets)
    expect(slots.map((slot) => slot.id)).toEqual([
      'cell_1', 'cell_2', 'hero', 'hero_landscape', 'scratch_cover', 'threshold_art',
    ])
    expect(slots.find((slot) => slot.id === 'scratch_cover')!.sceneNames).toEqual(['Game'])
  })

  it('reports missing, extra, and duplicate uploads by case-insensitive filename stem', () => {
    const upload = (name: string) => ({ name, asset: image(name) })
    const result = analyzeAssetFlipUploads(['cover_new', 'reveal_new'], [upload('COVER_NEW.PNG'), upload('cover_new.webp'), upload('extra.jpg')])
    expect(result.missing).toEqual(['reveal_new'])
    expect(result.duplicate).toEqual(['cover_new'])
    expect(result.extra.map((x) => x.name)).toEqual(['extra.jpg'])
  })

  it('renames nested references and swaps the uploaded bytes and dimensions', () => {
    const replacement = { src: 'new-cover', w: 500, h: 600 }
    const out = buildAssetFlipData(project, assets, 'New Brand', { scratch_cover: 'new_cover', threshold_art: 'new_threshold' }, { new_cover: replacement })
    const params = out.project.scenes[0].elements[0].game!.params as Record<string, unknown>
    expect(params.cover).toBe('new_cover')
    expect(JSON.parse(params.revealAssets as string)[0].src).toBe('new_threshold')
    expect(out.assets.new_cover).toEqual(replacement)
    expect(out.assets.scratch_cover).toBeUndefined()
    expect(out.project.meta.name).toBe('New Brand')
  })

  it('keeps the current artwork when a renamed asset has no uploaded replacement', () => {
    const out = buildAssetFlipData(project, assets, 'Copy', { hero: 'Game - hero' }, {})
    expect(out.project.scenes[0].elements[0].assetId).toBe('Game - hero')
    expect(out.assets['Game - hero']).toEqual(assets.hero)
  })

  it('lets a referenced rename replace a stale unreferenced image-library id', () => {
    const out = buildAssetFlipData(project, assets, 'Copy', { hero: 'unused' }, {})
    expect(out.assets.unused).toEqual(assets.hero)
    expect(out.project.scenes[0].elements[0].assetId).toBe('unused')
  })

  it('allows multiple referenced elements to intentionally share one new asset', () => {
    const shared = image('shared-win')
    const out = buildAssetFlipData(project, assets, 'Copy', { hero: 'win', hero_landscape: 'win' }, { win: shared })
    const el = out.project.scenes[0].elements[0]
    expect(el.assetId).toBe('win')
    expect(el.background?.landscapeAssetId).toBe('win')
    expect(el.type).toBe('game-mount')
    expect(out.assets.win).toEqual(shared)
    expect(assetFlipRenameErrors({ hero: 'win', hero_landscape: 'win' }, [])).toEqual([])
  })

  it('rejects blank names and non-image collisions', () => {
    expect(assetFlipRenameErrors({ hero: '', scratch_cover: 'brand_font' }, Object.keys(assets))).toHaveLength(2)
  })
})
