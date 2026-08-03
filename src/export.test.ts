import { describe, it, expect } from 'vitest'
import { blurWarnings, buildBaseHtml, pruneAssets, stripSourceMap } from './export'
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

  it('keeps a background landscape image', () => {
    const assets: AssetMap = { p: { src: 'a', w: 1, h: 1 }, l: { src: 'b', w: 1, h: 1 }, none: { src: 'c', w: 1, h: 1 } }
    const proj: Project = {
      meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      scenes: [{ id: 's1', name: 's1', kind: 'game', advance: { on: 'manual' }, elements: [{ id: 'bg', type: 'background', name: 'bg', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'extend', assetId: 'p', background: { objectFit: 'cover', landscapeAssetId: 'l' } }] }],
      startSceneId: 's1',
    }
    expect(Object.keys(pruneAssets(proj, assets)).sort()).toEqual(['l', 'p'])
  })

  it('keeps optional per-language element assets', () => {
    const assets: AssetMap = { en: { src: 'a', w: 1, h: 1 }, es: { src: 'b', w: 1, h: 1 }, unused: { src: 'c', w: 1, h: 1 } }
    const proj: Project = {
      meta: { schemaVersion: 2, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, locales: ['es'] },
      scenes: [{ id: 's1', name: 's1', kind: 'game', advance: { on: 'manual' }, elements: [{ id: 'hero', type: 'image', name: 'Hero', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit', assetId: 'en', localeOverrides: { es: { assetId: 'es' } } }] }],
      startSceneId: 's1',
    }
    expect(Object.keys(pruneAssets(proj, assets)).sort()).toEqual(['en', 'es'])
  })
})

describe('source map stripping', () => {
  const proj: Project = {
    meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    scenes: [{ id: 's1', name: 's1', kind: 'game', advance: { on: 'manual' }, elements: [] }],
    startSceneId: 's1',
  }

  it('removes an inline sourceMappingURL data URI from the runtime', () => {
    const rt = 'console.log(1);\n\n//# sourceMappingURL=data:application/json;base64,' + 'A'.repeat(5000)
    const html = buildBaseHtml(proj, {}, rt)
    expect(html).toContain('console.log(1);')
    expect(html).not.toContain('sourceMappingURL')
    expect(html.length).toBeLessThan(3000)
  })

  it('stripSourceMap leaves ordinary code untouched', () => {
    const js = 'const a = 1; // normal comment\nconst b = "sourceMappingURL in a string is fine"'
    expect(stripSourceMap(js)).toBe(js)
  })

  it('export shell carries the user-select guards (whole-screen selection bug)', () => {
    const html = buildBaseHtml(proj, {}, 'x')
    expect(html).toContain('user-select:none')
    expect(html).toContain('-webkit-tap-highlight-color:transparent')
  })
})

describe('font size warnings', () => {
  const projWith = (assetIds: string[]): Project => ({
    meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    scenes: [{ id: 's1', name: 's1', kind: 'game', advance: { on: 'manual' }, elements: assetIds.map((id, i) => ({ id: `e${i}`, type: 'image' as const, name: id, x: 0, y: 0, anchor: 'center' as const, zIndex: 0, mode: 'fit' as const, assetId: id })) }],
    startSceneId: 's1',
  })

  it('flags a standalone font asset over the threshold', () => {
    const big = 'data:font/ttf;base64,' + 'A'.repeat(500 * 1024)
    const warns = blurWarnings(projWith([]), { BigFont: { src: big, w: 0, h: 0, kind: 'font' } })
    expect(warns.some((w) => w.includes('BigFont') && w.includes('Subset'))).toBe(true)
  })

  it('flags a large font embedded inside an imported HTML asset', () => {
    const inner = `<style>@font-face{font-family:"X";src:url(data:application/octet-stream;base64,${'B'.repeat(500 * 1024)}) format("truetype");}</style>`
    const html = 'data:text/html;base64,' + btoa(inner)
    const warns = blurWarnings(projWith([]), { endcard: { src: html, w: 0, h: 0, kind: 'html' } })
    expect(warns.some((w) => w.includes('endcard') && w.includes('font'))).toBe(true)
  })

  it('stays quiet for small fonts', () => {
    const warns = blurWarnings(projWith([]), { SmallFont: { src: 'data:font/ttf;base64,' + 'A'.repeat(1024), w: 0, h: 0, kind: 'font' } })
    expect(warns).toEqual([])
  })
})
