import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildBaseHtml } from './export'
import { extractFromHtml, extractJsonAfter, importBuiltFile } from './importBuilt'
import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'

// A small but representative project whose text values deliberately contain the
// characters that break naive extraction: `<` (esc'd to < at export), `}`,
// `"`, an escaped quote, and a </script>-looking substring.
function fixture(schemaVersion = 2): { project: Project; assets: AssetMap } {
  const project: Project = {
    meta: {
      schemaVersion,
      name: 'Round <Trip> "Test"',
      clickUrl: { ios: 'https://apps.apple.com/app/id1', android: 'https://play.google.com/store/apps/details?id=x' },
      baseW: 1080,
      baseH: 1920,
    },
    scenes: [
      {
        id: 'scene1',
        name: 'Scene 1',
        kind: 'game',
        elements: [
          {
            id: 't1',
            type: 'text',
            name: 'Adversarial',
            x: 540,
            y: 400,
            anchor: 'center',
            zIndex: 1,
            mode: 'fit',
            text: { value: 'if (a < b && c > d) { x } "quote" \\"esc\\" </script> {not:json}', fontSizePx: 48, fontWeight: 700, color: '#fff', align: 'center' },
          },
          { id: 'img1', type: 'image', name: 'Pic', assetId: 'a1', x: 540, y: 900, w: 400, h: 400, anchor: 'center', zIndex: 2, mode: 'fit' },
          { id: 'img2', type: 'image', name: 'Missing', assetId: 'gone', x: 540, y: 1300, w: 200, h: 200, anchor: 'center', zIndex: 3, mode: 'fit' },
        ],
        advance: { on: 'tap' },
      },
    ],
    startSceneId: 'scene1',
  }
  const assets: AssetMap = {
    a1: { src: 'data:image/png;base64,iVBORw0KGgo=', w: 400, h: 400 },
  }
  return { project, assets }
}

// Mirror the real export envelope, but stub the runtime bundle so the fixture
// stays small (buildBaseHtml embeds the two globals exactly as production does).
function buildHtml(project: Project, assets: AssetMap): string {
  return buildBaseHtml(project, assets, '/*runtime*/')
}

describe('extractJsonAfter (brace scanner)', () => {
  it('respects string state — braces/quotes inside strings do not end the object', () => {
    const text = 'x=window.PA_PROJECT={"a":"}{\\"q\\"","b":2};tail'
    const json = extractJsonAfter(text, 'window.PA_PROJECT=')
    expect(json).toBe('{"a":"}{\\"q\\"","b":2}')
    expect(JSON.parse(json!)).toEqual({ a: '}{"q"', b: 2 })
  })

  it('returns null on an unbalanced (truncated) object', () => {
    expect(extractJsonAfter('window.PA_ASSETS={"a":1', 'window.PA_ASSETS=')).toBeNull()
  })

  it('returns null when the marker is absent', () => {
    expect(extractJsonAfter('nothing here', 'window.PA_PROJECT=')).toBeNull()
  })
})

describe('extractFromHtml (own single-file build)', () => {
  it('round-trips a project with adversarial text through the real export envelope', () => {
    const { project, assets } = fixture()
    const r = extractFromHtml(buildHtml(project, assets), 'ad.html')
    expect(r.kind).toBe('own-html')
    // Structure survives exactly (proves < decode + brace scan vs. </script>, braces, quotes).
    expect(JSON.stringify(r.data!.project)).toBe(JSON.stringify(project))
    expect(r.data!.assets).toEqual(assets)
    // Lossy caveat + a missing-asset warning (element img2 -> 'gone') are surfaced.
    expect(r.warnings.length).toBeGreaterThanOrEqual(2)
    expect(r.warnings.some((w) => /could not be found/.test(w))).toBe(true)
    expect(r.schemaTooNew).toBe(false)
  })

  it('flags a build made by a newer editor as schemaTooNew', () => {
    const { project, assets } = fixture(99)
    const r = extractFromHtml(buildHtml(project, assets))
    expect(r.kind).toBe('own-html')
    expect(r.schemaVersion).toBe(99)
    expect(r.schemaTooNew).toBe(true)
  })

  it('classifies a truncated own-build as unknown (no throw)', () => {
    const { project, assets } = fixture()
    const html = buildHtml(project, assets)
    const truncated = html.slice(0, html.indexOf('window.PA_PROJECT=') + 60) // cut mid-project object
    const r = extractFromHtml(truncated)
    expect(r.kind).toBe('unknown')
    expect(r.error).toBeTruthy()
  })

  it('treats HTML with no PA_PROJECT as a foreign playable', () => {
    const r = extractFromHtml('<!doctype html><html><body><canvas></canvas><script>startGame()</script></body></html>', 'vendor.html')
    expect(r.kind).toBe('foreign-html')
    expect(r.foreignHtml).toContain('startGame')
  })
})

describe('importBuiltFile (dispatch by file)', () => {
  it('recovers an own single-file .html', async () => {
    const { project, assets } = fixture()
    const file = new File([buildHtml(project, assets)], 'ad.html', { type: 'text/html' })
    const r = await importBuiltFile(file)
    expect(r.kind).toBe('own-html')
    expect(r.data!.project.scenes).toHaveLength(1)
  })

  it('recovers an own zipped HTML (index.html inside a .zip)', async () => {
    const { project, assets } = fixture()
    const zip = new JSZip()
    zip.file('index.html', buildHtml(project, assets))
    const buf = await zip.generateAsync({ type: 'arraybuffer' })
    const file = new File([buf], 'ad_gg.zip', { type: 'application/zip' })
    const r = await importBuiltFile(file)
    expect(r.kind).toBe('own-html-zip')
    expect(JSON.stringify(r.data!.project)).toBe(JSON.stringify(project))
  })

  it('recovers an own Vite source zip (src/project.json + src/assets.json)', async () => {
    const { project, assets } = fixture()
    const zip = new JSZip()
    zip.file('src/project.json', JSON.stringify(project, null, 2))
    zip.file('src/assets.json', JSON.stringify(assets, null, 2))
    zip.file('index.html', '<!doctype html><html></html>')
    const buf = await zip.generateAsync({ type: 'arraybuffer' })
    const file = new File([buf], 'ad_source.zip', { type: 'application/zip' })
    const r = await importBuiltFile(file)
    expect(r.kind).toBe('own-vite-zip')
    expect(r.data!.assets).toEqual(assets)
  })

  it('rejects an unrecognized file without throwing', async () => {
    const file = new File(['just some text'], 'notes.txt', { type: 'text/plain' })
    const r = await importBuiltFile(file)
    expect(r.kind).toBe('unknown')
    expect(r.error).toBeTruthy()
  })
})
