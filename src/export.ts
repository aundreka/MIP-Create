// Single-file export. Assembles a self-contained playable HTML from the scene +
// base64 assets + the pre-bundled runtime (runtime-dist/playable-runtime.js).
// Optionally re-encodes raster images to WebP (in-browser via canvas), enforces
// the 5MB gate, warns about up-scaled (blurry) assets, and produces per-network
// variants (mraid/exitapi injection, zip where required).

import JSZip from 'jszip'
import type { EndsceneConfig, Project, SceneDef } from '../runtime/scene'
import type { AssetMap, CompressProfile } from '../runtime/types'
import { remoteToDataUrl } from './net'
import { appAlert } from './panels/AppDialogs'
import { canTranscode, transcodeMedia, type TranscodeOpts } from './bridge'
import * as Shell from './exportShell.generated'
import { isSip } from './mipName'

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
    } catch {
      /* fallback */
    }
  }
  // Web fallback: timestamp query param forces a fresh read even if Vite caches by path.
  try {
    const r = await fetch(`./runtime-dist/playable-runtime.js?t=${Date.now()}`, { cache: 'no-store' })
    if (r.ok) return await r.text()
  } catch {
    /* fallback to bundled copy */
  }
  return staticRuntimeSrc
}

export const MAX_BYTES = 5 * 1024 * 1024

/** The asset-id fields an endscene config actually uses, as [field, id] pairs.
 * Only the ACTIVE mode's fields: the other mode's ids may still be set from a
 * previous mode switch, and inlining those would add several MB of video nothing
 * plays. Shared by the collection walk (pruneAssets) and the base64 verification
 * (endsceneAssetFindings) so the two can never disagree about what ships. */
export function endsceneAssetFields(cfg: EndsceneConfig): [field: string, id: string][] {
  const out: [string, string][] = []
  const add = (field: string, id: string | undefined): void => {
    if (id) out.push([field, id])
  }
  // Mode is read exactly as the runtime reads it (createEndsceneContent: `mode === 'html'`,
  // video otherwise). The old test here was `mode !== 'video'`, which treats an UNSET mode
  // as possibly-html and shipped a stale card from an earlier mode switch — dead weight
  // the runtime never renders, and a false "endscene not base64" finding on an asset
  // nothing plays.
  if (cfg.mode === 'html') {
    add('htmlId', cfg.htmlId)
    add('htmlLandscapeId', cfg.htmlLandscapeId)
  } else {
    add('portraitVideoId', cfg.portraitVideoId)
    add('landscapeVideoId', cfg.landscapeVideoId)
    add('portraitImageId', cfg.portraitImageId)
    add('landscapeImageId', cfg.landscapeImageId)
  }
  return out
}

// Collect the asset ids a single scene references into `used`. `audio` includes
// per-element sound bindings (needed for a real export); the editor's static
// frames/thumbnails pass false since a non-interactive render never plays audio.
function addSceneAssets(scene: SceneDef, assets: AssetMap, used: Set<string>, audio: boolean): void {
  const add = (v: unknown): void => {
    if (typeof v === 'string' && assets[v]) used.add(v)
  }
  const addNested = (value: unknown, seen = new Set<unknown>()): void => {
    if (typeof value === 'string') {
      add(value)
      return
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) value.forEach((item) => addNested(item, seen))
    else Object.values(value as Record<string, unknown>).forEach((item) => addNested(item, seen))
  }
  for (const override of Object.values(scene.localeOverrides ?? {})) addSceneAssets(override.source, assets, used, audio)
  for (const el of scene.elements) {
    add(el.assetId)
    for (const override of Object.values(el.localeOverrides ?? {})) {
      add(override.assetId)
      addNested(override.source)
    }
    if (el.background?.landscapeAssetId) add(el.background.landscapeAssetId)
    if (el.text?.fontFamily) add(el.text.fontFamily)
    if (el.container?.imageId) add(el.container.imageId)
    if (el.button?.tapFadeAssetId) add(el.button.tapFadeAssetId)
    if (el.generate?.resultId) add(el.generate.resultId)
    // Nested: random reveals are arrays of { image, text, ... } objects, not bare ids.
    if (el.game?.params) addNested(el.game.params)
    if (el.unboxing) {
      const u = el.unboxing
      add(u.bgAssetId)
      add(u.back?.assetId)
      add(u.front?.assetId)
      add(u.top?.assetId)
      add(u.winAssetId)
      add(u.loseAssetId)
      add(u.revealSyncAssetId)
    }
    if (el.endscene) for (const [, id] of endsceneAssetFields(el.endscene)) add(id)
    if (audio && el.sfx) for (const b of el.sfx) add(b.assetId)
  }
}

