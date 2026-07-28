// Home / project menu — work on multiple playables. Lists every saved project
// (localStorage library), opens / creates / renames / duplicates / deletes them,
// and starts new ones blank or from a built-in starter. Opening switches the
// editor to that project (persisting the current one first).

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createProject, currentProjectId, deleteProject, duplicateProject, listProjects, loadProjectPreview, openProject, renameProject, saveCurrent, type ProjectRecord } from '../projects'
import type { ProjectData } from '../bridge'
import { gameTemplateStarters, STARTERS, type Starter } from '../templates'
import { SceneThumb } from '../preview/SceneThumb'
import { allBrands, brandsFor, usagesFor } from '../templateUsage'
import { TemplateCard } from './TemplateCard'
import { exportAllData, backupFilename, importAllData, readBackupInfo } from '../backup'
import { downloadBlob } from '../export'
import { ArrowDownToLine, ArrowUpToLine, Copy, Diamond, FolderOpen, Icon, LayoutGrid, ListChecks, Pencil, Plus, ScanSearch, Search, Share2, Star, Upload, User, X } from '../icons'

// Team library loads lazily (keeps Supabase out of the Home chunk until the tab opens).
const TeamLibrary = lazy(() => import('./TeamPanel').then((m) => ({ default: m.TeamLibrary })))

const THUMB_H = 120

