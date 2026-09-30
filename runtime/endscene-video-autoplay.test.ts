// The end card's clip has to roll on its own — the player pressing play is the bug.
//
// Two things stop it. An export inlines the clip as a data: URL, which WebKit will not
// play at all (it drives <video> with byte-range requests, and data: serves none), so the
// source is handed over as a blob instead. And the first play() can still be refused — a
// container that only grants playback inside a gesture, iOS Low Power Mode — after which
// nothing used to ask again, leaving a paused clip wearing the webview's play button.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import { emit } from './emitter'
import { videoSrc } from './mediaSrc'
import type { Scene, SceneElement } from './scene'

const DATA_MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29t'

const asset = { src: DATA_MP4, w: 1080, h: 1920, kind: 'video' as const }

const el: SceneElement = {
  id: 'end',
  type: 'endscene',
  name: 'End card',
  x: 540,
  y: 960,
  w: 1080,
  h: 1920,
  anchor: 'center',
  zIndex: 1,
  mode: 'extend',
  endscene: { portraitVideoId: 'v' },
} as SceneElement

const scene: Scene = {
  meta: { schemaVersion: 1, name: 'end', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: [el],
  kind: 'endscene',
}

// jsdom has no media stack, so stand in for one: `allow` decides whether play() resolves,
// and the element stays paused until a call is allowed to succeed.
const clip = { paused: true, ended: false, plays: 0, allow: true }
let realPlay: typeof HTMLMediaElement.prototype.play
let realLoad: typeof HTMLMediaElement.prototype.load

function mount(): { wrap: HTMLElement; video: HTMLVideoElement; destroy: () => void } {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  setDesign(1080, 1920)
  computeMetrics(540, 960)
  const stage = buildScene(scene, { v: asset }, { mount: host })
  stage.layoutAll()
  const wrap = stage.get('end')!.content as HTMLElement
  return { wrap, video: wrap.querySelector('video')!, destroy: () => stage.destroy() }
}

describe('videoSrc', () => {
  it('hands a <video> a blob instead of the data: URL an export inlines', () => {
    const out = videoSrc(DATA_MP4)
    expect(out.startsWith('blob:')).toBe(true)
  })

  it('reuses one blob per source rather than decoding the clip again', () => {
    expect(videoSrc(DATA_MP4)).toBe(videoSrc(DATA_MP4))
  })

  it('leaves a hosted source alone', () => {
    expect(videoSrc('https://cdn.example/clip.mp4')).toBe('https://cdn.example/clip.mp4')
  })
})

describe('video endscene autoplay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clip.paused = true
    clip.ended = false
    clip.plays = 0
    clip.allow = true
    realPlay = HTMLMediaElement.prototype.play
    realLoad = HTMLMediaElement.prototype.load
    HTMLMediaElement.prototype.load = function () {}
    HTMLMediaElement.prototype.play = function () {
      clip.plays++
      if (!clip.allow) return Promise.reject(new DOMException('blocked', 'NotAllowedError'))
      clip.paused = false
      return Promise.resolve()
    }
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get: () => clip.paused,
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'ended', {
      configurable: true,
      get: () => clip.ended,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    emit('ad-resume')
    HTMLMediaElement.prototype.play = realPlay
    HTMLMediaElement.prototype.load = realLoad
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).paused
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).ended
  })

  it('points the element at a blob, not the inlined data: URL', () => {
    const { video, destroy } = mount()
    expect(video.getAttribute('src')!.startsWith('blob:')).toBe(true)
    destroy()
  })

  it('starts the clip without waiting for a tap', () => {
    const { destroy } = mount()
    expect(clip.plays).toBeGreaterThan(0)
    expect(clip.paused).toBe(false)
    destroy()
  })

  it('asks again after a refusal instead of parking on the play button', async () => {
    clip.allow = false
    const { video, destroy } = mount()
    const refused = clip.plays
    expect(clip.paused).toBe(true)

    // The refusal fallback drops the sound — a silent card beats a frozen one.
    await vi.advanceTimersByTimeAsync(0)
    expect(video.muted).toBe(true)

    clip.allow = true
    await vi.advanceTimersByTimeAsync(500)
    expect(clip.plays).toBeGreaterThan(refused)
    expect(clip.paused).toBe(false)
    destroy()
  })

  it('takes a host gesture rather than waiting for the next tick', () => {
    clip.allow = false
    const { destroy } = mount()
    clip.allow = true
    const before = clip.plays

    window.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(clip.plays).toBeGreaterThan(before)
    expect(clip.paused).toBe(false)
    destroy()
  })

  it('leaves the clip alone while the ad is off screen', () => {
    const { destroy } = mount()
    emit('ad-pause')
    clip.paused = true
    const before = clip.plays
    vi.advanceTimersByTime(2000)
    expect(clip.plays).toBe(before)

    emit('ad-resume')
    vi.advanceTimersByTime(500)
    expect(clip.paused).toBe(false)
    destroy()
  })

  it('leaves a clip the timeline playhead is holding', () => {
    const { video, destroy } = mount()
    video.dataset.tlHold = '1'
    clip.paused = true
    const before = clip.plays
    vi.advanceTimersByTime(2000)
    expect(clip.plays).toBe(before)
    destroy()
  })

  it('does not restart a clip that has run to its end', () => {
    const { destroy } = mount()
    clip.paused = true
    clip.ended = true
    const before = clip.plays
    vi.advanceTimersByTime(2000)
    expect(clip.plays).toBe(before)
    destroy()
  })

  it('stops driving a card that has been torn down', () => {
    const { wrap, destroy } = mount()
    destroy()
    wrap.remove()
    clip.paused = true
    const before = clip.plays
    vi.advanceTimersByTime(2000)
    expect(clip.plays).toBe(before)
  })
})
