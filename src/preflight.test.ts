import { describe, it, expect } from 'vitest'
import { preflightNetwork } from './preflight'
import { buildBaseHtml, NETWORKS, transformForNetwork } from './export'
import type { Network } from './export'
import type { Project } from '../runtime/scene'

const NET: Network = { name: 'AppLovin', tag: 'al' }
// Stand-in for the export shell's MRAID head + gate: the bridge tag, isMraidUsable, the
// literal ready listener and "loading" comparison validators scan for, and a guarded
// open() behind the full click-macro chain.
const CLICKOUT =
  `var t=window.clickTag||window.clickTag1||window.clickthrough||window.clickThrough||"";` +
  `if(window.isMraidUsable(mraid)){try{mraid.open(t);return}catch(e){}}window.open(t,"_blank","noopener");`
const MRAID_OK =
  `<script src="mraid.js"></script><script>window.isMraidUsable=function(m){return m.getState()!=="loading"};` +
  `if(mraid.getState()==="loading"){mraid.addEventListener("ready",start)}${CLICKOUT}</script>`
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
  it('flags a missing mraid.js bridge', () => {
    expect(preflightNetwork(NET, '<html></html>', 1000, baseProject()).findings.some((f) => /mraid\.js/.test(f.message))).toBe(true)
  })
  it('flags a build with no ready guard', () => {
    const html = '<script src="mraid.js"></script><script>mraid.open(u)</script>'
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.findings.some((f) => /ready guard/.test(f.message))).toBe(true)
  })
  it('flags a guard whose ready listener only survives as minified identifiers', () => {
    // The compliance can be real and still fail a static validator scan: this is the
    // minified shape of the same check, with no literal mraid.addEventListener("ready").
    const html = `<script src="mraid.js"></script><script>window.isMraidUsable=function(f){return f.getState()!=="loading"};f.addEventListener("ready",a);f.open(u)</script>`
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.findings.some((f) => /literal mraid\.addEventListener/.test(f.message))).toBe(true)
  })
  it('flags a guard with no "loading" check', () => {
    const html = `<script src="mraid.js"></script><script>window.isMraidUsable=function(m){return m.getState()==="default"};mraid.addEventListener("ready",start);mraid.open(u)</script>`
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.findings.some((f) => /"loading"\) guard/.test(f.message))).toBe(true)
  })
  it('flags a "loading" check stashed in a variable instead of the guard statement', () => {
    // Behaviourally identical, but there is no `if (mraid.getState() === "loading")` for a
    // scanner to find — this is the shape that gets the creative rejected.
    const html = MRAID_OK.replace('if(mraid.getState()==="loading")', 'var l=mraid.getState()==="loading";if(l)')
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.findings.some((f) => /"loading"\) guard/.test(f.message))).toBe(true)
  })
  it('flags a guard whose branch delegates the ready wait to a helper', () => {
    // The same trap one level down: the guard statement is right there, but a scanner
    // reading its body finds a call to waitForReady(), not the ready subscription.
    const html = MRAID_OK.replace('{mraid.addEventListener("ready",start)}', '{waitForReady()}')
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.findings.some((f) => /does not subscribe to the ready event inline/.test(f.message))).toBe(true)
  })
  it('warns when nothing calls mraid.open()', () => {
    const html = `<script src="mraid.js"></script><script>window.isMraidUsable=function(m){if(m.getState()==='loading')m.addEventListener('ready',i)}</script>`
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.findings.some((f) => /mraid\.open/.test(f.message))).toBe(true)
  })
  it('flags an mraid.open() with no visible isMraidUsable(mraid) guard beside it', () => {
    // Behaviourally guarded, but only through a minified identifier — a scanner reads
    // this as a raw call into the container.
    const html = MRAID_OK.replace('window.isMraidUsable(mraid)', 'Pa(mraid)')
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.findings.some((f) => /not visibly guarded/.test(f.message))).toBe(true)
  })
  it('flags an incomplete click-macro chain', () => {
    const html = MRAID_OK.replace('||window.clickthrough||window.clickThrough', '')
    const r = preflightNetwork(NET, html, 1000, baseProject())
    const hit = r.findings.find((f) => /Click macro chain/.test(f.message))
    expect(hit?.message).toContain('clickthrough')
    expect(hit?.message).toContain('clickThrough')
  })
  it('flags a clickout with no window.open() fallback', () => {
    const html = MRAID_OK.replace('window.open(t,"_blank","noopener");', '')
    const r = preflightNetwork(NET, html, 1000, baseProject())
    expect(r.findings.some((f) => /window\.open\(\) fallback/.test(f.message))).toBe(true)
  })
  it('checks MRAID on a non-MRAID-tagged network too — every export ships the bridge', () => {
    const fb: Network = { name: 'Facebook', tag: 'fb' }
    const r = preflightNetwork(fb, '<html></html>', 1000, baseProject())
    expect(r.findings.some((f) => /mraid\.js/.test(f.message))).toBe(true)
    expect(preflightNetwork(fb, `<html><head>${MRAID_OK}</head></html>`, 1000, baseProject()).errors).toBe(0)
  })

  // End to end against the shell + real runtime bundle, not a stand-in: the MRAID rules are
  // only worth anything if the file that actually ships clears them, on every network.
  it('the real export clears every MRAID rule on all networks', () => {
    const project = baseProject()
    const base = buildBaseHtml(project, {})
    for (const net of NETWORKS) {
      const html = transformForNetwork(base, net)
      const r = preflightNetwork(net, html, html.length, project)
      const mraidErrors = r.findings.filter((f) => f.level === 'error' && /mraid|MRAID|click/i.test(f.message))
      expect(mraidErrors, `${net.name}: ${mraidErrors.map((f) => f.message).join(' | ')}`).toEqual([])
    }
  })
})

// Dynamic holiday. The failure being guarded against is silent: a {holiday} label whose
// calendar has run out renders an EMPTY string, so the creative looks right on the day
// it was built and blank months into its flight.
describe('preflight — dynamic holiday', () => {
  const HTML = `<html><head>${MRAID_OK}</head><body>ok</body></html>`
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
