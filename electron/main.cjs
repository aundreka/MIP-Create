// Electron main process. Loads the Vite dev server (VITE_DEV_SERVER_URL) when
// present, otherwise the built renderer. Exposes save/open over IPC so the
// editor's bridge can persist projects to real files (browser-mode falls back
// to download/localStorage). Plain CommonJS — no build step.

const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
// The JS the upload automation runs inside the upload page (shared with scripts/applovin-check.mjs).
const { addRowsJs, collectLinksJs, fillNamesJs, probeJs, resultJs, submitJs } = require('./applovinForm.cjs')

// ffmpeg-static ships a per-platform binary. Under a packaged build it lives in
// app.asar.unpacked (see electron-builder asarUnpack), so rewrite the asar path.
let ffmpegPath = null
try {
  ffmpegPath = require('ffmpeg-static')
  if (ffmpegPath && ffmpegPath.includes('app.asar')) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked')
} catch {
  /* dev without the dep — transcode just no-ops */
}

// --- SSRF guard for main-process fetches (net:fetch) -----------------------
// net:fetch runs without CORS in the trusted main process, so a renderer-supplied
// URL could otherwise reach internal/loopback services. Allow only http(s) to
// public hosts, re-validate every redirect hop, and cap the response size.
const MAX_FETCH_BYTES = 30 * 1024 * 1024
function isBlockedHost(host) {
  const h = (host || '').toLowerCase()
  if (!h || h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    if (a === 0 || a === 127 || a === 10) return true
    if (a === 169 && b === 254) return true // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}
function validateRemoteUrl(raw) {
  let u
  try {
    u = new URL(String(raw))
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (isBlockedHost(u.hostname)) return null
  return u
}
async function safeRemoteFetch(raw, maxHops = 4) {
  let next = raw
  for (let i = 0; i <= maxHops; i++) {
    const u = validateRemoteUrl(next)
    if (!u) throw new Error('blocked or invalid URL')
    const r = await fetch(u.href, { redirect: 'manual' })
    const loc = r.headers.get('location')
    if (r.status >= 300 && r.status < 400 && loc) {
      next = new URL(loc, u.href).href
      continue
    }
    return r
  }
  throw new Error('too many redirects')
}

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#0e1320',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // The app frame should never navigate away or spawn in-app windows; route any
  // external link to the user's real browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const inApp = devUrl ? url.startsWith(devUrl) : url.startsWith('file://')
    if (!inApp) {
      e.preventDefault()
      if (/^https?:/i.test(url)) void shell.openExternal(url)
    }
  })
}

