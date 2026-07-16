import { describe, it, expect } from 'vitest'
import { pruneAssets } from './export'
import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'

describe('pruneAssets', () => {
  it('keeps only referenced element assets', () => {
    const assets: AssetMap = { used: { src: 'a', w: 1, h: 1 }, unused: { src: 'b', w: 1, h: 1 } }
    const p: Project = {
      meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      scenes: [{ id: 's1', name: 's1', kind: 'overlay', advance: { on: 'manual' }, elements: [{ id: 'i', type: 'image', name: 'i', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit', assetId: 'used' }] }],
      startSceneId: 's1',
    }
    expect(Object.keys(pruneAssets(p, assets))).toEqual(['used'])
  })

  it('keeps element-level SFX and project-level SFX assets', () => {
    const assets: AssetMap = { s1: { src: 'a', w: 0, h: 0, kind: 'audio' }, s2: { src: 'b', w: 0, h: 0, kind: 'audio' }, none: { src: 'c', w: 1, h: 1 } }
    const p: Project = {
      meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      scenes: [{ id: 's1', name: 's1', kind: 'overlay', advance: { on: 'manual' }, elements: [{ id: 'e', type: 'cta', name: 'e', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit', sfx: [{ event: 'tap', assetId: 's1' }] }] }],
      startSceneId: 's1',
      sfx: [{ event: 'gameWin', assetId: 's2' }],
    }
    expect(Object.keys(pruneAssets(p, assets)).sort()).toEqual(['s1', 's2'])
  })

  it('keeps a font referenced only by the pinned header', () => {
    const assets: AssetMap = { My_Font: { src: 'data:font/ttf;base64,AA==', w: 0, h: 0, kind: 'font' }, other: { src: 'x', w: 1, h: 1 } }
    const p: Project = {
      meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, header: { fontFamily: 'My_Font' } },
      scenes: [{ id: 's1', name: 's1', kind: 'overlay', advance: { on: 'manual' }, elements: [] }],
      startSceneId: 's1',
    }
    expect(Object.keys(pruneAssets(p, assets))).toEqual(['My_Font'])
  })
})
