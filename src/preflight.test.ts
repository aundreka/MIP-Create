import { describe, it, expect } from 'vitest'
import { preflightNetwork } from './preflight'
import type { Network } from './export'
import type { Project } from '../runtime/scene'

const NET: Network = { name: 'AppLovin', tag: 'al', injectMraid: true }
// Stand-in for the (minified) runtime's MRAID boot: the ready guard + the open() call
// preflight looks for on an MRAID network.
const MRAID_OK = `<script src="mraid.js"></script><script>if(m.getState()==='loading')m.addEventListener('ready',i);m.open(u)</script>`
const baseProject = (over: Partial<Project['meta']> = {}): Project => ({
  meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: 'https://apps.apple.com/app/id123', android: 'https://play.google.com/store/apps/details?id=com.real.app' }, baseW: 1080, baseH: 1920, ...over },
  scenes: [{ id: 's1', name: 's1', kind: 'overlay', advance: { on: 'manual' }, elements: [{ id: 'c', type: 'cta', name: 'CTA', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit' }] }],
  startSceneId: 's1',
})

describe('preflightNetwork', () => {
  it('passes a clean, self-contained playable', () => {
    const html = `<html><head>${MRAID_OK}</head><body>ok</body></html>`
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.errors).toBe(0)
  })
  it('flags an oversize file', () => {
    const r = preflightNetwork(NET, MRAID_OK, 6 * 1024 * 1024, baseProject())
    expect(r.findings.some((f) => /exceeds/.test(f.message))).toBe(true)
  })
  it('flags external resource references', () => {
    const html = `${MRAID_OK}<img src="https://cdn.example.com/a.png">`
    expect(preflightNetwork(NET, html, 1000, baseProject()).findings.some((f) => /external/.test(f.message))).toBe(true)
  })
  it('warns on a placeholder click URL', () => {
    const r = preflightNetwork(NET, MRAID_OK, 1000, baseProject({ clickUrl: { ios: 'https://apps.apple.com/app/id000000000', android: 'x' } }))
    expect(r.warns).toBeGreaterThan(0)
  })
  it('flags a missing mraid.js on an MRAID network', () => {
    expect(preflightNetwork(NET, '<html></html>', 1000, baseProject()).findings.some((f) => /MRAID/.test(f.message))).toBe(true)
  })
  it('flags an MRAID build with no ready guard', () => {
    const html = '<script src="mraid.js"></script><script>mraid.open(u)</script>'
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.findings.some((f) => /ready guard/.test(f.message))).toBe(true)
  })
  it('warns when nothing calls mraid.open()', () => {
    const html = `<script src="mraid.js"></script><script>if(m.getState()==='loading')m.addEventListener('ready',i)</script>`
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.findings.some((f) => /mraid\.open/.test(f.message))).toBe(true)
  })
})
