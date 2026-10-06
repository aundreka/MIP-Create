// Does the AppLovin upload automation actually drive an upload form? This runs the
// SAME page scripts the desktop app runs (electron/applovinForm.cjs) against a mock
// upload form in headless Chrome, with the same CDP call for the file inputs — so
// the whole fill -> submit -> read-the-preview-links flow is checked without an
// AppLovin login. What it cannot check is the real site's markup and the login.
//
// Usage: node scripts/applovin-check.mjs        (npm run applovin)
// Browser: PUPPETEER_EXECUTABLE_PATH, else the usual Chrome/Edge paths.

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'

const require = createRequire(import.meta.url)
const { addRowsJs, collectLinksJs, fillNamesJs, probeJs, submitJs } = require('../electron/applovinForm.cjs')

const ADD = 'Add Another Upload'
const UPLOAD = 'Upload'
const PREVIEW_LINK_MARK = 'applovindemo.com/Preview'

const CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

// A stand-in for the AppLovin batch uploader: one row to start, a button that adds
// rows, and an Upload button that prints one preview link per row in the format the
// real page uses (?h=<file stem>_<timestamp>.html&n=<iteration name>).
const FORM_HTML = `<!doctype html><meta charset="utf-8"><title>Mock AppLovin uploader</title>
<body>
<h1>Playable upload</h1>
<div id="rows"></div>
<button type="button" id="add">${ADD}</button>
<button type="button" id="go">${UPLOAD}</button>
<div id="out"></div>
<script>
  var rows = document.getElementById('rows')
  function addRow() {
    var d = document.createElement('div')
    d.innerHTML = '<input type="file"> <input type="text" placeholder="Iteration Name">'
    rows.appendChild(d)
  }
  addRow()
  document.getElementById('add').addEventListener('click', addRow)
  document.getElementById('go').addEventListener('click', function () {
    var out = document.getElementById('out')
    out.innerHTML = ''
    var files = [].slice.call(document.querySelectorAll('input[type=file]'))
    var names = [].slice.call(document.querySelectorAll('input[type=text]'))
    files.forEach(function (f, i) {
      if (!f.files || !f.files[0]) return
      var stem = f.files[0].name.replace(/\\.html?$/i, '')
      var href =
        'http://playable.applovindemo.com/Preview/?&thm=al&h=' + stem + '_17905240' + i +
        '.html&n=' + encodeURIComponent((names[i] && names[i].value) || '')
      var a = document.createElement('a')
      a.href = href
      a.textContent = href
      out.appendChild(a)
      out.appendChild(document.createElement('br'))
    })
  })
</script>`

// A logged-out page: no form at all. The app must report "no upload form found"
// rather than claiming an upload happened.
const LOGIN_HTML = `<!doctype html><meta charset="utf-8"><title>Log In</title>
<body><form><input type="text" name="log"><input type="password" name="pwd"><input type="submit" value="Log In"></form>`

