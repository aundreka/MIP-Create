// Top bar - edit-mode context + primary actions only. App-level actions (Home,
// file I/O, save-as-template, Profile, theme) live in the app menu on the brand
// button. Create methods live on Home's Create gallery; insert is on the tool rail.

import { useEffect, useRef, useState } from 'react'
import { loadProject as bridgeLoad, saveProject } from '../bridge'
import { parseRepo, readGithubLink, writeGithubLink } from '../github'
import { getState, joinProjectGroup, loadProject as storeLoad, markSaved, redo, refreshScene, setOrientation, undo, useEditorState } from '../store'
import { createProject, currentProjectId, openProject, projectsInGroup, saveCurrent } from '../projects'
import { appAlert } from './AppDialogs'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { HeaderPopover } from './HeaderPopover'
import { CalendarDays, ChevronDown, FolderOpen, Frame, Icon, Menu, PanelTop, Minus, Play, Plus, RectangleHorizontal, RectangleVertical, Redo2, Undo2, X } from '../icons'
import { endcardScenes } from '../sip'
import { toggleTheme, useTheme } from '../theme'
import { setEditLocale, useEditLocale } from '../locale'
import { setActiveVariant, useActiveVariant } from '../variantMode'
import { setPreviewDate, usePreviewDate } from '../uiState'

async function doSave(): Promise<void> {
  const s = getState()
  const r = await saveProject({ project: s.project, assets: s.assets, trace: s.trace }, s.projectPath)
  if (r.ok) markSaved(r.path ?? null)
  else if (r.error && r.error !== 'canceled') await appAlert('Save failed: ' + r.error)
}

async function doOpen(): Promise<void> {
  const r = await bridgeLoad()
  if (r) storeLoad(r.data.project, r.data.assets, r.path, r.data.trace)
}

