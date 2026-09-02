// The editable Configurator handguide taps whichever option the board is waiting on,
// walks to the next group as each one is answered, and goes quiet when the board is
// done. It shares its frame branch with the tap-to-remove / tap-to-reveal hands — same
// gesture, different marker — so this suite pins that the three stay independent, and
// that this one keeps up with an option that MOVES under it (a configurator row opens
// up around a selection, which the other two boards never do).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  handguide: { mode: 'configurator', periodMs: PERIOD },
}

/** Build a scene with just the guide, then fake the game's published marker. */
function setup(): { visual: HTMLElement; root: HTMLElement; option: HTMLElement; stage: ReturnType<typeof buildScene> } {
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'config hand', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    elements: [GUIDE],
    kind: 'game',
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene, { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
  stage.layoutAll()

  const root = host.querySelector('.pa-root') as HTMLElement
  const option = document.createElement('div')
  option.dataset.configHint = '1'
  option.getBoundingClientRect = () => rect(400, 600, 200, 200)
  root.appendChild(option)

  const guideOuter = host.querySelector('.pa-el[data-id="hg"]') as HTMLElement
  guideOuter.getBoundingClientRect = () => rect(0, 0, 60, 74)
  stage.startGames(true)
  return { visual: guideOuter.querySelector('img') as HTMLElement, root, option, stage }
}

const xOf = (t: string): number => Number(/translate\((-?\d+)px,(-?\d+)px\)/.exec(t)![1])
const yOf = (t: string): number => Number(/translate\((-?\d+)px,(-?\d+)px\)/.exec(t)![2])

describe('editable handguide: configurator mode', () => {
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

  it('lands the fingertip on the option the game marked', () => {
    const { visual, stage } = setup()
    // Deep in the press, the hover offset is gone and the fingertip (22%/12% of the
    // hand, matching transformOrigin) sits on the option's hint point.
    paintFrame(PERIOD * 0.5)
    const t = visual.style.transform
    // The swatch spans x 400-600, so its centre column is 500; minus 60*0.22.
    expect(xOf(t)).toBe(Math.round(500 - 60 * 0.22))
    // Vertically it aims 65% down the box (elementHintPoint), i.e. 600 + 0.65*200.
    expect(yOf(t)).toBeGreaterThan(700)
    stage.destroy()
  })

  it('dips into the tap rather than sitting still', () => {
    const { visual, stage } = setup()
    paintFrame(PERIOD * 0.02)
    const up = Number(/scale\(([\d.]+)\)/.exec(visual.style.transform)![1])
    paintFrame(PERIOD * 0.5)
    const down = Number(/scale\(([\d.]+)\)/.exec(visual.style.transform)![1])
    expect(down).toBeLessThan(up)
    stage.destroy()
  })

  it('walks to the next group when the game re-marks', () => {
    const { visual, root, option, stage } = setup()
    paintFrame(PERIOD * 0.5)

    delete option.dataset.configHint
    const next = document.createElement('div')
    next.dataset.configHint = '1'
    next.getBoundingClientRect = () => rect(800, 200, 100, 100)
    root.appendChild(next)

    paintFrame(PERIOD * 1.5)
    expect(xOf(visual.style.transform)).toBe(Math.round(850 - 60 * 0.22))
    stage.destroy()
  })

  it('rides an option that moves under it as the row opens up', () => {
    const { visual, option, stage } = setup()
    paintFrame(PERIOD * 0.5)
    const before = xOf(visual.style.transform)

    // The same option, pushed aside by a selection in its row: the rect is read fresh
    // every frame, so the hand follows rather than tapping where it used to be.
    option.getBoundingClientRect = () => rect(460, 600, 200, 200)
    paintFrame(PERIOD * 1.5)
    expect(xOf(visual.style.transform)).toBe(before + 60)
    stage.destroy()
  })

  it('hides itself once every group has been chosen', () => {
    const { visual, option, stage } = setup()
    paintFrame(PERIOD * 0.4)
    expect(Number(visual.style.opacity)).toBeGreaterThan(0)

    delete option.dataset.configHint
    paintFrame(PERIOD * 0.5)
    expect(visual.style.opacity).toBe('0')
    stage.destroy()
  })
})
