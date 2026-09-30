// The editable Slider handguide grabs the game's divider handle and mimes the drag
// to the edge that wins — alternating sides when either end does, so one loop shows
// the compare both ways. It reads the live handle, so it starts from wherever the
// divider was left, and goes quiet once the game drops its markers on the win.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dragGesture } from './hint'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

const PERIOD = 1000
let now = 0

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect
}

function paintFrame(ms: number): void {
  now = ms
  vi.advanceTimersByTime(20)
}

const GUIDE: SceneElement = {
  id: 'hg',
  type: 'handguide',
  name: 'Hint hand',
  x: 540,
  y: 900,
  w: 60,
  h: 74,
  anchor: 'center',
  zIndex: 9,
  mode: 'fit',
  assetId: 'hand',
  handguide: { mode: 'slider', periodMs: PERIOD },
}

/** A scene with just the guide, plus the markers the slider publishes: a track at
 * (100,200,800,600) and a handle centred in it at (480,480,40,40) -> (500,500). */
function setup(edge = 'either'): { visual: HTMLElement; track: HTMLElement; handle: HTMLElement; stage: ReturnType<typeof buildScene> } {
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'slider hand', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    elements: [GUIDE],
    kind: 'game',
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene, { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
  stage.layoutAll()

  const root = host.querySelector('.pa-root') as HTMLElement
  const track = document.createElement('div')
  track.dataset.sliderTrack = '1'
  track.dataset.sliderEdge = edge
  track.getBoundingClientRect = () => rect(100, 200, 800, 600)
  root.appendChild(track)

  const handle = document.createElement('div')
  handle.dataset.sliderHandle = '1'
  handle.getBoundingClientRect = () => rect(480, 480, 40, 40)
  track.appendChild(handle)

  const guideOuter = host.querySelector('.pa-el[data-id="hg"]') as HTMLElement
  guideOuter.getBoundingClientRect = () => rect(0, 0, 60, 74)
  stage.startGames(true)
  return { visual: guideOuter.querySelector('img') as HTMLElement, track, handle, stage }
}

/** Where the finger should sit, off the same drag curve the runtime uses. */
function expectedOffset(phase: number, toX: number): { x: number; y: number } {
  const g = dragGesture(phase)
  return {
    x: Math.round(500 + (toX - 500) * g.travel - 60 * 0.22),
    y: Math.round(500 - 74 * 0.12),
  }
}

describe('editable handguide: slider mode', () => {
  beforeEach(() => {
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    vi.useFakeTimers()
    now = 0
    vi.stubGlobal('performance', { now: () => now })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(now), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('drags the handle toward the far edge, along the track', () => {
    const { visual, stage } = setup('left')
    // Track left edge + 10% of 800 = 180.
    paintFrame(PERIOD * 0.1)
    const grab = expectedOffset(0.1, 180)
    expect(visual.style.transform).toContain(`translate(${grab.x}px,${grab.y}px)`)

    paintFrame(PERIOD * 0.48)
    const mid = expectedOffset(0.48, 180)
    expect(visual.style.transform).toContain(`translate(${mid.x}px,${mid.y}px)`)

    // Arrived: the finger is on the left edge inset, still on the handle's row.
    paintFrame(PERIOD * 0.8)
    expect(visual.style.transform).toContain('translate(167px,491px)')
    stage.destroy()
  })

  it('alternates sides per loop when either end wins — the compare shown both ways', () => {
    const { visual, stage } = setup('either')
    // First loop goes left (180), the next one right (100 + 800 * 0.9 = 820).
    paintFrame(PERIOD * 0.8)
    expect(visual.style.transform).toContain('translate(167px,491px)')
    paintFrame(PERIOD * 1.8)
    expect(visual.style.transform).toContain('translate(807px,491px)')
    stage.destroy()
  })

  it('slides down the card when the game is vertical', () => {
    const { visual, track, stage } = setup('left')
    track.dataset.sliderVertical = '1'
    // Vertical: x stays on the handle, y goes to the top edge inset (200 + 60 = 260).
    paintFrame(PERIOD * 0.8)
    expect(visual.style.transform).toContain('translate(487px,251px)')
    stage.destroy()
  })

  it('starts from wherever the divider was left', () => {
    const { visual, handle, stage } = setup('left')
    handle.getBoundingClientRect = () => rect(680, 480, 40, 40) // player dragged it right
    paintFrame(PERIOD * 0.1)
    const grab = expectedOffset(0.1, 180)
    // Grab beat: still on the handle, which has moved 200px right of where it began.
    expect(visual.style.transform).toContain(`translate(${grab.x + 200}px,${grab.y}px)`)
    stage.destroy()
  })

  it('goes quiet once the game drops its markers on the win', () => {
    const { visual, handle, stage } = setup('left')
    paintFrame(PERIOD * 0.5)
    expect(Number(visual.style.opacity)).toBe(1)
    delete handle.dataset.sliderHandle
    paintFrame(PERIOD * 0.55)
    expect(Number(visual.style.opacity)).toBe(0)
    stage.destroy()
  })

  it('swells while dragging instead of shrinking under the press', () => {
    const { visual, stage } = setup('left')
    paintFrame(PERIOD * 0.48)
    const scale = Number(/scale\(([\d.]+)\)/.exec(visual.style.transform)![1])
    expect(scale).toBeCloseTo(1.04, 2) // 1 - 0.1 press + 0.14 carry
    stage.destroy()
  })
})
