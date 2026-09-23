import { describe, it, expect } from 'vitest'
import { blurWarnings, buildBaseHtml, NETWORKS, processAssets, pruneAssets, stripSourceMap, transformForNetwork } from './export'
import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'

describe('pruneAssets', () => {
  it('keeps only referenced element assets', () => {
    const assets: AssetMap = { used: { src: 'a', w: 1, h: 1 }, unused: { src: 'b', w: 1, h: 1 } }
    const p: Project = {
      meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      scenes: [{ id: 's1', name: 's1', kind: 'overlay', advance: { on: 'manual' }, elements: [{ id: 'i', type: 'image', name: 'i', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit', assetId: 'used' }] }],
      startSceneId: 's1',
    }
    expect(Object.keys(pruneAssets(p, assets))).toEqual(['used'])
  })

  it('keeps element-level SFX and project-level SFX assets', () => {
    const assets: AssetMap = { s1: { src: 'a', w: 0, h: 0, kind: 'audio' }, s2: { src: 'b', w: 0, h: 0, kind: 'audio' }, none: { src: 'c', w: 1, h: 1 } }
    const p: Project = {
      meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      scenes: [{ id: 's1', name: 's1', kind: 'overlay', advance: { on: 'manual' }, elements: [{ id: 'e', type: 'cta', name: 'e', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit', sfx: [{ event: 'tap', assetId: 's1' }] }] }],
      startSceneId: 's1',
      sfx: [{ event: 'gameWin', assetId: 's2' }],
    }
    expect(Object.keys(pruneAssets(p, assets)).sort()).toEqual(['s1', 's2'])
  })

  it('keeps a font referenced only by the pinned header', () => {
    const assets: AssetMap = { My_Font: { src: 'data:font/ttf;base64,AA==', w: 0, h: 0, kind: 'font' }, other: { src: 'x', w: 1, h: 1 } }
    const p: Project = {
      meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, header: { fontFamily: 'My_Font' } },
      scenes: [{ id: 's1', name: 's1', kind: 'overlay', advance: { on: 'manual' }, elements: [] }],
      startSceneId: 's1',
    }
    expect(Object.keys(pruneAssets(p, assets))).toEqual(['My_Font'])
  })

  it('keeps a background landscape image', () => {
    const assets: AssetMap = { p: { src: 'a', w: 1, h: 1 }, l: { src: 'b', w: 1, h: 1 }, none: { src: 'c', w: 1, h: 1 } }
    const proj: Project = {
      meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      scenes: [{ id: 's1', name: 's1', kind: 'game', advance: { on: 'manual' }, elements: [{ id: 'bg', type: 'background', name: 'bg', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'extend', assetId: 'p', background: { objectFit: 'cover', landscapeAssetId: 'l' } }] }],
      startSceneId: 's1',
    }
    expect(Object.keys(pruneAssets(proj, assets)).sort()).toEqual(['l', 'p'])
  })

  it('keeps optional per-language element assets', () => {
    const assets: AssetMap = { en: { src: 'a', w: 1, h: 1 }, es: { src: 'b', w: 1, h: 1 }, unused: { src: 'c', w: 1, h: 1 } }
    const proj: Project = {
      meta: { schemaVersion: 2, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920, locales: ['es'] },
      scenes: [{ id: 's1', name: 's1', kind: 'game', advance: { on: 'manual' }, elements: [{ id: 'hero', type: 'image', name: 'Hero', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit', assetId: 'en', localeOverrides: { es: { assetId: 'es' } } }] }],
      startSceneId: 's1',
    }
    expect(Object.keys(pruneAssets(proj, assets)).sort()).toEqual(['en', 'es'])
  })
})

describe('source map stripping', () => {
  const proj: Project = {
    meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    scenes: [{ id: 's1', name: 's1', kind: 'game', advance: { on: 'manual' }, elements: [] }],
    startSceneId: 's1',
  }

  it('removes an inline sourceMappingURL data URI from the runtime', () => {
    const rt = 'console.log(1);\n\n//# sourceMappingURL=data:application/json;base64,' + 'A'.repeat(5000)
    const html = buildBaseHtml(proj, {}, rt)
    expect(html).toContain('console.log(1);')
    expect(html).not.toContain('sourceMappingURL')
    // Measured against the same shell with a map-free runtime, so the bound tracks the
    // stripped payload rather than the (MRAID head + gate) size of the shell itself.
    expect(html.length).toBeLessThan(buildBaseHtml(proj, {}, 'console.log(1);').length + 50)
  })

  it('stripSourceMap leaves ordinary code untouched', () => {
    const js = 'const a = 1; // normal comment\nconst b = "sourceMappingURL in a string is fine"'
    expect(stripSourceMap(js)).toBe(js)
  })

  it('every export carries the MRAID bridge and the readiness guard', () => {
    const html = buildBaseHtml(proj, {}, 'x')
    expect(html).toContain('<script src="mraid.js"></script>')
    expect(html).toContain('window.isMraidUsable')
    // Guard must be in <head>, ahead of the runtime: containers can inject window.mraid
    // asynchronously, so the 'ready' listener has to be armed before that lands.
    expect(html.indexOf('isMraidUsable')).toBeLessThan(html.indexOf('</head>'))
  })

  it('holds initialization behind a literal ready gate that validators can see', () => {
    const html = buildBaseHtml(proj, {}, '/*runtime*/')
    // Written longhand on purpose: a minified equivalent reads as missing to the static
    // scanners networks run ("mraid present but no ready-event / getState() guard").
    expect(html).toMatch(/mraid\.addEventListener\("ready", startCreative\)/)
    // The AppLovin readiness guard, spelled the way a scanner reads it: the literal
    // identifier, the literal call, the literal state — and as the if statement itself,
    // not a comparison stashed in a variable.
    expect(html).toMatch(/if \(mraid\.getState\(\) === "loading"\)/)
    // Armed in <head> too: "before initialization" has to be visible ahead of the bundle.
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toMatch(/if \(mraid\.getState\(\) === "loading"\)/)
    expect(head).toMatch(/mraid\.addEventListener\("ready"/)
    // Every guard subscribes to ready inside its own branch — a scanner reads the branch
    // body, and a call to a shared wait helper there is not the subscription it wants.
    for (const m of html.matchAll(/if \(mraid\.getState\(\) === "loading"\) \{/g)) {
      const branch = html.slice(m.index, m.index + 400)
      expect(branch, branch.slice(0, 160)).toMatch(/mraid\.addEventListener\("ready"/)
    }
    // The gate is real: the bundle defers to PA_START because of PA_MRAID_GATE, and the
    // gate runs AFTER the runtime that publishes PA_START.
    expect(html).toContain('window.PA_MRAID_GATE = true')
    expect(html).toContain('window.PA_START()')
    expect(html.indexOf('/*runtime*/')).toBeLessThan(html.indexOf('window.PA_START()'))
    expect(html.indexOf('PA_MRAID_GATE')).toBeLessThan(html.indexOf('/*runtime*/'))
  })

  it('ships a guarded clickout with the full click-macro chain in scannable source', () => {
    const html = buildBaseHtml(proj, {}, 'x')
    // mraid.open() only behind the readiness guard, and only inside try/catch.
    expect(html).toMatch(/window\.isMraidUsable\(mraid\)/)
    expect(html).toMatch(/mraid\.open\(clickTarget\)/)
    const guard = html.indexOf('window.isMraidUsable(mraid)')
    const open = html.indexOf('mraid.open(clickTarget)')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(open)
    expect(html.slice(guard, open)).toContain('try {')
    // No network's click macro is universal, so all four ship, with a browser fallback.
    for (const macro of ['clickTag', 'clickTag1', 'clickthrough', 'clickThrough']) {
      expect(html).toContain('window.' + macro)
    }
    expect(html).toContain('window.open(clickTarget, "_blank", "noopener")')
    // The guard is defined in <head>, ahead of the runtime that calls it.
    expect(html.indexOf('window.PA_CLICKOUT')).toBeLessThan(html.indexOf('</head>'))
  })

  it('does not double-inject mraid.js on the MRAID networks', () => {
    const base = buildBaseHtml(proj, {}, 'x')
    for (const net of NETWORKS) {
      const html = transformForNetwork(base, net)
      expect(html.match(/src="mraid\.js"/g)?.length).toBe(1)
    }
  })

  it('export shell carries the user-select guards (whole-screen selection bug)', () => {
    const html = buildBaseHtml(proj, {}, 'x')
    expect(html).toContain('user-select:none')
    expect(html).toContain('-webkit-tap-highlight-color:transparent')
  })

  it('breaks the asset payload across lines so no line is a multi-MB blob', async () => {
    const big = 'A'.repeat(300_000)
    const assets: AssetMap = {
      one: { src: `data:image/webp;base64,${big}`, w: 1, h: 1 },
      two: { src: `data:image/webp;base64,${big}`, w: 1, h: 1 },
      three: { src: `data:image/webp;base64,${big}`, w: 1, h: 1 },
    }
    const html = buildBaseHtml(proj, assets, 'x')
    const longest = Math.max(...html.split('\n').map((l) => l.length))
    // A validator reading line by line sees one asset at a time, not the whole map.
    expect(longest).toBeLessThan(400_000)
    // Same data, still one JS object.
    expect(html).toContain('window.PA_ASSETS={\n')
    const payload = html.slice(html.indexOf('window.PA_ASSETS=') + 'window.PA_ASSETS='.length)
    const parsed = JSON.parse(payload.slice(0, payload.indexOf('\n}') + 2))
    expect(Object.keys(parsed)).toEqual(['one', 'two', 'three'])
  })
})

describe('embedded HTML endscene assets', () => {
  const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')

  it('strips the card’s own mraid.js bridge — the top-level document owns the only one', async () => {
    const card = '<!doctype html><html><head><script src="mraid.js"></script>\n<title>card</title></head><body></body></html>'
    const assets: AssetMap = { card: { src: `data:text/html;base64,${b64(card)}`, w: 0, h: 0, kind: 'html' } }
    for (const optimize of [true, false]) {
      const { assets: out } = await processAssets(assets, optimize, 0.8)
      const inner = Buffer.from(out.card.src.split(',')[1], 'base64').toString('utf8')
      expect(inner).not.toMatch(/src=["']mraid\.js["']/)
      expect(inner).toContain('<title>card</title>')
    }
  })

  it('keeps a clip the card reads back out of PA_ASSETS', () => {
    // What an already-hoisted card looks like: the video lives in the OUTER asset map and
    // the card reaches back for it, so nothing in the project references that id.
    const card = `<script>const srcPortrait=(window.parent&&window.parent.PA_ASSETS&&window.parent.PA_ASSETS["card__p"])?window.parent.PA_ASSETS["card__p"].src:"";</script>`
    const assets: AssetMap = {
      card: { src: `data:text/html;base64,${b64(card)}`, w: 0, h: 0, kind: 'html' },
      card__p: { src: 'data:video/mp4;base64,AA==', w: 0, h: 0, kind: 'video' },
      unused: { src: 'data:video/mp4;base64,BB==', w: 0, h: 0, kind: 'video' },
    }
    const p: Project = {
      meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      scenes: [{ id: 'end', name: 'end', kind: 'endscene', advance: { on: 'manual' }, elements: [{ id: 'e', type: 'endscene', name: 'e', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'extend', endscene: { mode: 'html', htmlId: 'card', objectFit: 'cover', bgColor: '#000000' } }] }],
      startSceneId: 'end',
    }
    expect(Object.keys(pruneAssets(p, assets)).sort()).toEqual(['card', 'card__p'])
  })

  it('warns when the clip the card reads back is gone', () => {
    const card = `<script>const srcPortrait=(window.parent&&window.parent.PA_ASSETS&&window.parent.PA_ASSETS["card__p"])?window.parent.PA_ASSETS["card__p"].src:"";</script>`
    const proj: Project = {
      meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
      scenes: [{ id: 's1', name: 's1', kind: 'game', advance: { on: 'manual' }, elements: [] }],
      startSceneId: 's1',
    }
    const withClip: AssetMap = {
      card: { src: `data:text/html;base64,${b64(card)}`, w: 0, h: 0, kind: 'html' },
      card__p: { src: 'data:video/mp4;base64,AA==', w: 0, h: 0, kind: 'video' },
    }
    expect(blurWarnings(proj, withClip)).toEqual([])
    const warns = blurWarnings(proj, { card: withClip.card })
    expect(warns.length).toBe(1)
    expect(warns[0]).toContain('card__p')
  })

  it('leaves a card without a bridge untouched', async () => {
    const card = '<!doctype html><html><head><title>card</title></head><body></body></html>'
    const assets: AssetMap = { card: { src: `data:text/html;base64,${b64(card)}`, w: 0, h: 0, kind: 'html' } }
    const { assets: out } = await processAssets(assets, false, 0.8)
    expect(Buffer.from(out.card.src.split(',')[1], 'base64').toString('utf8')).toBe(card)
  })
})

describe('font size warnings', () => {
  const projWith = (assetIds: string[]): Project => ({
    meta: { schemaVersion: 1, name: 'p', clickUrl: { ios: '', android: '' }, baseW: 1080, baseH: 1920 },
    scenes: [{ id: 's1', name: 's1', kind: 'game', advance: { on: 'manual' }, elements: assetIds.map((id, i) => ({ id: `e${i}`, type: 'image' as const, name: id, x: 0, y: 0, anchor: 'center' as const, zIndex: 0, mode: 'fit' as const, assetId: id })) }],
    startSceneId: 's1',
  })

  it('flags a standalone font asset over the threshold', () => {
    const big = 'data:font/ttf;base64,' + 'A'.repeat(500 * 1024)
    const warns = blurWarnings(projWith([]), { BigFont: { src: big, w: 0, h: 0, kind: 'font' } })
    expect(warns.some((w) => w.includes('BigFont') && w.includes('Subset'))).toBe(true)
  })

  it('flags a large font embedded inside an imported HTML asset', () => {
    const inner = `<style>@font-face{font-family:"X";src:url(data:application/octet-stream;base64,${'B'.repeat(500 * 1024)}) format("truetype");}</style>`
    const html = 'data:text/html;base64,' + btoa(inner)
    const warns = blurWarnings(projWith([]), { endcard: { src: html, w: 0, h: 0, kind: 'html' } })
    expect(warns.some((w) => w.includes('endcard') && w.includes('font'))).toBe(true)
  })

  it('stays quiet for small fonts', () => {
    const warns = blurWarnings(projWith([]), { SmallFont: { src: 'data:font/ttf;base64,' + 'A'.repeat(1024), w: 0, h: 0, kind: 'font' } })
    expect(warns).toEqual([])
  })
})
