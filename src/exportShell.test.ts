// The export shell is the reference creatives' own: docs/mip_sample.html for a MIP,
// docs/sip_sample.html for a SIP (scripts/export-shell.mjs reads it out of them). These
// tests fail when the samples change and `npm run sync:samples` has not been run, and pin
// what a network validator reads an export for.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs module shared with the sync script
import { extractMip, extractSip, renderGenerated } from '../scripts/export-shell.mjs'
import type { Project } from '../runtime/scene'
import { buildBaseHtml, NETWORKS, transformForNetwork } from './export'
import * as Shell from './exportShell.generated'
import { preflightNetwork } from './preflight'

const ROOT = join(__dirname, '..')
const sample = (name: string): string => readFileSync(join(ROOT, 'docs', name), 'utf8')

const mip: Project = {
  meta: { schemaVersion: 1, name: 'p', client: 'Brand', clickUrlMode: 'none', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
  scenes: [{ id: 's1', name: 's1', kind: 'game', advance: { on: 'manual' }, elements: [] }],
  startSceneId: 's1',
}
const sip: Project = {
  ...mip,
  scenes: [{ id: 'e1', name: 'End card', kind: 'endscene', advance: { on: 'manual' }, elements: [] }],
  startSceneId: 'e1',
}
const RUNTIME = 'var ns="http://www.w3.org/2000/svg";/*runtime*/'

describe('export shell vs the samples', () => {
  it('src/exportShell.generated.ts is in step with docs/mip_sample.html and docs/sip_sample.html', () => {
    const fresh = renderGenerated(extractMip(sample('mip_sample.html')), extractSip(sample('sip_sample.html')))
    const current = readFileSync(join(ROOT, 'src', 'exportShell.generated.ts'), 'utf8')
    // Stale? Run `npm run sync:samples` (or the /sync-export-samples skill).
    expect(current === fresh, 'exportShell.generated.ts is stale — run npm run sync:samples').toBe(true)
  })
})

describe('MIP export', () => {
  const html = buildBaseHtml(mip, {}, RUNTIME)

  it('opens exactly as the sample does, its whole MRAID head first', () => {
    expect(html.startsWith(Shell.MIP_htmlOpen + Shell.MIP_headScripts + Shell.MIP_meta)).toBe(true)
    expect(html.endsWith(Shell.MIP_tail)).toBe(true)
    expect(html).toContain('<title>Brand</title>')
  })

  it('starts the runtime only through the sample gate, after the bundle has loaded', () => {
    expect(html.indexOf('window.PA_MRAID_GATE = true')).toBeLessThan(html.indexOf('/*runtime*/'))
    expect(html.indexOf('/*runtime*/')).toBeLessThan(html.indexOf(`window.${Shell.MIP_bootCallback} = startCreative`))
    expect(html).toContain(`window.PA_NOW = window.${Shell.MIP_dateAccessor}`)
  })

  it('ships one bridge on every network, and the doctype stays first', () => {
    for (const net of NETWORKS) {
      const out = transformForNetwork(html, net)
      expect(out.match(/<script src="mraid\.js"><\/script>/g)?.length).toBe(1)
      expect(out.startsWith(Shell.MIP_htmlOpen)).toBe(true)
    }
  })

  it('writes no literal URL — they read as unembedded resources', () => {
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).toContain('http:\\/\\/www.w3.org/2000/svg')
  })

  it('passes preflight on the shell rules', () => {
    const r = preflightNetwork(NETWORKS[0], html, html.length, mip)
    expect(r.findings.filter((f) => f.level === 'error')).toEqual([])
  })
})

describe('SIP export', () => {
  const html = buildBaseHtml(sip, {}, RUNTIME)

  it("carries the sample's head, click-through, debounce, lifecycle and boot gate verbatim", () => {
    expect(html.startsWith(Shell.SIP_htmlOpen + Shell.SIP_meta)).toBe(true)
    for (const piece of [
      Shell.SIP_helper,
      Shell.SIP_dateScript,
      Shell.SIP_handleClickAction,
      Shell.SIP_handleTap,
      Shell.SIP_setupMraidViewability,
      Shell.SIP_lifecycleStubs,
      Shell.SIP_pagehide,
      Shell.SIP_init,
      Shell.SIP_initializeMraidRuntime,
    ])
      expect(html).toContain(piece)
    // The sample's head order: title, then the bridge + helper, then the ?date= script.
    expect(html.indexOf('<title>')).toBeLessThan(html.indexOf('<script src="mraid.js">'))
    expect(html.indexOf('<script src="mraid.js">')).toBeLessThan(html.indexOf(Shell.SIP_dateScript))
  })

  it('routes the runtime CTA through the debounce, then the sample handleClickAction', () => {
    expect(html).toMatch(/window\.handleClickAction = function \(\) \{\s*handleTap\(\{ type: "click" \}\);/)
    expect(html.indexOf('/*runtime*/')).toBeLessThan(html.indexOf('initializeMraidRuntime();'))
  })

  it('passes preflight on the shell rules', () => {
    const r = preflightNetwork(NETWORKS[0], html, html.length, sip)
    expect(r.findings.filter((f) => f.level === 'error')).toEqual([])
  })

  it('boots the runtime once the gate opens and opens one click per gesture', async () => {
    const W = window as unknown as Record<string, unknown>
    const opened: unknown[] = []
    let started = 0
    W.mraid = { getState: () => 'default', addEventListener: () => {}, isViewable: () => true, open: (u?: string) => opened.push(u ?? '') }
    W.PA_START = () => { started++ }
    const body = html.slice(html.lastIndexOf('<script>'), html.lastIndexOf('</script>')).replace('<script>', '')
    new Function(Shell.SIP_helper.replace(/<script[^>]*>(<\/script>)?|<\/script>/g, ''))()
    new Function(body)()
    expect(started).toBe(1)
    ;(W.handleClickAction as () => void)()
    ;(W.handleClickAction as () => void)()
    expect(opened).toEqual([''])
    for (const k of ['mraid', 'PA_START', 'handleClickAction', 'isMraidUsable', 'gameReady', 'gameStart', 'gameEnd', 'gameClose']) delete W[k]
  })
})

describe('preflight on what validators reject', () => {
  const base = buildBaseHtml(mip, {}, RUNTIME)
  const errors = (html: string) => preflightNetwork(NETWORKS[0], html, html.length, mip).findings.filter((f) => f.level === 'error').map((f) => f.message)

  it('flags reserved click identifiers', () => {
    expect(errors(base.replace('/*runtime*/', 'var a=window.clickTag1;')).join()).toMatch(/Reserved click identifier/)
  })
  it('flags window.open, even in a comment', () => {
    expect(errors(base.replace('/*runtime*/', '/* window.open */')).join()).toMatch(/Browser navigation/)
  })
  it('flags a literal URL as an unembedded reference', () => {
    expect(errors(base.replace('/*runtime*/', 'fetch("https://logger2.example.app")')).join()).toMatch(/unembedded reference.*logger2/)
  })
  it('flags a shell that drifted from the sample', () => {
    expect(errors(base.replace('window.isMraidUsable', 'window.isUsable')).join()).toMatch(/no longer matches docs\/mip_sample\.html/)
  })
  it('flags what an imported HTML end card carries — validators decode it', () => {
    const card = btoa('<html><script>window.open("https://logger2.example.app");var c=window.clickthrough</script></html>')
    const msg = errors(base.replace('/*runtime*/', `var x="data:text/html;base64,${card}";`)).join()
    expect(msg).toMatch(/imported HTML end card contains/)
    expect(msg).toMatch(/clickthrough/)
  })
})
