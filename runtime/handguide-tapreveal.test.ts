// The editable Tap to reveal handguide taps whichever cover the game still has up,
// and walks to the next one on its own as they are opened.
//
// It shares its frame branch with the tap-to-remove hand — same gesture, different
// marker — so this suite is what pins that the two really do stay independent.

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
  handguide: { mode: 'tapreveal', periodMs: PERIOD },
}

/** Build a scene with just the guide, then fake the game's published marker. */
function setup(): { visual: HTMLElement; root: HTMLElement; mess: HTMLElement; stage: ReturnType<typeof buildScene> } {
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'reveal hand', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    elements: [GUIDE],
    kind: 'game',
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene, { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
  stage.layoutAll()

  const root = host.querySelector('.pa-root') as HTMLElement
  const mess = document.createElement('div')
  mess.dataset.revealHint = '1'
  mess.getBoundingClientRect = () => rect(400, 600, 200, 200)
  root.appendChild(mess)

  const guideOuter = host.querySelector('.pa-el[data-id="hg"]') as HTMLElement
  guideOuter.getBoundingClientRect = () => rect(0, 0, 60, 74)
  stage.startGames(true)
  return { visual: guideOuter.querySelector('img') as HTMLElement, root, mess, stage }
}

const xOf = (t: string): number => Number(/translate\((-?\d+)px,(-?\d+)px\)/.exec(t)![1])
const yOf = (t: string): number => Number(/translate\((-?\d+)px,(-?\d+)px\)/.exec(t)![2])

describe('editable handguide: tap to remove mode', () => {
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

  it('lands the fingertip on the cover the game marked', () => {
    const { visual, stage } = setup()
    // Deep in the press, the hover offset is gone and the fingertip (22%/12% of the
    // hand, matching transformOrigin) sits on the target's hint point.
    paintFrame(PERIOD * 0.5)
    const t = visual.style.transform
    // The cover spans x 400-600, so its centre column is 500; minus 60*0.22.
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

  it('walks to the next cover when the game re-marks', () => {
    const { visual, root, mess, stage } = setup()
    paintFrame(PERIOD * 0.5)

    delete mess.dataset.revealHint
    const next = document.createElement('div')
    next.dataset.revealHint = '1'
    next.getBoundingClientRect = () => rect(800, 200, 100, 100)
    root.appendChild(next)

    paintFrame(PERIOD * 1.5)
    expect(xOf(visual.style.transform)).toBe(Math.round(850 - 60 * 0.22))
    stage.destroy()
  })

  it('hides itself once every cover is open', () => {
    const { visual, mess, stage } = setup()
    paintFrame(PERIOD * 0.4)
    expect(Number(visual.style.opacity)).toBeGreaterThan(0)

    delete mess.dataset.revealHint
    paintFrame(PERIOD * 0.5)
    expect(visual.style.opacity).toBe('0')
    stage.destroy()
  })
})
