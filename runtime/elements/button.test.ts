// wireSceneNav backs BOTH the button element and images marked as buttons
// (el.button), so these cover the shared contract: navigate on tap, read config
// live (the editor swaps rec.el in place), and don't leave a tap effect stuck on.

import { describe, it, expect, vi } from 'vitest'
import { wireSceneNav } from './button'
import type { SceneElement } from '../scene'
import type { RuntimeCtx } from '../types'

function setup(el: SceneElement) {
  const emit = vi.fn()
  const ctx = { emit, src: () => '', asset: () => undefined } as unknown as RuntimeCtx
  const listen = document.createElement('div')
  const effect = document.createElement('img')
  // `live` is the mutable holder the getter reads through, standing in for rec.el.
  const live = { el }
  wireSceneNav(listen, effect, () => live.el, ctx)
  return { emit, listen, effect, live }
}

const img = (button: SceneElement['button']): SceneElement =>
  ({ id: 'i1', type: 'image', assetId: 'a1', button }) as SceneElement

const down = (n: HTMLElement): void => void n.dispatchEvent(new Event('pointerdown', { bubbles: true }))
const up = (n: HTMLElement): void => void n.dispatchEvent(new Event('pointerup', { bubbles: true }))

describe('wireSceneNav', () => {
  it('navigates to the configured target scene on tap', () => {
    const { emit, listen } = setup(img({ targetSceneId: 's2' }))
    listen.dispatchEvent(new Event('click', { bubbles: true }))
    expect(emit).toHaveBeenCalledWith('scene-goto', 's2')
  })

  it('falls back to the scene advance rule when no target is chosen', () => {
    const { emit, listen } = setup(img({}))
    listen.dispatchEvent(new Event('click', { bubbles: true }))
    expect(emit).toHaveBeenCalledWith('pa-advance')
    expect(emit).not.toHaveBeenCalledWith('scene-goto', expect.anything())
  })

  // The bug this getter exists to prevent: the editor's live-update path swaps
  // rec.el without rebuilding content, so a captured `el` would keep navigating
  // to the target the element had at build time.
  it('reads the target live, after the element is swapped in place', () => {
    const { emit, listen, live } = setup(img({ targetSceneId: 's2' }))
    live.el = img({ targetSceneId: 's9' })
    listen.dispatchEvent(new Event('click', { bubbles: true }))
    expect(emit).toHaveBeenCalledWith('scene-goto', 's9')
    expect(emit).not.toHaveBeenCalledWith('scene-goto', 's2')
  })

  it('stops the gesture propagating so the scene tap-advance cannot outrun it', () => {
    const { listen } = setup(img({ targetSceneId: 's2' }))
    const onParentDown = vi.fn()
    document.body.appendChild(listen)
    document.body.addEventListener('pointerdown', onParentDown)
    down(listen)
    expect(onParentDown).not.toHaveBeenCalled()
    document.body.removeEventListener('pointerdown', onParentDown)
    listen.remove()
  })

  describe('tap effect', () => {
    it('applies the effect class on press and clears it on release', async () => {
      const { listen, effect } = setup(img({ targetSceneId: 's2', tapEffect: 'press' }))
      down(listen)
      expect(effect.classList.contains('pa-tap-press')).toBe(true)
      // the "on" state lands a frame later so the transition actually runs
      await new Promise(requestAnimationFrame)
      expect(effect.classList.contains('pa-tap-on')).toBe(true)
      up(listen)
      expect(effect.classList.contains('pa-tap-on')).toBe(false)
      expect(effect.classList.contains('pa-tap-press')).toBe(false)
    })

    it('releases on pointercancel, so an aborted gesture cannot stick', async () => {
      const { listen, effect } = setup(img({ targetSceneId: 's2', tapEffect: 'glow' }))
      down(listen)
      await new Promise(requestAnimationFrame)
      expect(effect.classList.contains('pa-tap-glow')).toBe(true)
      listen.dispatchEvent(new Event('pointercancel', { bubbles: true }))
      expect(effect.classList.contains('pa-tap-glow')).toBe(false)
      expect(effect.classList.contains('pa-tap-on')).toBe(false)
    })

    it('does not add the "on" state if released before the next frame', async () => {
      const { listen, effect } = setup(img({ targetSceneId: 's2', tapEffect: 'press' }))
      down(listen)
      up(listen)
      await new Promise(requestAnimationFrame)
      expect(effect.classList.contains('pa-tap-on')).toBe(false)
    })

    it('applies nothing when no effect is configured', async () => {
      const { listen, effect } = setup(img({ targetSceneId: 's2' }))
      down(listen)
      await new Promise(requestAnimationFrame)
      expect(effect.className).toBe('')
    })
  })
})
