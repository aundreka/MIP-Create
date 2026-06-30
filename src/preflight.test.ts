import { describe, it, expect } from 'vitest'
import { preflightNetwork } from './preflight'
import type { Network } from './export'
import type { Project } from '../runtime/scene'

const NET: Network = { name: 'AppLovin', tag: 'al', injectMraid: true }
const baseProject = (over: Partial<Project['meta']> = {}): Project => ({
  meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: 'https://apps.apple.com/app/id123', android: 'https://play.google.com/store/apps/details?id=com.real.app' }, baseW: 1080, baseH: 1920, ...over },
  scenes: [{ id: 's1', name: 's1', kind: 'overlay', advance: { on: 'manual' }, elements: [{ id: 'c', type: 'cta', name: 'CTA', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit' }] }],
  startSceneId: 's1',
})

describe('preflightNetwork', () => {
  it('passes a clean, self-contained playable', () => {
    const html = '<html><head><script src="mraid.js"></script></head><body>ok</body></html>'
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.errors).toBe(0)
  })
  it('flags an oversize file', () => {
    const r = preflightNetwork(NET, '<script src="mraid.js"></script>', 6 * 1024 * 1024, baseProject())
    expect(r.findings.some((f) => /exceeds/.test(f.message))).toBe(true)
  })
  it('flags external resource references', () => {
    const html = '<script src="mraid.js"></script><img src="https://cdn.example.com/a.png">'
    expect(preflightNetwork(NET, html, 1000, baseProject()).findings.some((f) => /external/.test(f.message))).toBe(true)
  })
  it('warns on a placeholder click URL', () => {
    const r = preflightNetwork(NET, '<script src="mraid.js"></script>', 1000, baseProject({ clickUrl: { ios: 'https://apps.apple.com/app/id000000000', android: 'x' } }))
    expect(r.warns).toBeGreaterThan(0)
  })
  it('flags a missing mraid.js on an MRAID network', () => {
    expect(preflightNetwork(NET, '<html></html>', 1000, baseProject()).findings.some((f) => /MRAID/.test(f.message))).toBe(true)
  })
})
