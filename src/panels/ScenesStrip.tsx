// Scenes strip — the project's ordered scenes. Click to edit; ★ sets the start
// scene; double-click the name to rename; drag to reorder. Everything else (preview,
// duplicate, language versions, hide/solo, delete) is in the row's ⋯ / right-click
// menu. One "Add scene" menu adds an overlay, an end card, or a game.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { addScene, addGameScene, duplicateScene, patchSceneDef, removeScene, reorderScenes, setActiveScene, setStartScene, useEditorState } from '../store'
import { Eye, EyeOff, Icon, LayoutGrid, MoreHorizontal, Plus, SCENE_KIND_ICON, Star } from '../icons'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { SceneThumb } from '../preview/SceneThumb'
import { confirmDestructive } from './AppDialogs'
import { hiddenCount, isSceneHidden, showAllScenes, soloScene, toggleSceneHidden, useCanvasView } from '../canvasView'
import { GAME_TEMPLATES } from '../../runtime/games/registry'
import type { SceneKind } from '../../runtime/scene'
import { SceneTranslationModal } from './SceneTranslationModal'

const MAX_THUMBS = 8

const KIND_LABELS: Record<string, string> = { game: 'Game', overlay: 'Overlay', endscene: 'End', win: 'Overlay', custom: 'Overlay' }
const SCENE_KINDS: SceneKind[] = ['game', 'overlay', 'endscene']

interface PickerPos {
  x: number
  y: number
  up: boolean
  maxH: number
}
interface KindPickerPos {
  x: number
  y: number
  id: string
}

