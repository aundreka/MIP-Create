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
import { useEditLocale } from '../locale'
import { localeEntry } from '../../runtime/i18n'
import type { AnimPresetId, AnimSpec } from '../../runtime/scene'

const HEADER_ENTRANCE_PRESETS: { value: AnimPresetId; label: string }[] = [
  { value: 'fade', label: 'Fade' },
  { value: 'pop', label: 'Pop' },
  { value: 'slide-down', label: 'Slide down' },
  { value: 'slide-up', label: 'Slide up' },
  { value: 'slide-left', label: 'Slide left' },
  { value: 'slide-right', label: 'Slide right' },
  { value: 'wipe-right', label: 'Wipe right' },
  { value: 'wipe-left', label: 'Wipe left' },
  { value: 'wipe-up', label: 'Wipe up' },
]

const HEADER_LOOP_PRESETS: { value: AnimPresetId; label: string }[] = [
  { value: 'pulse', label: 'Pulse' },
  { value: 'float', label: 'Float' },
  { value: 'subtle-float', label: 'Subtle float' },
  { value: 'wave', label: 'Wave' },
  { value: 'shake', label: 'Shake' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'glow', label: 'Glow' },
  { value: 'shine', label: 'Shine' },
]

const DEFAULT_HEADER_ENTRANCE: AnimSpec = { preset: 'fade', durationMs: 520, delayMs: 0, easing: 'ease-out' }
const DEFAULT_HEADER_LOOP: AnimSpec = { preset: 'pulse', durationMs: 1200, delayMs: 0, easing: 'ease-in-out', iterations: 'infinite' }

