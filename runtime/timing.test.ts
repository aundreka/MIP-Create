// Element timing windows (TimingConfig): the video-editor style in/out clip.
//
// Covers the two drivers on StageHandle.seekTimeline — the editor's frozen playhead
// and real playback — plus the invariant that matters most in practice: the hidden
// state survives a relayout, since layoutRec rewrites inline opacity on every resize
// and an inline hide would be silently dropped by the next rotation.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920

function el(over: Partial<SceneElement>): SceneElement {
  return {
    id: 'x',
    type: 'text',
    name: 'Text',
    x: 540,
    y: 600,
    anchor: 'center',
    zIndex: 5,
    mode: 'fit',
    text: { value: 'hello', fontSizePx: 60, fontWeight: 700, color: '#fff', align: 'center' },
    ...over,
  } as SceneElement
}

function makeScene(elements: SceneElement[]): Scene {
  return {
    meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H },
    elements,
    kind: 'game',
  }
}

function mount(elements: SceneElement[]): ReturnType<typeof buildScene> {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  setDesign(DESIGN_W, DESIGN_H)
  computeMetrics(540, 960)
  const stage = buildScene(makeScene(elements), {}, { mount: host })
  stage.layoutAll()
  return stage
}

const isOff = (stage: ReturnType<typeof buildScene>, id: string): boolean =>
  !!stage.get(id)?.outer.classList.contains('pa-el--t-off')

describe('element timing windows', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('scrubbing shows the element only inside [in, in+duration)', () => {
    // visible 1000ms → 3000ms, with a 400ms exit that extends the tail to 3400ms
    const stage = mount([
      el({
        id: 'a',
        timing: { inMs: 1000, durationMs: 2000 },
        animations: { exit: { preset: 'fade-out', durationMs: 400, delayMs: 0, easing: 'ease-in' } },
      }),
    ])

    stage.seekTimeline(0, false)
    expect(isOff(stage, 'a')).toBe(true)
    stage.seekTimeline(999, false)
    expect(isOff(stage, 'a')).toBe(true)
    stage.seekTimeline(1000, false)
    expect(isOff(stage, 'a')).toBe(false)
    stage.seekTimeline(2500, false)
    expect(isOff(stage, 'a')).toBe(false)
    stage.seekTimeline(3200, false) // mid-exit — still on screen, animating out
    expect(isOff(stage, 'a')).toBe(false)
    stage.seekTimeline(3400, false) // exit finished
    expect(isOff(stage, 'a')).toBe(true)
  })

  it('freezes the entrance on the matching frame while scrubbing', () => {
    const stage = mount([
      el({
        id: 'a',
        timing: { inMs: 1000, durationMs: 2000 },
        animations: { entrance: { preset: 'slide-up', durationMs: 500, delayMs: 0, easing: 'ease-out', trigger: 'onMount' } },
      }),
    ])
    stage.seekTimeline(1250, false)
    const anim = stage.get('a')!.anim
    expect(anim.style.animationPlayState).toBe('paused')
    // 250ms into a 500ms entrance = a -250ms delay, which renders that exact frame
    expect(anim.style.animation).toContain('pa-slide-up')
    expect(anim.style.animation).toContain('-250ms')
  })

  it('an open clip (no duration) never hides once it is in', () => {
    const stage = mount([el({ id: 'a', timing: { inMs: 500 } })])
    stage.seekTimeline(0, false)
    expect(isOff(stage, 'a')).toBe(true)
    stage.seekTimeline(500, false)
    expect(isOff(stage, 'a')).toBe(false)
    stage.seekTimeline(999999, false)
    expect(isOff(stage, 'a')).toBe(false)
  })

  it('playback hides, then reveals at the in point, then hides again at the out point', () => {
    const stage = mount([el({ id: 'a', timing: { inMs: 400, durationMs: 600 } })])
    stage.seekTimeline(0, true)
    expect(isOff(stage, 'a')).toBe(true)
    vi.advanceTimersByTime(400)
    expect(isOff(stage, 'a')).toBe(false)
    vi.advanceTimersByTime(600) // reaches the out point; no exit animation → gone at once
    expect(isOff(stage, 'a')).toBe(true)
  })

  it('keeps the element hidden across a relayout (resize / rotation)', () => {
    const stage = mount([el({ id: 'a', timing: { inMs: 2000, durationMs: 1000 } })])
    stage.seekTimeline(0, false)
    expect(isOff(stage, 'a')).toBe(true)
    computeMetrics(960, 540) // rotate to landscape
    stage.layoutAll()
    expect(isOff(stage, 'a')).toBe(true)
  })

  it('leaves untimed elements alone, and releases an element whose timing was removed', () => {
    const timed = el({ id: 'a', timing: { inMs: 2000, durationMs: 1000 } })
    const plain = el({ id: 'b', x: 300 })
    const stage = mount([timed, plain])
    stage.seekTimeline(0, false)
    expect(isOff(stage, 'a')).toBe(true)
    expect(isOff(stage, 'b')).toBe(false)

    // the author deletes the timing — the next update must un-hide it
    stage.update(makeScene([el({ id: 'a' }), plain]), {})
    expect(isOff(stage, 'a')).toBe(false)
  })

  it('does not shift a timed, animated date text at any viewport size', () => {
    // The whole point of putting animations on the inner .pa-el-anim node: the outer
    // .pa-el carries the layout, so giving an element a clip + a swipe in/out must not
    // move where it actually sits — at any scale, before, during or after its window.
    const date = (over: Partial<SceneElement> = {}): SceneElement =>
      el({
        id: 'd',
        type: 'countdown',
        x: 540,
        y: 900,
        countdown: { mode: 'dynamic', dynamicDays: 3, format: 'Order by {MMMM} {D}' },
        ...over,
      })
    const posOf = (stage: ReturnType<typeof buildScene>): string => {
      const o = stage.get('d')!.outer
      return `${o.style.left}/${o.style.top}/${o.style.transform}`
    }

    for (const [vw, vh] of [
      [540, 960],
      [390, 844],
      [1180, 820],
    ]) {
      const plain = mount([date()])
      computeMetrics(vw, vh)
      plain.layoutAll()
      const baseline = posOf(plain)

      const timed = mount([
        date({
          timing: { inMs: 500, durationMs: 2000 },
          animations: {
            entrance: { preset: 'swipe-left', durationMs: 600, delayMs: 0, easing: 'ease-out', trigger: 'onMount' },
            exit: { preset: 'swipe-out-right', durationMs: 400, delayMs: 0, easing: 'ease-in' },
          },
        }),
      ])
      computeMetrics(vw, vh)
      timed.layoutAll()
      for (const t of [0, 700, 1500, 2600, 3000]) {
        timed.seekTimeline(t, false)
        timed.layoutAll() // a resize mid-window must not disturb it either
        expect(posOf(timed), `${vw}x${vh} @ ${t}ms`).toBe(baseline)
      }
    }
  })

  it('clears the preview entirely when the timeline panel closes', () => {
    const stage = mount([el({ id: 'a', timing: { inMs: 2000, durationMs: 1000 } })])
    stage.seekTimeline(0, false)
    expect(isOff(stage, 'a')).toBe(true)
    stage.seekTimeline(null, false)
    expect(isOff(stage, 'a')).toBe(false)
  })
})
