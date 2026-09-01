// `showWhen` ties a countdown element to the promo calendar: 'holiday' shows only
// while today has a label, 'noHoliday' is the fallback copy that covers the gaps.
// Both states are composed as two elements in the same spot, so the pair must flip
// on the local-midnight rollover without the scene being rebuilt.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScene } from './stage'
import { mountHeader } from './header'
import { computeMetrics, setDesign } from './responsive'
import { setNowOverride } from './elements/countdown'
import { setPromoCalendar } from './elements/promoCalendar'
import type { Scene, SceneElement } from './scene'

const CALENDAR = [
  { start: '2026-08-31', end: '2026-09-07', label: 'Labor Day Sale' },
  { start: '2026-09-08', end: '2026-09-21', label: 'Summer Sale' },
]

const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime()

const countdown = (id: string, cd: Record<string, unknown>): SceneElement => ({
  id, type: 'countdown', name: id, x: 540, y: 800, anchor: 'center', zIndex: 2, mode: 'fit',
  text: { value: '', fontSizePx: 64, fontWeight: 800, color: '#0a0', align: 'center' },
  countdown: { mode: 'dynamic', dynamicDays: 3, ...cd } as SceneElement['countdown'],
})

// The peakfootwear fallback layout: the promo label, its no-promo stand-in, and a
// line of copy that only runs while a promo is on.
const makeScene = (): Scene => ({
  meta: { schemaVersion: 1, name: 'holiday', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  kind: 'game',
  elements: [
    countdown('promo', { format: '{holiday}', showWhen: 'holiday' }),
    countdown('fallback', { format: 'Buy 1 Get 1 Free', showWhen: 'noHoliday' }),
    countdown('always', { format: '{holiday}' }),
  ],
})

const el = (mount: HTMLElement, id: string): HTMLElement => mount.querySelector<HTMLElement>(`.pa-el[data-id="${id}"]`)!
const shown = (mount: HTMLElement, id: string): boolean => el(mount, id).style.display !== 'none'
const label = (mount: HTMLElement, id: string): string => el(mount, id).querySelector<HTMLElement>('.pa-text-inner')!.textContent ?? ''

describe('showWhen — holiday / noHoliday visibility', () => {
  let mount: HTMLElement
  let stage: ReturnType<typeof buildScene> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
    setPromoCalendar(CALENDAR)
    setNowOverride(null)
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    mount = document.createElement('div')
    document.body.appendChild(mount)
  })

  afterEach(() => {
    stage?.destroy()
    stage = null
    setNowOverride(null)
    vi.useRealTimers()
  })

  const build = (): HTMLElement => {
    stage = buildScene(makeScene(), {}, { mount })
    stage.layoutAll()
    return mount
  }

  it('shows the promo label and hides the fallback inside a promo period', () => {
    vi.setSystemTime(at(2026, 9, 1))
    build()
    expect(shown(mount, 'promo')).toBe(true)
    expect(label(mount, 'promo')).toBe('Labor Day Sale')
    expect(shown(mount, 'fallback')).toBe(false)
  })

  it('hides the promo label and shows the fallback outside the calendar', () => {
    vi.setSystemTime(at(2028, 1, 1))
    build()
    expect(shown(mount, 'promo')).toBe(false)
    expect(el(mount, 'promo').classList.contains('pa-el--holiday-off')).toBe(true)
    expect(shown(mount, 'fallback')).toBe(true)
    // An element with no rule renders regardless — with an empty string, since the
    // calendar has nothing to say about today.
    expect(shown(mount, 'always')).toBe(true)
    expect(label(mount, 'always')).toBe('')
  })

  // The label a viewer sees must not depend on when the ad happened to load.
  it('crosses local midnight in place: the label changes with no rebuild', () => {
    vi.setSystemTime(at(2026, 9, 7, 23, 59))
    build()
    expect(label(mount, 'promo')).toBe('Labor Day Sale')

    vi.advanceTimersByTime(2 * 60 * 1000) // 00:01 on Sep 8
    expect(label(mount, 'promo')).toBe('Summer Sale')
    expect(shown(mount, 'promo')).toBe(true)
    expect(shown(mount, 'fallback')).toBe(false)
  })

  it('flips visibility at midnight when the calendar runs out', () => {
    vi.setSystemTime(at(2026, 9, 21, 23, 59))
    build()
    expect(shown(mount, 'promo')).toBe(true)
    expect(shown(mount, 'fallback')).toBe(false)

    vi.advanceTimersByTime(2 * 60 * 1000) // Sep 22 — past the last row
    expect(shown(mount, 'promo')).toBe(false)
    expect(shown(mount, 'fallback')).toBe(true)
  })

  it('keeps rolling over on the following days, not just the first', () => {
    vi.setSystemTime(at(2026, 9, 7, 23, 59))
    build()
    vi.advanceTimersByTime(2 * 60 * 1000) // Sep 8
    expect(label(mount, 'promo')).toBe('Summer Sale')
    vi.advanceTimersByTime(14 * 86400000) // Sep 22
    expect(shown(mount, 'promo')).toBe(false)
  })

  it('a literal format needs no ticker but still re-evaluates its rule daily', () => {
    vi.setSystemTime(at(2026, 9, 7, 23, 59))
    build()
    expect(label(mount, 'fallback')).toBe('Buy 1 Get 1 Free')
    expect(shown(mount, 'fallback')).toBe(false)
    vi.advanceTimersByTime(15 * 86400000) // Sep 22 — outside the calendar
    expect(shown(mount, 'fallback')).toBe(true)
    expect(label(mount, 'fallback')).toBe('Buy 1 Get 1 Free')
  })

  it('the editor preview date drives both the label and the rule', () => {
    vi.setSystemTime(at(2028, 1, 1)) // really outside the calendar
    setNowOverride(at(2026, 9, 1))
    build()
    expect(shown(mount, 'promo')).toBe(true)
    expect(label(mount, 'promo')).toBe('Labor Day Sale')
    expect(shown(mount, 'fallback')).toBe(false)
  })

  it('destroy clears the midnight timer', () => {
    vi.setSystemTime(at(2026, 9, 7, 23, 59))
    build()
    stage!.destroy()
    stage = null
    expect(vi.getTimerCount()).toBe(0)
  })
})

