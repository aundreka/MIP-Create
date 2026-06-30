// Single-file export. Assembles a self-contained playable HTML from the scene +
// base64 assets + the pre-bundled runtime (runtime-dist/playable-runtime.js).
// Optionally re-encodes raster images to WebP (in-browser via canvas), enforces
// the 5MB gate, warns about up-scaled (blurry) assets, and produces per-network
// variants (mraid/exitapi injection, zip where required).

import JSZip from 'jszip'
import type { Project } from '../runtime/scene'
import type { AssetMap, CompressProfile } from '../runtime/types'
import { remoteToDataUrl } from './net'
import { transcodeMedia, type TranscodeOpts } from './bridge'

/** Global compression defaults chosen at export time; per-asset `compress`
 * overrides win field-by-field. */
export interface MediaDefaults {
  video?: CompressProfile
  audio?: CompressProfile
}

/** Built-in fallback if the user hasn't touched the controls. Roughly matches a
 * conservative AppLovin-friendly recipe. */
export const DEFAULT_MEDIA: MediaDefaults = {
  video: { scale: 720, crf: 28, audioKbps: 96 },
  audio: { audioKbps: 96 },
}

const toOpts = (p: CompressProfile | undefined): TranscodeOpts => ({
  maxWidth: p?.scale,
  crf: p?.crf,
  maxrate: p?.maxrate,
  bufsize: p?.bufsize,
  audioKbps: p?.audioKbps,
  durationS: p?.durationS,
})
// The runtime as a string, inlined into every export.
// staticRuntimeSrc is frozen by Vite's module cache (runtime-dist/ is excluded
// from the dev-server watcher). Use fetchRuntimeSrc() in export paths to always
// pick up the latest rebuilt version without a page reload.
import staticRuntimeSrc from '../runtime-dist/playable-runtime.js?raw'

export async function fetchRuntimeSrc(): Promise<string> {
  // Desktop: read the file directly via Electron IPC, bypassing Vite's server-side
  // module cache (which never invalidates runtime-dist/ because that dir is
  // watch-ignored and the cached version is stale after `npm run build:runtime`).
  const nativeApi = (window as unknown as { editorAPI?: { readRuntimeSrc?(): Promise<{ ok: boolean; src?: string }> } }).editorAPI
  if (nativeApi?.readRuntimeSrc) {
    try {
      const r = await nativeApi.readRuntimeSrc()
      if (r.ok && typeof r.src === 'string' && r.src.length > 100) return r.src
    } catch { /* fallback */ }
  }
  // Web fallback: timestamp query param forces a fresh read even if Vite caches by path.
  try {
    const r = await fetch(`./runtime-dist/playable-runtime.js?t=${Date.now()}`, { cache: 'no-store' })
    if (r.ok) return await r.text()
  } catch { /* fallback to bundled copy */ }
  return staticRuntimeSrc
}

export const MAX_BYTES = 5 * 1024 * 1024

// Only inline assets actually referenced (element.assetId + game param asset ids)
// so the shared library never bloats the export.
export function pruneAssets(project: Project, assets: AssetMap): AssetMap {
  const used = new Set<string>()
  const add = (v: unknown): void => {
    if (typeof v === 'string' && assets[v]) used.add(v)
  }
  for (const scene of project.scenes)
    for (const el of scene.elements) {
      add(el.assetId)
      if (el.text?.fontFamily) add(el.text.fontFamily)
      if (el.container?.imageId) add(el.container.imageId)
      if (el.generate?.resultId) add(el.generate.resultId)
      if (el.sfx) for (const b of el.sfx) add(b.assetId)
      if (el.game?.params) for (const v of Object.values(el.game.params)) (Array.isArray(v) ? v.forEach(add) : add(v))
      if (el.unboxing) {
        const u = el.unboxing
        add(u.bgAssetId)
        add(u.back?.assetId); add(u.front?.assetId); add(u.top?.assetId)
        add(u.winAssetId); add(u.loseAssetId)
        add(u.revealSyncAssetId)
      }
      if (el.endscene) {
        const esc = el.endscene
        // Only include assets relevant to the active mode — the other mode's
        // assets may still be set from a previous mode switch and would bloat
        // the export with several MB of unused video data.
        if (esc.mode !== 'html') {
          add(esc.portraitVideoId)
          add(esc.landscapeVideoId)
          add(esc.portraitImageId)
          add(esc.landscapeImageId)
        }
        if (esc.mode !== 'video') {
          add(esc.htmlId)
          add(esc.htmlLandscapeId)
        }
      }
    }
  for (const b of project.sfx ?? []) add(b.assetId)
  if (project.bgm) add(project.bgm.assetId)
  const out: AssetMap = {}
  for (const id of used) out[id] = assets[id]
  return out
}

