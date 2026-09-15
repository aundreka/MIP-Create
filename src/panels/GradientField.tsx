// "Fill" control for a dynamic date's text: solid colour or a linear gradient, laid
// out the way design tools show one so a gradient can be copied across value for
// value — an angle with reverse/rotate, a preview bar with draggable stop handles
// (click the bar to add a stop there), and a row per stop with position %, hex and
// opacity %. Writes the runtime `TextGradient` shape (see elements/textGradient.ts).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { GradientStop, TextGradient } from '../../runtime/scene'
import { GRADIENT_DEFAULT_ANGLE, gradientCss, parseHex, sortedStops, stopColor } from '../../runtime/elements/textGradient'
import { ArrowLeftRight, Icon, Minus, Plus, RotateCcw } from '../icons'
import { NumField, Row, Select } from '../ui'

/** What "Linear gradient" starts from: a gold foil sheen — the look this was built for. */
const SEED_GRADIENT: TextGradient = {
  type: 'linear',
  angleDeg: GRADIENT_DEFAULT_ANGLE,
  stops: [
    { pos: 25, color: '#C6AA4A', opacity: 100 },
    { pos: 59, color: '#FFFFFF', opacity: 100 },
    { pos: 93, color: '#D3B156', opacity: 100 },
  ],
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const hex2 = (n: number): string => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0').toUpperCase()

/** '#RRGGBB' for any parseable colour (alpha dropped), else null. */
function toHex6(color: string): string | null {
  const rgb = parseHex(color)
  return rgb ? '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]) : null
}

/** The colour the gradient already has at `pos`, so a stop added there doesn't change the look. */
function colorAt(stops: GradientStop[], pos: number): string {
  const s = sortedStops(stops)
  const after = s.findIndex((o) => o.pos >= pos)
  if (after <= 0) return toHex6(s[after === 0 ? 0 : s.length - 1].color) ?? '#FFFFFF'
  const a = s[after - 1]
  const b = s[after]
  const ca = parseHex(a.color)
  const cb = parseHex(b.color)
  if (!ca || !cb) return toHex6(a.color) ?? '#FFFFFF'
  const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos)
  return '#' + [0, 1, 2].map((i) => hex2(ca[i] + (cb[i] - ca[i]) * t)).join('')
}

