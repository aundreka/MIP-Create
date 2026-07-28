// Text case + clock mode on the countdown / dynamic-date element, and the font
// registration path that a live font upload takes.
//
// The case bug this pins: month names come out of Intl ALREADY title-cased, so the
// old capitalize-only control was a visible no-op on a format like "TODAY MMM D:"
// (it produced "TODAY Jul 30:" either way). 'upper' is the mode that reaches them.

import { describe, it, expect } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import { formatCountdown, needsTicker, renderCountdownFormat } from './elements/countdown'
import type { Scene, SceneElement } from './scene'

const el = (countdown: SceneElement['countdown']): SceneElement =>
  ({
    id: 'd',
    type: 'countdown',
    name: 'Dynamic date',
    x: 540,
    y: 400,
    anchor: 'center',
    zIndex: 5,
    mode: 'fit',
    text: { value: '', fontSizePx: 64, fontWeight: 800, color: '#fff', align: 'center' },
    countdown,
  }) as SceneElement

const scene = (els: SceneElement[]): Scene => ({
  meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: els,
  kind: 'game',
})

function mount(els: SceneElement[], assets: Record<string, unknown> = {}): ReturnType<typeof buildScene> {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  setDesign(1080, 1920)
  computeMetrics(540, 960)
  const stage = buildScene(scene(els), assets as never, { mount: host })
  stage.layoutAll()
  return stage
}
const textOf = (stage: ReturnType<typeof buildScene>): string =>
  (stage.get('d')!.content!.firstElementChild as HTMLElement).textContent ?? ''
const fontOf = (stage: ReturnType<typeof buildScene>): string =>
  (stage.get('d')!.content!.firstElementChild as HTMLElement).style.fontFamily

// 2026-07-30T09:05:07 local — a month whose short name is mixed case ("Jul").
const NOW = new Date(2026, 6, 30, 9, 5, 7).getTime()

describe('text case', () => {
  const fmt = 'TODAY MMM D:'
  const render = (textCase?: string, capitalize?: boolean): string =>
    formatCountdown(el({ mode: 'dynamic', dynamicDays: 3, format: fmt, textCase, capitalize } as never), NOW, NOW)

  it('leaves the string alone by default', () => {
    expect(render()).toBe('TODAY Jul 30:')
  })

  it("title case does NOT reach an Intl month name — the reported no-op", () => {
    expect(render('title')).toBe('TODAY Jul 30:')
    expect(render(undefined, true)).toBe('TODAY Jul 30:') // legacy capitalize flag, same result
  })

  it('upper case is what produces JUL', () => {
    expect(render('upper')).toBe('TODAY JUL 30:')
  })

  it('lower case transforms the whole string', () => {
    expect(render('lower')).toBe('today jul 30:')
  })

  it('title case still capitalizes words the author typed in lower case', () => {
    const s = formatCountdown(el({ mode: 'dynamic', dynamicDays: 3, format: 'order by MMM D', textCase: 'title' }), NOW, NOW)
    expect(s).toBe('Order By Jul 30')
  })

  it('honors the legacy capitalize flag only when textCase is unset', () => {
    const s = formatCountdown(
      el({ mode: 'dynamic', dynamicDays: 3, format: 'order by', capitalize: true, textCase: 'none' } as never),
      NOW,
      NOW,
    )
    expect(s).toBe('order by') // explicit textCase wins over the deprecated flag
  })

  it('applies to the shared formatter used by the header band', () => {
    // The core formatter only knows {braced} tokens — callers brace bare ones first.
    expect(renderCountdownFormat('{MMMM} {D}', NOW, NOW, { textCase: 'upper' })).toBe('JULY 30')
    expect(renderCountdownFormat('{MMMM} {D}', NOW, NOW, {})).toBe('July 30')
  })
})

