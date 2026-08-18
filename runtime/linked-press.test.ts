// Linked presses (button.linkedButtonIds): an element names other buttons on the
// scene, and a tap on any of them presses IT too — same tap effect and on-tap
// animation as a direct tap.
//
// The rule the relay exists to enforce: a linked press carries FEEDBACK only. Only
// one redirect can win per tap and it is always the button the player actually hit,
// so the linked element's own "go to screen" never fires from a relayed press.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import { on } from './emitter'
import type { AnimSpec, Scene, SceneElement } from './scene'
import type { AssetMap } from './types'

const ASSETS: AssetMap = { a1: { src: 'data:image/png;base64,', w: 200, h: 200 }, a2: { src: 'data:image/png;base64,x', w: 200, h: 200 } }

const tapSpec: AnimSpec = { preset: 'pop', durationMs: 320, delayMs: 0, easing: 'ease-out' }

const base = { x: 540, y: 960, w: 400, h: 400, anchor: 'center', zIndex: 1 } as const

const image = (el: Partial<SceneElement>): SceneElement => ({ type: 'image', name: 'Art', assetId: 'a1', ...base, ...el }) as SceneElement
const button = (el: Partial<SceneElement>): SceneElement => ({ type: 'button', name: 'Play', ...base, ...el }) as SceneElement

const scene = (els: SceneElement[]): Scene => ({
  meta: { schemaVersion: 1, name: 's', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  elements: els,
})

function mount(els: SceneElement[], interactive = true) {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  setDesign(1080, 1920)
  computeMetrics(540, 960)
  const stage = buildScene(scene(els), ASSETS, { mount: host })
  stage.layoutAll()
  stage.startGames(interactive)
  return stage
}

const down = (n: HTMLElement): void => void n.dispatchEvent(new Event('pointerdown', { bubbles: true }))
const up = (n: HTMLElement): void => void n.dispatchEvent(new Event('pointerup', { bubbles: true }))
const click = (n: HTMLElement): void => void n.dispatchEvent(new Event('click', { bubbles: true }))

// The tapped node: a button element listens on its inner <button>, an image-as-button
// on the .pa-el-anim wrapper — both sit inside the wrapper the relay watches.
const tapNode = (stage: ReturnType<typeof mount>, id: string): HTMLElement => {
  const rec = stage.get(id)!
  return rec.el.type === 'button' ? (rec.content as HTMLElement) : rec.anim
}

describe('linked button presses', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('plays the linked element’s tap effect when a connected button is tapped', async () => {
    const stage = mount([button({ id: 'b1' }), image({ id: 'img1', button: { tapEffect: 'glow', stay: true, linkedButtonIds: ['b1'] } })])
    const img = stage.get('img1')!.content as HTMLElement
    expect(img.className).not.toContain('pa-tap-glow')
    down(tapNode(stage, 'b1'))
    expect(img.className).toContain('pa-tap-glow')
    await new Promise((r) => requestAnimationFrame(r))
    expect(img.className).toContain('pa-tap-on')
  })

  it('releases the linked element when the button is released', () => {
    const stage = mount([button({ id: 'b1' }), image({ id: 'img1', button: { tapEffect: 'press', stay: true, linkedButtonIds: ['b1'] } })])
    const img = stage.get('img1')!.content as HTMLElement
    const node = tapNode(stage, 'b1')
    down(node)
    expect(img.className).toContain('pa-tap-press')
    up(node)
    expect(img.className).not.toContain('pa-tap-press')
    expect(img.className).not.toContain('pa-tap-on')
  })

  it('replays the linked element’s on-tap animation', () => {
    const stage = mount([button({ id: 'b1' }), image({ id: 'img1', animations: { tap: tapSpec }, button: { stay: true, linkedButtonIds: ['b1'] } })])
    const rec = stage.get('img1')!
    expect(rec.anim.style.animation).toBe('')
    down(tapNode(stage, 'b1'))
    expect(rec.anim.style.animation).toContain('320ms')
  })

  // The point of the whole feature: two elements, one tap, one redirect. The tapped
  // button's target must be the one that fires even though the linked image has its own.
  it('never redirects from a linked press — the tapped button’s target wins', () => {
    const stage = mount([button({ id: 'b1', button: { targetSceneId: 'sB' } }), image({ id: 'img1', button: { targetSceneId: 'sIMG', tapEffect: 'glow', linkedButtonIds: ['b1'] } })])
    const goto = vi.fn()
    const off = on('scene-goto', goto)
    const node = tapNode(stage, 'b1')
    down(node)
    click(node)
    off()
    expect(goto).toHaveBeenCalledTimes(1)
    expect(goto).toHaveBeenCalledWith('sB')
  })

  // A button element stops the gesture propagating (so the scene tap-advance can't
  // outrun its click), which is why the relay listens in the capture phase.
  it('sees the tap even though the button swallows the gesture', () => {
    const stage = mount([button({ id: 'b1', button: { targetSceneId: 'sB' } }), image({ id: 'img1', button: { tapEffect: 'glow', stay: true, linkedButtonIds: ['b1'] } })])
    const img = stage.get('img1')!.content as HTMLElement
    down(stage.get('b1')!.content as HTMLElement)
    expect(img.className).toContain('pa-tap-glow')
  })

  it('relays to every element linked to that button, and to none that aren’t', () => {
    const stage = mount([
      button({ id: 'b1' }),
      button({ id: 'b2' }),
      image({ id: 'img1', button: { tapEffect: 'glow', stay: true, linkedButtonIds: ['b1', 'b2'] } }),
      image({ id: 'img2', button: { tapEffect: 'glow', stay: true, linkedButtonIds: ['b2'] } }),
    ])
    const one = stage.get('img1')!.content as HTMLElement
    const two = stage.get('img2')!.content as HTMLElement
    down(tapNode(stage, 'b1'))
    expect(one.className).toContain('pa-tap-glow')
    expect(two.className).not.toContain('pa-tap-glow')
  })

  // On the editor canvas a click means "select this element", so nothing may fire.
  it('is armed for playback only, never on the editor canvas', () => {
    const stage = mount([button({ id: 'b1' }), image({ id: 'img1', button: { tapEffect: 'glow', stay: true, linkedButtonIds: ['b1'] } })], false)
    down(tapNode(stage, 'b1'))
    expect((stage.get('img1')!.content as HTMLElement).className).not.toContain('pa-tap-glow')
  })

  // The link list is read at press time, so re-authoring it in the inspector takes
  // effect without a rebuild (the update path swaps rec.el in place).
  it('reads the link list live, after the element is swapped in place', () => {
    const stage = mount([button({ id: 'b1' }), image({ id: 'img1', button: { tapEffect: 'glow', stay: true } })])
    const img = stage.get('img1')!.content as HTMLElement
    down(tapNode(stage, 'b1'))
    expect(img.className).not.toContain('pa-tap-glow')
    stage.get('img1')!.el = { ...stage.get('img1')!.el, button: { tapEffect: 'glow', stay: true, linkedButtonIds: ['b1'] } }
    down(tapNode(stage, 'b1'))
    expect(img.className).toContain('pa-tap-glow')
  })
})
