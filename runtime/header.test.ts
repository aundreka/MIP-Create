// The pinned header's two content modes: 'date' (default — renders today's date
// once, never ticks) and 'countdown' (ticks down from countdownSeconds using the
// countdown element's {hh}/{mm}/{ss} tokens, wrapped in prefix/suffix).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { mountHeader } from './header'
import { computeMetrics, setDesign } from './responsive'

setDesign(1080, 1920)

const bandEl = (): HTMLDivElement | null => document.querySelector('.pa-test-mount > div')
const bandText = (): string => document.querySelector('.pa-test-mount div div')?.textContent ?? ''
const interact = (): void => void document.querySelector('.pa-test-mount')?.dispatchEvent(new Event('pointerdown', { bubbles: true }))

function mount(opts: Parameters<typeof mountHeader>[1]): ReturnType<typeof mountHeader> {
  const host = document.createElement('div')
  host.className = 'pa-test-mount'
  document.body.appendChild(host)
  return mountHeader(host, opts)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('header modes', () => {
  it('date mode (default) renders the current date with prefix/suffix', () => {
    mount({ prefix: 'DAY ', suffix: ' !' })
    const now = new Date()
    expect(bandText()).toBe(`DAY ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()} !`)
  })

  it('date mode honours a custom format with bare tokens', () => {
    mount({ dateFormat: 'MMMM D, YYYY' })
    const now = new Date()
    expect(bandText()).toBe(`${now.toLocaleDateString('en-US', { month: 'long' })} ${now.getDate()}, ${now.getFullYear()}`)
  })

  it('date mode localizes the default and custom header formats', () => {
    const now = new Date()
    mount({ dateLocale: 'de' })
    expect(bandText()).toBe(now.toLocaleDateString('de', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase())

    document.body.innerHTML = ''
    mount({ dateFormat: 'MMMM D, YYYY', dateLocale: 'es' })
    expect(bandText()).toBe(`${now.toLocaleDateString('es', { month: 'long' })} ${now.getDate()}, ${now.getFullYear()}`)
  })

  it('date-format tokens work bare or braced, long or short', () => {
    mount({ dateFormat: 'MMM {DD} YY' })
    const now = new Date()
    const dd = String(now.getDate()).padStart(2, '0')
    const yy = String(now.getFullYear() % 100).padStart(2, '0')
    expect(bandText()).toBe(`${now.toLocaleDateString('en-US', { month: 'short' })} ${dd} ${yy}`)
  })

  it('literal words in a date format are not eaten by token replacement', () => {
    mount({ dateFormat: 'DAY D' })
    expect(bandText()).toBe(`DAY ${new Date().getDate()}`)
  })

  it('starts a duration countdown only on the first user interaction', () => {
    vi.useFakeTimers()
    const h = mount({ mode: 'countdown', countdownSeconds: 125, countdownFormat: '{mm} {ss}', prefix: 'Limited Time Only ' })
    expect(bandText()).toBe('Limited Time Only 02 05')
    vi.advanceTimersByTime(1000)
    expect(bandText()).toBe('Limited Time Only 02 05')
    expect(vi.getTimerCount()).toBe(0)
    interact()
    vi.advanceTimersByTime(1000)
    expect(bandText()).toBe('Limited Time Only 02 04')
    h.destroy()
  })

  it('renders and ticks two-digit hundredths with {ss}:{ms}', () => {
    vi.useFakeTimers()
    const h = mount({ mode: 'countdown', countdownSeconds: 7, countdownFormat: '{ss}:{ms}' })
    expect(bandText()).toBe('07:00')
    vi.advanceTimersByTime(1000)
    expect(bandText()).toBe('07:00')
    interact()
    vi.advanceTimersByTime(10)
    expect(bandText()).toBe('06:99')
    vi.advanceTimersByTime(6990)
    expect(bandText()).toBe('00:00')
    expect(vi.getTimerCount()).toBe(0)
    h.destroy()
  })

  it('freezes the live value permanently when game win is reported', () => {
    vi.useFakeTimers()
    const h = mount({ mode: 'countdown', countdownSeconds: 10, countdownFormat: '{ss}:{ms}' })
    interact()
    vi.advanceTimersByTime(1230)
    expect(bandText()).toBe('08:77')
    h.freezeCountdown()
    vi.advanceTimersByTime(5000)
    expect(bandText()).toBe('08:77')
    expect(vi.getTimerCount()).toBe(0)
    h.destroy()
  })

  it('countdown clamps at zero and stops its ticker', () => {
    vi.useFakeTimers()
    mount({ mode: 'countdown', countdownSeconds: 2, countdownFormat: '{mm}:{ss}' })
    vi.advanceTimersByTime(5000)
    expect(bandText()).toBe('00:02')
    interact()
    vi.advanceTimersByTime(5000)
    expect(bandText()).toBe('00:00')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the midnight target counts down whatever is left of the viewer’s day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15, 17, 0, 0)) // 5pm local → 7h left
    mount({ mode: 'countdown', countdownTarget: 'midnight' })
    expect(bandText()).toBe('07:00:00')
    vi.advanceTimersByTime(1000)
    expect(bandText()).toBe('06:59:59')
  })

  it('the midnight target ignores countdownSeconds and honours a custom format', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15, 21, 30, 0))
    mount({ mode: 'countdown', countdownTarget: 'midnight', countdownSeconds: 60, countdownFormat: '{h}h {m}m left' })
    expect(bandText()).toBe('2h 30m left')
  })

  it('a tokenless countdown format renders once without a ticker', () => {
    vi.useFakeTimers()
    mount({ mode: 'countdown', countdownSeconds: 60, countdownFormat: 'HURRY' })
    expect(bandText()).toBe('HURRY')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('applies an authored entrance preset, duration, and delay to the whole header surface', () => {
    mount({ entrance: { preset: 'slide-down', durationMs: 450, delayMs: 300, easing: 'ease-out' } })
    const surface = document.querySelector<HTMLElement>('.pa-test-mount > div > div')
    expect(surface?.style.animation).toBe('pa-slide-down 450ms ease-out 300ms 1 normal both')
  })

  it('stays above every runtime overlay tier by default', () => {
    mount({})
    expect(bandEl()?.style.zIndex).toBe('20000')
  })
})

