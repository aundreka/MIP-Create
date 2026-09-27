// Matching the preview links the AppLovin upload page prints after "Upload" back to
// the files that were uploaded. A link looks like
//   http://playable.applovindemo.com/Preview/?&thm=al&h=<file stem>_<timestamp>.html&n=<iteration>
// so `n` names the row's Iteration Name and `h` the uploaded file.

/** The substring every AppLovin preview link carries. */
export const PREVIEW_LINK_MARK = 'applovindemo.com/Preview'

export interface UploadedFile {
  name: string
  iteration: string
}

export interface FileLink extends UploadedFile {
  link?: string
}

function params(link: string): URLSearchParams {
  try {
    return new URL(link).searchParams
  } catch {
    return new URLSearchParams()
  }
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Pair each uploaded file with its preview link: by iteration name (`n`), then by
 * file name (`h` is the file stem plus an upload timestamp), then whatever is left
 * in page order. Links that are not preview links are ignored.
 */
export function matchPreviewLinks(files: UploadedFile[], links: string[]): FileLink[] {
  const pool = [...new Set(links.filter((l) => l.includes(PREVIEW_LINK_MARK)))]
  const take = (pred: (l: string) => boolean): string | undefined => {
    const i = pool.findIndex(pred)
    return i < 0 ? undefined : pool.splice(i, 1)[0]
  }
  const out: FileLink[] = files.map((f) => ({ ...f }))
  for (const f of out) f.link = take((l) => norm(params(l).get('n') ?? '') === norm(f.iteration))
  for (const f of out) {
    if (f.link) continue
    const stem = f.name.replace(/\.html?$/i, '').toLowerCase()
    f.link = take((l) => (params(l).get('h') ?? '').toLowerCase().startsWith(stem + '_'))
  }
  for (const f of out) if (!f.link) f.link = take(() => true)
  return out
}

// Last links per MIP, so the Upload modal can show them again later. This browser only.
const KEY = 'pa:applovinLinks:'

export function saveLastLinks(mipKey: string, links: FileLink[]): void {
  try {
    localStorage.setItem(KEY + mipKey, JSON.stringify({ at: Date.now(), links }))
  } catch {
    // ignore storage failures
  }
}

export function readLastLinks(mipKey: string): { at: number; links: FileLink[] } | null {
  try {
    const raw = localStorage.getItem(KEY + mipKey)
    return raw ? (JSON.parse(raw) as { at: number; links: FileLink[] }) : null
  } catch {
    return null
  }
}
