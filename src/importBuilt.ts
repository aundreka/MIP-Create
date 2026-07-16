// Round-trip import — recover an editable project from a previously-BUILT playable
// (single-file .html, a zip-wrapped network export, or the Vite `_source.zip`).
//
// Every HTML this editor exports embeds the whole project + assets as two JS
// globals, because the runtime needs them to render (see buildBaseHtml in
// export.ts): `<script>window.PA_PROJECT={…};window.PA_ASSETS={…};</script>`.
// The only transform is esc() = replace `<` with the literal `<`, which
// JSON.parse decodes back natively — so recovering a project is: isolate the two
// object literals, JSON.parse, validate. This module is pure (no React, no store
// writes) so it stays unit-testable; the modal (ImportBuilt.tsx) does the loading.

import JSZip from 'jszip'
import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import type { ProjectData } from './bridge'
import { CURRENT_SCHEMA } from './migrate'

export type ImportKind = 'own-html' | 'own-html-zip' | 'own-vite-zip' | 'foreign-html' | 'unknown'

export interface ImportResult {
  kind: ImportKind
  /** Present for own-* kinds: the recovered, fully-editable project + assets. */
  data?: ProjectData
  /** Present for foreign-html: the raw markup to embed as an opaque iframe block. */
  foreignHtml?: string
  /** Original file name (used to name the imported scene/project). */
  sourceName?: string
  /** meta.schemaVersion of the recovered project (0 for pre-versioned builds). */
  schemaVersion?: number
  /** True when the build was made by a NEWER editor than this one understands. */
  schemaTooNew?: boolean
  /** Non-blocking notices to surface (lossy caveat, missing assets, …). */
  warnings: string[]
  /** Set when nothing usable could be recovered. */
  error?: string
}

export const LOSSY_NOTICE =
  'Recovered from a build: media were re-encoded / possibly downscaled at export, ' +
  'extra ad-network variants were flattened, and editor-only trace overlays are gone. ' +
  'This recovers the last build. If you still have the original project .json, open that instead.'

export const LOSSY_NOTICE_SOURCE =
  'Recovered from a source zip: the project structure is intact. ' +
  'Bundled media may already have been optimized at export time.'

const MAX_INLINE_READ = 80 * 1024 * 1024 // warn (don't block) past ~80 MB

// --- extraction primitives -------------------------------------------------

/**
 * Isolate the JSON object literal that follows `marker` in `text`, using a
 * brace-matching scan that respects JSON string state. A greedy/lazy regex is
 * wrong here: data-URLs and text values contain `{`, `}`, `;`, quotes, and
 * `</script>`-looking substrings. Returns null if the marker is absent or the
 * object is unbalanced (truncated file).
 */