// Placement: an authored offset moves the band away from the pinned top-centre in DESIGN
// px, and a landscape override can give a wide screen its own size/position (or drop the
// band entirely) without touching the portrait layout.
describe('header placement and per-orientation layout', () => {
  const band = (): HTMLElement | null => document.querySelector<HTMLElement>('.pa-header')
  const surface = (): HTMLElement | null => document.querySelector<HTMLElement>('.pa-header-surface')

  afterEach(() => {
    setDesign(1080, 1920)
    computeMetrics(1080, 1920) // back to portrait, scale 1, for the rest of the file
  })

  it('pins to the top with no transform of its own by default', () => {
    computeMetrics(540, 960)
    mount({})
    expect(band()?.style.transform).toBe('translateX(-50%) scale(0.5)')
  })

  it('moves by the authored offset, scaled to the viewport', () => {
    computeMetrics(540, 960) // FIT scale 0.5
    mount({ offsetXPx: 40, offsetYPx: 100 })
    expect(band()?.style.transform).toBe('translateX(-50%) translate(20px, 50px) scale(0.5)')
  })

  it('applies the landscape layout only while the viewport is wide', () => {
    const cfg = { heightPx: 120, fontSizePx: 64, offsetYPx: 0, landscape: { heightPx: 80, fontSizePx: 40, offsetYPx: 60 } }
    computeMetrics(1080, 1920)
    const h = mount(cfg)
    expect(band()?.style.height).toBe('120px')
    expect(surface()?.style.fontSize).toBe('64px')

    computeMetrics(1920, 1080) // rotate; only relayout runs
    h.relayout()
    expect(band()?.style.height).toBe('80px')
    expect(surface()?.style.fontSize).toBe('40px')
    expect(band()?.style.transform).toContain('translate(0px, 33.75px)') // 60 design px × the landscape scale
  })

  it('lets one scene move the band without touching the project layout', () => {
    computeMetrics(1080, 1920) // scale 1
    const h = mount({ offsetYPx: 10, heightPx: 120 })
    expect(band()?.style.transform).toBe('translateX(-50%) translate(0px, 10px) scale(1)')

    h.setSceneLayout({ offsetYPx: 400, heightPx: 200 }) // scene 2 places it lower and taller
    expect(band()?.style.transform).toBe('translateX(-50%) translate(0px, 400px) scale(1)')
    expect(band()?.style.height).toBe('200px')

    h.setSceneLayout(null) // back on a scene that follows the project
    expect(band()?.style.transform).toBe('translateX(-50%) translate(0px, 10px) scale(1)')
    expect(band()?.style.height).toBe('120px')
  })

  it('inherits every field the scene does not override', () => {
    computeMetrics(1080, 1920)
    const h = mount({ fontSizePx: 64, heightPx: 120, offsetYPx: 30 })
    h.setSceneLayout({ offsetYPx: 200 })
    expect(surface()?.style.fontSize).toBe('64px') // still the project's
    expect(band()?.style.height).toBe('120px')
    expect(band()?.style.transform).toBe('translateX(-50%) translate(0px, 200px) scale(1)')
  })

  it('gives a scene its own landscape slot, most specific last', () => {
    const cfg = { offsetYPx: 10, landscape: { offsetYPx: 50 } }
    computeMetrics(1080, 1920)
    const h = mount(cfg)
    h.setSceneLayout({ offsetYPx: 100, landscape: { offsetYPx: 300 } })
    expect(band()?.style.transform).toBe('translateX(-50%) translate(0px, 100px) scale(1)') // scene portrait

    computeMetrics(1920, 1080) // rotate: scene landscape wins over project landscape
    h.relayout()
    expect(band()?.style.transform).toContain('translate(0px, 168.75px)') // 300 × 0.5625
  })

  it('drops the band in landscape when the override hides it', () => {
    computeMetrics(1080, 1920)
    const h = mount({ landscape: { hidden: true } })
    expect(band()?.style.display).toBe('grid')

    computeMetrics(1920, 1080)
    h.relayout()
    expect(band()?.style.display).toBe('none')
  })
})

