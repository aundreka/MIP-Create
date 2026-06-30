// QA panel — pick a client, see its MIPs, and review style/SFX/animation
// inconsistencies between them. Read-only over the project library (plus inline
// client/MIP assignment). Clicking a finding deep-links to the offending
// project/scene/element via the onNavigate callback wired in App.

import { useMemo, useState } from 'react'
import { buildProfiles, checkClient, groupByClient, type Finding } from '../qa/consistency'
import { lintEngagement } from '../qa/engagement'
import { buildLeaderboard, loadResults, METRICS, parseResultsCsv, saveResults, type Metric, type ResultRow } from '../results'
import { deleteVersion, diffProjects, listVersions, saveVersion } from '../versions'
import { currentProjectId, patchProjectMeta, saveCurrent } from '../projects'
import { getState, loadProject, patchMeta } from '../store'
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
  const [tab, setTab] = useState<'consistency' | 'engagement' | 'results' | 'history'>('consistency')
  const refresh = (): void => setNonce((n) => n + 1)

  // Engagement lint runs on the currently-open MIP (single project).
  const engagement = useMemo(() => lintEngagement(getState().project, getState().assets), [nonce, tab])
  const goEngage = (sceneId?: string, elementId?: string): void => {
    props.onNavigate(openId ?? '', sceneId, elementId)
    props.onClose()
  }

  // Results (performance) — imported CSV ranked into a leaderboard.
  const [results, setResults] = useState<ResultRow[]>(() => loadResults())
  const [csv, setCsv] = useState('')
  const [metric, setMetric] = useState<Metric>('ipm')
  const board = useMemo(() => buildLeaderboard(results, metric), [results, metric])
  const importCsv = (text: string): void => {
    const rows = parseResultsCsv(text)
    if (rows.length) {
      setResults(rows)
      saveResults(rows)
      setCsv('')
    }
  }

  // History — per-MIP version snapshots (design only) + diff/restore.
  const [verNonce, setVerNonce] = useState(0)
  const [verLabel, setVerLabel] = useState('')
  const [verNote, setVerNote] = useState('')
  const [diffId, setDiffId] = useState<string | null>(null)
  const versions = useMemo(() => (openId ? listVersions(openId) : []), [openId, verNonce, tab])
  const diffVersion = versions.find((v) => v.id === diffId)
  const diff = useMemo(() => (diffVersion ? diffProjects(diffVersion.project, getState().project) : []), [diffVersion, verNonce])
  const doSaveVersion = (): void => {
    if (!openId) return
    saveCurrent()
    saveVersion(openId, getState().project, verLabel, verNote, Date.now())
    setVerLabel('')
    setVerNote('')
    setVerNonce((n) => n + 1)
  }
  const doRestore = (vid: string): void => {
    const v = versions.find((x) => x.id === vid)
    if (!v || !confirm(`Restore “${v.label}”? This replaces the current design (shared assets are kept).`)) return
    loadProject(v.project, getState().assets, getState().projectPath ?? null)
    saveCurrent()
    props.onClose()
  }

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
    <Modal title="QA" onClose={props.onClose} size="lg" className="qa-modal">
      <div className="seg qa-tabs">
        <button className={tab === 'consistency' ? 'on' : ''} onClick={() => setTab('consistency')}>Consistency</button>
        <button className={tab === 'engagement' ? 'on' : ''} onClick={() => setTab('engagement')}>Engagement</button>
        <button className={tab === 'results' ? 'on' : ''} onClick={() => setTab('results')}>Results</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>
      </div>

      {tab === 'history' ? (
        <>
          <div className="ver-save">
            <input className="text-input" value={verLabel} placeholder="Version label (e.g. v2 — bigger CTA)" onChange={(e) => setVerLabel(e.target.value)} />
            <input className="text-input" value={verNote} placeholder="Note (optional)" onChange={(e) => setVerNote(e.target.value)} />
            <button className="primary" disabled={!openId} onClick={doSaveVersion}>Save version</button>
          </div>
          {!openId ? (
            <div className="hint pad">Save this project to your library first to start versioning it.</div>
          ) : versions.length === 0 ? (
            <div className="hint pad">No versions yet. Click “Save version” to snapshot the current design — then iterate and compare.</div>
          ) : (
            <div className="ver-list">
              {versions.map((v) => (
                <div key={v.id} className={'ver-row' + (v.id === diffId ? ' sel' : '')}>
                  <div className="ver-main" onClick={() => setDiffId(v.id === diffId ? null : v.id)} title="Show changes since this version">
                    <span className="ver-label">{v.label}</span>
                    <span className="hint">{new Date(v.createdAt).toLocaleString()}{v.note ? ' · ' + v.note : ''}</span>
                  </div>
                  <button onClick={() => doRestore(v.id)} title="Replace the current design with this version">Restore</button>
                  <button className="icon-btn" title="Delete version" onClick={() => { deleteVersion(openId, v.id); if (diffId === v.id) setDiffId(null); setVerNonce((n) => n + 1) }}>
                    <Icon icon={AlertTriangle} size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {diffVersion && (
            <>
              <div className="group-title">Changes since “{diffVersion.label}” → now</div>
              {diff.length === 0 ? (
                <div className="qa-allgood"><Icon icon={Check} size={16} /> Identical — no design changes since this version.</div>
              ) : (
                <div className="ver-diff">
                  {diff.map((d, i) => (
                    <div className={'ver-diff-line ' + d.kind} key={i}>
                      <span className="ver-diff-mark">{d.kind === 'add' ? '+' : d.kind === 'remove' ? '−' : '~'}</span>
                      <span>{d.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="hint pad">
            Versions snapshot the <b>design</b> (scenes, elements, settings) — assets are shared, so snapshots stay small.
            Click a version to see what changed since then; Restore swaps the current design back to it.
          </div>
        </>
      ) : tab === 'results' ? (
        <>
          <div className="qa-head">
            <Select label="Rank by" value={metric} onChange={(v) => setMetric(v as Metric)} options={METRICS} />
            <span className="hint">{results.length} creative{results.length === 1 ? '' : 's'} imported</span>
          </div>
          <label className="field">
            <span>Paste a network results CSV (header row + rows; creative/IPM/CTR/installs auto-detected)</span>
            <textarea className="quiz-paste" style={{ minHeight: 120 }} value={csv} placeholder={'creative,network,ipm,ctr,installs\nBioma_MIP3_scratch_al,AppLovin,8.2,1.9%,1240\n…'} onChange={(e) => setCsv(e.target.value)} />
          </label>
          <div className="grid2">
            <button onClick={() => importCsv(csv)} disabled={!csv.trim()}>Import CSV</button>
            <label className="field" style={{ padding: 0 }}>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) f.text().then(importCsv)
                }}
              />
            </label>
          </div>
          {board.length > 0 && (
            <div className="lead-wrap">
              <table className="lead-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Creative</th>
                    <th>MIP</th>
                    <th>Net</th>
                    <th>IPM</th>
                    <th>CTR</th>
                    <th>Installs</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((r, i) => (
                    <tr key={r.creative + i} className={i === 0 ? 'lead-top' : ''}>
                      <td>{i + 1}</td>
                      <td className="lead-name">{r.creative}</td>
                      <td className="hint">{r.matchedMip ?? '—'}</td>
                      <td>{r.network ?? '—'}</td>
                      <td>{r.ipm ?? '—'}</td>
                      <td>{r.ctr ?? '—'}</td>
                      <td>{r.installs ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="hint pad">
            Import the performance export from your network dashboard to rank variants/MIPs and learn which mechanics win. Rows are
            matched to your library by name (the export names creatives <b>client_mip_variant_network</b>). Stored locally.
          </div>
        </>
      ) : tab === 'engagement' ? (
        <>
          <div className="qa-head">
            <div className="qa-summary">
              {countEng(engagement, 'error')} error{countEng(engagement, 'error') === 1 ? '' : 's'} ·{' '}
              {countEng(engagement, 'warn')} warning{countEng(engagement, 'warn') === 1 ? '' : 's'} ·{' '}
              {countEng(engagement, 'info')} note{countEng(engagement, 'info') === 1 ? '' : 's'}
            </div>
            <button className="qa-rerun" onClick={refresh} title="Re-scan the open MIP">Re-run</button>
          </div>
          {engagement.length === 0 ? (
            <div className="qa-allgood">
              <Icon icon={Check} size={16} /> No engagement issues found in this MIP.
            </div>
          ) : (
            <div className="qa-findings">
              {engagement.map((f) => (
                <button key={f.id} className={'qa-finding sev-' + f.severity} onClick={() => goEngage(f.sceneId, f.elementId)} title={f.sceneName ? 'Open ' + f.sceneName : 'Open'}>
                  <Icon icon={f.severity === 'info' ? Check : AlertTriangle} size={13} className="qa-sev-icon" />
                  <span className="qa-f-main">
                    <span className="qa-f-msg">{f.message}</span>
                    {f.sceneName && <span className="qa-f-meta"><strong>{f.sceneName}</strong></span>}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="hint pad">
            Heuristic checks on the open MIP: missing interaction / CTA, dead-end scenes, small tap targets, tiny text, broken
            asset references and sounds that never fire. Click a finding to jump to it.
          </div>
        </>
      ) : !clients.length ? (
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

function countEng(findings: { severity: string }[], sev: string): number {
  return findings.reduce((n, f) => n + (f.severity === sev ? 1 : 0), 0)
}