// The token lives in the SHARED formatter, so the pinned band speaks it too — a
// project-level "Labor Day Sale" band, with no element involved.
describe('the pinned header band renders {holiday}', () => {
  let host: HTMLElement
  let band: ReturnType<typeof mountHeader> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
    setPromoCalendar(CALENDAR)
    setNowOverride(null)
    setDesign(1080, 1920)
    computeMetrics(540, 960) // FIT scale 0.5, so the band's transform is not the identity
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    band?.destroy()
    band = null
    setNowOverride(null)
    vi.useRealTimers()
  })

  const text = (): string => host.querySelector('div div')?.textContent ?? ''

  it('bands the calendar copy, cased and wrapped like any other date format', () => {
    vi.setSystemTime(at(2026, 9, 1))
    band = mountHeader(host, { dateFormat: '{holiday}', textCase: 'upper', prefix: '★ ', suffix: ' ★' })
    expect(text()).toBe('★ LABOR DAY SALE ★')
  })

  it('keeps the band scale(s) transform — the token changes the string, not the layout', () => {
    vi.setSystemTime(at(2026, 9, 1))
    band = mountHeader(host, { dateFormat: '{holiday}' })
    expect(host.querySelector<HTMLElement>('div')!.style.transform).toContain('scale(0.5)')
  })

  it('re-reads the calendar at local midnight instead of banding yesterday', () => {
    vi.setSystemTime(at(2026, 9, 7, 23, 59))
    band = mountHeader(host, { dateFormat: '{holiday}' })
    expect(text()).toBe('Labor Day Sale')
    vi.advanceTimersByTime(2 * 60 * 1000)
    expect(text()).toBe('Summer Sale')
  })

  it('destroy clears the band rollover timer', () => {
    vi.setSystemTime(at(2026, 9, 1))
    band = mountHeader(host, { dateFormat: '{holiday}' })
    band.destroy()
    band = null
    expect(vi.getTimerCount()).toBe(0)
  })
})
