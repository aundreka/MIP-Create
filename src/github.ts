// Push to GitHub. Commits every MIP in the current project group to the linked
// repository as plain folders ("MIP1 - SCRATCH/", not a zip): each holds the Vite
// source project (media as real files, see viteExport.ts) plus the delivered
// MIP / variant / SIP HTML. Talks to the GitHub REST API directly (Git Data API:
// blobs -> tree -> commit -> ref), so it works in the desktop app and the browser.
//
// The repository link is stored per project group on this machine; the token
// (a fine-grained PAT with Contents read/write) lives in the OS keychain on
// desktop (Electron safeStorage) and in localStorage in the browser. Neither is
// ever written into the project file or the team library.

import { buildDeliveryFiles } from './deliver'
import { fetchRuntimeSrc } from './export'
import { currentProjectId } from './projects'
import { getState } from './store'
import { collectCurrentProjectViteSources, playableSourceFiles, type SourceFile } from './viteExport'

export interface GithubLink {
  owner: string
  repo: string
  branch: string
  /** Optional folder inside the repo the MIP folders go under ('' = repo root). */
  dir: string
}

// ---- link + token storage -------------------------------------------------------------

const LINK_PREFIX = 'pa:github:'
const TOKEN_KEY = 'pa:githubToken'

/** Storage key for the current MIP's link: its project group, else the MIP itself. */
function linkKey(): string {
  const groupId = getState().project.meta.projectId
  return LINK_PREFIX + (groupId ? `group:${groupId}` : `mip:${currentProjectId() ?? 'unsaved'}`)
}

/** Parse "owner/repo", "github.com/owner/repo" or a full clone URL. */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const m = input.trim().match(/^(?:(?:https?:\/\/)?(?:www\.)?github\.com[/:])?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)
  return m ? { owner: m[1], repo: m[2] } : null
}

export function readGithubLink(): GithubLink | null {
  try {
    const raw = localStorage.getItem(linkKey())
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<GithubLink>
    if (!v.owner || !v.repo) return null
    return { owner: v.owner, repo: v.repo, branch: v.branch || 'main', dir: normalizeDir(v.dir ?? '') }
  } catch {
    return null
  }
}

export function writeGithubLink(link: GithubLink | null): void {
  try {
    if (link) localStorage.setItem(linkKey(), JSON.stringify({ ...link, dir: normalizeDir(link.dir) }))
    else localStorage.removeItem(linkKey())
  } catch {
    // ignore storage failures
  }
}

const normalizeDir = (dir: string): string => dir.split('/').map((s) => s.trim()).filter(Boolean).join('/')

interface SecretApi {
  secretGet?(name: string): Promise<{ ok: boolean; value?: string }>
  secretSet?(name: string, value: string): Promise<{ ok: boolean; error?: string }>
}
const secrets = (): SecretApi | undefined => (window as unknown as { editorAPI?: SecretApi }).editorAPI

export async function readGithubToken(): Promise<string> {
  const api = secrets()
  if (api?.secretGet) return (await api.secretGet(TOKEN_KEY)).value ?? ''
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export async function writeGithubToken(token: string): Promise<void> {
  const api = secrets()
  if (api?.secretSet) {
    const r = await api.secretSet(TOKEN_KEY, token.trim())
    if (!r.ok) throw new Error(r.error || 'could not save the token')
    return
  }
  try {
    if (token.trim()) localStorage.setItem(TOKEN_KEY, token.trim())
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore storage failures
  }
}

/** True when tokens are kept in the OS keychain (desktop), not localStorage. */
export const tokenInKeychain = (): boolean => !!secrets()?.secretSet

// ---- GitHub REST ----------------------------------------------------------------------

type Fetch = typeof fetch

class GithubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function client(token: string, fetchImpl: Fetch) {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetchImpl('https://api.github.com' + path, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!r.ok) {
      let msg = `${r.status} ${r.statusText}`
      try {
        const j = (await r.json()) as { message?: string }
        if (j.message) msg = `${r.status}: ${j.message}`
      } catch {
        // keep the status line
      }
      throw new GithubError(r.status, msg)
    }
    return (r.status === 204 ? undefined : await r.json()) as T
  }
}

