// The timeline playhead owns video playback while it is previewing.
//
// Without this a clip keeps autoplaying on its own loop, so the canvas shows a frame
// that has nothing to do with where the playhead is — you can't tell which frame your
// overlays actually land on. Clearing the preview hands the video back to its loop.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'

const el = (over: Partial<SceneElement> = {}): SceneElement =>
  ({
    id: 'v',
    type: 'image',
    name: 'Clip',
    x: 540,
    y: 960,
    w: 1080,
    h: 1920,
    anchor: 'center',
    zIndex: 1,
    mode: 'fit',
    ...over,
  }) as SceneElement

const scene = (els: SceneElement[]): Scene => ({
  meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: els,
  kind: 'game',
})

/** jsdom has no media stack — stand up just enough of one to observe the calls. */
function fakeVideo(durationSec: number): HTMLVideoElement {
  const v = document.createElement('video')
  Object.defineProperty(v, 'duration', { configurable: true, value: durationSec })
  Object.defineProperty(v, 'readyState', { configurable: true, value: 1 })
  let paused = true
  Object.defineProperty(v, 'paused', { configurable: true, get: () => paused })
  v.play = (): Promise<void> => {
    paused = false
    return Promise.resolve()
  }
  v.pause = (): void => {
    paused = true
  }
  v.loop = true
  return v
}

function mountWithVideo(over: Partial<SceneElement> = {}, durationSec = 10) {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  setDesign(1080, 1920)
  computeMetrics(540, 960)
  const stage = buildScene(scene([el(over)]), {}, { mount: host })
  stage.layoutAll()
  const v = fakeVideo(durationSec)
  stage.get('v')!.outer.appendChild(v) // stands in for the endscene / video-asset node
  return { stage, v }
}

describe('timeline drives video', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('scrubbing seeks the video to the playhead and pauses it', () => {
    const { stage, v } = mountWithVideo()
    stage.seekTimeline(3000, false)
    expect(v.currentTime).toBeCloseTo(3, 3)
    expect(v.paused).toBe(true)
    stage.seekTimeline(7500, false)
    expect(v.currentTime).toBeCloseTo(7.5, 3)
  })

  it('disables looping while previewing so the clip cannot drift off the ruler', () => {
    const { stage, v } = mountWithVideo()
    expect(v.loop).toBe(true)
    stage.seekTimeline(1000, false)
    expect(v.loop).toBe(false)
  })

  it('plays from the playhead when the timeline runs', () => {
    const { stage, v } = mountWithVideo()
    stage.seekTimeline(2000, true)
    expect(v.currentTime).toBeCloseTo(2, 3)
    expect(v.paused).toBe(false)
  })

  it('parks on the last frame past the end instead of going blank', () => {
    const { stage, v } = mountWithVideo({}, 10)
    stage.seekTimeline(30000, false)
    expect(v.currentTime).toBeCloseTo(9.98, 2) // clamped just shy of duration
    expect(v.paused).toBe(true)
  })

  it("offsets by the element's in-point when it has a clip", () => {
    // A video that enters at 2s should be showing its own 0.5s at playhead 2.5s.
    const { stage, v } = mountWithVideo({ timing: { inMs: 2000 } })
    stage.seekTimeline(2500, false)
    expect(v.currentTime).toBeCloseTo(0.5, 3)
  })

  it('holds the first frame before its in-point, then rolls when it enters', () => {
    const { stage, v } = mountWithVideo({ timing: { inMs: 2000 } })
    stage.seekTimeline(0, true)
    expect(v.currentTime).toBe(0)
    expect(v.paused).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(v.paused).toBe(false)
  })

  it('hands the video back to its own loop when the preview is cleared', () => {
    const { stage, v } = mountWithVideo()
    stage.seekTimeline(3000, false)
    expect(v.loop).toBe(false)
    expect(v.paused).toBe(true)
    stage.seekTimeline(null, false)
    expect(v.loop).toBe(true)
    expect(v.paused).toBe(false)
  })

  it('waits for metadata before seeking a video that has not loaded yet', () => {
    const { stage } = mountWithVideo()
    const late = document.createElement('video')
    Object.defineProperty(late, 'readyState', { configurable: true, value: 0 })
    Object.defineProperty(late, 'duration', { configurable: true, value: NaN })
    late.play = (): Promise<void> => Promise.resolve()
    late.pause = (): void => {}
    stage.get('v')!.outer.appendChild(late)

    stage.seekTimeline(4000, false)
    expect(late.currentTime).toBe(0) // nothing to seek to yet

    Object.defineProperty(late, 'duration', { configurable: true, value: 10 })
    late.dispatchEvent(new Event('loadedmetadata'))
    expect(late.currentTime).toBeCloseTo(4, 3)
  })
})