/** The raw bytes behind a `data:text/html` URL, base64- or percent-encoded, or null
 * when it is neither. The caller decodes them as UTF-8; atob alone would mangle any
 * non-ASCII glyph in an end card's copy. */
function decodeHtmlDataUrl(src: string): Uint8Array | null {
  if (!src.startsWith('data:text/html')) return null
  const comma = src.indexOf(',')
  if (comma < 0) return null
  const body = src.slice(comma + 1)
  if (/;base64/i.test(src.slice(0, comma))) {
    try {
      const bin = atob(body)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    } catch {
      return null
    }
  }
  // Percent-encoded: each %XX is one byte, everything else is its own ASCII byte.
  const out: number[] = []
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '%' && i + 2 < body.length) {
      const b = parseInt(body.slice(i + 1, i + 3), 16)
      if (!Number.isNaN(b)) {
        out.push(b)
        i += 2
        continue
      }
    }
    out.push(body.charCodeAt(i) & 0xff)
  }
  return new Uint8Array(out)
}

/** The decoded markup of an inlined HTML asset (an imported end card), or '' for
 * anything else. atob's latin1 output is fine here: every caller only substring-matches
 * ASCII (asset ids, `data:` prefixes). */
function innerHtmlText(src: string | undefined): string {
  if (!src || !src.startsWith('data:text/html')) return ''
  const comma = src.indexOf(',')
  if (comma < 0) return ''
  const body = src.slice(comma + 1)
  if (!/;base64/i.test(src.slice(0, comma))) {
    try {
      return decodeURIComponent(body)
    } catch {
      return body
    }
  }
  try {
    return atob(body)
  } catch {
    return ''
  }
}

// Asset ids an HTML end card reads out of the HOST at runtime: export hoists the card's
// portrait/landscape clip into PA_ASSETS["<htmlId>__p" / "__l"] and rewrites the card to
// read window.parent.PA_ASSETS (see processAssets).
const PARENT_ASSET_REF = /PA_ASSETS\s*\[\s*["']([^"']+)["']\s*\]/g

/** The PA_ASSETS ids referenced from inside an inlined HTML asset. */
export function parentAssetRefs(src: string | undefined): string[] {
  const inner = innerHtmlText(src)
  if (!inner) return []
  return [...inner.matchAll(PARENT_ASSET_REF)].map((m) => m[1])
}

// Only inline assets actually referenced (element.assetId + game param asset ids)
// so the shared library never bloats the export.
export function pruneAssets(project: Project, assets: AssetMap): AssetMap {
  const used = new Set<string>()
  const add = (v: unknown): void => {
    if (typeof v === 'string' && assets[v]) used.add(v)
  }
  for (const scene of project.scenes) addSceneAssets(scene, assets, used, true)
  for (const b of project.sfx ?? []) add(b.assetId)
  if (project.bgm) add(project.bgm.assetId)
  // The pinned header can use an uploaded font (meta.header.fontFamily = font
  // asset id) without any element referencing it.
  if (project.meta.header?.fontFamily) add(project.meta.header.fontFamily)
  for (const header of Object.values(project.meta.headerI18n ?? {})) add(header.fontFamily)
  // An end card reaches BACK into the host for its own clip: nothing in the project points
  // at the hoisted "<htmlId>__p" / "__l" video, only the card's markup does. Walking
  // elements alone therefore drops it, and the card ships as a bare background with a dead
  // <video> — invisible in the editor (no PA_ASSETS to read there) and only visible in the
  // delivered file. Bites every re-export of a project recovered from a build, which keeps
  // the already-rewritten card AND the hoisted clip. compress-playable.py guards the same way.
  for (const id of [...used]) for (const ref of parentAssetRefs(assets[id]?.src)) add(ref)
  const out: AssetMap = {}
  for (const id of used) out[id] = assets[id]
  return out
}

// The (visual-only) asset ids one scene references. The editor renders every scene
// in its own iframe (canvas frames + thumbnails); sending each iframe just its own
// scene's assets — instead of the whole library — keeps N iframes from each holding
// a full decoded copy of every image/video, the main out-of-memory cause.
export function sceneAssetIds(scene: SceneDef, assets: AssetMap): string[] {
  const used = new Set<string>()
  addSceneAssets(scene, assets, used, false)
  return [...used]
}

