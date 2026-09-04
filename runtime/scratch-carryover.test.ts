// Scratch-progress fades (scratchShowAt / scratchHideAt) on CARRY-OVER elements.
//
// A "fade in at 100%" element that also carries across scenes lives in the persist layer,
// and two writers used to clobber the inline opacity the fade wrote there:
//   1. layoutRec, which rewrites outer.style.opacity from the element on every pass —
//      including the single-rec relayout the countdown day-timer runs on visibilitychange,
//      which popped a not-yet-revealed dynamic date into view a second after load;
//   2. the carry-over layer, which captures each element's opacity at build time and
//      writes it back on every scene change — so a revealed element vanished again the
//      moment the next scene mounted.
// Both are why the state hides by CLASS (.pa-el--scratch-off) instead.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { emit } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Project, SceneElement } from './scene'

vi.mock('./networks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./networks')>()),
  notifyGameEnd: vi.fn(),
  notifyGameClose: vi.fn(),
  triggerCTA: vi.fn(),
}))

const carried = (id: string, extra: Partial<SceneElement>): SceneElement => ({
  id, type: 'text', name: id, x: 540, y: 600,
  anchor: 'center', zIndex: 6, mode: 'fit',
  text: { value: id, fontSizePx: 40 },
  persist: true, persistScenes: ['s1', 's2'],
  ...extra,
})

// A dynamic date is the element that actually shipped broken: it is the only type that
// relayouts itself mid-scene (the day timer), which is what dropped the inline hide.
const dateEl = carried('date', {
  type: 'countdown',
  countdown: { mode: 'dynamic', dynamicDays: 0, format: 'MMMM D, YYYY' },
  scratchShowAt: 100,
})
const laterEl = carried('later', { scratchShowAt: 100 })
const sooner: SceneElement = {
  id: 'sooner', type: 'text', name: 'sooner', x: 540, y: 800,
  anchor: 'center', zIndex: 2, mode: 'fit',
  text: { value: 'scratch me', fontSizePx: 40 },
  scratchHideAt: 100,
}

function project(): Project {
  return {
    meta: { schemaVersion: 1, name: 'scratch-carry', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, bgMatchColor: '#fff' },
    startSceneId: 's1',
    scenes: [
      { id: 's1', name: 'One', kind: 'game', elements: [sooner, laterEl, dateEl], advance: { on: 'tap', delayMs: 0 }, transition: { type: 'none', durationMs: 0 } },
      { id: 's2', name: 'Two', kind: 'game', elements: [], advance: { on: 'manual' }, transition: { type: 'none', durationMs: 0 } },
    ],
  }
}

describe('scratch-progress fades on carry-over elements', () => {
  let mount: HTMLElement
  let mgr: { destroy(): void; relayout(): void } | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    mount = document.createElement('div')
    document.body.appendChild(mount)
    mgr = playProject(project(), {}, { mount, interactive: true })
  })

  afterEach(() => {
    mgr?.destroy()
    mgr = null
    vi.useRealTimers()
  })

  const el = (id: string): HTMLElement => mount.querySelector(`.pa-el[data-id="${id}"]`) as HTMLElement
  const off = (id: string): boolean => el(id).classList.contains('pa-el--scratch-off')
  // Tap the scene (not a CTA) and let the advance timer run.
  const tapScene = (): void => {
    mount.querySelector<HTMLElement>('.pa-stage > .pa-root')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.advanceTimersByTime(400)
  }

  it('hides a "show at 100%" carry-over element before any scratching', () => {
    expect(off('later')).toBe(true)
    expect(off('date')).toBe(true)
    expect(off('sooner')).toBe(false)
  })

  it('keeps it hidden when the dynamic date relayouts itself on visibilitychange', () => {
    document.dispatchEvent(new Event('visibilitychange'))
    expect(off('date')).toBe(true)
    expect(el('date').style.opacity).not.toBe('1') // the inline value is not what hides it
  })

  it('keeps it hidden across a resize of the carry-over layer', () => {
    mgr!.relayout()
    expect(off('later')).toBe(true)
    expect(off('date')).toBe(true)
  })

  it('reveals at full progress and keeps it revealed into the next scene', () => {
    mgr!.relayout() // the layout pass that used to capture the hidden opacity as "resting"
    emit('scratch-progress', 1)
    expect(off('later')).toBe(false)
    expect(off('date')).toBe(false)
    expect(el('sooner').classList.contains('pa-el--scratch-off')).toBe(true)

    tapScene()
    expect(off('later')).toBe(false)
    expect(off('date')).toBe(false)
  })
})