const enc = new TextEncoder()
const bytesOf = (data: string | Uint8Array): Uint8Array => (typeof data === 'string' ? enc.encode(data) : data)

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Git's blob id: sha1("blob <len>\0" + bytes). Lets a push skip unchanged files. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const head = enc.encode(`blob ${bytes.length}\0`)
  const all = new Uint8Array(head.length + bytes.length)
  all.set(head)
  all.set(bytes, head.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
}

export interface PushResult {
  commitUrl: string
  /** Files added, changed or removed. 0 means nothing differed and no commit was made. */
  changed: number
}

interface TreeEntry {
  path: string
  mode: '100644'
  type: 'blob'
  sha: string | null
}

/**
 * Commit `files` (repo-relative paths) to `link.branch` in one commit. Files that
 * already match are skipped; files under any of `ownedDirs` that are not in
 * `files` are deleted, so a replaced image or a renamed build does not linger.
 * Creates the branch (from the default branch) or the first commit of an empty
 * repository when needed. Retries once if the branch moved during the push.
 */
export async function pushFiles(opts: {
  token: string
  link: GithubLink
  files: SourceFile[]
  ownedDirs: string[]
  message: string
  onProgress?: (msg: string) => void
  fetchImpl?: Fetch
}): Promise<PushResult> {
  const gh = client(opts.token, opts.fetchImpl ?? fetch.bind(globalThis))
  const { owner, repo, branch } = opts.link
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const refPath = `${base}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`
  const progress = opts.onProgress ?? (() => {})

  const prepared = await Promise.all(
    opts.files.map(async (f) => {
      const bytes = bytesOf(f.data)
      return { path: f.path, bytes, sha: await gitBlobSha(bytes) }
    }),
  )
  const wanted = new Set(prepared.map((f) => f.path))
  const owned = opts.ownedDirs.map((d) => d.replace(/\/+$/, '') + '/')

  const headSha = async (): Promise<string | null> => {
    try {
      return (await gh<{ object: { sha: string } }>('GET', refPath)).object.sha
    } catch (e) {
      if (!(e instanceof GithubError) || (e.status !== 404 && e.status !== 409)) throw e
    }
    // No such branch. An empty repository answers 409 on every git/ read; seed it
    // with a README through the contents API, which creates the branch.
    const info = await gh<{ default_branch: string; size: number }>('GET', base)
    try {
      const def = await gh<{ object: { sha: string } }>('GET', `${base}/git/ref/heads/${encodeURIComponent(info.default_branch)}`)
      await gh('POST', `${base}/git/refs`, { ref: `refs/heads/${branch}`, sha: def.object.sha })
      return def.object.sha
    } catch (e) {
      if (!(e instanceof GithubError) || (e.status !== 404 && e.status !== 409)) throw e
    }
    await gh('PUT', `${base}/contents/README.md`, {
      message: 'Initial commit',
      content: toBase64(enc.encode(`# ${repo}\n`)),
      branch,
    })
    return (await gh<{ object: { sha: string } }>('GET', refPath)).object.sha
  }

  const uploaded = new Set<string>()
  for (let attempt = 0; ; attempt++) {
    progress('Reading the repository...')
    const parent = await headSha()
    if (!parent) throw new Error(`Branch "${branch}" could not be created`)
    const commit = await gh<{ tree: { sha: string } }>('GET', `${base}/git/commits/${parent}`)
    const tree = await gh<{ tree: Array<{ path: string; type: string; sha: string }>; truncated: boolean }>(
      'GET',
      `${base}/git/trees/${commit.tree.sha}?recursive=1`,
    )
    const existing = new Map(tree.tree.filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]))
    const known = new Set(existing.values())

    const entries: TreeEntry[] = []
    const toUpload = new Map<string, Uint8Array>()
    for (const f of prepared) {
      if (existing.get(f.path) === f.sha) continue
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha: f.sha })
      if (!known.has(f.sha) && !uploaded.has(f.sha)) toUpload.set(f.sha, f.bytes)
    }
    // A truncated listing can't prove a file is stale, so skip deletions then.
    if (!tree.truncated) {
      for (const path of existing.keys()) {
        if (!wanted.has(path) && owned.some((d) => path.startsWith(d))) entries.push({ path, mode: '100644', type: 'blob', sha: null })
      }
    }
    if (!entries.length) return { commitUrl: `https://github.com/${owner}/${repo}/commit/${parent}`, changed: 0 }

    let done = 0
    await runPool([...toUpload], 4, async ([sha, bytes]) => {
      const r = await gh<{ sha: string }>('POST', `${base}/git/blobs`, { content: toBase64(bytes), encoding: 'base64' })
      if (r.sha !== sha) throw new Error(`GitHub stored a different blob than expected (${r.sha} vs ${sha})`)
      uploaded.add(sha)
      progress(`Uploading ${++done}/${toUpload.size}...`)
    })

    progress('Committing...')
    const newTree = await gh<{ sha: string }>('POST', `${base}/git/trees`, { base_tree: commit.tree.sha, tree: entries })
    const newCommit = await gh<{ sha: string; html_url: string }>('POST', `${base}/git/commits`, {
      message: opts.message,
      tree: newTree.sha,
      parents: [parent],
    })
    try {
      await gh('PATCH', `${base}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, { sha: newCommit.sha })
    } catch (e) {
      // 422 = not a fast-forward: someone pushed meanwhile. Rebuild on the new head once.
      if (attempt === 0 && e instanceof GithubError && e.status === 422) continue
      throw e
    }
    return { commitUrl: newCommit.html_url || `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`, changed: entries.length }
  }
}

/** Check the token can see the repository; resolves to its full name. */
export async function testGithubLink(token: string, link: GithubLink, fetchImpl?: Fetch): Promise<string> {
  const gh = client(token, fetchImpl ?? fetch.bind(globalThis))
  const info = await gh<{ full_name: string; permissions?: { push?: boolean } }>('GET', `/repos/${encodeURIComponent(link.owner)}/${encodeURIComponent(link.repo)}`)
  if (info.permissions && !info.permissions.push) throw new Error(`The token can read ${info.full_name} but not write to it`)
  return info.full_name
}

// ---- the project push -----------------------------------------------------------------

/**
 * Push every MIP in the current project group: one folder per MIP (see
 * mipFolderName) holding its source project plus its delivered HTML files.
 */
export async function pushProjectGroup(onProgress: (msg: string) => void = () => {}): Promise<PushResult & { repo: string; folders: string[]; skipped: string[] }> {
  const link = readGithubLink()
  const token = await readGithubToken()
  if (!link || !token) throw new Error('No GitHub repository linked (Project settings > GitHub)')

  onProgress('Collecting MIPs...')
  const { playables } = await collectCurrentProjectViteSources()
  const runtimeSrc = await fetchRuntimeSrc()
  const prefix = link.dir ? link.dir + '/' : ''
  const files: SourceFile[] = []
  const skipped: string[] = []
  for (let i = 0; i < playables.length; i++) {
    const p = playables[i]
    onProgress(`Building ${p.folderName} (${i + 1}/${playables.length})...`)
    const folder = prefix + p.folderName + '/'
    for (const f of playableSourceFiles(p.project, p.assets)) files.push({ path: folder + f.path, data: f.data })
    const built = await buildDeliveryFiles(p.project, p.assets, { variants: true, sip: true, runtimeSrc })
    for (const f of built.files) files.push({ path: folder + f.name, data: f.text })
    skipped.push(...built.skipped)
  }

  const folders = playables.map((p) => p.folderName)
  const project = getState().project.meta.projectName || getState().project.meta.client || 'project'
  const result = await pushFiles({
    token,
    link,
    files,
    ownedDirs: folders.map((f) => prefix + f),
    message: `Update ${project}: ${folders.join(', ')}`,
    onProgress,
  })
  return { ...result, repo: `${link.owner}/${link.repo}`, folders, skipped }
}
