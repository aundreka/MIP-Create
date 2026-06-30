// Home / project menu — work on multiple playables. Lists every saved project
// (localStorage library), opens / creates / renames / duplicates / deletes them,
// and starts new ones blank or from a built-in starter. Opening switches the
// editor to that project (persisting the current one first).

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createProject, currentProjectId, deleteProject, duplicateProject, listProjects, loadProjectPreview, openProject, renameProject, saveCurrent } from '../projects'
import type { ProjectData } from '../bridge'
import { gameTemplateStarters, STARTERS, type Starter } from '../templates'
import { SceneThumb } from '../preview/SceneThumb'
import { allBrands, brandsFor, usagesFor } from '../templateUsage'
import { TemplateCard } from './TemplateCard'
import { Copy, Diamond, Icon, LayoutGrid, ListChecks, Pencil, Plus, Search, Star, User, X } from '../icons'

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
    const io = new IntersectionObserver(
      (es) => { if (es.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect() } },
      { rootMargin: '80px' },
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
    void loadProjectPreview(id).then(setData)
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

export function HomeScreen(props: { onClose: () => void; onProfile: () => void; onGenerate?: () => void; onQuizFunnel?: () => void; initialTab?: 'projects' | 'team' }): JSX.Element {
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
            </div>

            <div className="group-title">Your playables ({projects.length})</div>
          <div className="home-grid">
            {projects.map((p) => (
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
                        // stop Escape from also bubbling to the window handler that closes Home
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
            ))}
          </div>
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
