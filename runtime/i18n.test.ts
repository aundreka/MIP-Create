import { describe, it, expect, beforeEach } from 'vitest'
import { localize, localizeElement, localizeHeader, localizeSceneDef, resolveLocale, setActiveLocale } from './i18n'
import type { SceneDef, SceneElement } from './scene'

const t = (value: string, i18n?: Record<string, string>) => ({ value, fontSizePx: 10, i18n })

beforeEach(() => setActiveLocale(null))

describe('localize', () => {
  it('returns the base value when no locale is active', () => {
    expect(localize(t('Hi'))).toBe('Hi')
  })
  it('returns the locale override when active', () => {
    setActiveLocale('es')
    expect(localize(t('Hi', { es: 'Hola' }))).toBe('Hola')
  })
  it('falls back to the base language (es-MX → es)', () => {
    setActiveLocale('es-MX')
    expect(localize(t('Hi', { es: 'Hola' }))).toBe('Hola')
  })
  it('falls back to the base value when the locale is missing', () => {
    setActiveLocale('fr')
    expect(localize(t('Hi', { es: 'Hola' }))).toBe('Hi')
  })
})

describe('resolveLocale', () => {
  it('returns null with no locales', () => {
    expect(resolveLocale([])).toBeNull()
  })
  it('matches the browser base language (jsdom is en-US)', () => {
    expect(resolveLocale(['en', 'es'])).toBe('en')
  })
  it('returns null when none match the browser', () => {
    expect(resolveLocale(['de', 'fr'])).toBeNull()
  })
})

describe('localizeElement', () => {
  const image: SceneElement = {
    id: 'hero', type: 'image', name: 'Hero', assetId: 'hero_en',
    x: 100, y: 200, scale: 1, anchor: 'center', zIndex: 2, mode: 'fit',
    landscape: { x: 300, y: 400 },
    localeOverrides: { es: { assetId: 'hero_es', portrait: { x: 120, scale: 0.8 }, landscape: { x: 350, scale: 0.7 } } },
  }

  it('uses localized assets and merges orientation layouts field by field', () => {
    const localized = localizeElement(image, 'es-MX')
    expect(localized.assetId).toBe('hero_es')
    expect(localized.x).toBe(120)
    expect(localized.y).toBe(200)
    expect(localized.scale).toBe(0.8)
    expect(localized.landscape).toEqual({ x: 350, y: 400, scale: 0.7 })
  })

  it('returns the default element when a language has no override', () => {
    expect(localizeElement(image, 'fr')).toBe(image)
  })

  it('uses a complete localized source and lets manual layout overrides win', () => {
    const source: SceneElement = {
      ...image,
      id: 'bild',
      name: 'German hero',
      assetId: 'hero_de',
      x: 210,
      text: t('Hallo'),
      landscape: { x: 510, y: 610 },
      localeOverrides: { fr: { assetId: 'nested_should_not_take_over' } },
    }
    const combined: SceneElement = {
      ...image,
      localeOverrides: { de: { source, portrait: { x: 240 }, landscape: { y: 640 } } },
    }
    const localized = localizeElement(combined, 'de-DE')
    expect(localized.id).toBe('hero')
    expect(localized.name).toBe('German hero')
    expect(localized.assetId).toBe('hero_de')
    expect(localized.text?.value).toBe('Hallo')
    expect(localized.x).toBe(240)
    expect(localized.landscape).toMatchObject({ x: 510, y: 640 })
    expect(localized.localeOverrides).toBe(combined.localeOverrides)
  })
})

describe('localizeSceneDef', () => {
  it('uses complete localized scene content but preserves the master flow', () => {
    const translated: SceneDef = {
      id: 'otro', name: 'Escena', kind: 'overlay', bgColor: '#ff0000',
      advance: { on: 'tap', to: 'broken-source-id' }, elements: [],
    }
    const master: SceneDef = {
      id: 'main', name: 'Main', kind: 'game', advance: { on: 'gameWin', to: 'end' },
      transition: { type: 'fade', durationMs: 300 }, elements: [],
      localeOverrides: { es: { source: translated } },
    }
    const localized = localizeSceneDef(master, 'es-MX')
    expect(localized).toMatchObject({ id: 'main', name: 'Escena', kind: 'overlay', bgColor: '#ff0000' })
    expect(localized.advance).toEqual(master.advance)
    expect(localized.transition).toEqual(master.transition)
  })
})

describe('localizeHeader', () => {
  it('uses a regional language header and falls back to the default header', () => {
    const meta = {
      header: { prefix: 'Today: ' },
      headerI18n: { de: { prefix: 'Heute: ', dateLocale: 'de-DE' } },
    }
    expect(localizeHeader(meta, 'de-AT')).toMatchObject({ prefix: 'Heute: ', dateLocale: 'de-DE' })
    expect(localizeHeader(meta, 'es')).toEqual(meta.header)
  })
})
