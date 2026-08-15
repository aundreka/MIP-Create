// The Thought Whacker uses the shared coded hand from hint.ts. Its live target
// resolver is sampled on every frame so the same animation follows whichever
// unwhacked thought is currently valid.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHand } from './hint'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'

const PERIOD = 900
let now = 0

function target(left: number, top: number, width: number, height: number): HTMLElement {
  const el = document.createElement('button')
  el.getBoundingClientRect = () => ({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  })
  return el
}

function paintFrame(ms: number): void {
  now = ms
  vi.advanceTimersByTime(20)
}

describe('coded handguide: live Thought Whacker target', () => {
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

  it('retargets its tap animation when the current unwhacked thought changes', () => {
    const first = target(20, 40, 80, 80)
    const second = target(140, 70, 60, 60)
    let active: HTMLElement | null = first
    const hand = createHand(document.body)
    hand.showTarget(() => active, 'tap', 0.9, 0.65)

    paintFrame(PERIOD * 0.275) // deepest point of the tap: fingertip lands exactly on target
    const visual = document.body.lastElementChild as HTMLElement
    expect(visual.style.transform).toContain('translate(60px,92px)')

    active = second
    paintFrame(PERIOD * 1.275)
    expect(visual.style.transform).toContain('translate(170px,109px)')
  })

  it('stays hidden when no unwhacked target exists and resumes when one appears', () => {
    let active: HTMLElement | null = null
    const hand = createHand(document.body)
    hand.showTarget(() => active, 'tap')
    const visual = document.body.lastElementChild as HTMLElement

    paintFrame(100)
    expect(visual.style.opacity).toBe('0')

    active = target(10, 20, 40, 60)
    paintFrame(120)
    expect(visual.style.opacity).toBe('1')
  })

  it('provides the selectable handguide animation and follows its active thought', () => {
    const guide: SceneElement = {
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
      handguide: { mode: 'thoughtwhack', periodMs: PERIOD },
    }
    const scene: Scene = {
      meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      elements: [guide],
      kind: 'game',
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const stage = buildScene(scene, { hand: { src: 'hand.png', w: 46, h: 56 } }, { mount: host })
    stage.layoutAll()

    const runtimeRoot = host.querySelector('.pa-root') as HTMLElement
    const firstShell = document.createElement('div')
    firstShell.dataset.twState = 'active'
    const first = target(20, 40, 80, 80)
    first.dataset.twThought = '0'
    firstShell.appendChild(first)
    runtimeRoot.appendChild(firstShell)

    const guideOuter = host.querySelector('.pa-el[data-id="hg"]') as HTMLElement
    guideOuter.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 60,
      bottom: 74,
      width: 60,
      height: 74,
      toJSON: () => ({}),
    })
    stage.startGames(true)
    paintFrame(PERIOD * 0.275)

    const visual = guideOuter.querySelector('img') as HTMLElement
    expect(visual.style.transform).toContain('translate(47px,83px)')

    firstShell.dataset.twState = 'whacked'
    const secondShell = document.createElement('div')
    secondShell.dataset.twState = 'active'
    const second = target(140, 70, 60, 60)
    second.dataset.twThought = '1'
    secondShell.appendChild(second)
    runtimeRoot.appendChild(secondShell)
    paintFrame(PERIOD * 1.275)
    expect(visual.style.transform).toContain('translate(157px,100px)')
  })
})
