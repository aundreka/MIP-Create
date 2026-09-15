// TextConfig.gradient: a design-tool gradient (angle + stops with position, hex and
// opacity) must render as the identical CSS linear-gradient, clipped to the glyphs.

import { describe, it, expect, beforeEach } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign, setVAlign } from './responsive'
import { gradientCss, shadowAsDropShadow } from './elements/textGradient'
import type { Project, TextGradient } from './scene'

const GOLD: TextGradient = {
  type: 'linear',
  angleDeg: 90,
  stops: [
    { pos: 25, color: '#C6AA4A', opacity: 100 },
    { pos: 59, color: '#FFFFFF', opacity: 100 },
    { pos: 93, color: '#D3B156', opacity: 100 },
  ],
}

describe('gradientCss', () => {
  it('reproduces the stops exactly', () => {
    expect(gradientCss(GOLD)).toBe('linear-gradient(90deg, rgb(198, 170, 74) 25%, rgb(255, 255, 255) 59%, rgb(211, 177, 86) 93%)')
  })

  it('sorts stops, folds opacity into the colour and honours the angle', () => {
    const g: TextGradient = { type: 'linear', angleDeg: 180, stops: [{ pos: 100, color: '#000', opacity: 50 }, { pos: 0, color: 'ff0000' }] }
    expect(gradientCss(g)).toBe('linear-gradient(180deg, rgb(255, 0, 0) 0%, rgba(0, 0, 0, 0.5) 100%)')
  })

  it('draws nothing without stops', () => {
    expect(gradientCss(undefined)).toBeNull()
    expect(gradientCss({ type: 'linear', stops: [] })).toBeNull()
  })
})

describe('shadowAsDropShadow', () => {
  it('maps each text-shadow, keeping commas inside rgba()', () => {
    expect(shadowAsDropShadow('0 2px 4px rgba(0,0,0,.5), 1px 1px 0 #000')).toBe('drop-shadow(0 2px 4px rgba(0,0,0,.5)) drop-shadow(1px 1px 0 #000)')
    expect(shadowAsDropShadow('none')).toBe('')
  })
})

describe('dynamic date with a gradient fill', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  function mount(gradient?: TextGradient): HTMLElement {
    const mountEl = document.createElement('div')
    document.body.appendChild(mountEl)
    setDesign(1080, 1920)
    setVAlign('top')
    computeMetrics(1080, 1920)
    const project: Project = {
      meta: { schemaVersion: 1, name: 'grad', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      startSceneId: 's1',
      scenes: [
        {
          id: 's1',
          name: 'S',
          kind: 'game',
          advance: { on: 'manual' },
          elements: [
            {
              id: 'date', type: 'countdown', name: 'Dynamic date', x: 540, y: 400, anchor: 'center', zIndex: 1, mode: 'fit',
              text: { value: '', fontSizePx: 64, color: '#fff', shadow: '0 2px 4px #000', gradient },
              countdown: { mode: 'dynamic', dynamicDays: 3, format: 'Order by {date}' },
            },
          ],
        },
      ],
    }
    playProject(project, {}, { mount: mountEl, interactive: true })
    return mountEl.querySelector<HTMLElement>('.pa-el[data-id="date"] .pa-text-inner')!
  }

  it('clips the gradient to the text and moves the shadow behind it', () => {
    const inner = mount(GOLD)
    expect(inner.style.backgroundImage).toContain('linear-gradient')
    expect(inner.style.getPropertyValue('-webkit-text-fill-color')).toBe('transparent')
    expect(inner.style.textShadow).toBe('')
    expect(inner.style.filter).toBe('drop-shadow(0 2px 4px #000)')
  })

  it('leaves a solid-colour date untouched', () => {
    const inner = mount()
    expect(inner.style.backgroundImage).toBe('')
    expect(inner.style.textShadow).not.toBe('')
  })
})