// The band can loop as well as enter. The loop rides the TEXT node so it never fights the
// entrance (which owns the surface's transform) and never scales the bar art out of its
// overflow:hidden box.
describe('header loop animation', () => {
  const textEl = (): HTMLElement | null => document.querySelector<HTMLElement>('.pa-header-text')
  const surfaceEl = (): HTMLElement | null => document.querySelector<HTMLElement>('.pa-header-surface')

  it('runs an authored loop infinitely on the text, leaving the surface free for the entrance', () => {
    mount({ loop: { preset: 'pulse', durationMs: 900, delayMs: 0, easing: 'ease-in-out', iterations: 'infinite' } })
    expect(textEl()?.style.animation).toBe('pa-pulse 900ms ease-in-out 0ms infinite normal none')
    expect(surfaceEl()?.style.animation).toBe('')
  })

  it('holds the loop back until the entrance has finished', () => {
    mount({
      entrance: { preset: 'slide-down', durationMs: 450, delayMs: 300, easing: 'ease-out' },
      loop: { preset: 'float', durationMs: 2000, delayMs: 0, easing: 'ease-in-out' },
    })
    // 300ms delay + 450ms entrance = the loop starts at 750ms.
    expect(textEl()?.style.animation).toBe('pa-float 2000ms ease-in-out 750ms infinite normal none')
  })

  it('ignores a followed CTA pulse unless the header opted in', () => {
    const h = mount({ loop: { preset: 'pulse', durationMs: 900, delayMs: 0, easing: 'ease-in-out' } })
    h.followCta('pa-cta-pulse-strong 1200ms ease-in-out infinite')
    expect(textEl()?.style.animation).toBe('pa-pulse 900ms ease-in-out 0ms infinite normal none')
  })

  it('adopts the scene CTA pulse when following, and falls back to its own loop without one', () => {
    const h = mount({ loopFollowsCta: true, loop: { preset: 'pulse', durationMs: 900, delayMs: 0, easing: 'ease-in-out' } })
    h.followCta('pa-cta-strong 1200ms ease-in-out infinite')
    expect(textEl()?.style.animation).toBe('pa-cta-strong 1200ms ease-in-out infinite')

    h.followCta(null) // a scene with no CTA
    expect(textEl()?.style.animation).toBe('pa-pulse 900ms ease-in-out 0ms infinite normal none')
  })

  it('follows the CTA with no loop of its own, and clears again on a CTA-less scene', () => {
    const h = mount({ loopFollowsCta: true })
    expect(textEl()?.style.animation).toBe('')
    h.followCta('pa-cta-strong 1200ms ease-in-out infinite')
    expect(textEl()?.style.animation).toBe('pa-cta-strong 1200ms ease-in-out infinite')
    h.followCta(null)
    expect(textEl()?.style.animation).toBe('')
  })
})
