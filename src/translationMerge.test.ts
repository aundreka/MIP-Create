import { describe, expect, it } from 'vitest'
import type { ProjectData } from './bridge'
import { buildSceneTranslation, combineTranslatedPlayables, inferLanguageCode } from './translationMerge'
import { localizeElement, localizeSceneDef } from '../runtime/i18n'
import { pruneAssets } from './export'

function playable(name: string, sceneId: string, elementId: string, copy: string, assetSrc: string, x: number): ProjectData {
  return {
    project: {
      meta: { schemaVersion: 2, name, clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      startSceneId: sceneId,
      scenes: [{
        id: sceneId,
        name: 'Main',
        kind: 'game',
        advance: { on: 'manual' },
        elements: [{
          id: elementId,
          type: 'image',
          name: 'Hero',
          assetId: 'hero',
          x,
          y: 200,
          anchor: 'center',
          zIndex: 1,
          mode: 'fit',
          landscape: { x: x + 100, y: 300 },
          text: { value: copy, fontSizePx: 42 },
          animations: { entrance: { preset: 'fade', durationMs: 400, delayMs: 0, easing: 'ease' } },
        }],
      }],
    },
    assets: { hero: { src: assetSrc, w: 100, h: 100 } },
  }
}

describe('combineTranslatedPlayables', () => {
  it('combines complete language copies and remaps colliding asset and element ids', () => {
    const english = playable('Campaign English', 'scene-en', 'hero-en', 'Hello', 'data:image/png;base64,EN', 100)
    const german = playable('Campaign German', 'scene-de', 'hero-de', 'Hallo', 'data:image/png;base64,DE', 250)
    const spanish = playable('Campaign Spanish', 'scene-es', 'hero-es', 'Hola', 'data:image/png;base64,ES', 350)
    english.project.meta.header = { prefix: 'Today: ', fontFamily: 'header-font' }
    english.assets['header-font'] = { src: 'data:font/ttf;base64,EN', w: 0, h: 0, kind: 'font' }
    german.project.meta.header = { prefix: 'Heute: ', dateLocale: 'de-DE', fontFamily: 'header-font' }
    german.assets['header-font'] = { src: 'data:font/ttf;base64,DE', w: 0, h: 0, kind: 'font' }
    spanish.project.meta.header = { prefix: 'Hoy: ', dateLocale: 'es-ES' }

    const merged = combineTranslatedPlayables([
      { locale: 'en', data: english },
      { locale: 'de', data: german },
      { locale: 'es', data: spanish },
    ], 0, 'Campaign global')

    expect(merged.project.meta).toMatchObject({ name: 'Campaign global', defaultLocale: 'en', locales: ['de', 'es'] })
    const base = merged.project.scenes[0].elements[0]
    const de = localizeElement(base, 'de-DE')
    const es = localizeElement(base, 'es')
    expect(de).toMatchObject({ id: 'hero-en', x: 250, text: { value: 'Hallo' }, landscape: { x: 350 } })
    expect(es).toMatchObject({ id: 'hero-en', x: 350, text: { value: 'Hola' }, landscape: { x: 450 } })
    expect(de.assetId).not.toBe('hero')
    expect(merged.assets[de.assetId!]?.src).toBe('data:image/png;base64,DE')
    expect(merged.assets[es.assetId!]?.src).toBe('data:image/png;base64,ES')
    expect(base.assetId).toBe('hero')
    expect(merged.assets.hero.src).toBe('data:image/png;base64,EN')
    expect(localizeSceneDef(merged.project.scenes[0], 'de').elements[0]).toMatchObject({ id: 'hero-en', x: 250, text: { value: 'Hallo' } })
    expect(merged.project.meta.headerI18n?.de).toMatchObject({ prefix: 'Heute: ', dateLocale: 'de-DE' })
    expect(merged.project.meta.headerI18n?.es).toMatchObject({ prefix: 'Hoy: ', dateLocale: 'es-ES' })
    const germanFont = merged.project.meta.headerI18n?.de.fontFamily
    expect(germanFont).not.toBe('header-font')
    expect(merged.assets[germanFont!]?.src).toBe('data:font/ttf;base64,DE')
    expect(pruneAssets(merged.project, merged.assets)[germanFont!]?.src).toBe('data:font/ttf;base64,DE')
  })

  it('rejects duplicate languages', () => {
    const one = playable('One', 's', 'e', 'One', 'one', 1)
    const two = playable('Two', 's', 'e', 'Two', 'two', 2)
    expect(() => combineTranslatedPlayables([{ locale: 'en', data: one }, { locale: 'EN', data: two }], 0, 'Combined')).toThrow(/different language/i)
  })
})

describe('buildSceneTranslation', () => {
  it('copies a chosen scene into the master asset namespace and keeps master navigation', () => {
    const master = playable('Master', 'master-scene', 'master-el', 'Hello', 'master-image', 100)
    const source = playable('Arabic', 'arabic-scene', 'arabic-el', 'مرحبا', 'arabic-image', 220)
    source.project.scenes[0].bgColor = '#123456'
    source.project.scenes[0].advance = { on: 'tap', to: 'wrong-target' }
    source.project.meta.header = { prefix: 'ينتهي العرض ', fontFamily: 'header-font' }
    source.assets['header-font'] = { src: 'arabic-font', w: 0, h: 0, kind: 'font' }
    const result = buildSceneTranslation(master.project.scenes[0], source.project.scenes[0], source.assets, master.assets, 'ar', source.project.meta.header)

    expect(result.source.id).toBe('master-scene')
    expect(result.source.advance).toEqual(master.project.scenes[0].advance)
    expect(result.source.bgColor).toBe('#123456')
    expect(result.source.elements[0]).toMatchObject({ id: 'arabic-el', x: 220, text: { value: 'مرحبا' } })
    expect(result.source.elements[0].assetId).not.toBe('hero')
    expect(result.assets[result.source.elements[0].assetId!].src).toBe('arabic-image')
    expect(result.header?.prefix).toBe('ينتهي العرض ')
    expect(result.assets[result.header!.fontFamily!]?.src).toBe('arabic-font')
    master.project.scenes[0].localeOverrides = { ar: { source: result.source } }
    expect(pruneAssets(master.project, result.assets)[result.source.elements[0].assetId!]?.src).toBe('arabic-image')
  })
})

describe('inferLanguageCode', () => {
  it('recognizes common language names in playable titles', () => {
    expect(inferLanguageCode('Campaign - German')).toBe('de')
    expect(inferLanguageCode('Campaign Español')).toBe('es')
    expect(inferLanguageCode('Campaign Arabic')).toBe('ar')
  })
})