let failures = 0
const ok = (label, pass, detail = '') => {
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${label}${detail ? ' — ' + detail : ''}`)
  if (!pass) failures++
}

function findBrowser() {
  for (const p of CANDIDATES) if (p && existsSync(p)) return p
  return null
}

/** Set each file input from disk, exactly as the app does (JS cannot do this). */
async function setFileInputs(page, paths) {
  const cdp = await page.createCDPSession()
  await cdp.send('DOM.enable')
  const doc = await cdp.send('DOM.getDocument', { depth: -1 })
  const q = await cdp.send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })
  const n = Math.min(paths.length, q.nodeIds.length)
  for (let i = 0; i < n; i++) await cdp.send('DOM.setFileInputFiles', { files: [paths[i]], nodeId: q.nodeIds[i] })
  await cdp.detach()
  return n
}

/** The app's link wait, condensed: new marked links, settled. */
async function waitForLinks(page, baseline, expected, timeoutMs = 10000) {
  const started = Date.now()
  let last = []
  let stableSince = 0
  while (Date.now() - started < timeoutMs) {
    const found = (await page.evaluate(collectLinksJs(PREVIEW_LINK_MARK))).filter((l) => !baseline.has(l))
    if (found.length !== last.length) stableSince = Date.now()
    last = found
    if (found.length >= expected && Date.now() - stableSince >= 300) return found
    await new Promise((r) => setTimeout(r, 100))
  }
  return last
}

async function main() {
  const exe = findBrowser()
  if (!exe) {
    console.error('No Chrome/Edge found. Set PUPPETEER_EXECUTABLE_PATH.')
    process.exit(2)
  }
  const dir = mkdtempSync(join(tmpdir(), 'pa-al-check-'))
  const formPath = join(dir, 'form.html')
  const loginPath = join(dir, 'login.html')
  writeFileSync(formPath, FORM_HTML)
  writeFileSync(loginPath, LOGIN_HTML)

  // The batch under test: a MIP, its variant and a SIP — the mixed upload the
  // Upload modal's ticks produce.
  const files = [
    { name: 'memowrite_acslanot_mip_20260929_07_emily_game_memorymatch_human_none_unique.html', iteration: 'MIP7' },
    { name: 'memowrite_acslanot_mip_20260929_07_emily_game_memorymatch_human_none_unique_hard.html', iteration: 'MIP7 / hard' },
    { name: 'memowrite_acslanot_sip_20260929_07_emily_product_carousel_human_none_unique.html', iteration: 'MIP7 SIP' },
  ]
  const paths = files.map((f) => {
    const p = join(dir, f.name)
    writeFileSync(p, '<!doctype html><title>playable</title>')
    return p
  })

  const browser = await puppeteer.launch({ executablePath: exe, headless: 'shell', args: ['--no-sandbox', '--allow-file-access-from-files'] })
  try {
    const page = await browser.newPage()

    console.log('\nA logged-out page')
    await page.goto('file://' + loginPath)
    const loginProbe = await page.evaluate(probeJs(ADD, UPLOAD))
    ok('finds no file input, so the app can say "log in first"', loginProbe.fileInputs === 0, `fileInputs=${loginProbe.fileInputs}`)
    ok('finds no "Add Another Upload" button', loginProbe.addButton === false)
    const loginRows = await page.evaluate(addRowsJs(files.length, ADD))
    ok('adds no rows and does not hang', loginRows === 0, `rows=${loginRows}`)

    console.log('\nThe upload form')
    await page.goto('file://' + formPath)
    const probe = await page.evaluate(probeJs(ADD, UPLOAD))
    ok('sees the form', probe.fileInputs === 1 && probe.addButton && probe.uploadButton, JSON.stringify(probe))

    const baseline = new Set(await page.evaluate(collectLinksJs('')))
    const rows = await page.evaluate(addRowsJs(files.length, ADD))
    ok(`adds a row per file (${files.length})`, rows === files.length, `rows=${rows}`)

    const setCount = await setFileInputs(page, paths)
    ok('attaches every playable to its row', setCount === files.length, `set=${setCount}`)
    const attached = await page.evaluate(`[...document.querySelectorAll('input[type=file]')].map(function(el){return el.files[0] ? el.files[0].name : ''})`)
    ok('each row holds the file it was given, in order', JSON.stringify(attached) === JSON.stringify(files.map((f) => f.name)), attached.join(', '))

    const filled = await page.evaluate(fillNamesJs(files.map((f) => f.iteration)))
    ok('types an Iteration Name per row', filled === files.length, `filled=${filled}`)
    const typed = await page.evaluate(`[...document.querySelectorAll('input[type=text]')].map(function(el){return el.value})`)
    ok('the names land on the right rows', JSON.stringify(typed) === JSON.stringify(files.map((f) => f.iteration)), typed.join(' | '))

    const submitted = await page.evaluate(submitJs(UPLOAD))
    ok('clicks Upload', submitted === true)

    const links = await waitForLinks(page, baseline, files.length)
    ok(`reads back a preview link per file (${files.length})`, links.length === files.length, `links=${links.length}`)
    // What src/applovinLinks.ts pairs on: ?n= is the iteration, ?h= starts with the file stem.
    for (let i = 0; i < files.length; i++) {
      const u = new URL(links[i] ?? 'http://x/')
      const stem = files[i].name.replace(/\.html?$/i, '')
      ok(
        `link ${i + 1} carries its iteration and file ("${files[i].iteration}")`,
        u.searchParams.get('n') === files[i].iteration && (u.searchParams.get('h') ?? '').startsWith(stem + '_'),
        links[i] ?? 'missing',
      )
    }

    console.log('\nA second upload in the same window')
    const baseline2 = new Set(await page.evaluate(collectLinksJs('')))
    ok('the first upload\u2019s links are the new baseline', baseline2.size >= files.length, `baseline=${baseline2.size}`)
    const after = await waitForLinks(page, baseline2, 1, 800)
    ok('so no stale link is reported as this upload\u2019s result', after.length === 0, `stale=${after.length}`)
  } finally {
    await browser.close()
  }

  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
