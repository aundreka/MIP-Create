// Custom keyframe editor — authors the KeyframeStep[] for a 'custom' animation.
// Each step has a percent (0–100) and any of transform / opacity / filter; the
// runtime compiles them into a unique @keyframes (see runtime/anim.ts). Kept in
// its own file (themed via CSS vars + existing utility classes) so it stays clear
// of the UI rebuild.

import type { KeyframeStep } from '../../runtime/scene'
import { NumField } from '../ui'
import { Icon, Plus, X } from '../icons'

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

export function KeyframeEditor(props: { steps: KeyframeStep[]; onChange: (steps: KeyframeStep[]) => void }): JSX.Element {
  const steps = props.steps
  const setStep = (i: number, patch: Partial<KeyframeStep>): void =>
    props.onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const add = (): void => {
    const at = steps.length ? clamp((steps[steps.length - 1].at ?? 0) + 25, 0, 100) : 0
    props.onChange([...steps, { at, opacity: 1 }])
  }
  const remove = (i: number): void => props.onChange(steps.filter((_, j) => j !== i))

  return (
    <div className="kf-list">
      {steps.map((s, i) => (
        <div key={i} className="kf-step">
          <div className="kf-row">
            <div className="kf-at">
              <NumField label="At %" value={s.at} step={5} min={0} max={100} onChange={(n) => setStep(i, { at: clamp(n, 0, 100) })} />
            </div>
            <div className="kf-op">
              <NumField label="Opacity" value={s.opacity ?? 1} step={0.05} min={0} max={1} onChange={(n) => setStep(i, { opacity: clamp(n, 0, 1) })} />
            </div>
            <button className="kf-remove" title="Remove keyframe" onClick={() => remove(i)}>
              <Icon icon={X} size={14} />
            </button>
          </div>
          <label className="field">
            <span>Transform</span>
            <input
              value={s.transform ?? ''}
              placeholder="scale(1.1) rotate(6deg) translateY(-8px)"
              onChange={(e) => setStep(i, { transform: e.target.value || undefined })}
            />
          </label>
          <label className="field">
            <span>Filter (optional)</span>
            <input
              value={s.filter ?? ''}
              placeholder="brightness(1.3) blur(2px)"
              onChange={(e) => setStep(i, { filter: e.target.value || undefined })}
            />
          </label>
        </div>
      ))}
      <button className="wide" onClick={add}>
        <Icon icon={Plus} size={14} /> Add keyframe
      </button>
      <div className="hint pad">
        Steps play 0–100% across the duration (auto-sorted by %). Set transform / opacity / filter at each. e.g. <b>0%</b>: opacity
        0, scale(.6); <b>60%</b>: scale(1.1); <b>100%</b>: opacity 1, scale(1). Plays in Preview.
      </div>
    </div>
  )
}