// ---- networks (mirrors coinsort build-all.mjs) ----------------------------
export interface Network {
  name: string
  tag: string
  injectMraid?: boolean
  injectExitApi?: boolean
  vungleFlag?: boolean
  onloadGameReady?: boolean
  zip?: boolean
}
export const NETWORKS: Network[] = [
  { name: 'AppLovin', tag: 'al', injectMraid: true },
  { name: 'ironSource', tag: 'is', injectMraid: true },
  { name: 'Unity', tag: 'un', injectMraid: true },
  { name: 'Google', tag: 'gg', injectExitApi: true, onloadGameReady: true, zip: true },
  { name: 'Facebook', tag: 'fb' },
  { name: 'Mintegral', tag: 'mtg', injectMraid: true, zip: true },
  { name: 'Vungle', tag: 'vu', vungleFlag: true, zip: true },
  { name: 'Moloco', tag: 'mo' },
]

// ---- helpers --------------------------------------------------------------
const esc = (s: string): string => s.replace(/</g, '\\u003c')
const bytesOfStr = (s: string): number => new Blob([s]).size
function dataUrlBytes(src: string): number {
  if (!src.startsWith('data:')) return 0
  const i = src.indexOf(',')
  return Math.floor((src.length - i - 1) * 0.75)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
async function toWebp(src: string, quality: number): Promise<string> {
  const img = await loadImage(src)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  c.getContext('2d')!.drawImage(img, 0, 0)
  return c.toDataURL('image/webp', quality)
}

// WebP encoding off the main thread (OffscreenCanvas in a Worker) so exporting a
// media-heavy project doesn't jank the editor. Falls back to the main-thread
// canvas encode when Workers/OffscreenCanvas are unavailable or a request errors.
let webpWorker: Worker | null = null
let webpInit = false
let webpSeq = 0
const webpPending = new Map<number, { resolve: (s: string) => void; reject: (e: unknown) => void }>()
function getWebpWorker(): Worker | null {
  if (webpInit) return webpWorker
  webpInit = true
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  try {
    const w = new Worker(new URL('./webp.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent): void => {
      const { id, ok, buf, error } = e.data as { id: number; ok: boolean; buf?: ArrayBuffer; error?: string }
      const p = webpPending.get(id)
      if (!p) return
      webpPending.delete(id)
      if (ok && buf) p.resolve('data:image/webp;base64,' + bufToBase64(buf))
      else p.reject(error ?? 'webp worker failed')
    }
    webpWorker = w
  } catch {
    webpWorker = null
  }
  return webpWorker
}
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(s)
}
async function encodeWebp(src: string, quality: number): Promise<string> {
  const w = getWebpWorker()
  if (!w) return toWebp(src, quality)
  try {
    return await new Promise<string>((resolve, reject) => {
      const id = ++webpSeq
      webpPending.set(id, { resolve, reject })
      w.postMessage({ id, src, quality })
    })
  } catch {
    return toWebp(src, quality) // worker errored on this image → main-thread fallback
  }
}
async function ensureDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src
  return (await remoteToDataUrl(src)) ?? src
}

export interface AssetReport {
  id: string
  w: number
  h: number
  bytes: number
  optimized: boolean
  remote: boolean
}

