// Headless smoke test for exported playables. Assembles the same single-file HTML
// the editor exports (runtime-dist + window.PA_PROJECT/PA_ASSETS), loads it in a
// headless Chrome/Edge, and asserts: no console errors / page errors, the runtime
// mounted (.pa-root), every element rendered, and game/CTA elements are present
// when the project declares them. Writes a screenshot per project for eyeballing.
//
// Usage:
//   node scripts/smoke.mjs                 # built-in minimal fixture
//   node scripts/smoke.mjs path/to/a.json  # one or more saved project files
//   node scripts/smoke.mjs --dir ./mips    # every *.json in a folder
//
// Browser: set PUPPETEER_EXECUTABLE_PATH, else common Chrome/Edge paths are tried.
// Exits non-zero if any project fails — suitable for CI / the contribution gate.

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const RUNTIME = join(ROOT, 'runtime-dist', 'playable-runtime.js')
const OUT = join(HERE, '.smoke')

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

function findBrowser() {
  for (const p of CANDIDATES) if (p && existsSync(p)) return p
  return null
}

const esc = (s) => s.replace(/</g, '\\u003c')
function buildHtml(project, assets, runtimeSrc) {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">` +
    `<title>${esc(project.meta?.name || 'playable')}</title></head><body>` +
    `<script>window.PA_PROJECT=${esc(JSON.stringify(project))};window.PA_ASSETS=${esc(JSON.stringify(assets))};</script>` +
    `<script>${runtimeSrc}</script></body></html>`
  )
}

const FIXTURE = {
  project: {
    meta: { schemaVersion: 1, name: 'smoke-fixture', clickUrl: { ios: 'https://example.com', android: 'https://example.com' }, baseW: 1080, baseH: 1920 },
    scenes: [
      {
        id: 's1',
        name: 'Scene 1',
        kind: 'custom',
        advance: { on: 'manual' },
        elements: [
          { id: 't1', type: 'text', name: 'Title', x: 540, y: 400, anchor: 'center', zIndex: 1, mode: 'fit', text: { value: 'Hello', fontSizePx: 90, fontWeight: 800, color: '#fff', align: 'center' } },
          { id: 'c1', type: 'cta', name: 'CTA', x: 540, y: 1500, w: 700, h: 170, anchor: 'center', zIndex: 2, mode: 'fit', cta: { pulse: 'medium' }, text: { value: 'PLAY', fontSizePx: 60, fontWeight: 800, color: '#fff' }, box: { bgColor: '#16a34a', radiusPx: 80 } },
        ],
      },
    ],
    startSceneId: 's1',
  },
  assets: {},
}

function loadProjectFile(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  // accept either a saved ProjectData ({project, assets}) or a bare Project
  if (raw.project?.scenes) return { project: raw.project, assets: raw.assets ?? {} }
  if (raw.scenes) return { project: raw, assets: raw.assets ?? {} }
  throw new Error('not a project file')
}

function collectTargets(argv) {
  const out = []
  const dirIdx = argv.indexOf('--dir')
  if (dirIdx >= 0 && argv[dirIdx + 1]) {
    const dir = argv[dirIdx + 1]
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) out.push(join(dir, f))
  }
  for (const a of argv) if (a.endsWith('.json')) out.push(a)
  return out
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
  const runtimeSrc = readFileSync(RUNTIME, 'utf8')
  const files = collectTargets(process.argv.slice(2))
  const cases = files.length ? files.map((f) => ({ name: basename(f, '.json'), ...loadProjectFile(f) })) : [{ name: 'fixture', ...FIXTURE }]

  mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
  let failed = 0

  for (const c of cases) {
    const errors = []
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push('console: ' + m.text())
    })
    try {
      await page.setContent(buildHtml(c.project, c.assets, runtimeSrc), { waitUntil: 'load' })
      await page.waitForSelector('.pa-root', { timeout: 5000 })
      await new Promise((r) => setTimeout(r, 600)) // let games mount + a frame settle

      const declared = c.project.scenes[0]?.elements ?? []
      const stats = await page.evaluate(() => ({
        root: !!document.querySelector('.pa-root'),
        els: document.querySelectorAll('.pa-el').length,
        games: document.querySelectorAll('.pa-game').length,
        ctas: document.querySelectorAll('.pa-cta').length,
      }))
      await page.screenshot({ path: join(OUT, c.name + '.png') })

      const problems = [...errors]
      if (!stats.root) problems.push('no .pa-root (runtime did not mount)')
      if (stats.els < declared.length) problems.push(`rendered ${stats.els}/${declared.length} elements`)
      if (declared.some((e) => e.type === 'game-mount') && stats.games === 0) problems.push('declares a game but no .pa-game mounted')
      if (declared.some((e) => e.type === 'cta') && stats.ctas === 0) problems.push('declares a CTA but none rendered')

      if (problems.length) {
        failed++
        console.error(`✗ ${c.name}`)
        for (const p of problems) console.error('   - ' + p)
      } else {
        console.log(`✓ ${c.name} (${stats.els} els, ${stats.games} game, ${stats.ctas} cta) → .smoke/${c.name}.png`)
      }
    } catch (e) {
      failed++
      console.error(`✗ ${c.name}: ${e.message}`)
      for (const er of errors) console.error('   - ' + er)
    } finally {
      await page.close()
    }
  }

  await browser.close()
  console.log(failed ? `\n${failed}/${cases.length} failed` : `\nAll ${cases.length} passed`)
  process.exit(failed ? 1 : 0)
}

run().catch((e) => {
  console.error(e)
  process.exit(2)
})
