// Per-network preflight — catches the things that get a playable REJECTED before
// you upload it: over the size budget, external runtime requests (a playable must
// be fully self-contained), missing MRAID where required, and a missing/placeholder
// store click URL. Pure + framework-free so it can also run in CI later.

import type { Project } from '../runtime/scene'
import { fmtBytes, type Network } from './export'
import { coversYearFrom, usesHolidayToken, validatePromoCalendar } from './promoCalendar'
import { subconceptToken } from './mipName'

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

/**
 * Dynamic-holiday checks. The failure this exists to catch is silent: a {holiday} label
 * whose calendar has run out renders an EMPTY string, so the creative ships looking fine
 * on the day it was built and blank three months into its flight.
 */
function holidayFindings(project: Project): Finding[] {
  const out: Finding[] = []
  const calendar = project.meta.promoCalendar ?? []
  const uses = usesHolidayToken(project)
  const hidesOnHoliday = project.scenes.some((s) => s.elements.some((e) => e.countdown?.showWhen && e.countdown.showWhen !== 'always'))
  if (!uses && !hidesOnHoliday) return out

  const subconcept = subconceptToken(project.meta)
  if (subconcept !== 'dh' && subconcept !== 'dtd') {
    out.push({ level: 'info', message: `This MIP uses the promo calendar but its Subconcept is “${subconcept}” — dynamic-holiday builds are usually delivered as “dh”.` })
  }
  if (!calendar.length) {
    out.push({ level: 'warn', message: 'No promo calendar on this MIP: {holiday} renders an empty label and every “only when there IS a promo” element stays hidden.' })
    return out
  }
  // Twelve months from the delivery date, since a MIP flights long after it is built.
  const from = project.meta.exportDate || project.meta.mipDate
  if (from && !coversYearFrom(calendar, from)) {
    out.push({ level: 'warn', message: `The promo calendar does not cover the 12 months from ${from} — the label goes empty part-way through the flight.` })
  }
  for (const problem of validatePromoCalendar(calendar)) {
    out.push({ level: problem.level === 'error' ? 'warn' : 'info', message: `Promo calendar: ${problem.message}` })
  }
  return out
}

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

  findings.push(...holidayFindings(project))

  const interactive = project.scenes.some((s) => s.advance?.on === 'tap' || s.elements.some((e) => e.type === 'game-mount' || e.type === 'cta' || e.type === 'choice'))
  if (!interactive) findings.push({ level: 'warn', message: 'No interaction (game, CTA, choice or tap-to-advance); many networks reject static playables.' })

  // MRAID is checked on EVERY network: every export now ships the bridge tag and the
  // readiness guard (see MRAID_HEAD in export.ts), so a missing one is a build
  // regression regardless of which network the file is headed for.
  if (!/mraid\.js/.test(html)) findings.push({ level: 'error', message: 'mraid.js bridge declaration is not present in the output.' })
  // Networks reject creatives that call MRAID APIs while the container is still
  // loading. The head guard (isMraidUsable) and the runtime's initMraid() both check
  // getState() + the 'ready' listener, so these strings surviving minification is the
  // regression check.
  if (!/isMraidUsable/.test(html))
    findings.push({ level: 'error', message: 'No MRAID ready guard in the output: isMraidUsable() must gate every call into the container.' })
  // Validators STATIC-SCAN for these two literals — an equivalent check hidden behind
  // minified identifiers reads as missing and gets the creative rejected. The export
  // shell writes them out longhand (MRAID_HEAD / MRAID_BOOT), so their absence means the
  // gate was dropped or mangled.
  if (!/mraid\.addEventListener\(\s*["']ready["']/.test(html))
    findings.push({ level: 'error', message: 'No literal mraid.addEventListener("ready", …) in the output: initialization must visibly wait for the ready event.' })
  // The statement form, not just the comparison: scanners look for the guard itself —
  // `if (mraid.getState() === "loading")` — so a check hidden behind a local variable or a
  // helper reads as missing even when it behaves correctly.
  const guard = /if\s*\(\s*mraid\.getState\(\)\s*===\s*["']loading["']\s*\)\s*\{/.exec(html)
  if (!guard)
    findings.push({ level: 'error', message: 'No literal if (mraid.getState() === "loading") guard in the output: initialization must confirm the container is past loading.' })
  // ...and the ready subscription has to be INSIDE that branch. A branch body that calls a
  // wait helper is the same failure one level down: the scanner reads the body and finds
  // no mraid.addEventListener("ready", …) there.
  else if (!/mraid\.addEventListener\(\s*["']ready["']/.test(html.slice(guard.index, guard.index + 600)))
    findings.push({ level: 'error', message: 'The if (mraid.getState() === "loading") branch does not subscribe to the ready event inline: mraid.addEventListener("ready", …) must sit inside the guard, not behind a helper.' })
  // The clickout half of the same rule: a scanner that finds mraid.open() with no
  // isMraidUsable(mraid) guard beside it reports an unguarded call into the container,
  // however well the minified bundle actually behaves.
  if (!/mraid\.open\(/.test(html))
    findings.push({ level: 'warn', message: 'No literal mraid.open() call found; MRAID click-throughs must go through mraid.open().' })
  else if (!/isMraidUsable\(\s*mraid\s*\)/.test(html))
    findings.push({ level: 'error', message: 'mraid.open() is not visibly guarded: window.isMraidUsable(mraid) must gate it in unminified source.' })
  // Click macros: no single global is universal across DSPs, so the whole chain ships.
  const macros = ['clickTag', 'clickTag1', 'clickthrough', 'clickThrough'].filter((k) => !html.includes(k))
  if (macros.length)
    findings.push({ level: 'error', message: `Click macro chain incomplete — missing ${macros.join(', ')}; clickouts must fall back through all four.` })
  if (!/window\.open\(/.test(html))
    findings.push({ level: 'error', message: 'No window.open() fallback in the output: a clickout must still reach the browser when mraid.open() is unavailable or throws.' })

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
