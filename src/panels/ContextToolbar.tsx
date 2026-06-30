// Context toolbar — selection-aware quick actions above the canvas: align (×6),
// group/ungroup, and z-order. All reuse existing store actions; disabled when the
// action doesn't apply to the current selection.

import { alignSelected, bringToFront, groupSelected, sendToBack, ungroupSelected, useEditorState, type AlignOp } from '../store'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Folder,
  FolderOpen,
  Icon,
  type LucideIcon,
} from '../icons'

const ALIGN: { op: AlignOp; icon: LucideIcon; title: string }[] = [
  { op: 'left', icon: AlignStartVertical, title: 'Align left' },
  { op: 'centerH', icon: AlignCenterVertical, title: 'Center horizontally' },
  { op: 'right', icon: AlignEndVertical, title: 'Align right' },
  { op: 'top', icon: AlignStartHorizontal, title: 'Align top' },
  { op: 'middleV', icon: AlignCenterHorizontal, title: 'Center vertically' },
  { op: 'bottom', icon: AlignEndHorizontal, title: 'Align bottom' },
]

export function ContextToolbar(): JSX.Element {
  const { scene, selectedIds } = useEditorState()
  const has = selectedIds.length > 0
  const multi = selectedIds.length > 1
  const hasGroup = scene.elements.some((e) => selectedIds.includes(e.id) && e.groupId)
  return (
    <div className="context-toolbar">
      {ALIGN.map((b) => (
        <button key={b.op} className="ct-btn" title={b.title} disabled={!has} onClick={() => alignSelected(b.op)}>
          <Icon icon={b.icon} size={15} />
        </button>
      ))}
      <span className="ct-sep" />
      <button className="ct-btn" title="Group (Ctrl+G)" disabled={!multi} onClick={groupSelected}>
        <Icon icon={Folder} size={15} />
      </button>
      <button className="ct-btn" title="Ungroup (Ctrl+Shift+G)" disabled={!hasGroup} onClick={ungroupSelected}>
        <Icon icon={FolderOpen} size={15} />
      </button>
      <span className="ct-sep" />
      <button className="ct-btn" title="Bring to front" disabled={!has} onClick={() => selectedIds.forEach(bringToFront)}>
        <Icon icon={ArrowUpToLine} size={15} />
      </button>
      <button className="ct-btn" title="Send to back" disabled={!has} onClick={() => selectedIds.forEach(sendToBack)}>
        <Icon icon={ArrowDownToLine} size={15} />
      </button>
      <span className="spacer" />
      <span className="ct-hint">{has ? `${selectedIds.length} selected` : 'Select an element to edit'}</span>
    </div>
  )
}
