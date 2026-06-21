// QA fingerprint — distils one playable (a "MIP") into a normalized StyleProfile:
// the handful of style/SFX/animation signals we compare ACROSS MIPs of the same
// client. Pure (no React/store); operates on a ProjectData straight from the
// library. Every signal carries Provenance so the UI can deep-link to the exact
// scene/element behind a finding.

import type { Project, SceneDef, SceneElement } from '../../runtime/scene'
import type { ProjectData } from '../bridge'

// Where a signal came from — enough to open the project and select the element.
export interface Provenance {
  projectId: string
  sceneId: string
  sceneName: string
  elementId?: string
  elementName?: string
}

// A single representative value (the mode across the MIP) + where it was seen.
export interface Scalar<T> {
  value: T
  prov: Provenance
}
// A set of values, each mapped to the first place it appeared in this MIP.
export type Multi = Record<string, Provenance>

export interface StyleProfile {
  projectId: string
  name: string // project name — fallback MIP label
  client: string // '' when unassigned
  mip: string // meta.mip || project name
  mipVersion: string

  baseSize: string // "1080x1920"
  ctaFont: Scalar<string> | null // "Montserrat / 800" of the dominant CTA
  ctaPulse: Scalar<string> | null // dominant cta.pulse
  entrancePreset: Scalar<string> | null // dominant entrance preset
  avgEntranceMs: number | null // mean entrance duration (ms), rounded
  hasBgm: boolean

  fonts: Multi // "family / weight" used by text/cta/choice
  palette: Multi // normalized "#rrggbb" colors used anywhere
  sfxEvents: Multi // event names bound (project- or element-level)
  transitions: Multi // scene transition types used
  gameTemplates: Multi // game-mount templateIds used
}

function prov(projectId: string, sd: SceneDef, el?: SceneElement): Provenance {
  return { projectId, sceneId: sd.id, sceneName: sd.name, elementId: el?.id, elementName: el?.name }
}

// Normalize a CSS color to a lowercase 6-digit hex for stable comparison; alpha
// is dropped (palette identity, not opacity). rgb()/rgba() are converted; other
// forms (named colors, gradients) fall back to a trimmed lowercase string so they
// still compare equal to themselves.
export function normColor(c: string | undefined): string | null {
  if (!c) return null
  const s = c.trim().toLowerCase()
  if (!s) return null
  let m = /^#([0-9a-f]{3})$/.exec(s)
  if (m) return '#' + m[1].split('').map((h) => h + h).join('')
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s)
  if (m) return '#' + m[1]
  m = /^rgba?\(([^)]+)\)$/.exec(s)
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim())
    if (parts.length >= 3) {
      const hex = parts
        .slice(0, 3)
        .map((p) => {
          const n = p.endsWith('%') ? Math.round((parseFloat(p) / 100) * 255) : Math.round(parseFloat(p))
          return Math.max(0, Math.min(255, n || 0)).toString(16).padStart(2, '0')
        })
        .join('')
      return '#' + hex
    }
  }
  return s
}

// "family / weight" key. Undefined family/weight map to stable sentinels so two
// elements that both leave them unset compare equal (and equal to the runtime
// default rather than reading as a divergence).
function fontKey(el: SceneElement): string {
  const fam = el.text?.fontFamily?.trim() || 'default'
  const wt = el.text?.fontWeight ?? 400
  return `${fam} / ${wt}`
}

// Pick the most common value of a list; ties break on first-seen order.
function mode(items: { key: string; prov: Provenance }[]): Scalar<string> | null {
  if (!items.length) return null
  const counts = new Map<string, number>()
  const firstProv = new Map<string, Provenance>()
  for (const it of items) {
    counts.set(it.key, (counts.get(it.key) ?? 0) + 1)
    if (!firstProv.has(it.key)) firstProv.set(it.key, it.prov)
  }
  let best = items[0].key
  let bestN = -1
  for (const [k, n] of counts) if (n > bestN) ((best = k), (bestN = n))
  return { value: best, prov: firstProv.get(best)! }
}

function addMulti(into: Multi, key: string | null, p: Provenance): void {
  if (key == null) return
  if (!(key in into)) into[key] = p
}

export function fingerprint(projectId: string, data: ProjectData): StyleProfile {
  const project: Project = data.project
  const m = project.meta

  const fonts: Multi = {}
  const palette: Multi = {}
  const sfxEvents: Multi = {}
  const transitions: Multi = {}
  const gameTemplates: Multi = {}

  const ctaFonts: { key: string; prov: Provenance }[] = []
  const ctaPulses: { key: string; prov: Provenance }[] = []
  const entrancePresets: { key: string; prov: Provenance }[] = []
  const entranceMs: number[] = []

  // project-level audio
  for (const b of project.sfx ?? []) addMulti(sfxEvents, b.event, prov(projectId, project.scenes[0] ?? { id: '', name: '(project)' } as SceneDef))

  for (const sd of project.scenes) {
    if (sd.transition) addMulti(transitions, sd.transition.type, prov(projectId, sd))
    for (const el of sd.elements) {
      const p = prov(projectId, sd, el)

      // fonts (text-bearing elements)
      if (el.text && (el.type === 'text' || el.type === 'cta' || el.type === 'choice' || el.type === 'countdown')) {
        addMulti(fonts, fontKey(el), p)
        if (el.type === 'cta') ctaFonts.push({ key: fontKey(el), prov: p })
      }

      // colors
      for (const c of [el.text?.color, el.text?.strokeColor, el.box?.bgColor, el.box?.borderColor, el.bar?.color, el.dim?.color, el.choice?.selectColor, el.choice?.correctColor, el.choice?.wrongColor, el.endscene?.bgColor, el.endscene?.bgColor2, el.endscene?.bgColorL, el.endscene?.bgColorL2]) {
        addMulti(palette, normColor(c), p)
      }

      // cta pulse
      if (el.type === 'cta' && el.cta) ctaPulses.push({ key: el.cta.pulse, prov: p })

      // entrance animation
      const ent = el.animations?.entrance
      if (ent) {
        entrancePresets.push({ key: ent.preset, prov: p })
        if (typeof ent.durationMs === 'number') entranceMs.push(ent.durationMs)
      }

      // element-level sfx
      for (const b of el.sfx ?? []) addMulti(sfxEvents, b.event, p)

      // game templates
      if (el.type === 'game-mount' && el.game?.templateId) addMulti(gameTemplates, el.game.templateId, p)
    }
    // per-scene background color
    addMulti(palette, normColor(sd.bgColor), prov(projectId, sd))
  }
  addMulti(palette, normColor(m.bgMatchColor), prov(projectId, project.scenes[0] ?? ({ id: '', name: '(project)' } as SceneDef)))

  return {
    projectId,
    name: m.name || 'untitled',
    client: (m.client ?? '').trim(),
    mip: (m.mip ?? '').trim() || m.name || 'untitled',
    mipVersion: (m.mipVersion ?? '').trim(),
    baseSize: `${m.baseW}x${m.baseH}`,
    ctaFont: mode(ctaFonts),
    ctaPulse: mode(ctaPulses),
    entrancePreset: mode(entrancePresets),
    avgEntranceMs: entranceMs.length ? Math.round(entranceMs.reduce((a, b) => a + b, 0) / entranceMs.length) : null,
    hasBgm: !!project.bgm,
    fonts,
    palette,
    sfxEvents,
    transitions,
    gameTemplates,
  }
}
