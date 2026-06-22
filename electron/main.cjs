// Electron main process. Loads the Vite dev server (VITE_DEV_SERVER_URL) when
// present, otherwise the built renderer. Exposes save/open over IPC so the
// editor's bridge can persist projects to real files (browser-mode falls back
// to download/localStorage). Plain CommonJS — no build step.

const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')

// ffmpeg-static ships a per-platform binary. Under a packaged build it lives in
// app.asar.unpacked (see electron-builder asarUnpack), so rewrite the asar path.
let ffmpegPath = null
try {
  ffmpegPath = require('ffmpeg-static')
  if (ffmpegPath && ffmpegPath.includes('app.asar')) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked')
} catch {
  /* dev without the dep — transcode just no-ops */
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
    const args =
      kind === 'video'
        ? ['-y', '-i', inPath, '-vcodec', 'libx264', '-crf', String(opts.crf ?? 28), '-preset', 'veryfast',
           '-vf', `scale='min(${opts.maxWidth ?? 720},iw)':-2`, '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
           '-acodec', 'aac', '-b:a', (opts.audioKbps ?? 96) + 'k', outPath]
        : ['-y', '-i', inPath, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', (opts.audioKbps ?? 96) + 'k', outPath]
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
ipcMain.handle('net:fetch', async (_e, url) => {
  try {
    const r = await fetch(url)
    const ct = r.headers.get('content-type') || 'application/octet-stream'
    const buf = Buffer.from(await r.arrayBuffer())
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

// ---------------------------------------------------------------------------
// AppLovin auto-upload. Drives the team's WordPress upload page in a real,
// persistent-session BrowserWindow (so login survives) and fills the batch upload
// form: it adds enough rows, sets each file input via the Chrome DevTools Protocol
// (JS can't set file inputs), types each Iteration Name, and optionally submits.
// Selectors are heuristic + overridable since the form is external.
// ---------------------------------------------------------------------------
let alWin = null

function ensureAlWindow(url) {
  if (alWin && !alWin.isDestroyed()) {
    if (url) alWin.webContents.getURL() // keep current page; caller decides nav
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

ipcMain.handle('applovin:upload', async (_e, payload = {}) => {
  try {
    const files = Array.isArray(payload.files) ? payload.files : []
    if (!files.length) return { ok: false, error: 'no files' }
    const w = ensureAlWindow(payload.url)
    const wc = w.webContents
    w.focus()

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
    await wc.executeJavaScript(`(function(){
      function byText(t){ t=t.toLowerCase(); return [...document.querySelectorAll('button,a,input[type=button],input[type=submit]')].find(function(el){return ((el.innerText||el.value||'')+'').trim().toLowerCase().indexOf(t)>=0;}); }
      var target=${paths.length}, guard=0;
      while(document.querySelectorAll('input[type=file]').length < target && guard < 60){ var b=byText(${JSON.stringify(addText)}); if(!b) break; b.click(); guard++; }
      return document.querySelectorAll('input[type=file]').length;
    })()`)
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
    await wc.executeJavaScript(`(function(){
      var names=${JSON.stringify(paths.map((p) => p.iteration))};
      var texts=[...document.querySelectorAll('input[type=text], input:not([type])')].filter(function(el){return el.offsetParent!==null && !el.readOnly;});
      var k=Math.min(names.length, texts.length);
      for(var i=0;i<k;i++){ texts[i].value=names[i]; texts[i].dispatchEvent(new Event('input',{bubbles:true})); texts[i].dispatchEvent(new Event('change',{bubbles:true})); }
      return k;
    })()`)

    // 4) optionally submit
    let submitted = false
    if (payload.submit) {
      submitted = await wc.executeJavaScript(`(function(){
        function byText(t){ t=t.toLowerCase(); return [...document.querySelectorAll('button,a,input[type=button],input[type=submit]')].find(function(el){return ((el.innerText||el.value||'')+'').trim().toLowerCase()===t;}); }
        var b=byText(${JSON.stringify(uploadText)}); if(b){ b.click(); return true; } return false;
      })()`)
    }

    return { ok: true, files: n, submitted }
  } catch (e) {
    return { ok: false, error: String(e) }
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
