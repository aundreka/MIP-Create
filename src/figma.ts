// Figma import. Reads a frame via the Figma REST API (link + personal access
// token) and rebuilds it as editable elements: TEXT nodes become text elements;
// every other top-level child is rendered to a PNG and placed as an image
// (faithful visuals + editable copy). The frame's size becomes the design space.
//
// Token is the user's own Figma personal access token (Figma → Settings →
// Security → personal access tokens). Stored in localStorage on this machine.

import type { SceneElement } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import { remoteToDataUrl } from './net'

const API = 'https://api.figma.com/v1'
const TOKEN_KEY = 'pa:figmaToken'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}
export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t.trim())
}

export function parseFigmaUrl(url: string): { key: string; nodeId: string } | null {
  const key = /(?:file|design|proto)\/([A-Za-z0-9]+)/.exec(url)?.[1]
  if (!key) return null
  const raw = /node-id=([^&]+)/.exec(url)?.[1]
  if (!raw) return null
  const nodeId = decodeURIComponent(raw).replace(/-/g, ':')
  return { key, nodeId }
}

interface FigmaColor { r: number; g: number; b: number; a: number }
function colorCss(c: FigmaColor): string {
  const to255 = (v: number): number => Math.round(v * 255)
  if (c.a < 1) return `rgba(${to255(c.r)},${to255(c.g)},${to255(c.b)},${+c.a.toFixed(3)})`
  const hex = (v: number): string => to255(v).toString(16).padStart(2, '0')
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function solidFill(fills: any[]): string | undefined {
  const f = (fills ?? []).find((x) => x.type === 'SOLID' && x.visible !== false)
  return f ? colorCss({ ...f.color, a: f.opacity ?? f.color.a ?? 1 }) : undefined
}

export interface ImportProgress {
  phase: string
  done?: number
  total?: number
}
export type OnProgress = (p: ImportProgress) => void

function humanDuration(secs: number): string {
  if (secs < 120) return `${Math.round(secs)}s`
  if (secs < 7200) return `${Math.round(secs / 60)}m`
  if (secs < 172800) return `${Math.round(secs / 3600)}h`
  return `${Math.round(secs / 86400)}d`
}

async function api<T>(path: string, token: string, onProgress?: OnProgress): Promise<T> {
  // Figma rate-limits (429). Retry a few times on SHORT cooldowns; but when the API
  // render quota is exhausted Figma returns a multi-hour/day Retry-After — never
  // wait on that, fail fast with a clear message instead of hanging "for days".
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, { headers: { 'X-Figma-Token': token } })
    if (res.ok) return res.json() as Promise<T>
    if (res.status === 429) {
      const ra = Number(res.headers.get('Retry-After'))
      const secs = Number.isFinite(ra) && ra > 0 ? ra : (attempt + 1) * 5
      if (attempt < 3 && secs <= 90) {
        onProgress?.({ phase: `Figma rate limit — retrying in ${Math.round(secs)}s… (${attempt + 1}/3)` })
        await new Promise((r) => setTimeout(r, secs * 1000))
        continue
      }
      throw new Error(
        `Figma rate limit / render quota exceeded (Figma asks to wait ~${humanDuration(secs)}). ` +
          `Wait it out, use a different access token, or re-run with “skip image rendering” (image export is what burns the quota).`,
      )
    }
    throw new Error(`Figma API ${res.status}${res.status === 403 ? ' (check your token)' : ''}`)
  }
}

async function toDataUrl(url: string): Promise<string> {
  // Inline via the Electron main process / dev proxy / direct fetch.
  return (await remoteToDataUrl(url)) ?? url
}

