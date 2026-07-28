// Typewriter reveal (TypingConfig) and the wipe presets.
//
// A wipe must NOT move the element — it stays put while a clip edge crosses it. That
// is the whole difference from the slide/swipe presets, so it is pinned here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import { injectAnimStyles } from './anim'
import type { Scene, SceneElement } from './scene'

const el = (over: Partial<SceneElement> = {}): SceneElement =>
  ({
    id: 't',
    type: 'text',
    name: 'Line',
    x: 540,
    y: 400,
    anchor: 'center',
    zIndex: 5,
    mode: 'fit',
    text: { value: 'HELLO', fontSizePx: 64, fontWeight: 800, color: '#fff', align: 'center' },
    ...over,
  }) as SceneElement

const scene = (els: SceneElement[], extra: Partial<Scene> = {}): Scene => ({
  meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: els,
  kind: 'game',
  ...extra,
})

function mount(els: SceneElement[]): ReturnType<typeof buildScene> {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  setDesign(1080, 1920)
  computeMetrics(540, 960)
  const stage = buildScene(scene(els), {}, { mount: host })
  stage.layoutAll()
  return stage
}
const shown = (stage: ReturnType<typeof buildScene>, id = 't'): string =>
  (stage.get(id)!.content!.firstElementChild as HTMLElement).textContent ?? ''
const hasCaret = (stage: ReturnType<typeof buildScene>, id = 't'): boolean =>
  (stage.get(id)!.content!.firstElementChild as HTMLElement).classList.contains('pa-typing-caret')

