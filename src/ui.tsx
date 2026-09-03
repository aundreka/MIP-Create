// Reusable inspector controls: drag-to-scrub number field, slider, toggle,
// color swatches (+ eyedropper), and preset chips.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addToPalette, loadPalette } from './brandkit'
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Icon, X } from './icons'
import type { SortState } from './sort'
import { getAccordion, getDock, setAccordion, setDock } from './uiState'

// ---- confirmDestructive: gate an unrecoverable action behind a confirm -------
// Used before project-replacing loads (loadProject clears undo history) and other
// destructive actions. Centralized so we can later swap to a styled dialog.
export function confirmDestructive(message: string): boolean {
  return typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(message) : true
}

export function SortButton<K extends string>(props: {
  field: K
  sort: SortState<K>
  onSort: (field: K) => void
  children: React.ReactNode
  className?: string
}): JSX.Element {
  const active = props.sort.key === props.field
  const nextDir = active && props.sort.dir === 'asc' ? 'descending' : 'ascending'
  return (
    <button
      className={'sort-head' + (active ? ' on' : '') + (props.className ? ' ' + props.className : '')}
      type="button"
      aria-sort={active ? (props.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={`Sort ${String(props.children)} ${nextDir}`}
      onClick={() => props.onSort(props.field)}
    >
      <span>{props.children}</span>
      {active && <Icon icon={props.sort.dir === 'asc' ? ArrowUp : ArrowDown} size={12} strokeWidth={2.2} />}
    </button>
  )
}

// ---- NumField: label is draggable to scrub the value (Figma-style) ----------
export function NumField(props: {
  label: string
  value: number | undefined
  onChange: (n: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
}): JSX.Element {
  const step = props.step ?? 1
  const start = useRef<{ x: number; v: number } | null>(null)
  // Local buffer lets the field hold a transient empty/partial value while typing
  // (e.g. clearing "120" to type "85") without snapping to 0 on every keystroke.
  const [buf, setBuf] = useState<string | null>(null)
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
      <div className={'num-input' + (props.suffix ? ' has-unit' : '')}>
        <input
          type="number"
          value={buf ?? String(props.value ?? 0)}
          step={step}
          onChange={(e) => {
            setBuf(e.target.value)
            const n = Number(e.target.value)
            if (e.target.value.trim() !== '' && Number.isFinite(n)) props.onChange(clamp(n))
          }}
          onBlur={() => setBuf(null)}
        />
        {props.suffix && <i className="num-unit">{props.suffix}</i>}
      </div>
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
  // Show the value at the step's precision — a fractional step (e.g. 0.05 for zoom)
  // must NOT be rounded to an integer, or 1.2 would misleadingly read as "1".
  const dec = props.step && props.step < 1 ? String(props.step).split('.')[1]?.length ?? 0 : 0
  const shown = dec ? props.value.toFixed(dec).replace(/\.?0+$/, '') : String(Math.round(props.value))
  return (
    <label className="field">
      <span>
        {props.label} <em className="muted">{shown}{props.suffix ?? ''}</em>
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
      <button
        className={'toggle' + (props.checked ? ' on' : '')}
        onClick={() => props.onChange(!props.checked)}
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
      >
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

// ---- Hex input ------------------------------------------------------------
// Every color picker accepts a typed hex code. Takes "#rgb", "#rgba", "#rrggbb"
// or "#rrggbbaa", with or without the leading "#", and returns a normalized
// lowercase "#rrggbb"/"#rrggbbaa" - or null when the text isn't a hex color.
export function normalizeHex(input: string): string | null {
  const body = input.trim().replace(/^#/, '').toLowerCase()
  if (!/^[0-9a-f]+$/.test(body)) return null
  if (body.length === 3 || body.length === 4) return '#' + [...body].map((c) => c + c).join('')
  if (body.length === 6 || body.length === 8) return '#' + body
  return null
}

// `<input type="color">` only accepts "#rrggbb", so drop any alpha and let the
// browser normalize the CSS colors that aren't hex at all (names, rgb(), hsl()).
function toHex6(value: string | undefined): string {
  const hex = normalizeHex(value ?? '')
  if (hex) return hex.slice(0, 7)
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx && value) {
      ctx.fillStyle = '#ffffff'
      ctx.fillStyle = value
      if (typeof ctx.fillStyle === 'string' && /^#[0-9a-f]{6}$/i.test(ctx.fillStyle)) return ctx.fillStyle.toLowerCase()
    }
  } catch {
    /* ignore */
  }
  return '#ffffff'
}

export function Swatches(props: { label: string; value?: string; onChange: (c: string | undefined) => void; allowNone?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [palette, setPalette] = useState<string[]>(() => loadPalette())
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  // Typed hex, held locally so a half-typed code ("#ff") doesn't fight the value.
  const [hexDraft, setHexDraft] = useState('')
  const dotRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const hasEyedropper = typeof (window as unknown as { EyeDropper?: unknown }).EyeDropper !== 'undefined'

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (!popRef.current?.contains(e.target as Node) && !dotRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // While a picker is open, drop the dim that overlays for drawers/modals so the
  // canvas shows the colour being chosen at its true value.
  useEffect(() => {
    if (!open) return
    document.body.classList.add('picking-color')
    return () => document.body.classList.remove('picking-color')
  }, [open])

  // Commit a typed hex: normalize it, remember it in the palette, and snap the
  // field back to the current colour when the text isn't a hex code at all.
  const commitHex = (raw: string): void => {
    const hex = normalizeHex(raw)
    if (!hex) {
      setHexDraft(props.value ?? '')
      return
    }
    props.onChange(hex)
    setPalette(addToPalette(hex))
    setHexDraft(hex)
  }

  const handleToggle = (): void => {
    if (open) { setOpen(false); return }
    if (dotRef.current) {
      const r = dotRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    setHexDraft(props.value ?? '')
    setOpen(true)
  }

  return (
    <div className="field swatch-field">
      <span>{props.label}</span>
      <div className="swatch-row">
        {props.allowNone && (
          <button
            className={'swatch-dot none' + (!props.value ? ' sel' : '')}
            title="None"
            onClick={() => { props.onChange(undefined); setOpen(false) }}
          />
        )}
        <button
          ref={dotRef}
          className={'swatch-dot' + (open ? ' open' : '')}
          style={{ background: props.value ?? 'transparent' }}
          onClick={handleToggle}
          title={props.value ?? 'Pick color'}
        />
        {hasEyedropper && (
          <button className="swatch-drop" title="Pick from screen" onClick={async () => {
            const c = await eyedrop()
            if (c) { props.onChange(c); setPalette(addToPalette(c)) }
          }}>⦿</button>
        )}
      </div>
      {open && pos && createPortal(
        <div ref={popRef} className="swatch-popup" style={{ top: pos.top, right: pos.right }}>
          <div className="swatches">
            {palette.map((c) => (
              <button
                key={c}
                className={'swatch' + (props.value?.toLowerCase() === c.toLowerCase() ? ' sel' : '')}
                style={{ background: c }}
                title={c}
                onClick={() => { props.onChange(c); setOpen(false) }}
              />
            ))}
            <label className="swatch custom" title="Custom color">
              +
              <input
                type="color"
                value={toHex6(props.value)}
                onChange={(e) => { props.onChange(e.target.value); setPalette(addToPalette(e.target.value)) }}
              />
            </label>
            {hasEyedropper && (
              <button className="swatch eyedrop" title="Pick from screen" onClick={async () => {
                const c = await eyedrop()
                if (c) { props.onChange(c); setPalette(addToPalette(c)); setOpen(false) }
              }}>⦿</button>
            )}
          </div>
          <div className="swatch-hex">
            <span aria-hidden="true">#</span>
            <input
              value={hexDraft.replace(/^#/, '')}
              placeholder="rrggbb"
              spellCheck={false}
              autoComplete="off"
              aria-label="Hex colour code"
              title="Type a hex code — 3, 4, 6 or 8 digits"
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 8)
                setHexDraft(raw)
                // Preview live once the code is complete; shorthand waits for Enter/blur
                // so typing "f00…" toward "f00baa" doesn't flash the wrong colour.
                if (raw.length === 6 || raw.length === 8) props.onChange('#' + raw.toLowerCase())
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { commitHex(hexDraft); setOpen(false) }
                if (e.key === 'Escape') setOpen(false)
              }}
              onBlur={() => commitHex(hexDraft)}
            />
          </div>
        </div>,
        document.body
      )}
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
      <select value={props.value} title={props.title} aria-label={props.title ?? props.label} onChange={(e) => props.onChange(e.target.value as T)}>
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

// ---- SearchSelect: a Select for lists too long to eyeball --------------------
// The native <select> above is right for a handful of choices — it is one element,
// it is keyboard- and screen-reader-native, and it costs nothing. It stops being
// right somewhere around twenty options, where finding the one you want turns into
// scanning an unsorted column. The game-template picker crossed that line.
//
// So this is the same control with two additions and no other changes in behaviour:
// you can TYPE to narrow the list, and only the first `limit` matches are drawn, with
// a line saying how many are hidden. The cap is what keeps the popover a glanceable
// block rather than a scrollbar — the search box, not the scroll wheel, is how you
// reach the rest.
//
// Below `searchAfter` options the search box is not drawn at all, so dropping this in
// where a list happens to be short costs the author nothing.
export function SearchSelect<T extends string>(props: {
  label?: string
  value: T
  onChange: (v: T) => void
  options: readonly { value: T; label: string; disabled?: boolean }[]
  /** Most matches drawn at once (default 8). The rest are reachable by typing. */
  limit?: number
  /** Only show the search box once the list is at least this long (default 10). */
  searchAfter?: number
  placeholder?: string
  className?: string
  title?: string
}): JSX.Element {
  const limit = props.limit ?? 8
  const searchAfter = props.searchAfter ?? 10
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hl, setHl] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; drop: 'down' | 'up' } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const current = props.options.find((o) => o.value === props.value)
  const searchable = props.options.length >= searchAfter
  // Match on the LABEL and the value: the label is what is read, but a value is
  // often the shorter, more memorable handle ("dragclean" for "Drag to clean").
  const needle = q.trim().toLowerCase()
  const matches = needle ? props.options.filter((o) => (o.label + ' ' + o.value).toLowerCase().includes(needle)) : props.options
  const shown = matches.slice(0, limit)
  const hidden = matches.length - shown.length

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent): void => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false)
    }
    // Capture phase, so a scroll inside the inspector column counts too: the popover
    // is portalled to <body> and would otherwise stay put while its trigger slid away.
    const gone = (): void => setOpen(false)
    document.addEventListener('mousedown', away)
    window.addEventListener('scroll', gone, true)
    window.addEventListener('resize', gone)
    return () => {
      document.removeEventListener('mousedown', away)
      window.removeEventListener('scroll', gone, true)
      window.removeEventListener('resize', gone)
    }
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // A narrowed list re-homes the highlight: leaving it on index 3 of a list that is
  // now one item long would make Enter do nothing.
  useEffect(() => setHl(0), [q])

  const openPop = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      // Room for the search box, the capped list and the "+N more" line. Flip above
      // when the trigger sits near the bottom of the window, which in a tall
      // inspector column is most of the time.
      const need = (searchable ? 38 : 0) + Math.min(limit, props.options.length) * 27 + 16
      const below = window.innerHeight - r.bottom - 8
      const drop: 'down' | 'up' = below >= need || below >= r.top ? 'down' : 'up'
      setPos({ left: r.left, top: drop === 'down' ? r.bottom + 4 : r.top - 4, width: Math.max(r.width, 180), drop })
    }
    setQ('')
    setHl(Math.max(0, props.options.findIndex((o) => o.value === props.value)))
    setOpen(true)
  }

  const choose = (o: { value: T; disabled?: boolean }): void => {
    if (o.disabled) return
    props.onChange(o.value)
    setOpen(false)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!shown.length) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setHl((n) => (n + step + shown.length) % shown.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const pick = shown[Math.min(hl, shown.length - 1)]
      if (pick) choose(pick)
    }
  }

  const control = (
    <span className={'select-wrap search-select' + (props.className ? ' ' + props.className : '')}>
      <button
        ref={btnRef}
        type="button"
        className={'search-select-btn' + (open ? ' open' : '')}
        title={props.title}
        aria-label={props.title ?? props.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={openPop}
        onKeyDown={(e) => {
          // Opening straight into the list from the keyboard, the way a native
          // <select> does, rather than making Tab-then-Space-then-Arrow the only way in.
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            openPop()
          }
        }}
      >
        {current?.label ?? props.placeholder ?? '—'}
      </button>
      <Icon icon={ChevronDown} size={14} className="select-chevron" />
    </span>
  )

  const pop =
    open && pos
      ? createPortal(
          <div
            ref={popRef}
            className="search-select-pop"
            style={{ left: pos.left, width: pos.width, ...(pos.drop === 'down' ? { top: pos.top } : { bottom: window.innerHeight - pos.top }) }}
            role="listbox"
          >
            {searchable && (
              <input
                ref={inputRef}
                className="search-select-search"
                value={q}
                placeholder="Search…"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
              />
            )}
            <div className="search-select-list">
              {shown.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === props.value}
                  disabled={o.disabled}
                  className={'search-select-item' + (o.value === props.value ? ' on' : '') + (i === hl ? ' hl' : '')}
                  onMouseEnter={() => setHl(i)}
                  onClick={() => choose(o)}
                >
                  <span>{o.label}</span>
                  {o.value === props.value && <Icon icon={Check} size={12} />}
                </button>
              ))}
              {!shown.length && <div className="search-select-empty">No match for “{q.trim()}”</div>}
            </div>
            {hidden > 0 && <div className="search-select-more">+{hidden} more — keep typing to narrow</div>}
          </div>,
          document.body,
        )
      : null

  if (!props.label)
    return (
      <>
        {control}
        {pop}
      </>
    )
  return (
    <label className="field">
      <span>{props.label}</span>
      {control}
      {pop}
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
      <div className="acc-body">
        <div className="acc-inner">{props.children}</div>
      </div>
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

// ---- Row: labelled field row (shared by Inspector + drawers) ----------------
export function Row(props: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  )
}

