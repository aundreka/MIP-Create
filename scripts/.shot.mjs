import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files'] })
const p = await b.newPage()
await p.setViewport({ width: 320, height: 1100, deviceScaleFactor: 2 })
await p.goto('file://' + resolve(process.argv[2]), { waitUntil: 'networkidle2' })
await p.screenshot({ path: process.argv[3], fullPage: true })
const over = await p.evaluate(() => {
  const bad = []
  for (const r of document.querySelectorAll('.combo-slot')) {
    const rr = r.getBoundingClientRect()
    if (rr.right > 280.5) bad.push([r.querySelector('span').textContent, Math.round(rr.right)])
    for (const c of r.children) { const cr = c.getBoundingClientRect(); if (cr.width < 1) bad.push([r.querySelector('span').textContent + ' child collapsed', c.className]) }
  }
  return { overflow: bad, rowHeight: Math.round(document.querySelector('.combo-slot').getBoundingClientRect().height), panelHeight: Math.round(document.body.scrollHeight) }
})
console.log(JSON.stringify(over))
await b.close()
