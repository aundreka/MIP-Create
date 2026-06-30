import { describe, it, expect, beforeEach } from 'vitest'
import { localize, resolveLocale, setActiveLocale } from './i18n'

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
