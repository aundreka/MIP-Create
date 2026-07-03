// Date-header popover — quick-access customization for the pinned date band,
// opened from the "Date header" button in the Topbar. Writes to meta.header
// (see runtime/header.ts); leaving it undefined hides the band entirely.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { patchMeta, useEditorState } from '../store'
import { ColorField, NumField, Row, Select, Toggle } from '../ui'
import { Icon, X } from '../icons'

export function HeaderPopover(props: { anchor: DOMRect; onClose: () => void }): JSX.Element {
  const { project } = useEditorState()
  const h = project.meta.header
  const ref = useRef<HTMLDivElement>(null)

  // Anchor the panel under the button, right-aligned so it stays on-screen.
  const [pos] = useState(() => ({
    top: props.anchor.bottom + 6,
    right: Math.max(8, window.innerWidth - props.anchor.right),
  }))

  const close = useRef(props.onClose)
  close.current = props.onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close.current() }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close.current()
    }
    window.addEventListener('keydown', onKey)
    // Defer so the opening click doesn't immediately close the panel.
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
    }
  }, [])

  // Merge a patch into meta.header (enabling the header if it was off).
  const set = (patch: Record<string, unknown>): void => patchMeta({ header: { ...h, ...patch } })

  return createPortal(
    <div ref={ref} className="header-pop" style={{ top: pos.top, right: pos.right }} role="dialog" aria-label="Date header">
      <div className="header-pop-head">
        <strong>Date header</strong>
        <button className="icon" onClick={props.onClose} title="Close (Esc)" aria-label="Close">
          <Icon icon={X} size={15} />
        </button>
      </div>
      <div className="header-pop-body">
        <Toggle
          label="Show date header"
          checked={!!h}
          onChange={(on) => patchMeta({ header: on ? (h ?? {}) : undefined })}
        />
        {h && (
          <>
            <Row label="Font">
              <input
                value={h.fontFamily ?? ''}
                placeholder="e.g. Poppins, Arial, sans-serif"
                onChange={(e) => set({ fontFamily: e.target.value || undefined })}
              />
            </Row>
            <div className="grid2">
              <NumField label="Font size" value={h.fontSizePx ?? 64} min={1} suffix="px" onChange={(n) => set({ fontSizePx: n })} />
              <NumField label="Weight" value={h.fontWeight ?? 500} min={100} max={900} step={100} onChange={(n) => set({ fontWeight: n })} />
            </div>
            <div className="grid2">
              <NumField label="Height" value={h.heightPx ?? 120} min={0} suffix="px" onChange={(n) => set({ heightPx: n })} />
              <NumField label="Top padding" value={h.topPaddingPx ?? 0} min={0} suffix="px" onChange={(n) => set({ topPaddingPx: n })} />
            </div>
            <div className="grid2">
              <Row label="Alignment">
                <Select
                  value={h.align ?? 'center'}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'center', label: 'Center' },
                    { value: 'right', label: 'Right' },
                  ]}
                  onChange={(v) => set({ align: v })}
                />
              </Row>
              <NumField label="Spacing" value={h.letterSpacingPx ?? 0} suffix="px" onChange={(n) => set({ letterSpacingPx: n })} />
            </div>
            <div className="grid2">
              <Row label="Prefix">
                <input value={h.prefix ?? ''} placeholder="e.g. “DAY ”" onChange={(e) => set({ prefix: e.target.value || undefined })} />
              </Row>
              <Row label="Suffix">
                <input value={h.suffix ?? ''} placeholder="e.g. “ !”" onChange={(e) => set({ suffix: e.target.value || undefined })} />
              </Row>
            </div>
            <div className="grid2">
              <ColorField label="Background" value={h.bgColor || ''} onChange={(c) => set({ bgColor: c ?? undefined })} allowNone />
              <ColorField label="Text colour" value={h.color || '#ffffff'} onChange={(c) => set({ color: c ?? '#ffffff' })} />
            </div>
            <div className="hint pad">Shows the current date at the top of the playable. Leave background as “none” for no band.</div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
