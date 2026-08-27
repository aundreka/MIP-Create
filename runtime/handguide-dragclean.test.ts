// The editable Drag to clean handguide carries the tool onto the obstacle the game
// currently marks, and re-aims as obstacles disappear — without moving anything real.

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
  handguide: { mode: 'dragclean', periodMs: PERIOD },
}

/** Build a scene with just the guide, then fake the game's published markers. The
 * tool sits at (100,100,100,100) — centre (150,150) — and the obstacle at
 * (400,600,200,200) — centre (500,700). */
function setup(): { visual: HTMLElement; root: HTMLElement; mess: HTMLElement; stage: ReturnType<typeof buildScene> } {
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'clean hand', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    elements: [GUIDE],
    kind: 'game',
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene, { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
  stage.layoutAll()

  const root = host.querySelector('.pa-root') as HTMLElement
  const tool = document.createElement('div')
  tool.dataset.cleanDrag = '1'
  tool.getBoundingClientRect = () => rect(100, 100, 100, 100)
  root.appendChild(tool)

  const mess = document.createElement('div')
  mess.dataset.cleanHint = '1'
  mess.getBoundingClientRect = () => rect(400, 600, 200, 200)
  root.appendChild(mess)

  const guideOuter = host.querySelector('.pa-el[data-id="hg"]') as HTMLElement
  guideOuter.getBoundingClientRect = () => rect(0, 0, 60, 74)
  stage.startGames(true)
  return { visual: guideOuter.querySelector('img') as HTMLElement, root, mess, stage }
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

describe('editable handguide: drag to clean mode', () => {
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

  it('carries the hand from the tool onto the obstacle', () => {
    const { visual, stage } = setup()

    // Grab beat: still on the tool, nothing travelled yet.
    paintFrame(PERIOD * 0.1)
    const grab = expectedOffset(0.1)
    expect(visual.style.transform).toContain(`translate(${grab.x}px,${grab.y}px)`)

    // Mid-carry, on the shared drag curve — the same one the combo hand uses, so both
    // games mime the identical grab / carry / release.
    paintFrame(PERIOD * 0.48)
    const mid = expectedOffset(0.48)
    expect(visual.style.transform).toContain(`translate(${mid.x}px,${mid.y}px)`)

    // Wiped, over the obstacle's centre.
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
    stage.destroy()
  })

  it('fades out after the wipe so the loop never shows the jump back', () => {
    const { visual, stage } = setup()
    paintFrame(PERIOD * 0.5)
    expect(Number(visual.style.opacity)).toBe(1)
    paintFrame(PERIOD * 0.97)
    expect(Number(visual.style.opacity)).toBeLessThan(0.3)
    stage.destroy()
  })

  it('re-aims when the game marks the next obstacle', () => {
    const { visual, root, mess, stage } = setup()
    paintFrame(PERIOD * 0.1)

    // The game moves the marker to the nearest one still standing after every wipe;
    // the same hand follows with no re-authoring.
    delete mess.dataset.cleanHint
    const next = document.createElement('div')
    next.dataset.cleanHint = '1'
    next.getBoundingClientRect = () => rect(800, 200, 100, 100)
    root.appendChild(next)

    paintFrame(PERIOD * 1.5)
    // Half way from the tool's centre (150,150) toward the NEW obstacle (850,250).
    const g = dragGesture(0.5)
    const x = Math.round(150 + (850 - 150) * g.travel - 60 * 0.22)
    const y = Math.round(150 + (250 - 150) * g.travel - 74 * 0.12)
    expect(visual.style.transform).toContain(`translate(${x}px,${y}px)`)
    stage.destroy()
  })

  it('hides itself while the board has nothing left to point at', () => {
    const { visual, mess, stage } = setup()
    paintFrame(PERIOD * 0.4)
    expect(Number(visual.style.opacity)).toBeGreaterThan(0)

    // Every obstacle cleaned: the game clears the marker entirely.
    delete mess.dataset.cleanHint
    paintFrame(PERIOD * 0.5)
    expect(visual.style.opacity).toBe('0')
    stage.destroy()
  })
})