export async function processAssets(
  assets: AssetMap,
  optimize: boolean,
  quality: number,
  media: MediaDefaults = DEFAULT_MEDIA,
): Promise<{ assets: AssetMap; report: AssetReport[] }> {
  const out: AssetMap = {}
  const report: AssetReport[] = []
  for (const [id, a] of Object.entries(assets)) {
    let src = await ensureDataUrl(a.src)
    let optimized = false
    if (optimize && /^data:image\/(png|jpe?g|webp)/i.test(src)) {
      try {
        const before = dataUrlBytes(src)
        const webp = await encodeWebp(src, quality)
        if (dataUrlBytes(webp) < before) {
          src = webp
          optimized = true
        }
      } catch {
        /* keep original */
      }
    } else if (optimize && a.kind === 'video' && /^data:video\//i.test(src)) {
      // per-asset override wins field-by-field over the export default
      const r = await transcodeMedia(src, 'video', toOpts({ ...media.video, ...a.compress }))
      // a duration trim or hard bitrate cap can win even if bytes don't shrink
      const forced = (a.compress?.durationS ?? media.video?.durationS) || a.compress?.maxrate || media.video?.maxrate
      if (r && (dataUrlBytes(r) < dataUrlBytes(src) || forced)) {
        src = r
        optimized = true
      }
    } else if (optimize && a.kind === 'audio' && /^data:audio\//i.test(src)) {
      const r = await transcodeMedia(src, 'audio', toOpts({ ...media.audio, ...a.compress }))
      const forced = (a.compress?.durationS ?? media.audio?.durationS) || false
      if (r && (dataUrlBytes(r) < dataUrlBytes(src) || forced)) {
        src = r
        optimized = true
      }
    } else if (optimize && a.kind === 'html' && src.startsWith('data:text/html;base64,')) {
      try {
        const b64 = src.slice(src.indexOf(',') + 1)
        const binStr = atob(b64)
        const bytes = new Uint8Array(binStr.length)
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
        let inner = new TextDecoder().decode(bytes)
        // Strip base64-embedded @font-face blocks (font-family falls through to next family)
        inner = inner.replace(/@font-face\s*\{[^}]*url\s*\(\s*['"]data:[^'"]+['"]\s*\)[^}]*\}/gs, '')
        // Hoist portrait and landscape videos out of the inner HTML into outer PA_ASSETS.
        // The srcdoc iframe is same-origin, so window.parent.PA_ASSETS is accessible at runtime.
        // This eliminates the double-base64 encoding and saves ~33% of combined video size.
        for (const [varName, suffix] of [['srcPortrait', '__p'], ['srcLandscape', '__l']]) {
          const re = new RegExp(`(const\\s+${varName}\\s*=\\s*)"(data:video/mp4;base64,[^"]+)"`)
          const m = inner.match(re)
          if (!m) continue
          const outerKey = `${id}${suffix}`
          // Transcode the hoisted video via ffmpeg just like outer video assets.
          // Without this they'd be left at their original (uncompressed) size.
          let videoSrc = m[2]
          const transcodedVid = await transcodeMedia(videoSrc, 'video', toOpts(media.video))
          if (transcodedVid && dataUrlBytes(transcodedVid) < dataUrlBytes(videoSrc)) videoSrc = transcodedVid
          // Register in the outer asset map (will be serialised into PA_ASSETS)
          out[outerKey] = { src: videoSrc, w: 0, h: 0, kind: 'video' }
          // Replace the inline constant with a parent reference + empty-string fallback
          const ref = `(window.parent&&window.parent.PA_ASSETS&&window.parent.PA_ASSETS["${outerKey}"])?window.parent.PA_ASSETS["${outerKey}"].src:""`
          inner = inner.replace(m[0], m[1] + ref)
        }
        const newBytes = new TextEncoder().encode(inner)
        if (newBytes.length < bytes.length) {
          src = `data:text/html;base64,${bufToBase64(newBytes.buffer as ArrayBuffer)}`
          optimized = true
        }
      } catch { /* keep original */ }
    }
    out[id] = { src, w: a.w, h: a.h, kind: a.kind } // compress is applied here; not needed at runtime
    report.push({ id, w: a.w, h: a.h, bytes: dataUrlBytes(src), optimized, remote: !src.startsWith('data:') })
  }
  return { assets: out, report }
}

// Quality steps tried in order when the first-pass result is still over budget.
// Video/audio are NOT re-encoded — only images are re-compressed at lower quality.
const AUTO_FIT_STEPS = [0.70, 0.60, 0.50, 0.40, 0.30]

async function recompressImages(processed: AssetMap, raw: AssetMap, quality: number): Promise<AssetMap> {
  const out: AssetMap = {}
  for (const [id, p] of Object.entries(processed)) {
    const r = raw[id]
    if (!r || r.kind === 'video' || r.kind === 'audio') { out[id] = p; continue }
    const src = await ensureDataUrl(r.src)
    if (!/^data:image\/(png|jpe?g|webp)/i.test(src)) { out[id] = p; continue }
    try {
      const webp = await encodeWebp(src, quality)
      out[id] = { ...p, src: dataUrlBytes(webp) < dataUrlBytes(src) ? webp : src }
    } catch { out[id] = p }
  }
  return out
}

/** Like processAssets but auto-lowers image WebP quality in steps until the
 * assembled HTML fits under MAX_BYTES. Video/audio are transcoded only once. */
export async function processAssetsAutoFit(
  rawAssets: AssetMap,
  optimize: boolean,
  quality: number,
  media: MediaDefaults,
  project: Project,
  runtimeSrc: string,
): Promise<{ assets: AssetMap; report: AssetReport[]; quality: number }> {
  const first = await processAssets(rawAssets, optimize, quality, media)
  const checkBytes = (a: AssetMap): number =>
    buildOutputs(project, a, [{ name: 'base', tag: 'base' }], runtimeSrc).baseBytes

  if (!optimize || checkBytes(first.assets) <= MAX_BYTES) return { ...first, quality }

  const makeReport = (processed: AssetMap): AssetReport[] =>
    Object.entries(processed).map(([id, a]) => {
      const r = rawAssets[id]
      return { id, w: a.w, h: a.h, bytes: dataUrlBytes(a.src), optimized: !!r && dataUrlBytes(a.src) < dataUrlBytes(r.src), remote: !a.src.startsWith('data:') }
    })

  for (const q of AUTO_FIT_STEPS) {
    if (q >= quality) continue
    const recomp = await recompressImages(first.assets, rawAssets, q)
    if (checkBytes(recomp) <= MAX_BYTES) return { assets: recomp, report: makeReport(recomp), quality: q }
  }

  // Even at minimum quality it's still over — return the smallest we can produce.
  const minQ = AUTO_FIT_STEPS[AUTO_FIT_STEPS.length - 1]!
  const last = await recompressImages(first.assets, rawAssets, minQ)
  return { assets: last, report: makeReport(last), quality: minQ }
}

