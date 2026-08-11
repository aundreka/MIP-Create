// Two network audio rules, enforced in sfx.ts:
//   • Nothing makes a sound before the first user interaction (no autoplay). A sceneEnter
//     binding on the first scene fires at load, so one-shots are dropped and loops held
//     until the first gesture.
//   • Audio stops or mutes when the ad is hidden or closed. Suspending the shared
//     AudioContext isn't enough — on iOS playback runs through HTMLAudioElement.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSfxManager } from './sfx'
import { emit } from './emitter'
import type { Project } from './scene'
import type { AssetMap } from './types'

// Distinct payloads so a played element can be traced back to its binding.
const SRC = 'data:audio/mpeg;base64,AAAA'
const SRC_BGM = 'data:audio/mpeg;base64,BBBB'

const project = (): Project => ({
  meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  startSceneId: 's1',
  scenes: [{ id: 's1', name: 's1', kind: 'overlay', advance: { on: 'manual' }, elements: [] }],
  sfx: [{ event: 'tap', assetId: 'a1', volume: 1 }],
  bgm: { assetId: 'a2', volume: 0.5 },
})
const assets = (): AssetMap => ({
  a1: { src: SRC, kind: 'audio', w: 0, h: 0 },
  a2: { src: SRC_BGM, kind: 'audio', w: 0, h: 0 },
})

// jsdom has no audio pipeline: track play()/pause() on the prototype instead.
let plays: HTMLAudioElement[]
let pauses: HTMLAudioElement[]
let playing: WeakSet<HTMLMediaElement>

beforeEach(() => {
  plays = []
  pauses = []
  playing = new WeakSet()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLAudioElement) {
    plays.push(this)
    playing.add(this)
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLAudioElement) {
    pauses.push(this)
    playing.delete(this)
  })
  // `paused` is read-only in jsdom and always true, which would make the pause-on-hide
  // sweep skip every element. Mirror the mocked play/pause state instead.
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: HTMLAudioElement) {
      return !playing.has(this)
    },
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/** A real user gesture — what unlocks audio. */
const tap = (): void => {
  window.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}

describe('no audio before the first interaction', () => {
  it('drops a one-shot fired at load', () => {
    const mgr = createSfxManager(project(), assets(), document.body)
    plays.length = 0
    emit('sfx', 'tap')
    expect(plays).toEqual([])
    mgr.destroy()
  })

  it('plays the same one-shot after a gesture', () => {
    const mgr = createSfxManager(project(), assets(), document.body)
    tap()
    plays.length = 0
    emit('sfx', 'tap')
    expect(plays.length).toBe(1)
    mgr.destroy()
  })

  it('holds a loop armed at load and starts it on the first gesture', () => {
    const mgr = createSfxManager(project(), assets(), document.body)
    plays.length = 0
    emit('sfx-loop-start', 'tap')
    expect(plays).toEqual([])
    tap()
    expect(plays.length).toBeGreaterThan(0)
    mgr.destroy()
  })

  it('does not start a held loop that was stopped before the gesture', () => {
    const mgr = createSfxManager(project(), assets(), document.body)
    emit('sfx-loop-start', 'tap')
    emit('sfx-loop-stop', 'tap')
    plays.length = 0
    tap()
    // The BGM starts on the gesture as usual; the cancelled loop must not come back —
    // any play of its element is either the muted prime or already stopped.
    const sfxPlays = plays.filter((el) => el.src === SRC && !el.muted)
    expect(sfxPlays).toEqual([])
    mgr.destroy()
  })
})

describe('audio stops when the ad is hidden or closed', () => {
  it('pauses the element-path audio on ad-pause, not just the AudioContext', () => {
    const mgr = createSfxManager(project(), assets(), document.body)
    tap()
    emit('sfx-loop-start', 'tap')
    const looping = plays.filter((el) => !el.paused)
    expect(looping.length).toBeGreaterThan(0)

    pauses.length = 0
    emit('ad-pause')
    for (const el of looping) expect(pauses).toContain(el)
    mgr.destroy()
  })

  it('mutes any video while hidden and restores it on resume', () => {
    const video = document.createElement('video')
    video.className = 'pa-endscene-video'
    document.body.appendChild(video)
    const mgr = createSfxManager(project(), assets(), document.body)
    tap()
    expect(video.muted).toBe(false)

    emit('ad-pause')
    expect(video.muted).toBe(true)
    emit('ad-resume')
    expect(video.muted).toBe(false)
    mgr.destroy()
  })

  it('resumes only what it paused', () => {
    const mgr = createSfxManager(project(), assets(), document.body)
    tap()
    emit('sfx-loop-start', 'tap')
    emit('ad-pause')
    plays.length = 0
    emit('ad-resume')
    expect(plays.length).toBeGreaterThan(0)
    // A second resume must not re-play anything.
    plays.length = 0
    emit('ad-resume')
    expect(plays).toEqual([])
    mgr.destroy()
  })
})
