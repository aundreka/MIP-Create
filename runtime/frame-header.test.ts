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

describe('canvas header (pa:render)', () => {
  beforeEach(() => setDesign(1080, 1920))

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
    const band0 = band()!.style.transform
    render(sceneMsg('game', { headerOverride: { offsetYPx: 500 } }))
    expect(band()?.style.transform).not.toBe(band0)
    expect(band()?.style.transform).toContain('translate(')

    render(sceneMsg('game')) // a scene that follows the project layout again
    expect(band()?.style.transform).toBe(band0)
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