/** Warn when an asset's intrinsic width is smaller than the design box it fills. */
export function blurWarnings(project: Project, assets: AssetMap): string[] {
  const warns: string[] = []
  for (const scene of project.scenes)
    for (const el of scene.elements) {
      if (!el.assetId) continue
      const a = assets[el.assetId]
      if (!a) continue
      let targetW: number
      if (el.type === 'background' || (el.type === 'bar' && el.mode === 'extend')) targetW = project.meta.baseW
      else if (el.w != null) targetW = el.w
      else targetW = (el.scale ?? 1) * a.w
      if (a.w < targetW * 0.9) warns.push(`"${el.name}" (${scene.name}) is ${a.w}px but displays ~${Math.round(targetW)}px; may look blurry.`)
    }
  // embedded-playable size: a full Phaser build is ~5MB and won't fit the budget
  for (const scene of project.scenes)
    for (const el of scene.elements) {
      if (el.type !== 'game-mount' || el.game?.templateId !== 'embed') continue
      const id = el.game.params?.html as string | undefined
      const a = id ? assets[id] : undefined
      if (a) {
        const mb = dataUrlBytes(a.src) / 1048576
        if (mb > 3) warns.push(`Embedded game "${el.name}" is ${mb.toFixed(1)}MB; a full playable will likely blow the 5MB export limit. Use a lighter / game-only build.`)
      }
    }
  return warns
}

// ---- html assembly --------------------------------------------------------
export function buildBaseHtml(project: Project, assets: AssetMap, runtimeSrc = staticRuntimeSrc): string {
  // Set background color statically so the html canvas background is correct
  // before JS runs — prevents white flash / edge bleed in Chromium/AppLovin WebViews.
  const bg = project.meta.bgMatchColor ?? '#000000'
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">` +
    `<title>${esc(project.meta.name || 'playable')}</title>` +
    `<style>html,body{margin:0;padding:0;background:${bg}!important;}</style>` +
    `</head><body>` +
    `<script>window.PA_PROJECT=${esc(JSON.stringify(project))};window.PA_ASSETS=${esc(JSON.stringify(assets))};</script>` +
    `<script>${runtimeSrc}</script></body></html>`
  )
}

function injectHead(html: string, tag: string): string {
  return html.replace('</head>', tag + '</head>')
}
export function transformForNetwork(base: string, net: Network): string {
  let html = base
  if (net.injectMraid) html = injectHead(html, '<script src="mraid.js"></script>')
  if (net.injectExitApi) html = injectHead(html, '<script src="exitapi.js"></script>')
  if (net.vungleFlag) html = injectHead(html, '<script>window.__VUNGLE__=true;</script>')
  if (net.onloadGameReady) html = html.replace('<body>', '<body onload="gameReady()">')
  return `<!-- ad-network: ${net.name} | ${net.tag} -->\n${html}`
}

export interface Output {
  net: string
  filename: string
  bytes: number
  over: boolean
  make: () => Promise<Blob>
}

export function buildOutputs(project: Project, assets: AssetMap, networks: Network[], runtimeSrc = staticRuntimeSrc): { outputs: Output[]; baseBytes: number } {
  const base = buildBaseHtml(project, assets, runtimeSrc)
  const baseName = (project.meta.name || 'playable').replace(/[^a-z0-9_-]+/gi, '_')
  const outputs: Output[] = networks.map((net) => {
    const html = transformForNetwork(base, net)
    const htmlBytes = bytesOfStr(html)
    if (net.zip) {
      return {
        net: net.name,
        filename: `${baseName}_${net.tag}.zip`,
        bytes: htmlBytes, // gate on the HTML payload (coinsort behavior)
        over: htmlBytes > MAX_BYTES,
        make: async () => {
          const zip = new JSZip()
          zip.file('index.html', html)
          return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
        },
      }
    }
    return {
      net: net.name,
      filename: `${baseName}_${net.tag}.html`,
      bytes: htmlBytes,
      over: htmlBytes > MAX_BYTES,
      make: async () => new Blob([html], { type: 'text/html' }),
    }
  })
  return { outputs, baseBytes: bytesOfStr(base) }
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export const fmtBytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`)
