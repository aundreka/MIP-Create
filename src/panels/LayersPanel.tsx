// Layers — draggable to reorder (top of list = front). Drag a row onto another
// to restack; the drop rewrites z-order. Click selects (Shift to multi-select).
// Grouped elements (shared groupId) collapse under a folder header.

import { useState } from 'react'
import { patchElement, removeElement, reorderLayers, selectOnly, selectWithGroups, setSelection, toggleSelect, useEditorState } from '../store'
import type { SceneElement } from '../../runtime/scene'
import { buildLayerTree } from '../layersTree'
import { getGroupCollapsed, setGroupCollapsed } from '../uiState'
import { ChevronRight, Eye, EyeOff, Folder, FolderOpen, GripVertical, Icon, LAYER_TYPE_ICON, LayoutGrid, X } from '../icons'

export function LayersPanel(): JSX.Element {
  const { scene, selectedIds } = useEditorState()
  const ordered = [...scene.elements].sort((a, b) => b.zIndex - a.zIndex) // front first
  const tree = buildLayerTree(ordered)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [, force] = useState(0)

  const drop = (targetId: string): void => {
    if (!dragId || dragId === targetId) return
    const ids = ordered.map((e) => e.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    reorderLayers(ids)
  }

  const row = (el: SceneElement, child: boolean): JSX.Element => (
    <div
      key={el.id}
      className={
        'layer-row' +
        (selectedIds.includes(el.id) ? ' sel' : '') +
        (overId === el.id ? ' over' : '') +
        (el.hidden ? ' is-hidden' : '') +
        (child ? ' child' : '')
      }
      draggable
      onDragStart={() => setDragId(el.id)}
      onDragOver={(e) => {
        e.preventDefault()
        setOverId(el.id)
      }}
      onDragLeave={() => setOverId((p) => (p === el.id ? null : p))}
      onDrop={(e) => {
        e.preventDefault()
        drop(el.id)
        setDragId(null)
        setOverId(null)
      }}
      onDragEnd={() => {
        setDragId(null)
        setOverId(null)
      }}
      onClick={(e) => (e.shiftKey ? toggleSelect(el.id) : selectOnly(el.id))}
    >
      <span className="layer-grip">
        <Icon icon={GripVertical} size={14} />
      </span>
      <span className="layer-icon">
        <Icon icon={LAYER_TYPE_ICON[el.type] ?? LayoutGrid} size={14} />
      </span>
      <span className="layer-name">{el.name || el.id}</span>
      <button
        className="layer-btn"
        title={el.hidden ? 'Show' : 'Hide'}
        onClick={(e) => {
          e.stopPropagation()
          patchElement(el.id, { hidden: !el.hidden })
        }}
      >
        <Icon icon={el.hidden ? EyeOff : Eye} size={14} />
      </button>
      <button
        className="layer-btn"
        title="Delete"
        onClick={(e) => {
          e.stopPropagation()
          removeElement(el.id)
        }}
      >
        <Icon icon={X} size={14} />
      </button>
    </div>
  )

  return (
    <div className="panel layers">
      <div className="panel-title">Layers</div>
      <div className="layer-list">
        {tree.map((node) => {
          if (node.kind === 'leaf') return row(node.el, false)
          const collapsed = getGroupCollapsed(node.groupId)
          const groupSel = node.children.every((c) => selectedIds.includes(c.id))
          return (
            <div key={node.groupId} className="layer-group">
              <div
                className={'layer-row group-head' + (groupSel ? ' sel' : '')}
                onClick={(e) => (e.shiftKey ? setSelection([...new Set([...selectedIds, ...node.children.map((c) => c.id)])]) : selectWithGroups(node.children[0].id, false))}
              >
                <button
                  className="layer-collapse"
                  title={collapsed ? 'Expand group' : 'Collapse group'}
                  onClick={(e) => {
                    e.stopPropagation()
                    setGroupCollapsed(node.groupId, !collapsed)
                    force((n) => n + 1)
                  }}
                >
                  <Icon icon={ChevronRight} size={13} className={'acc-chevron' + (collapsed ? '' : ' open-rot')} />
                </button>
                <span className="layer-icon">
                  <Icon icon={collapsed ? Folder : FolderOpen} size={14} />
                </span>
                <span className="layer-name">Group · {node.children.length}</span>
              </div>
              {!collapsed && node.children.map((c) => row(c, true))}
            </div>
          )
        })}
        {ordered.length === 0 && <div className="empty">No elements yet. Add one from the tool rail.</div>}
      </div>
    </div>
  )
}