describe('clock mode', () => {
  const clock = (format: string): string => formatCountdown(el({ mode: 'clock', format }), NOW, NOW)

  it('renders the current wall-clock time as 00:00', () => {
    expect(clock('{hh}:{mm}')).toBe('09:05')
  })

  it('supports unpadded hours and seconds', () => {
    expect(clock('{h}:{mm}:{ss}')).toBe('9:05:07')
  })

  it('defaults to {hh}:{mm} when no format is given', () => {
    expect(formatCountdown(el({ mode: 'clock', format: '' }), NOW, NOW)).toBe('09:05')
  })

  it('shows TODAY for date tokens, not a future target', () => {
    expect(clock('MMM D · {hh}:{mm}')).toBe('Jul 30 · 09:05')
  })

  it('always ticks, even for a format with no seconds', () => {
    expect(needsTicker(el({ mode: 'clock', format: '{hh}:{mm}' }))).toBe(true)
    // a plain date label still does not
    expect(needsTicker(el({ mode: 'dynamic', dynamicDays: 3, format: 'MMM D' }))).toBe(false)
  })

  it('is unaffected by dynamicDays and combines with text case', () => {
    expect(formatCountdown(el({ mode: 'clock', format: 'now {hh}:{mm}', textCase: 'upper', dynamicDays: 99 }), NOW, NOW)).toBe(
      'NOW 09:05',
    )
  })

  it('renders live through the stage', () => {
    const s = mount([el({ mode: 'clock', format: '{hh}:{mm}' })])
    expect(textOf(s)).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('12-hour clock', () => {
  const at = (hh: number, mm: number): number => new Date(2026, 6, 30, hh, mm, 0).getTime()
  const render = (t: number, format: string, hour12 = true): string =>
    formatCountdown(el({ mode: 'clock', format, hour12 }), t, t)

  it('renders 1-12 with an AM/PM token', () => {
    expect(render(at(14, 5), '{h}:{mm} {A}')).toBe('2:05 PM')
    expect(render(at(9, 30), '{h}:{mm} {A}')).toBe('9:30 AM')
  })

  it('pads the 12-hour value with {hh}', () => {
    expect(render(at(14, 5), '{hh}:{mm} {A}')).toBe('02:05 PM')
  })

  it('folds midnight and noon to 12, not 0', () => {
    expect(render(at(0, 15), '{h}:{mm} {A}')).toBe('12:15 AM')
    expect(render(at(12, 0), '{h}:{mm} {A}')).toBe('12:00 PM')
  })

  it('offers a lowercase meridiem', () => {
    expect(render(at(23, 59), '{h}:{mm}{a}')).toBe('11:59pm')
  })

  it('leaves 24-hour output alone when hour12 is off', () => {
    expect(render(at(14, 5), '{hh}:{mm}', false)).toBe('14:05')
    expect(render(at(0, 15), '{hh}:{mm}', false)).toBe('00:15')
  })

  it('does NOT apply 12-hour folding to a countdown, where {hh} is hours remaining', () => {
    // 3h left must stay "03", and a zero-hours remainder must stay "00" — not "12".
    const now = at(10, 0)
    const el3h = el({ mode: 'timer', seconds: 3 * 3600, format: '{hh}:{mm}', hour12: true } as never)
    expect(formatCountdown(el3h, now + 3 * 3600000, now)).toBe('03:00')
    const el0h = el({ mode: 'timer', seconds: 600, format: '{hh}:{mm}', hour12: true } as never)
    expect(formatCountdown(el0h, now + 600000, now)).toBe('00:10')
  })

  it('the meridiem token still resolves on a fixed-date countdown', () => {
    const now = at(10, 0)
    const target = at(20, 30)
    expect(renderCountdownFormat('{MMM} {D} {A}', target, now, {})).toBe('Jul 30 PM')
  })

  it('combines with UPPERCASE text case', () => {
    expect(formatCountdown(el({ mode: 'clock', format: '{h}:{mm} {a}', hour12: true, textCase: 'upper' }), at(14, 5), at(14, 5))).toBe(
      '2:05 PM',
    )
  })
})

describe('font uploaded into an already-open scene', () => {
  const FONT = 'data:font/ttf;base64,AAEAAAALAIAAAwAwT1MvMg=='
  const asset = (src = FONT): Record<string, unknown> => ({ src, w: 0, h: 0, kind: 'font' })

  // jsdom ships neither FontFace nor an iterable document.fonts, so stand both up and
  // record what the runtime registers.
  function captureFonts(): string[] {
    const added: string[] = []
    class FakeFontFace {
      family: string
      constructor(family: string) {
        this.family = family
      }
      load(): Promise<void> {
        return Promise.resolve()
      }
    }
    ;(globalThis as { FontFace?: unknown }).FontFace = FakeFontFace
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: (f: { family: string }) => added.push(f.family) },
    })
    return added
  }

  const textWith = (fontFamily: string): SceneElement => {
    const e = el({ mode: 'dynamic', dynamicDays: 3, format: 'MMM D' })
    e.text = { ...e.text!, fontFamily }
    return e
  }

  it('registers the FontFace on the live-update path, not just at build', () => {
    const added = captureFonts()
    // Build first WITHOUT the font — the real sequence: the scene is already on screen
    // when the author uploads. The update path must register the face, or the element's
    // font-family names a face the document has never heard of and the text falls back.
    const s = mount([el({ mode: 'dynamic', dynamicDays: 3, format: 'MMM D' })])
    expect(fontOf(s)).toBe('')
    expect(added).toEqual([])

    const applied = s.update(scene([textWith('UploadedA')]), { UploadedA: asset() } as never)

    expect(applied).toBe(true) // in-place update, no rebuild — the path that was broken
    expect(fontOf(s)).toBe('UploadedA')
    expect(added).toContain('UploadedA')
  })

  it('registers each font once, however many edits follow', () => {
    const added = captureFonts()
    const e = textWith('UploadedB')
    const s = mount([e], { UploadedB: asset() })
    for (let i = 0; i < 5; i++) s.update(scene([e]), { UploadedB: asset() } as never)
    expect(added.filter((f) => f === 'UploadedB')).toHaveLength(1)
  })

  it('re-registers when the same id is re-uploaded with different data', () => {
    const added = captureFonts()
    const e = textWith('UploadedC')
    const s = mount([e], { UploadedC: asset() })
    s.update(scene([e]), { UploadedC: asset('data:font/ttf;base64,QkJCQkJC') } as never)
    expect(added.filter((f) => f === 'UploadedC')).toHaveLength(2)
  })
})