describe('typewriter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the whole string on the static editor canvas', () => {
    // The canvas never calls playEntrances, so the text must stay fully editable.
    const s = mount([el({ typing: { cps: 10 } })])
    expect(shown(s)).toBe('HELLO')
  })

  it('reveals one character at a time at the configured speed', () => {
    const s = mount([el({ typing: { cps: 10 } })]) // 100ms per character
    s.playEntrances()
    expect(shown(s)).toBe('')
    vi.advanceTimersByTime(100)
    expect(shown(s)).toBe('H')
    vi.advanceTimersByTime(200)
    expect(shown(s)).toBe('HEL')
    vi.advanceTimersByTime(200)
    expect(shown(s)).toBe('HELLO')
  })

  it('honors a total duration regardless of string length', () => {
    // 'HELLO' is 5 chars in 1000ms => 200ms each; durationMs must win over cps.
    const s = mount([el({ typing: { cps: 999, durationMs: 1000 } })])
    s.playEntrances()
    vi.advanceTimersByTime(200)
    expect(shown(s)).toBe('H')
    vi.advanceTimersByTime(600)
    expect(shown(s)).toBe('HELL')
    vi.advanceTimersByTime(200)
    expect(shown(s)).toBe('HELLO')
  })

  it('waits out the delay before typing', () => {
    const s = mount([el({ typing: { cps: 10, delayMs: 500 } })])
    s.playEntrances()
    vi.advanceTimersByTime(450)
    expect(shown(s)).toBe('')
    vi.advanceTimersByTime(150)
    expect(shown(s)).toBe('H')
  })

  it('settles on the live string so a relayout mid-type does not finish it early', () => {
    const s = mount([el({ typing: { cps: 10 } })])
    s.playEntrances()
    vi.advanceTimersByTime(200)
    expect(shown(s)).toBe('HE')
    computeMetrics(390, 844) // rotate/resize part-way through
    s.layoutAll()
    expect(shown(s)).toBe('HE') // NOT 'HELLO'
    vi.advanceTimersByTime(300)
    expect(shown(s)).toBe('HELLO')
  })

  it('adds the caret while typing and drops it at the end', () => {
    const s = mount([el({ typing: { cps: 10, caret: true } })])
    s.playEntrances()
    vi.advanceTimersByTime(200)
    expect(hasCaret(s)).toBe(true)
    vi.advanceTimersByTime(400)
    expect(shown(s)).toBe('HELLO')
    expect(hasCaret(s)).toBe(false)
  })

  it('keeps the caret when asked', () => {
    const s = mount([el({ typing: { cps: 10, caret: true, keepCaret: true } })])
    s.playEntrances()
    vi.advanceTimersByTime(600)
    expect(shown(s)).toBe('HELLO')
    expect(hasCaret(s)).toBe(true)
  })

  it('loops: types, holds, then starts over', () => {
    const s = mount([el({ typing: { cps: 10, loop: true, holdMs: 300 } })])
    s.playEntrances()
    vi.advanceTimersByTime(500)
    expect(shown(s)).toBe('HELLO')
    vi.advanceTimersByTime(300) // hold elapses -> restart
    expect(shown(s)).toBe('')
    vi.advanceTimersByTime(100)
    expect(shown(s)).toBe('H')
  })

  it('scrubs with the timeline playhead', () => {
    const s = mount([el({ typing: { cps: 10 }, timing: { inMs: 1000, durationMs: 4000 } })])
    s.seekTimeline(1000, false)
    expect(shown(s)).toBe('')
    s.seekTimeline(1300, false)
    expect(shown(s)).toBe('HEL')
    s.seekTimeline(2000, false)
    expect(shown(s)).toBe('HELLO')
    s.seekTimeline(1200, false) // scrubbing BACKWARDS re-hides characters
    expect(shown(s)).toBe('HE')
  })

  it('restores the full string when the timeline preview is cleared', () => {
    const s = mount([el({ typing: { cps: 10 }, timing: { inMs: 1000, durationMs: 4000 } })])
    s.seekTimeline(1200, false)
    expect(shown(s)).toBe('HE')
    s.seekTimeline(null, false)
    expect(shown(s)).toBe('HELLO')
  })

  it('types a dynamic date and then keeps ticking', () => {
    const d = el({
      id: 'd',
      type: 'countdown',
      countdown: { mode: 'clock', format: '{hh}:{mm}' },
      typing: { cps: 10 },
    })
    const s = mount([d])
    s.playEntrances()
    vi.advanceTimersByTime(200)
    expect(shown(s, 'd')).toHaveLength(2) // partway through "HH:MM"
    vi.advanceTimersByTime(400)
    expect(shown(s, 'd')).toMatch(/^\d{2}:\d{2}$/)
  })

  it('types the complete dynamic date when typewriter is the entrance preset', () => {
    vi.setSystemTime(new Date(2026, 6, 27, 12, 0, 0))
    const d = el({
      id: 'd',
      type: 'countdown',
      countdown: { mode: 'dynamic', dynamicDays: 0, format: 'MMMM D' },
      animations: { entrance: { preset: 'typewriter', durationMs: 700, delayMs: 0, easing: 'linear', trigger: 'onMount' } },
    })
    const s = mount([d])
    s.playEntrances()
    vi.advanceTimersByTime(600)
    expect(shown(s, 'd')).toBe('July 2')
    vi.advanceTimersByTime(100)
    expect(shown(s, 'd')).toBe('July 27')
  })

  it('replays typewriter entrances on each looping endscene timeline', () => {
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
    document.body.innerHTML = ''
    const host = document.createElement('div')
    document.body.appendChild(host)
    setDesign(1080, 1920)
    computeMetrics(540, 960)
    const endscene: SceneElement = {
      id: 'v',
      type: 'endscene',
      name: 'Video',
      x: 540,
      y: 960,
      w: 1080,
      h: 1920,
      anchor: 'center',
      zIndex: 1,
      mode: 'extend',
      endscene: { portraitVideoId: 'vid', objectFit: 'cover', bgColor: '#000000', loop: true },
    }
    const text = el({
      timing: { inMs: 200, durationMs: 800 },
      animations: {
        entrance: { preset: 'typewriter', durationMs: 400, delayMs: 0, easing: 'linear', trigger: 'onMount' },
        exit: { preset: 'wipe-out-left', durationMs: 200, delayMs: 0, easing: 'linear' },
      },
    })
    const s = buildScene(scene([endscene, text], { kind: 'endscene', timelineMs: 2000 }), { vid: { src: 'data:video/mp4;base64,', w: 1080, h: 1920, kind: 'video' } }, { mount: host })
    s.layoutAll()
    s.seekTimeline(0, true)

    vi.advanceTimersByTime(200)
    expect(shown(s)).toBe('')
    vi.advanceTimersByTime(400)
    expect(shown(s)).toBe('HELLO')
    vi.advanceTimersByTime(1600)
    expect(shown(s)).toBe('')
    expect(s.get('t')!.anim.style.animation).not.toContain('pa-wipe-out-left')
    vi.advanceTimersByTime(400)
    expect(shown(s)).toBe('HELLO')
  })

  it('resets timed countdown timers on the authored timeline loop even when video duration is longer', () => {
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
    document.body.innerHTML = ''
    const host = document.createElement('div')
    document.body.appendChild(host)
    setDesign(1080, 1920)
    computeMetrics(540, 960)
    const endscene: SceneElement = {
      id: 'v',
      type: 'endscene',
      name: 'Video',
      x: 540,
      y: 960,
      w: 1080,
      h: 1920,
      anchor: 'center',
      zIndex: 1,
      mode: 'extend',
      endscene: { portraitVideoId: 'vid', objectFit: 'cover', bgColor: '#000000', loop: true },
    }
    const timer = el({
      id: 'timer',
      type: 'countdown',
      countdown: { mode: 'timer', seconds: 5, format: '{ss}' },
      timing: { inMs: 0, durationMs: 2000 },
    })
    const s = buildScene(scene([endscene, timer], { kind: 'endscene', timelineMs: 2000 }), { vid: { src: 'data:video/mp4;base64,', w: 1080, h: 1920, kind: 'video' } }, { mount: host })
    s.layoutAll()
    const video = host.querySelector('video')!
    Object.defineProperty(video, 'duration', { value: 30, configurable: true })
    Object.defineProperty(video, 'readyState', { value: 1, configurable: true })
    s.seekTimeline(0, true)
    expect(shown(s, 'timer')).toBe('05')
    vi.advanceTimersByTime(1000)
    expect(shown(s, 'timer')).toBe('04')
    vi.advanceTimersByTime(1000)
    expect(shown(s, 'timer')).toBe('05')
  })

  it('uses authored timelineMs instead of raw video duration for timed endscene overlays', () => {
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
    const durationDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')
    const readyStateDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState')
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => 1 })
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 1 })
    try {
      document.body.innerHTML = ''
      const host = document.createElement('div')
      document.body.appendChild(host)
      setDesign(1080, 1920)
      computeMetrics(540, 960)
      const endscene: SceneElement = {
        id: 'v',
        type: 'endscene',
        name: 'Video',
        x: 540,
        y: 960,
        w: 1080,
        h: 1920,
        anchor: 'center',
        zIndex: 1,
        mode: 'extend',
        endscene: { portraitVideoId: 'vid', objectFit: 'cover', bgColor: '#000000', loop: true },
      }
      const first = el({ id: 'first', type: 'countdown', countdown: { mode: 'dynamic', dynamicDays: 0, format: 'A' }, timing: { inMs: 0, durationMs: 1000 } })
      const second = el({ id: 'second', type: 'countdown', countdown: { mode: 'dynamic', dynamicDays: 7, format: 'B' }, timing: { inMs: 1000, durationMs: 1000 } })
      const s = buildScene(scene([endscene, first, second], { kind: 'endscene', timelineMs: 3000 }), { vid: { src: 'data:video/mp4;base64,', w: 1080, h: 1920, kind: 'video' } }, { mount: host })
      s.layoutAll()
      s.seekTimeline(0, true)
      vi.advanceTimersByTime(1100)
      expect(s.get('second')!.outer.classList.contains('pa-el--t-off')).toBe(false)
    } finally {
      if (durationDesc) Object.defineProperty(HTMLMediaElement.prototype, 'duration', durationDesc)
      if (readyStateDesc) Object.defineProperty(HTMLMediaElement.prototype, 'readyState', readyStateDesc)
    }
  })

  it('rewinds timed overlays when the endscene media source resets', () => {
    vi.setSystemTime(new Date(2026, 6, 27, 12, 0, 0))
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
    document.body.innerHTML = ''
    const host = document.createElement('div')
    document.body.appendChild(host)
    setDesign(1080, 1920)
    computeMetrics(540, 960)
    const endscene: SceneElement = {
      id: 'v',
      type: 'endscene',
      name: 'Video',
      x: 540,
      y: 960,
      w: 1080,
      h: 1920,
      anchor: 'center',
      zIndex: 1,
      mode: 'extend',
      endscene: { portraitVideoId: 'vid', landscapeVideoId: 'vid2', objectFit: 'cover', objectFitL: 'contain', bgColor: '#000000', loop: true },
    }
    const today = el({
      id: 'today',
      type: 'countdown',
      countdown: { mode: 'dynamic', dynamicDays: 0, format: '{date}', dateStyle: 'short' },
      timing: { inMs: 0, durationMs: 1000 },
    })
    const later = el({
      id: 'later',
      type: 'countdown',
      countdown: { mode: 'dynamic', dynamicDays: 90, format: '{date}', dateStyle: 'short' },
      timing: { inMs: 1000, durationMs: 1000 },
    })
    const s = buildScene(scene([endscene, today, later], { kind: 'endscene', timelineMs: 2000 }), {
      vid: { src: 'data:video/mp4;base64,', w: 1080, h: 1920, kind: 'video' },
      vid2: { src: 'data:video/mp4;base64,', w: 1920, h: 1080, kind: 'video' },
    }, { mount: host })
    s.layoutAll()
    s.seekTimeline(1200, true)
    expect(s.get('later')!.outer.classList.contains('pa-el--t-off')).toBe(false)
    s.get('v')!.content!.dispatchEvent(new CustomEvent('pa-endscene-media-reset', { bubbles: true }))
    expect(s.get('today')!.outer.classList.contains('pa-el--t-off')).toBe(false)
    expect(s.get('later')!.outer.classList.contains('pa-el--t-off')).toBe(true)
  })

  it('erases text when typewriter is the exit preset', () => {
    const s = mount([
      el({
        timing: { inMs: 0, durationMs: 1000 },
        animations: { exit: { preset: 'typewriter', durationMs: 500, delayMs: 0, easing: 'linear' } },
      }),
    ])
    s.seekTimeline(1000, false)
    expect(shown(s)).toBe('HELLO')
    s.seekTimeline(1200, false)
    expect(shown(s)).toBe('HEL')
    s.seekTimeline(1400, false)
    expect(shown(s)).toBe('H')
  })

  it('puts the full text back when typing is switched off', () => {
    const s = mount([el({ typing: { cps: 10 } })])
    s.playEntrances()
    vi.advanceTimersByTime(200)
    expect(shown(s)).toBe('HE')
    s.update(scene([el()]), {}) // typing removed in the inspector
    expect(shown(s)).toBe('HELLO')
  })
})

