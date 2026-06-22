// Top bar — minimal: project name, orientation toggle, undo/redo, zoom, Preview,
// Save/Open. (Insert moved to the tool rail; z-order moved to draggable layers.)

import { loadProject as bridgeLoad, platformLabel, saveProject } from '../bridge'
import { getState, loadProject as storeLoad, markSaved, redo, refreshScene, setOrientation, undo, useEditorState } from '../store'
import { Icon, Menu, Minus, Moon, Play, Plus, Redo2, Sun, Undo2, Volume2 } from '../icons'
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

export function Topbar(props: { zoom: number; onZoom: (z: number) => void; onFit: () => void; onPreview: () => void; onFigma: () => void; onSfx: () => void; onTemplates: () => void; onHome: () => void; onExport: () => void; onQuizFunnel: () => void; onQa: () => void; onTeam: () => void }): JSX.Element {
  const { orientation, dirty, projectPath, canUndo, canRedo, scene } = useEditorState()
  const theme = useTheme()
  const editLocale = useEditLocale()
  const locales = scene.meta.locales ?? []
  const activeVariant = useActiveVariant()
  const variants = scene.meta.variants ?? []
  return (
    <div className="topbar">
      <button className="brand" onClick={props.onHome} title="Projects / home menu">
        <Icon icon={Menu} size={16} /> {scene.meta.name || 'untitled'}
      </button>
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
      <button className="icon" title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => toggleTheme()}>
        <Icon icon={theme === 'dark' ? Sun : Moon} />
      </button>
      <button onClick={props.onPreview} title="Preview the ad">
        <Icon icon={Play} size={14} /> Preview
      </button>
      <button onClick={props.onTemplates} title="Start from / save a reusable template">
        Templates
      </button>
      <button onClick={props.onQuizFunnel} title="Generate a quiz / survey funnel from pasted questions">
        Quiz funnel
      </button>
      <button onClick={props.onQa} title="Check style/SFX/animation consistency across this client's MIPs">
        QA
      </button>
      <button onClick={props.onTeam} title="Team library — publish / browse MIPs, monitor progress">
        Team
      </button>
      <button onClick={props.onFigma}>Figma</button>
      <button onClick={props.onSfx} title="Sound (event SFX + background music)">
        <Icon icon={Volume2} size={14} /> Sound
      </button>
      <button onClick={() => void doSave()}>Save</button>
      <button onClick={() => void doOpen()}>Open</button>
      <button className="primary" onClick={props.onExport}>
        Export
      </button>
      <span className="hint">{platformLabel}{projectPath ? ' · ' + projectPath.split(/[\\/]/).pop() : ''}</span>
    </div>
  )
}
