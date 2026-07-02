import { describe, it, expect, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign } from './responsive'
import type { Project } from './scene'

function baseMeta() {
  return {
    schemaVersion: 1,
    name: 'repro',
    clickUrl: { ios: '', android: '' },
    baseW: 1080,
    baseH: 1920,
    bgMatchColor: '#111111',
  }
}

function makeProject(): Project {
  const cta = {
    id: 'cta1', type: 'cta' as const, name: 'CTA',
    x: 540, y: 1700, w: 400, h: 120, anchor: 'center' as const,
    zIndex: 5, mode: 'fit' as const, text: { value: 'PLAY', fontSizePx: 40 },
  }
  return {
    meta: baseMeta(),
    startSceneId: 'game1',
    scenes: [
      {
        id: 'game1', name: 'Game', kind: 'game',
        elements: [cta],
        advance: { on: 'tap', to: 'overlay1', delayMs: 0 },
      },
      {
        id: 'overlay1', name: 'Overlay', kind: 'overlay',
        overlay: { opacity: 0.6, color: '#000000' },
        elements: [
          { id: 'badge', type: 'text' as const, name: 'Badge', x: 540, y: 800,
            anchor: 'center' as const, zIndex: 2, mode: 'fit' as const,
            text: { value: 'YOU WON', fontSizePx: 60 } },
          // The overlay's OWN CTA (win popup "Play Now").
          { id: 'octa', type: 'cta' as const, name: 'OverlayCTA', x: 540, y: 1200,
            w: 400, h: 120, anchor: 'center' as const, zIndex: 6, mode: 'fit' as const,
            text: { value: 'PLAY NOW', fontSizePx: 40 } },
        ],
        advance: { on: 'manual' },
      },
    ],
  }
}

describe('CTA over overlay on resize', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })

  it('CTA stays above overlay dim after resize', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const mgr = playProject(makeProject(), {}, { mount, interactive: true })

    const stage = mount.querySelector('.pa-stage')!
    const cta = () => mount.querySelector<HTMLElement>('.pa-el[data-id="cta1"]')!

    // Trigger the overlay by tapping the game container.
    stage.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.runOnlyPendingTimers()

    // Overlay dim div is z:9000. The immune CTA should be reparented to pa-stage at z:10000.
    const before = cta()
    console.log('AFTER OVERLAY: parent=', before.parentElement?.className, 'z=', before.style.zIndex, 'display=', before.style.display)

    // Simulate a resize.
    computeMetrics(2000, 1200)
    mgr.relayout()

    const after = cta()
    console.log('AFTER RESIZE: parent=', after.parentElement?.className, 'z=', after.style.zIndex, 'display=', after.style.display)

    expect(after.style.display).not.toBe('none')
    expect(after.style.zIndex).toBe('10000')
  })

  it('overlay-own CTA survives resize', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const mgr = playProject(makeProject(), {}, { mount, interactive: true })
    const stage = mount.querySelector('.pa-stage')!

    stage.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.runOnlyPendingTimers()

    const octa = () => mount.querySelector<HTMLElement>('.pa-el[data-id="octa"]')
    const b = octa()!
    console.log('OVERLAY CTA BEFORE: exists=', !!b, 'parent=', b.parentElement?.className, 'z=', b.style.zIndex, 'display=', b.style.display)

    computeMetrics(2000, 1200)
    mgr.relayout()

    const a = octa()
    console.log('OVERLAY CTA AFTER: exists=', !!a, 'parent=', a?.parentElement?.className, 'z=', a?.style.zIndex, 'display=', a?.style.display)
    expect(a).toBeTruthy()
    expect(a!.style.display).not.toBe('none')
  })
})
