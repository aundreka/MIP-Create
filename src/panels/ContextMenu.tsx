import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  /** Keyboard shortcut, shown right-aligned (e.g. 'Ctrl+D'). */
  hint?: string
  onClick?: () => void
  disabled?: boolean
  sep?: boolean
}

// alignRight: x is the menu's right edge (for menus dropped from a right-side button).
export function ContextMenu(props: { x: number; y: number; alignRight?: boolean; items: MenuItem[]; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // onClose via a ref so the listeners are registered once. Re-registering on every
  // render dropped Escape: the canvas's own Escape handler clears the selection,
  // which re-renders the opener synchronously mid-dispatch, and a listener re-added
  // during dispatch never sees the event that is already in flight.
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose
  useEffect(() => {
    // Dismiss on any interaction outside the menu. We listen in the capture phase so
    // a click elsewhere closes promptly — but must exempt clicks *inside* the menu,
    // otherwise it unmounts before an item's onClick can fire (stopPropagation can't
    // beat a capture-phase listener, which runs before React's bubble handlers).
    const onPointer = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onCloseRef.current()
    }
    const close = (): void => onCloseRef.current()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Portal to <body> so the menu escapes the stacking context of whatever opened it
  // (e.g. the topbar at z-index:10, which would otherwise trap it under the tool rail
  // at z-index:20). It's position:fixed with explicit coords, so placement is unchanged.
  return createPortal(
    <div ref={ref} className="ctx-menu" style={props.alignRight ? { right: window.innerWidth - props.x, top: props.y } : { left: props.x, top: props.y }}>
      {props.items.map((it, i) =>
        it.sep ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className="ctx-item"
            disabled={it.disabled}
            onClick={() => {
              it.onClick?.()
              props.onClose()
            }}
          >
            <span>{it.label}</span>
            {it.hint && <kbd className="ctx-hint">{it.hint}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
