// QA consistency engine — groups the project library by client and diffs each
// MIP's StyleProfile against the client's "norm" (the majority value per signal),
// emitting Findings. Pure except for buildProfiles(), which reads the library.
// The norm is a simple majority: a signal is only flagged when there's a clear
// consensus to diverge from (>= half the MIPs agree), so a 2-MIP disagreement or
// a lone MIP never produces noise.

import { listProjects, loadProjectData } from '../projects'
import { fingerprint, type Multi, type Provenance, type Scalar, type StyleProfile } from './fingerprint'

export type Severity = 'error' | 'warn' | 'info'
export type Category =
  | 'base-size'
  | 'cta-font'
  | 'cta-pulse'
  | 'entrance-preset'
  | 'entrance-duration'
  | 'bgm'
  | 'font'
  | 'palette'
  | 'sfx-coverage'
  | 'transition'
  | 'game-template'

export interface Finding {
  id: string
  category: Category
  severity: Severity
  message: string
  projectId: string
  mip: string
  prov?: Provenance
  expected?: string
  actual?: string
}

const projProv = (p: StyleProfile): Provenance => ({ projectId: p.projectId, sceneId: '', sceneName: '' })

// ---- library access --------------------------------------------------------
export function buildProfiles(): StyleProfile[] {
  return listProjects()
    .map((r) => {
      const d = loadProjectData(r.id)
      return d ? fingerprint(r.id, d) : null
    })
    .filter((p): p is StyleProfile => p != null)
}

export function groupByClient(profiles: StyleProfile[]): Map<string, StyleProfile[]> {
  const map = new Map<string, StyleProfile[]>()
  for (const p of profiles) {
    const key = p.client || '(unassigned)'
    const arr = map.get(key) ?? []
    arr.push(p)
    map.set(key, arr)
  }
  return map
}

// ---- rules -----------------------------------------------------------------
// A signal that is a single value per MIP: flag MIPs that differ from the mode.
function scalarRule(
  profiles: StyleProfile[],
  category: Category,
  severity: Severity,
  label: string,
  get: (p: StyleProfile) => Scalar<string> | null,
): Finding[] {
  const present = profiles
    .map((p) => ({ p, s: get(p) }))
    .filter((x): x is { p: StyleProfile; s: Scalar<string> } => x.s != null)
  if (present.length < 2) return []
  const counts = new Map<string, number>()
  for (const x of present) counts.set(x.s.value, (counts.get(x.s.value) ?? 0) + 1)
  let norm = present[0].s.value
  let normN = -1
  for (const [k, n] of counts) if (n > normN) ((norm = k), (normN = n))
  if (normN < Math.ceil(present.length / 2)) return [] // no clear consensus
  return present
    .filter((x) => x.s.value !== norm)
    .map((x) => ({
      id: `${category}:${x.p.projectId}`,
      category,
      severity,
      message: `${label} is ${x.s.value}; client standard is ${norm}.`,
      projectId: x.p.projectId,
      mip: x.p.mip,
      prov: x.s.prov,
      expected: norm,
      actual: x.s.value,
    }))
}

// A signal that is a SET per MIP: flag MIPs missing a value the majority share
// (and, when flagExtra, a value unique to a single MIP).
function coverageRule(
  profiles: StyleProfile[],
  category: Category,
  severity: Severity,
  noun: string,
  get: (p: StyleProfile) => Multi,
  opts: { flagExtra?: boolean } = {},
): Finding[] {
  const total = profiles.length
  if (total < 2) return []
  const count = new Map<string, number>()
  for (const p of profiles) for (const v of Object.keys(get(p))) count.set(v, (count.get(v) ?? 0) + 1)
  const out: Finding[] = []
  const isCore = (v: string): boolean => (count.get(v) ?? 0) * 2 > total // strict majority
  for (const p of profiles) {
    const have = new Set(Object.keys(get(p)))
    for (const [v, n] of count) {
      if (!isCore(v) || have.has(v)) continue
      out.push({
        id: `${category}:${p.projectId}:miss:${v}`,
        category,
        severity,
        message: `Missing ${noun} "${v}" that ${n}/${total} MIPs share.`,
        projectId: p.projectId,
        mip: p.mip,
        prov: projProv(p),
        expected: v,
      })
    }
    if (opts.flagExtra && total >= 3) {
      const mine = get(p)
      for (const v of Object.keys(mine)) {
        if ((count.get(v) ?? 0) === 1) {
          out.push({
            id: `${category}:${p.projectId}:extra:${v}`,
            category,
            severity: 'info',
            message: `Uses ${noun} "${v}" that no other MIP uses.`,
            projectId: p.projectId,
            mip: p.mip,
            prov: mine[v],
            actual: v,
          })
        }
      }
    }
  }
  return out
}

// Entrance-duration deviation from the client median.
function durationRule(profiles: StyleProfile[]): Finding[] {
  const present = profiles.filter((p): p is StyleProfile & { avgEntranceMs: number } => p.avgEntranceMs != null)
  if (present.length < 2) return []
  const vals = present.map((p) => p.avgEntranceMs).sort((a, b) => a - b)
  const median = vals[Math.floor(vals.length / 2)] || 1
  const out: Finding[] = []
  for (const p of present) {
    const v = p.avgEntranceMs
    const ratio = v / median
    if (Math.abs(v - median) > 150 && (ratio > 1.6 || ratio < 0.625)) {
      out.push({
        id: `entrance-duration:${p.projectId}`,
        category: 'entrance-duration',
        severity: 'info',
        message: `Entrance animations average ~${v}ms; client norm is ~${median}ms.`,
        projectId: p.projectId,
        mip: p.mip,
        prov: projProv(p),
        expected: `~${median}ms`,
        actual: `~${v}ms`,
      })
    }
  }
  return out
}

const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 }

/** All findings for one client's MIPs, sorted error → warn → info. */
export function checkClient(profiles: StyleProfile[]): Finding[] {
  if (profiles.length < 2) return []
  const out: Finding[] = [
    ...scalarRule(profiles, 'base-size', 'error', 'Canvas size', (p) => ({ value: p.baseSize, prov: projProv(p) })),
    ...scalarRule(profiles, 'cta-font', 'warn', 'CTA font', (p) => p.ctaFont),
    ...scalarRule(profiles, 'cta-pulse', 'warn', 'CTA pulse', (p) => p.ctaPulse),
    ...scalarRule(profiles, 'entrance-preset', 'info', 'Entrance animation', (p) => p.entrancePreset),
    ...scalarRule(profiles, 'bgm', 'info', 'Background music', (p) => ({ value: p.hasBgm ? 'on' : 'off', prov: projProv(p) })),
    ...durationRule(profiles),
    ...coverageRule(profiles, 'sfx-coverage', 'warn', 'sound for event', (p) => p.sfxEvents),
    ...coverageRule(profiles, 'font', 'info', 'font', (p) => p.fonts, { flagExtra: true }),
    ...coverageRule(profiles, 'palette', 'info', 'color', (p) => p.palette),
    ...coverageRule(profiles, 'transition', 'info', 'transition', (p) => p.transitions),
    ...coverageRule(profiles, 'game-template', 'info', 'game', (p) => p.gameTemplates),
  ]
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.category.localeCompare(b.category) || a.mip.localeCompare(b.mip))
}
