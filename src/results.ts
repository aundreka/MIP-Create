// Creative performance results. Paste/upload a CSV exported from a network
// dashboard; this parses it (fuzzy header detection), stores it locally, matches
// each row to a MIP/variant in the library by name, and ranks them so the team
// can see which mechanic/variant actually wins. CSV first; an API can feed the
// same ResultRow[] later.

import { listProjects, loadProjectData } from './projects'

export interface ResultRow {
  creative: string
  network?: string
  ipm?: number
  ctr?: number
  impressions?: number
  installs?: number
  spend?: number
}

export type Metric = 'ipm' | 'ctr' | 'installs' | 'impressions'
export const METRICS: { value: Metric; label: string }[] = [
  { value: 'ipm', label: 'IPM' },
  { value: 'ctr', label: 'CTR' },
  { value: 'installs', label: 'Installs' },
  { value: 'impressions', label: 'Impressions' },
]

const KEY = 'pa:results'

// ---- CSV parsing -----------------------------------------------------------
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const num = (s?: string): number | undefined => {
  if (s == null) return undefined
  const n = parseFloat(s.replace(/[$,%\s]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function pick(headers: string[], ...needles: string[]): number {
  return headers.findIndex((h) => needles.some((n) => h.includes(n)))
}

export function parseResultsCsv(text: string): ResultRow[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
  const ci = {
    creative: pick(headers, 'creative', 'iteration', 'asset', 'ad name', 'name', 'ad'),
    network: pick(headers, 'network', 'source', 'partner', 'channel'),
    ipm: pick(headers, 'ipm'),
    ctr: pick(headers, 'ctr', 'click through', 'click-through'),
    impressions: pick(headers, 'impression', 'impr'),
    installs: pick(headers, 'install', 'conversion'),
    spend: pick(headers, 'spend', 'cost'),
  }
  if (ci.creative < 0) ci.creative = 0 // fall back to the first column
  const rows: ResultRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i])
    const creative = (c[ci.creative] ?? '').trim()
    if (!creative) continue
    rows.push({
      creative,
      network: ci.network >= 0 ? c[ci.network] : undefined,
      ipm: ci.ipm >= 0 ? num(c[ci.ipm]) : undefined,
      ctr: ci.ctr >= 0 ? num(c[ci.ctr]) : undefined,
      impressions: ci.impressions >= 0 ? num(c[ci.impressions]) : undefined,
      installs: ci.installs >= 0 ? num(c[ci.installs]) : undefined,
      spend: ci.spend >= 0 ? num(c[ci.spend]) : undefined,
    })
  }
  return rows
}

// ---- persistence -----------------------------------------------------------
export function loadResults(): ResultRow[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as ResultRow[]) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
export function saveResults(rows: ResultRow[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows))
  } catch {
    /* quota */
  }
}
export function clearResults(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* */
  }
}

// ---- leaderboard -----------------------------------------------------------
export interface LeaderRow extends ResultRow {
  matchedMip?: string // "client · MIP" if a library project name/MIP/variant matches
}

const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Match a creative name to a library MIP/variant (substring on normalized names). */
function matchLibrary(creative: string): string | undefined {
  const n = normName(creative)
  for (const r of listProjects()) {
    const d = loadProjectData(r.id)
    const m = d?.project.meta
    const tags = [m?.mip, r.name, ...((m?.variants ?? []).map((v) => v.name) ?? [])].filter(Boolean) as string[]
    if (tags.some((t) => t && n.includes(normName(t)))) return [m?.client, m?.mip || r.name].filter(Boolean).join(' · ')
  }
  return undefined
}

export function buildLeaderboard(rows: ResultRow[], metric: Metric): LeaderRow[] {
  return rows
    .map((r) => ({ ...r, matchedMip: matchLibrary(r.creative) }))
    .sort((a, b) => (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity))
}
