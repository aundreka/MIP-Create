// `{%}` text and continuous progress sources.
//
// A progress bar fed by a scratch card fills to a FRACTION rather than counting steps,
// and a text element holding `{%}` shows whatever the bar shows — including the
// half-full preview the editor canvas draws.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeMetrics, setDesign } from './responsive'
import type { Scene, SceneElement } from './scene'
import { buildScene } from './stage'
import { emitProgress } from './games/progresschannel'

const bar = (id: string, params: Record<string, unknown> = {}): SceneElement => ({
  id,
  type: 'game-mount',
  name: id,
  x: 540,
  y: 300,
  w: 800,
  h: 40,
  anchor: 'center',
  zIndex: 2,
  mode: 'fit',
  game: { templateId: 'progressbar', params: { fillMs: 0, ...params } },
})
const text = (id: string, value: string, extra: Partial<SceneElement> = {}): SceneElement => ({
  id,
  type: 'text',
  name: id,
  x: 540,
  y: 200,
  anchor: 'center',
  zIndex: 3,
  mode: 'fit',
  text: { value, fontSizePx: 40 },
  ...extra,
})

function stageWith(elements: SceneElement[], interactive: boolean): { host: HTMLElement; root: HTMLElement } {
  const scene: Scene = {
    meta: { schemaVersion: 1, name: 'pct', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    kind: 'game',
    elements,
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stage = buildScene(scene, {}, { mount: host })
  stage.layoutAll()
  stage.startGames(interactive)
  return { host, root: host.querySelector<HTMLElement>('.pa-root')! }
}
const shown = (host: HTMLElement, id: string): string => host.querySelector(`[data-id="${id}"] .pa-text-inner`)?.textContent ?? ''
const fillWidth = (host: HTMLElement, id: string): string => host.querySelector<HTMLElement>(`[data-id="${id}"] [data-progress-fill]`)?.style.width ?? ''

describe('progress text', () => {
  beforeEach(() => {
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('previews the half-full bar on the editor canvas', () => {
    const { host } = stageWith([bar('bar'), text('pct', 'COVERAGE: {%}')], false)
    expect(shown(host, 'pct')).toBe('COVERAGE: 50%')
  })

  it('starts at 0 in play and follows a continuous source', () => {
    const { host, root } = stageWith([bar('bar'), text('pct', 'COVERAGE: {%}'), text('n', '{progress} of 100')], true)
    expect(shown(host, 'pct')).toBe('COVERAGE: 0%')
    emitProgress(root, { gameId: 'card', value: 37.4, total: 100, continuous: true })
    expect(parseFloat(fillWidth(host, 'bar'))).toBeCloseTo(37.4)
    expect(shown(host, 'pct')).toBe('COVERAGE: 37%')
    expect(shown(host, 'n')).toBe('37 of 100')
  })

  it('a continuous source lights segments by fraction, not by its 100 total', () => {
    const { host, root } = stageWith([bar('bar', { fillStyle: 'segmented', steps: 4 })], true)
    emitProgress(root, { gameId: 'card', value: 60, total: 100, continuous: true })
    const segs = Array.from(host.querySelectorAll<HTMLElement>('[data-id="bar"] [data-progress-seg]'))
    expect(segs.length).toBe(4)
    expect(segs.filter((s) => s.style.opacity === '1').length).toBe(2)
  })

  it('follows the bar it is linked to when there are two', () => {
    const { host, root } = stageWith(
      [bar('a', { sourceGameId: 'one' }), bar('b', { sourceGameId: 'two' }), text('pa', '{%}'), text('pb', '{%}', { progressBarId: 'b' })],
      true,
    )
    emitProgress(root, { gameId: 'two', value: 80, total: 100, continuous: true })
    expect(shown(host, 'pa')).toBe('0%') // unlinked → the first bar, which 'two' does not feed
    expect(shown(host, 'pb')).toBe('80%')
  })

  it('a stepped source still counts steps', () => {
    const { host, root } = stageWith([bar('bar'), text('pct', '{%}')], true)
    emitProgress(root, { gameId: 'clean', value: 1, total: 4 })
    expect(shown(host, 'pct')).toBe('25%')
  })
})
