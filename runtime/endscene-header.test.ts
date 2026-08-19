// A full-screen endscene with showHeader keeps the pinned band (the default is hidden).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign } from './responsive'
import type { Project } from './scene'

vi.mock('./networks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./networks')>()),
  notifyGameEnd: vi.fn(),
  notifyGameClose: vi.fn(),
  triggerCTA: vi.fn(),
}))

function proj(showHeader: boolean): Project {
  return {
    meta: { schemaVersion: 1, name: 'e', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, header: { heightPx: 120 } },
    startSceneId: 'end',
    scenes: [
      {
        id: 'end', name: 'End', kind: 'endscene', ...(showHeader ? { showHeader: true } : {}),
        elements: [{ id: 't', type: 'text', name: 't', x: 540, y: 800, anchor: 'center', zIndex: 2, mode: 'fit', text: { value: 'end', fontSizePx: 40 } }],
        advance: { on: 'manual' },
        transition: { type: 'none', durationMs: 0 },
      },
    ],
  }
}

describe('endscene header opt-in', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    setDesign(1080, 1920)
    computeMetrics(1080, 1920)
  })
  const run = (showHeader: boolean): string => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    playProject(proj(showHeader), {}, { mount, interactive: true })
    return mount.querySelector<HTMLElement>('.pa-header')?.style.opacity ?? 'MISSING'
  }
  it('hidden by default', () => expect(run(false)).toBe('0'))
  it('shown with showHeader', () => expect(run(true)).toBe('1'))
})