// Run an async map with bounded concurrency. The rendered PNGs live on S3 (not
// the rate-limited Figma API), so we can fetch many at once — but cap it so a
// 100-layer frame doesn't open 100 sockets through the Electron proxy at once.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export interface ImportResult {
  name: string
  bgColor?: string
  baseW: number
  baseH: number
  elements: SceneElement[]
  assets: AssetMap
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function importFigma(url: string, token: string, opts?: { flatten?: boolean; skipImages?: boolean; onProgress?: OnProgress }): Promise<ImportResult> {
  const flatten = opts?.flatten ?? false
  const onP = opts?.onProgress
  const parsed = parseFigmaUrl(url)
  if (!parsed) throw new Error('Could not read the Figma URL. Open a frame, copy its link (must contain node-id).')
  const { key, nodeId } = parsed

  onP?.({ phase: 'Reading frame…' })
  const nodeRes = await api<{ nodes: Record<string, { document: any }> }>(
    `/files/${key}/nodes?ids=${encodeURIComponent(nodeId)}`,
    token,
    onP,
  )
  const frame = nodeRes.nodes[nodeId]?.document
  if (!frame || !frame.absoluteBoundingBox) throw new Error('That node is not a frame. Select a frame/component and copy its link.')

  const fb = frame.absoluteBoundingBox
  const baseW = Math.round(fb.width)
  const baseH = Math.round(fb.height)
  const children: any[] = (frame.children ?? []).filter((c: any) => c.visible !== false && c.absoluteBoundingBox)

  // render children to PNGs (one request). Normally every non-text child; when
  // flattening, every child (text included) becomes an image. skipImages avoids the
  // (quota-heavy) /images render entirely — text/layout only.
  const exportIds = opts?.skipImages ? [] : children.filter((c) => flatten || c.type !== 'TEXT').map((c) => c.id)
  let imgUrls: Record<string, string | null> = {}
  if (exportIds.length) {
    onP?.({ phase: 'Rendering images in Figma…' })
    const imgRes = await api<{ images: Record<string, string | null> }>(
      `/images/${key}?ids=${exportIds.map(encodeURIComponent).join(',')}&format=png&scale=2`,
      token,
      onP,
    )
    imgUrls = imgRes.images ?? {}
  }

  // Download every rendered PNG in parallel first (the slow part used to be doing
  // these one-at-a-time inside the build loop). Keyed by node id.
  const dataUrls: Record<string, string> = {}
  let dl = 0
  if (exportIds.length) onP?.({ phase: 'Downloading images…', done: 0, total: exportIds.length })
  await mapPool(exportIds, 6, async (cid) => {
    const url = imgUrls[cid]
    if (url) dataUrls[cid] = await toDataUrl(url)
    onP?.({ phase: 'Downloading images…', done: ++dl, total: exportIds.length })
  })

  const assets: AssetMap = {}
  const elements: SceneElement[] = []
  let n = 0

  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    const bb = c.absoluteBoundingBox
    const x = Math.round(bb.x - fb.x)
    const y = Math.round(bb.y - fb.y)
    if (c.type === 'TEXT' && !flatten) {
      elements.push({
        id: `fig_t${n++}`,
        type: 'text',
        name: c.name || 'Text',
        x,
        y,
        anchor: 'top-left',
        zIndex: i,
        mode: 'fit',
        text: {
          value: c.characters ?? '',
          fontSizePx: Math.round(c.style?.fontSize ?? 48),
          fontWeight: c.style?.fontWeight ?? 400,
          fontFamily: c.style?.fontFamily,
          color: solidFill(c.fills) ?? '#ffffff',
          align: (c.style?.textAlignHorizontal ?? 'LEFT').toLowerCase() as 'left' | 'center' | 'right',
        },
      })
    } else {
      const src = dataUrls[c.id]
      if (!src) continue
      const id = `fig_a${n++}`
      assets[id] = { src, w: Math.round(bb.width), h: Math.round(bb.height) }
      elements.push({
        id: `fig_e${n}`,
        type: 'image',
        name: c.name || 'Image',
        assetId: id,
        x,
        y,
        w: Math.round(bb.width),
        h: Math.round(bb.height),
        anchor: 'top-left',
        zIndex: i,
        mode: 'fit',
      })
    }
  }

  const bg = solidFill(frame.fills) ?? (frame.backgroundColor ? colorCss(frame.backgroundColor) : '#101a33')
  return { name: frame.name || 'figma-import', bgColor: bg, baseW, baseH, elements, assets }
}

