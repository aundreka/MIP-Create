// Scenes strip — the project's ordered scenes as tabs. Click to edit; ★ sets the
// start scene; double-click the name to rename; ▶ previews just that scene; drag
// to reorder; duplicate/delete; add Game/Win/Endscene/Blank.

import { useState } from 'react'
import { addScene, duplicateScene, patchSceneDef, removeScene, reorderScenes, setActiveScene, setStartScene, useEditorState } from '../store'
import { Copy, Eye, EyeOff, Icon, LayoutGrid, Pencil, Play, SCENE_KIND_ICON, Star, X } from '../icons'
import { SceneThumb } from '../preview/SceneThumb'
import { hiddenCount, isSceneHidden, showAllScenes, soloScene, toggleSceneHidden, useCanvasView } from '../canvasView'

// Live thumbnails are real iframes — cap how many we mount so a project with many
// scenes falls back to compact icon chips.
const MAX_THUMBS = 8

export function ScenesStrip(props: { onPreviewScene: (id: string) => void }): JSX.Element {
  const { project, assets, activeSceneId } = useEditorState()
  useCanvasView() // re-render when canvas visibility changes
  const [dragId, setDragId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const showThumbs = project.scenes.length <= MAX_THUMBS
  const allIds = project.scenes.map((s) => s.id)

  const drop = (targetId: string): void => {
    if (!dragId || dragId === targetId) return
    const ids = project.scenes.map((s) => s.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    reorderScenes(ids)
  }

  return (
    <div className="scenes-strip">
      <span className="scenes-label">Scenes</span>
      {project.scenes.map((s, i) => (
        <div
          key={s.id}
          className={'scene-chip' + (s.id === activeSceneId ? ' active' : '') + (isSceneHidden(s.id) ? ' canvas-hidden' : '')}
          draggable={editId !== s.id}
          onDragStart={() => setDragId(s.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            drop(s.id)
            setDragId(null)
          }}
          onClick={() => setActiveScene(s.id)}
          title={s.kind ?? 'custom'}
        >
          <button
            className={'scene-star' + (project.startSceneId === s.id ? ' on' : '')}
            title="Set as start scene"
            onClick={(e) => {
              e.stopPropagation()
              setStartScene(s.id)
            }}
          >
            <Icon icon={Star} size={13} fill={project.startSceneId === s.id ? 'currentColor' : 'none'} />
          </button>
          {showThumbs ? (
            <SceneThumb project={project} def={s} assets={assets} h={34} />
          ) : (
            <span className="scene-icon">
              <Icon icon={SCENE_KIND_ICON[s.kind ?? 'custom'] ?? LayoutGrid} size={13} />
            </span>
          )}
          {editId === s.id ? (
            <input
              className="scene-rename"
              autoFocus
              defaultValue={s.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                patchSceneDef(s.id, { name: e.target.value.trim() || s.name })
                setEditId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditId(null)
              }}
            />
          ) : (
            <span
              className="scene-name"
              title="Double-click to rename"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditId(s.id)
              }}
            >
              {s.name}
            </span>
          )}
          <span className="scene-num">{i + 1}</span>
          <button
            className="scene-mini"
            title={isSceneHidden(s.id) ? 'Show on canvas (Alt-click: solo)' : 'Hide from canvas (Alt-click: solo)'}
            onClick={(e) => {
              e.stopPropagation()
              if (e.altKey) {
                soloScene(s.id, allIds)
                setActiveScene(s.id)
              } else {
                toggleSceneHidden(s.id)
              }
            }}
          >
            <Icon icon={isSceneHidden(s.id) ? EyeOff : Eye} size={13} />
          </button>
          <button
            className="scene-mini"
            title="Preview this scene"
            onClick={(e) => {
              e.stopPropagation()
              props.onPreviewScene(s.id)
            }}
          >
            <Icon icon={Play} size={13} />
          </button>
          <button
            className="scene-mini"
            title="Rename scene"
            onClick={(e) => {
              e.stopPropagation()
              setEditId(s.id)
            }}
          >
            <Icon icon={Pencil} size={13} />
          </button>
          <button
            className="scene-mini"
            title="Duplicate scene"
            onClick={(e) => {
              e.stopPropagation()
              duplicateScene(s.id)
            }}
          >
            <Icon icon={Copy} size={13} />
          </button>
          {project.scenes.length > 1 && (
            <button
              className="scene-mini"
              title="Delete scene"
              onClick={(e) => {
                e.stopPropagation()
                removeScene(s.id)
              }}
            >
              <Icon icon={X} size={13} />
            </button>
          )}
        </div>
      ))}
      {hiddenCount() > 0 && (
        <button className="scenes-showall" onClick={() => showAllScenes()} title="Show all scenes on the canvas">
          <Icon icon={Eye} size={13} /> Show all ({hiddenCount()})
        </button>
      )}
      <span className="scenes-add">
        <button onClick={() => addScene('game')} title="Add a game scene (advances on win)">
          + Game
        </button>
        <button onClick={() => addScene('win')} title="Add a win scene (dim + congrats)">
          + Win
        </button>
        <button onClick={() => addScene('endscene')} title="Add an endscene (manual / loops)">
          + End
        </button>
        <button onClick={() => addScene('custom')}>+ Blank</button>
      </span>
    </div>
  )
}
