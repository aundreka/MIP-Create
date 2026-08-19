// The editor canvas (pa:render) draws the pinned header itself, so what you compose is
// what plays — including the per-scene rule that hides it on end cards unless the scene
// opts back in with showHeader.

import { describe, it, expect, beforeEach } from 'vitest'
import './frame'
import { setDesign } from './responsive'
import type { Scene, SceneKind } from './scene'

function sceneMsg(kind: SceneKind, extra: Partial<Scene> = {}): Scene {
  return {
    meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, header: { heightPx: 120 } },
    elements: [{ id: 't', type: 'text', name: 't', x: 540, y: 800, anchor: 'center', zIndex: 2, mode: 'fit', text: { value: 'hi', fontSizePx: 40 } }],
    kind,
    ...extra,
  }
}
const render = (scene: Scene): void => {
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'pa:render', scene, assets: {}, interactive: false } }))
}
const band = (): HTMLElement | null => document.querySelector<HTMLElement>('.pa-header')

// jsdom's window is 1024×768 (landscape) by default; the canvas frames the editor renders
// are portrait unless the orientation chip is flipped, so pin the viewport per test.
const viewport = (w: number, h: number): void => {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })
}

describe('canvas header (pa:render)', () => {
  beforeEach(() => {
    setDesign(1080, 1920)
    viewport(540, 960)
  })

  it('draws the band on an ordinary scene', () => {
    render(sceneMsg('game'))
    expect(band()).toBeTruthy()
    expect(band()?.querySelector('.pa-header-text')?.textContent).toBeTruthy()
  })

  it('drops it on a scene flagged hideHeader', () => {
    render(sceneMsg('game', { hideHeader: true }))
    expect(band()).toBeNull()
  })

  it('drops it on an endscene, and brings it back when the endscene opts in', () => {
    render(sceneMsg('endscene'))
    expect(band()).toBeNull()

    render(sceneMsg('endscene', { showHeader: true }))
    expect(band()).toBeTruthy()
  })

  it('drops it on an overlay doubling as the end card unless it opts in', () => {
    render(sceneMsg('overlay', { asEndscene: true }))
    expect(band()).toBeNull()

    render(sceneMsg('overlay', { asEndscene: true, showHeader: true }))
    expect(band()).toBeTruthy()
  })

  it('places the band with the scene’s own layout when it has one', () => {
    render(sceneMsg('game'))
    const band0 = band()!.style.transform // project layout: no offset of its own
    render(sceneMsg('game', { headerOverride: { portrait: { offsetYPx: 500 } } }))
    expect(band()?.style.transform).toBe('translateX(-50%) translate(0px, 250px) scale(0.5)') // 500 × 0.5

    render(sceneMsg('game')) // a scene that follows the project layout again
    expect(band()?.style.transform).toBe(band0)
  })

  // The property the slots exist for: composing one orientation cannot shift the other.
  it('applies only the slot for the orientation the frame is in', () => {
    const scene = sceneMsg('game', { headerOverride: { landscape: { offsetYPx: 500 } } })
    render(scene)
    expect(band()?.style.transform).toBe('translateX(-50%) scale(0.5)') // portrait frame: untouched

    viewport(960, 540) // the same scene on a landscape frame
    window.dispatchEvent(new Event('resize'))
    expect(band()?.style.transform).toContain('translate(0px, 140.625px)') // 500 × 0.28125
  })

  it('reports the band rect to the editor alongside the element rects', async () => {
    render(sceneMsg('game'))
    const msg = await new Promise<{ header?: { id: string } }>((resolve) => {
      const onMsg = (e: MessageEvent): void => {
        if ((e.data as { type?: string })?.type === 'pa:layout') {
          window.removeEventListener('message', onMsg)
          resolve(e.data as { header?: { id: string } })
        }
      }
      window.addEventListener('message', onMsg)
      requestAnimationFrame(() => {})
    })
    expect(msg.header?.id).toBe('__header')
  })
})
