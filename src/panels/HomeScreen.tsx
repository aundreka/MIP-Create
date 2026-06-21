// Home / project menu — work on multiple playables. Lists every saved project
// (localStorage library), opens / creates / renames / duplicates / deletes them,
// and starts new ones blank or from a built-in starter. Opening switches the
// editor to that project (persisting the current one first).

import { useEffect, useMemo, useState } from 'react'
import { createProject, currentProjectId, deleteProject, duplicateProject, listProjects, openProject, renameProject, saveCurrent } from '../projects'
import { gameTemplateStarters, STARTERS, type Starter } from '../templates'
import { usagesFor } from '../templateUsage'
import { TemplateCard } from './TemplateCard'
import { Copy, Diamond, Icon, LayoutGrid, Pencil, Plus, Search, User, X } from '../icons'

function when(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function HomeScreen(props: { onClose: () => void; onProfile: () => void }): JSX.Element {
  const [, force] = useState(0)
  const refresh = (): void => force((n) => n + 1)
  const [editId, setEditId] = useState<string | null>(null)

  // make sure the current project's card shows its latest name/time
  useEffect(() => {
    saveCurrent()
    refresh()
  }, [])

  // Esc closes the home screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const projects = listProjects()
  const curId = currentProjectId()
  const [query, setQuery] = useState('')
  const gameCards = useMemo(() => gameTemplateStarters().map((s) => ({ starter: s, data: s.build() })), [])
  const ql = query.trim().toLowerCase()
  const filtered = ql
    ? gameCards.filter(
        (c) =>
          c.starter.label.toLowerCase().includes(ql) ||
          c.starter.description.toLowerCase().includes(ql) ||
          usagesFor(c.starter.id).some((u) => (u.client + ' ' + u.mip).toLowerCase().includes(ql)),
      )
    : gameCards

  const open = (id: string): void => {
    if (id === curId || openProject(id)) props.onClose()
  }
  const newBlank = (): void => {
    createProject()
    props.onClose()
  }
  const startFrom = (s: Starter): void => {
    createProject(s.build())
    props.onClose()
  }

  return (
    <div className="home-overlay">
      <div className="home">
        <div className="home-bar">
          <strong className="home-brand">
            <Icon icon={Diamond} size={18} fill="currentColor" /> Playables
          </strong>
          <span className="spacer" />
          <button onClick={props.onProfile}>
            <Icon icon={User} size={14} /> Profile
          </button>
          <button onClick={props.onClose}>
            <Icon icon={X} size={14} /> Close
          </button>
        </div>

        <div className="home-body">
          <div className="home-main">
            <div className="group-title">Start</div>
            <div className="home-new">
              <button className="new-card blank" onClick={newBlank}>
                <span className="plus">
                  <Icon icon={Plus} size={26} />
                </span>
                <span>New blank playable</span>
              </button>
              {STARTERS.map((s) => (
                <button key={s.id} className="new-card" onClick={() => startFrom(s)} title={s.description}>
                  <span className="plus">
                    <Icon icon={LayoutGrid} size={24} />
                  </span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>

            <div className="group-title">Your playables ({projects.length})</div>
          <div className="home-grid">
            {projects.map((p) => (
              <div key={p.id} className={'proj-card' + (p.id === curId ? ' current' : '')}>
                <button className="proj-open" onClick={() => open(p.id)} title="Open">
                  <span className="proj-thumb">
                    <Icon icon={LayoutGrid} size={30} />
                  </span>
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
                        if (e.key === 'Escape') setEditId(null)
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
                  <button title="Duplicate" onClick={() => { duplicateProject(p.id); refresh() }}>
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
            <div className="hint pad">Projects are stored on this computer. Use Save/Export to write files you can share. Opening a project auto-saves the current one first.</div>
          </div>

          <aside className="home-side">
            <div className="home-side-title">Game templates</div>
            <label className="home-search">
              <Icon icon={Search} size={15} />
              <input value={query} placeholder="Search templates or clients…" onChange={(e) => setQuery(e.target.value)} />
              {query && (
                <button className="home-search-x" onClick={() => setQuery('')} title="Clear">
                  <Icon icon={X} size={13} />
                </button>
              )}
            </label>
            <div className="tpl-grid">
              {filtered.map((c) => (
                <TemplateCard key={c.starter.id} starter={c.starter} data={c.data} onUse={() => startFrom(c.starter)} onUsageChange={refresh} />
              ))}
              {!filtered.length && <div className="hint pad">No templates match “{query}”.</div>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
