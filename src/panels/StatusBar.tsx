// Bottom status bar — zoom, scene count, current selection (+ size), and save state.
import { useEditorState } from '../store'

export function StatusBar(props: { zoom: number }): JSX.Element {
  const { project, scene, selectedIds, dirty } = useEditorState()
  const one = selectedIds.length === 1 ? scene.elements.find((e) => e.id === selectedIds[0]) : null
  const size = one && one.w != null && one.h != null ? `${Math.round(one.w)}×${Math.round(one.h)}` : null
  const n = project.scenes.length
  return (
    <div className="statusbar">
      <span>{Math.round(props.zoom * 100)}%</span>
      <span className="sb-dot">·</span>
      <span>{n} scene{n === 1 ? '' : 's'}</span>
      {selectedIds.length > 0 && (
        <>
          <span className="sb-dot">·</span>
          <span>
            {selectedIds.length === 1 ? one?.name || '1 selected' : `${selectedIds.length} selected`}
            {size ? ` · ${size}` : ''}
          </span>
        </>
      )}
      <span className="spacer" />
      <span className={dirty ? 'sb-dirty' : 'sb-saved'}>{dirty ? '● Unsaved' : 'Saved'}</span>
    </div>
  )
}
