// Layers — draggable to reorder (top of list = front). Drag a row onto another
// to restack; the drop rewrites z-order. Click selects (Shift to multi-select).
// Lock / hide show on hover and stay visible while on; right-click for the rest.
// Grouped elements (shared groupId) collapse under a folder header.

import { useEffect, useState } from 'react'
import { bringToFront, duplicateSelected, patchElement, removeElement, reorderLayers, sendToBack, selectOnly, selectWithGroups, setSelection, toggleLock, toggleSelect, useEditorState } from '../store'
import type { SceneElement } from '../../runtime/scene'
import { resolveMorphTarget } from '../../runtime/morph'
import { buildLayerTree } from '../layersTree'
import { getGroupCollapsed, pruneGroupCollapsed, setGroupCollapsed } from '../uiState'
import { ChevronRight, Eye, EyeOff, Folder, FolderOpen, Icon, LAYER_TYPE_ICON, LayoutGrid, Lock, LockOpen } from '../icons'
import { ContextMenu, type MenuItem } from './ContextMenu'

export function LayersPanel(): JSX.Element {
  const { project, scene, activeSceneId, selectedIds, orientation } = useEditorState()
  const ordered = [...scene.elements].sort((a, b) => b.zIndex - a.zIndex) // front first
  // Visibility as the CURRENT canvas orientation renders it (landscape override wins
  // in landscape) — so a landscape-only element isn't dimmed while editing landscape.
  const effHidden = (el: SceneElement): boolean => (orientation === 'landscape' ? !!(el.landscape?.hidden ?? el.hidden) : !!el.hidden)
  const tree = buildLayerTree(ordered)
  // Where a morphing element hands over to (see MorphConfig) — named, so the badge can
  // say which screens without opening the Inspector. A morph reaches every screen its
  // automatic match finds a counterpart on, so the tooltip lists what it resolves to
  // rather than one authored destination.
  const morphTarget = (el: SceneElement): string | null => {
    if (!el.morph) return null
    const lands = project.scenes
      .filter((s) => s.id !== activeSceneId)
      .map((s) => ({ s, t: resolveMorphTarget(el, s) }))
      .filter((x) => x.t)
      .map((x) => `“${x.t!.name || x.t!.id}” on “${x.s.name || x.s.id}”`)
    return lands.length ? lands.join(', ') : 'nothing on any other screen yet'
  }
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; pos: 'before' | 'after' } | null>(null)
  const [, force] = useState(0)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const menuEl = menu ? scene.elements.find((e) => e.id === menu.id) : undefined
  const menuItems: MenuItem[] = menuEl
    ? [
        { label: 'Duplicate', onClick: duplicateSelected },
        { label: 'Bring to front', onClick: () => bringToFront(menuEl.id) },
        { label: 'Send to back', onClick: () => sendToBack(menuEl.id) },
        { sep: true, label: '' },
        { label: menuEl.locked ? 'Unlock' : 'Lock', onClick: () => toggleLock(menuEl.id) },
        { label: menuEl.hidden ? 'Show' : 'Hide', onClick: () => patchElement(menuEl.id, { hidden: !menuEl.hidden }) },
        { sep: true, label: '' },
        { label: 'Delete', onClick: () => removeElement(menuEl.id) },
      ]
    : []

  // drop stale group-collapse flags so a reused groupId can't inherit them
  const groupKey = tree
    .filter((n) => n.kind === 'group')
    .map((n) => (n as { groupId: string }).groupId)
    .join(',')
  useEffect(() => {
    pruneGroupCollapsed(new Set(groupKey ? groupKey.split(',') : []))
  }, [groupKey])

  // Insert the dragged row immediately before/after the target (deterministic,
  // matches the drop indicator) and rewrite z-order.
  const drop = (): void => {
    if (!dragId || !over || dragId === over.id) return
    const ids = ordered.map((e) => e.id).filter((id) => id !== dragId)
    let ti = ids.indexOf(over.id)
    if (ti < 0) return
    if (over.pos === 'after') ti += 1
    ids.splice(ti, 0, dragId)
    reorderLayers(ids)
  }

  const row = (el: SceneElement, child: boolean): JSX.Element => (
    <div
      key={el.id}
      className={
        'layer-row' +
        (selectedIds.includes(el.id) ? ' sel' : '') +
        (over?.id === el.id ? (over.pos === 'before' ? ' drop-before' : ' drop-after') : '') +
        (effHidden(el) ? ' is-hidden' : '') +
        (el.locked ? ' locked' : '') +
        (child ? ' child' : '')
      }
      draggable={!el.locked}
      onDragStart={() => setDragId(el.id)}
      onDragOver={(e) => {
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        setOver({ id: el.id, pos: e.clientY < r.top + r.height / 2 ? 'before' : 'after' })
      }}
      onDragLeave={() => setOver((p) => (p?.id === el.id ? null : p))}
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
      onClick={(e) => (e.shiftKey ? toggleSelect(el.id) : selectOnly(el.id))}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!selectedIds.includes(el.id)) selectOnly(el.id)
        setMenu({ id: el.id, x: e.clientX, y: e.clientY })
      }}
    >
      <span className="layer-icon">
        <Icon icon={LAYER_TYPE_ICON[el.type] ?? LayoutGrid} size={14} />
      </span>
      <span className="layer-name">{el.name || el.id}</span>
      {/* Orientation-limited elements (Inspector "Show in"): P = portrait only, L = landscape only. */}
      {!el.hidden && el.landscape?.hidden === true && (
        <span className="layer-orient" title="Shows in portrait only (hidden in landscape)">
          P
        </span>
      )}
      {el.hidden && el.landscape?.hidden === false && (
        <span className="layer-orient" title="Shows in landscape only (hidden in portrait)">
          L
        </span>
      )}
      {/* Morphs into an element on another screen — the screen change flies it there. */}
      {!!el.morph && (
        <span className="layer-orient layer-morph" title={`Turns into ${morphTarget(el)} on the way there`}>
          ⤳
        </span>
      )}
      <button
        className={'layer-btn' + (el.locked ? ' on' : '')}
        title={el.locked ? 'Unlock' : 'Lock'}
        onClick={(e) => {
          e.stopPropagation()
          toggleLock(el.id)
        }}
      >
        <Icon icon={el.locked ? Lock : LockOpen} size={14} />
      </button>
      <button
        className={'layer-btn' + (effHidden(el) ? ' on' : '')}
        title={el.hidden ? 'Show' : 'Hide'}
        onClick={(e) => {
          e.stopPropagation()
          patchElement(el.id, { hidden: !el.hidden })
        }}
      >
        <Icon icon={effHidden(el) ? EyeOff : Eye} size={14} />
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
      {menu && menuEl && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  )
}
