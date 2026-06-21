// QA panel — pick a client, see its MIPs, and review style/SFX/animation
// inconsistencies between them. Read-only over the project library (plus inline
// client/MIP assignment). Clicking a finding deep-links to the offending
// project/scene/element via the onNavigate callback wired in App.

import { useMemo, useState } from 'react'
import { buildProfiles, checkClient, groupByClient, type Finding } from '../qa/consistency'
import { currentProjectId, patchProjectMeta, saveCurrent } from '../projects'
import { getState, patchMeta } from '../store'
import { Modal, Select } from '../ui'
import { AlertTriangle, Check, Icon } from '../icons'

const UNASSIGNED = '(unassigned)'

export function QaPanel(props: { onClose: () => void; onNavigate: (projectId: string, sceneId?: string, elementId?: string) => void }): JSX.Element {
  // Persist the open project first so its latest client/MIP (and edits) are seen.
  const [nonce, setNonce] = useState(0)
  const profiles = useMemo(() => {
    saveCurrent()
    return buildProfiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])
  const groups = useMemo(() => groupByClient(profiles), [profiles])
  const clients = useMemo(() => [...groups.keys()].sort((a, b) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b))), [groups])

  const openId = currentProjectId()
  const openClient = (getState().project.meta.client ?? '').trim()
  const [client, setClient] = useState<string>(() => {
    if (openClient && groups.has(openClient)) return openClient
    return clients[0] ?? UNASSIGNED
  })
  const refresh = (): void => setNonce((n) => n + 1)

  const selProfiles = groups.get(client) ?? []
  const findings = useMemo(() => (client === UNASSIGNED ? [] : checkClient(selProfiles)), [client, selProfiles])
  const findingsByMip = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of findings) m.set(f.projectId, (m.get(f.projectId) ?? 0) + 1)
    return m
  }, [findings])

  const assign = (projectId: string, patch: { client?: string; mip?: string }): void => {
    if (projectId === openId) {
      patchMeta(patch)
      saveCurrent()
    } else {
      patchProjectMeta(projectId, patch)
    }
    refresh()
  }

  const go = (f: Finding): void => {
    props.onNavigate(f.projectId, f.prov?.sceneId || undefined, f.prov?.elementId)
    props.onClose()
  }

  return (
    <Modal title="QA · consistency check" onClose={props.onClose} size="lg" className="qa-modal">
      {!clients.length ? (
        <div className="hint pad">No projects in your library yet. Create or open a couple of MIPs, tag them with a Client (in the Inspector → Project section), then run this check.</div>
      ) : (
        <>
          <div className="qa-head">
            <Select
              label="Client"
              value={client}
              onChange={setClient}
              options={clients.map((c) => ({ value: c, label: `${c} · ${(groups.get(c) ?? []).length} MIP${(groups.get(c) ?? []).length === 1 ? '' : 's'}` }))}
            />
            <button className="qa-rerun" onClick={refresh} title="Re-scan the library">Re-run</button>
          </div>

          {client === UNASSIGNED ? (
            <div className="hint pad">These MIPs have no Client set, so they can't be compared. Assign each one to a client below — then pick that client above to see the report.</div>
          ) : selProfiles.length < 2 ? (
            <div className="hint pad">Only {selProfiles.length} MIP under “{client}”. Add at least one more MIP to the same client to compare them.</div>
          ) : findings.length === 0 ? (
            <div className="qa-allgood">
              <Icon icon={Check} size={16} /> All {selProfiles.length} MIPs are consistent. No divergences found.
            </div>
          ) : (
            <>
              <div className="qa-summary">
                {countSeverity(findings, 'error')} error{countSeverity(findings, 'error') === 1 ? '' : 's'} ·{' '}
                {countSeverity(findings, 'warn')} warning{countSeverity(findings, 'warn') === 1 ? '' : 's'} ·{' '}
                {countSeverity(findings, 'info')} note{countSeverity(findings, 'info') === 1 ? '' : 's'}
              </div>
              <div className="qa-findings">
                {findings.map((f) => (
                  <button key={f.id} className={'qa-finding sev-' + f.severity} onClick={() => go(f)} title="Open the affected MIP">
                    <Icon icon={f.severity === 'info' ? Check : AlertTriangle} size={13} className="qa-sev-icon" />
                    <span className="qa-f-main">
                      <span className="qa-f-msg">{f.message}</span>
                      <span className="qa-f-meta">
                        <span className="qa-cat">{f.category}</span> · <strong>{f.mip}</strong>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* MIP roster — also where (re)assignment happens */}
          <div className="group-title">MIPs under “{client}” ({selProfiles.length})</div>
          <div className="qa-roster">
            {selProfiles.map((p) => (
              <div className="qa-mip" key={p.projectId}>
                <span className="qa-mip-name">
                  {p.mip}
                  {p.projectId === openId && <span className="badge">open</span>}
                  {findingsByMip.get(p.projectId) ? <span className="qa-mip-count">{findingsByMip.get(p.projectId)}</span> : null}
                </span>
                <input
                  className="qa-assign"
                  defaultValue={p.client}
                  placeholder="client"
                  title="Assign client"
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v !== p.client) assign(p.projectId, { client: v })
                  }}
                />
                <input
                  className="qa-assign"
                  defaultValue={p.mip === (p.name || 'untitled') ? '' : p.mip}
                  placeholder="MIP id"
                  title="Assign MIP id"
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v && v !== p.mip) assign(p.projectId, { mip: v })
                  }}
                />
              </div>
            ))}
          </div>
          <div className="hint pad">
            Compares fonts, colors, CTA pulse, entrance animations, sound events, transitions and canvas size across a client’s MIPs.
            Edit a row’s <b>client</b> / <b>MIP id</b> to (re)file it. Only projects in this editor’s library are included.
          </div>
        </>
      )}
    </Modal>
  )
}

function countSeverity(findings: Finding[], sev: Finding['severity']): number {
  return findings.reduce((n, f) => n + (f.severity === sev ? 1 : 0), 0)
}
