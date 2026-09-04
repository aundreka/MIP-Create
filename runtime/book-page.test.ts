// Per-page element visibility: an element bound to `showOnPage` appears only while
// that page of the scene's flipbook is open. The book reports its page, the stage
// decides who is visible — the same split the scratch-progress fades use.
//
// Also covers the handguide's 'slide' mode being movement-only: the press dip used to
// scale the hand down at the start of every loop, which read as a zoom.

import { describe, it, expect, beforeEach } from 'vitest'
import { buildScene } from './stage'
import { emit } from './emitter'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'

const ART = {
  cover: { src: 'c.png', w: 700, h: 1000 },
  l1: { src: 'l1.png', w: 580, h: 1000 },
  r1: { src: 'r1.png', w: 620, h: 1000 },
}

function scene(elements: SceneElement[]): Scene {
  return {
    meta: { schemaVersion: 1, name: 't', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    elements,
    kind: 'game',
  }
}

const book: SceneElement = {
  id: 'book', type: 'game-mount', name: 'Book', x: 540, y: 900, w: 900, h: 900,
  anchor: 'center', zIndex: 5, mode: 'fit',
  game: { templateId: 'flipbook', params: { spreads: 2, cover: 'cover', leftPages: ['l1'], rightPages: ['r1'] } },
} as unknown as SceneElement

const label = (id: string, showOnPage?: number): SceneElement =>
  ({
    id, type: 'text', name: id, x: 540, y: 300, anchor: 'center', zIndex: 6, mode: 'fit',
    showOnPage,
    text: { value: id, fontSizePx: 40 },
  }) as unknown as SceneElement

function mount(els: SceneElement[], interactive = true): HTMLElement {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene(els), ART, { mount: host })
  stage.layoutAll()
  stage.startGames(interactive)
  return host
}

// Off-page elements hide by CLASS (.pa-el--page-off), not by an inline opacity a later
// layout pass would drop — see the class's note in stage.ts.
const el = (host: HTMLElement, id: string): HTMLElement => host.querySelector(`.pa-el[data-id="${id}"]`) as HTMLElement
const off = (host: HTMLElement, id: string): boolean => el(host, id).classList.contains('pa-el--page-off')

describe('elements bound to a book page', () => {
  beforeEach(() => {
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })

  it('shows only the page-1 element when the book opens on page 1', () => {
    const host = mount([book, label('onCover', 1), label('onTwo', 2), label('always')])
    expect(off(host, 'onCover')).toBe(false)
    expect(off(host, 'onTwo')).toBe(true)
    expect(off(host, 'always')).toBe(false) // untouched — no binding, no interference
    expect(el(host, 'always').style.opacity).toBe('')
  })

  it('swaps them as the book turns to page 2 and back is impossible', () => {
    const host = mount([book, label('onCover', 1), label('onTwo', 2)])
    emit('book-page', 2)
    expect(off(host, 'onCover')).toBe(true)
    expect(off(host, 'onTwo')).toBe(false)
    emit('book-page', 3)
    expect(off(host, 'onTwo')).toBe(true)
  })

  it('keeps the page state through a layout pass that rewrites inline opacity', () => {
    document.body.innerHTML = ''
    const host = document.createElement('div')
    document.body.appendChild(host)
    const stage = buildScene(scene([book, label('onCover', 1), label('onTwo', 2)]), ART, { mount: host })
    stage.layoutAll()
    stage.startGames(true)
    emit('book-page', 2)
    stage.layoutAll() // a resize/rotation: layoutRec rewrites outer.style.opacity from the element
    expect(off(host, 'onCover')).toBe(true)
    expect(off(host, 'onTwo')).toBe(false)
  })

  it('leaves every page visible on the editor canvas, so they stay placeable', () => {
    const host = mount([book, label('onCover', 1), label('onTwo', 2)], false)
    expect(off(host, 'onCover')).toBe(false)
    expect(off(host, 'onTwo')).toBe(false)
  })
})

describe('handguide slide is movement only', () => {
  beforeEach(() => {
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })

  const handguide = (mode: string): SceneElement =>
    ({
      id: 'hg', type: 'handguide', name: 'Hand', x: 800, y: 900, w: 60, h: 74,
      anchor: 'center', zIndex: 9, mode: 'fit', assetId: 'cover',
      handguide: { mode, nodes: [{ x: 300, y: 900 }], periodMs: 300 },
    }) as unknown as SceneElement

  /** Let the real loop run and collect every scale it writes over ~a full period. */
  async function scalesOver(mode: string): Promise<number[]> {
    const host = mount([handguide(mode)])
    const img = host.querySelector('.pa-el[data-id="hg"] img') as HTMLElement
    const seen: number[] = []
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 20))
      const m = /scale\(([\d.]+)\)/.exec(img.style.transform)
      if (m) seen.push(parseFloat(m[1]))
    }
    expect(img.style.transform).toMatch(/translate\(/) // it did move
    return seen
  }

  it('holds the hand at exactly full size the whole way along the path', async () => {
    const seen = await scalesOver('slide')
    expect(seen.length).toBeGreaterThan(0)
    expect([...new Set(seen)]).toEqual([1]) // one value, and it is 1
  })

  it('still pulses on a tap, so the change is specific to sliding', async () => {
    const seen = await scalesOver('tap')
    expect(new Set(seen).size).toBeGreaterThan(1) // the dip is still animating
  })
})
