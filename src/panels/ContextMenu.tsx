import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  onClick?: () => void
  disabled?: boolean
  sep?: boolean
}

export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Dismiss on any interaction outside the menu. We listen in the capture phase so
    // a click elsewhere closes promptly — but must exempt clicks *inside* the menu,
    // otherwise it unmounts before an item's onClick can fire (stopPropagation can't
    // beat a capture-phase listener, which runs before React's bubble handlers).
    const onPointer = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      props.onClose()
    }
    const close = (): void => props.onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
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
  }, [props])

  // Portal to <body> so the menu escapes the stacking context of whatever opened it
  // (e.g. the topbar at z-index:10, which would otherwise trap it under the tool rail
  // at z-index:20). It's position:fixed with explicit coords, so placement is unchanged.
  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: props.x, top: props.y }}>
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
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