/** Hex text box: holds a half-typed code locally and commits on Enter / blur. */
function HexInput(props: { value: string; onCommit: (hex: string) => void }): JSX.Element {
  const shown = (toHex6(props.value) ?? props.value).replace(/^#/, '')
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  const commit = (): void => {
    const hex = toHex6(draft)
    if (hex) props.onCommit(hex)
    else setDraft(shown)
  }
  return (
    <input
      className="grad-hex"
      value={draft}
      maxLength={7}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function GradientField(props: { value?: TextGradient; onChange: (g: TextGradient | undefined) => void }): JSX.Element {
  const g = props.value
  const [sel, setSel] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)

  const fillRow = (
    <Row label="Fill">
      <Select
        value={g ? 'linear' : 'solid'}
        onChange={(v) => props.onChange(v === 'linear' ? { ...SEED_GRADIENT, stops: SEED_GRADIENT.stops.map((s) => ({ ...s })) } : undefined)}
        options={[
          { value: 'solid', label: 'Solid color' },
          { value: 'linear', label: 'Linear gradient' },
        ]}
      />
    </Row>
  )
  if (!g) return fillRow

  const stops = g.stops
  const cur = clamp(sel, 0, stops.length - 1)
  const set = (patch: Partial<TextGradient>): void => props.onChange({ ...g, ...patch })
  const setStop = (i: number, patch: Partial<GradientStop>): void => set({ stops: stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const posAt = (clientX: number): number => {
    const r = barRef.current?.getBoundingClientRect()
    return r && r.width > 0 ? Math.round(clamp(((clientX - r.left) / r.width) * 100, 0, 100)) : 50
  }
  const addAt = (pos: number): void => {
    set({ stops: [...stops, { pos, color: colorAt(stops, pos), opacity: 100 }] })
    setSel(stops.length)
  }
  // "+" splits the gap after the selected stop (or before it, when it is the last one).
  const addAfterSelected = (): void => {
    const p = stops[cur]?.pos ?? 0
    const next = sortedStops(stops).find((s) => s.pos > p)
    const prev = [...sortedStops(stops)].reverse().find((s) => s.pos < p)
    addAt(Math.round(next ? (p + next.pos) / 2 : prev ? (p + prev.pos) / 2 : 50))
  }
  const remove = (i: number): void => {
    if (stops.length <= 2) return
    set({ stops: stops.filter((_, j) => j !== i) })
    setSel(Math.max(0, i - 1))
  }
  // Listed in position order, like the bar reads; indices still point into `stops`.
  const order = stops.map((_, i) => i).sort((a, b) => stops[a].pos - stops[b].pos)

  const onHandleDown = (e: ReactPointerEvent<HTMLButtonElement>, i: number): void => {
    e.stopPropagation()
    e.preventDefault()
    setSel(i)
    dragging.current = i
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  return (
    <>
      {fillRow}
      <div className="grad-tools">
        <NumField label="Angle" value={g.angleDeg ?? GRADIENT_DEFAULT_ANGLE} step={1} suffix="°" onChange={(n) => set({ angleDeg: ((Math.round(n) % 360) + 360) % 360 })} />
        <button className="icon-btn" title="Reverse stops" onClick={() => set({ stops: stops.map((s) => ({ ...s, pos: 100 - s.pos })) })}>
          <Icon icon={ArrowLeftRight} size={16} />
        </button>
        <button className="icon-btn" title="Rotate 90°" onClick={() => set({ angleDeg: ((g.angleDeg ?? GRADIENT_DEFAULT_ANGLE) + 90) % 360 })}>
          <Icon icon={RotateCcw} size={16} />
        </button>
      </div>
      <div className="grad-bar-wrap">
        <div ref={barRef} className="grad-bar" title="Click to add a stop" onPointerDown={(e) => addAt(posAt(e.clientX))}>
          <div className="grad-bar-fill" style={{ background: gradientCss(g, 90) ?? undefined }} />
          {stops.map((s, i) => (
            <button
              key={i}
              className={'grad-handle' + (i === cur ? ' sel' : '')}
              style={{ left: clamp(s.pos, 0, 100) + '%' }}
              title={`${Math.round(s.pos)}%`}
              onPointerDown={(e) => onHandleDown(e, i)}
              onPointerMove={(e) => {
                if (dragging.current === i) setStop(i, { pos: posAt(e.clientX) })
              }}
              onPointerUp={() => (dragging.current = null)}
              onPointerCancel={() => (dragging.current = null)}
            >
              <span style={{ background: stopColor(s) }} />
            </button>
          ))}
        </div>
      </div>
      <div className="grad-stops-head">
        <span>Stops</span>
        <button className="icon-btn" title="Add stop" onClick={addAfterSelected}>
          <Icon icon={Plus} size={15} />
        </button>
      </div>
      {order.map((i) => {
        const s = stops[i]
        return (
          <div key={i} className={'grad-stop' + (i === cur ? ' sel' : '')} onPointerDown={() => setSel(i)}>
            <input
              className="grad-pos"
              type="number"
              min={0}
              max={100}
              value={Math.round(s.pos)}
              onChange={(e) => e.target.value !== '' && setStop(i, { pos: clamp(Number(e.target.value), 0, 100) })}
              title="Position %"
            />
            <div className="grad-color">
              <label className="grad-chip" style={{ background: stopColor(s) }} title="Pick color">
                <input type="color" value={(toHex6(s.color) ?? '#FFFFFF').toLowerCase()} onChange={(e) => setStop(i, { color: e.target.value.toUpperCase() })} />
              </label>
              <HexInput value={s.color} onCommit={(hex) => setStop(i, { color: hex })} />
              <input
                className="grad-op"
                type="number"
                min={0}
                max={100}
                value={Math.round(s.opacity ?? 100)}
                onChange={(e) => e.target.value !== '' && setStop(i, { opacity: clamp(Number(e.target.value), 0, 100) })}
                title="Opacity %"
              />
              <em>%</em>
            </div>
            <button className="icon-btn" title={stops.length <= 2 ? 'A gradient needs two stops' : 'Remove stop'} disabled={stops.length <= 2} onClick={() => remove(i)}>
              <Icon icon={Minus} size={15} />
            </button>
          </div>
        )
      })}
    </>
  )
}
