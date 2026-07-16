// Top bar — edit-mode context + primary actions only. App-level actions (Home,
// file I/O, save-as-template, Profile, theme) live in the ≡ App menu on the brand
// button. Create methods live on Home's Create gallery; insert is on the tool rail.

import { useRef, useState } from 'react'
import { loadProject as bridgeLoad, platformLabel, saveProject } from '../bridge'
import { getState, joinProjectGroup, loadProject as storeLoad, markSaved, redo, refreshScene, setOrientation, undo, useEditorState } from '../store'
import { createProject, currentProjectId, openProject, projectsInGroup, saveCurrent } from '../projects'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { HeaderPopover } from './HeaderPopover'
import { CalendarDays, ChevronDown, FolderOpen, Icon, Menu, Minus, Play, Plus, Redo2, Undo2 } from '../icons'
import { toggleTheme, useTheme } from '../theme'
import { setEditLocale, useEditLocale } from '../locale'
import { setActiveVariant, useActiveVariant } from '../variantMode'

async function doSave(): Promise<void> {
  const s = getState()
  const r = await saveProject({ project: s.project, assets: s.assets, trace: s.trace }, s.projectPath)
  if (r.ok) markSaved(r.path ?? null)
  else if (r.error && r.error !== 'canceled') alert('Save failed: ' + r.error)
}
async function doOpen(): Promise<void> {
  const r = await bridgeLoad()
  if (r) storeLoad(r.data.project, r.data.assets, r.path, r.data.trace)
}

export function Topbar(props: {
  zoom: number
  onZoom: (z: number) => void
  onFit: () => void
  onPreview: () => void
  onSaveTemplate: () => void
  onHome: () => void
  onProfile: () => void
  onProjectSettings: () => void
  onExport: () => void
  onQa: () => void
  onQaCheck: () => void
  onShare: () => void
}): JSX.Element {
  const { orientation, dirty, projectPath, canUndo, canRedo, scene } = useEditorState()
  const theme = useTheme()
  const editLocale = useEditLocale()
  const locales = scene.meta.locales ?? []
  const activeVariant = useActiveVariant()
  const variants = scene.meta.variants ?? []

  // ---- date-header popover: quick-access date band customization -------------
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

  // ---- project switcher: hop between MIPs of the same project group ----------
  const projBtn = useRef<HTMLButtonElement>(null)
  const [projMenu, setProjMenu] = useState<{ x: number; y: number } | null>(null)
  const projectId = scene.meta.projectId
  const projectName = scene.meta.projectName
  const curId = currentProjectId()
  const openProjMenu = (): void => {
    const r = projBtn.current?.getBoundingClientRect()
    if (r) setProjMenu({ x: r.left, y: r.bottom + 4 })
  }
  const newMipInProject = async (): Promise<void> => {
    if (!projectId || !projectName) return
    const id = await createProject() // blank MIP, switches to it (persists the current one first)
    joinProjectGroup(projectId, projectName)
    await saveCurrent() // persist membership so the switcher lists it
    await openProject(id) // reconcile the project's shared elements into the new MIP
  }
  const projItems: MenuItem[] = projectId
    ? [
        ...projectsInGroup(projectId).map((r) => ({
          label: (r.id === curId ? '● ' : '○ ') + r.name,
          onClick: () => { if (r.id !== curId) void openProject(r.id) },
        })),
        { sep: true, label: '' },
        { label: '+ New MIP in this project', onClick: () => void newMipInProject() },
      ]
    : []
  const appItems: MenuItem[] = [
    { label: 'Home / Projects…', onClick: props.onHome },
    { sep: true, label: '' },
    { label: 'Save…', onClick: () => void doSave() },
    { label: 'Open…', onClick: () => void doOpen() },
    { label: 'Save as template…', onClick: props.onSaveTemplate },
    { sep: true, label: '' },
    { label: 'Project settings…', onClick: props.onProjectSettings },
    { label: 'Share / import by code…', onClick: props.onShare },
    { label: 'QA & reports…', onClick: props.onQa },
    { label: 'QA checker (vs Figma mockup)…', onClick: props.onQaCheck },
    { label: 'Profile…', onClick: props.onProfile },
    { label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', onClick: () => toggleTheme() },
  ]

  return (
    <div className="topbar">
      <button className="brand" ref={appBtn} onClick={openApp} title="Menu: Home, file, profile, theme">
        <Icon icon={Menu} size={16} /> {scene.meta.name || 'untitled'} <Icon icon={ChevronDown} size={12} />
      </button>
      {projectId && (
        <button className="proj-switch" ref={projBtn} onClick={openProjMenu} title={`Switch MIPs in “${projectName}”`}>
          <Icon icon={FolderOpen} size={13} /> {projectName} <Icon icon={ChevronDown} size={11} />
        </button>
      )}
      {dirty && <span className="dot" title="Unsaved changes" />}

      <span className="seg">
        <button className={orientation === 'portrait' ? 'on' : ''} onClick={() => setOrientation('portrait')}>
          Portrait
        </button>
        <button className={orientation === 'landscape' ? 'on' : ''} onClick={() => setOrientation('landscape')}>
          Landscape
        </button>
      </span>

      {locales.length > 0 && (
        <select
          className="locale-pick"
          value={editLocale ?? ''}
          title="Editing / preview language (runtime auto-detects from the browser)"
          onChange={(e) => setEditLocale(e.target.value || null)}
        >
          <option value="">{scene.meta.defaultLocale ? `Base (${scene.meta.defaultLocale})` : 'Base'}</option>
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
          onChange={(e) => { setActiveVariant(e.target.value || null); refreshScene() }}
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

      <span className="sep" />
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

      <span className="spacer" />
      <button
        ref={headerBtn}
        className={'icon' + (scene.meta.header ? ' on' : '')}
        title="Header (date or countdown)"
        aria-pressed={!!scene.meta.header}
        onClick={toggleHeaderPop}
      >
        <Icon icon={CalendarDays} size={15} />
      </button>
      <button onClick={props.onPreview} title="Preview the ad">
        <Icon icon={Play} size={14} /> Preview
      </button>
      <button className="primary" onClick={props.onExport}>
        Export
      </button>
      <span className="hint">{platformLabel}{projectPath ? ' · ' + projectPath.split(/[\\/]/).pop() : ''}</span>

      {appMenu && <ContextMenu x={appMenu.x} y={appMenu.y} items={appItems} onClose={() => setAppMenu(null)} />}
      {projMenu && <ContextMenu x={projMenu.x} y={projMenu.y} items={projItems} onClose={() => setProjMenu(null)} />}
      {headerPop && <HeaderPopover anchor={headerPop} onClose={() => setHeaderPop(null)} />}
    </div>
  )
}
