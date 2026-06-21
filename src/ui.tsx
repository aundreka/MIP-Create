// Reusable inspector controls: drag-to-scrub number field, slider, toggle,
// color swatches (+ eyedropper), and preset chips.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addToPalette, loadPalette } from './brandkit'
import { Check, ChevronDown, ChevronRight, Icon, X } from './icons'
import { getAccordion, setAccordion } from './uiState'

// ---- NumField: label is draggable to scrub the value (Figma-style) ----------
export function NumField(props: {
  label: string
  value: number | undefined
  onChange: (n: number) => void
  step?: number
  min?: number
  max?: number
}): JSX.Element {
  const step = props.step ?? 1
  const start = useRef<{ x: number; v: number } | null>(null)
  const clamp = (v: number): number => {
    if (props.min != null) v = Math.max(props.min, v)
    if (props.max != null) v = Math.min(props.max, v)
    return v
  }
  return (
    <label className="field">
      <span
        className="scrub"
        onPointerDown={(e) => {
          start.current = { x: e.clientX, v: props.value ?? 0 }
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!start.current) return
          const dv = Math.round((e.clientX - start.current.x) / 2) * step
          props.onChange(clamp(+(start.current.v + dv).toFixed(3)))
        }}
        onPointerUp={() => (start.current = null)}
      >
        {props.label}
      </span>
      <input type="number" value={props.value ?? 0} step={step} onChange={(e) => props.onChange(clamp(Number(e.target.value)))} />
    </label>
  )
}

// ---- Slider ----------------------------------------------------------------
export function Slider(props: {
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  step?: number
  suffix?: string
}): JSX.Element {
  return (
    <label className="field">
      <span>
        {props.label} <em className="muted">{Math.round(props.value)}{props.suffix ?? ''}</em>
      </span>
      <input
        className="slider"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

// ---- Toggle ----------------------------------------------------------------
export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label className="field toggle-field">
      <span>{props.label}</span>
      <button className={'toggle' + (props.checked ? ' on' : '')} onClick={() => props.onChange(!props.checked)} type="button">
        <i />
      </button>
    </label>
  )
}

// ---- Swatches (palette + custom + eyedropper + clear) ----------------------
async function eyedrop(): Promise<string | null> {
  const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
  if (!ED) return null
  try {
    const r = await new ED().open()
    return r.sRGBHex
  } catch {
    return null
  }
}

export function Swatches(props: { label: string; value?: string; onChange: (c: string | undefined) => void; allowNone?: boolean }): JSX.Element {
  const [palette, setPalette] = useState<string[]>(() => loadPalette())
  const hasEyedropper = typeof (window as unknown as { EyeDropper?: unknown }).EyeDropper !== 'undefined'
  return (
    <div className="field">
      <span>{props.label}</span>
      <div className="swatches">
        {props.allowNone && (
          <button className={'swatch none' + (props.value ? '' : ' sel')} title="None" onClick={() => props.onChange(undefined)} />
        )}
        {palette.map((c) => (
          <button
            key={c}
            className={'swatch' + (props.value?.toLowerCase() === c.toLowerCase() ? ' sel' : '')}
            style={{ background: c }}
            title={c}
            onClick={() => props.onChange(c)}
          />
        ))}
        <label className="swatch custom" title="Custom color">
          +
          <input
            type="color"
            value={props.value ?? '#ffffff'}
            onChange={(e) => {
              props.onChange(e.target.value)
              setPalette(addToPalette(e.target.value))
            }}
          />
        </label>
        {hasEyedropper && (
          <button
            className="swatch eyedrop"
            title="Pick from screen"
            onClick={async () => {
              const c = await eyedrop()
              if (c) {
                props.onChange(c)
                setPalette(addToPalette(c))
              }
            }}
          >
            ⦿
          </button>
        )}
      </div>
    </div>
  )
}

// ---- Preset chips ----------------------------------------------------------
export function Chips(props: { items: { key: string; label: string; active?: boolean; onClick: () => void }[] }): JSX.Element {
  return (
    <div className="chips">
      {props.items.map((it) => (
        <button key={it.key} className={'chip' + (it.active ? ' on' : '')} onClick={it.onClick}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

// ---- Select (styled native <select>) ---------------------------------------
// Keeps a real <select> so keyboard semantics and the canvas keydown guard
// (which ignores events from SELECT elements) both keep working.
export function Select<T extends string>(props: {
  label?: string
  value: T
  onChange: (v: T) => void
  options: readonly { value: T; label: string; disabled?: boolean }[]
  className?: string
  title?: string
}): JSX.Element {
  const control = (
    <span className={'select-wrap' + (props.className ? ' ' + props.className : '')}>
      <select value={props.value} title={props.title} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon icon={ChevronDown} size={14} className="select-chevron" />
    </span>
  )
  if (!props.label) return control
  return (
    <label className="field">
      <span>{props.label}</span>
      {control}
    </label>
  )
}

// ---- ColorField (unifies color editing on Swatches: palette + eyedropper) ---
export function ColorField(props: { label: string; value?: string; onChange: (c: string | undefined) => void; allowNone?: boolean }): JSX.Element {
  return <Swatches label={props.label} value={props.value} onChange={props.onChange} allowNone={props.allowNone} />
}

// ---- Checkbox (themed) -----------------------------------------------------
export function Checkbox(props: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; title?: string }): JSX.Element {
  return (
    <label className="checkbox" title={props.title}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="checkbox-box">
        <Icon icon={Check} size={12} strokeWidth={3} />
      </span>
      <span className="checkbox-label">{props.label}</span>
    </label>
  )
}

// ---- Tooltip (CSS-only, keyboard-friendly via focus-within) -----------------
export function Tooltip(props: { label: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: React.ReactNode }): JSX.Element {
  return (
    <span className={'tip tip-' + (props.side ?? 'top')} data-tip={props.label}>
      {props.children}
    </span>
  )
}

// ---- Accordion (collapsible inspector section, persisted open state) --------
export function Accordion(props: { id: string; title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }): JSX.Element {
  const [open, setOpen] = useState(() => getAccordion(props.id, props.defaultOpen ?? true))
  const toggle = (): void => {
    const v = !open
    setOpen(v)
    setAccordion(props.id, v)
  }
  return (
    <div className={'acc' + (open ? ' open' : '')}>
      <button className="acc-head" onClick={toggle} aria-expanded={open}>
        <Icon icon={ChevronRight} size={14} className="acc-chevron" />
        <span>{props.title}</span>
      </button>
      {open && <div className="acc-body">{props.children}</div>}
    </div>
  )
}

// ---- Modal (shared dialog shell: backdrop, Esc, focus, header, animation) ----
export function Modal(props: {
  title: React.ReactNode
  onClose: () => void
  size?: 'sm' | 'md' | 'lg' | 'preview' | 'full'
  headerExtra?: React.ReactNode
  className?: string
  children: React.ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)')?.focus()
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Portal to <body> so the overlay isn't trapped by an ancestor's containing
  // block (modals/popovers use backdrop-filter, which captures position:fixed).
  return createPortal(
    <div className="modal-overlay" onClick={props.onClose}>
      <div
        ref={ref}
        className={'modal modal-' + (props.size ?? 'md') + (props.className ? ' ' + props.className : '')}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-bar">
          <strong className="modal-title">{props.title}</strong>
          {props.headerExtra}
          <span className="spacer" />
          <button className="icon modal-close" onClick={props.onClose} title="Close (Esc)">
            <Icon icon={X} size={16} />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
      </div>
    </div>,
    document.body,
  )
}
