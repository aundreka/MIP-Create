// Share / import a MIP by code — hand another user an editable copy (scenes, assets,
// positions, styling, animations, sfx). "Send" uploads the current MIP and shows a
// short code + link; "Receive" imports a code as a brand-new local project. Cloud-
// backed (Supabase Storage) and sign-in gated, like the Team library. A share is a
// one-shot snapshot — later edits here don't update someone else's imported copy.

import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Project } from '../../runtime/scene'
import { Modal, Row } from '../ui'
import { Copy, Icon } from '../icons'
import { getSession, isCloudConfigured, onAuthChange, signInWithEmail } from '../cloud/supabase'
import { createShare, fetchShare, shareLink } from '../cloud/shareStore'
import { getState } from '../store'
import { createProject, saveCurrent } from '../projects'

const errText = (e: unknown): string => String((e as Error)?.message ?? e)

export function ShareModal(props: { initialCode?: string; onClose: () => void; onImported: () => void }): JSX.Element {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [code, setCode] = useState<string | null>(null) // freshly-created share code
  const [importCode, setImportCode] = useState(props.initialCode ?? '')
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  useEffect(() => {
    if (!isCloudConfigured()) {
      setReady(true)
      return
    }
    void getSession().then((s) => {
      setSession(s)
      setReady(true)
    })
    return onAuthChange((s) => setSession(s))
  }, [])

  const wrap = (fn: () => Promise<void>): (() => void) => () => {
    setBusy(true)
    setErr(null)
    void fn()
      .catch((e) => setErr(errText(e)))
      .finally(() => setBusy(false))
  }

  const doSignIn = wrap(async () => {
    const { error } = await signInWithEmail(email)
    if (error) throw new Error(error)
    setSent(true)
  })

  const mipName = getState().project.meta.name || 'untitled'

  const doCreate = wrap(async () => {
    await saveCurrent()
    const s = getState()
    setCode(await createShare({ project: s.project, assets: s.assets, trace: s.trace }))
  })

  const doImport = wrap(async () => {
    const data = await fetchShare(importCode)
    // Import as a clean standalone project: drop the sharer's project grouping +
    // cross-MIP sync markers so nothing dangles against groups this user doesn't have.
    const project = JSON.parse(JSON.stringify(data.project)) as Project
    delete project.meta.projectId
    delete project.meta.projectName
    for (const sd of project.scenes)
      sd.elements = sd.elements.map((e) => {
        const c = { ...e }
        delete c.sync
        return c
      })
    await createProject({ project, assets: data.assets, trace: data.trace })
    props.onImported()
  })

  const copy = (text: string, which: 'code' | 'link'): void => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <Modal title="Share / import a MIP" onClose={props.onClose} size="sm">
      {!isCloudConfigured() ? (
        <div className="hint pad">
          Cloud sharing isn’t configured. Add <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> to <b>.env.local</b> and restart.
        </div>
      ) : !ready ? (
        <div className="hint pad">Connecting…</div>
      ) : !session ? (
        <div className="team-signin">
          <div className="group-title">Sign in to share</div>
          <input type="email" placeholder="you@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="primary wide" disabled={busy || !email.trim()} onClick={doSignIn}>
            {busy ? 'Sending…' : 'Send magic link'}
          </button>
          {sent && <div className="hint pad">Check your email for the sign-in link, then return here.</div>}
          {err && <div className="warn-line">{err}</div>}
        </div>
      ) : (
        <>
          <div className="group-title">Send: share “{mipName}”</div>
          {code ? (
            <div className="share-out">
              <div className="share-code">{code}</div>
              <div className="share-actions">
                <button onClick={() => copy(code, 'code')}>
                  <Icon icon={Copy} size={13} /> {copied === 'code' ? 'Copied!' : 'Copy code'}
                </button>
                <button onClick={() => copy(shareLink(code), 'link')}>
                  <Icon icon={Copy} size={13} /> {copied === 'link' ? 'Copied!' : 'Copy link'}
                </button>
              </div>
              <div className="hint pad">Anyone on the team can import this via the code or link. It’s a snapshot; later edits here won’t update their copy.</div>
              <button className="wide" onClick={() => setCode(null)}>
                Create another
              </button>
            </div>
          ) : (
            <>
              <button className="primary wide" disabled={busy} onClick={doCreate}>
                {busy ? 'Uploading…' : 'Create share link'}
              </button>
              <div className="hint pad">Uploads this MIP (scenes, assets, positions, styling, animations, sfx) and gives you a short code + link.</div>
            </>
          )}

          <div className="group-title">Receive: import a code</div>
          <Row label="Code / link">
            <input placeholder="e.g. k7m2p9qd" value={importCode} onChange={(e) => setImportCode(e.target.value)} />
          </Row>
          <button className="wide" disabled={busy || !importCode.trim()} onClick={doImport}>
            {busy ? 'Importing…' : 'Import as new project'}
          </button>
          {err && !code && <div className="warn-line">{err}</div>}
        </>
      )}
    </Modal>
  )
}
