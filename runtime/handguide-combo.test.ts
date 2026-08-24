// The editable Combo handguide follows the option the game currently marks and mimes
// the drag / carry / release into the drop area, without touching the real option.

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
  handguide: { mode: 'combo', periodMs: PERIOD },
}

/** Build a scene with just the guide, then fake the game's published markers. */
function setup(): { visual: HTMLElement; root: HTMLElement; option: HTMLElement; stage: ReturnType<typeof buildScene> } {
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'combo hand', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    elements: [GUIDE],
    kind: 'game',
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene, { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
  stage.layoutAll()

  const root = host.querySelector('.pa-root') as HTMLElement
  const zone = document.createElement('div')
  zone.dataset.comboTarget = '1'
  zone.getBoundingClientRect = () => rect(400, 600, 200, 200)
  root.appendChild(zone)

  const option = document.createElement('div')
  option.dataset.comboHint = '1'
  option.getBoundingClientRect = () => rect(100, 100, 100, 100)
  root.appendChild(option)

  const guideOuter = host.querySelector('.pa-el[data-id="hg"]') as HTMLElement
  guideOuter.getBoundingClientRect = () => rect(0, 0, 60, 74)
  stage.startGames(true)
  return { visual: guideOuter.querySelector('img') as HTMLElement, root, option, stage }
}

/** Expected finger offset for a cycle phase, from the same curve the runtime uses. */
function expectedOffset(phase: number): { x: number; y: number } {
  const g = dragGesture(phase)
  const fromX = 150
  const fromY = 150
  return {
    x: Math.round(fromX + (500 - fromX) * g.travel - 60 * 0.22),
    y: Math.round(fromY + (700 - fromY) * g.travel - 74 * 0.12),
  }
}

describe('editable handguide: combo mode', () => {
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

  it('carries the hand from the live option to the drop area', () => {
    const { visual, stage } = setup()

    // Grab beat: still sitting on the option, nothing travelled yet.
    paintFrame(PERIOD * 0.1)
    const grab = expectedOffset(0.1)
    expect(visual.style.transform).toContain(`translate(${grab.x}px,${grab.y}px)`)

    // Mid-carry: part way across, following the shared drag curve.
    paintFrame(PERIOD * 0.48)
    const mid = expectedOffset(0.48)
    expect(visual.style.transform).toContain(`translate(${mid.x}px,${mid.y}px)`)

    // Released over the drop area's centre.
    paintFrame(PERIOD * 0.8)
    expect(visual.style.transform).toContain('translate(487px,691px)')
    stage.destroy()
  })

  it('swells while carrying instead of shrinking under the press', () => {
    const { visual, stage } = setup()
    paintFrame(PERIOD * 0.48)
    const scale = Number(/scale\(([\d.]+)\)/.exec(visual.style.transform)![1])
    // press 1 and carry 1 => 1 - 0.1 + 0.14. Holding something reads as bigger.
    expect(scale).toBeCloseTo(1.04, 2)
    expect(scale).toBeGreaterThan(1)
    stage.destroy()
  })

  it('fades out after the release so the loop never shows the jump back', () => {
    const { visual, stage } = setup()
    paintFrame(PERIOD * 0.5)
    expect(Number(visual.style.opacity)).toBe(1)
    paintFrame(PERIOD * 0.97)
    expect(Number(visual.style.opacity)).toBeLessThan(0.3)
    stage.destroy()
  })

  it('retargets itself when the game marks the next question’s option', () => {
    const { visual, root, option, stage } = setup()
    paintFrame(PERIOD * 0.1)

    // The game moves the marker after a pick; the same hand follows without any
    // re-authoring.
    delete option.dataset.comboHint
    const next = document.createElement('div')
    next.dataset.comboHint = '1'
    next.getBoundingClientRect = () => rect(800, 200, 100, 100)
    root.appendChild(next)

    paintFrame(PERIOD * 1.1)
    // Grab beat again, now over the NEW option at (850,250).
    expect(visual.style.transform).toContain(`translate(${Math.round(850 - 60 * 0.22)}px,${Math.round(250 - 74 * 0.12)}px)`)
    stage.destroy()
  })

  it('hides itself while the game has nothing to point at', () => {
    const { visual, option, stage } = setup()
    paintFrame(PERIOD * 0.4)
    expect(Number(visual.style.opacity)).toBeGreaterThan(0)

    // Between questions the game clears the marker entirely.
    delete option.dataset.comboHint
    paintFrame(PERIOD * 0.5)
    expect(visual.style.opacity).toBe('0')
    stage.destroy()
  })
})
