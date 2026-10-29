// Per-network preflight — catches the things that get a playable REJECTED before
// you upload it: over the size budget, external runtime requests (a playable must
// be fully self-contained), missing MRAID where required, and a missing/placeholder
// store click URL. Pure + framework-free so it can also run in CI later.

import type { Project } from '../runtime/scene'
import { endsceneAssetIds, fmtBytes, shellKind, type Network } from './export'
import * as Shell from './exportShell.generated'
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

// The click identifiers networks reserve. Only the platform-injected window.clickTag may
// appear in a creative; a scanner that finds any of these rejects it ("reserved click
// identifier(s) … rename the rest or the tap won't redirect").
const RESERVED_CLICK_IDS = ['clickTag1', 'clickthrough', 'clickThrough']
// Browser navigation of any kind is a click-through that bypasses mraid.open().
const BROWSER_NAV = /window\s*\.\s*open|window\s*\[\s*["']open|\blocation\s*\.\s*href\s*=(?!=)|\blocation\s*\.\s*(?:assign|replace)\s*\(/
// A literal http(s):// anywhere in the file. Exports write every URL inside their scripts
// with escaped slashes (escapeUrls in export.ts), so a literal one is an unembedded
// reference as a validator counts it.
const LITERAL_URL = /https?:\/\/[^\s"'`<>)\\]+/gi

/** What a network validator reads the file for: the sample's shell, verbatim, and none of
 *  the patterns it rejects. The shell itself comes from docs/mip_sample.html /
 *  docs/sip_sample.html (src/exportShell.generated.ts), so these checks follow the
 *  samples whenever they change. */
function shellFindings(html: string, project: Project): Finding[] {
  const out: Finding[] = []
  const sip = shellKind(project) === 'sip'
  const sample = sip ? 'docs/sip_sample.html' : 'docs/mip_sample.html'
  const pieces: [string, string][] = sip
    ? [
        ['the head (<!doctype html> … <head>)', Shell.SIP_htmlOpen],
        ['the mraid.js bridge + readiness helper', Shell.SIP_helper],
        ['the ?date= override', Shell.SIP_dateScript],
        ['handleClickAction()', Shell.SIP_handleClickAction],
        ['the handleTap / lastTapAt debounce', Shell.SIP_handleTap],
        ['the MRAID viewability wiring', Shell.SIP_setupMraidViewability],
        ['the lifecycle hooks', Shell.SIP_lifecycleStubs],
        ['the DOM + MRAID boot gate', Shell.SIP_initializeMraidRuntime],
      ]
    : [
        ['the head (<!DOCTYPE html> … <head>)', Shell.MIP_htmlOpen],
        ['the mraid.js bridge, readiness helper, handleClickAction, boot gate and ?date= override', Shell.MIP_headScripts],
        // Split at the body tag: a network transform may give it attributes (Google's onload).
        ...Shell.MIP_tail.split('<body>').map((part, i): [string, string] => [i ? 'the body (<div id="app">)' : 'the end of <head>', i ? '>' + part : part + '<body']),
      ]
  const missing = pieces.filter(([, src]) => !html.includes(src)).map(([what]) => what)
  if (missing.length) out.push({ level: 'error', message: `The export shell no longer matches ${sample} — missing ${missing.join('; ')}. Run npm run sync:samples and rebuild.` })
  if (!html.startsWith(sip ? Shell.SIP_htmlOpen : Shell.MIP_htmlOpen))
    out.push({ level: 'error', message: `The file does not open the way ${sample} does (nothing may precede <!DOCTYPE html>).` })

  const bridges = html.match(/<script\s+src="mraid\.js"><\/script>/g) ?? []
  if (bridges.length !== 1) out.push({ level: 'error', message: `Expected exactly one <script src="mraid.js"></script>, found ${bridges.length}.` })

  const reserved = RESERVED_CLICK_IDS.filter((k) => html.includes(k))
  if (reserved.length)
    out.push({ level: 'error', message: `Reserved click identifier(s) ${reserved.join(', ')} in the output: only the platform's injected window.clickTag may appear, or the tap won't redirect.` })

  const nav = BROWSER_NAV.exec(html)
  if (nav) out.push({ level: 'error', message: `Browser navigation (${nav[0].trim()}) in the output: click-throughs must use mraid.open() only, and validators reject any reference to it (including comments).` })

  const urls = [...new Set(html.match(LITERAL_URL) ?? [])]
  if (urls.length)
    out.push({ level: 'error', message: `${urls.length} unembedded reference(s) — a literal URL reads as an external resource: ${urls.slice(0, 3).join(', ')}${urls.length > 3 ? ', …' : ''}` })

  out.push(...embeddedHtmlFindings(html))
  return out
}

/** Validators decode base64 HTML end cards and scan them as part of the creative, so an
 *  imported card's own window.open / logger / click macros count against the export. */
function embeddedHtmlFindings(html: string): Finding[] {
  const out: Finding[] = []
  const B64_HTML = /data:text\/html;base64,([A-Za-z0-9+/=]+)/g
  let m: RegExpExecArray | null
  while ((m = B64_HTML.exec(html))) {
    let inner = ''
    try {
      inner = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)))
    } catch {
      continue
    }
    const problems: string[] = []
    const nav = BROWSER_NAV.exec(inner)
    if (nav) problems.push(nav[0].trim())
    const reserved = RESERVED_CLICK_IDS.filter((k) => inner.includes(k))
    if (reserved.length) problems.push(`reserved click identifier(s) ${reserved.join(', ')}`)
    const urls = [...new Set(inner.match(LITERAL_URL) ?? [])].filter((u) => !/^https?:\/\/www\.w3\.org\//i.test(u))
    if (urls.length) problems.push(`external reference(s) ${urls.slice(0, 3).join(', ')}${urls.length > 3 ? ', …' : ''}`)
    if (/<script[^>]*\bsrc\s*=\s*["']mraid\.js/i.test(inner)) problems.push('its own mraid.js bridge')
    if (problems.length)
      out.push({ level: 'error', message: `An imported HTML end card contains ${problems.join('; ')}. Validators decode embedded HTML and scan it too — fix the card's source and re-import it.` })
  }
  return out
}

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

// An asset whose src stayed an http(s) URL. RESOURCE_URL cannot see these: a PA_ASSETS
// entry is JSON (`"src":"https://…"`), not a resource attribute, and the runtime only
// assigns it to an element once that asset is shown. The file therefore passes every
// attribute-level scan and still fetches over the network inside the container.
const REMOTE_ASSET_SRC = /"src"\s*:\s*"\s*https?:/gi

/** The PA_ASSETS src of one asset id in a built export, or null when the id is absent.
 * A bounded forward scan rather than a JSON.parse: the asset map is most of a 5MB file
 * and preflight runs once per network. */
function assetSrcInHtml(html: string, id: string): string | null {
  const at = html.indexOf(`${JSON.stringify(id)}:{`)
  if (at < 0) return null
  const window_ = html.slice(at, at + 512)
  const m = /"src"\s*:\s*"([^"]{0,80})/.exec(window_)
  return m ? m[1] : null
}

export function preflightNetwork(net: Network, html: string, bytes: number, project: Project): PreflightResult {
  const findings: Finding[] = []
  const max = NET_MAX[net.tag] ?? DEFAULT_MAX

  if (bytes > max) findings.push({ level: 'error', message: `${fmtBytes(bytes)} exceeds the ${fmtBytes(max)} limit for ${net.name}.` })
  else if (bytes > max * 0.9) findings.push({ level: 'warn', message: `${fmtBytes(bytes)} is within 10% of the ${fmtBytes(max)} limit.` })

  const ext = html.match(RESOURCE_URL) ?? []
  if (ext.length) findings.push({ level: 'error', message: `${ext.length} external resource reference(s); playables must inline everything (no http(s) in src/href/url()/fetch).` })

  const remoteAssets = html.match(REMOTE_ASSET_SRC) ?? []
  if (remoteAssets.length)
    findings.push({
      level: 'error',
      message: `${remoteAssets.length} asset(s) ship a remote http(s) src instead of inline base64 — they will be fetched over the network at runtime. Re-export with those assets reachable, or re-upload them as local files.`,
    })

  // Endscene media is assigned from PA_ASSETS at runtime (<video>.src / <img>.src /
  // iframe srcdoc), so a missing or non-base64 entry is invisible everywhere else: the
  // card renders fine in the editor and ships as a bare background colour, or as a
  // network fetch. Checked against the BUILT file, per id, so it also catches an asset
  // the pruning walk dropped.
  for (const id of endsceneAssetIds(project)) {
    const src = assetSrcInHtml(html, id)
    if (src === null) findings.push({ level: 'error', message: `Endscene asset "${id}" is not in PA_ASSETS; the end card will play as a bare background.` })
    else if (!/^data:[^,]*;base64,/i.test(src)) findings.push({ level: 'error', message: `Endscene asset "${id}" is not base64-encoded in the output (src starts "${src.slice(0, 40)}").` })
  }

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

  findings.push(...shellFindings(html, project))

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
