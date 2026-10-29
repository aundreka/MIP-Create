// Reads the export shell out of the reference creatives in docs/ — mip_sample.html and
// sip_sample.html. Those two files are the source of truth for every network-facing part
// of an export (head order, the mraid.js bridge, the readiness helper, the click-through,
// the tap debounce, the lifecycle hooks, the boot gate, the ?date= override); the
// builder's own runtime only renders the creative inside that shell.
//
// The samples change whenever the guidelines do, so nothing here is copied by hand:
// `npm run sync:samples` (scripts/sync-export-samples.mjs) runs these extractors and writes
// the result to src/exportShell.generated.ts, and src/exportShell.test.ts fails while that
// file is out of step with the samples. Every piece is taken VERBATIM — validators
// static-scan for these exact shapes.
//
// An anchor that is not found throws, naming the sample and what was looked for: a sample
// that moved on structurally needs the extractor updated, never a silently partial shell.

/** Fail loudly: a missing anchor means the sample's structure changed. */
function need(value, sample, what) {
  if (value === null || value === undefined || value === -1 || value === '') {
    throw new Error(`${sample}: could not find ${what}. The sample's structure changed — update scripts/export-shell.mjs to match it.`)
  }
  return value
}

/** Index of the start of the line holding `i`. */
const lineStart = (s, i) => s.lastIndexOf('\n', i - 1) + 1

/** Drop base64 payloads (fonts, videos) so a shell piece never carries a sample's assets. */
const hasPayload = (s) => /;base64,[A-Za-z0-9+/=]{200,}/.test(s)

/**
 * Source of `function name(...) { ... }` from `src`, brace-matched. Skips strings,
 * template literals and comments so a brace inside one does not end the body early.
 */
export function functionSource(src, name, sample) {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(src)
  need(m, sample, `function ${name}()`)
  let i = src.indexOf('{', src.indexOf(')', m.index))
  let depth = 0
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
    } else if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i)
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1
    } else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return src.slice(m.index, i + 1)
  }
  throw new Error(`${sample}: function ${name}() has no closing brace.`)
}

