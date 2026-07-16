// countdown.attachToId: an attached date/countdown derives its position + font
// scale from the TARGET's rendered rect (not the global FIT math), so it keeps
// the same relative offset and proportional height at any viewport size / zoom.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign } from './responsive'
import type { Project, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920

// Image at design rect (340,250)-(740,350); countdown anchored 'left' at (760,300)
// — inline to the image's right, vertically centered on it.
function makeProject(attachToId?: string): Project {
  const elements: SceneElement[] = [
    { id: 'img', type: 'image', name: 'Img', x: 540, y: 300, w: 400, h: 100, anchor: 'center', zIndex: 5, mode: 'fit', assetId: 'a1' },
    {
      id: 'cd',
      type: 'countdown',
      name: 'Date',
      x: 760,
      y: 300,
      anchor: 'left',
      zIndex: 6,
      mode: 'fit',
      text: { value: '', fontSizePx: 60, fontWeight: 800, color: '#fff', align: 'left' },
      countdown: { mode: 'dynamic', dynamicDays: 1, format: 'Ends {MMMM} {D}', attachToId },
    },
  ]
  return {
    meta: { schemaVersion: 1, name: 'attach', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H },
    startSceneId: 'game1',
    scenes: [{ id: 'game1', name: 'Game', kind: 'game', elements, advance: { on: 'manual' } }],
  }
}

const fakeRect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

function mountAt(attachToId?: string): { mount: HTMLElement; relayout: () => void } {
  document.body.innerHTML = ''
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  setDesign(DESIGN_W, DESIGN_H)
  computeMetrics(390, 844)
  const mgr = playProject(makeProject(attachToId), { a1: { src: 'data:image/png;base64,', w: 400, h: 100 } }, { mount, interactive: true })
  return { mount, relayout: () => mgr.relayout() }
}

const q = (mount: HTMLElement, id: string): HTMLElement => mount.querySelector<HTMLElement>(`.pa-el[data-id="${id}"]`)!

describe('countdown attachToId', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('follows the target rect: offset and font scale by the target render scale', () => {
    const { mount, relayout } = mountAt('img')
    // Pretend the image renders at 2× its design size, at screen (10,20) — a layout
    // the plain FIT math would never produce (e.g. an extend/pinned target).
    q(mount, 'img').getBoundingClientRect = () => fakeRect(10, 20, 800, 200)
    relayout()
    const cd = q(mount, 'cd')
    // design offset from image top-left (340,250): (420,50), scaled by k=200/100=2
    expect(parseFloat(cd.style.left)).toBe(10 + 420 * 2)
    expect(parseFloat(cd.style.top)).toBe(20 + 50 * 2)
    const inner = cd.querySelector<HTMLElement>('.pa-text-inner')!
    expect(parseFloat(inner.style.fontSize)).toBe(60 * 2)
  })

  it('falls back to plain FIT layout when the target is missing', () => {
    const { mount: a, relayout: ra } = mountAt('nope')
    ra()
    const attachedLeft = parseFloat(q(a, 'cd').style.left)
    const attachedTop = parseFloat(q(a, 'cd').style.top)
    const { mount: b, relayout: rb } = mountAt(undefined)
    rb()
    expect(attachedLeft).toBe(parseFloat(q(b, 'cd').style.left))
    expect(attachedTop).toBe(parseFloat(q(b, 'cd').style.top))
  })
})
