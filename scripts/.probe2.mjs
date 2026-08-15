import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
const ROOT = '/Users/aundreka/MIP-Create'
const runtimeSrc = readFileSync(ROOT + '/runtime-dist/playable-runtime.js', 'utf8')
const { project, assets } = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const esc = (s) => s.replace(/</g, '\\u003c')
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script>window.PA_PROJECT=${esc(JSON.stringify(project))};window.PA_ASSETS=${esc(JSON.stringify(assets))};</script><script>${runtimeSrc}</script></body></html>`
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
const log = []
page.on('pageerror', (e) => log.push('pageerror ' + e))
page.on('framenavigated', (f) => log.push('navigated ' + f.url().slice(0, 40)))
page.on('popup', () => log.push('popup'))
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'load' })
await page.waitForSelector('.pa-game', { timeout: 5000 })
await new Promise((r) => setTimeout(r, 300))
const read = () => page.evaluate(() => Number(document.querySelector('.pa-game > div').dataset.value))
const cta = await page.evaluate(() => { const r = document.querySelector('.pa-cta').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })

// Tap the CTA (the player doesn't leave), then try to keep playing.
await page.mouse.click(cta.x, cta.y)
await new Promise((r) => setTimeout(r, 400))
await page.bringToFront()
await page.mouse.move(195, 120)
await page.mouse.down()
await new Promise((r) => setTimeout(r, 700))
console.log('hold after a CTA tap → v =', await read())
await page.mouse.up()
console.log(log)
await browser.close()
