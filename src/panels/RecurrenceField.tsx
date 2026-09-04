// "Repeats" control for a dynamic date — shared by the countdown/dynamic-date
// inspector and the pinned header's date band, so both write the same shape
// (runtime `Recurrence`) and describe it the same way.
//
// A dynamic date normally lands on a flat offset from today, which drifts across the
// week: run the same ad on a Saturday and "order by + 3 days" is a Tuesday. A
// recurrence pins it to the days the offer actually uses — the next Friday, the next
// weekday (a "next business day" ship date), the next weekend, or any set of days.
// The day offset still applies FIRST, so 0 can land on today and 1 always skips it.

import { Chips, Row, Select } from '../ui'
import { resolveDynamicTarget } from '../../runtime/elements/countdown'
import type { Recurrence } from '../../runtime/elements/countdown'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Kind = 'off' | 'weekday' | 'weekend' | 'days'

const kindOf = (v?: Recurrence): Kind => (Array.isArray(v) ? 'days' : v === 'weekday' || v === 'weekend' ? v : 'off')

/** What the current settings resolve to right now, e.g. "Friday, Sep 11" — the fastest
 * way for an author to confirm "next Friday" means what they think it means. */
function recurrencePreview(days: number | undefined, recur?: Recurrence): string {
  const at = new Date(resolveDynamicTarget(Date.now(), days, recur))
  try {
    return at.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
  } catch {
    return at.toDateString()
  }
}

export function RecurrenceField(props: { value?: Recurrence; days?: number; onChange: (v: Recurrence | undefined) => void; label?: string }): JSX.Element {
  const kind = kindOf(props.value)
  // Only the explicit-day mode needs the chip row; the presets are already complete sets.
  const picked = Array.isArray(props.value) ? props.value : []
  const toggle = (d: number): void => {
    const next = picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d].sort((a, b) => a - b)
    // An empty set would silently mean "no recurrence" — keep the last day rather than
    // letting the control unset itself out from under the author.
    props.onChange(next.length ? next : picked)
  }
  return (
    <>
      <Row label={props.label ?? 'Repeats'}>
        <Select
          value={kind}
          onChange={(v) => {
            const k = v as Kind
            // Seed the day picker with Friday — the day this feature is asked for most,
            // and something has to be selected for the preview to mean anything.
            props.onChange(k === 'off' ? undefined : k === 'days' ? (picked.length ? picked : [5]) : k)
          }}
          options={[
            { value: 'off', label: 'Off — just the day offset' },
            { value: 'weekday', label: 'Next weekday (Mon–Fri)' },
            { value: 'weekend', label: 'Next weekend (Sat/Sun)' },
            { value: 'days', label: 'Pick days…' },
          ]}
        />
      </Row>
      {kind === 'days' && (
        <Chips items={DAY_LABELS.map((label, d) => ({ key: label, label, active: picked.includes(d), onClick: () => toggle(d) }))} />
      )}
      <div className="hint pad">
        {kind === 'off'
          ? 'The date is today plus the day offset above.'
          : `Jumps forward to the next ${
              kind === 'weekday'
                ? 'Mon–Fri'
                : kind === 'weekend'
                  ? 'Sat/Sun'
                  : picked.map((d) => DAY_LABELS[d]).join(', ') || '—'
            } at or after the day offset — offset 0 can land on today, 1 always skips it.`}{' '}
        Right now that is <b>{recurrencePreview(props.days, props.value)}</b>.
      </div>
    </>
  )
}
