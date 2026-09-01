import { describe, it, expect } from 'vitest'
import { applyVariant, applyVariantPatches, stripVariants } from './variants'
import type { Project, PromoCalendarEntry, SceneDef, SceneElement, Variant } from '../runtime/scene'

const el = (id: string, extra: Partial<SceneElement> = {}): SceneElement => ({ id, type: 'text', name: id, x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit', ...extra })
const scene = (id: string, els: SceneElement[]): SceneDef => ({ id, name: id, kind: 'overlay', advance: { on: 'manual' }, elements: els })
const project = (): Project => ({
  meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, variants: [{ id: 'v1', name: 'V1', patches: [] }] },
  scenes: [scene('s1', [el('a', { x: 0 })])],
  startSceneId: 's1',
})

describe('applyVariantPatches', () => {
  it('overrides only matching elements', () => {
    const els = [el('a', { x: 1 }), el('b', { x: 2 })]
    const out = applyVariantPatches(els, [{ elementId: 'b', patch: { x: 99 } }])
    expect(out[0].x).toBe(1)
    expect(out[1].x).toBe(99)
  })
  it('returns the same array when there are no patches', () => {
    const els = [el('a')]
    expect(applyVariantPatches(els, [])).toBe(els)
  })
})

describe('applyVariant / stripVariants', () => {
  it('bakes a variant across scenes and strips variant meta', () => {
    const v: Variant = { id: 'v1', name: 'V1', patches: [{ elementId: 'a', patch: { x: 50 } }] }
    const out = applyVariant(project(), v)
    expect(out.scenes[0].elements[0].x).toBe(50)
    expect(out.meta.variants).toBeUndefined()
  })
  it('stripVariants removes variant meta without touching elements', () => {
    const out = stripVariants(project())
    expect(out.meta.variants).toBeUndefined()
    expect(out.scenes[0].elements[0].x).toBe(0)
  })
})

// The promo calendar is ~3 KB of rows only the {holiday} token reads, so it rides out
// with the creative exactly when the creative renders it — no wider.
describe('promo calendar stripping', () => {
  const CALENDAR: PromoCalendarEntry[] = [{ start: '2026-08-31', end: '2026-09-07', label: 'Labor Day Sale' }]
  const withCalendar = (els: SceneElement[], meta: Partial<Project['meta']> = {}): Project => ({
    meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, promoCalendar: CALENDAR, ...meta },
    scenes: [scene('s1', els)],
    startSceneId: 's1',
  })
  const countdown = (id: string, format: string): SceneElement => el(id, { type: 'countdown', countdown: { mode: 'dynamic', format } })

  it('keeps the calendar when an element renders {holiday}', () => {
    expect(stripVariants(withCalendar([countdown('a', 'Shop the {holiday}')])).meta.promoCalendar).toEqual(CALENDAR)
  })
  it('keeps it for the {promo} alias and for a pinned header that uses the token', () => {
    expect(stripVariants(withCalendar([countdown('a', '{promo}')])).meta.promoCalendar).toEqual(CALENDAR)
    expect(stripVariants(withCalendar([el('a')], { header: { dateFormat: '{holiday}' } })).meta.promoCalendar).toEqual(CALENDAR)
    expect(stripVariants(withCalendar([el('a')], { headerI18n: { es: { dateFormat: '{holiday}' } } })).meta.promoCalendar).toEqual(CALENDAR)
  })
  it('drops it when nothing renders the token', () => {
    expect(stripVariants(withCalendar([countdown('a', 'Order by {date}')])).meta.promoCalendar).toBeUndefined()
  })
  // The decision is made on the PATCHED project: a variant can be what puts the token
  // on screen (or takes it off), and each export gets the meta its own scenes need.
  it('decides per variant, after the patches are applied', () => {
    const proj = withCalendar([countdown('a', 'Order by {date}')])
    const adds: Variant = { id: 'v1', name: 'V1', patches: [{ elementId: 'a', patch: { countdown: { mode: 'dynamic', format: '{holiday}' } } }] }
    expect(applyVariant(proj, adds).meta.promoCalendar).toEqual(CALENDAR)
    const holidayProj = withCalendar([countdown('a', '{holiday}')])
    const removes: Variant = { id: 'v2', name: 'V2', patches: [{ elementId: 'a', patch: { countdown: { mode: 'dynamic', format: 'Buy 1 Get 1 Free' } } }] }
    expect(applyVariant(holidayProj, removes).meta.promoCalendar).toBeUndefined()
  })
})
