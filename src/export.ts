// Single-file export. Assembles a self-contained playable HTML from the scene +
// base64 assets + the pre-bundled runtime (runtime-dist/playable-runtime.js).
// Optionally re-encodes raster images to WebP (in-browser via canvas), enforces
// the 5MB gate, warns about up-scaled (blurry) assets, and produces per-network
// variants (mraid/exitapi injection, zip where required).

import JSZip from 'jszip'
import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import { remoteToDataUrl } from './net'
import { transcodeMedia } from './bridge'
// The runtime as a string, inlined into every export.
import runtimeSrc from '../runtime-dist/playable-runtime.js?raw'

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
      if (el.sfx) for (const b of el.sfx) add(b.assetId)
      if (el.game?.params) for (const v of Object.values(el.game.params)) (Array.isArray(v) ? v.forEach(add) : add(v))
      if (el.endscene) {
        add(el.endscene.portraitVideoId)
        add(el.endscene.landscapeVideoId)
        add(el.endscene.portraitImageId)
        add(el.endscene.landscapeImageId)
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
): Promise<{ assets: AssetMap; report: AssetReport[] }> {
  const out: AssetMap = {}
  const report: AssetReport[] = []
  for (const [id, a] of Object.entries(assets)) {
    let src = await ensureDataUrl(a.src)
    let optimized = false
    if (optimize && /^data:image\/(png|jpe?g|webp)/i.test(src)) {
      try {
        const before = dataUrlBytes(src)
        const webp = await toWebp(src, quality)
        if (dataUrlBytes(webp) < before) {
          src = webp
          optimized = true
        }
      } catch {
        /* keep original */
      }
    } else if (optimize && a.kind === 'video' && /^data:video\//i.test(src)) {
      const r = await transcodeMedia(src, 'video', { maxWidth: 720, crf: 28, audioKbps: 96 })
      if (r && dataUrlBytes(r) < dataUrlBytes(src)) {
        src = r
        optimized = true
      }
    } else if (optimize && a.kind === 'audio' && /^data:audio\//i.test(src)) {
      const r = await transcodeMedia(src, 'audio', { audioKbps: 96 })
      if (r && dataUrlBytes(r) < dataUrlBytes(src)) {
        src = r
        optimized = true
      }
    }
    out[id] = { src, w: a.w, h: a.h, kind: a.kind }
    report.push({ id, w: a.w, h: a.h, bytes: dataUrlBytes(src), optimized, remote: !src.startsWith('data:') })
  }
  return { assets: out, report }
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
export function buildBaseHtml(project: Project, assets: AssetMap): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">` +
    `<title>${esc(project.meta.name || 'playable')}</title></head><body>` +
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

export function buildOutputs(project: Project, assets: AssetMap, networks: Network[]): { outputs: Output[]; baseBytes: number } {
  const base = buildBaseHtml(project, assets)
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