// ---- DockPanel (resizable + collapsible side panel; size persisted) ---------
export function DockPanel(props: { id: string; side: 'left' | 'right'; defaultWidth: number; min?: number; max?: number; children: React.ReactNode }): JSX.Element {
  const init = getDock(props.id)
  const [w, setW] = useState(init.w ?? props.defaultWidth)
  const [collapsed, setCollapsed] = useState(!!init.collapsed)
  const drag = useRef<{ x: number; w: number } | null>(null)
  const min = props.min ?? 180
  const max = props.max ?? 560
  const onDown = (e: React.PointerEvent): void => {
    drag.current = { x: e.clientX, w }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent): void => {
    if (!drag.current) return
    const dx = (e.clientX - drag.current.x) * (props.side === 'left' ? 1 : -1)
    setW(Math.max(min, Math.min(max, drag.current.w + dx)))
  }
  const onUp = (e: React.PointerEvent): void => {
    if (!drag.current) return
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    drag.current = null
    setDock(props.id, { w })
  }
  const toggle = (): void => setCollapsed((c) => { const n = !c; setDock(props.id, { collapsed: n }); return n })
  // chevron points the way the click moves the panel (collapse vs expand)
  const tabIcon = (props.side === 'left') === collapsed ? ChevronRight : ChevronLeft
  const tab = (
    <button className="dock-tab" title={collapsed ? 'Expand panel' : 'Collapse panel'} onPointerDown={(e) => e.stopPropagation()} onClick={toggle}>
      <Icon icon={tabIcon} size={13} />
    </button>
  )
  if (collapsed) return <div className={'dock dock-' + props.side + ' collapsed'}>{tab}</div>
  const handle = (
    <div className="dock-resize" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} title="Drag to resize">
      {tab}
    </div>
  )
  return (
    <div className={'dock dock-' + props.side} style={{ width: w }}>
      {props.side === 'right' && handle}
      <div className="dock-inner">{props.children}</div>
      {props.side === 'left' && handle}
    </div>
  )
}

// ---- Drawer (right slide-over; canvas stays visible) ------------------------
export function Drawer(props: { title: React.ReactNode; onClose: () => void; width?: number; children: React.ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.drawer-close)')?.focus()
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return createPortal(
    <div className="drawer-backdrop" onClick={props.onClose}>
      <div className="drawer" ref={ref} style={{ width: props.width ?? 360 }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <strong>{props.title}</strong>
          <button className="icon drawer-close" onClick={props.onClose} title="Close (Esc)" aria-label="Close">
            <Icon icon={X} size={16} />
          </button>
        </div>
        <div className="drawer-body">{props.children}</div>
      </div>
    </div>,
    document.body,
  )
}
