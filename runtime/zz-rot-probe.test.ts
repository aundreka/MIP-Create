import { describe, it, expect, beforeEach } from 'vitest'
import { buildScene } from './stage'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'

const W = 1080, H = 1920
function el(over: Partial<SceneElement> = {}): SceneElement {
  return { id: 'g1', type: 'game-mount', name: 'R', x: 540, y: 900, w: 400, h: 200,
    anchor: 'center', zIndex: 5, mode: 'fit', game: { templateId: 'nameresult', params: { emptyText: 'BROWNIE' } }, ...over } as SceneElement
}
function scene(elements: SceneElement[]): Scene {
  return { meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: W, baseH: H }, elements, kind: 'game' }
}
describe('rotation reaches a game mount', () => {
  beforeEach(() => { document.body.innerHTML = ''; setDesign(W, H); computeMetrics(W, H) })
  it('writes rotate() onto the mount outer', () => {
    const mount = document.createElement('div'); document.body.appendChild(mount)
    const stage = buildScene(scene([el({ rotation: 20 })]), {}, { mount })
    stage.layoutAll()
    const outer = mount.querySelector('.pa-el') as HTMLElement
    console.log('OUTER TRANSFORM:', JSON.stringify(outer?.style.transform))
    console.log('OUTER CLASS:', outer?.className, 'ATTR:', outer?.getAttribute('data-type'))
    const all = [...mount.querySelectorAll('*')].filter((n) => (n as HTMLElement).style?.transform).map((n) => (n as HTMLElement).className + ' => ' + (n as HTMLElement).style.transform)
    console.log('ALL TRANSFORMS:', all)
    expect(outer.style.transform).toContain('rotate(20deg)')
  })
})
