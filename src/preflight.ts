// Per-network preflight — catches the things that get a playable REJECTED before
// you upload it: over the size budget, external runtime requests (a playable must
// be fully self-contained), missing MRAID where required, and a missing/placeholder
// store click URL. Pure + framework-free so it can also run in CI later.

import type { Project } from '../runtime/scene'
import { fmtBytes, type Network } from './export'

export type Level = 'error' | 'warn' | 'info'
export interface Finding {
  level: Level
  message: string
}
export interface PreflightResult {
  net: string
  tag: string
  bytes: number
  max: number
  findings: Finding[]
  errors: number
  warns: number
}

// Per-network size ceilings (bytes). Most playable specs are 5 MB; Facebook is
// stricter at 2 MB. Tweak as networks change their limits.
const NET_MAX: Record<string, number> = {
  fb: 2 * 1024 * 1024,
}
const DEFAULT_MAX = 5 * 1024 * 1024

// Resources loaded AT RUNTIME from the network (must be inlined instead). Matches
// src=/href=/CSS url()/@import/fetch() pointing at http(s). The store click URL
// lives in a JSON string (not a resource attribute) so it's intentionally ignored;
// injected mraid.js / exitapi.js are relative, so they don't match either.
const RESOURCE_URL = /(?:\b(?:src|href)\s*=\s*["']\s*https?:)|(?:url\(\s*['"]?\s*https?:)|(?:@import\s+["']\s*https?:)|(?:fetch\(\s*["'`]\s*https?:)/gi
const PLACEHOLDER = /id000000000|com\.example\.app/i

export function preflightNetwork(net: Network, html: string, bytes: number, project: Project): PreflightResult {
  const findings: Finding[] = []
  const max = NET_MAX[net.tag] ?? DEFAULT_MAX

  if (bytes > max) findings.push({ level: 'error', message: `${fmtBytes(bytes)} exceeds the ${fmtBytes(max)} limit for ${net.name}.` })
  else if (bytes > max * 0.9) findings.push({ level: 'warn', message: `${fmtBytes(bytes)} is within 10% of the ${fmtBytes(max)} limit.` })

  const ext = html.match(RESOURCE_URL) ?? []
  if (ext.length) findings.push({ level: 'error', message: `${ext.length} external resource reference(s); playables must inline everything (no http(s) in src/href/url()/fetch).` })

  const ctaMode = project.meta.clickUrlMode ?? 'store'
  const click = project.meta.clickUrl
  if (ctaMode !== 'none') {
    if (!click || (!click.ios && !click.android)) findings.push({ level: 'error', message: 'No store click URL set (Project settings).' })
    else if (PLACEHOLDER.test(click.ios ?? '') || PLACEHOLDER.test(click.android ?? '')) findings.push({ level: 'warn', message: 'Store click URL is still the placeholder. Set the real App Store / Play URLs.' })
  }

  const hasCta = project.scenes.some((s) => s.elements.some((e) => e.type === 'cta' || e.type === 'endscene'))
  if (!hasCta) findings.push({ level: 'warn', message: 'No CTA or endscene element; players have no obvious click-to-store.' })

  const interactive = project.scenes.some((s) => s.advance?.on === 'tap' || s.elements.some((e) => e.type === 'game-mount' || e.type === 'cta' || e.type === 'choice'))
  if (!interactive) findings.push({ level: 'warn', message: 'No interaction (game, CTA, choice or tap-to-advance); many networks reject static playables.' })

  if (net.injectMraid) {
    if (!/mraid\.js/.test(html)) findings.push({ level: 'error', message: 'MRAID network but mraid.js is not present in the output.' })
    // Networks reject creatives that call MRAID APIs while the container is still
    // loading. The runtime guards this in initMraid() (getState() + the 'ready'
    // listener), so these strings surviving minification is the regression check.
    if (!/getState/.test(html) || !/["']ready["']/.test(html))
      findings.push({ level: 'error', message: 'No MRAID ready guard in the output: APIs must wait for the ready event or a non-loading getState().' })
    if (!/\.open\(/.test(html))
      findings.push({ level: 'warn', message: 'No mraid.open() call found; MRAID click-throughs must go through mraid.open().' })
  }

  return {
    net: net.name,
    tag: net.tag,
    bytes,
    max,
    findings,
    errors: findings.filter((f) => f.level === 'error').length,
    warns: findings.filter((f) => f.level === 'warn').length,
  }
}