/** The global the sample's ?date= script publishes its date accessor under. */
function dateAccessor(script, sample) {
  const m = /window\.([A-Za-z_$][\w$]*)\s*=\s*function\s*\(\s*\)\s*\{\s*return\s+preview/.exec(script)
  return need(m, sample, 'the ?date= accessor (window.X = function () { return preview… })')[1]
}

// ---------------------------------------------------------------------------
// MIP — docs/mip_sample.html
// ---------------------------------------------------------------------------
// The whole MRAID contract lives in <head>, ahead of the creative: bridge, readiness
// helper, handleClickAction, media viewability, the loading-state gate (which releases a
// boot flag/callback pair the bundle waits on), then the ?date= override.
export function extractMip(html, sample = 'docs/mip_sample.html') {
  const headOpen = need(html.indexOf('<head>'), sample, '<head>') + '<head>'.length
  const bridge = need(html.indexOf('<script src="mraid.js"></script>'), sample, '<script src="mraid.js"></script>')
  if (html.slice(headOpen, bridge).trim()) throw new Error(`${sample}: the mraid.js bridge is no longer the first thing in <head> — update scripts/export-shell.mjs.`)
  const meta = need(html.indexOf('<meta', bridge), sample, '<meta> after the head scripts')
  const title = need(html.indexOf('<title', meta), sample, '<title>')
  const headClose = need(html.indexOf('</head>'), sample, '</head>')

  const headScripts = html.slice(bridge, lineStart(html, meta))
  const out = {
    htmlOpen: html.slice(0, headOpen) + '\n',
    headScripts,
    meta: html.slice(lineStart(html, meta), lineStart(html, title)),
    titleIndent: html.slice(lineStart(html, title), title),
    tail: html.slice(lineStart(html, headClose)),
    dateAccessor: dateAccessor(headScripts, sample),
  }
  // The boot handshake: init() sets window.<flag> = true and calls window.<callback>().
  const boot = /window\.([A-Za-z_$][\w$]*)\s*=\s*true;\s*if\s*\(\s*typeof\s+window\.([A-Za-z_$][\w$]*)\s*===\s*"function"\s*\)/.exec(headScripts)
  need(boot, sample, 'the boot release (window.<flag> = true; if (typeof window.<callback> === "function") …)')
  out.bootFlag = boot[1]
  out.bootCallback = boot[2]
  need(/window\.handleClickAction\s*=\s*function/.test(headScripts) || null, sample, 'window.handleClickAction = function … in the head helper')
  need(/window\.isMraidUsable\s*=/.test(headScripts) || null, sample, 'window.isMraidUsable in the head helper')
  // trackMraidReadiness is what the runtime uses to tell it is running inside this shell.
  need(/window\.trackMraidReadiness\s*=/.test(headScripts) || null, sample, 'window.trackMraidReadiness in the head helper')
  if (hasPayload(out.headScripts + out.meta + out.tail)) throw new Error(`${sample}: a shell piece picked up a base64 payload — update scripts/export-shell.mjs.`)
  return out
}

// ---------------------------------------------------------------------------
// SIP — docs/sip_sample.html
// ---------------------------------------------------------------------------
// The SIP sample is a video template; the builder's SIP renders the chosen end card with
// its runtime instead (an HTML import, a video or an image card, plus anything added on
// top). What is taken from the sample is everything that is not the video template: the
// head order, the bridge + readiness helper, the ?date= script, and from the body script
// the click-through, the tap debounce, the lifecycle hooks and the DOM + MRAID boot gate.
export function extractSip(html, sample = 'docs/sip_sample.html') {
  const headOpen = need(html.indexOf('<head>'), sample, '<head>') + '<head>'.length
  const title = need(html.indexOf('<title'), sample, '<title>')
  const titleEnd = need(html.indexOf('</title>', title), sample, '</title>') + '</title>'.length
  const bridge = need(html.indexOf('<script src="mraid.js"></script>'), sample, '<script src="mraid.js"></script>')
  const helperEnd = need(html.indexOf('</script>', html.indexOf('<script>', bridge)), sample, 'the readiness helper after the bridge') + '</script>'.length
  const helper = html.slice(lineStart(html, bridge), helperEnd)
  need(/window\.isMraidUsable\s*=/.test(helper) || null, sample, 'window.isMraidUsable in the helper after the bridge')

  const dateOpen = need(html.search(/<script[^>]*>\(function\(\)\{var value=new URLSearchParams/), sample, 'the ?date= override <script>')
  const dateScript = html.slice(dateOpen, html.indexOf('</script>', dateOpen) + '</script>'.length)

  // The body script that carries the runtime — the one defining startAdRuntime().
  const bodyAt = need(html.indexOf('function startAdRuntime'), sample, 'function startAdRuntime()')
  const bodyOpen = html.lastIndexOf('<script>', bodyAt)
  const body = html.slice(bodyOpen, html.indexOf('</script>', bodyAt))
  const stmt = (re, what) => need(re.exec(body), sample, what)[0]

  const out = {
    htmlOpen: html.slice(0, headOpen) + '\n',
    meta: html.slice(html.indexOf('\n', headOpen) + 1, lineStart(html, title)),
    titleIndent: html.slice(lineStart(html, title), title),
    titleEnd,
    helper,
    dateScript,
    dateAccessor: dateAccessor(dateScript, sample),
    handleClickAction: functionSource(body, 'handleClickAction', sample),
    tapState: stmt(/let\s+lastTapAt\s*=\s*0;/, 'let lastTapAt = 0;'),
    handleTap: functionSource(body, 'handleTap', sample),
    setupMraidViewability: functionSource(body, 'setupMraidViewability', sample),
    lifecycleStubs: need(body.match(/^[ \t]*window\.(game\w+)\s*=\s*window\.\1\s*\|\|\s*function\s*\(\)\s*\{\};[ \t]*$/gm), sample, 'the window.gameX = window.gameX || function () {} stubs')
      .map((l) => l.trim())
      .join('\n'),
    signalPlayableLifecycle: functionSource(body, 'signalPlayableLifecycle', sample),
    pagehide: stmt(/window\.addEventListener\(\s*"pagehide",\s*\(\)\s*=>\s*\{\s*signalPlayableLifecycle\("gameClose"\);\s*\}\);/, 'the pagehide → signalPlayableLifecycle("gameClose") listener'),
    unloadFailedAd: functionSource(body, 'unloadFailedAd', sample),
    startedState: stmt(/let\s+adRuntimeStarted\s*=\s*false;/, 'let adRuntimeStarted = false;'),
    init: functionSource(body, 'init', sample),
    initializeMraidRuntime: functionSource(body, 'initializeMraidRuntime', sample),
  }
  need(/startAdRuntime\(\)/.test(out.init) || null, sample, 'init() calling startAdRuntime()')
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && hasPayload(v)) throw new Error(`${sample}: shell piece "${k}" picked up a base64 payload — update scripts/export-shell.mjs.`)
  }
  return out
}

/** The generated module's source: one JSON string literal per piece. */
export function renderGenerated(mip, sip) {
  const lines = [
    '// GENERATED by scripts/sync-export-samples.mjs from docs/mip_sample.html and',
    '// docs/sip_sample.html — do not edit. Update the samples and run `npm run sync:samples`',
    '// (or the /sync-export-samples skill); src/exportShell.test.ts fails while this is stale.',
    '',
  ]
  const emit = (prefix, obj) => {
    for (const [k, v] of Object.entries(obj)) lines.push(`export const ${prefix}_${k} = ${JSON.stringify(v)}`)
  }
  emit('MIP', mip)
  emit('SIP', sip)
  return lines.join('\n') + '\n'
}
