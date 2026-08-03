import { afterEach, describe, expect, it } from 'vitest'
import type { Project } from '../runtime/scene'
import { getState, loadProject, patchGeometry, setOrientation } from './store'
import { setEditLocale } from './locale'

const project = (): Project => ({
  meta: { schemaVersion: 2, name: 'localized', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, defaultLocale: 'en', locales: ['es'] },
  startSceneId: 's1',
  scenes: [{
    id: 's1', name: 'Scene', kind: 'game', advance: { on: 'manual' },
    elements: [{ id: 'hero', type: 'image', name: 'Hero', assetId: 'en', x: 100, y: 200, anchor: 'center', zIndex: 1, mode: 'fit', landscape: { x: 300 } }],
  }],
})

afterEach(() => setEditLocale(null))

describe('language-specific editor layouts', () => {
  it('keeps default, localized portrait, and localized landscape geometry independent', () => {
    loadProject(project(), {}, null)
    setEditLocale('es')
    setOrientation('portrait')
    patchGeometry('hero', { x: 140, scale: 0.8 })
    setOrientation('landscape')
    patchGeometry('hero', { x: 360, y: 410 })

    const hero = getState().project.scenes[0].elements[0]
    expect(hero.x).toBe(100)
    expect(hero.landscape?.x).toBe(300)
    expect(hero.localeOverrides?.es?.portrait).toMatchObject({ x: 140, scale: 0.8 })
    expect(hero.localeOverrides?.es?.landscape).toMatchObject({ x: 360, y: 410 })
  })
})
