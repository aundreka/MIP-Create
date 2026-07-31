// Header popover — quick-access customization for the pinned top band (date or
// countdown), opened from the "Header" button in the Topbar. Writes to
// meta.header (see runtime/header.ts); leaving it undefined hides the band.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addAsset, patchMeta, useEditorState } from '../store'
import { ColorField, NumField, Row, Select, Toggle } from '../ui'
import { Icon, Upload, X } from '../icons'
import { importFont } from '../bridge'
import { DATE_LOCALE_OPTIONS } from '../dateLocales'

export function HeaderPopover(props: { anchor: DOMRect; onClose: () => void }): JSX.Element {
  const { project, assets } = useEditorState()
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
    <div ref={ref} className="header-pop" style={{ top: pos.top, right: pos.right }} role="dialog" aria-label="Header">
      <div className="header-pop-head">
        <strong>Header</strong>
        <button className="icon" onClick={props.onClose} title="Close (Esc)" aria-label="Close">
          <Icon icon={X} size={15} />
        </button>
      </div>
      <div className="header-pop-body">
        <Toggle
          label="Show header"
          checked={!!h}
          onChange={(on) => patchMeta({ header: on ? (h ?? {}) : undefined })}
        />
        {h && (
          <>
            <Row label="Content">
              <Select
                value={h.mode ?? 'date'}
                options={[
                  { value: 'date', label: 'Current date' },
                  { value: 'countdown', label: 'Countdown timer' },
                ]}
                onChange={(v) => set({ mode: v === 'date' ? undefined : v })}
              />
            </Row>
            {h.mode === 'countdown' ? (
              <div className="grid2">
                <NumField
                  label="Duration"
                  value={h.countdownSeconds ?? 300}
                  min={1}
                  suffix="s"
                  onChange={(n) => set({ countdownSeconds: n })}
                />
                <Row label="Format">
                  <input
                    value={h.countdownFormat ?? ''}
                    placeholder="{mm}:{ss}"
                    onChange={(e) => set({ countdownFormat: e.target.value || undefined })}
                  />
                </Row>
              </div>
            ) : (
              <>
                <Row label="Format">
                  <input
                    value={h.dateFormat ?? ''}
                    placeholder="e.g. {date} or MMMM D, YYYY"
                    onChange={(e) => set({ dateFormat: e.target.value || undefined })}
                  />
                </Row>
                <Row label="Date language">
                  <Select
                    value={h.dateLocale ?? 'en-US'}
                    onChange={(v) => set({ dateLocale: v === 'en-US' ? undefined : v })}
                    options={DATE_LOCALE_OPTIONS}
                  />
                </Row>
              </>
            )}
            <Row label="Text case">
              <Select
                value={h.textCase ?? 'none'}
                onChange={(v) => set({ textCase: v === 'none' ? undefined : (v as NonNullable<typeof h.textCase>) })}
                options={[
                  { value: 'none', label: 'As typed' },
                  { value: 'upper', label: 'UPPERCASE' },
                  { value: 'title', label: 'Capitalize Each Word' },
                  { value: 'lower', label: 'lowercase' },
                ]}
              />
            </Row>
            {(() => {
              // Same pattern as the Inspector's text-font picker: font assets are
              // base64 data URLs whose id doubles as the CSS font-family, embedded
              // in the export and registered via FontFace (no external calls).
              const fontAssets = Object.entries(assets).filter(([, a]) => a.kind === 'font')
              const uploadFont = async (): Promise<void> => {
                const f = await importFont()
                if (!f) return
                addAsset(f.id, { src: f.src, w: 0, h: 0, kind: 'font' })
                set({ fontFamily: f.id })
              }
              // A hand-typed CSS family from before the picker existed (e.g.
              // "Poppins, sans-serif") still shows and stays selectable.
              const custom = h.fontFamily && !assets[h.fontFamily] ? h.fontFamily : null
              return (
                <Row label="Font">
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Select
                      value={h.fontFamily ?? ''}
                      onChange={(v) => set({ fontFamily: v || undefined })}
                      options={[
                        { value: '', label: 'Default' },
                        ...fontAssets.map(([id]) => ({ value: id, label: id.replace(/_/g, ' ') })),
                        ...(custom ? [{ value: custom, label: `${custom} (system)` }] : []),
                      ]}
                    />
                    <button className="icon-btn" title="Upload font (.ttf .otf .woff .woff2)" onClick={() => { void uploadFont() }}>
                      <Icon icon={Upload} size={13} />
                    </button>
                  </div>
                </Row>
              )
            })()}
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
                <input
                  value={h.prefix ?? ''}
                  placeholder={h.mode === 'countdown' ? 'e.g. “Limited Time Only ”' : 'e.g. “DAY ”'}
                  onChange={(e) => set({ prefix: e.target.value || undefined })}
                />
              </Row>
              <Row label="Suffix">
                <input value={h.suffix ?? ''} placeholder="e.g. “ !”" onChange={(e) => set({ suffix: e.target.value || undefined })} />
              </Row>
            </div>
            <div className="grid2">
              <ColorField label="Background" value={h.bgColor || ''} onChange={(c) => set({ bgColor: c ?? undefined })} allowNone />
              <ColorField label="Text colour" value={h.color || '#ffffff'} onChange={(c) => set({ color: c ?? '#ffffff' })} />
            </div>
            <div className="hint pad">
              {h.mode === 'countdown'
                ? 'Counts down from the duration when the ad loads. Format tokens: {hh} {mm} {ss} (padded) or {h} {m} {s}.'
                : 'Shows the current date. Format tokens: {date}, MMMM (July), MMM (Jul), MM (07), M (7), DD (05), D (5), Do (5th), YYYY (2026), YY (26). Empty = localized full date, uppercased.'}{' '}
              Leave background as “none” for no band.
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