// ---- funnel import (parent frame -> one question per child frame) ----------
// Point at a PARENT frame whose children are the question screens. Each child
// frame's layers are classified into question / options / image / continue (by
// layer name, with a positional fallback) and returned as structured questions
// the funnel generator turns into editable scenes. An option layer named
// "*correct*" (or whose text ends with "*") is the right answer.

const OPT_NAME = /option|answer|choice|\bopt\b|opt[\s_-]?\d/i
const Q_NAME = /question|prompt|\bq\d|q[\s_-]?\d/i
const CONT_NAME = /continue|next|submit|\bcta\b|button|start|begin/i
const CORRECT_NAME = /correct|right|answer[\s_-]?key|✓|✔/i
const CONT_TEXT = /^(continue|next|submit|start|get started|let'?s go|begin|skip)$/i

function walkNodes(node: any, out: any[] = []): any[] {
  if (!node) return out
  out.push(node)
  if (Array.isArray(node.children)) for (const c of node.children) walkNodes(c, out)
  return out
}
const bbArea = (n: any): number => (n.absoluteBoundingBox?.width ?? 0) * (n.absoluteBoundingBox?.height ?? 0)
const hasImageFill = (n: any): boolean => Array.isArray(n.fills) && n.fills.some((f: any) => f.type === 'IMAGE' && f.visible !== false)
const cleanText = (s?: string): string =>
  (s ?? '')
    .replace(/^\s*[A-Ha-h][.)]\s+/, '')
    .replace(/^\s*\*+\s*/, '')
    .replace(/\s*\*+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

export interface FunnelImportResult {
  name: string
  baseW: number
  baseH: number
  accent?: string
  bgColor?: string
  questions: { question: string; options: { label: string; correct: boolean }[]; imageAssetId?: string }[]
  assets: AssetMap
}

export async function importFigmaFunnel(url: string, token: string, opts?: { skipImages?: boolean; onProgress?: OnProgress }): Promise<FunnelImportResult> {
  const onP = opts?.onProgress
  const parsed = parseFigmaUrl(url)
  if (!parsed) throw new Error('Could not read the Figma URL. Open the parent frame, copy its link (must contain node-id).')
  const { key, nodeId } = parsed

  onP?.({ phase: 'Reading frames…' })
  const nodeRes = await api<{ nodes: Record<string, { document: any }> }>(`/files/${key}/nodes?ids=${encodeURIComponent(nodeId)}`, token, onP)
  const parent = nodeRes.nodes[nodeId]?.document
  if (!parent) throw new Error('That node was not found in the file.')
  const frames: any[] = (parent.children ?? []).filter((c: any) => c.visible !== false && c.absoluteBoundingBox)
  if (!frames.length) throw new Error('No child frames found. Point at a PARENT frame whose children are your question screens.')

  // design space = the largest child frame (screens are usually uniform)
  let baseW = 0
  let baseH = 0
  for (const f of frames) {
    baseW = Math.max(baseW, Math.round(f.absoluteBoundingBox.width))
    baseH = Math.max(baseH, Math.round(f.absoluteBoundingBox.height))
  }

  // accent = a "continue/cta/button" node's solid fill, anywhere in the funnel
  let accent: string | undefined
  for (const f of frames) {
    for (const n of walkNodes(f)) {
      if (CONT_NAME.test(n.name ?? '') && Array.isArray(n.fills)) {
        const c = solidFill(n.fills)
        if (c) {
          accent = c
          break
        }
      }
    }
    if (accent) break
  }

  interface Pre {
    name: string
    bgColor?: string
    question: string
    options: { label: string; correct: boolean }[]
    imageNodeId?: string
    imageBB?: { width: number; height: number }
  }
  const pre: Pre[] = []
  const imageIds: string[] = []

  for (const f of frames) {
    const fb = f.absoluteBoundingBox
    const all = walkNodes(f)
    const texts = all.filter((n) => n.type === 'TEXT' && n.visible !== false && n.absoluteBoundingBox && (n.characters ?? '').trim())

    // question: named, else the largest font near the top
    let qNode = texts.find((n) => Q_NAME.test(n.name ?? ''))
    if (!qNode && texts.length) {
      qNode = texts.slice().sort((a, b) => (b.style?.fontSize ?? 0) - (a.style?.fontSize ?? 0) || a.absoluteBoundingBox.y - b.absoluteBoundingBox.y)[0]
    }
    // continue button (excluded from options)
    const contNode = texts.find((n) => CONT_NAME.test(n.name ?? '') || CONT_TEXT.test((n.characters ?? '').trim()))

    // options: named, else every text vertically between the question and the
    // continue button (the classic quiz layout).
    let optNodes = texts.filter((n) => OPT_NAME.test(n.name ?? ''))
    if (!optNodes.length) {
      const qBottom = qNode ? qNode.absoluteBoundingBox.y + qNode.absoluteBoundingBox.height : fb.y
      const cTop = contNode ? contNode.absoluteBoundingBox.y : fb.y + fb.height
      optNodes = texts.filter((n) => n !== qNode && n !== contNode && n.absoluteBoundingBox.y >= qBottom - 2 && n.absoluteBoundingBox.y < cTop)
    }
    optNodes = optNodes.filter((n) => n !== qNode && n !== contNode)
    optNodes.sort((a, b) => a.absoluteBoundingBox.y - b.absoluteBoundingBox.y)
    const options = optNodes.map((n) => ({
      label: cleanText(n.characters),
      correct: CORRECT_NAME.test(n.name ?? '') || /\*\s*$/.test(n.characters ?? ''),
    }))

    // image: largest image-fill (or "image"-named) node that isn't the whole-frame background
    const imgCands = all.filter(
      (n) =>
        n !== f &&
        n.type !== 'TEXT' &&
        n.absoluteBoundingBox &&
        (hasImageFill(n) || /image|img|photo|picture|illustration/i.test(n.name ?? '')) &&
        bbArea(n) < bbArea(f) * 0.72,
    )
    imgCands.sort((a, b) => bbArea(b) - bbArea(a))
    const imgNode = opts?.skipImages ? undefined : imgCands[0]
    if (imgNode) imageIds.push(imgNode.id)

    pre.push({
      name: f.name,
      bgColor: solidFill(f.fills) ?? (f.backgroundColor ? colorCss(f.backgroundColor) : undefined),
      question: cleanText(qNode?.characters ?? f.name),
      options,
      imageNodeId: imgNode?.id,
      imageBB: imgNode?.absoluteBoundingBox,
    })
  }

  // export the chosen image nodes (one request), then inline in parallel
  let imgUrls: Record<string, string | null> = {}
  if (imageIds.length) {
    onP?.({ phase: 'Rendering images in Figma…' })
    const res = await api<{ images: Record<string, string | null> }>(`/images/${key}?ids=${imageIds.map(encodeURIComponent).join(',')}&format=png&scale=2`, token, onP)
    imgUrls = res.images ?? {}
  }
  const dataMap: Record<string, string> = {}
  let dl = 0
  if (imageIds.length) onP?.({ phase: 'Downloading images…', done: 0, total: imageIds.length })
  await mapPool(imageIds, 6, async (id) => {
    const u = imgUrls[id]
    if (u) dataMap[id] = await toDataUrl(u)
    onP?.({ phase: 'Downloading images…', done: ++dl, total: imageIds.length })
  })
  onP?.({ phase: 'Building scenes…' })

  const assets: AssetMap = {}
  const questions = pre.map((p, i) => {
    let imageAssetId: string | undefined
    if (p.imageNodeId && dataMap[p.imageNodeId]) {
      imageAssetId = `figq_${i}`
      assets[imageAssetId] = { src: dataMap[p.imageNodeId], w: Math.round(p.imageBB?.width ?? 800), h: Math.round(p.imageBB?.height ?? 600) }
    }
    return { question: p.question, options: p.options, imageAssetId }
  })

  return { name: parent.name || 'Figma funnel', baseW, baseH, accent, bgColor: pre[0]?.bgColor, questions, assets }
}
