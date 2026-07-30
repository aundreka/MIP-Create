// Scenes strip — the project's ordered scenes as tabs. Click to edit; ★ sets the
// start scene; double-click the name to rename; ▶ previews just that scene; drag
// to reorder; duplicate/delete; add Game/Win/Endscene/Blank.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { addScene, addGameScene, duplicateScene, patchSceneDef, removeScene, reorderScenes, setActiveScene, setStartScene, useEditorState } from '../store'
import { Copy, Eye, EyeOff, Icon, LayoutGrid, Pencil, Play, SCENE_KIND_ICON, Star, X } from '../icons'
import { SceneThumb } from '../preview/SceneThumb'
import { confirmDestructive } from '../ui'
import { hiddenCount, isSceneHidden, showAllScenes, soloScene, toggleSceneHidden, useCanvasView } from '../canvasView'
import { GAME_TEMPLATES } from '../../runtime/games/registry'
import type { SceneKind } from '../../runtime/scene'

const MAX_THUMBS = 8

const KIND_LABELS: Record<string, string> = { game: 'Game', overlay: 'Overlay', endscene: 'End', win: 'Overlay', custom: 'Overlay' }
const SCENE_KINDS: SceneKind[] = ['game', 'overlay', 'endscene']

interface PickerPos { x: number; y: number }
interface KindPickerPos { x: number; y: number; id: string }

export function ScenesStrip(props: { onPreviewScene: (id: string) => void; vertical?: boolean }): JSX.Element {
  const { project, assets, activeSceneId } = useEditorState()
  useCanvasView()
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; pos: 'before' | 'after' } | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [gamePicker, setGamePicker] = useState<PickerPos | null>(null)
  const [kindPicker, setKindPicker] = useState<KindPickerPos | null>(null)
  const showThumbs = project.scenes.length <= MAX_THUMBS
  const allIds = project.scenes.map((s) => s.id)
  const anyPickerOpen = gamePicker !== null || kindPicker !== null

  // Close pickers on outside click
  useEffect(() => {
    if (!anyPickerOpen) return
    const close = (e: PointerEvent): void => {
      const pickers = document.querySelectorAll('.scene-picker, .scene-picker-overlay')
      for (const p of pickers) {
        if (p.contains(e.target as Node)) return
      }
      setGamePicker(null)
      setKindPicker(null)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [anyPickerOpen])

  const drop = (): void => {
    if (!dragId || !over || dragId === over.id) return
    const ids = project.scenes.map((s) => s.id).filter((id) => id !== dragId)
    let ti = ids.indexOf(over.id)
    if (ti < 0) return
    if (over.pos === 'after') ti += 1
    ids.splice(ti, 0, dragId)
    reorderScenes(ids)
  }

  const openGamePicker = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setGamePicker({ x: r.left, y: r.top })
    setKindPicker(null)
  }

  const openKindPicker = (e: React.MouseEvent<HTMLButtonElement>, id: string): void => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setKindPicker({ x: r.right + 4, y: r.top, id })
    setGamePicker(null)
  }

  return (
    <div className={'scenes-strip' + (props.vertical ? ' vertical' : '')}>
      <span className="scenes-label">Scenes</span>
      {project.scenes.map((s, i) => (
        <div
          key={s.id}
          className={'scene-chip' + (s.id === activeSceneId ? ' active' : '') + (isSceneHidden(s.id) ? ' canvas-hidden' : '') + (over?.id === s.id ? (over.pos === 'before' ? ' drop-before' : ' drop-after') : '')}
          draggable={editId !== s.id}
          onDragStart={() => setDragId(s.id)}
          onDragOver={(e) => {
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            const pos = props.vertical ? (e.clientY < r.top + r.height / 2 ? 'before' : 'after') : e.clientX < r.left + r.width / 2 ? 'before' : 'after'
            setOver({ id: s.id, pos })
          }}
          onDragLeave={() => setOver((p) => (p?.id === s.id ? null : p))}
          onDrop={(e) => {
            e.preventDefault()
            drop()
            setDragId(null)
            setOver(null)
          }}
          onDragEnd={() => {
            setDragId(null)
            setOver(null)
          }}
          onClick={() => setActiveScene(s.id)}
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
            className={`scene-kind-badge kind-${s.kind ?? 'overlay'}`}
            title="Change scene type"
            onClick={(e) => openKindPicker(e, s.id)}
          >
            {KIND_LABELS[s.kind ?? 'overlay']}
            {/* An overlay doubling as the MRAID end card reads as both in the strip. */}
            {s.kind === 'overlay' && s.asEndscene ? ' · End' : ''}
          </button>
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
                if (s.elements.length && !confirmDestructive(`Delete scene "${s.name}" and its ${s.elements.length} element${s.elements.length === 1 ? '' : 's'}? (Ctrl+Z to undo)`)) return
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
        <button onClick={openGamePicker} title="Add a game scene: pick a mechanic">
          + Game ▾
        </button>
        <button onClick={() => addScene('overlay')} title="Add an overlay scene (win/lose result)">
          + Overlay
        </button>
        <button onClick={() => addScene('endscene')} title="Add an endscene (manual / loops)">
          + End
        </button>
      </span>

      {/* Game template picker popup */}
      {gamePicker && createPortal(
        <div
          className="scene-picker"
          style={{ left: gamePicker.x, top: gamePicker.y, transform: 'translateY(calc(-100% - 6px))' }}
        >
          <div className="scene-picker-header">Choose game type</div>
          {GAME_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="scene-picker-item"
              onClick={() => {
                addGameScene(t.id)
                setGamePicker(null)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>,
        document.body,
      )}

      {/* Kind picker popup */}
      {kindPicker && createPortal(
        <div
          className="scene-picker"
          style={{ left: kindPicker.x, top: kindPicker.y }}
        >
          <div className="scene-picker-header">Change scene type</div>
          {SCENE_KINDS.map((k) => {
            const current = project.scenes.find((s) => s.id === kindPicker.id)?.kind ?? 'overlay'
            return (
              <button
                key={k}
                className={'scene-picker-item' + (k === current ? ' active' : '')}
                onClick={() => {
                  // asEndscene is overlay-only — clear it when leaving that kind (see Inspector).
                  patchSceneDef(kindPicker.id, { kind: k, ...(k === 'overlay' ? {} : { asEndscene: undefined }) })
                  setKindPicker(null)
                }}
              >
                {KIND_LABELS[k]}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
