// The end card installs on a deliberate CLICK on it — never on its own.
//
// The card mounts synchronously inside the pointerdown that ends the previous scene, and on
// touch devices that same gesture keeps emitting compatibility ("ghost") mouse events for a
// few hundred ms afterwards, hit-tested onto whatever is under the finger by then — the
// freshly-mounted card. So the card ignores input briefly after it appears, and then wants a
// full press → release rather than a bare press.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import { notifyGameEnd, triggerCTA } from './networks'
import type { Scene, SceneElement } from './scene'
import type { AssetMap } from './types'

vi.mock('./networks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./networks')>()),
  notifyGameEnd: vi.fn(),
  notifyGameClose: vi.fn(),
  triggerCTA: vi.fn(),
}))

const ARM_MS = 400

const endsceneEl: SceneElement = {
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
  endscene: { objectFit: 'cover', bgColor: '#000000', loop: true },
} as SceneElement

const scene = (els: SceneElement[]): Scene => ({
  meta: { schemaVersion: 1, name: 'end', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: els,
  kind: 'endscene',
})

function mountCard(el: SceneElement = endsceneEl, assets: AssetMap = { vid: { src: 'data:video/mp4;base64,', w: 1080, h: 1920, kind: 'video' } }): HTMLElement {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  setDesign(1080, 1920)
  computeMetrics(540, 960)
  const stage = buildScene(scene([el]), assets, { mount: host })
  stage.layoutAll()
  return stage.get(el.id)!.content as HTMLElement
}

const press = (wrap: HTMLElement): void => {
  wrap.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}
const release = (wrap: HTMLElement): void => {
  wrap.dispatchEvent(new Event('pointerup', { bubbles: true }))
}

describe('endscene tap-to-install', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(triggerCTA).mockClear()
    vi.mocked(notifyGameEnd).mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('does not install just because the card appeared', () => {
    mountCard()
    vi.advanceTimersByTime(5000)
    expect(triggerCTA).not.toHaveBeenCalled()
  })

  it('ignores the gesture that brought the player here (its ghost events land on the card)', () => {
    const wrap = mountCard()
    // The previous scene's tap: its compatibility mouse events arrive ~300ms later, on the card.
    vi.advanceTimersByTime(300)
    press(wrap)
    release(wrap)
    expect(triggerCTA).not.toHaveBeenCalled()
  })

  it('installs on a click once armed — and only on the release', () => {
    const wrap = mountCard()
    vi.advanceTimersByTime(ARM_MS)

    press(wrap)
    expect(triggerCTA).not.toHaveBeenCalled() // a press is not a click

    release(wrap)
    expect(triggerCTA).toHaveBeenCalledTimes(1)
  })

  it('does not install when the press is cancelled instead of released', () => {
    const wrap = mountCard()
    vi.advanceTimersByTime(ARM_MS)

    press(wrap)
    wrap.dispatchEvent(new Event('pointercancel', { bubbles: true }))
    release(wrap)
    expect(triggerCTA).not.toHaveBeenCalled()
  })

  it('needs a fresh press for each install — a stray release does nothing', () => {
    const wrap = mountCard()
    vi.advanceTimersByTime(ARM_MS)

    press(wrap)
    release(wrap)
    release(wrap)
    expect(triggerCTA).toHaveBeenCalledTimes(1)
  })

  it('forwards a nested HTML endscene gameEnd without installing', () => {
    const wrap = mountCard({
      ...endsceneEl,
      id: 'html-end',
      endscene: { mode: 'html', htmlId: 'html' },
    } as SceneElement, { html: { src: 'data:text/html;base64,PGh0bWw+PGhlYWQ+PC9oZWFkPjxib2R5PjwvYm9keT48L2h0bWw+', w: 0, h: 0, kind: 'html' } })
    const iframe = wrap.querySelector('iframe') as HTMLIFrameElement

    window.dispatchEvent(new MessageEvent('message', { data: { __paEnd: 'end' }, source: iframe.contentWindow }))

    expect(notifyGameEnd).toHaveBeenCalledTimes(1)
    expect(triggerCTA).not.toHaveBeenCalled()
  })

  it('still gates nested HTML CTA messages until the card is armed', () => {
    const wrap = mountCard({
      ...endsceneEl,
      id: 'html-end',
      endscene: { mode: 'html', htmlId: 'html' },
    } as SceneElement, { html: { src: 'data:text/html;base64,PGh0bWw+PC9odG1sPg==', w: 0, h: 0, kind: 'html' } })
    const iframe = wrap.querySelector('iframe') as HTMLIFrameElement

    window.dispatchEvent(new MessageEvent('message', { data: { __paEnd: 'cta' }, source: iframe.contentWindow }))
    expect(triggerCTA).not.toHaveBeenCalled()

    vi.advanceTimersByTime(ARM_MS)
    window.dispatchEvent(new MessageEvent('message', { data: { __paEnd: 'cta' }, source: iframe.contentWindow }))
    expect(triggerCTA).toHaveBeenCalledTimes(1)
  })
})
