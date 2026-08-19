// SceneElement.attachToId on a PLAIN text element (not just countdown): the label's
// position and font size come from the target's rendered rect, so a caption sitting
// on an image/badge can never drift out of it when the screen aspect changes.

import { describe, it, expect, beforeEach } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign, setVAlign } from './responsive'
import type { Project, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920
// Badge image at design rect (443,504)-(637,578); label centered on it at (511,544)
// — the same shape as a score counter sitting inside a pill.
const BADGE = { x: 540, y: 541, w: 194, h: 74 }
const LABEL = { x: 511, y: 544 }

function makeProject(attachToId?: string): Project {
  const elements: SceneElement[] = [
    { id: 'badge', type: 'image', name: 'Badge', x: BADGE.x, y: BADGE.y, w: BADGE.w, h: BADGE.h, anchor: 'center', zIndex: 5, mode: 'fit', assetId: 'a1' },
    {
      id: 'label', type: 'text', name: 'Score', x: LABEL.x, y: LABEL.y, anchor: 'center', zIndex: 6, mode: 'fit',
      attachToId,
      text: { value: '0', fontSizePx: 51, fontWeight: 400, color: '#fff', align: 'center' },
    },
  ]
  return {
    meta: { schemaVersion: 1, name: 'attach-text', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H },
    startSceneId: 'game1',
    scenes: [{ id: 'game1', name: 'Game', kind: 'game', elements, advance: { on: 'manual' } }],
  }
}

const ASSETS = { a1: { src: 'data:image/png;base64,', w: BADGE.w, h: BADGE.h } }
const fakeRect = (x: number, y: number, w: number, h: number): DOMRect =>
  ({ x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect

function mountAt(attachToId?: string): { mount: HTMLElement; relayout: () => void } {
  document.body.innerHTML = ''
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  setDesign(DESIGN_W, DESIGN_H)
  setVAlign('top')
  computeMetrics(DESIGN_W, DESIGN_H)
  const mgr = playProject(makeProject(attachToId), ASSETS, { mount, interactive: true })
  return { mount, relayout: () => mgr.relayout() }
}

const q = (mount: HTMLElement, id: string): HTMLElement => mount.querySelector<HTMLElement>(`.pa-el[data-id="${id}"]`)!

describe('attachToId on a plain text element', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('derives position and font size from the target rect', () => {
    const { mount, relayout } = mountAt('badge')
    // Pretend the badge renders at 2x its design size at screen (10,20) — a layout the
    // plain FIT math would never produce, so a drifting label is unmistakable.
    q(mount, 'badge').getBoundingClientRect = () => fakeRect(10, 20, BADGE.w * 2, BADGE.h * 2)
    relayout()
    const label = q(mount, 'label')
    // Badge design top-left = (443,504); label offset = (68,40), scaled by k = 2.
    expect(parseFloat(label.style.left)).toBe(10 + 68 * 2)
    expect(parseFloat(label.style.top)).toBe(20 + 40 * 2)
    expect(parseFloat(label.querySelector<HTMLElement>('.pa-text-inner')!.style.fontSize)).toBe(51 * 2)
  })

  it('holds the same offset inside the badge at every viewport size', () => {
    const { mount, relayout } = mountAt('badge')
    const badge = q(mount, 'badge')
    const label = q(mount, 'label')
    // Feed the badge a rect consistent with each viewport's FIT scale, as the browser would.
    for (const [w, h] of [[1080, 1920], [390, 844], [414, 736], [820, 1180], [1083, 714]]) {
      computeMetrics(w, h)
      const s = Math.min(w / DESIGN_W, h / DESIGN_H)
      const offX = (w - DESIGN_W * s) / 2
      badge.getBoundingClientRect = () => fakeRect(offX + (BADGE.x - BADGE.w / 2) * s, (BADGE.y - BADGE.h / 2) * s, BADGE.w * s, BADGE.h * s)
      relayout()
      // Label centre must land on the badge's own 68/40 design offset, within the
      // single physical pixel the layout rounds positions to.
      const dx = parseFloat(label.style.left) - (offX + (BADGE.x - BADGE.w / 2) * s) - 68 * s
      const dy = parseFloat(label.style.top) - (BADGE.y - BADGE.h / 2) * s - 40 * s
      expect(Math.abs(dx)).toBeLessThanOrEqual(1)
      expect(Math.abs(dy)).toBeLessThanOrEqual(1)
    }
  })

  it('falls back to plain FIT layout when the target is missing', () => {
    const { mount: a, relayout: ra } = mountAt('nope')
    ra()
    const { mount: b, relayout: rb } = mountAt(undefined)
    rb()
    expect(q(a, 'label').style.left).toBe(q(b, 'label').style.left)
    expect(q(a, 'label').style.top).toBe(q(b, 'label').style.top)
  })
})
