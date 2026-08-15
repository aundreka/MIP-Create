// An HTML end card's own clip has to roll without the player pressing play.
//
// A video-mode card plays because the runtime calls play() on it. An HTML card's <video>
// lives in a srcdoc document that never receives a gesture of its own, so a container that
// gates playback on one leaves it parked on the first frame — and the card can also lose
// the clip later (the SIP template pauses on `blur`, which a tap into the frame triggers).
// The host drives it instead, through the same-origin frame: see autoplayHtmlEndscene.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import { emit } from './emitter'
import type { Scene, SceneElement } from './scene'

vi.mock('./networks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./networks')>()),
  notifyGameEnd: vi.fn(),
  notifyGameClose: vi.fn(),
  triggerCTA: vi.fn(),
}))

const htmlAsset = { src: 'data:text/html;base64,PGh0bWw+PGhlYWQ+PC9oZWFkPjxib2R5PjwvYm9keT48L2h0bWw+', w: 0, h: 0, kind: 'html' as const }

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
  endscene: { mode: 'html', htmlId: 'html' },
} as SceneElement

const scene: Scene = {
  meta: { schemaVersion: 1, name: 'end', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: [el],
  kind: 'endscene',
}

// jsdom neither parses srcdoc nor implements play(), so stand a clip up by hand in the
// frame's document and record what the host asks of it.
function mountWithClip(): { wrap: HTMLElement; clip: { paused: boolean; ended: boolean; muted: boolean; plays: number } } {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  setDesign(1080, 1920)
  computeMetrics(540, 960)
  const stage = buildScene(scene, { html: htmlAsset }, { mount: host })
  stage.layoutAll()
  const wrap = stage.get('end')!.content as HTMLElement
  const iframe = wrap.querySelector('iframe') as HTMLIFrameElement

  const clip = { paused: true, ended: false, muted: true, plays: 0 }
  const video = iframe.contentDocument!.createElement('video')
  Object.defineProperties(video, {
    paused: { get: () => clip.paused },
    ended: { get: () => clip.ended },
    muted: { get: () => clip.muted, set: (v: boolean) => (clip.muted = v) },
    play: {
      value: () => {
        clip.plays++
        clip.paused = false
        return Promise.resolve()
      },
    },
  })
  iframe.contentDocument!.body.appendChild(video)
  return { wrap, clip }
}

describe('HTML endscene autoplay', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    emit('ad-resume')
    document.head.querySelectorAll('[data-test-shell-bg]').forEach((el) => el.remove())
  })

  it('primes the iframe and AppLovin bleed guard before the card load paints', () => {
    document.body.innerHTML = ''
    document.documentElement.style.background = ''
    const shellStyle = document.createElement('style')
    shellStyle.dataset.testShellBg = '1'
    shellStyle.textContent = 'html,body{background:#ffffff!important}'
    document.head.appendChild(shellStyle)
    const host = document.createElement('div')
    document.body.appendChild(host)
    setDesign(1080, 1920)
    computeMetrics(540, 960)

    const whiteScene: Scene = {
      ...scene,
      meta: { ...scene.meta, bgMatchColor: '#ffffff' },
    }
    const stage = buildScene(whiteScene, { html: htmlAsset }, { mount: host })
    stage.layoutAll()

    const wrap = stage.get('end')!.content as HTMLElement
    const iframe = wrap.querySelector('iframe') as HTMLIFrameElement
    const bleed = host.querySelector('.pa-bleed') as HTMLElement

    expect(wrap.style.background).toBe('rgb(0, 0, 0)')
    expect(iframe.style.background).toBe('rgb(0, 0, 0)')
    expect(bleed.style.background).toBe('rgb(0, 0, 0)')
    expect(document.body.style.getPropertyPriority('background')).toBe('important')
    expect(document.documentElement.style.getPropertyPriority('background')).toBe('important')
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(0, 0, 0)')
    expect(getComputedStyle(document.documentElement).backgroundColor).toBe('rgb(0, 0, 0)')
    expect(iframe.srcdoc.indexOf('<style>')).toBeGreaterThanOrEqual(0)
    expect(iframe.srcdoc.indexOf('<style>')).toBeLessThan(iframe.srcdoc.indexOf('<script>'))

    iframe.dispatchEvent(new Event('load'))
    expect(iframe.style.visibility).toBe('')

    stage.destroy()
  })

  it('starts the card\'s clip without waiting for a tap', () => {
    const { clip } = mountWithClip()
    expect(clip.plays).toBe(0)

    vi.advanceTimersByTime(500)
    expect(clip.plays).toBeGreaterThan(0)
    expect(clip.paused).toBe(false)
  })

  it('restarts a clip the card stopped on its own (focus moved into the frame)', () => {
    const { clip } = mountWithClip()
    vi.advanceTimersByTime(500)
    const started = clip.plays

    clip.paused = true // the card's blur handler pauses it
    vi.advanceTimersByTime(500)

    expect(clip.plays).toBeGreaterThan(started)
    expect(clip.paused).toBe(false)
  })

  it('takes a host gesture rather than waiting for the next tick', () => {
    const { clip } = mountWithClip()
    vi.advanceTimersByTime(500)
    clip.paused = true
    const started = clip.plays

    window.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(clip.plays).toBeGreaterThan(started)
  })

  it('leaves the clip alone while the ad is off screen', () => {
    const { clip } = mountWithClip()
    vi.advanceTimersByTime(500)

    emit('ad-pause')
    clip.paused = true
    vi.advanceTimersByTime(2000)
    expect(clip.paused).toBe(true)

    emit('ad-resume')
    vi.advanceTimersByTime(500)
    expect(clip.paused).toBe(false)
  })

  it('does not restart a clip that has run to its end', () => {
    const { clip } = mountWithClip()
    vi.advanceTimersByTime(500)

    clip.paused = true
    clip.ended = true
    const started = clip.plays
    vi.advanceTimersByTime(2000)
    expect(clip.plays).toBe(started)
  })

  it('stops driving a card that has been torn down', () => {
    const { wrap, clip } = mountWithClip()
    vi.advanceTimersByTime(500)

    wrap.remove()
    clip.paused = true
    const started = clip.plays
    vi.advanceTimersByTime(2000)
    expect(clip.plays).toBe(started)
  })
})
