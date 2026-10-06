// Button arm delay (button.armAfterMs): a button — or an image converted into one —
// is DEAD for a while after it reaches the player, so a tap can't fire before the
// entrance animations have played and an impatient player can't spam it.
//
// While locked the gesture is swallowed whole: no scene change, no tap effect, no
// tap sound. Once the window passes the button behaves exactly as it always has.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import { on } from './emitter'
import type { Scene, SceneElement } from './scene'
import type { AssetMap } from './types'

const ASSETS: AssetMap = { a1: { src: 'data:image/png;base64,', w: 200, h: 200 } }

const base = { x: 540, y: 960, w: 400, h: 400, anchor: 'center', zIndex: 1 } as const

const image = (el: Partial<SceneElement>): SceneElement => ({ type: 'image', name: 'Art', assetId: 'a1', ...base, ...el }) as SceneElement
const button = (el: Partial<SceneElement>): SceneElement => ({ type: 'button', name: 'Play', ...base, ...el }) as SceneElement

const scene = (els: SceneElement[]): Scene => ({
  meta: { schemaVersion: 1, name: 's', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: els,
})

function mount(els: SceneElement[]) {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  setDesign(1080, 1920)
  computeMetrics(540, 960)
  const stage = buildScene(scene(els), ASSETS, { mount: host })
  stage.layoutAll()
  stage.startGames(true)
  stage.playEntrances() // the moment the scene reaches the player — the arm clock's origin
  return stage
}

const down = (n: HTMLElement): void => void n.dispatchEvent(new Event('pointerdown', { bubbles: true }))
const click = (n: HTMLElement): void => void n.dispatchEvent(new Event('click', { bubbles: true }))

// A button element listens on its inner <button>; an image-as-button on the wrapper.
const tapNode = (stage: ReturnType<typeof mount>, id: string): HTMLElement => {
  const rec = stage.get(id)!
  return rec.el.type === 'button' ? (rec.content as HTMLElement) : rec.anim
}

let gotos: string[] = []
let sfx: string[] = []
let offGoto: () => void
let offSfx: () => void

beforeEach(() => {
  document.body.innerHTML = ''
  gotos = []
  sfx = []
  vi.useFakeTimers()
  offGoto = on('scene-goto', (id: string) => void gotos.push(id))
  offSfx = on('sfx', (name: string) => void sfx.push(name))
})

afterEach(() => {
  vi.useRealTimers()
  offGoto()
  offSfx()
})

describe('button armAfterMs', () => {
  it('ignores a tap inside the dead window and navigates after it', () => {
    const stage = mount([button({ id: 'b1', button: { targetSceneId: 's2', armAfterMs: 1000 } })])
    const node = tapNode(stage, 'b1')
    click(node)
    expect(gotos).toEqual([]) // too early — nothing happened
    vi.advanceTimersByTime(600)
    click(node)
    expect(gotos).toEqual([]) // still inside the window
    vi.advanceTimersByTime(500) // past 1000ms
    click(node)
    expect(gotos).toEqual(['s2'])
  })

  it('stays silent while locked — no tap sound to hint it was pressed', () => {
    const stage = mount([button({ id: 'b1', button: { targetSceneId: 's2', armAfterMs: 1000 } })])
    click(tapNode(stage, 'b1'))
    expect(sfx).toEqual([])
    vi.advanceTimersByTime(1100)
    click(tapNode(stage, 'b1'))
    expect(sfx).toEqual(['tap'])
  })

  it('plays no tap effect while locked', () => {
    const stage = mount([button({ id: 'b1', button: { tapEffect: 'glow', stay: true, armAfterMs: 1000 } })])
    const node = tapNode(stage, 'b1')
    down(node)
    expect(node.className).not.toContain('pa-tap-glow')
    vi.advanceTimersByTime(1100)
    down(node)
    expect(node.className).toContain('pa-tap-glow')
  })

  it('locks an image converted into a button the same way', () => {
    const stage = mount([image({ id: 'img1', button: { targetSceneId: 's2', armAfterMs: 800 } })])
    const node = tapNode(stage, 'img1')
    click(node)
    expect(gotos).toEqual([])
    vi.advanceTimersByTime(900)
    click(node)
    expect(gotos).toEqual(['s2'])
  })

  it('leaves a button with no arm delay tappable at once', () => {
    const stage = mount([button({ id: 'b1', button: { targetSceneId: 's2' } })])
    click(tapNode(stage, 'b1'))
    expect(gotos).toEqual(['s2'])
  })

  it('counts from the timeline cue that brings the button in, not from the scene', () => {
    // A button that only appears 2s into the scene timeline: its arm window has to
    // start THERE, or a button revealed late would already be live on arrival.
    const stage = mount([button({ id: 'b1', timing: { inMs: 2000 }, button: { targetSceneId: 's2', armAfterMs: 1000 } } as Partial<SceneElement>)])
    stage.seekTimeline(0, true)
    const node = tapNode(stage, 'b1')
    vi.advanceTimersByTime(2100) // the cue has fired — the button is on screen
    click(node)
    expect(gotos).toEqual([]) // ...and still dead, because it only just arrived
    vi.advanceTimersByTime(1000)
    click(node)
    expect(gotos).toEqual(['s2'])
  })
})
