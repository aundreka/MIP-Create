// A sound bound to a LATER scene is requested from a timer or a scene change, with no
// gesture of its own. iOS grants playback per element and only from a real gesture, so
// such a cue can be refused — and before this it was refused exactly once and then lost,
// which is how a scene-enter sound came to never play at all on an iPhone.
//
// These cover the recovery: the same element is re-primed at every gesture boundary, and
// a refused cue is held and re-attempted at the next one while it is still current.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSfxManager } from './sfx'
import { emit } from './emitter'
import type { Project, SceneElement } from './scene'
import type { AssetMap } from './types'

const SRC = 'data:audio/mpeg;base64,AAAA'

/** A project whose second scene plays 'a1' as it is entered. */
const project = (): Project => {
  const p: Project = {
    meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    startSceneId: 's1',
    scenes: [
      { id: 's1', name: 's1', kind: 'game', advance: { on: 'gameWin', to: 's2' }, elements: [] },
      { id: 's2', name: 'win', kind: 'game', advance: { on: 'timer', delayMs: 4000 }, elements: [] },
    ],
  }
  p.scenes[1].elements = [
    {
      id: 'game', type: 'game-mount', name: 'Game', x: 0, y: 0,
      anchor: 'center', zIndex: 0, mode: 'fit',
      sfx: [{ event: 'sceneEnter', assetId: 'a1' }],
    } as SceneElement,
  ]
  return p
}
const assets = (): AssetMap => ({ a1: { src: SRC, kind: 'audio', w: 0, h: 0 } })

// iOS model: play() is refused unless the test allows it. Every attempt is recorded with
// the element it ran on, so a retry can be shown to reuse the same element.
interface Attempt { el: HTMLAudioElement; muted: boolean }
let attempts: Attempt[]
let verdict: () => null | { name: string }

beforeEach(() => {
  attempts = []
  verdict = () => null // allow
  vi.useFakeTimers()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLAudioElement) {
    attempts.push({ el: this, muted: this.muted })
    const refusal = verdict()
    if (!refusal) return Promise.resolve()
    const err = new Error('refused')
    err.name = refusal.name
    return Promise.reject(err)
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

/** A real user gesture. */
const down = (): void => void window.dispatchEvent(new Event('pointerdown', { bubbles: true }))
const up = (): void => void window.dispatchEvent(new Event('pointerup', { bubbles: true }))
/** Let the play() promises settle without advancing the clock. */
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve() }

/** The audible (unmuted) attempts only — priming is muted. */
const audible = (): Attempt[] => attempts.filter((a) => !a.muted)

describe('a refused scene-enter cue is recovered, not lost', () => {
  it('retries it on the next gesture, reusing the same element', async () => {
    verdict = () => ({ name: 'NotAllowedError' }) // iOS refuses everything at first
    const mgr = createSfxManager(project(), assets(), document.body)
    down()
    await flush()

    // The scene change asks for the sound from a timer: refused, as on an iPhone.
    attempts.length = 0
    emit('sfx-asset', 'a1', 1)
    await flush()
    expect(audible().length).toBe(1)
    const el = audible()[0].el

    // The player taps again and playback is now permitted.
    verdict = () => null
    attempts.length = 0
    down()
    await flush()

    const retried = audible()
    expect(retried.length).toBe(1)
    expect(retried[0].el).toBe(el) // the SAME element — a new tag carries no authorization
    mgr.destroy()
  })

  it('retries on the release of the same tap', async () => {
    verdict = () => ({ name: 'NotAllowedError' })
    const mgr = createSfxManager(project(), assets(), document.body)
    down()
    await flush()
    emit('sfx-asset', 'a1', 1)
    await flush()

    verdict = () => null
    attempts.length = 0
    up()
    await flush()
    expect(audible().length).toBe(1)
    mgr.destroy()
  })

  it('gives up once the cue is older than its freshness window', async () => {
    verdict = () => ({ name: 'NotAllowedError' })
    const mgr = createSfxManager(project(), assets(), document.body)
    down()
    await flush()
    emit('sfx-asset', 'a1', 1)
    await flush()

    verdict = () => null
    attempts.length = 0
    vi.advanceTimersByTime(4001) // the moment this sound marked has long passed
    down()
    await flush()
    expect(audible()).toEqual([])
    mgr.destroy()
  })

  it('does not retry media the browser cannot play at all', async () => {
    verdict = () => ({ name: 'NotSupportedError' })
    const mgr = createSfxManager(project(), assets(), document.body)
    down()
    await flush()
    emit('sfx-asset', 'a1', 1)
    await flush()

    attempts.length = 0
    down()
    await flush()
    expect(attempts).toEqual([]) // neither retried nor re-primed
    mgr.destroy()
  })

  it('drops a cue owed from before the ad was hidden', async () => {
    verdict = () => ({ name: 'NotAllowedError' })
    const mgr = createSfxManager(project(), assets(), document.body)
    down()
    await flush()
    emit('sfx-asset', 'a1', 1)
    await flush()

    emit('ad-pause')
    emit('ad-resume')
    verdict = () => null
    attempts.length = 0
    down()
    await flush()
    expect(audible()).toEqual([])
    mgr.destroy()
  })
})

describe('priming keeps trying across gestures', () => {
  it('re-primes a voice whose first prime was refused', async () => {
    verdict = () => ({ name: 'NotAllowedError' })
    const mgr = createSfxManager(project(), assets(), document.body)
    down()
    await flush()
    expect(attempts.some((a) => a.muted)).toBe(true) // primed once, refused

    attempts.length = 0
    down()
    await flush()
    expect(attempts.some((a) => a.muted)).toBe(true) // and tried again
    mgr.destroy()
  })

  it('stops priming a voice once it is authorized', async () => {
    const mgr = createSfxManager(project(), assets(), document.body)
    down()
    await flush()
    expect(attempts.some((a) => a.muted)).toBe(true)

    attempts.length = 0
    down()
    await flush()
    expect(attempts).toEqual([]) // already primed — nothing more to do
    mgr.destroy()
  })

  it('does not let a settling prime stop the real cue on the same element', async () => {
    const mgr = createSfxManager(project(), assets(), document.body)
    const paused: HTMLAudioElement[] = []
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLAudioElement) {
      paused.push(this)
    })
    down()                       // prime starts, promise not yet settled
    emit('sfx-asset', 'a1', 1)   // the cue arrives mid-prime and takes the element over
    await flush()

    const played = audible()
    expect(played.length).toBe(1)
    expect(paused).not.toContain(played[0].el) // the stale prime must not pause it
    mgr.destroy()
  })
})
