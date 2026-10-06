// The Slack post for a finished AppLovin upload — the three lines that get pasted
// into the delivery channel:
//
//   2026.09.29 - Memowrite - Halloween SIPs (MIP7 and MIP8)
//   Applovin                                   <- the word carries the preview link
//   Sirs and Ma'ams @Anthony Castor @Jero Santos ...
//
// Slack's composer keeps a link that arrives as HTML on the clipboard, so the post
// is built twice: `slackPostHtml` for the rich flavour (the word "Applovin" is the
// anchor) and `slackPostText` as the plain fallback, which spells the URL out
// instead — a paste must never lose the link.

/** One preview link, with the row label it was uploaded under. */
export interface SlackLink {
  label: string
  url: string
}

export interface SlackPostInput {
  /** Headline date, any format with a Y-M-D in it; blank falls back to today. */
  date?: string
  /** Brand, e.g. "Memowrite". */
  client?: string
  /** The batch's theme, e.g. "Halloween". */
  theme?: string
  /** What the batch delivered, one entry per file. */
  kinds: ('mip' | 'variant' | 'sip')[]
  /** The MIP numbers in the batch, e.g. ["MIP7", "MIP8"]. */
  mips: string[]
  links: SlackLink[]
  mentions: string
}

export const DEFAULT_MENTIONS = "Sirs and Ma'ams @Anthony Castor @Jero Santos @Blanche Colenne Hernandez @Gian Sy @Emil Son Francia @Mark Balutan"

/** The word the preview link is embedded in. */
export const LINK_WORD = 'Applovin'

const pad = (n: number): string => String(n).padStart(2, '0')

/** "2026-09-29" -> "2026.09.29". Anything unparseable reads as today. */
export function dottedDate(value?: string): string {
  const m = (value ?? '').match(/(\d{4})\D?(\d{2})\D?(\d{2})/)
  if (m) return `${m[1]}.${m[2]}.${m[3]}`
  const d = new Date()
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
}

/** "MIP7" / "MIP7 and MIP8" / "MIP7, MIP8 and MIP9" — duplicates dropped. */
export function joinList(parts: string[]): string {
  const list = [...new Set(parts.filter((p) => p.trim()))]
  if (list.length <= 1) return list[0] ?? ''
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** "SIPs", "MIP", "MIPs and SIPs" — plural per kind, by how many of it shipped. */
export function kindPhrase(kinds: SlackPostInput['kinds']): string {
  // A variant is another cut of the MIP, so it counts on the MIP side.
  const mips = kinds.filter((k) => k !== 'sip').length
  const sips = kinds.filter((k) => k === 'sip').length
  const word = (n: number, w: string): string => (n > 1 ? `${w}s` : w)
  if (mips && sips) return `${word(mips, 'MIP')} and ${word(sips, 'SIP')}`
  if (sips) return word(sips, 'SIP')
  return word(mips || 1, 'MIP')
}

/**
 * The theme slot of the headline, read off the project-group name by dropping the
 * client and any date tokens: "Memowrite 2026-09 Halloween" -> "Halloween".
 */
export function themeFromProjectName(projectName?: string, client?: string): string {
  let s = (projectName ?? '').trim()
  if (!s) return ''
  const c = (client ?? '').trim()
  if (c) s = s.replace(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
  s = s.replace(/\b\d{4}([-./]\d{1,2}){0,2}\b/g, ' ').replace(/[-–—]+/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

/** "2026.09.29 - Memowrite - Halloween SIPs (MIP7 and MIP8)". */
export function slackHeadline(input: SlackPostInput): string {
  const mips = joinList(input.mips)
  const subject = [input.theme?.trim(), kindPhrase(input.kinds)].filter(Boolean).join(' ')
  const tail = mips ? `${subject} (${mips})` : subject
  // Empty slots collapse instead of leaving a dangling " - ".
  return [dottedDate(input.date), input.client?.trim(), tail].filter(Boolean).join(' - ')
}

/** The link lines: one bare "Applovin" for a single file, else one per file. */
export function linkLines(links: SlackLink[]): { prefix: string; url: string }[] {
  if (links.length === 1) return [{ prefix: '', url: links[0].url }]
  return links.map((l) => ({ prefix: l.label ? `${l.label} - ` : '', url: l.url }))
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The post as plain text — the URL is spelled out, since nothing can carry it. */
export function slackPostText(input: SlackPostInput): string {
  const lines = [slackHeadline(input)]
  for (const l of linkLines(input.links)) lines.push(`${l.prefix}${LINK_WORD} - ${l.url}`)
  if (!input.links.length) lines.push(LINK_WORD)
  if (input.mentions.trim()) lines.push(input.mentions.trim())
  return lines.join('\n')
}

/** The post as HTML — "Applovin" is the anchor, so a Slack paste keeps the link. */
export function slackPostHtml(input: SlackPostInput): string {
  const lines = [esc(slackHeadline(input))]
  for (const l of linkLines(input.links)) {
    lines.push(`${esc(l.prefix)}<a href="${esc(l.url)}">${LINK_WORD}</a>`)
  }
  if (!input.links.length) lines.push(LINK_WORD)
  if (input.mentions.trim()) lines.push(esc(input.mentions.trim()))
  return lines.map((l) => `<div>${l}</div>`).join('')
}

/**
 * Put the post on the clipboard in both flavours, so Slack's composer takes the
 * rich one (link embedded) and a plain editor still gets the URL. Falls back to a
 * plain-text write wherever ClipboardItem is missing or refused.
 */
export async function copySlackPost(input: SlackPostInput): Promise<boolean> {
  const text = slackPostText(input)
  try {
    const CI = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
    if (CI && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new CI({
          'text/html': new Blob([slackPostHtml(input)], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      return true
    }
  } catch {
    // Rich write refused (older Electron/browser, or no focus) — plain text still works.
  }
  try {
    await navigator.clipboard?.writeText(text)
    return true
  } catch {
    return false
  }
}
