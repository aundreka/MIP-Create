// Team panel — the cloud collaboration surface. Sign in (magic link), publish the
// open MIP to the shared library, browse the whole team's MIPs grouped by client,
// open/download any of them, and — for PMs/admins — move status and reassign
// owners (PM monitoring). Read/write rules are enforced server-side by RLS; this
// UI just hides controls the current role can't use.

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, isCloudConfigured, onAuthChange, signInWithEmail, signOut } from '../cloud/supabase'
import {
  deleteMip,
  listMips,
  listProfiles,
  myRole,
  publish,
  pull,
  reassignOwner,
  setStatus,
  type MipRow,
  type MipStatus,
  type Profile,
  type Role,
} from '../cloud/teamStore'
import { currentProjectId, importProjectData, saveCurrent } from '../projects'
import { getState } from '../store'
import { downloadBlob } from '../export'
import { Select } from '../ui'
import { Icon, RotateCcw, Trash2, Upload } from '../icons'

const STATUSES: MipStatus[] = ['draft', 'in_review', 'approved', 'shipped']
const errText = (e: unknown): string => String((e as Error)?.message ?? e)

// The team library body, rendered as a tab inside the Home screen. `onOpened`
// fires after pulling a MIP into the local library (Home closes → editor opens).
export function TeamLibrary(props: { onOpened: () => void }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [mips, setMips] = useState<MipRow[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])

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

  const refresh = async (): Promise<void> => {
    setErr(null)
    try {
      const [r, m, p] = await Promise.all([myRole(), listMips(), listProfiles()])
      setRole(r)
      setMips(m)
      setProfiles(p)
    } catch (e) {
      setErr(errText(e))
    }
  }

  useEffect(() => {
    if (session) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  const myId = session?.user?.id
  const isPm = role === 'pm' || role === 'admin'
  const emailOf = (id: string | null): string => (id ? profiles.find((p) => p.id === id)?.email ?? id.slice(0, 8) : '—')

  const wrap = (fn: () => Promise<void>): (() => void) => () => {
    setBusy(true)
    void fn()
      .catch((e) => setErr(errText(e)))
      .finally(() => setBusy(false))
  }

  const doSignIn = wrap(async () => {
    const { error } = await signInWithEmail(email)
    if (error) throw new Error(error)
    setSent(true)
  })

  const doPublish = wrap(async () => {
    saveCurrent()
    const id = currentProjectId()
    if (!id) throw new Error('Open a project first.')
    const s = getState()
    const m = s.project.meta
    const client = (m.client ?? '').trim()
    const mip = (m.mip ?? '').trim()
    if (!client || !mip) throw new Error('Set a Client and MIP on this project (Inspector → Project) before publishing.')
    await publish({ id, name: m.name || 'untitled', client, mip, mipVersion: m.mipVersion, data: { project: s.project, assets: s.assets, trace: s.trace } })
    await refresh()
  })

  const doOpen = (row: MipRow): void =>
    wrap(async () => {
      const data = await pull(row.id, row.data_path)
      await importProjectData(row.id, data)
      props.onOpened()
    })()

  const doDownload = (row: MipRow): void =>
    wrap(async () => {
      const data = await pull(row.id, row.data_path)
      downloadBlob(`${row.client_name ?? 'mip'}-${row.mip ?? row.name}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }))
    })()

  const groups = useMemo(() => {
    const g = new Map<string, MipRow[]>()
    for (const r of mips) {
      const k = r.client_name ?? '(no client)'
      const arr = g.get(k) ?? []
      arr.push(r)
      g.set(k, arr)
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [mips])

  return (
    <div className="team-library">
      {!isCloudConfigured() ? (
        <div className="hint pad">
          Cloud isn’t configured. Add <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> to <b>.env.local</b> and restart the dev server.
        </div>
      ) : !ready ? (
        <div className="hint pad">Connecting…</div>
      ) : !session ? (
        <div className="team-signin">
          <div className="group-title">Sign in</div>
          <input type="email" placeholder="you@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="primary wide" disabled={busy || !email.trim()} onClick={doSignIn}>
            {busy ? 'Sending…' : 'Send magic link'}
          </button>
          {sent && <div className="hint pad">Check your email for the sign-in link, then return here.</div>}
          {err && <div className="warn-line">{err}</div>}
          <div className="hint pad">A magic link signs you into the team library. New emails auto-join as a designer.</div>
        </div>
      ) : (
        <>
          <div className="team-bar">
            <span className="team-who">
              {session.user.email} {role && <span className="badge">{role}</span>}
            </span>
            <span className="spacer" />
            <button className="icon" title="Refresh" disabled={busy} onClick={() => void refresh()}>
              <Icon icon={RotateCcw} size={14} />
            </button>
            <button disabled={busy} onClick={() => void signOut()}>
              Sign out
            </button>
            <button className="primary" disabled={busy} onClick={doPublish} title="Publish the currently-open project as your MIP">
              <Icon icon={Upload} size={14} /> Publish current MIP
            </button>
          </div>
          {err && <div className="warn-line">{err}</div>}

          {!mips.length ? (
            <div className="hint pad">No MIPs published yet. Set a Client + MIP on a project and hit “Publish current MIP”.</div>
          ) : (
            groups.map(([client, rows]) => (
              <div key={client}>
                <div className="group-title">{client} · {rows.length} MIP{rows.length === 1 ? '' : 's'}</div>
                <div className="team-list">
                  {rows.map((row) => {
                    const mine = row.owner_id === myId
                    const canStatus = isPm || mine
                    return (
                      <div className="team-row" key={row.id}>
                        <span className="team-mip">
                          <strong>{row.mip ?? row.name}</strong>
                          <span className="team-sub">{row.name} · owner {emailOf(row.owner_id)} · v{row.version}</span>
                        </span>
                        {canStatus ? (
                          <Select
                            className="team-status"
                            value={row.status}
                            onChange={(v) => wrap(async () => { await setStatus(row.id, v as MipStatus); await refresh() })()}
                            options={STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))}
                          />
                        ) : (
                          <span className={'team-badge st-' + row.status}>{row.status.replace('_', ' ')}</span>
                        )}
                        {isPm && (
                          <Select
                            className="team-owner"
                            title="Reassign owner"
                            value={row.owner_id ?? ''}
                            onChange={(v) => wrap(async () => { await reassignOwner(row.id, v); await refresh() })()}
                            options={profiles.map((p) => ({ value: p.id, label: p.email ?? p.id.slice(0, 8) }))}
                          />
                        )}
                        <button disabled={busy} onClick={() => doOpen(row)} title="Download into your library and open">Open</button>
                        <button disabled={busy} onClick={() => doDownload(row)} title="Download project JSON">JSON</button>
                        {(isPm || mine) && (
                          <button className="icon danger" disabled={busy} title="Delete from server" onClick={() => wrap(async () => { await deleteMip(row.id); await refresh() })()}>
                            <Icon icon={Trash2} size={14} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
          <div className="hint pad">
            Each person owns the MIPs they publish; everyone can browse and download. PMs/admins can move status and reassign owners.
            Consistency across a client’s MIPs is checked in the <b>QA &amp; reports</b> panel (≡ menu) and at export.
          </div>
        </>
      )}
    </div>
  )
}
