// Persistence bridge. Uses the Electron native API (window.editorAPI, exposed by
// preload.cjs) when present; otherwise degrades to browser APIs (localStorage
// autosave + download/upload) so the editor also runs as a plain web app.
//
// Pass 1 stores the whole project (scene + assets-as-data-URLs) in one JSON
// blob. Pass 2 splits this into scene.json + assets.json + an assets/ folder
// and adds the single-file export pipeline.

import type { Project, Scene } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import type { TraceState } from './store'

export interface ProjectData {
  project: Project
  assets: AssetMap
  trace?: TraceState // editor-only trace backdrop (never exported)
}

// Accept current ({project}) and legacy ({scene}) saves; wrap legacy into a
// one-scene project so old files still open.
function migrate(parsed: unknown): ProjectData | null {
  const p = parsed as { project?: Project; scene?: Scene; assets?: AssetMap; trace?: TraceState }
  if (!p || typeof p !== 'object') return null
  const assets = p.assets ?? {}
  if (p.project?.scenes) return { project: p.project, assets, trace: p.trace }
  if (p.scene?.meta) {
    return {
      project: { meta: p.scene.meta, scenes: [{ id: 'scene1', name: 'Scene 1', elements: p.scene.elements ?? [], advance: { on: 'manual' } }], startSceneId: 'scene1' },
      assets,
    }
  }
  return null
}

export interface ApplovinFile {
  name: string
  text?: string // HTML payload (preferred for single-file playables)
  dataUrl?: string // or a base64 data URL (e.g. a zip)
  iteration: string
}
export interface ApplovinUploadOpts {
  url?: string
  files: ApplovinFile[]
  submit?: boolean
  addButtonText?: string
  uploadButtonText?: string
  resultLinkSelector?: string
  resultLinkHrefIncludes?: string
  waitForResultMs?: number
}
export interface ApplovinProbe {
  ok: boolean
  url?: string
  title?: string
  fileInputs?: number
  textInputs?: number
  addButton?: boolean
  uploadButton?: boolean
  error?: string
}

/** ffmpeg knobs passed to the desktop transcode pipeline. */
export interface TranscodeOpts {
  maxWidth?: number // target max width px (scale); never upscales
  crf?: number // x264 CRF 0–51
  maxrate?: string // peak bitrate cap, e.g. '536k'
  bufsize?: string // rate-control buffer, e.g. '1000k'
  audioKbps?: number // audio bitrate kbps
  durationS?: number // trim to N seconds
}

interface NativeAPI {
  saveProject(json: string, currentPath: string | null): Promise<{ ok: boolean; path?: string; error?: string }>
  loadProject(): Promise<{ ok: boolean; json?: string; path?: string; canceled?: boolean }>
  transcodeMedia?(
    dataUrl: string,
    kind: 'video' | 'audio',
    opts?: TranscodeOpts,
  ): Promise<{ ok: boolean; dataUrl?: string; bytes?: number; reencoded?: boolean; error?: string }>
  readRuntimeSrc?(): Promise<{ ok: boolean; src?: string; error?: string }>
  compressHtml?(html: string): Promise<{ ok: boolean; html?: string; bytes?: number; error?: string }>
  captureRect?(rect: { x: number; y: number; width: number; height: number }): Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  applovinOpen?(url: string): Promise<{ ok: boolean; error?: string }>
  applovinProbe?(opts: { url?: string; addButtonText?: string; uploadButtonText?: string }): Promise<ApplovinProbe>
  applovinUpload?(opts: ApplovinUploadOpts): Promise<{ ok: boolean; files?: number; submitted?: boolean; pageUrl?: string; link?: string; error?: string }>
}

const native: NativeAPI | undefined = (window as unknown as { editorAPI?: NativeAPI }).editorAPI
export const hasNative = !!native
export const canTranscode = !!native?.transcodeMedia
export const canApplovin = !!native?.applovinUpload
export const canCapture = !!native?.captureRect

/** Capture a rect of the app window (viewport CSS px) to a PNG data URL.
 * Desktop only — the QA checker uses it to read pixels from the playable
 * iframe, whose data: origin blocks in-renderer canvas readback. */
export async function captureRect(rect: { x: number; y: number; width: number; height: number }): Promise<string | null> {
  if (!native?.captureRect) return null
  try {
    const r = await native.captureRect(rect)
    return r.ok && r.dataUrl ? r.dataUrl : null
  } catch {
    return null
  }
}
export const platformLabel = native ? 'desktop' : 'browser'

/** Open (or focus) the AppLovin upload site in a persistent-session window so the
 * user can log in once. Desktop only. */
