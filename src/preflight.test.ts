import { describe, it, expect } from 'vitest'
import { preflightNetwork } from './preflight'
import { buildBaseHtml, NETWORKS, transformForNetwork } from './export'
import type { Network } from './export'
import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'

const NET: Network = { name: 'AppLovin', tag: 'al' }
const baseProject = (over: Partial<Project['meta']> = {}): Project => ({
  meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: 'https://apps.apple.com/app/id123', android: 'https://play.google.com/store/apps/details?id=com.real.app' }, baseW: 1080, baseH: 1920, ...over },
  scenes: [{ id: 's1', name: 's1', kind: 'overlay', advance: { on: 'manual' }, elements: [{ id: 'c', type: 'cta', name: 'CTA', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit' }] }],
  startSceneId: 's1',
})
// The real export shell (docs/mip_sample.html, via exportShell.generated.ts) around a
// stand-in runtime. The shell rules themselves are pinned in exportShell.test.ts.
const shellHtml = (project: Project = baseProject(), assets: AssetMap = {}): string => buildBaseHtml(project, assets, '/*runtime*/')
const MRAID_OK = shellHtml()

describe('preflightNetwork', () => {
  it('passes a clean, self-contained playable', () => {
    const r = preflightNetwork(NET, MRAID_OK, 1000, baseProject())
    expect(r.findings.filter((f) => f.level === 'error')).toEqual([])
  })
  it('flags an oversize file', () => {
    const r = preflightNetwork(NET, MRAID_OK, 6 * 1024 * 1024, baseProject())
    expect(r.findings.some((f) => /exceeds/.test(f.message))).toBe(true)
  })
  it('flags external resource references', () => {
    const html = MRAID_OK.replace('</body>', '<img src="https://cdn.example.com/a.png"></body>')
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.findings.some((f) => /external/.test(f.message))).toBe(true)
    expect(r.findings.some((f) => /unembedded reference.*cdn\.example\.com/.test(f.message))).toBe(true)
  })
  it('warns on a placeholder click URL', () => {
    const r = preflightNetwork(NET, MRAID_OK, 1000, baseProject({ clickUrl: { ios: 'https://apps.apple.com/app/id000000000', android: 'x' } }))
    expect(r.warns).toBeGreaterThan(0)
  })
  it('flags a missing mraid.js bridge', () => {
    expect(preflightNetwork(NET, '<html></html>', 1000, baseProject()).findings.some((f) => /mraid\.js/.test(f.message))).toBe(true)
  })
  it('checks the shell on a non-MRAID-tagged network too — every export ships the bridge', () => {
    const fb: Network = { name: 'Facebook', tag: 'fb' }
    expect(preflightNetwork(fb, '<html></html>', 1000, baseProject()).findings.some((f) => /mraid\.js/.test(f.message))).toBe(true)
    expect(preflightNetwork(fb, MRAID_OK, 1000, baseProject()).errors).toBe(0)
  })
  // End to end against the shell + real runtime bundle, not a stand-in: the rules are only
  // worth anything if the file that actually ships clears them, on every network.
  it('the real export clears every shell rule on all networks', () => {
    const project = baseProject()
    const base = buildBaseHtml(project, {})
    for (const net of NETWORKS) {
      const html = transformForNetwork(base, net)
      const r = preflightNetwork(net, html, html.length, project)
      const errors = r.findings.filter((f) => f.level === 'error')
      expect(errors, `${net.name}: ${errors.map((f) => f.message).join(' | ')}`).toEqual([])
    }
  })
})

// Dynamic holiday. The failure being guarded against is silent: a {holiday} label whose
// calendar has run out renders an EMPTY string, so the creative looks right on the day
// it was built and blank months into its flight.
describe('preflight — dynamic holiday', () => {
  const HTML = MRAID_OK
  const CALENDAR = [
    { start: '2026-01-01', end: '2026-12-31', label: 'Winter Sale' },
    { start: '2027-01-01', end: '2027-12-31', label: 'Winter Sale' },
  ]
  const holidayProject = (over: Partial<Project['meta']> = {}): Project => {
    const p = baseProject({ subconcept: 'dh', exportDate: '2026-09-01', promoCalendar: CALENDAR, ...over })
    p.scenes[0].elements.push({ id: 'h', type: 'countdown', name: 'H', x: 0, y: 0, anchor: 'center', zIndex: 1, mode: 'fit', countdown: { mode: 'dynamic', format: '{holiday}' } })
    return p
  }
  const messages = (p: Project): string => preflightNetwork(NET, HTML, 1000, p).findings.map((f) => f.message).join('\n')

  it('says nothing about the calendar on a MIP that never uses it', () => {
    expect(messages(baseProject())).not.toMatch(/promo calendar|Promo calendar/i)
  })
  it('is clean on a well-formed dh build', () => {
    expect(messages(holidayProject())).not.toMatch(/promo calendar|Promo calendar|Subconcept/i)
  })
  it('warns when the token is used with no calendar behind it', () => {
    const r = preflightNetwork(NET, HTML, 1000, holidayProject({ promoCalendar: undefined }))
    expect(r.warns).toBeGreaterThan(0)
    expect(messages(holidayProject({ promoCalendar: undefined }))).toMatch(/No promo calendar/)
  })
  it('warns when the calendar runs out inside the next 12 months', () => {
    expect(messages(holidayProject({ exportDate: '2027-06-01' }))).toMatch(/does not cover the 12 months/)
  })
  it('reports gaps and overlaps in the calendar', () => {
    expect(messages(holidayProject({ promoCalendar: [{ start: '2026-01-01', end: '2026-06-30', label: 'A' }, { start: '2026-08-01', end: '2027-12-31', label: 'B' }] }))).toMatch(/Promo calendar: Gap/)
    expect(messages(holidayProject({ promoCalendar: [{ start: '2026-01-01', end: '2026-08-30', label: 'A' }, { start: '2026-08-01', end: '2027-12-31', label: 'B' }] }))).toMatch(/Promo calendar:.*overlaps/)
  })
  it('notes a delivery name that is not dh', () => {
    expect(messages(holidayProject({ subconcept: 'dd' }))).toMatch(/Subconcept is “dd”/)
    expect(messages(holidayProject({ subconcept: 'dtd' }))).not.toMatch(/Subconcept is/)
  })
  // showWhen alone is enough: the "no promo" fallback carries literal copy, so nothing
  // in its format hints that it depends on the calendar.
  it('checks a MIP whose only tie to the calendar is a showWhen rule', () => {
    const p = baseProject({ subconcept: 'dh' })
    p.scenes[0].elements.push({ id: 'f', type: 'countdown', name: 'F', x: 0, y: 0, anchor: 'center', zIndex: 1, mode: 'fit', countdown: { mode: 'dynamic', format: 'Buy 1 Get 1 Free', showWhen: 'noHoliday' } })
    expect(messages(p)).toMatch(/No promo calendar/)
  })
})

describe('endscene base64 preflight', () => {
  const endProject = (endscene: Record<string, unknown>): Project => {
    const p = baseProject()
    p.scenes.push({
      id: 's2',
      name: 'End',
      kind: 'endscene',
      advance: { on: 'manual' },
      elements: [{ id: 'e', type: 'endscene', name: 'Card', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'extend', endscene: { objectFit: 'cover', bgColor: '#000', ...endscene } as never }],
    })
    return p
  }
  const withAssets = (map: Record<string, string>): string =>
    shellHtml(baseProject(), Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { src: v, w: 0, h: 0, kind: 'video' }])) as AssetMap)

  it('passes when every endscene asset is base64 in the output', () => {
    const html = withAssets({ vp: 'data:video/mp4;base64,AAAA', vl: 'data:video/mp4;base64,BBBB' })
    const r = preflightNetwork(NET, html, 1000, endProject({ portraitVideoId: 'vp', landscapeVideoId: 'vl' }))
    expect(r.errors).toBe(0)
  })

  it('errors when an endscene asset is absent from PA_ASSETS', () => {
    const html = withAssets({ vp: 'data:video/mp4;base64,AAAA' })
    const r = preflightNetwork(NET, html, 1000, endProject({ portraitVideoId: 'vp', landscapeVideoId: 'vl' }))
    expect(r.findings.some((f) => f.level === 'error' && /"vl" is not in PA_ASSETS/.test(f.message))).toBe(true)
  })

  it('errors when an endscene asset ships a remote src', () => {
    const html = withAssets({ vp: 'https://cdn.example.com/end.mp4' })
    const r = preflightNetwork(NET, html, 1000, endProject({ portraitVideoId: 'vp' }))
    // Both the generic remote-asset gate and the endscene-specific one fire.
    expect(r.findings.some((f) => f.level === 'error' && /remote http\(s\) src/.test(f.message))).toBe(true)
    expect(r.findings.some((f) => f.level === 'error' && /"vp" is not base64-encoded/.test(f.message))).toBe(true)
  })

  it('errors on a percent-encoded endscene data URL', () => {
    const html = withAssets({ card: 'data:text/html,%3Chtml%3E' })
    const r = preflightNetwork(NET, html, 1000, endProject({ mode: 'html', htmlId: 'card' }))
    expect(r.findings.some((f) => f.level === 'error' && /"card" is not base64-encoded/.test(f.message))).toBe(true)
  })

  it('ignores a stale asset from the inactive endscene mode', () => {
    // mode unset = video, so a leftover htmlId must not be demanded in the output.
    const html = withAssets({ vp: 'data:video/mp4;base64,AAAA' })
    const r = preflightNetwork(NET, html, 1000, endProject({ portraitVideoId: 'vp', htmlId: 'stale' }))
    expect(r.errors).toBe(0)
  })
})