export function HeaderPopover(props: { anchor: DOMRect; onClose: () => void }): JSX.Element {
  const { project, assets } = useEditorState()
  const editLocale = useEditLocale()
  const localizedHeader = localeEntry(project.meta.headerI18n, editLocale)
  const h = editLocale ? localizedHeader ?? project.meta.header : project.meta.header
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

  // Merge into the active language's complete header, or the default header.
  const set = (patch: Record<string, unknown>): void => {
    if (!editLocale) { patchMeta({ header: { ...h, ...patch } }); return }
    patchMeta({
      headerI18n: {
        ...(project.meta.headerI18n ?? {}),
        [editLocale]: { ...(project.meta.header ?? {}), ...(localizedHeader ?? {}), ...patch },
      },
    })
  }
  const toggleHeader = (on: boolean): void => {
    if (!editLocale) { patchMeta({ header: on ? (h ?? {}) : undefined }); return }
    const headers = { ...(project.meta.headerI18n ?? {}) }
    if (on) headers[editLocale] = { ...(project.meta.header ?? {}), ...(localizedHeader ?? {}) }
    else delete headers[editLocale]
    patchMeta({ headerI18n: Object.keys(headers).length ? headers : undefined })
  }
  const setEntrance = (patch: Partial<AnimSpec>): void => set({ entrance: { ...(h?.entrance ?? DEFAULT_HEADER_ENTRANCE), ...patch } })
  const setLoop = (patch: Partial<AnimSpec>): void => set({ loop: { ...(h?.loop ?? DEFAULT_HEADER_LOOP), ...patch } })

  return createPortal(
    <div ref={ref} className="header-pop" style={{ top: pos.top, right: pos.right }} role="dialog" aria-label="Header">
      <div className="header-pop-head">
        <strong>Header{editLocale ? ` · ${editLocale}` : ''}</strong>
        <button className="icon" onClick={props.onClose} title="Close (Esc)" aria-label="Close">
          <Icon icon={X} size={15} />
        </button>
      </div>
      <div className="header-pop-body">
        <Toggle
          label={editLocale ? `Custom ${editLocale} header` : 'Show header'}
          checked={editLocale ? !!localizedHeader : !!h}
          onChange={toggleHeader}
        />
        {editLocale && !localizedHeader && project.meta.header && (
          <div className="hint pad">Using the default header. Turn on the custom header above to translate its prefix, suffix, date language, or styling.</div>
        )}
        {h && (!editLocale || !!localizedHeader) && (
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
              <>
                <Row label="Counts to">
                  <Select
                    value={h.countdownTarget ?? 'duration'}
                    options={[
                      { value: 'duration', label: 'A fixed duration' },
                      { value: 'midnight', label: 'Tonight at 12am' },
                    ]}
                    onChange={(v) => set({ countdownTarget: v === 'duration' ? undefined : v })}
                  />
                </Row>
                <div className="grid2">
                  {/* Duration is meaningless when the deadline is midnight — the time
                      left comes from the viewer's own clock. */}
                  {h.countdownTarget !== 'midnight' && (
                    <NumField
                      label="Duration"
                      value={h.countdownSeconds ?? 300}
                      min={1}
                      suffix="s"
                      onChange={(n) => set({ countdownSeconds: n })}
                    />
                  )}
                  <Row label="Format">
                    <input
                      value={h.countdownFormat ?? ''}
                      placeholder={h.countdownTarget === 'midnight' ? '{hh}:{mm}:{ss}' : '{mm}:{ss}'}
                      onChange={(e) => set({ countdownFormat: e.target.value || undefined })}
                    />
                  </Row>
                </div>
              </>
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
            <Toggle label="Entrance animation" checked={!!h.entrance} onChange={(v) => set({ entrance: v ? DEFAULT_HEADER_ENTRANCE : undefined })} />
            {h.entrance && (
              <>
                <Row label="Entrance preset">
                  <Select value={h.entrance.preset} options={HEADER_ENTRANCE_PRESETS} onChange={(v) => setEntrance({ preset: v as AnimPresetId })} />
                </Row>
                <div className="grid2">
                  <NumField label="Duration" value={h.entrance.durationMs} min={0} step={50} suffix="ms" onChange={(n) => setEntrance({ durationMs: n })} />
                  <NumField label="Delay" value={h.entrance.delayMs} min={0} step={50} suffix="ms" onChange={(n) => setEntrance({ delayMs: n })} />
                </div>
              </>
            )}
            <Toggle
              label="Pulse with the CTA button"
              checked={!!h.loopFollowsCta}
              onChange={(v) => set({ loopFollowsCta: v || undefined })}
            />
            {h.loopFollowsCta && (
              <div className="hint pad">
                The date copies the CTA’s pulse — same shape, same speed — and restarts with it on every scene, so the two beat together. Scenes without a CTA use the loop below
                (or stay still if there isn’t one).
              </div>
            )}
            <Toggle label={h.loopFollowsCta ? 'Loop animation (no-CTA scenes)' : 'Loop animation'} checked={!!h.loop} onChange={(v) => set({ loop: v ? DEFAULT_HEADER_LOOP : undefined })} />
            {h.loop && (
              <>
                <Row label="Loop preset">
                  <Select value={h.loop.preset} options={HEADER_LOOP_PRESETS} onChange={(v) => setLoop({ preset: v as AnimPresetId })} />
                </Row>
                <div className="grid2">
                  <NumField label="Duration" value={h.loop.durationMs} min={0} step={50} suffix="ms" onChange={(n) => setLoop({ durationMs: n })} />
                  <NumField label="Delay" value={h.loop.delayMs} min={0} step={50} suffix="ms" onChange={(n) => setLoop({ delayMs: n })} />
                </div>
              </>
            )}
            <div className="hint pad">
              {h.mode === 'countdown'
                ? h.countdownTarget === 'midnight'
                  ? 'Counts down to the viewer’s next midnight — at 5pm it shows about 7 hours left. It freezes when the first scene carrying this header is won. Format tokens: {hh} {mm} {ss} (padded), {ms} (hundredths, 00–99), or {h} {m} {s}.'
                  : 'Starts on the viewer’s first interaction and freezes when the first scene carrying this header is won. Use {ss}:{ms} for 06:99 (6.99 seconds). Other tokens: {hh} {mm} {ss} (padded) or {h} {m} {s}.'
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
