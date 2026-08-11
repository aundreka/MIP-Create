// MRAID compliance check for exported playables — the network-facing rules that get a
// creative blocked, verified against the REAL export in headless Chrome:
//
//   1. Nothing calls an MRAID API while the container is still loading. Only getState()
//      and addEventListener('ready') are legal before the ready event.
//   2. The creative still loads and stays interactive when 'ready' never arrives.
//   3. The MRAID 2.0 lifecycle listeners register once ready fires — even on a container
//      that rejects the 3.0-only event names (exposureChange / audioVolumeChange).
//   4. Click-through goes through mraid.open().
//   5. No audio starts before the first user interaction, and it mutes when hidden.
//
// The stub container below is deliberately hostile: it reports MRAID 2.0, throws on the
// 3.0 events, and holds 'loading' past the runtime's ready timeout.
//
// Usage:
//   node scripts/mraid-check.mjs                 # built-in fixture
//   node scripts/mraid-check.mjs path/to/a.json  # a saved project file
//
// Browser: set PUPPETEER_EXECUTABLE_PATH, else common Chrome/Edge paths are tried.
// Exits non-zero on any violation — suitable for CI.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const RUNTIME = join(ROOT, 'runtime-dist', 'playable-runtime.js')

const CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)
const findBrowser = () => CANDIDATES.find((p) => p && existsSync(p)) ?? null

const esc = (s) => s.replace(/</g, '\\u003c')

const FIXTURE = {
  project: {
    meta: {
      schemaVersion: 1, name: 'mraid-check', baseW: 1080, baseH: 1920,
      clickUrl: { ios: 'https://apps.apple.com/app/id123', android: 'https://play.google.com/store/apps/details?id=com.real.app' },
    },
    scenes: [{
      id: 's1', name: 'Scene 1', kind: 'custom', advance: { on: 'manual' },
      elements: [{
        id: 'c1', type: 'cta', name: 'CTA', x: 540, y: 960, w: 700, h: 170,
        anchor: 'center', zIndex: 2, mode: 'fit', cta: {},
        text: { value: 'PLAY', fontSizePx: 60, color: '#fff' },
        box: { bgColor: '#16a34a', radiusPx: 80 },
      }],
    }],
    startSceneId: 's1',
  },
  assets: {},
}

// A hostile MRAID 2.0 container, injected before the runtime exactly like mraid.js.
const STUB = `
window.__mraidCalls = [];
window.__mraidListeners = {};
window.mraid = {
  _state: 'loading',
  getState: function () { window.__mraidCalls.push('getState'); return this._state },
  getVersion: function () { window.__mraidCalls.push('getVersion'); return '2.0' },
  getPlacementType: function () { window.__mraidCalls.push('getPlacementType'); return 'interstitial' },
  isViewable: function () { window.__mraidCalls.push('isViewable'); return true },
  getScreenSize: function () { window.__mraidCalls.push('getScreenSize'); return { width: innerWidth, height: innerHeight } },
  supports: function (f) { window.__mraidCalls.push('supports:' + f); return false },
  expand: function () { window.__mraidCalls.push('expand') },
  close: function () { window.__mraidCalls.push('close') },
  useCustomClose: function () { window.__mraidCalls.push('useCustomClose') },
  open: function (u) { window.__mraidCalls.push('open:' + u) },
  addEventListener: function (e, fn) {
    window.__mraidCalls.push('addEventListener:' + e);
    if (e === 'exposureChange' || e === 'audioVolumeChange') throw new Error('unsupported event: ' + e);
    (window.__mraidListeners[e] = window.__mraidListeners[e] || []).push(fn);
  },
  removeEventListener: function () {},
};
window.__fire = function (e) {
  var a = [].slice.call(arguments, 1);
  (window.__mraidListeners[e] || []).forEach(function (f) { f.apply(null, a) });
};
window.__ready = function () { window.mraid._state = 'default'; window.__fire('ready') };
// Record any audio playback attempt and when it happened relative to the first gesture.
window.__audio = [];
window.__tapped = false;
addEventListener('pointerdown', function () { window.__tapped = true }, true);
(function () {
  var p = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__audio.push({ tapped: window.__tapped, muted: this.muted });
    return p.apply(this, arguments);
  };
})();
`