export function ScenesStrip(props: { onPreviewScene: (id: string) => void; vertical?: boolean }): JSX.Element {
  const { project, assets, activeSceneId } = useEditorState()
  useCanvasView()
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; pos: 'before' | 'after' } | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [gamePicker, setGamePicker] = useState<PickerPos | null>(null)
  const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number; alignRight: boolean } | null>(null)
  const [gameQuery, setGameQuery] = useState('')
  const [kindPicker, setKindPicker] = useState<KindPickerPos | null>(null)
  const [translationSceneId, setTranslationSceneId] = useState<string | null>(null)
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
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setGamePicker(null)
      setKindPicker(null)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onKey)
    }
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
    // Drop down when there is room, otherwise open upward — never past the window edge.
    const below = window.innerHeight - r.bottom - 12
    const up = below < 280 && r.top > below
    setGamePicker(up ? { x: r.left, y: r.top - 6, up, maxH: r.top - 18 } : { x: r.left, y: r.bottom + 6, up, maxH: below })
    setGameQuery('')
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
      {project.scenes.map((s) => (
        <div
          key={s.id}
          className={
            'scene-chip' +
            (s.id === activeSceneId ? ' active' : '') +
            (isSceneHidden(s.id) ? ' canvas-hidden' : '') +
            (over?.id === s.id ? (over.pos === 'before' ? ' drop-before' : ' drop-after') : '')
          }
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
          onContextMenu={(e) => {
            e.preventDefault()
            setRowMenu({ id: s.id, x: e.clientX, y: e.clientY, alignRight: false })
          }}
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
          {isSceneHidden(s.id) && (
            <button
              className="scene-hidden-flag"
              title="Hidden from the canvas. Click to show"
              onClick={(e) => {
                e.stopPropagation()
                toggleSceneHidden(s.id)
              }}
            >
              <Icon icon={EyeOff} size={13} />
            </button>
          )}
          <button className={`scene-kind-badge kind-${s.kind ?? 'overlay'}`} title="Change scene type" onClick={(e) => openKindPicker(e, s.id)}>
            {KIND_LABELS[s.kind ?? 'overlay']}
            {/* An overlay doubling as the MRAID end card reads as both in the strip. */}
            {s.kind === 'overlay' && s.asEndscene ? ' · End' : ''}
          </button>
          <button
            className="scene-more"
            title="Scene actions"
            aria-label="Scene actions"
            onClick={(e) => {
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              setRowMenu({ id: s.id, x: r.right, y: r.bottom + 4, alignRight: true })
            }}
          >
            <Icon icon={MoreHorizontal} size={14} />
          </button>
        </div>
      ))}
      {hiddenCount() > 0 && (
        <button className="scenes-showall" onClick={() => showAllScenes()} title="Show all scenes on the canvas">
          <Icon icon={Eye} size={13} /> Show all ({hiddenCount()})
        </button>
      )}
      <button className="scenes-add-btn" onClick={openGamePicker} title="Add a scene">
        <Icon icon={Plus} size={13} /> Add scene
      </button>
      {rowMenu &&
        (() => {
          const sc = project.scenes.find((x) => x.id === rowMenu.id)
          if (!sc) return null
          const langs = Object.keys(sc.localeOverrides ?? {})
          const hidden = isSceneHidden(sc.id)
          const items: MenuItem[] = [
            { label: 'Preview this scene', onClick: () => props.onPreviewScene(sc.id) },
            { label: 'Rename', onClick: () => setEditId(sc.id) },
            { label: 'Duplicate', onClick: () => duplicateScene(sc.id) },
            {
              label: langs.length ? `Language versions (${langs.join(', ')})...` : 'Language versions...',
              onClick: () => {
                setActiveScene(sc.id)
                setTranslationSceneId(sc.id)
              },
            },
            { sep: true, label: '' },
            { label: hidden ? 'Show on canvas' : 'Hide from canvas', onClick: () => toggleSceneHidden(sc.id) },
            {
              label: 'Show only this scene',
              onClick: () => {
                soloScene(sc.id, allIds)
                setActiveScene(sc.id)
              },
            },
            { sep: true, label: '' },
            {
              label: 'Delete scene',
              disabled: project.scenes.length <= 1,
              onClick: () => {
                void (async () => {
                  if (
                    sc.elements.length &&
                    !(await confirmDestructive(`Delete scene "${sc.name}" and its ${sc.elements.length} element${sc.elements.length === 1 ? '' : 's'}? (Ctrl+Z to undo)`))
                  )
                    return
                  removeScene(sc.id)
                })()
              },
            },
          ]
          return <ContextMenu x={rowMenu.x} y={rowMenu.y} alignRight={rowMenu.alignRight} items={items} onClose={() => setRowMenu(null)} />
        })()}

      {translationSceneId && <SceneTranslationModal sceneId={translationSceneId} onClose={() => setTranslationSceneId(null)} />}

      {/* Game template picker popup */}
      {gamePicker &&
        createPortal(
          <div
            className="scene-picker"
            style={{ left: gamePicker.x, top: gamePicker.y, maxHeight: Math.min(gamePicker.maxH, 420), transform: gamePicker.up ? 'translateY(-100%)' : undefined }}
          >
            <button
              className="scene-picker-item"
              onClick={() => {
                addScene('overlay')
                setGamePicker(null)
              }}
            >
              Overlay (win / lose card)
            </button>
            <button
              className="scene-picker-item"
              onClick={() => {
                addScene('endscene')
                setGamePicker(null)
              }}
            >
              End card
            </button>
            <div className="scene-picker-header">Game</div>
            <input
              className="scene-picker-search"
              autoFocus
              placeholder="Search games"
              value={gameQuery}
              onChange={(e) => setGameQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setGamePicker(null)
              }}
            />
            {GAME_TEMPLATES.filter((t) => t.label.toLowerCase().includes(gameQuery.trim().toLowerCase())).map((t) => (
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
      {kindPicker &&
        createPortal(
          <div className="scene-picker" style={{ left: kindPicker.x, top: kindPicker.y }}>
            <div className="scene-picker-header">Change scene type</div>
            {SCENE_KINDS.map((k) => {
              const current = project.scenes.find((s) => s.id === kindPicker.id)?.kind ?? 'overlay'
              return (
                <button
                  key={k}
                  className={'scene-picker-item' + (k === current ? ' active' : '')}
                  onClick={() => {
                    // asEndscene / overlayBase are overlay-only — clear them when leaving that kind (see Inspector).
                    patchSceneDef(kindPicker.id, { kind: k, ...(k === 'overlay' ? {} : { asEndscene: undefined, overlayBase: undefined }) })
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
