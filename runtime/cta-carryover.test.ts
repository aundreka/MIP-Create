// Carry-over elements (SceneElement.persist) and the CTA's tap exemption.
//
// A persisted CTA is built ONCE into a layer above every scene root instead of once
// per scene, so a transition never rebuilds it — the same DOM node (and therefore the
// same running pulse) is on screen before and after the cut. `persistScenes` limits
// where it shows. Separately, a tap on ANY CTA must click out only: it never counts as
// the scene's "advance on tap".

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign } from './responsive'
import type { Project, SceneElement } from './scene'
import { triggerCTA } from './networks'

vi.mock('./networks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./networks')>()),
  notifyGameEnd: vi.fn(),
  notifyGameClose: vi.fn(),
  triggerCTA: vi.fn(),
}))

const textEl = (id: string): SceneElement => ({
  id, type: 'text', name: id, x: 540, y: 800,
  anchor: 'center', zIndex: 2, mode: 'fit',
  text: { value: id, fontSizePx: 40 },
})

const ctaEl = (id: string, extra: Partial<SceneElement> = {}): SceneElement => ({
  id, type: 'cta', name: id, x: 540, y: 1600, w: 600, h: 160,
  anchor: 'center', zIndex: 5, mode: 'fit',
  text: { value: 'PLAY', fontSizePx: 40 },
  ...extra,
})

// s1 --tap--> s2 --tap--> s3. The CTA is authored on s1 only.
function makeProject(cta: SceneElement): Project {
  return {
    meta: {
      schemaVersion: 1, name: 'carryover', clickUrl: { ios: '', android: '' },
      baseW: 1080, baseH: 1920, bgMatchColor: '#111111',
    },
    startSceneId: 's1',
    scenes: [
      { id: 's1', name: 'One', kind: 'game', elements: [textEl('one'), cta], advance: { on: 'tap', delayMs: 0 }, transition: { type: 'none', durationMs: 0 } },
      { id: 's2', name: 'Two', kind: 'game', elements: [textEl('two')], advance: { on: 'tap', delayMs: 0 }, transition: { type: 'none', durationMs: 0 } },
      { id: 's3', name: 'Three', kind: 'game', elements: [textEl('three')], advance: { on: 'manual' }, transition: { type: 'none', durationMs: 0 } },
    ],
  }
}

describe('CTA carry-over across scenes', () => {
  let mount: HTMLElement
  let mgr: { destroy(): void } | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
    mount = document.createElement('div')
    document.body.appendChild(mount)
  })

  afterEach(() => {
    mgr?.destroy()
    mgr = null
  })

  const play = (cta: SceneElement): void => {
    mgr = playProject(makeProject(cta), {}, { mount, interactive: true })
  }
  const el = (id: string): HTMLElement | null => mount.querySelector(`.pa-el[data-id="${id}"]`)
  const layer = (): HTMLElement | null => mount.querySelector('.pa-stage > div[style*="z-index: 12000"]')
  // The CURRENT scene's root. The carry-over layer holds a pa-root of its own, so a bare
  // '.pa-root' would match that one first.
  const sceneRoot = (): HTMLElement => mount.querySelector<HTMLElement>('.pa-stage > .pa-root')!
  // Tap something other than the CTA (the scene root), then let the advance timer run.
  const tapScene = (): void => {
    sceneRoot().dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.runOnlyPendingTimers()
  }

  it('builds the CTA once, in a layer above every scene root', () => {
    play(ctaEl('cta', { persist: true }))

    const cta = el('cta')
    expect(cta).toBeTruthy()
    expect(layer()!.contains(cta!)).toBe(true)
    // Stripped from its own scene: exactly one copy exists, and not under the scene root.
    expect(mount.querySelectorAll('.pa-el[data-id="cta"]').length).toBe(1)
    expect(sceneRoot().contains(cta!)).toBe(false)
  })

  it('is the SAME DOM node before and after a scene change, so its pulse never restarts', () => {
    play(ctaEl('cta', { persist: true }))
    const before = el('cta')

    tapScene()

    expect(el('two')).toBeTruthy() // we really did change scene
    expect(el('one')).toBeNull()
    expect(el('cta')).toBe(before) // …and the CTA was never torn down
  })

  it('without the flag the CTA belongs to its scene and leaves with it', () => {
    play(ctaEl('cta'))
    expect(el('cta')).toBeTruthy()
    expect(layer()).toBeNull() // no carry-over layer at all

    tapScene()

    expect(el('cta')).toBeNull() // gone with scene one — this is the cut being fixed
  })

  it('fades out on scenes left off persistScenes and back in on the ones kept', () => {
    play(ctaEl('cta', { persist: true, persistScenes: ['s1', 's3'] }))
    const cta = el('cta')!
    expect(cta.style.opacity).not.toBe('0')

    tapScene() // → s2, not on the list
    expect(el('two')).toBeTruthy()
    expect(cta.style.opacity).toBe('0')
    expect(cta.style.pointerEvents).toBe('none')

    tapScene() // → s3, back on the list
    expect(el('three')).toBeTruthy()
    expect(cta.style.opacity).not.toBe('0')
    expect(cta.style.pointerEvents).toBe('auto')
  })

  it('a tap on the CTA clicks out and does NOT count as the scene’s tap-to-advance', () => {
    play(ctaEl('cta', { persist: true }))

    mount.querySelector<HTMLElement>('.pa-cta')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.runOnlyPendingTimers()

    expect(el('one')).toBeTruthy() // still on scene one
    expect(el('two')).toBeNull()

    // The click-out itself still works.
    mount.querySelector<HTMLElement>('.pa-cta')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(triggerCTA).toHaveBeenCalledTimes(1)
  })

  it('an in-scene (non-carried) CTA is exempt from tap-to-advance too', () => {
    play(ctaEl('cta'))

    mount.querySelector<HTMLElement>('.pa-cta')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.runOnlyPendingTimers()

    expect(el('two')).toBeNull()
  })
})