const buildHtml = (project, assets, runtimeSrc) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">` +
  `<script>${STUB}</script></head><body>` +
  `<script>window.PA_PROJECT=${esc(JSON.stringify(project))};window.PA_ASSETS=${esc(JSON.stringify(assets))};</script>` +
  `<script>${runtimeSrc}</script></body></html>`

/** The only two things a creative may ask of a container that is still loading. */
const PRE_READY_OK = new Set(['getState', 'addEventListener:ready'])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function loadProjectFile(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (raw.project?.scenes) return { project: raw.project, assets: raw.assets ?? {} }
  if (raw.scenes) return { project: raw, assets: raw.assets ?? {} }
  throw new Error('not a project file')
}

async function run() {
  if (!existsSync(RUNTIME)) {
    console.error('✗ runtime-dist/playable-runtime.js missing — run `npm run build:runtime` first.')
    process.exit(2)
  }
  const exe = findBrowser()
  if (!exe) {
    console.error('✗ No Chrome/Edge found. Set PUPPETEER_EXECUTABLE_PATH to a browser executable.')
    process.exit(2)
  }
  const file = process.argv.slice(2).find((a) => a.endsWith('.json'))
  const target = file ? loadProjectFile(file) : FIXTURE
  const runtimeSrc = readFileSync(RUNTIME, 'utf8')

  const problems = []
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844 })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))

  try {
    await page.setContent(buildHtml(target.project, target.assets, runtimeSrc), { waitUntil: 'load' })
    // Past initMraid's ready timeout — 'ready' deliberately never fires in this window.
    await wait(3000)

    // 1. no MRAID API while loading
    const whileLoading = await page.evaluate(() => window.__mraidCalls.slice())
    const illegal = whileLoading.filter((c) => !PRE_READY_OK.has(c))
    if (illegal.length) problems.push(`MRAID API called while loading: ${illegal.join(', ')}`)
    else console.log('✓ no MRAID API touched while the container reported loading')

    // 2. still up and interactive without a ready signal
    const stats = await page.evaluate(() => ({
      root: !!document.querySelector('.pa-root'),
      ctas: document.querySelectorAll('.pa-cta').length,
    }))
    if (!stats.root) problems.push('creative did not mount when ready never fired')
    else console.log('✓ mounted and interactive with no ready signal')

    // 3. a late ready still registers the 2.0 lifecycle listeners
    await page.evaluate(() => window.__ready())
    const listeners = await page.evaluate(() => Object.keys(window.__mraidListeners))
    const missing = ['stateChange', 'viewableChange'].filter((e) => !listeners.includes(e))
    if (missing.length) problems.push(`MRAID 2.0 listeners missing after ready: ${missing.join(', ')}`)
    else console.log('✓ 2.0 lifecycle listeners registered (3.0 rejections did not block them)')

    // 5. audio: nothing may play before the first gesture (checked before the CTA tap,
    //    which is itself the first gesture).
    const preTap = await page.evaluate(() => window.__audio.filter((a) => !a.tapped && !a.muted))
    if (preTap.length) problems.push(`${preTap.length} unmuted audio play(s) before the first interaction`)
    else console.log('✓ no unmuted audio before the first interaction')

    // 4. click-through via mraid.open()
    if (stats.ctas) {
      await page.click('.pa-cta')
      await wait(200)
      const opened = await page.evaluate(() => window.__mraidCalls.filter((c) => c.indexOf('open:') === 0))
      if (!opened.length) problems.push('CTA did not route through mraid.open()')
      else console.log(`✓ CTA routed through mraid.open() → ${opened[0].slice(5)}`)
    }

    // audio must go silent when the container hides the ad
    await page.evaluate(() => window.__fire('viewableChange', false))
    await wait(200)
    const sounding = await page.evaluate(() =>
      Array.from(document.querySelectorAll('audio,video')).filter((m) => !m.paused && !m.muted).length,
    )
    if (sounding) problems.push(`${sounding} media element(s) still audible after viewableChange(false)`)
    else console.log('✓ audio silenced when the ad is not viewable')

    if (errors.length) problems.push('console/page errors:\n  ' + errors.join('\n  '))
    else console.log('✓ no console or page errors')
  } finally {
    await browser.close()
  }

  if (problems.length) {
    console.error('\n✗ ' + problems.join('\n✗ '))
    process.exit(1)
  }
  console.log('\nAll MRAID checks passed')
}

run().catch((e) => {
  console.error('✗ ' + (e?.stack ?? e))
  process.exit(2)
})
