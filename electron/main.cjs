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

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