/** The subset of `assets` a single scene references (visual only). */
export function sceneAssets(scene: SceneDef, assets: AssetMap): AssetMap {
  const out: AssetMap = {}
  for (const id of sceneAssetIds(scene, assets)) out[id] = assets[id]
  return out
}

// ---- networks (mirrors coinsort build-all.mjs) ----------------------------
// MRAID is no longer a per-network flag — every export carries the bridge + guard
// (MRAID_HEAD), so only the network-SPECIFIC extras stay here.
export interface Network {
  name: string
  tag: string
  injectExitApi?: boolean
  vungleFlag?: boolean
  onloadGameReady?: boolean
  zip?: boolean
}
export const NETWORKS: Network[] = [
  { name: 'AppLovin', tag: 'al' },
  { name: 'ironSource', tag: 'is' },
  { name: 'Unity', tag: 'un' },
  { name: 'Google', tag: 'gg', injectExitApi: true, onloadGameReady: true, zip: true },
  { name: 'Facebook', tag: 'fb' },
  { name: 'Mintegral', tag: 'mtg', zip: true },
  { name: 'Vungle', tag: 'vu', vungleFlag: true, zip: true },
  { name: 'Moloco', tag: 'mo' },
]

// ---- helpers --------------------------------------------------------------
const esc = (s: string): string => s.replace(/</g, '\\u003c')
// Vite's dev server appends an INLINE SOURCE MAP (~1MB) when the runtime is fetched
// through it (web/dev exports) — pure dead weight in a shipped playable that once
// pushed a real export past the 5MB gate on its own. Stripped at the assembly choke
// point so every export path AND every size measurement sees the real payload.
export const stripSourceMap = (js: string): string => js.replace(/\/\/# sourceMappingURL=\S+/g, '')
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
// Browser fallback for when the desktop ffmpeg pipeline is unavailable (web editor /
// dev): uncompressed WAVs are the one audio format pure JS can still shrink. Decode
// via WebAudio and re-encode as mono 16-bit PCM at ≤22.05kHz — plenty for SFX and
// typically 4–8× smaller than a stereo 44.1kHz source, while staying a WAV so
// playback support is unchanged (no browser-side MP3/AAC encoder exists).
async function compressWavInBrowser(src: string): Promise<string | null> {
  if (!/^data:audio\/(x-)?wav/i.test(src)) return null
  try {
    const AC = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC || typeof OfflineAudioContext === 'undefined') return null
    const buf = await (await fetch(src)).arrayBuffer()
    const probe = new AC()
    const decoded = await probe.decodeAudioData(buf)
    void probe.close()
    const rate = Math.min(22050, decoded.sampleRate)
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate)
    const node = off.createBufferSource()
    node.buffer = decoded
    node.connect(off.destination)
    node.start()
    const pcm = (await off.startRendering()).getChannelData(0)
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2))
    const wstr = (o: number, str: string): void => {
      for (let i = 0; i < str.length; i++) out.setUint8(o + i, str.charCodeAt(i))
    }
    wstr(0, 'RIFF')
    out.setUint32(4, 36 + pcm.length * 2, true)
    wstr(8, 'WAVE')
    wstr(12, 'fmt ')
    out.setUint32(16, 16, true)
    out.setUint16(20, 1, true)
    out.setUint16(22, 1, true)
    out.setUint32(24, rate, true)
    out.setUint32(28, rate * 2, true)
    out.setUint16(32, 2, true)
    out.setUint16(34, 16, true)
    wstr(36, 'data')
    out.setUint32(40, pcm.length * 2, true)
    for (let i = 0; i < pcm.length; i++) {
      const v = Math.max(-1, Math.min(1, pcm[i]))
      out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
    }
    return 'data:audio/wav;base64,' + bufToBase64(out.buffer)
  } catch {
    return null
  }
}

async function ensureDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src
  return (await remoteToDataUrl(src)) ?? src
}

