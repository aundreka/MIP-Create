// The pinned header's two content modes: 'date' (default — renders today's date
// once, never ticks) and 'countdown' (ticks down from countdownSeconds using the
// countdown element's {hh}/{mm}/{ss} tokens, wrapped in prefix/suffix).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { mountHeader } from './header'
import { setDesign } from './responsive'

setDesign(1080, 1920)

const bandText = (): string => document.querySelector('.pa-test-mount div div')?.textContent ?? ''

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
    expect(bandText()).toBe(`DAY ${now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase()} ${now.getDate()}, ${now.getFullYear()} !`)
  })

  it('date mode honours a custom format with bare tokens', () => {
    mount({ dateFormat: 'MMMM D, YYYY' })
    const now = new Date()
    expect(bandText()).toBe(`${now.toLocaleDateString('en-US', { month: 'long' })} ${now.getDate()}, ${now.getFullYear()}`)
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

  it('countdown mode renders the remaining time and ticks every second', () => {
    vi.useFakeTimers()
    const h = mount({ mode: 'countdown', countdownSeconds: 125, countdownFormat: '{mm} {ss}', prefix: 'Limited Time Only ' })
    expect(bandText()).toBe('Limited Time Only 02 05')
    vi.advanceTimersByTime(1000)
    expect(bandText()).toBe('Limited Time Only 02 04')
    h.destroy()
  })

  it('countdown clamps at zero and stops its ticker', () => {
    vi.useFakeTimers()
    mount({ mode: 'countdown', countdownSeconds: 2, countdownFormat: '{mm}:{ss}' })
    vi.advanceTimersByTime(5000)
    expect(bandText()).toBe('00:00')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a tokenless countdown format renders once without a ticker', () => {
    vi.useFakeTimers()
    mount({ mode: 'countdown', countdownSeconds: 60, countdownFormat: 'HURRY' })
    expect(bandText()).toBe('HURRY')
    expect(vi.getTimerCount()).toBe(0)
  })
})