export async function applovinOpen(url: string): Promise<boolean> {
  if (!native?.applovinOpen) return false
  const r = await native.applovinOpen(url)
  return !!r.ok
}

/** Probe the open AppLovin page (non-destructive): how many file/text inputs and
 * whether the Add/Upload buttons are found, so selectors can be verified. */
export async function applovinProbe(opts: { url?: string; addButtonText?: string; uploadButtonText?: string }): Promise<ApplovinProbe> {
  if (!native?.applovinProbe) return { ok: false, error: 'desktop app only' }
  return native.applovinProbe(opts)
}

/** Auto-fill the AppLovin batch upload form with the given playables. Desktop
 * only. Returns a status message. */
export async function applovinUpload(opts: ApplovinUploadOpts): Promise<{ ok: boolean; files?: number; submitted?: boolean; pageUrl?: string; link?: string; error?: string }> {
  if (!native?.applovinUpload) return { ok: false, error: 'desktop app only' }
  return native.applovinUpload(opts)
}

/** Post-compress a fully assembled playable HTML string using the
 * scripts/compress-playable.py pipeline (desktop only; requires Python).
 * Returns the compressed HTML or null if Python is unavailable / script fails. */
export async function compressHtmlScript(html: string): Promise<string | null> {
  if (!native?.compressHtml) return null
  try {
    const r = await native.compressHtml(html)
    return r.ok && r.html && r.html.length > 100 ? r.html : null
  } catch {
    return null
  }
}

/** Re-encode a video/audio data URL via the Electron ffmpeg pipeline (desktop
 * only). Returns the (smaller) re-encoded data URL, or null in the browser. */
export async function transcodeMedia(
  dataUrl: string,
  kind: 'video' | 'audio',
  opts?: TranscodeOpts,
): Promise<string | null> {
  if (!native?.transcodeMedia) return null
  try {
    const r = await native.transcodeMedia(dataUrl, kind, opts)
    return r.ok && r.dataUrl ? r.dataUrl : null
  } catch {
    return null
  }
}