// The bridge belongs in the top-level document, exactly once (see MRAID_HEAD). An
// endscene card authored as its own playable carries a copy, which then rides into the
// srcdoc iframe — a second declaration inside generated markup, which is the shape
// network validators flag. It cannot load there in any case: a relative src on an
// about:srcdoc document has no base URL to resolve against. The card's clickout still
// reaches the container, through the endscene postMessage shim.
const INNER_MRAID_BRIDGE_RE = /[ \t]*<script\b[^>]*\bsrc\s*=\s*["']mraid\.js["'][^>]*>\s*<\/script>[ \t]*\n?/gi

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
      } else if (!r) {
        // No ffmpeg (browser / dev) — uncompressed WAVs used to ship at full size
        // (a 500KB SFX in one real export). Shrink them with the WebAudio fallback.
        const w = await compressWavInBrowser(src)
        if (w && dataUrlBytes(w) < dataUrlBytes(src)) {
          src = w
          optimized = true
        }
      }
    } else if (a.kind === 'html' && src.startsWith('data:text/html')) {
      try {
        // An HTML end card can arrive PERCENT-encoded (`data:text/html,<html>…`) rather
        // than base64 — a hand-written asset, or anything that round-tripped through a
        // URL-encoding tool. Both encodings are decoded here and the card is always
        // re-emitted as base64: percent-encoding an end card's inline mp4 costs ~3 bytes
        // per byte against the 5MB budget, and the branch below (bridge strip, font
        // strip, clip hoist) used to skip those cards entirely.
        const wasBase64 = /^data:text\/html[^,]*;base64,/i.test(src)
        const bytes = decodeHtmlDataUrl(src)
        if (!bytes) throw new Error('undecodable HTML asset')
        let inner = new TextDecoder().decode(bytes)
        // Runs whether or not `optimize` is set: a duplicate bridge blocks delivery.
        inner = inner.replace(INNER_MRAID_BRIDGE_RE, '')
        // Strip base64-embedded @font-face blocks — but ONLY when the font isn't
        // referenced by any element. A used custom font can carry layout-critical
        // glyph metrics (e.g. an end-card countdown whose digit groups are spaced
        // to land inside fixed boxes); dropping it reflows the text to a system
        // fallback and breaks the layout. Truly-unused embedded fonts are dead
        // weight and still get stripped.
        const FONT_FACE_RE = /@font-face\s*\{[^}]*url\s*\(\s*['"]data:[^'"]+['"]\s*\)[^}]*\}/gs
        const withoutFonts = optimize ? inner.replace(FONT_FACE_RE, '') : ''
        if (optimize)
          inner = inner.replace(FONT_FACE_RE, (block) => {
            const fam = /font-family\s*:\s*(['"]?)([^;'"}]+)\1/i.exec(block)?.[2]?.trim()
            return fam && withoutFonts.includes(fam) ? block : ''
          })
        // Hoist portrait and landscape videos out of the inner HTML into outer PA_ASSETS.
        // The srcdoc iframe is same-origin, so window.parent.PA_ASSETS is accessible at runtime.
        // This eliminates the double-base64 encoding and saves ~33% of combined video size.
        for (const [varName, suffix] of optimize
          ? [
              ['srcPortrait', '__p'],
              ['srcLandscape', '__l'],
            ]
          : []) {
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
        // A percent-encoded card is re-encoded unconditionally: even when the markup is
        // untouched, base64 is the smaller wire form and the only one every consumer of
        // these assets (preflight, compress-playable.py, the hoist regex) expects.
        if (!wasBase64 || newBytes.length < bytes.length) {
          src = `data:text/html;base64,${bufToBase64(newBytes.buffer as ArrayBuffer)}`
          optimized = true
        }
      } catch {
        /* keep original */
      }
    }
    out[id] = { src, w: a.w, h: a.h, kind: a.kind } // compress is applied here; not needed at runtime
    report.push({ id, w: a.w, h: a.h, bytes: dataUrlBytes(src), optimized, remote: !src.startsWith('data:') })
  }
  return { assets: out, report }
}

// Quality steps tried in order when the first-pass result is still over budget.
// Images are re-compressed first (cheap); if that can't reach the budget, the
// video/audio encoding itself steps down (desktop ffmpeg only — see MEDIA_STEPS).
const AUTO_FIT_STEPS = [0.7, 0.6, 0.5, 0.4, 0.3]

// Last-resort media ladders: progressively smaller/rougher video + thinner audio.
// Only used when the image ladder alone can't fit the budget, and only where the
// ffmpeg pipeline exists (desktop). Per-asset `compress` overrides still win.
const MEDIA_STEPS: MediaDefaults[] = [
  { video: { scale: 640, crf: 32, audioKbps: 72 }, audio: { audioKbps: 72 } },
  { video: { scale: 540, crf: 36, audioKbps: 56 }, audio: { audioKbps: 56 } },
  { video: { scale: 480, crf: 40, audioKbps: 48 }, audio: { audioKbps: 48 } },
]

