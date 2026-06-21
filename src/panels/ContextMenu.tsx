import { useEffect } from 'react'

export interface MenuItem {
  label: string
  onClick?: () => void
  disabled?: boolean
  sep?: boolean
}

export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }): JSX.Element {
  useEffect(() => {
    const close = (): void => props.onClose()
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [props])

  return (
    <div className="ctx-menu" style={{ left: props.x, top: props.y }} onPointerDown={(e) => e.stopPropagation()}>
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
    </div>
  )
}