describe('wipe presets', () => {
  it('animate the clip edge and never translate the element', () => {
    injectAnimStyles()
    const css = document.getElementById('pa-anim')?.textContent ?? ''
    for (const name of ['wipe-left', 'wipe-right', 'wipe-up', 'wipe-out-left', 'wipe-out-right', 'wipe-out-up']) {
      const rule = css.match(new RegExp(`@keyframes pa-${name}\\{(?:[^{}]*\\{[^{}]*\\})*[^{}]*\\}`))?.[0] ?? ''
      expect(rule, `pa-${name} missing`).not.toBe('')
      expect(rule, `pa-${name} should clip`).toContain('clip-path')
      // The element must hold its position — that's what makes it a wipe, not a slide.
      expect(rule, `pa-${name} must not move the element`).not.toContain('translate')
    }
  })

  it('wipe-in ends fully uncovered and wipe-out ends fully clipped', () => {
    injectAnimStyles()
    const css = document.getElementById('pa-anim')?.textContent ?? ''
    const rule = (n: string): string => css.match(new RegExp(`@keyframes pa-${n}\\{(?:[^{}]*\\{[^{}]*\\})*[^{}]*\\}`))?.[0] ?? ''
    expect(rule('wipe-right')).toContain('from{clip-path:inset(0 100% 0 0)}')
    expect(rule('wipe-right')).toContain('to{clip-path:inset(0 0 0 0)}')
    expect(rule('wipe-out-right')).toContain('from{clip-path:inset(0 0 0 0)}')
    expect(rule('wipe-out-right')).toContain('to{clip-path:inset(0 0 0 100%)}')
  })

  it('drives a wipe from the element animation config', () => {
    const s = mount([
      el({
        animations: { entrance: { preset: 'wipe-right', durationMs: 700, delayMs: 0, easing: 'ease-out', trigger: 'onMount' } },
      }),
    ])
    s.playEntrances()
    expect(s.get('t')!.anim.style.animation).toContain('pa-wipe-right')
    expect(s.get('t')!.anim.style.animation).toContain('700ms')
  })
})
