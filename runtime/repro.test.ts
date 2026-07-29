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

function makeProject(ctaExtra: Record<string, unknown> = {}): Project {
  const cta = {
    id: 'cta1', type: 'cta' as const, name: 'CTA',
    x: 540, y: 1700, w: 400, h: 120, anchor: 'center' as const,
    zIndex: 5, mode: 'fit' as const, text: { value: 'PLAY', fontSizePx: 40 },
    ...ctaExtra,
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

// "Hide on overlay" has to reach the CTA. The CTA is ALWAYS overlay-immune, which
// means it is parked out of the game scene's root and into the stage container at
// mount — so a hide pass that only walks the scene root misses precisely the
// elements that would otherwise sit on top of the overlay.
describe('hide on overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })

  const openOverlay = (project: Project): { mount: HTMLElement; cta: () => HTMLElement } => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    playProject(project, {}, { mount, interactive: true })
    mount.querySelector('.pa-stage')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.runOnlyPendingTimers()
    return { mount, cta: () => mount.querySelector<HTMLElement>('.pa-el[data-id="cta1"]')! }
  }

  it('hides the parked CTA while the overlay is up', () => {
    const { cta } = openOverlay(makeProject({ hideOnOverlay: true }))
    // Parked (so the old scene-root-only query could never have found it)...
    expect(cta().parentElement?.className).toContain('pa-stage')
    // ...and hidden all the same.
    expect(cta().style.display).toBe('none')
  })

  it('leaves the CTA alone when the flag is off', () => {
    const { cta } = openOverlay(makeProject())
    expect(cta().style.display).not.toBe('none')
  })

  it('hides an ordinary (unparked) element too', () => {
    const project = makeProject()
    project.scenes[0].elements.push({
      id: 'note', type: 'text', name: 'Note', x: 540, y: 400,
      anchor: 'center', zIndex: 2, mode: 'fit', hideOnOverlay: true,
      text: { value: 'TAP THE BOOK', fontSizePx: 40 },
    })
    const { mount } = openOverlay(project)
    expect(mount.querySelector<HTMLElement>('.pa-el[data-id="note"]')!.style.display).toBe('none')
  })
})
