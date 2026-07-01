// Engagement linter — single-project heuristics that catch playables that won't
// convert or will get stuck: no interaction, dead/stuck scenes, missing CTA, tiny
// tap targets / text, broken asset references, and sounds that never fire. Pure;
// findings deep-link to the offending scene/element.

import type { AssetMap } from '../../runtime/types'
import type { Project, SceneDef, SceneElement } from '../../runtime/scene'

export type Severity = 'error' | 'warn' | 'info'
export interface EngagementFinding {
  id: string
  severity: Severity
  message: string
  sceneId?: string
  sceneName?: string
  elementId?: string
}

// SFX events the runtime fires on its own (the rest only fire if a game emits them).
const WIRED_SFX = new Set(['gameStart', 'correct', 'wrong', 'gameWin', 'ctaClick', 'endscene'])

const isInteractive = (e: SceneElement): boolean => e.type === 'game-mount' || e.type === 'cta' || e.type === 'choice'
const advances = (s: SceneDef): boolean =>
  s.advance?.on === 'tap' || s.advance?.on === 'timer' || s.elements.some((e) => e.type === 'choice' && e.choice?.advance)

const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 }

export function lintEngagement(project: Project, assets: AssetMap): EngagementFinding[] {
  const out: EngagementFinding[] = []
  const { baseH } = project.meta
  const scenes = project.scenes
  const at = (s: SceneDef, extra?: Partial<EngagementFinding>): Partial<EngagementFinding> => ({ sceneId: s.id, sceneName: s.name, ...extra })

  // 1) any interaction at all
  const anyInteractive = scenes.some((s) => s.elements.some(isInteractive) || s.advance?.on === 'tap')
  if (!anyInteractive) out.push({ id: 'no-interaction', severity: 'error', message: 'The ad has no interaction (no game, CTA, choice or tap-to-advance). Players can only watch.' })

  // 2) a click-out exists
  const hasCta = scenes.some((s) => s.elements.some((e) => e.type === 'cta' || e.type === 'endscene'))
  if (!hasCta) out.push({ id: 'no-cta', severity: 'warn', message: 'No CTA or endscene anywhere. There is no clear click-to-store.' })

  scenes.forEach((s, i) => {
    const last = i === scenes.length - 1
    const on = s.advance?.on ?? 'manual'

    // 3) stuck scene: a non-final scene the player can't get past
    if (!last && on === 'manual' && !advances(s)) {
      out.push({ id: `stuck:${s.id}`, severity: 'error', message: `Scene “${s.name}” can't be advanced (manual, with no Continue/choice or tap); the ad dead-ends here.`, ...at(s) })
    }
    // 4) waits for a game win that can't happen
    if (on === 'gameWin' && !s.elements.some((e) => e.type === 'game-mount')) {
      out.push({ id: `nowin:${s.id}`, severity: 'error', message: `Scene “${s.name}” advances on “game won” but has no mini-game to win.`, ...at(s) })
    }

    for (const e of s.elements) {
      // 5) broken asset reference
      if (e.assetId && !assets[e.assetId]) {
        out.push({ id: `asset:${e.id}`, severity: 'error', message: `“${e.name}” references a missing asset (${e.assetId}).`, ...at(s, { elementId: e.id }) })
      }
      // 6) small tap target on a tappable element
      if ((e.type === 'cta' || e.type === 'choice') && e.h != null && e.h < baseH * 0.055) {
        out.push({ id: `tap:${e.id}`, severity: 'warn', message: `“${e.name}” is a small tap target (${Math.round(e.h)}px tall); easy to miss on a phone.`, ...at(s, { elementId: e.id }) })
      }
      // 7) tiny text
      if (e.text && e.type !== 'countdown' && e.text.fontSizePx < baseH * 0.018) {
        out.push({ id: `text:${e.id}`, severity: 'info', message: `“${e.name}” text is small (${e.text.fontSizePx}px); may be hard to read.`, ...at(s, { elementId: e.id }) })
      }
    }
  })

  // 8) sounds that never fire
  const hasGame = scenes.some((s) => s.elements.some((e) => e.type === 'game-mount'))
  for (const b of project.sfx ?? []) {
    if (b.assetId && !assets[b.assetId]) out.push({ id: `sfx-miss:${b.event}`, severity: 'warn', message: `Sound for “${b.event}” points at a missing asset.` })
    else if (!WIRED_SFX.has(b.event) && !hasGame) out.push({ id: `sfx-dead:${b.event}`, severity: 'info', message: `Sound for “${b.event}” won't play; no game in this MIP emits that event.` })
  }
  if (project.bgm?.assetId && !assets[project.bgm.assetId]) out.push({ id: 'bgm-miss', severity: 'warn', message: 'Background music points at a missing asset.' })

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity])
}