const LS_KEY = 'pa:project'

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Robust file picker: the <input> is attached to the DOM (some Chromium contexts
// won't open the dialog for a detached input) and cleaned up afterwards. A focus
// fallback resolves null if the dialog is cancelled, so callers never hang.
function pickFiles(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    let done = false
    const finish = (file: File | null): void => {
      if (done) return
      done = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(file)
    }
    const onFocus = (): void => {
      // dialog closed; give onchange a moment to fire (it wins on a real pick)
      window.setTimeout(() => finish(input.files?.[0] ?? null), 400)
    }
    input.onchange = () => finish(input.files?.[0] ?? null)
    document.body.appendChild(input)
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

function pickFilesMulti(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = true
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    let done = false
    const finish = (files: File[]): void => {
      if (done) return
      done = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(files)
    }
    const onFocus = (): void => {
      window.setTimeout(() => finish(input.files ? Array.from(input.files) : []), 400)
    }
    input.onchange = () => finish(input.files ? Array.from(input.files) : [])
    document.body.appendChild(input)
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

export function readImageFile(file: File): Promise<{ id: string; name: string; src: string; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result ?? '')
      const img = new Image()
      img.onload = () => resolve({ id: file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_'), name: file.name, src, w: img.naturalWidth || 100, h: img.naturalHeight || 100 })
      img.onerror = () => resolve(null)
      img.src = src
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

/** Batch-pick image files into the shared asset library. */
export async function importImages(): Promise<{ id: string; name: string; src: string; w: number; h: number }[]> {
  const files = await pickFilesMulti('image/*')
  const out = await Promise.all(files.map(readImageFile))
  return out.filter((x): x is NonNullable<typeof x> => !!x)
}

function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    void pickFiles('application/json,.json').then((file) => {
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => resolve(null)
      reader.readAsText(file)
    })
  })
}

export async function saveProject(
  data: ProjectData,
  currentPath: string | null,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const json = JSON.stringify(data, null, 2)
  if (native) return native.saveProject(json, currentPath)
  localStorage.setItem(LS_KEY, json)
  download(`${data.project.meta.name || 'project'}.json`, json)
  return { ok: true, path: '(downloaded + localStorage)' }
}

/** Lightweight autosave (browser only; Electron autosaves to the open file). */
export function autosaveLocal(data: ProjectData): void {
  if (native) return
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
  } catch {
    /* quota — ignore */
  }
}

export function restoreLocal(): ProjectData | null {
  if (native) return null
  const raw = localStorage.getItem(LS_KEY)
  if (!raw) return null
  try {
    return migrate(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function loadProject(): Promise<{ data: ProjectData; path: string | null } | null> {
  let json: string | null = null
  let path: string | null = null
  if (native) {
    const r = await native.loadProject()
    if (!r.ok || r.canceled || !r.json) return null
    json = r.json
    path = r.path ?? null
  } else {
    json = await pickFile()
  }
  if (!json) return null
  try {
    const data = migrate(JSON.parse(json))
    return data ? { data, path } : null
  } catch {
    return null
  }
}

/** Pick a built playable (.html or .zip) for round-trip import (see importBuilt.ts). */
export function pickBuiltFile(): Promise<File | null> {
  return pickFiles('.html,.htm,.zip,text/html,application/zip')
}

/** Encode raw HTML markup as a data:text/html;base64 URL (an AssetEntry src).
 * Shared by the embedded-game importer and the built-playable importer. */
export function htmlToDataUrl(text: string): string {
  try {
    return 'data:text/html;base64,' + btoa(unescape(encodeURIComponent(text)))
  } catch {
    return 'data:text/html,' + encodeURIComponent(text)
  }
}

/** Read a user-picked single-file playable (.html) into an AssetEntry (a
 * data:text/html;base64 URL). Used by the embedded-game template. */
export function importHtml(): Promise<{ id: string; name: string; src: string; w: number; h: number; kind: 'html' } | null> {
  return new Promise((resolve) => {
    void pickFiles('.html,text/html').then((file) => {
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = () => {
        const text = String(reader.result ?? '')
        const src = htmlToDataUrl(text)
        resolve({
          id: file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_'),
          name: file.name,
          src,
          w: 0,
          h: 0,
          kind: 'html',
        })
      }
      reader.onerror = () => resolve(null)
      reader.readAsText(file)
    })
  })
}

/** Read a user-picked font file into an AssetEntry (data URL; no dimensions).
 * The asset id becomes the CSS font-family name used in TextConfig.fontFamily. */
export function importFont(): Promise<{ id: string; name: string; src: string; w: number; h: number; kind: 'font' } | null> {
  return new Promise((resolve) => {
    void pickFiles('.ttf,.otf,.woff,.woff2').then((file) => {
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = () => {
        const src = String(reader.result ?? '')
        // Reject anything that isn't font data — the accept filter is advisory
        // and users can bypass it, producing a broken @font-face export.
        const mime = src.slice(5, src.indexOf(';'))
        const ok = mime.startsWith('font/') || mime === 'application/x-font-ttf' ||
          mime === 'application/octet-stream' || mime === ''
        if (!ok) {
          alert(`"${file.name}" doesn't look like a font file (detected: ${mime || 'unknown'}). Please pick a .ttf, .otf, .woff, or .woff2 file.`)
          return resolve(null)
        }
        resolve({
          id: file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_'),
          name: file.name,
          src,
          w: 0,
          h: 0,
          kind: 'font',
        })
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
  })
}

/** Read a user-picked audio file into an AssetEntry (data URL; no dimensions). */
export function importAudio(): Promise<{ id: string; name: string; src: string; w: number; h: number; kind: 'audio' } | null> {
  return new Promise((resolve) => {
    void pickFiles('audio/*').then((file) => {
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = () =>
        resolve({
          id: file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_'),
          name: file.name,
          src: String(reader.result ?? ''),
          w: 0,
          h: 0,
          kind: 'audio',
        })
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
  })
}

/** Read a user-picked video file into an AssetEntry (data URL + intrinsic size). */
export function importVideo(): Promise<{ id: string; name: string; src: string; w: number; h: number; kind: 'video' } | null> {
  return new Promise((resolve) => {
    void pickFiles('video/*').then((file) => {
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = () => {
        const src = String(reader.result ?? '')
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.onloadedmetadata = () =>
          resolve({
            id: file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_'),
            name: file.name,
            src,
            w: v.videoWidth || 1080,
            h: v.videoHeight || 1920,
            kind: 'video',
          })
        v.onerror = () => resolve({ id: file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_'), name: file.name, src, w: 1080, h: 1920, kind: 'video' })
        v.src = src
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
  })
}

/** Read a user-picked image file into an AssetEntry (data URL + intrinsic size). */
export function importImage(): Promise<{ id: string; name: string; src: string; w: number; h: number } | null> {
  return new Promise((resolve) => {
    void pickFiles('image/*').then((file) => {
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = () => {
        const src = String(reader.result ?? '')
        const img = new Image()
        img.onload = () =>
          resolve({
            id: file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_'),
            name: file.name,
            src,
            w: img.naturalWidth || 100,
            h: img.naturalHeight || 100,
          })
        img.onerror = () => resolve(null)
        img.src = src
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
  })
}
