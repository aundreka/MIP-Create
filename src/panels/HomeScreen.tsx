// Home / project menu — work on multiple playables. Lists every saved project
// (localStorage library), opens / creates / renames / asset-flips / deletes them,
// and starts new ones blank or from a built-in starter. Opening switches the
// editor to that project (persisting the current one first).

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createProject, currentProjectId, deleteProject, listProjects, loadProjectPreview, projectElementNames, projectGameTypes, openProject, renameProject, saveCurrent, type ProjectRecord } from '../projects'
import type { ProjectData } from '../bridge'
import type { Project } from '../../runtime/scene'
import type { AssetMap } from '../../runtime/types'
import { gameTemplateStarters, STARTERS, type Starter } from '../templates'
import { SceneThumb } from '../preview/SceneThumb'
import { previewNowMs } from '../uiState'
import { getTemplate } from '../../runtime/games/registry'
import { allBrands, brandsFor, usagesFor } from '../templateUsage'
import { TemplateCard } from './TemplateCard'
import { AssetFlipModal } from './AssetFlipModal'
import { TranslationMergeModal } from './TranslationMergeModal'
import { exportAllData, backupFilename, importAllData, readBackupInfo } from '../backup'
import { downloadBlob } from '../export'
import { Copy, Diamond, FolderOpen, Icon, Languages, LayoutGrid, ListChecks, MoreHorizontal, Plus, Search, Star, Upload, User, X } from '../icons'
import { ContextMenu, type MenuItem } from './ContextMenu'

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

  // Show the first game scene; fall back to the start scene, then the first scene.
  const scene = data?.project.scenes.find((s) => s.kind === 'game') ??
    data?.project.scenes.find((s) => s.id === data.project.startSceneId) ??
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

const HOVER_DELAY_MS = 2000

const HOVER_SCENES = 5