async function recompressImages(processed: AssetMap, raw: AssetMap, quality: number): Promise<AssetMap> {
  const out: AssetMap = {}
  for (const [id, p] of Object.entries(processed)) {
    const r = raw[id]
    if (!r || r.kind === 'video' || r.kind === 'audio') {
      out[id] = p
      continue
    }
    const src = await ensureDataUrl(r.src)
    if (!/^data:image\/(png|jpe?g|webp)/i.test(src)) {
      out[id] = p
      continue
    }
    try {
      const webp = await encodeWebp(src, quality)
      out[id] = { ...p, src: dataUrlBytes(webp) < dataUrlBytes(src) ? webp : src }
    } catch {
      out[id] = p
    }
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
  const checkBytes = (a: AssetMap): number => buildOutputs(project, a, [{ name: 'base', tag: 'base' }], runtimeSrc).baseBytes

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

  // Images alone can't reach the budget — the overage is in video/audio. Step the
  // media encoding down (desktop ffmpeg only): each rung re-transcodes, first with
  // the requested image quality (media may be the whole problem), then squeezed to
  // the minimum image quality before giving up on the rung.
  const minQ = AUTO_FIT_STEPS[AUTO_FIT_STEPS.length - 1]!
  let best = await recompressImages(first.assets, rawAssets, minQ)
  let bestBytes = checkBytes(best)
  let bestQ = minQ
  if (canTranscode && bestBytes > MAX_BYTES) {
    for (const step of MEDIA_STEPS) {
      const attempt = await processAssets(rawAssets, optimize, quality, step)
      let a = attempt.assets
      let q = quality
      let bytes = checkBytes(a)
      if (bytes > MAX_BYTES) {
        a = await recompressImages(a, rawAssets, minQ)
        q = minQ
        bytes = checkBytes(a)
      }
      if (bytes <= MAX_BYTES) return { assets: a, report: makeReport(a), quality: q }
      if (bytes < bestBytes) {
        best = a
        bestBytes = bytes
        bestQ = q
      }
    }
  }

  // Still over even at the bottom of both ladders — return the smallest produced.
  return { assets: best, report: makeReport(best), quality: bestQ }
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
  // Oversized fonts: a full TTF can be ~1MB — a huge slice of the 5MB budget for a
  // handful of glyphs. Flags standalone font assets AND fonts embedded inside
  // imported HTML (endcards) — the exporter intentionally keeps USED embedded fonts
  // (their metrics are layout-critical), so shrinking them is on the author.
  const FONT_WARN = 300 * 1024
  const fontMb = (b: number): string => (b / 1048576).toFixed(1)
  for (const [id, a] of Object.entries(assets)) {
    if (a.kind === 'font') {
      const b = dataUrlBytes(a.src)
      if (b > FONT_WARN) warns.push(`Font "${id}" is ${fontMb(b)}MB. Subset it to the characters actually used, or convert it to WOFF2 — full TTFs eat the 5MB budget.`)
    } else if (a.kind === 'html' && a.src.startsWith('data:text/html;base64,')) {
      try {
        const inner = atob(a.src.slice(a.src.indexOf(',') + 1))
        const re = /data:(?:font\/[\w+-]+|application\/(?:octet-stream|x-font[\w-]*|font-[\w-]+));base64,([A-Za-z0-9+/=]+)/g
        let m: RegExpExecArray | null
        while ((m = re.exec(inner))) {
          const b = Math.floor(m[1].length * 0.75)
          if (b > FONT_WARN)
            warns.push(
              `Embedded HTML "${id}" carries a ${fontMb(b)}MB font. Subset/convert it (WOFF2) in the source HTML — it can't be auto-compressed without breaking its layout.`,
            )
        }
      } catch {
        /* undecodable — skip */
      }
    }
  }
  // An HTML end card whose clip was hoisted into PA_ASSETS reads it back through
  // window.parent.PA_ASSETS — with `""` as the fallback, so a missing entry ships a card
  // that shows nothing but its background colour, silently and forever. It cannot be
  // spotted in the editor either (the preview frame has no PA_ASSETS to read), so this is
  // the only place it surfaces before delivery.
  for (const [id, a] of Object.entries(assets))
    for (const ref of new Set(parentAssetRefs(a.src)))
      if (!assets[ref])
        warns.push(
          `End card "${id}" reads its video from PA_ASSETS["${ref}"], which is not in this export — the card will play as a bare background. Re-upload the ORIGINAL card HTML (the one with its base64 video inline) for that endscene.`,
        )
  return warns
}

// A `data:` URL that is actually base64, not percent-encoded. Anything else in an
// export is either a remote reference (an http(s) fetch at runtime = instant network
// rejection) or a percent-encoded payload, which is ~33% bigger for binary media and
// is not what the delivery scanners read.
const BASE64_DATA_URL = /^data:[^,]*;base64,/i

/** Every endscene asset in this project, as [field, id] pairs tagged with where it
 * came from — including per-language element and scene overrides, which can each
 * carry a whole endscene of their own. */
function endsceneRefs(project: Project): { scene: string; element: string; field: string; id: string }[] {
  const out: { scene: string; element: string; field: string; id: string }[] = []
  const walkScene = (scene: SceneDef, label: string): void => {
    for (const el of scene.elements) {
      const cfgs: [string, EndsceneConfig][] = []
      if (el.endscene) cfgs.push([el.name || el.id, el.endscene])
      for (const [loc, ov] of Object.entries(el.localeOverrides ?? {}))
        if (ov.source?.endscene) cfgs.push([`${el.name || el.id} (${loc})`, ov.source.endscene])
      for (const [element, cfg] of cfgs) for (const [field, id] of endsceneAssetFields(cfg)) out.push({ scene: label, element, field, id })
    }
    for (const [loc, ov] of Object.entries(scene.localeOverrides ?? {})) walkScene(ov.source, `${label} (${loc})`)
  }
  for (const scene of project.scenes) walkScene(scene, scene.name || scene.id)
  return out
}

/** Asset ids every endscene in the project needs at runtime, deduped. */
export function endsceneAssetIds(project: Project): string[] {
  return [...new Set(endsceneRefs(project).map((r) => r.id))]
}

/**
 * Endscene assets that will NOT ship as base64 — the one asset class where that
 * failure is invisible until the creative is in a container.
 *
 * Every other asset either shows up wrong in the editor preview or trips the
 * preflight's `src=`/`url()` scan. An endscene's media is assigned at RUNTIME, from
 * `PA_ASSETS[id].src` straight onto `<video>.src` / `<img>.src` / `iframe.srcdoc`, so
 * a src that stayed an http(s) URL sits inside a JSON string that no resource-attribute
 * regex matches: it renders perfectly on a dev machine, then fetches over the network
 * in the container and gets the creative rejected. A missing id is worse — the card
 * plays as a bare background colour with no error anywhere.
 */
export function endsceneAssetFindings(project: Project, assets: AssetMap): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const { scene, element, field, id } of endsceneRefs(project)) {
    if (seen.has(id)) continue
    seen.add(id)
    const where = `Endscene "${element}" (${scene}) ${field}`
    const a = assets[id]
    if (!a) {
      out.push(`${where} points at asset "${id}", which is not in this export — the card will play as a bare background. Re-add the asset to that endscene.`)
    } else if (!a.src.startsWith('data:')) {
      out.push(`${where} asset "${id}" is still a remote URL (${a.src.slice(0, 60)}…) — it could not be fetched and inlined, so the card would load it over the network and the creative will be rejected. Re-upload it as a local file.`)
    } else if (!BASE64_DATA_URL.test(a.src)) {
      out.push(`${where} asset "${id}" is a percent-encoded data URL, not base64 — re-export, or re-upload the asset, so the endscene ships base64-encoded.`)
    }
  }
  return out
}

