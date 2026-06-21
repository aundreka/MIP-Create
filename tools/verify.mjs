// Real-browser verification pass. Drives the *installed* Chrome via puppeteer-core
// (real timeline + real audio decode — no headless virtual-time freeze) to prove:
//   1. MRAID — the exported ad boots under a mock MRAID container, completes the
//      loading→ready handshake, and its CTA calls mraid.open (the install click).
//   2. Audio — nothing plays before a gesture; after a tap, SFX/BGM actually play
//      (HTMLMediaElement.play() is called AND resolves).
//   3. Animation — an entrance animation's opacity genuinely progresses 0→1 over
//      real time (not just the held start frame headless showed).
//
// Run: node tools/verify.mjs   (build the runtime first: npm run build:runtime)

import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '..')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const runtime = fs.readFileSync(path.join(ROOT, 'runtime-dist', 'playable-runtime.js'), 'utf8')

const esc = (s) => s.replace(/</g, '\\u003c')
function playable(project, assets = {}) {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>` +
    `<script>window.PA_PROJECT=${esc(JSON.stringify(project))};window.PA_ASSETS=${esc(JSON.stringify(assets))};</script>` +
    `<script>${runtime}</script></body></html>`
  )
}

// a short audible 440Hz mono 8-bit WAV (data URL) — a real, decodable sound
function toneWav(ms = 220, rate = 8000, freq = 440) {
  const n = Math.floor((rate * ms) / 1000)
  const buf = Buffer.alloc(44 + n)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34)
  buf.write('data', 36); buf.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(110 * Math.sin((2 * Math.PI * freq * i) / rate))
  return 'data:audio/wav;base64,' + buf.toString('base64')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const mark = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? '✅ PASS' : '❌ FAIL'}  ${name} — ${detail}`) }

const META = { schemaVersion: 1, name: 't', clickUrl: { ios: 'https://apps.apple.com/app/id1', android: 'https://play.google.com/store/apps/details?id=x' }, baseW: 1080, baseH: 1920, bgMatchColor: '#101a33' }
const CTA = { id: 'cta', type: 'cta', name: 'CTA', x: 540, y: 1500, anchor: 'center', zIndex: 20, mode: 'fit', w: 600, h: 160, cta: { pulse: 'medium' }, text: { value: 'PLAY NOW', fontSizePx: 66, fontWeight: 800, color: '#fff' }, box: { bgColor: '#16a34a', radiusPx: 80 } }

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--autoplay-policy=document-user-activation-required', '--no-sandbox', '--hide-scrollbars'],
  })
  try {
    // ---------- 1. MRAID harness ----------
    {
      const page = await browser.newPage()
      await page.setViewport({ width: 900, height: 900 })
      await page.goto(pathToFileURL(path.join(DIR, 'mraid-harness.html')).href)
      const html = playable({ ...{ meta: META, startSceneId: 's1', scenes: [{ id: 's1', name: 'g', kind: 'custom', advance: { on: 'manual' }, elements: [CTA] }] } })
      await page.evaluate((h) => window.__loadPlayable(h), html)
      await sleep(1200)
      const present = await page.$eval('#mr', (e) => e.textContent)
      // click the CTA inside the ad iframe
      const adFrame = page.frames().find((f) => f.url().includes('srcdoc') || f.name() === 'ad') || page.frames().find(async (f) => await f.$('.pa-cta'))
      let clicked = false
      for (const f of page.frames()) {
        const has = await f.$('.pa-cta').catch(() => null)
        if (has) { await f.click('.pa-cta').catch(() => {}); clicked = true; break }
      }
      await sleep(300)
      const opens = await page.evaluate(() => (window.__ctaOpens ? window.__ctaOpens() : 0))
      mark('MRAID boot + ready handshake', /ready/.test(present), `#mr = "${present}"`)
      mark('MRAID CTA → mraid.open()', clicked && opens > 0, `cta clicked=${clicked}, opens=${opens}`)
      await page.close()
    }

    // ---------- 2. Audio (gesture unlock + actually plays) ----------
    {
      const page = await browser.newPage()
      await page.setViewport({ width: 380, height: 760 })
      await page.evaluateOnNewDocument(() => {
        window.__audio = { plays: 0, resolved: 0, rejected: 0 }
        const orig = HTMLMediaElement.prototype.play
        HTMLMediaElement.prototype.play = function () {
          window.__audio.plays++
          const p = orig.apply(this, arguments)
          if (p && p.then) p.then(() => window.__audio.resolved++, () => window.__audio.rejected++)
          return p
        }
        window.open = () => null // swallow the CTA navigation
      })
      const beep = toneWav()
      const proj = {
        meta: META, startSceneId: 's1',
        sfx: [{ event: 'ctaClick', assetId: 'beep' }],
        bgm: { assetId: 'beep', volume: 0.5 },
        scenes: [{ id: 's1', name: 'g', kind: 'custom', advance: { on: 'manual' }, elements: [CTA] }],
      }
      await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(playable(proj, { beep: { src: beep, w: 0, h: 0, kind: 'audio' } })))
      await sleep(900) // boot
      const before = await page.evaluate(() => window.__audio.plays)
      // a real trusted tap → unlocks audio + fires ctaClick
      await page.click('.pa-cta').catch(() => {})
      await sleep(500)
      const after = await page.evaluate(() => window.__audio)
      mark('Audio silent before gesture', before === 0, `play() calls before tap = ${before}`)
      mark('Audio plays after tap', after.plays > 0 && after.resolved > 0 && after.rejected === 0, `plays=${after.plays} resolved=${after.resolved} rejected=${after.rejected}`)
      await page.close()
    }

    // ---------- 3. Animation (opacity progresses 0→1 over real time) ----------
    {
      const page = await browser.newPage()
      await page.setViewport({ width: 380, height: 760 })
      const proj = {
        meta: META, startSceneId: 's1',
        scenes: [{ id: 's1', name: 'g', kind: 'custom', advance: { on: 'manual' }, elements: [
          { id: 'b', type: 'text', name: 'b', x: 540, y: 900, anchor: 'center', zIndex: 5, mode: 'fit', text: { value: 'HELLO', fontSizePx: 130, fontWeight: 800, color: '#ffd166', align: 'center' },
            animations: { entrance: { preset: 'fade', durationMs: 2000, delayMs: 0, easing: 'linear', trigger: 'onMount' } } },
        ] }],
      }
      await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(playable(proj)))
      const op = async () => Number(await page.evaluate(() => {
        const n = document.querySelector('.pa-el[data-id="b"] .pa-el-anim')
        return n ? getComputedStyle(n).opacity : '1'
      }))
      await sleep(800) // boot + entrance starts
      const a = await op()
      await page.screenshot({ path: path.join(DIR, '_anim_mid.png') })
      await sleep(1600) // let it finish
      const b = await op()
      mark('Animation progresses (mid < end)', a < 0.9 && b > 0.9 && b > a, `opacity mid=${a.toFixed(2)} → end=${b.toFixed(2)} (mid screenshot: tools/_anim_mid.png)`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  const passed = results.filter((r) => r.pass).length
  console.log(`\n${passed}/${results.length} checks passed.`)
  process.exit(passed === results.length ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(2) })
