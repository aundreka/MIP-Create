// Share / import a MIP by code — hand another user an editable copy (scenes, assets,
// positions, styling, animations, sfx). "Send" uploads the current MIP and shows a
// short code + link; "Receive" imports a code as a brand-new local project. Cloud-
// backed (Supabase Storage) but NO sign-in required — anyone with the code can open
// it. A share is a one-shot snapshot — later edits here don't update someone else's
// imported copy.

import { useState } from 'react'
import type { Project } from '../../runtime/scene'
import { Modal, Row } from '../ui'
import { Copy, Icon } from '../icons'
import { isCloudConfigured } from '../cloud/supabase'
import { createShare, fetchShare, shareLink } from '../cloud/shareStore'
import { getState } from '../store'
import { createProject, currentProjectId, loadProjectPreview, saveCurrent } from '../projects'

const errText = (e: unknown): string => String((e as Error)?.message ?? e)

/** Sharing a named playable from Home is send-only — you picked WHICH MIP to send,
 * so the "receive a code" half would be answering a question you didn't ask. */
export function ShareModal(props: { initialCode?: string; target?: { id: string; name: string }; onClose: () => void; onImported: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [code, setCode] = useState<string | null>(null) // freshly-created share code
  const [importCode, setImportCode] = useState(props.initialCode ?? '')
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  const wrap = (fn: () => Promise<void>): (() => void) => () => {
    setBusy(true)
    setErr(null)
    void fn()
      .catch((e) => setErr(errText(e)))
      .finally(() => setBusy(false))
  }

  const sendOnly = !!props.target
  const mipName = props.target?.name || getState().project.meta.name || 'untitled'

  const doCreate = wrap(async () => {
    // Flush the open project first either way: it may BE the target, and even when it
    // isn't, a share shouldn't be the thing that loses someone's unsaved edits.
    await saveCurrent()
    const id = props.target?.id
    if (id && id !== currentProjectId()) {
      // A different playable than the one on screen — read it back from the library
      // with its asset bytes rehydrated, since only the open project lives in memory.
      const data = await loadProjectPreview(id)
      if (!data) throw new Error('That playable could not be loaded from your library.')
      setCode(await createShare(data))
      return
    }
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
    <Modal title={sendOnly ? `Share “${mipName}”` : 'Share / import a MIP'} onClose={props.onClose} size="sm">
      {!isCloudConfigured() ? (
        <div className="hint pad">
          Cloud sharing isn’t configured. Add <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> to <b>.env.local</b> and restart.
        </div>
      ) : (
        <>
          {/* The modal title already names the MIP in send-only mode — don't say it twice. */}
          <div className="group-title">{sendOnly ? 'Send a copy' : `Send: share “${mipName}”`}</div>
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
              <div className="hint pad">Anyone with the code or link can import this — no sign-in needed. It’s a snapshot; later edits here won’t update their copy.</div>
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

          {!sendOnly && (
            <>
              <div className="group-title">Receive: import a code</div>
              <Row label="Code / link">
                <input placeholder="e.g. k7m2p9qd" value={importCode} onChange={(e) => setImportCode(e.target.value)} />
              </Row>
              <button className="wide" disabled={busy || !importCode.trim()} onClick={doImport}>
                {busy ? 'Importing…' : 'Import as new project'}
              </button>
            </>
          )}
          {err && <div className="warn-line">{err}</div>}
        </>
      )}
    </Modal>
  )
}