export function extractJsonAfter(text: string, marker: string): string | null {
  const at = text.indexOf(marker)
  if (at < 0) return null
  let i = at + marker.length
  while (i < text.length && /\s/.test(text[i])) i++
  if (text[i] !== '{') return null
  const start = i
  let depth = 0
  let inStr = false
  let esc = false
  for (; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function validateProjectShape(project: unknown): string | null {
  const p = project as Project | undefined
  if (!p || typeof p !== 'object') return 'No project data found in the file.'
  if (!p.meta || typeof p.meta !== 'object') return 'The recovered project is missing its metadata.'
  if (!Array.isArray(p.scenes) || p.scenes.length === 0) return 'The recovered project has no scenes.'
  return null
}

function collectMissingAssets(project: Project, assets: AssetMap): string[] {
  const have = new Set(Object.keys(assets || {}))
  const missing = new Set<string>()
  const need = (id?: string): void => {
    if (id && !have.has(id)) missing.add(id)
  }
  // Project-level audio (SFX bindings + background music) references, too — not just
  // the visible image/video on each element — so missing SOUND is surfaced, not silent.
  for (const b of project.sfx || []) need(b.assetId)
  need(project.bgm?.assetId)
  for (const s of project.scenes) {
    for (const el of s.elements || []) {
      need(el.assetId)
      need(el.container?.imageId)
      for (const b of el.sfx || []) need(b.assetId)
    }
  }
  return [...missing]
}

/** Shared finish path for own-editor builds (html or source zip). */
function finishOwn(project: unknown, assetsRaw: unknown, sourceName: string | undefined, fromSource: boolean): ImportResult {
  const err = validateProjectShape(project)
  if (err) return { kind: 'unknown', warnings: [], error: err }
  const p = project as Project
  const assets = (assetsRaw && typeof assetsRaw === 'object' ? assetsRaw : {}) as AssetMap

  const warnings: string[] = [fromSource ? LOSSY_NOTICE_SOURCE : LOSSY_NOTICE]
  if (!p.startSceneId || !p.scenes.some((s) => s.id === p.startSceneId)) {
    warnings.push('No valid start scene was recorded; the first scene will be used.')
  }
  const missing = collectMissingAssets(p, assets)
  if (missing.length) warnings.push(`${missing.length} referenced asset${missing.length === 1 ? '' : 's'} could not be found and will render blank.`)

  const schemaVersion = typeof p.meta.schemaVersion === 'number' ? p.meta.schemaVersion : 0
  const schemaTooNew = schemaVersion > CURRENT_SCHEMA
  if (schemaTooNew) warnings.push(`This build was made with a newer editor (schema v${schemaVersion}; this editor supports v${CURRENT_SCHEMA}). Some things may not import correctly.`)

  return {
    kind: fromSource ? 'own-vite-zip' : 'own-html',
    data: { project: p, assets },
    sourceName,
    schemaVersion,
    schemaTooNew,
    warnings,
  }
}

// --- HTML / zip entry points -----------------------------------------------

/** Extract from a single-file HTML string. No `PA_PROJECT` marker → treat as
 * foreign (Tier 2); marker present but unrecoverable → unknown (truncated build). */
export function extractFromHtml(html: string, sourceName?: string): ImportResult {
  const projJson = extractJsonAfter(html, 'window.PA_PROJECT=')
  if (!projJson) {
    if (html.includes('window.PA_PROJECT=')) return { kind: 'unknown', warnings: [], error: 'Found an editor build, but its project data is incomplete (the file may be truncated).' }
    return { kind: 'foreign-html', foreignHtml: html, sourceName, warnings: [] }
  }
  const assetsJson = extractJsonAfter(html, 'window.PA_ASSETS=')
  let project: unknown
  let assets: unknown
  try {
    project = JSON.parse(projJson)
    assets = assetsJson ? JSON.parse(assetsJson) : {}
  } catch {
    return { kind: 'unknown', warnings: [], error: 'Found an editor build, but its embedded project data could not be parsed (the file may be truncated).' }
  }
  return finishOwn(project, assets, sourceName, false)
}

function findEntry(zip: JSZip, re: RegExp): JSZip.JSZipObject | null {
  for (const path of Object.keys(zip.files)) {
    const f = zip.files[path]
    if (!f.dir && re.test(path)) return f
  }
  return null
}

/** Extract from a zip — most-structured source first (Vite source zip), then a
 * single-file HTML wrapped by a network export. */
export async function extractFromZip(file: File): Promise<ImportResult> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer())
  } catch {
    return { kind: 'unknown', warnings: [], error: 'Could not read the zip archive (it may be corrupt).' }
  }

  // 1. Vite `_source.zip`: src/project.json + src/assets.json — pristine, unescaped.
  const projFile = findEntry(zip, /(^|\/)src\/project\.json$/i) ?? findEntry(zip, /(^|\/)project\.json$/i)
  const assetsFile = findEntry(zip, /(^|\/)src\/assets\.json$/i) ?? findEntry(zip, /(^|\/)assets\.json$/i)
  if (projFile && assetsFile) {
    try {
      const project = JSON.parse(await projFile.async('string'))
      const assets = JSON.parse(await assetsFile.async('string'))
      const r = finishOwn(project, assets, file.name, true)
      if (r.kind !== 'unknown') return r
    } catch {
      /* fall through to an html payload if present */
    }
  }

  // 2. Single-file HTML wrapped in a zip (Google/Mintegral/Vungle network export).
  const htmlEntry = findEntry(zip, /(^|\/)index\.html$/i) ?? findEntry(zip, /\.html?$/i)
  if (htmlEntry) {
    const html = await htmlEntry.async('string')
    const r = extractFromHtml(html, file.name)
    return r.kind === 'own-html' ? { ...r, kind: 'own-html-zip' } : r
  }

  return { kind: 'unknown', warnings: [], error: 'The zip did not contain a recognizable project (no src/project.json or index.html).' }
}

/** Top-level dispatcher: sniff by extension/type, then by content. */
export async function importBuiltFile(file: File): Promise<ImportResult> {
  const name = file.name || ''
  const lower = name.toLowerCase()
  const warnings: string[] = []
  if (file.size > MAX_INLINE_READ) warnings.push(`Large file (${Math.round(file.size / (1024 * 1024))} MB); parsing may take a moment.`)

  const withWarnings = (r: ImportResult): ImportResult => ({ ...r, warnings: [...warnings, ...r.warnings] })

  try {
    const isZip = lower.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed'
    if (isZip) return withWarnings(await extractFromZip(file))

    if (lower.endsWith('.html') || lower.endsWith('.htm') || file.type === 'text/html') {
      return withWarnings(extractFromHtml(await file.text(), name))
    }

    // Unknown extension: peek at the text. An editor build always contains the marker.
    const text = await file.text()
    if (text.includes('window.PA_PROJECT=')) return withWarnings(extractFromHtml(text, name))

    return { kind: 'unknown', warnings, error: 'Unrecognized file. Upload a .html or .zip that was exported from the editor (or a third-party playable to embed).' }
  } catch (e) {
    return { kind: 'unknown', warnings, error: 'Could not read the file: ' + (e as Error).message }
  }
}
