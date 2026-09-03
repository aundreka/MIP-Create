// Reaching an HTML end card must not show its background before its content.
//
// The card loads its own document — and, in the SIP template, its own clip — only once it
// is mounted, so the first thing it paints is the bare background colour and the video cuts
// in a beat later. Nothing can cross-fade that away afterwards: by then the screen the flow
// came from is gone. So the built end scene is held, invisible, over the screen the player
// is still on until the card can paint (bounded by CARD_HOLD_MS) — see revealWhenCardReady.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign } from './responsive'
import type { Project } from './scene'
import { notifyGameEnd } from './networks'

vi.mock('./networks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./networks')>()),
  notifyGameEnd: vi.fn(),
  notifyGameClose: vi.fn(),
  triggerCTA: vi.fn(),
}))

const htmlAsset = { src: 'data:text/html;base64,PGh0bWw+PGhlYWQ+PC9oZWFkPjxib2R5PjwvYm9keT48L2h0bWw+', w: 0, h: 0, kind: 'html' as const }
const imgAsset = { src: 'data:image/png;base64,iVBORw0KGgo=', w: 100, h: 100, kind: 'image' as const }

// game → end, on a timer, so the flow gets there without simulating a game.
function makeProject(mode: 'html' | 'video'): Project {
  return {
    meta: { schemaVersion: 1, name: 'hold', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    startSceneId: 'game',
    scenes: [
      {
        id: 'game', name: 'Game', kind: 'game',
        elements: [{ id: 't', type: 'text', name: 't', x: 540, y: 800, anchor: 'center', zIndex: 1, mode: 'fit', text: { value: 'play', fontSizePx: 40 } }],
        advance: { on: 'timer', delayMs: 10, to: 'end' },
        transition: { type: 'none', durationMs: 0 },
      },
      {
        id: 'end', name: 'End', kind: 'endscene',
        elements: [{
          id: 'card', type: 'endscene', name: 'card', x: 540, y: 960, w: 1080, h: 1920,
          anchor: 'center', zIndex: 1, mode: 'extend',
          endscene: mode === 'html'
            ? { mode: 'html', htmlId: 'html', objectFit: 'cover', bgColor: '#000000' }
            : { mode: 'video', portraitImageId: 'img', objectFit: 'cover', bgColor: '#000000' },
        }],
        advance: { on: 'manual' },
        transition: { type: 'none', durationMs: 0 },
      },
    ],
  } as Project
}

const cardWrap = (mount: HTMLElement): HTMLElement | null => mount.querySelector('.pa-endscene')
const gameText = (mount: HTMLElement): HTMLElement | null => mount.querySelector('.pa-el[data-id="t"]')
const hidden = (el: HTMLElement | null): boolean => !!el && (el.closest('.pa-root') as HTMLElement | null)?.style.opacity === '0'

describe('holding the screen while an HTML end card loads', () => {
  let mount: HTMLElement
  let mgr: { destroy(): void } | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    mount = document.createElement('div')
    document.body.appendChild(mount)
  })

  afterEach(() => {
    mgr?.destroy()
    mgr = null
    vi.useRealTimers()
  })

  it('keeps the game on screen — and the end card invisible — until the card can paint', () => {
    mgr = playProject(makeProject('html'), { html: htmlAsset }, { mount, interactive: true })
    vi.advanceTimersByTime(20)

    // The end scene is built (the card has to be on the DOM before it loads a thing) but
    // held back, and the game the player is looking at is still there.
    const wrap = cardWrap(mount)
    expect(wrap).toBeTruthy()
    expect(hidden(wrap)).toBe(true)
    expect(gameText(mount)).toBeTruthy()
    // Nothing that belongs to arriving has fired yet.
    expect(notifyGameEnd).not.toHaveBeenCalled()

    // jsdom never loads a srcdoc, so report the card ready the way a loaded one does.
    const iframe = wrap!.querySelector('iframe') as HTMLIFrameElement
    iframe.style.visibility = ''
    vi.advanceTimersByTime(120)

    expect(hidden(cardWrap(mount))).toBe(false)
    expect(notifyGameEnd).toHaveBeenCalled()
  })

  it('gives up on a card that never reports and shows it anyway', () => {
    mgr = playProject(makeProject('html'), { html: htmlAsset }, { mount, interactive: true })
    vi.advanceTimersByTime(20)
    expect(hidden(cardWrap(mount))).toBe(true)

    // The iframe stays hidden — a card whose document never finishes. The flow must not
    // strand the player on the game scene.
    vi.advanceTimersByTime(1400)
    expect(hidden(cardWrap(mount))).toBe(false)
    expect(notifyGameEnd).toHaveBeenCalled()
  })

  it('does not hold a video-mode end card', () => {
    mgr = playProject(makeProject('video'), { img: imgAsset }, { mount, interactive: true })
    vi.advanceTimersByTime(20)
    expect(cardWrap(mount)).toBeTruthy()
    expect(hidden(cardWrap(mount))).toBe(false)
    expect(notifyGameEnd).toHaveBeenCalled()
  })
})