// ---- html assembly --------------------------------------------------------
// The shell every export ships in is NOT written here: it is read verbatim out of the
// reference creatives — docs/mip_sample.html for a MIP, docs/sip_sample.html for a SIP —
// by scripts/sync-export-samples.mjs, into src/exportShell.generated.ts. Head order, the
// mraid.js bridge, the readiness helper, handleClickAction (window.clickTag only), the tap
// debounce, the lifecycle hooks, the loading-state boot gate and the ?date= override all
// come from there, so an export matches the sample the network signed off on. When the
// guidelines change, update the sample and run `npm run sync:samples`.
//
// What is ours is only what the samples leave to the creative: the base styles, the
// project data, the runtime bundle, and the few lines of glue that hand the sample's boot
// gate, click-through and date accessor to the runtime (runtime/export-entry.ts,
// runtime/networks.ts, runtime/elements/countdown.ts).

// Every http(s):// in the scripts we emit (runtime string constants, URLs inside the project
// data) is written with escaped slashes. `\/` reads back as `/` in a JS string, a template
// literal and JSON, so nothing changes at runtime — but a validator that scans the file for
// unembedded resources no longer reads a store URL or an SVG namespace as one.
export const escapeUrls = (s: string): string => s.replace(/(https?:)\/\//gi, '$1\\/\\/')

// html/body guards mirror the runtime base styles: without user-select:none, a drag that
// lands on a bare container (text elements are pointer-events:none) starts a native
// selection and highlights the whole screen while scratching. #app is the sample's mount
// point, fixed to the viewport (docs/AGENTS.md: no document scroll, no bounce).
function baseStyle(project: Project): string {
  // Background set statically so the canvas is correct before JS runs — prevents a white
  // flash / edge bleed in Chromium/AppLovin WebViews.
  const bg = project.meta.bgMatchColor ?? '#000000'
  return (
    `<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;overscroll-behavior:none;` +
    `background:${bg}!important;-webkit-text-size-adjust:100%;text-size-adjust:100%;` +
    `user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;}` +
    `#app{position:fixed;inset:0;touch-action:none;user-select:none;-webkit-user-select:none;overscroll-behavior:none}</style>`
  )
}

// Ahead of the runtime: PA_MRAID_GATE stops the bundle starting itself (the sample's gate
// starts it), and PA_NOW hands it the sample's ?date= accessor under one name.
const gateFlags = (dateAccessor: string): string =>
  `<script>window.PA_MRAID_GATE = true; window.PA_NOW = window.${dateAccessor};</script>`

function dataAndRuntime(project: Project, assets: AssetMap, runtimeSrc: string): string {
  return (
    `<script>window.PA_PROJECT=${escapeUrls(esc(JSON.stringify(project)))};\n` +
    `window.PA_ASSETS=${escapeUrls(esc(serializeAssets(assets)))};\n</script>\n` +
    `<script>${escapeUrls(stripSourceMap(runtimeSrc))}</script>`
  )
}

// MIP: the sample's head gate publishes window.<bootFlag> and calls window.<bootCallback>()
// once the container is past "loading" (or its 2s fallback fires). That can happen while
// <head> is still parsing, so the start also waits for the DOM — the runtime mounts into
// the sample's <div id="app">.
const MIP_BOOT = `<script>
(function () {
  function startCreative() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startCreative, { once: true });
      return;
    }
    // The ready wait already happened in the head gate: the runtime only registers its
    // MRAID lifecycle listeners instead of waiting a second time.
    window.PA_MRAID_WAITED = true;
    if (typeof window.PA_START === "function") window.PA_START();
  }
  if (window.${Shell.MIP_bootFlag}) startCreative();
  else window.${Shell.MIP_bootCallback} = startCreative;
})();
</script>`

// SIP: the sample's body script, minus its video template. Its handleClickAction, tap
// debounce, viewability wiring, lifecycle hooks and DOM + MRAID boot gate run verbatim;
// startAdRuntime() — the sample's video player — becomes "start the runtime", which
// renders the chosen end card (HTML import, video or image, plus anything on top of it).
// Wrapped in one function scope so the sample's handleClickAction stays the local the
// debounce calls, while window.handleClickAction (what the runtime's CTA surfaces call)
// goes through the debounce first: one open per gesture, whichever surface fired it.
const SIP_BODY = `<script>
(function () {
${Shell.SIP_handleClickAction}

${Shell.SIP_tapState}

${Shell.SIP_handleTap}

window.handleClickAction = function () {
  handleTap({ type: "click" });
};

// setupMraidViewability() drives the sample's <video>. Here the runtime owns playback and
// volume (it registers the same MRAID events), so these only pause media the container
// has taken off screen.
let mraidViewable = true;
const video = { volume: 1 };
function syncWindowActivityState() {
  if (mraidViewable) return;
  document.querySelectorAll("video, audio").forEach(function (element) {
    try {
      element.pause();
    } catch (_error) {}
  });
}

${Shell.SIP_setupMraidViewability}

${Shell.SIP_lifecycleStubs}

${Shell.SIP_signalPlayableLifecycle}

${Shell.SIP_pagehide}

${Shell.SIP_unloadFailedAd}

function startAdRuntime() {
  setupMraidViewability();
  window.PA_MRAID_WAITED = true;
  if (typeof window.PA_START === "function") window.PA_START();
}

${Shell.SIP_startedState}

${Shell.SIP_init}

${Shell.SIP_initializeMraidRuntime}

initializeMraidRuntime();
})();
</script>`

// Same JSON, one asset per line. Serialised flat, the asset map is a single line holding
// every data URI in the creative — several megabytes of it — and validators that read the
// file line by line (or scan it with a line-bounded buffer) give up and report the HTML as
// unreadable. Newlines between object members cost ~1 byte per asset and cap the longest
// line at the largest single asset.
function serializeAssets(assets: AssetMap): string {
  const entries = Object.entries(assets)
  if (!entries.length) return '{}'
  return `{\n${entries.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n')}\n}`
}

/** Which sample's shell a project ships in: a SIP is a project whose one scene is an end card. */
export const shellKind = (project: Project): 'mip' | 'sip' => (isSip(project) ? 'sip' : 'mip')

export function buildBaseHtml(project: Project, assets: AssetMap, runtimeSrc = staticRuntimeSrc): string {
  // Title is always the brand (Client) name; fall back to the MIP name, then a generic label.
  const title = `<title>${esc(project.meta.client || project.meta.name || 'playable')}</title>\n`
  if (shellKind(project) === 'sip') {
    return (
      Shell.SIP_htmlOpen +
      Shell.SIP_meta +
      Shell.SIP_titleIndent + title +
      Shell.SIP_helper + '\n' +
      baseStyle(project) + '\n' +
      Shell.SIP_dateScript + '\n' +
      `</head>\n<body>\n` +
      gateFlags(Shell.SIP_dateAccessor) + '\n' +
      dataAndRuntime(project, assets, runtimeSrc) + '\n' +
      SIP_BODY + '\n' +
      `</body>\n</html>\n`
    )
  }
  return (
    Shell.MIP_htmlOpen +
    Shell.MIP_headScripts +
    Shell.MIP_meta +
    Shell.MIP_titleIndent + title +
    baseStyle(project) + '\n' +
    gateFlags(Shell.MIP_dateAccessor) + '\n' +
    dataAndRuntime(project, assets, runtimeSrc) + '\n' +
    MIP_BOOT + '\n' +
    Shell.MIP_tail
  )
}

function injectHead(html: string, tag: string): string {
  return html.replace('</head>', tag + '</head>')
}
export function transformForNetwork(base: string, net: Network): string {
  let html = base
  // No mraid.js here: the sample's shell already declares the bridge for every network,
  // so injecting per-network would duplicate the tag.
  if (net.injectExitApi) html = injectHead(html, '<script src="exitapi.js"></script>')
  if (net.vungleFlag) html = injectHead(html, '<script>window.__VUNGLE__=true;</script>')
  if (net.onloadGameReady) html = html.replace('<body>', '<body onload="gameReady()">')
  // No network comment ahead of the doctype: the file opens exactly as the sample does.
  return html
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
  // Only append the network tag when more than one network is being emitted in
  // this call — otherwise the file name is exactly the base name, nothing else.
  const multiNet = networks.length > 1
  const outputs: Output[] = networks.map((net) => {
    const html = transformForNetwork(base, net)
    const htmlBytes = bytesOfStr(html)
    const stem = multiNet ? `${baseName}_${net.tag}` : baseName
    if (net.zip) {
      return {
        net: net.name,
        filename: `${stem}.zip`,
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
      filename: `${stem}.html`,
      bytes: htmlBytes,
      over: htmlBytes > MAX_BYTES,
      make: async () => new Blob([html], { type: 'text/html' }),
    }
  })
  return { outputs, baseBytes: bytesOfStr(base) }
}

export function downloadBlob(filename: string, blob: Blob): void {
  const nativeApi = (
    window as unknown as {
      editorAPI?: {
        saveExportFile?(name: string, bytes: ArrayBuffer): Promise<{ ok: boolean; path?: string; error?: string }>
      }
    }
  ).editorAPI
  if (nativeApi?.saveExportFile) {
    void blob
      .arrayBuffer()
      .then((bytes) => nativeApi.saveExportFile!(filename, bytes))
      .then((r) => {
        if (!r.ok) throw new Error(r.error || 'export save failed')
      })
      .catch((e) => {
        void appAlert('Export failed: ' + String((e as Error)?.message ?? e))
      })
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export const fmtBytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`)