// One scene playing live in the real runtime (pa:play with this scene as the start
// and its advance forced to manual), so its intro animations run and it stays put.
function LiveScene(props: { project: Project; assets: AssetMap; sceneId: string; scale: number }): JSX.Element {
  const { project, assets, sceneId, scale } = props
  const ref = useRef<HTMLIFrameElement>(null)
  const post = (): void => {
    const p = { ...project, startSceneId: sceneId, scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, advance: { on: 'manual' as const } } : s)) }
    ref.current?.contentWindow?.postMessage({ type: 'pa:play', project: p, assets, previewNow: previewNowMs() }, '*')
  }
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.source === ref.current?.contentWindow && (e.data as { type?: string })?.type === 'pa:ready') post()
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const bw = project.meta.baseW || 1080
  const bh = project.meta.baseH || 1920
  return (
    <div className="proj-hover-preview" style={{ width: Math.round(bw * scale), height: Math.round(bh * scale) }}>
      <iframe
        ref={ref}
        src="./runtime-frame.html"
        title="Scene preview"
        onLoad={post}
        tabIndex={-1}
        style={{ width: bw, height: bh, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none' }}
      />
    </div>
  )
}

// Hover-and-hold preview of a project's first HOVER_SCENES scenes (strip order),
// side by side in a centered modal. The modal ignores the pointer, so the card
// underneath keeps its hover and the preview closes when the mouse leaves the card.
function HoverPreview(props: { id: string }): JSX.Element | null {
  const [data, setData] = useState<ProjectData | null>(null)
  useEffect(() => {
    let alive = true
    void loadProjectPreview(props.id).then((d) => { if (alive) setData(d) })
    return () => { alive = false }
  }, [props.id])
  if (!data) return null
  const scenes = data.project.scenes.slice(0, HOVER_SCENES)
  const bw = data.project.meta.baseW || 1080
  const bh = data.project.meta.baseH || 1920
  // Fit the row of scenes into 90% of the viewport (GAP px between, LABEL px for names).
  const GAP = 16
  const LABEL = 24
  const n = Math.max(1, scenes.length)
  const scale = Math.min((window.innerHeight * 0.9 - LABEL) / bh, (window.innerWidth * 0.9 - GAP * (n - 1)) / (bw * n))
  return (
    <div className="proj-hover-backdrop">
      <div className="proj-hover-row" style={{ gap: GAP }}>
        {scenes.map((sd) => (
          <div key={sd.id} className="proj-hover-scene">
            <LiveScene project={data.project} assets={data.assets} sceneId={sd.id} scale={scale} />
            <span className="proj-hover-name">{sd.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function when(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function HomeScreen(props: { onClose: () => void; onProfile: () => void; onGenerate?: () => void; onQuizFunnel?: () => void; onImportBuilt?: () => void; onShare?: () => void; onShareProject?: (id: string, name: string) => void; onUploadProject?: (projectIds: string[], label: string) => void; onQaCheck?: () => void; initialTab?: 'projects' | 'team' }): JSX.Element {
  const [tick, force] = useState(0)
  const refresh = (): void => force((n) => n + 1)
  const [editId, setEditId] = useState<string | null>(null)
  const [view, setView] = useState<'projects' | 'team'>(props.initialTab ?? 'projects')
  const [assetFlipSource, setAssetFlipSource] = useState<string | null>(null)
  const [translationMergeIds, setTranslationMergeIds] = useState<string[] | null>(null)

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
      // An open menu or dialog takes the Escape; Home only closes when nothing else is up.
      if (document.querySelector('.ctx-menu, .modal-overlay, .drawer-backdrop')) return
      props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const projects = listProjects()
  const curId = currentProjectId()
  const convenientTranslationIds = (): string[] => {
    const current = projects.find((project) => project.id === curId)
    if (current?.projectId) {
      const siblings = projects.filter((project) => project.projectId === current.projectId).map((project) => project.id)
      if (siblings.length >= 2) return siblings
    }
    return curId ? [curId] : projects[0] ? [projects[0].id] : []
  }
  const [query, setQuery] = useState('')
  const [projQuery, setProjQuery] = useState('')
  // ⋯ menus: the top bar's tools/backup menu, and one per playable card.
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null)
  const [cardMenu, setCardMenu] = useState<{ id: string; x: number; y: number; alignRight: boolean } | null>(null)
  const [gameType, setGameType] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const startHover = (id: string): void => {
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHover(id), HOVER_DELAY_MS)
  }
  const endHover = (): void => {
    window.clearTimeout(hoverTimer.current)
    setHover(null)
  }
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])
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
  // Project search matches the MIP's own name or its project group's name.
  const pq = projQuery.trim().toLowerCase()
  // Minigame chips: every template used across the library, with how many MIPs use it.
  const gameTypeCounts = new Map<string, number>()
  for (const p of projects) for (const t of projectGameTypes(p)) gameTypeCounts.set(t, (gameTypeCounts.get(t) ?? 0) + 1)
  const gameTypeChips = [...gameTypeCounts]
    .map(([id, count]) => ({ id, count, label: getTemplate(id)?.label ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const activeGameType = gameType && gameTypeCounts.has(gameType) ? gameType : null
  // One search box: the MIP's name, its project's name, or any element name inside it.
  const shownProjects = projects.filter((p) => {
    if (activeGameType && !projectGameTypes(p).includes(activeGameType)) return false
    return !pq || p.name.toLowerCase().includes(pq) || (p.projectName ?? '').toLowerCase().includes(pq) || projectElementNames(p).some((n) => n.includes(pq))
  })
  const filteringProjects = !!pq || !!activeGameType
  const blocks: Block[] = []
  const groupBlock = new Map<string, Block & { kind: 'group' }>()
  for (const p of shownProjects) {
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
    <div
      key={p.id}
      className={'proj-card' + (p.id === curId ? ' current' : '')}
      onContextMenu={(e) => {
        e.preventDefault()
        setCardMenu({ id: p.id, x: e.clientX, y: e.clientY, alignRight: false })
      }}
    >
      <button
        className="proj-open"
        onClick={() => { endHover(); void open(p.id) }}
        title="Open"
        onMouseEnter={() => startHover(p.id)}
        onMouseLeave={endHover}
      >
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
      <button
        className="proj-more"
        title="Playable actions"
        aria-label="Playable actions"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setCardMenu({ id: p.id, x: r.right, y: r.bottom + 4, alignRight: true })
        }}
      >
        <Icon icon={MoreHorizontal} size={15} />
      </button>
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
          <button
            title="Tools and backup"
            aria-label="Tools and backup"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMoreMenu({ x: r.right, y: r.bottom + 4 })
            }}
          >
            <Icon icon={MoreHorizontal} size={15} />
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
            </div>

            <div className="group-title">Your playables ({filteringProjects ? `${shownProjects.length} of ${projects.length}` : projects.length})</div>
            <label className="home-search proj-search">
              <Icon icon={Search} size={15} />
              <input value={projQuery} placeholder="Search playables, projects or elements…" onChange={(e) => setProjQuery(e.target.value)} />
              {projQuery && (
                <button className="home-search-x" onClick={() => setProjQuery('')} title="Clear">
                  <Icon icon={X} size={13} />
                </button>
              )}
            </label>
            {gameTypeChips.length > 0 && (
              <div className="brand-filter proj-game-filter" role="group" aria-label="Filter playables by minigame type">
                <button className={'brand-chip' + (activeGameType === null ? ' on' : '')} onClick={() => setGameType(null)}>
                  All <span className="brand-count">{projects.length}</span>
                </button>
                {gameTypeChips.map((g) => (
                  <button
                    key={g.id}
                    className={'brand-chip' + (activeGameType === g.id ? ' on' : '')}
                    onClick={() => setGameType(activeGameType === g.id ? null : g.id)}
                    title={`Show playables with a ${g.label} minigame`}
                  >
                    {g.label} <span className="brand-count">{g.count}</span>
                  </button>
                ))}
              </div>
            )}
            {filteringProjects && !shownProjects.length && (
              <div className="hint pad">
                No playables match{pq ? ` “${projQuery}”` : ''}
                {activeGameType ? ` with a ${getTemplate(activeGameType)?.label ?? activeGameType} minigame` : ''}.
              </div>
            )}
          {blocks.map((b) =>
            b.kind === 'group' ? (
              <div key={'g:' + b.id} className="proj-group">
                <div className="proj-group-head">
                  <Icon icon={FolderOpen} size={14} /> {b.name} <span className="proj-group-count">{b.items.length}</span>
                  {props.onUploadProject && (
                    <>
                      <span className="spacer" />
                      <button onClick={() => props.onUploadProject!(b.items.map((item) => item.id), b.name)} title={`Build and upload all ${b.items.length} MIPs in this project`}>
                        <Icon icon={Upload} size={13} /> Upload project
                      </button>
                    </>
                  )}
                  {b.items.length >= 2 && (
                    <>
                      <span className={props.onUploadProject ? '' : 'spacer'} />
                      <button onClick={() => setTranslationMergeIds(b.items.map((item) => item.id))} title={`Use these ${b.items.length} playables as language copies of one dynamic playable`}>
                        <Icon icon={Languages} size={13} /> Combine translations
                      </button>
                    </>
                  )}
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
      {hover && <HoverPreview key={hover} id={hover} />}
      {moreMenu && (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          alignRight
          onClose={() => setMoreMenu(null)}
          items={[
            { label: 'Copy / Asset flip...', onClick: () => setAssetFlipSource(curId ?? projects[0]?.id ?? '') },
            { label: 'Combine translations...', disabled: projects.length < 2, onClick: () => setTranslationMergeIds(convenientTranslationIds()) },
            ...(props.onQaCheck ? [{ label: 'QA checker (vs Figma mockup)...', onClick: () => props.onQaCheck!() }] : []),
            { sep: true, label: '' },
            { label: 'Download a backup of everything', onClick: () => void doBackup() },
            { label: 'Restore from a backup...', onClick: () => backupInputRef.current?.click() },
          ]}
        />
      )}
      {cardMenu && (() => {
        const p = projects.find((x) => x.id === cardMenu.id)
        if (!p) return null
        const items: MenuItem[] = [
          { label: 'Open', onClick: () => void open(p.id) },
          { label: 'Rename', onClick: () => setEditId(p.id) },
          { label: 'Copy / Asset flip...', onClick: () => setAssetFlipSource(p.id) },
          ...(props.onUploadProject ? [{ label: 'Upload...', onClick: () => props.onUploadProject!([p.id], p.name) }] : []),
          ...(props.onShareProject ? [{ label: 'Share (get a code / link)...', onClick: () => props.onShareProject!(p.id, p.name) }] : []),
          { sep: true, label: '' },
          {
            label: 'Delete',
            disabled: projects.length <= 1,
            onClick: () => {
              if (confirm(`Delete "${p.name}"? This can't be undone.`)) {
                deleteProject(p.id)
                refresh()
              }
            },
          },
        ]
        return <ContextMenu x={cardMenu.x} y={cardMenu.y} alignRight={cardMenu.alignRight} items={items} onClose={() => setCardMenu(null)} />
      })()}
      {assetFlipSource !== null && projects.length > 0 && (
        <AssetFlipModal
          projects={projects}
          initialSourceId={assetFlipSource || projects[0].id}
          onClose={() => setAssetFlipSource(null)}
          onCreated={() => { setAssetFlipSource(null); props.onClose() }}
        />
      )}
      {translationMergeIds !== null && projects.length >= 2 && (
        <TranslationMergeModal
          projects={projects}
          initialSelectedIds={translationMergeIds}
          onClose={() => setTranslationMergeIds(null)}
          onCreated={() => { setTranslationMergeIds(null); props.onClose() }}
        />
      )}
    </div>
  )
}
