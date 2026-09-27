import { describe, expect, it } from 'vitest'
import { gitBlobSha, parseRepo, pushFiles } from './github'

// A tiny in-memory GitHub: one branch, flat path -> blob sha trees.
function fakeGithub(initial: Record<string, string>) {
  const blobs = new Map<string, string>()
  const trees = new Map<string, Record<string, string>>()
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>()
  let n = 0
  const id = (p: string): string => `${p}${++n}`
  const calls: string[] = []
  let failNextPatch = false

  const seed = async (): Promise<string> => {
    const t: Record<string, string> = {}
    for (const [path, text] of Object.entries(initial)) {
      const sha = await gitBlobSha(new TextEncoder().encode(text))
      blobs.set(sha, text)
      t[path] = sha
    }
    const tree = id('tree')
    trees.set(tree, t)
    const c = id('commit')
    commits.set(c, { tree, parents: [], message: 'seed' })
    return c
  }
  let head = ''
  const ready = seed().then((c) => (head = c))

  const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status })

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    await ready
    const path = url.replace('https://api.github.com/repos/o/r', '')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push(`${method} ${path.split('?')[0]}`)
    if (method === 'GET' && path === '/git/ref/heads/main') return json(200, { object: { sha: head } })
    if (method === 'GET' && path.startsWith('/git/commits/')) return json(200, { tree: { sha: commits.get(path.split('/').pop()!)!.tree } })
    if (method === 'GET' && path.startsWith('/git/trees/')) {
      const t = trees.get(path.split('/').pop()!.split('?')[0])!
      return json(200, { truncated: false, tree: Object.entries(t).map(([p, sha]) => ({ path: p, type: 'blob', sha })) })
    }
    if (method === 'POST' && path === '/git/blobs') {
      const bytes = Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0))
      const sha = await gitBlobSha(bytes)
      blobs.set(sha, new TextDecoder().decode(bytes))
      return json(201, { sha })
    }
    if (method === 'POST' && path === '/git/trees') {
      const t = { ...trees.get(body.base_tree)! }
      for (const e of body.tree) {
        if (e.sha === null) delete t[e.path]
        else t[e.path] = e.sha
      }
      const tree = id('tree')
      trees.set(tree, t)
      return json(201, { sha: tree })
    }
    if (method === 'POST' && path === '/git/commits') {
      const c = id('commit')
      commits.set(c, { tree: body.tree, parents: body.parents, message: body.message })
      return json(201, { sha: c, html_url: `https://github.com/o/r/commit/${c}` })
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      if (failNextPatch) {
        failNextPatch = false
        return json(422, { message: 'Update is not a fast forward' })
      }
      head = body.sha
      return json(200, {})
    }
    return json(404, { message: 'Not Found' })
  }) as typeof fetch

  const files = (): Record<string, string> => {
    const t = trees.get(commits.get(head)!.tree)!
    return Object.fromEntries(Object.entries(t).map(([p, sha]) => [p, blobs.get(sha)!]))
  }
  return { fetchImpl, files, calls, failPatchOnce: () => (failNextPatch = true), headCommit: () => commits.get(head)! }
}

const link = { owner: 'o', repo: 'r', branch: 'main', dir: '' }

describe('pushFiles', () => {
  it('commits folders, skips unchanged files and removes stale ones only inside pushed folders', async () => {
    const gh = fakeGithub({
      'README.md': 'keep me',
      'MIP1 - SCRATCH/index.html': 'same',
      'MIP1 - SCRATCH/public/media/old.png': 'stale',
      'MIP9 - SPIN/index.html': 'other folder',
    })
    const r = await pushFiles({
      token: 't',
      link,
      files: [
        { path: 'MIP1 - SCRATCH/index.html', data: 'same' },
        { path: 'MIP1 - SCRATCH/public/media/logo.png', data: new Uint8Array([137, 80, 78, 71]) },
        { path: 'MIP1 - SCRATCH/src/runtime/a.ts', data: 'shared' },
        { path: 'MIP2 - TAP REVEAL/src/runtime/a.ts', data: 'shared' },
      ],
      ownedDirs: ['MIP1 - SCRATCH', 'MIP2 - TAP REVEAL'],
      message: 'Update test',
      fetchImpl: gh.fetchImpl,
    })

    expect(Object.keys(gh.files()).sort()).toEqual([
      'MIP1 - SCRATCH/index.html',
      'MIP1 - SCRATCH/public/media/logo.png',
      'MIP1 - SCRATCH/src/runtime/a.ts',
      'MIP2 - TAP REVEAL/src/runtime/a.ts',
      'MIP9 - SPIN/index.html',
      'README.md',
    ])
    expect(r.changed).toBe(4) // 3 new files + 1 deletion; index.html was unchanged
    // Identical content is uploaded once, and the unchanged file not at all.
    expect(gh.calls.filter((c) => c === 'POST /git/blobs')).toHaveLength(2)
    expect(gh.headCommit().message).toBe('Update test')
    expect(r.commitUrl).toMatch(/^https:\/\/github\.com\/o\/r\/commit\//)
  })

  it('makes no commit when nothing changed', async () => {
    const gh = fakeGithub({ 'MIP1/a.txt': 'x' })
    const r = await pushFiles({ token: 't', link, files: [{ path: 'MIP1/a.txt', data: 'x' }], ownedDirs: ['MIP1'], message: 'm', fetchImpl: gh.fetchImpl })
    expect(r.changed).toBe(0)
    expect(gh.calls).not.toContain('POST /git/commits')
  })

  it('rebuilds on the new head when the branch moved during the push', async () => {
    const gh = fakeGithub({})
    gh.failPatchOnce()
    await pushFiles({ token: 't', link, files: [{ path: 'MIP1/a.txt', data: 'x' }], ownedDirs: ['MIP1'], message: 'm', fetchImpl: gh.fetchImpl })
    expect(gh.files()).toEqual({ 'MIP1/a.txt': 'x' })
    expect(gh.calls.filter((c) => c === 'PATCH /git/refs/heads/main')).toHaveLength(2)
  })
})

describe('parseRepo', () => {
  it('accepts owner/repo and GitHub URLs', () => {
    expect(parseRepo('aundreka/mips')).toEqual({ owner: 'aundreka', repo: 'mips' })
    expect(parseRepo('https://github.com/aundreka/mips.git')).toEqual({ owner: 'aundreka', repo: 'mips' })
    expect(parseRepo('github.com/aundreka/mips/')).toEqual({ owner: 'aundreka', repo: 'mips' })
    expect(parseRepo('not a repo')).toBeNull()
  })
})
