// The pinned header's two content modes: 'date' (default — renders today's date
// once, never ticks) and 'countdown' (ticks down from countdownSeconds using the
// countdown element's {hh}/{mm}/{ss} tokens, wrapped in prefix/suffix).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { mountHeader } from './header'
import { setDesign } from './responsive'

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
