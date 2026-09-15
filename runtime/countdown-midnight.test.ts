// countdown.target 'midnight': a dynamic countdown that runs to 12:00 AM starting its
// target day, so {hh}:{mm}:{ss} is the time left in today — rounded down, live, rolling
// over at midnight — and separate {hh}/{mm}/{ss} elements flip on the same second.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign, setVAlign } from './responsive'
import { computeDeadline, formatCountdown } from './elements/countdown'
import type { Project, SceneElement } from './scene'

const at = (h: number, m: number, s: number, ms = 0): number => new Date(2026, 8, 15, h, m, s, ms).getTime()

function unit(id: string, format: string, dynamicDays = 1): SceneElement {
  return {
    id, type: 'countdown', name: id, x: 540, y: 400, anchor: 'center', zIndex: 1, mode: 'fit',
    text: { value: '', fontSizePx: 64, color: '#fff' },
    countdown: { mode: 'dynamic', dynamicDays, target: 'midnight', format },
  }
}

describe('computeDeadline with target midnight', () => {
  it('counts to the start of tomorrow: 11 hours left at 1pm', () => {
    const el = unit('t', '{hh}:{mm}:{ss}')
    const now = at(13, 0, 0)
    expect(computeDeadline(el, now)).toBe(new Date(2026, 8, 16).getTime())
    expect(formatCountdown(el, computeDeadline(el, now), now)).toBe('11:00:00')
  })

  it('rounds down', () => {
    const el = unit('t', '{hh}:{mm}:{ss}')
    const now = at(13, 0, 0, 500)
    expect(formatCountdown(el, computeDeadline(el, now), now)).toBe('10:59:59')
  })

  it('a 0-day offset still counts to tonight, never to a past midnight', () => {
    const now = at(20, 30, 0)
    expect(computeDeadline(unit('t', '{hh}', 0), now)).toBe(new Date(2026, 8, 16).getTime())
  })

  it('leaves the exact-time dynamic mode alone', () => {
    const el: SceneElement = { ...unit('t', '{hh}'), countdown: { mode: 'dynamic', dynamicDays: 1, format: '{hh}' } }
    expect(computeDeadline(el, at(13, 0, 0))).toBe(at(13, 0, 0) + 86400000)
  })
})

describe('separate hour / minute / second elements', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function mount(): (id: string) => string {
    const mountEl = document.createElement('div')
    document.body.appendChild(mountEl)
    setDesign(1080, 1920)
    setVAlign('top')
    computeMetrics(1080, 1920)
    const project: Project = {
      meta: { schemaVersion: 1, name: 'midnight', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      startSceneId: 's1',
      scenes: [{ id: 's1', name: 'S', kind: 'game', advance: { on: 'manual' }, elements: [unit('h', '{hh}'), unit('m', '{mm}'), unit('s', '{ss}')] }],
    }
    playProject(project, {}, { mount: mountEl, interactive: true })
    return (id) => mountEl.querySelector<HTMLElement>(`.pa-el[data-id="${id}"] .pa-text-inner`)!.textContent ?? ''
  }

  it('flip together on the second edge', () => {
    vi.setSystemTime(at(12, 59, 59, 700)) // 11:00:00.3 left
    const read = mount()
    expect([read('h'), read('m'), read('s')]).toEqual(['11', '00', '00'])
    vi.advanceTimersByTime(320) // 13:00:00.020 — just past the edge
    expect([read('h'), read('m'), read('s')]).toEqual(['10', '59', '59'])
  })

  it('roll over to the next day at midnight', () => {
    vi.setSystemTime(at(23, 59, 58, 500))
    const read = mount()
    expect([read('h'), read('m'), read('s')]).toEqual(['00', '00', '01'])
    vi.advanceTimersByTime(2000) // 00:00:00.5 on the 16th
    expect([read('h'), read('m'), read('s')]).toEqual(['23', '59', '59'])
  })
})