ipcMain.handle('project:save', async (_e, json, currentPath) => {
  try {
    let target = typeof currentPath === 'string' && currentPath.endsWith('.json') ? currentPath : null
    if (!target) {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: 'project.json',
        filters: [{ name: 'Playable project', extensions: ['json'] }],
      })
      if (r.canceled || !r.filePath) return { ok: false, error: 'canceled' }
      target = r.filePath
    }
    fs.writeFileSync(target, json, 'utf8')
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Write an exported playable directly to the user's Downloads folder. Desktop
// exports replace any same-name file instead of letting Chromium create
// " (1)" duplicates, so repeated deliveries keep a stable path.
ipcMain.handle('export:write', async (_e, payload = {}) => {
  try {
    const raw = String(payload.filename || '').trim()
    const invalidFilenameChars = '<>:"/\\|?*'
    const isInvalidFilenameChar = (char) => invalidFilenameChars.includes(char) || char.charCodeAt(0) <= 31
    const filename = Array.from(path.basename(raw), (char) => (isInvalidFilenameChar(char) ? '_' : char)).join('')
    if (!filename) return { ok: false, error: 'invalid filename' }
    const bytes = payload.bytes
    if (!(bytes instanceof ArrayBuffer)) return { ok: false, error: 'invalid bytes' }
    const target = path.join(app.getPath('downloads'), filename)
    try { fs.rmSync(target, { force: true }) } catch { /* ignore */ }
    fs.writeFileSync(target, Buffer.from(bytes))
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Small secrets (the GitHub token) encrypted with the OS keychain via safeStorage,
// kept in userData/secrets.json as base64 ciphertext. Never plaintext on disk: when
// encryption is unavailable, saving fails instead of silently writing the token out.
const secretsPath = () => path.join(app.getPath('userData'), 'secrets.json')
function readSecrets() {
  try {
    return JSON.parse(fs.readFileSync(secretsPath(), 'utf8')) || {}
  } catch {
    return {}
  }
}
ipcMain.handle('secret:get', (_e, name) => {
  try {
    const enc = readSecrets()[String(name)]
    if (!enc || !safeStorage.isEncryptionAvailable()) return { ok: true, value: '' }
    return { ok: true, value: safeStorage.decryptString(Buffer.from(enc, 'base64')) }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
ipcMain.handle('secret:set', (_e, name, value) => {
  try {
    const all = readSecrets()
    const key = String(name)
    if (!value) delete all[key]
    else {
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'OS keychain encryption is unavailable' }
      all[key] = safeStorage.encryptString(String(value)).toString('base64')
    }
    fs.writeFileSync(secretsPath(), JSON.stringify(all), { mode: 0o600 })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Re-encode a video/audio data URL with ffmpeg to shrink it for the <5MB budget.
// Video → H.264 MP4 (capped width, faststart); audio → mono MP3. Returns the
// smaller of {original, re-encoded}. No-ops (returns the input) without ffmpeg.
function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(',')
  const mime = dataUrl.slice(5, comma).split(';')[0]
  return { buf: Buffer.from(dataUrl.slice(comma + 1), 'base64'), mime }
}
ipcMain.handle('media:transcode', async (_e, dataUrl, kind, opts = {}) => {
  try {
    if (!ffmpegPath) return { ok: false, error: 'ffmpeg unavailable' }
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return { ok: false, error: 'not a data url' }
    const { buf, mime } = decodeDataUrl(dataUrl)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-tc-'))
    const inExt = (mime.split('/')[1] || (kind === 'video' ? 'mp4' : 'mp3')).replace(/[^a-z0-9]/gi, '') || 'bin'
    const inPath = path.join(dir, 'in.' + inExt)
    const outPath = path.join(dir, kind === 'video' ? 'out.mp4' : 'out.mp3')
    fs.writeFileSync(inPath, buf)
    // Sanitize a bitrate so only a safe "<digits><k|M>" reaches ffmpeg.
    const rate = (v) => {
      if (typeof v === 'number' && v > 0) return Math.round(v) + 'k'
      const m = typeof v === 'string' && v.match(/^\s*(\d+(?:\.\d+)?)\s*([kKmM]?)/)
      return m ? m[1] + (m[2] ? m[2].toLowerCase() : 'k') : null
    }
    const dur = Number(opts.durationS) > 0 ? ['-t', String(Number(opts.durationS))] : []
    const crf = String(Math.min(51, Math.max(0, Math.round(Number(opts.crf ?? 28)))))
    const width = Math.max(16, Math.round(Number(opts.maxWidth ?? 720)))
    const aRate = rate(opts.audioKbps) || '96k'
    const maxrate = rate(opts.maxrate)
    const cap = maxrate ? ['-maxrate', maxrate, '-bufsize', rate(opts.bufsize) || maxrate] : []
    const args =
      kind === 'video'
        ? ['-y', '-i', inPath, ...dur, '-vcodec', 'libx264', '-crf', crf, '-preset', 'veryfast',
           '-vf', `scale='min(${width},iw)':-2`, ...cap, '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
           '-acodec', 'aac', '-b:a', aRate, outPath]
        : ['-y', '-i', inPath, ...dur, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', aRate, outPath]
    await new Promise((resolve, reject) =>
      execFile(ffmpegPath, args, { maxBuffer: 1 << 26 }, (err) => (err ? reject(err) : resolve())),
    )
    const outBuf = fs.readFileSync(outPath)
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* */ }
    if (outBuf.length >= buf.length) return { ok: true, dataUrl, bytes: buf.length, reencoded: false }
    const outMime = kind === 'video' ? 'video/mp4' : 'audio/mpeg'
    return { ok: true, dataUrl: `data:${outMime};base64,${outBuf.toString('base64')}`, bytes: outBuf.length, reencoded: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Fetch a remote URL in the main process (no CORS) and return a base64 data URL.
// Guarded against SSRF (public http(s) only, redirects re-validated, size-capped).
ipcMain.handle('net:fetch', async (_e, url) => {
  try {
    const r = await safeRemoteFetch(url)
    const len = Number(r.headers.get('content-length') || 0)
    if (len && len > MAX_FETCH_BYTES) return { ok: false, error: 'response too large' }
    const ct = r.headers.get('content-type') || 'application/octet-stream'
    const ab = await r.arrayBuffer()
    if (ab.byteLength > MAX_FETCH_BYTES) return { ok: false, error: 'response too large' }
    const buf = Buffer.from(ab)
    return { ok: true, dataUrl: `data:${ct};base64,${buf.toString('base64')}` }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('project:load', async () => {
  try {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Playable project', extensions: ['json'] }],
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    const json = fs.readFileSync(r.filePaths[0], 'utf8')
    return { ok: true, json, path: r.filePaths[0] }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Post-compress a playable HTML string using scripts/compress-playable.py.
// Strips fonts, removes unused videos, recompresses WebP, downsamples WAV.
// Returns { ok, html, bytes } on success; { ok: false, error } if Python is
// unavailable or the script fails (caller falls back to the original HTML).
ipcMain.handle('html:compress', async (_e, htmlStr) => {
  try {
    if (typeof htmlStr !== 'string' || htmlStr.length < 100) return { ok: false, error: 'invalid input' }
    const scriptPath = path.join(__dirname, '..', 'scripts', 'compress-playable.py')
    if (!fs.existsSync(scriptPath)) return { ok: false, error: 'compress script not found' }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-cmp-'))
    const inPath = path.join(dir, 'in.html')
    fs.writeFileSync(inPath, htmlStr, 'utf8')
    const outPath = path.join(dir, 'in_compressed.html')
    // Try 'python' first (Windows default), then 'python3' (Linux/macOS).
    const cmds = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']
    let ran = false
    for (const cmd of cmds) {
      try {
        await new Promise((resolve, reject) =>
          execFile(cmd, [scriptPath, inPath, '-o', dir], { timeout: 60000 }, (err) => (err ? reject(err) : resolve()))
        )
        ran = true
        break
      } catch { /* try next */ }
    }
    if (!ran) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} return { ok: false, error: 'Python not available' } }
    if (!fs.existsSync(outPath)) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} return { ok: false, error: 'no output produced' } }
    const result = fs.readFileSync(outPath, 'utf8')
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
    return { ok: true, html: result, bytes: Buffer.byteLength(result, 'utf8') }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// ---------------------------------------------------------------------------
// AppLovin auto-upload. Drives the team's WordPress upload page in a real,
// persistent-session BrowserWindow (so login survives) and fills the batch upload
// form: it adds enough rows, sets each file input via the Chrome DevTools Protocol
// (JS can't set file inputs), types each Iteration Name, and optionally submits.
// Selectors are heuristic + overridable since the form is external.
// ---------------------------------------------------------------------------
let alWin = null
let alOrigin = null
const originOf = (u) => {
  try {
    return new URL(u).origin
  } catch {
    return null
  }
}

function ensureAlWindow(url) {
  if (url) alOrigin = originOf(url) || alOrigin
  if (alWin && !alWin.isDestroyed()) {
    alWin.focus()
    return alWin
  }
  alWin = new BrowserWindow({
    width: 1200,
    height: 860,
    autoHideMenuBar: true,
    title: 'AppLovin upload',
    webPreferences: { partition: 'persist:applovin', contextIsolation: true, nodeIntegration: false },
  })
  alWin.on('closed', () => {
    alWin = null
  })
  // This window is scripted (debugger-attached, file inputs set, JS injected), so
  // pin it to the configured origin — a redirect/compromise can't drive it to an
  // arbitrary site — and never let it open popups.
  alWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const guardNav = (e, navUrl) => {
    const o = originOf(navUrl)
    if (alOrigin && o && o !== alOrigin && navUrl !== 'about:blank') e.preventDefault()
  }
  alWin.webContents.on('will-navigate', guardNav)
  alWin.webContents.on('will-redirect', guardNav)
  if (url) alWin.loadURL(url)
  return alWin
}

ipcMain.handle('applovin:open', async (_e, url) => {
  try {
    const w = ensureAlWindow(url)
    if (url && w.webContents.getURL().indexOf(url) !== 0) await w.loadURL(url)
    w.focus()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Non-destructive: report what the automation can see on the current page so the
// user can confirm the selectors match the form before a real fill.
ipcMain.handle('applovin:probe', async (_e, payload = {}) => {
  try {
    const w = ensureAlWindow(payload.url)
    const wc = w.webContents
    const addText = payload.addButtonText || 'Add Another Upload'
    const uploadText = payload.uploadButtonText || 'Upload'
    const r = await wc.executeJavaScript(probeJs(addText, uploadText))
    return { ok: true, ...r }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Every http(s) URL on the page: anchors, text fields and plain text, in page order.
function collectPageLinks(wc, mark) {
  return wc.executeJavaScript(collectLinksJs(mark))
}
let alBaseline = new Set()

// After the form is filled, wait for the page to print this upload's result links:
// poll the window until `expected` new links containing `mark` show up and hold
// steady for a moment, the window closes, or the timeout passes. The user clicks
// Upload themselves in the meantime (or the fill already submitted).
ipcMain.handle('applovin:waitForLinks', async (_e, payload = {}) => {
  const mark = String(payload.mark || '')
  const expected = Math.max(1, Number(payload.expected) || 1)
  const timeoutMs = Math.max(1000, Math.min(15 * 60000, Number(payload.timeoutMs) || 5 * 60000))
  const started = Date.now()
  let last = []
  let stableSince = 0
  while (Date.now() - started < timeoutMs) {
    if (!alWin || alWin.isDestroyed()) return { ok: true, links: last, closed: true }
    try {
      const found = (await collectPageLinks(alWin.webContents, mark)).filter((l) => !alBaseline.has(l))
      if (found.length !== last.length) stableSince = Date.now()
      last = found
      // Rows can finish one by one; take the set once it has settled.
      if (found.length >= expected && Date.now() - stableSince >= 1500) return { ok: true, links: found }
    } catch {
      /* page mid-navigation; try again */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return { ok: true, links: last, timedOut: true }
})

ipcMain.handle('applovin:upload', async (_e, payload = {}) => {
  try {
    const files = Array.isArray(payload.files) ? payload.files : []
    if (!files.length) return { ok: false, error: 'no files' }
    const w = ensureAlWindow(payload.url)
    const wc = w.webContents
    w.focus()
    // The window is shared by every upload target. When it is still on another
    // target's site, go to this one first instead of filling the wrong form.
    const target = originOf(payload.url)
    if (target && originOf(wc.getURL()) !== target) await w.loadURL(payload.url)
    // Links already on the page (an earlier upload's results) are not this upload's.
    alBaseline = new Set(await collectPageLinks(wc, '').catch(() => []))

    // write the playables to a temp folder for the file inputs
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-al-'))
    const paths = files.map((f) => {
      const safe = String(f.name || 'playable.html').replace(/[^a-z0-9_.-]+/gi, '_')
      const p = path.join(dir, safe)
      if (typeof f.text === 'string') fs.writeFileSync(p, f.text, 'utf8')
      else if (typeof f.dataUrl === 'string') fs.writeFileSync(p, Buffer.from(f.dataUrl.slice(f.dataUrl.indexOf(',') + 1), 'base64'))
      return { path: p, iteration: f.iteration || '' }
    })

    const addText = payload.addButtonText || 'Add Another Upload'
    const uploadText = payload.uploadButtonText || 'Upload'

    // 1) add rows until there are enough file inputs
    await wc.executeJavaScript(addRowsJs(paths.length, addText))
    await new Promise((r) => setTimeout(r, 350))

    // 2) set each file input via CDP (JS cannot set file inputs)
    const dbg = wc.debugger
    try {
      dbg.attach('1.3')
    } catch {
      /* already attached */
    }
    const doc = await dbg.sendCommand('DOM.getDocument', { depth: -1 })
    const q = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })
    const n = Math.min(paths.length, q.nodeIds.length)
    for (let i = 0; i < n; i++) {
      await dbg.sendCommand('DOM.setFileInputFiles', { files: [paths[i].path], nodeId: q.nodeIds[i] })
    }
    try {
      dbg.detach()
    } catch {
      /* */
    }

    // 3) fill the Iteration Name fields (i-th visible text input) + fire events
    await wc.executeJavaScript(fillNamesJs(paths.map((p) => p.iteration)))

    // 4) optionally submit
    let submitted = false
    if (payload.submit) {
      submitted = await wc.executeJavaScript(submitJs(uploadText))
    }

    const waitMs = Math.max(0, Math.min(15000, Number(payload.waitForResultMs) || 0))
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs))
    const result = await wc.executeJavaScript(resultJs(payload.resultLinkSelector, payload.resultLinkHrefIncludes))

    return { ok: true, files: n, submitted, pageUrl: result.pageUrl, link: result.link || undefined }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Read the runtime bundle directly from disk. Bypasses Vite's server-side module
// cache (which never invalidates runtime-dist/ because that dir is watch-ignored),
// so the renderer always gets the latest `npm run build:runtime` output.
ipcMain.handle('runtime:read', () => {
  try {
    const p = path.join(__dirname, '../runtime-dist/playable-runtime.js')
    return { ok: true, src: fs.readFileSync(p, 'utf8') }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Capture a rect of the app window (DIP page coordinates) as a PNG data URL.
// Used by the QA checker to read rendered pixels out of the playable iframe
// (its data: origin is opaque, so canvas readback isn't possible in-renderer).
ipcMain.handle('capture:rect', async (e, rect) => {
  try {
    const r = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    }
    const img = await e.sender.capturePage(r)
    return { ok: true, dataUrl: img.toDataURL() }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