function ProjectThumb({ id }: { id: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [w, setW] = useState(0)
  const [data, setData] = useState<ProjectData | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Keep observing (don't disconnect on first hit): mount the preview iframe only
    // while the card is on screen and release it — and the rehydrated asset bytes —
    // when it scrolls away, so a long library doesn't accumulate live iframes (OOM).
    const io = new IntersectionObserver(
      (es) => {
        const on = es.some((e) => e.isIntersecting)
        setVisible(on)
        if (!on) setData(null)
      },
      { rootMargin: '120px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const ro = new ResizeObserver(() => setW(parent.clientWidth))
    ro.observe(parent)
    setW(parent.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let alive = true
    void loadProjectPreview(id).then((d) => { if (alive) setData(d) })
    return () => { alive = false }
  }, [visible, id])

  // Pick the most visually rich scene: prefer endscene or win, fall back to first
  const scene = data?.project.scenes.find((s) => s.kind === 'endscene') ??
    data?.project.scenes.find((s) => s.kind === 'overlay' || (s.kind as string) === 'win') ??
    data?.project.scenes[0]
  return (
    <span ref={ref} className="proj-thumb">
      {visible && scene && data && w > 0 ? (
        <SceneThumb project={data.project} def={scene} assets={data.assets} h={THUMB_H} w={w} cover />
      ) : (
        <Icon icon={LayoutGrid} size={30} />
      )}
    </span>
  )
}

function when(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function HomeScreen(props: { onClose: () => void; onProfile: () => void; onGenerate?: () => void; onQuizFunnel?: () => void; onImportBuilt?: () => void; onShare?: () => void; onShareProject?: (id: string, name: string) => void; onQaCheck?: () => void; initialTab?: 'projects' | 'team' }): JSX.Element {
  const [tick, force] = useState(0)
  const refresh = (): void => force((n) => n + 1)
  const [editId, setEditId] = useState<string | null>(null)
  const [view, setView] = useState<'projects' | 'team'>(props.initialTab ?? 'projects')

  // make sure the current project's card shows its latest name/time
  useEffect(() => {
    void saveCurrent()
    refresh()
  }, [])

  // Esc closes the home screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Let a focused field (e.g. the rename input) handle its own Escape first.
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const projects = listProjects()
  const curId = currentProjectId()
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState<string | null>(null)
  const gameCards = useMemo(() => gameTemplateStarters().map((s) => ({ starter: s, data: s.build() })), [])
  // Distinct brands (recomputed when usage tags change via `refresh`).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const brands = useMemo(() => allBrands(), [tick])
  // The active brand chip may disappear if its last tag is removed — drop it.
  useEffect(() => {
    if (brand && !brands.some((b) => b.name.toLowerCase() === brand.toLowerCase())) setBrand(null)
  }, [brand, brands])

  // Full local backup / restore — no account needed. Download bundles every project,
  // MIP, media file, project group, version and setting into one file; restore merges
  // a backup back into this library, then reloads so the store re-boots from storage.
  const backupInputRef = useRef<HTMLInputElement>(null)
  const doBackup = async (): Promise<void> => {
    await saveCurrent()
    downloadBlob(backupFilename(), await exportAllData())
  }
  const doRestore = async (file: File): Promise<void> => {
    let text: string
    try {
      text = await file.text()
    } catch {
      alert('Could not read that file.')
      return
    }
    let info: { projects: number }
    try {
      info = readBackupInfo(text)
    } catch (e) {
      alert(String((e as Error)?.message ?? e))
      return
    }
    if (!confirm(`Restore ${info.projects} project${info.projects === 1 ? '' : 's'} from this backup? Your existing projects are kept; any with the same id are overwritten. The editor will reload.`)) return
    try {
      await importAllData(text)
      location.reload()
    } catch (e) {
      alert('Import failed: ' + String((e as Error)?.message ?? e))
    }
  }

  const ql = query.trim().toLowerCase()
  const filtered = gameCards.filter((c) => {
    // brand chip filter (many-to-many: keep templates tagged with this brand)
    if (brand && !brandsFor(c.starter.id).some((b) => b.toLowerCase() === brand.toLowerCase())) return false
    if (!ql) return true
    // free-text search across label, description and brand/MIP tags
    return (
      c.starter.label.toLowerCase().includes(ql) ||
      c.starter.description.toLowerCase().includes(ql) ||
      usagesFor(c.starter.id).some((u) => (u.client + ' ' + u.mip).toLowerCase().includes(ql))
    )
  })

  // One recency-ordered feed: project groups and loose MIPs compete on the SAME
  // timeline, so whatever you touched last is always on top. (Ungrouped MIPs used to
  // be pinned below every group, which buried the file you were just editing.)
  //
  // `projects` is already newest-first, so appending a group the first time one of
  // its MIPs shows up drops it exactly where its newest member falls — no second sort.
  // Consecutive loose MIPs merge into one run so they share a grid row instead of
  // each getting its own.
  type Block =
    | { kind: 'loose'; items: ProjectRecord[] }
    | { kind: 'group'; id: string; name: string; items: ProjectRecord[] }
  const blocks: Block[] = []
  const groupBlock = new Map<string, Block & { kind: 'group' }>()
  for (const p of projects) {
    if (!p.projectId) {
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'loose') last.items.push(p)
      else blocks.push({ kind: 'loose', items: [p] })
      continue
    }
    const g = groupBlock.get(p.projectId)
    if (g) { g.items.push(p); continue }
    const next = { kind: 'group' as const, id: p.projectId, name: p.projectName || 'Untitled project', items: [p] }
    groupBlock.set(p.projectId, next)
    blocks.push(next)
  }

  const open = async (id: string): Promise<void> => {
    if (id === curId || (await openProject(id))) props.onClose()
  }
  const newBlank = async (): Promise<void> => {
    await createProject()
    props.onClose()
  }
  const startFrom = async (s: Starter): Promise<void> => {
    await createProject(s.build())
    props.onClose()
  }

  const renderCard = (p: (typeof projects)[number]): JSX.Element => (
    <div key={p.id} className={'proj-card' + (p.id === curId ? ' current' : '')}>
      <button className="proj-open" onClick={() => open(p.id)} title="Open">
        <ProjectThumb id={p.id} />
      </button>
      <div className="proj-meta">
        {editId === p.id ? (
          <input
            autoFocus
            defaultValue={p.name}
            onBlur={(e) => {
              renameProject(p.id, e.target.value.trim() || p.name)
              setEditId(null)
              refresh()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') (e.stopPropagation(), setEditId(null))
            }}
          />
        ) : (
          <span className="proj-name" onDoubleClick={() => setEditId(p.id)} title="Double-click to rename">
            {p.name} {p.id === curId && <em className="proj-cur">• current</em>}
          </span>
        )}
        <span className="proj-date">{when(p.updatedAt)}</span>
      </div>
      <div className="proj-actions">
        <button title="Rename" onClick={() => setEditId(p.id)}>
          <Icon icon={Pencil} size={13} />
        </button>
        <button title="Duplicate" onClick={() => void duplicateProject(p.id).then(() => refresh())}>
          <Icon icon={Copy} size={13} />
        </button>
        {props.onShareProject && (
          <button title="Share this playable — get a code / link to hand someone an editable copy" onClick={() => props.onShareProject!(p.id, p.name)}>
            <Icon icon={Share2} size={13} />
          </button>
        )}
        <button
          className="danger"
          title="Delete"
          disabled={projects.length <= 1}
          onClick={() => {
            if (confirm(`Delete "${p.name}"? This can't be undone.`)) {
              deleteProject(p.id)
              refresh()
            }
          }}
        >
          <Icon icon={X} size={13} />
        </button>
      </div>
    </div>
  )

  return (
    <div className="home-overlay">
      <div className="home">
        <div className="home-bar">
          <strong className="home-brand">
            <Icon icon={Diamond} size={18} fill="currentColor" /> Playables
          </strong>
          <span className="home-tabs">
            <button className={view === 'projects' ? 'on' : ''} onClick={() => setView('projects')}>My projects</button>
            <button className={view === 'team' ? 'on' : ''} onClick={() => setView('team')}>Team library</button>
          </span>
          <span className="spacer" />
          <button onClick={() => void doBackup()} title="Download all your data — every project, MIP, media file & setting — as one backup file">
            <Icon icon={ArrowDownToLine} size={14} /> Download all
          </button>
          <button onClick={() => backupInputRef.current?.click()} title="Restore projects from a backup file">
            <Icon icon={ArrowUpToLine} size={14} /> Restore
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.currentTarget.value = ''
              if (f) void doRestore(f)
            }}
          />
          <button onClick={props.onProfile}>
            <Icon icon={User} size={14} /> Profile
          </button>
          <button onClick={props.onClose}>
            <Icon icon={X} size={14} /> Close
          </button>
        </div>

        <div className="home-body">
          {view === 'team' ? (
            <div className="home-main team-library-tab">
              <Suspense fallback={<div className="hint pad">Loading team library…</div>}>
                <TeamLibrary onOpened={props.onClose} />
              </Suspense>
            </div>
          ) : (
          <>
          <div className="home-main">
            <div className="group-title">Start</div>
            <div className="home-new">
              <button className="new-card blank" onClick={newBlank}>
                <span className="plus">
                  <Icon icon={Plus} size={26} />
                </span>
                <span>New blank playable</span>
              </button>
              {props.onGenerate && (
                <button className="new-card" onClick={() => props.onGenerate!()} title="Scaffold a MIP from a logo + product (coded SVG art + MRAID end card)">
                  <span className="plus">
                    <Icon icon={Star} size={24} />
                  </span>
                  <span>Generate MIP</span>
                </button>
              )}
              {props.onImportBuilt && (
                <button className="new-card" onClick={() => props.onImportBuilt!()} title="Recover an editable project from a built .html or .zip (or embed a third-party playable)">
                  <span className="plus">
                    <Icon icon={Upload} size={22} />
                  </span>
                  <span>Import built playable</span>
                </button>
              )}
              {/* Receive only. SENDING moved onto each playable's card — you share a
                  specific MIP, not "the current one", so it belongs on the thing itself.
                  Importing genuinely does start a new project, so it stays here. */}
              {props.onShare && (
                <button className="new-card" onClick={() => props.onShare!()} title="Import a MIP someone shared with you via a code / link">
                  <span className="plus">
                    <Icon icon={Copy} size={22} />
                  </span>
                  <span>Import by code</span>
                </button>
              )}
              {props.onQaCheck && (
                <button className="new-card" onClick={() => props.onQaCheck!()} title="Compare a built MIP/SIP against the Figma mockup: overlay, side by side, color pick & auto-diff">
                  <span className="plus">
                    <Icon icon={ScanSearch} size={22} />
                  </span>
                  <span>QA checker</span>
                </button>
              )}
            </div>

            <div className="group-title">Your playables ({projects.length})</div>
          {blocks.map((b) =>
            b.kind === 'group' ? (
              <div key={'g:' + b.id} className="proj-group">
                <div className="proj-group-head">
                  <Icon icon={FolderOpen} size={14} /> {b.name} <span className="proj-group-count">{b.items.length}</span>
                </div>
                <div className="home-grid">{b.items.map(renderCard)}</div>
              </div>
            ) : (
              // No "Ungrouped" heading — these are interleaved by recency now, so a
              // header would imply a section that doesn't exist.
              <div key={'loose:' + b.items[0].id} className="proj-group">
                <div className="home-grid">{b.items.map(renderCard)}</div>
              </div>
            ),
          )}
          </div>

          <aside className="home-side">
            <div className="home-side-title">Flow starters</div>
            <div className="home-flows">
              {props.onQuizFunnel && (
                <button className="flow-btn" onClick={() => props.onQuizFunnel!()} title="Build a quiz / survey funnel from pasted questions">
                  <Icon icon={ListChecks} size={14} /> Quiz / Survey funnel
                </button>
              )}
              {STARTERS.map((s) => (
                <button key={s.id} className="flow-btn" onClick={() => startFrom(s)} title={s.description}>
                  <Icon icon={LayoutGrid} size={14} /> {s.label}
                </button>
              ))}
            </div>
            <div className="home-side-title">Game templates</div>
            <label className="home-search">
              <Icon icon={Search} size={15} />
              <input value={query} placeholder="Search templates or brands…" onChange={(e) => setQuery(e.target.value)} />
              {query && (
                <button className="home-search-x" onClick={() => setQuery('')} title="Clear">
                  <Icon icon={X} size={13} />
                </button>
              )}
            </label>
            {brands.length > 0 && (
              <div className="brand-filter" role="group" aria-label="Filter templates by brand">
                <button className={'brand-chip' + (brand === null ? ' on' : '')} onClick={() => setBrand(null)}>
                  All <span className="brand-count">{gameCards.length}</span>
                </button>
                {brands.map((b) => (
                  <button
                    key={b.name}
                    className={'brand-chip' + (brand?.toLowerCase() === b.name.toLowerCase() ? ' on' : '')}
                    onClick={() => setBrand(brand?.toLowerCase() === b.name.toLowerCase() ? null : b.name)}
                    title={`Show templates tagged ${b.name}`}
                  >
                    {b.name} <span className="brand-count">{b.count}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="tpl-grid">
              {filtered.map((c) => (
                <TemplateCard
                  key={c.starter.id}
                  starter={c.starter}
                  data={c.data}
                  activeBrand={brand}
                  onBrand={(b) => setBrand(brand?.toLowerCase() === b.toLowerCase() ? null : b)}
                  onUse={() => startFrom(c.starter)}
                  onUsageChange={refresh}
                />
              ))}
              {!filtered.length && (
                <div className="hint pad">
                  No templates match {query ? `“${query}”` : ''}
                  {query && brand ? ' for ' : ''}
                  {brand ? `brand “${brand}”` : ''}.
                </div>
              )}
            </div>
          </aside>
          </>
          )}
        </div>
      </div>
    </div>
  )
}