// Paste-and-go GitHub repo link for the current project, right where Push to
// GitHub lives. Branch, folder, commit text and the token stay whatever Project
// settings > GitHub says — this only swaps which repository the push targets.
function RepoQuickInput(props: { groupKey: string }): JSX.Element {
  const [val, setVal] = useState('')
  const [bad, setBad] = useState(false)
  useEffect(() => {
    const l = readGithubLink()
    setVal(l ? `${l.owner}/${l.repo}` : '')
    setBad(false)
  }, [props.groupKey])
  const commit = (): void => {
    const txt = val.trim()
    const prev = readGithubLink()
    if (!txt) {
      if (prev) writeGithubLink(null)
      setBad(false)
      return
    }
    const parsed = parseRepo(txt)
    if (!parsed) {
      setBad(true)
      return
    }
    writeGithubLink({ owner: parsed.owner, repo: parsed.repo, branch: prev?.branch || 'main', dir: prev?.dir ?? '', message: prev?.message ?? '' })
    setVal(`${parsed.owner}/${parsed.repo}`)
    setBad(false)
  }
  return (
    <input
      className={'repo-quick' + (bad ? ' bad' : '')}
      value={val}
      spellCheck={false}
      placeholder="GitHub repo…"
      title={
        bad
          ? 'Paste owner/repo or a github.com link'
          : 'Repository Push to GitHub targets for this project — paste owner/repo or a github.com link. Token and branch live in Project settings > GitHub.'
      }
      onChange={(e) => {
        setVal(e.target.value)
        setBad(false)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function Topbar(props: {
  zoom: number
  onZoom: (z: number) => void
  showHandles: boolean
  onToggleHandles: () => void
  onFit: () => void
  onPreview: () => void
  onSaveTemplate: () => void
  onHome: () => void
  onProfile: () => void
  onProjectSettings: () => void
  onQuickExport: () => void
  quickExportBusy: boolean
  onQuickViteExport: () => void
  quickViteExportBusy: boolean
  onQuickProjectViteExport: () => void
  quickProjectViteExportBusy: boolean
  onQuickSip: () => void
  quickSipBusy: boolean
  onGithubPush: () => void
  githubBusy: string | null
  onExport: () => void
  onUpload: () => void
  onQa: () => void
  onQaCheck: () => void
  onShare: () => void
  onFigma: () => void
}): JSX.Element {
  const { orientation, dirty, canUndo, canRedo, scene, project } = useEditorState()
  const hasEndcard = endcardScenes(project).length > 0
  const previewDate = usePreviewDate()
  const theme = useTheme()
  const editLocale = useEditLocale()
  const locales = scene.meta.locales ?? []
  const activeVariant = useActiveVariant()
  const variants = scene.meta.variants ?? []

  const headerBtn = useRef<HTMLButtonElement>(null)
  const [headerPop, setHeaderPop] = useState<DOMRect | null>(null)
  const toggleHeaderPop = (): void => {
    setHeaderPop((cur) => (cur ? null : (headerBtn.current?.getBoundingClientRect() ?? null)))
  }

  const appBtn = useRef<HTMLButtonElement>(null)
  const [appMenu, setAppMenu] = useState<{ x: number; y: number } | null>(null)
  const openApp = (): void => {
    const r = appBtn.current?.getBoundingClientRect()
    if (r) setAppMenu({ x: r.left, y: r.bottom + 4 })
  }

  const projBtn = useRef<HTMLButtonElement>(null)
  const [projMenu, setProjMenu] = useState<{ x: number; y: number } | null>(null)
  const projectId = scene.meta.projectId
  const projectName = scene.meta.projectName
  const curId = currentProjectId()
  const openProjMenu = (): void => {
    const r = projBtn.current?.getBoundingClientRect()
    if (r) setProjMenu({ x: r.left, y: r.bottom + 4 })
  }

  // Every delivery path hangs off the one Export button: the main half opens the
  // Export dialog, the caret lists the one-click variants.
  const exportBtn = useRef<HTMLButtonElement>(null)
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null)
  const openExportMenu = (): void => {
    const r = exportBtn.current?.getBoundingClientRect()
    if (r) setExportMenu({ x: r.right, y: r.bottom + 4 })
  }
  const busy =
    props.githubBusy ??
    (props.quickExportBusy
      ? 'Exporting...'
      : props.quickSipBusy
        ? 'Exporting SIP...'
        : props.quickViteExportBusy || props.quickProjectViteExportBusy
          ? 'Exporting source...'
          : null)
  const exportItems: MenuItem[] = [
    { label: 'Quick export (saved settings)', onClick: props.onQuickExport },
    { label: hasEndcard ? 'End card only (SIP)' : 'End card only (SIP) - no end card', onClick: props.onQuickSip, disabled: !hasEndcard },
    { sep: true, label: '' },
    { label: 'Source code - this MIP', onClick: props.onQuickViteExport },
    { label: 'Source code - whole project', onClick: props.onQuickProjectViteExport },
    { sep: true, label: '' },
    { label: 'Upload...', onClick: props.onUpload },
    { label: 'Push to GitHub', onClick: props.onGithubPush },
  ]

  const newMipInProject = async (): Promise<void> => {
    if (!projectId || !projectName) return
    const id = await createProject()
    joinProjectGroup(projectId, projectName)
    await saveCurrent()
    await openProject(id)
  }

  const projItems: MenuItem[] = projectId
    ? [
        ...projectsInGroup(projectId).map((r) => ({
          label: r.name + (r.id === curId ? '  (open)' : ''),
          disabled: r.id === curId,
          onClick: () => {
            if (r.id !== curId) void openProject(r.id)
          },
        })),
        { sep: true, label: '' },
        { label: '+ New MIP in this project', onClick: () => void newMipInProject() },
      ]
    : []

  const appItems: MenuItem[] = [
    { label: 'Home / Projects...', onClick: props.onHome },
    { sep: true, label: '' },
    { label: 'Save...', onClick: () => void doSave() },
    { label: 'Open...', onClick: () => void doOpen() },
    { label: 'Save as template...', onClick: props.onSaveTemplate },
    { label: 'Import from Figma...', onClick: props.onFigma },
    { sep: true, label: '' },
    { label: 'Project settings...', onClick: props.onProjectSettings },
    { label: 'Share / import by code...', onClick: props.onShare },
    { label: 'QA & reports...', onClick: props.onQa },
    { label: 'QA checker (vs Figma mockup)...', onClick: props.onQaCheck },
    { label: 'Profile...', onClick: props.onProfile },
    { label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', onClick: () => toggleTheme() },
    // Narrow windows hide the zoom cluster and handles toggle from the bar;
    // these keep them reachable (harmless duplicates at full width).
    { sep: true, label: '' },
    { label: 'Zoom in', onClick: () => props.onZoom(props.zoom * 1.2) },
    { label: 'Zoom out', onClick: () => props.onZoom(props.zoom / 1.2) },
    { label: 'Fit zoom (Shift+1)', onClick: props.onFit },
    { label: (props.showHandles ? 'Hide' : 'Show') + ' selection handles (Ctrl+Shift+H)', onClick: props.onToggleHandles },
  ]

  return (
    <div className="topbar">
      <button className="brand" ref={appBtn} onClick={openApp} title="Menu">
        <Icon icon={Menu} size={16} /> {scene.meta.name || 'untitled'} <Icon icon={ChevronDown} size={12} />
      </button>
      {projectId && (
        <button className="proj-switch" ref={projBtn} onClick={openProjMenu} title={`Switch MIPs in "${projectName}"`}>
          <Icon icon={FolderOpen} size={13} /> {projectName} <Icon icon={ChevronDown} size={11} />
        </button>
      )}
      {dirty && <span className="dot" title="Unsaved changes" />}
      {/* A preview date silently changes what every canvas, thumbnail and Preview shows
          — including which holiday label is on screen — so it gets a chip nobody can miss
          and a one-click way back to today. Export is never affected. */}
      {previewDate && (
        <button
          className="preview-date-chip"
          title="The editor is rendering another day (dynamic holiday preview). Click to go back to today."
          onClick={() => setPreviewDate(null)}
        >
          <Icon icon={CalendarDays} size={12} /> {previewDate} <Icon icon={X} size={11} />
        </button>
      )}

      <span className="seg tb-orient-seg">
        <button className={orientation === 'portrait' ? 'on' : ''} onClick={() => setOrientation('portrait')}>
          Portrait
        </button>
        <button className={orientation === 'landscape' ? 'on' : ''} onClick={() => setOrientation('landscape')}>
          Landscape
        </button>
      </span>
      {/* Narrow windows (<1100px) swap the labeled seg for this icon toggle — CSS shows one or the other. */}
      <button
        className="icon tb-orient"
        title={orientation === 'portrait' ? 'Portrait - switch to landscape' : 'Landscape - switch to portrait'}
        onClick={() => setOrientation(orientation === 'portrait' ? 'landscape' : 'portrait')}
      >
        <Icon icon={orientation === 'portrait' ? RectangleVertical : RectangleHorizontal} size={15} />
      </button>

      {locales.length > 0 && (
        <select
          className="locale-pick"
          value={editLocale ?? ''}
          title="Editing / preview language (runtime auto-detects from the browser)"
          onChange={(e) => setEditLocale(e.target.value || null)}
        >
          <option value="">Default ({scene.meta.defaultLocale || 'en'})</option>
          {locales.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      )}
      {variants.length > 0 && (
        <select
          className={'locale-pick' + (activeVariant ? ' editing' : '')}
          value={activeVariant ?? ''}
          title="Edit the base MIP or one of its variants"
          onChange={(e) => {
            setActiveVariant(e.target.value || null)
            refreshScene()
          }}
        >
          <option value="">Base MIP</option>
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      )}

      <span className="sep" />
      <button className="icon" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        <Icon icon={Undo2} />
      </button>
      <button className="icon" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
        <Icon icon={Redo2} />
      </button>

      <span className="sep tb-zoom-sep" />
      <span className="zoom">
        <button className="icon" title="Zoom out" onClick={() => props.onZoom(props.zoom / 1.2)}>
          <Icon icon={Minus} size={14} />
        </button>
        <button className="zoom-val" title="Fit (Shift+1)" onClick={props.onFit}>
          {Math.round(props.zoom * 100)}%
        </button>
        <button className="icon" title="Zoom in" onClick={() => props.onZoom(props.zoom * 1.2)}>
          <Icon icon={Plus} size={14} />
        </button>
      </span>
      <button
        className={'icon tb-handles' + (props.showHandles ? ' on' : '')}
        title={(props.showHandles ? 'Hide' : 'Show') + ' selection handles (Ctrl+Shift+H)'}
        aria-pressed={props.showHandles}
        onClick={props.onToggleHandles}
      >
        <Icon icon={Frame} size={15} />
      </button>

      <span className="spacer" />
      <RepoQuickInput groupKey={projectId ?? curId ?? ''} />
      <button ref={headerBtn} className={'icon' + (scene.meta.header ? ' on' : '')} title="Header (date or countdown)" aria-pressed={!!scene.meta.header} onClick={toggleHeaderPop}>
        <Icon icon={PanelTop} size={15} />
      </button>
      <button onClick={props.onPreview} title="Preview the ad">
        <Icon icon={Play} size={14} /> Preview
      </button>
      <span className="split-btn">
        <button className="primary" onClick={props.onExport} disabled={!!busy}>
          {busy ?? 'Export'}
        </button>
        <button className="primary split-caret" ref={exportBtn} onClick={openExportMenu} disabled={!!busy} aria-label="More export options">
          <Icon icon={ChevronDown} size={13} />
        </button>
      </span>

      {appMenu && <ContextMenu x={appMenu.x} y={appMenu.y} items={appItems} onClose={() => setAppMenu(null)} />}
      {projMenu && <ContextMenu x={projMenu.x} y={projMenu.y} items={projItems} onClose={() => setProjMenu(null)} />}
      {exportMenu && <ContextMenu x={exportMenu.x} y={exportMenu.y} alignRight items={exportItems} onClose={() => setExportMenu(null)} />}
      {headerPop && <HeaderPopover anchor={headerPop} onClose={() => setHeaderPop(null)} />}
    </div>
  )
}
