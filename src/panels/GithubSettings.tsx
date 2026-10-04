// Project settings > GitHub: link the current project group to a repository for
// Push to GitHub (see src/github.ts). The link is saved per project on this
// machine and the token once for all projects, so it stays connected between sessions.

import { useEffect, useState } from 'react'
import { defaultCommitMessage, parseRepo, readGithubLink, readGithubToken, testGithubLink, tokenInKeychain, writeGithubLink, writeGithubToken } from '../github'
import { mipFolderName } from '../mipName'
import { useEditorState } from '../store'
import { Help, Row } from '../ui'

export function GithubSettings(): JSX.Element {
  const { project } = useEditorState()
  const saved = readGithubLink()
  const [repo, setRepo] = useState(saved ? `${saved.owner}/${saved.repo}` : '')
  const [branch, setBranch] = useState(saved?.branch ?? 'main')
  const [dir, setDir] = useState(saved?.dir ?? '')
  const [message, setMessage] = useState(saved?.message ?? '')
  const [token, setToken] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    void readGithubToken().then((t) => setHasToken(!!t))
  }, [])

  const save = async (): Promise<void> => {
    const parsed = parseRepo(repo)
    if (!parsed) {
      setStatus('Repository must look like owner/repo or https://github.com/owner/repo')
      return
    }
    const link = { ...parsed, branch: branch.trim() || 'main', dir, message }
    try {
      if (token.trim()) await writeGithubToken(token)
      const t = token.trim() || (await readGithubToken())
      if (!t) {
        setStatus('Paste a GitHub token first.')
        return
      }
      setStatus('Checking access...')
      const name = await testGithubLink(t, link)
      writeGithubLink(link)
      setToken('')
      setHasToken(true)
      setStatus(`Connected to ${name} (${link.branch}${link.dir ? `, folder ${link.dir}` : ''}).`)
    } catch (e) {
      setStatus('Could not connect: ' + String((e as Error)?.message ?? e))
    }
  }

  const disconnect = async (): Promise<void> => {
    writeGithubLink(null)
    setRepo('')
    setStatus('This project is no longer linked. The saved token is kept for other projects.')
  }

  const forgetToken = async (): Promise<void> => {
    await writeGithubToken('')
    setHasToken(false)
    setStatus('Token removed from this ' + (tokenInKeychain() ? 'computer.' : 'browser.'))
  }

  return (
    <>
      <Row label="Repository">
        <input value={repo} placeholder="owner/repo" onChange={(e) => setRepo(e.target.value)} />
      </Row>
      <div className="grid2">
        <Row label="Branch">
          <input value={branch} placeholder="main" onChange={(e) => setBranch(e.target.value)} />
        </Row>
        <Row label="Folder">
          <input value={dir} placeholder="(repo root)" title="Optional folder in the repo the MIP folders go under" onChange={(e) => setDir(e.target.value)} />
        </Row>
      </div>
      <Row label="Commit text">
        <input
          value={message}
          placeholder={defaultCommitMessage([mipFolderName(project)])}
          title="The commit message every push uses. {folders} and {project} expand; blank uses the default shown."
          onChange={(e) => setMessage(e.target.value)}
          onBlur={() => {
            // Saving the message shouldn't require a re-test — write it straight
            // onto the existing link (the full save() still includes it too).
            const cur = readGithubLink()
            if (cur) writeGithubLink({ ...cur, message })
          }}
        />
      </Row>
      <Row label="Token">
        <input type="password" value={token} autoComplete="off" placeholder={hasToken ? 'Saved (paste to replace)' : 'github_pat_...'} onChange={(e) => setToken(e.target.value)} />
      </Row>
      <div className="grid2">
        <button onClick={() => void save()}>{saved ? 'Save + test' : 'Connect'}</button>
        {saved ? <button onClick={() => void disconnect()}>Disconnect</button> : <span />}
      </div>
      {hasToken && (
        <button className="link-btn" onClick={() => void forgetToken()}>
          Forget saved token
        </button>
      )}
      {status && <div className="figma-status">{status}</div>}
      <Help>
        Push to GitHub commits every MIP in this project as folders like <b>MIP1 - SCRATCH</b>: the source project with its images as files, plus the MIP, variant and SIP HTML. Use
        a fine-grained token limited to this repository with <b>Contents: Read and write</b>. It is saved {tokenInKeychain() ? 'in your system keychain' : 'in this browser only'}{' '}
        and never in the project file.
      </Help>
    </>
  )
}
