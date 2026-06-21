// Inspector — project meta (no selection), a multi-select panel, or the full
// single-element editor with a visual Background-box section.

import { useState } from 'react'
import type { Anchor, AdvanceOn, AnimPresetId, AnimSpec, AnimTrigger, BoxStyle, CountdownConfig, CtaPulsePreset, EndsceneConfig, HandguideConfig, HandguideNode, KeyframeStep, LayoutMode, ObjectFit, SceneElement, SceneKind, SfxBinding, ShadowPreset, TextConfig, TransitionType } from '../../runtime/scene'
import { GAME_TEMPLATES } from '../../runtime/games/registry'
import type { ParamField } from '../../runtime/games/types'
import {
  activeSceneDef,
  alignSelected,
  convertElement,
  copyStyle,
  duplicateSelected,
  groupSelected,
  hasStyleClip,
  pasteStyle,
  patchElement,
  patchGeometry,
  patchMeta,
  patchSceneDef,
  removeSelected,
  setSceneBg,
  setTrace,
  singleSelected,
  toggleLock,
  ungroupSelected,
  useEditorState,
  type AlignOp,
  type ConvertTo,
} from '../store'
import { Accordion, Chips, ColorField, NumField, Select, Slider, Swatches, Toggle } from '../ui'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Icon,
  type LucideIcon,
  Volume2,
  X,
} from '../icons'
import { AssetPicker } from './AssetPicker'
import { SfxLibrary } from './SfxLibrary'
import { startPathDraw } from '../drawMode'
import { KeyframeEditor } from './KeyframeEditor'

const ANCHORS: Anchor[] = ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right']

function Row(props: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  )
}

// Per-element sounds: bind a sound (built-in library or upload) to a trigger.
// "Add sound" opens the sound library directly so the library is easy to find and
// the button visibly does something.
function ElementSound(props: { el: SceneElement }): JSX.Element {
  const { el } = props
  const { assets } = useEditorState()
  const [chooser, setChooser] = useState<number | null>(null) // binding index being chosen (>= length = new)
  const binds = el.sfx ?? []
  const setBinds = (b: SfxBinding[]): void => patchElement(el.id, { sfx: b.length ? b : undefined })
  const pick = (assetId: string): void => {
    if (chooser == null) return
    if (chooser >= binds.length) setBinds([...binds, { event: 'tap', assetId }])
    else setBinds(binds.map((x, j) => (j === chooser ? { ...x, assetId } : x)))
    setChooser(null)
  }
  const nameOf = (b: SfxBinding): string => (b.assetId ? (assets[b.assetId] ? b.assetId : '(missing)') : 'Pick sound…')
  return (
    <>
      {binds.map((b, i) => (
        <div className="sfx-el-row" key={i}>
          <button className="sfx-el-name" title="Change sound" onClick={() => setChooser(i)}>
            <Icon icon={Volume2} size={13} /> <span>{nameOf(b)}</span>
          </button>
          <Select
            value={(b.event as 'tap' | 'sceneEnter') ?? 'tap'}
            onChange={(v) => setBinds(binds.map((x, j) => (j === i ? { ...x, event: v } : x)))}
            options={[
              { value: 'tap', label: 'On tap' },
              { value: 'sceneEnter', label: 'On scene enter' },
            ]}
          />
          <button className="icon-btn" title="Remove" onClick={() => setBinds(binds.filter((_, j) => j !== i))}>
            <Icon icon={X} size={13} />
          </button>
        </div>
      ))}
      <button className="wide" onClick={() => setChooser(binds.length)}>
        <Icon icon={Volume2} size={14} /> Add sound
      </button>
      <div className="hint pad">Play a sound when this element is tapped, or when its scene appears. Pick a built-in sound or upload your own. Plays in Preview and export.</div>
      {chooser != null && <SfxLibrary onClose={() => setChooser(null)} onPick={pick} />}
    </>
  )
}

const ALIGN_BTNS: { op: AlignOp; icon: LucideIcon; title: string }[] = [
  { op: 'left', icon: AlignStartVertical, title: 'Align left' },
  { op: 'centerH', icon: AlignCenterVertical, title: 'Center horizontally' },
  { op: 'right', icon: AlignEndVertical, title: 'Align right' },
  { op: 'top', icon: AlignStartHorizontal, title: 'Align top' },
  { op: 'middleV', icon: AlignCenterHorizontal, title: 'Center vertically' },
  { op: 'bottom', icon: AlignEndHorizontal, title: 'Align bottom' },
]
function AlignRow(): JSX.Element {
  return (
    <div className="align-row">
      {ALIGN_BTNS.map((b) => (
        <button key={b.op} title={b.title} onClick={() => alignSelected(b.op)}>
          <Icon icon={b.icon} size={16} />
        </button>
      ))}
    </div>
  )
}

function StyleButtons(): JSX.Element {
  return (
    <div className="grid2">
      <button onClick={copyStyle}>Copy style</button>
      <button disabled={!hasStyleClip()} onClick={pasteStyle}>
        Paste style
      </button>
    </div>
  )
}

// ---- animation sub-panel ---------------------------------------------------
const EASINGS = ['ease', 'ease-out', 'ease-in', 'ease-in-out', 'linear']
const ENTRANCE_PRESETS: AnimPresetId[] = ['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'pop', 'bounce', 'spin']
const LOOP_PRESETS: AnimPresetId[] = ['pulse', 'float', 'bounce', 'shake', 'wave', 'shine', 'glow', 'spin']
const EXIT_PRESETS: AnimPresetId[] = ['fade-out', 'scale-out']
// seeded when switching a phase to 'custom' so there's something to edit
const DEFAULT_CUSTOM: KeyframeStep[] = [
  { at: 0, opacity: 0, transform: 'scale(0.6)' },
  { at: 60, opacity: 1, transform: 'scale(1.1)' },
  { at: 100, opacity: 1, transform: 'scale(1)' },
]

function AnimRow(props: {
  title: string
  spec?: AnimSpec
  presets: AnimPresetId[]
  defaultSpec: AnimSpec
  onChange: (s: AnimSpec | undefined) => void
  trigger?: boolean
}): JSX.Element {
  const { spec } = props
  const on = !!spec
  const patch = (p: Partial<AnimSpec>): void => props.onChange({ ...(spec ?? props.defaultSpec), ...p })
  return (
    <div className="anim-row">
      <Toggle label={props.title} checked={on} onChange={(v) => props.onChange(v ? props.defaultSpec : undefined)} />
      {on && spec && (
        <div className="anim-body">
          <Row label="Preset">
            <Select
              value={spec.preset}
              onChange={(v) =>
                v === 'custom' && !spec.custom?.length ? patch({ preset: 'custom', custom: DEFAULT_CUSTOM }) : patch({ preset: v as AnimSpec['preset'] })
              }
              options={[...props.presets.map((p) => ({ value: p as string, label: p as string })), { value: 'custom', label: '✦ custom keyframes' }]}
            />
          </Row>
          {spec.preset === 'custom' && (
            <KeyframeEditor steps={spec.custom ?? []} onChange={(c) => patch({ custom: c })} />
          )}
          <div className="grid2">
            <NumField label="Duration" value={spec.durationMs} step={50} onChange={(n) => patch({ durationMs: n })} />
            <NumField label="Delay" value={spec.delayMs} step={50} onChange={(n) => patch({ delayMs: n })} />
          </div>
          <Row label="Easing">
            <Select value={spec.easing} onChange={(v) => patch({ easing: v })} options={EASINGS.map((x) => ({ value: x, label: x }))} />
          </Row>
          {props.trigger && (
            <Row label="Plays">
              <Select
                value={spec.trigger ?? 'onMount'}
                onChange={(v) => patch({ trigger: v as AnimTrigger })}
                options={[
                  { value: 'onMount', label: 'on scene enter' },
                  { value: 'onGameWin', label: 'on game win' },
                ]}
              />
            </Row>
          )}
        </div>
      )}
    </div>
  )
}

export function Inspector(): JSX.Element {
  const state = useEditorState()
  const landscape = state.orientation === 'landscape'

  if (state.selectedIds.length > 1) {
    const anyGroup = state.scene.elements.some((e) => state.selectedIds.includes(e.id) && e.groupId)
    return (
      <div className="panel inspector">
        <div className="panel-title">{state.selectedIds.length} selected</div>
        <div className="group-title">Align to canvas</div>
        <AlignRow />
        <div className="group-title" />
        <button className="wide" onClick={groupSelected}>
          Group (Ctrl+G)
        </button>
        {anyGroup && (
          <button className="wide" onClick={ungroupSelected}>
            Ungroup (Ctrl+Shift+G)
          </button>
        )}
        <StyleButtons />
        <button className="wide" onClick={duplicateSelected}>
          Duplicate (Ctrl+D)
        </button>
        <button className="wide danger" onClick={removeSelected}>
          Delete
        </button>
      </div>
    )
  }

  const el = singleSelected(state)
  if (!el) {
    const m = state.project.meta
    const sd = activeSceneDef(state)
    const adv = sd.advance
    const tr = sd.transition ?? { type: 'fade' as TransitionType, durationMs: 350 }
    const others = state.project.scenes.filter((s) => s.id !== sd.id)
    return (
      <div className="panel inspector">
        <div className="panel-title">Scene: {sd.name}</div>
        <Row label="Scene name">
          <input value={sd.name} onChange={(e) => patchSceneDef(sd.id, { name: e.target.value })} />
        </Row>
        <div className="grid2">
          <Row label="Type">
            <Select
              value={sd.kind ?? 'custom'}
              onChange={(v) => patchSceneDef(sd.id, { kind: v as SceneKind })}
              options={[
                { value: 'game', label: 'game' },
                { value: 'win', label: 'win' },
                { value: 'endscene', label: 'endscene' },
                { value: 'custom', label: 'custom' },
              ]}
            />
          </Row>
          <ColorField label="Background" value={sd.bgColor ?? m.bgMatchColor ?? '#101a33'} onChange={(c) => setSceneBg(c ?? '#101a33')} />
        </div>

        <div className="group-title">Advance (when to leave this scene)</div>
        <Row label="On">
          <Select
            value={adv.on}
            onChange={(v) => patchSceneDef(sd.id, { advance: { ...adv, on: v as AdvanceOn } })}
            options={[
              { value: 'gameWin', label: 'game won' },
              { value: 'timer', label: 'after delay' },
              { value: 'tap', label: 'on tap' },
              { value: 'manual', label: 'manual (stay)' },
            ]}
          />
        </Row>
        {adv.on !== 'manual' && (
          <NumField label="Delay (ms)" value={adv.delayMs ?? (adv.on === 'timer' ? 2000 : 0)} step={100} onChange={(n) => patchSceneDef(sd.id, { advance: { ...adv, delayMs: n } })} />
        )}
        {adv.on !== 'manual' && (
          <Row label="Go to">
            <Select
              value={adv.to ?? ''}
              onChange={(v) => patchSceneDef(sd.id, { advance: { ...adv, to: v || undefined } })}
              options={[{ value: '', label: '(next scene)' }, ...others.map((s) => ({ value: s.id, label: s.name }))]}
            />
          </Row>
        )}

        <div className="group-title">Transition (how this scene enters)</div>
        <div className="grid2">
          <Row label="Type">
            <Select
              value={tr.type}
              onChange={(v) => patchSceneDef(sd.id, { transition: { ...tr, type: v as TransitionType } })}
              options={[
                { value: 'none', label: 'none' },
                { value: 'fade', label: 'fade' },
                { value: 'slide-left', label: 'slide ←' },
                { value: 'slide-right', label: 'slide →' },
                { value: 'slide-up', label: 'slide ↑' },
                { value: 'slide-down', label: 'slide ↓' },
              ]}
            />
          </Row>
          <NumField label="Duration" value={tr.durationMs} step={50} onChange={(n) => patchSceneDef(sd.id, { transition: { ...tr, durationMs: n } })} />
        </div>

        <div className="group-title">Project</div>
        <Row label="Name">
          <input value={m.name} onChange={(e) => patchMeta({ name: e.target.value })} />
        </Row>
        <div className="grid2">
          <Row label="Client">
            <input value={m.client ?? ''} placeholder="e.g. Bioma" onChange={(e) => patchMeta({ client: e.target.value })} />
          </Row>
          <Row label="MIP">
            <input value={m.mip ?? ''} placeholder="e.g. MIP3" onChange={(e) => patchMeta({ mip: e.target.value })} />
          </Row>
        </div>
        <div className="hint pad">Client + MIP group this playable for the QA consistency check (Topbar → QA).</div>
        <div className="grid2">
          <NumField label="Base W" value={m.baseW} onChange={(n) => patchMeta({ baseW: n })} />
          <NumField label="Base H" value={m.baseH} onChange={(n) => patchMeta({ baseH: n })} />
        </div>
        <Row label="iOS store URL">
          <input value={m.clickUrl.ios} onChange={(e) => patchMeta({ clickUrl: { ...m.clickUrl, ios: e.target.value } })} />
        </Row>
        <Row label="Android store URL">
          <input value={m.clickUrl.android} onChange={(e) => patchMeta({ clickUrl: { ...m.clickUrl, android: e.target.value } })} />
        </Row>

        <div className="group-title">Trace backdrop (editor only)</div>
        <AssetPicker label="Mockup image" allowNone value={state.trace.assetId} onChange={(id) => setTrace({ assetId: id })} />
        <Toggle label="Show backdrop" checked={state.trace.visible} onChange={(v) => setTrace({ visible: v })} />
        <Slider label="Opacity" value={Math.round(state.trace.opacity * 100)} min={5} max={100} suffix="%" onChange={(n) => setTrace({ opacity: n / 100 })} />
        <div className="hint pad">A mockup overlaid faintly on the canvas to trace/align against. Never rendered at runtime or exported.</div>

        <div className="hint pad">Select an element to edit it. Use the Scenes strip to add/reorder scenes.</div>
      </div>
    )
  }

  const ov = landscape ? el.landscape ?? {} : {}
  const g = {
    x: ov.x ?? el.x,
    y: ov.y ?? el.y,
    scale: ov.scale ?? el.scale ?? 1,
    w: ov.w ?? el.w,
    h: ov.h ?? el.h,
    anchor: ov.anchor ?? el.anchor,
    mode: ov.mode ?? el.mode,
  }
  const id = el.id
  const setText = (patch: Partial<TextConfig>): void =>
    patchElement(id, { text: { ...(el.text ?? { value: '', fontSizePx: 48 }), ...patch } })
  const setBox = (patch: Partial<BoxStyle>): void => patchElement(id, { box: { ...(el.box ?? {}), ...patch } })
  const isTextOrCta = el.type === 'text' || el.type === 'cta' || el.type === 'choice'
  // countdown is styled like text (font/colour/box), so it shares those sections
  const hasTextStyle = isTextOrCta || el.type === 'countdown'

  const BOX_PRESETS: { key: string; label: string; box: BoxStyle | undefined }[] = [
    { key: 'none', label: 'None', box: undefined },
    { key: 'solid', label: 'Solid', box: { bgColor: '#16a34a', radiusPx: 16, paddingXPx: 44, paddingYPx: 18 } },
    { key: 'pill', label: 'Pill', box: { bgColor: '#16a34a', pill: true, paddingXPx: 52, paddingYPx: 18, shadow: 'soft' } },
    { key: 'outline', label: 'Outline', box: { radiusPx: 14, borderPx: 3, borderColor: '#ffffff', paddingXPx: 40, paddingYPx: 16 } },
    { key: 'soft', label: 'Soft', box: { bgColor: '#ffffff', radiusPx: 26, paddingXPx: 40, paddingYPx: 24, shadow: 'medium' } },
    { key: 'glass', label: 'Glass', box: { bgColor: 'rgba(255,255,255,0.16)', radiusPx: 24, borderPx: 1.5, borderColor: 'rgba(255,255,255,0.55)', paddingXPx: 36, paddingYPx: 20, shadow: 'soft' } },
  ]

  return (
    <div className="panel inspector">
      <div className="panel-title">
        {el.type === 'bar' && el.mode === 'fit' ? 'rectangle' : el.type} {landscape && <span className="badge">landscape</span>}
      </div>

      <Row label="Name">
        <input value={el.name} onChange={(e) => patchElement(id, { name: e.target.value })} />
      </Row>
      <Toggle label="Lock element" checked={!!el.locked} onChange={(v) => toggleLock(id)} />
      <Toggle label="Show on game win" checked={!!el.showOnWin} onChange={(v) => patchElement(id, { showOnWin: v })} />

      {el.type !== 'game-mount' && el.type !== 'endscene' &&
        (() => {
        const curKey: ConvertTo =
          el.type === 'bar' ? (el.mode === 'fit' ? 'rect' : 'bar') : (el.type as ConvertTo)
        const opts: { to: ConvertTo; label: string }[] = el.assetId
          ? [
              { to: 'image', label: 'Image' },
              { to: 'bar', label: 'Header' },
              { to: 'rect', label: 'Rectangle' },
              { to: 'cta', label: 'CTA' },
              { to: 'background', label: 'Background' },
              { to: 'handguide', label: 'Hand guide' },
            ]
          : el.type === 'text'
            ? [
                { to: 'text', label: 'Text' },
                { to: 'cta', label: 'CTA' },
              ]
            : [
                { to: 'bar', label: 'Header' },
                { to: 'rect', label: 'Rectangle' },
                { to: 'cta', label: 'CTA' },
                { to: 'text', label: 'Text' },
              ]
        return (
          <>
            <div className="group-title">Convert to</div>
            <Chips items={opts.map((o) => ({ key: o.to, label: o.label, active: curKey === o.to, onClick: () => convertElement(id, o.to) }))} />
          </>
        )
      })()}

      <div className="group-title">Align to canvas</div>
      <AlignRow />

      {landscape && (
        <button className="wide" onClick={() => patchElement(id, { landscape: undefined })}>
          Reset landscape overrides
        </button>
      )}

      <div className="group-title">Position {landscape ? '(landscape)' : ''}</div>
      <div className="grid2">
        <NumField label="X" value={g.x} onChange={(n) => patchGeometry(id, { x: n })} />
        <NumField label="Y" value={g.y} onChange={(n) => patchGeometry(id, { y: n })} />
      </div>
      {el.type === 'text' || el.type === 'countdown' || el.type === 'background' || (el.type === 'endscene' && g.mode === 'extend') ? null : el.type === 'bar' && g.mode === 'extend' ? (
        <NumField label="Height" value={g.h} onChange={(n) => patchGeometry(id, { h: n })} />
      ) : g.w != null && g.h != null ? (
        <div className="grid2">
          <NumField label="W" value={g.w} onChange={(n) => patchGeometry(id, { w: n })} />
          <NumField label="H" value={g.h} onChange={(n) => patchGeometry(id, { h: n })} />
        </div>
      ) : (
        <NumField label="Scale" value={g.scale} step={0.01} onChange={(n) => patchGeometry(id, { scale: n })} />
      )}
      <div className="grid2">
        <Row label="Anchor">
          <Select value={g.anchor} onChange={(v) => patchGeometry(id, { anchor: v as Anchor })} options={ANCHORS.map((a) => ({ value: a, label: a }))} />
        </Row>
        <Row label="Mode">
          <Select
            value={g.mode}
            onChange={(v) => patchGeometry(id, { mode: v as LayoutMode })}
            options={[
              { value: 'fit', label: 'fit' },
              { value: 'extend', label: 'extend (full width)' },
            ]}
          />
        </Row>
      </div>

      {el.type === 'game-mount' &&
        (() => {
          const tpl = GAME_TEMPLATES.find((t) => t.id === (el.game?.templateId ?? 'match')) ?? GAME_TEMPLATES[0]
          const params: Record<string, unknown> = { ...tpl.defaultParams, ...(el.game?.params ?? {}) }
          const setParam = (k: string, v: unknown): void =>
            patchElement(id, { game: { ...(el.game ?? { templateId: tpl.id, params: {} }), templateId: tpl.id, params: { ...params, [k]: v } } })
          const renderField = (f: ParamField): JSX.Element => {
            const v = params[f.key]
            if (f.type === 'number') return <NumField key={f.key} label={f.label} value={typeof v === 'number' ? v : 0} step={f.step ?? 1} min={f.min} max={f.max} onChange={(n) => setParam(f.key, n)} />
            if (f.type === 'color')
              return <ColorField key={f.key} label={f.label} value={typeof v === 'string' ? v : '#888888'} onChange={(c) => setParam(f.key, c ?? '#888888')} />
            if (f.type === 'select')
              return (
                <Row key={f.key} label={f.label}>
                  <Select value={String(v ?? '')} onChange={(nv) => setParam(f.key, nv)} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
                </Row>
              )
            return (
              <Row key={f.key} label={f.label}>
                <input value={typeof v === 'string' ? v : ''} onChange={(e) => setParam(f.key, e.target.value)} />
              </Row>
            )
          }
          return (
            <>
              <div className="group-title">Game</div>
              <Row label="Template">
                <Select
                  value={tpl.id}
                  onChange={(v) => patchElement(id, { game: { ...(el.game ?? { params: {} }), templateId: v, params: {} } })}
                  options={GAME_TEMPLATES.map((t) => ({ value: t.id, label: t.label }))}
                />
              </Row>
              {tpl.paramFields.map(renderField)}
              {(tpl.assetSlots ?? []).map((slot) => {
                if (slot.list) {
                  const n = Number(params[slot.countParam ?? '']) || 0
                  const arr = Array.isArray(params[slot.key]) ? (params[slot.key] as string[]) : []
                  return (
                    <div key={slot.key}>
                      <div className="group-title2">{slot.label}</div>
                      {Array.from({ length: n }).map((_, i) => (
                        <AssetPicker
                          key={i}
                          label={`${slot.label} ${i + 1}`}
                          value={arr[i] || undefined}
                          allowNone
                          accept={slot.accept}
                          onChange={(aid) => {
                            const next = arr.slice()
                            next[i] = aid ?? ''
                            setParam(slot.key, next)
                          }}
                        />
                      ))}
                    </div>
                  )
                }
                return (
                  <AssetPicker
                    key={slot.key}
                    label={slot.label}
                    value={(params[slot.key] as string) || undefined}
                    allowNone
                    accept={slot.accept}
                    onChange={(aid) => setParam(slot.key, aid ?? '')}
                  />
                )
              })}
              <NumField label="Hint after (ms)" value={el.game?.hintIdleMs ?? 4000} step={500} onChange={(n) => patchElement(id, { game: { ...(el.game ?? { templateId: tpl.id, params: {} }), hintIdleMs: n } })} />
              <div className="hint pad">Games are interactive in Preview/export; the canvas shows a static layout. Mark a CTA/text “Show on game win” to reveal it on win.</div>
            </>
          )
        })()}

      {el.type === 'image' && (
        <>
          <div className="group-title">Image</div>
          <AssetPicker label="Source" value={el.assetId} onChange={(aid) => patchElement(id, { assetId: aid })} />
        </>
      )}

      {el.type === 'bar' && (
        <>
          <div className="group-title">Fill</div>
          <AssetPicker label="Image fill (optional)" value={el.assetId} allowNone onChange={(aid) => patchElement(id, { assetId: aid })} />
          <Swatches label="Color (if no image)" value={el.bar?.color} onChange={(c) => patchElement(id, { bar: { color: c ?? '#1b2a4a' } })} />
          {el.mode === 'extend' && (
            <Row label="Pin to edge">
              <Select
                value={el.pin ?? 'none'}
                onChange={(v) => patchElement(id, { pin: v === 'none' ? undefined : (v as 'top' | 'bottom') })}
                options={[
                  { value: 'none', label: 'none' },
                  { value: 'top', label: 'top' },
                  { value: 'bottom', label: 'bottom' },
                ]}
              />
            </Row>
          )}
        </>
      )}

      {el.type === 'handguide' &&
        (() => {
          const hg: HandguideConfig = el.handguide ?? { mode: 'smart' }
          const setHg = (patch: Partial<HandguideConfig>): void => patchElement(id, { handguide: { ...hg, ...patch } })
          return (
            <>
              <div className="group-title">Hand guide</div>
              <AssetPicker label="Hand image" value={el.assetId} onChange={(aid) => patchElement(id, { assetId: aid })} />
              <Row label="Animation">
                <Select
                  value={hg.mode}
                  onChange={(v) => setHg({ mode: v as HandguideConfig['mode'] })}
                  options={[
                    { value: 'smart', label: 'Smart (auto-point at CTA / game)' },
                    { value: 'tap', label: 'Tap (bounce in place)' },
                    { value: 'slide', label: 'Slide along a path' },
                  ]}
                />
              </Row>
              {hg.mode === 'slide' &&
                (() => {
                  const nodes: HandguideNode[] = hg.nodes && hg.nodes.length ? hg.nodes : hg.toX != null && hg.toY != null ? [{ x: hg.toX, y: hg.toY }] : []
                  const setNodes = (ns: HandguideNode[]): void => setHg({ nodes: ns, toX: undefined, toY: undefined })
                  return (
                    <>
                      <div className="grid2">
                        <button className="wide" onClick={() => startPathDraw(id)}>{nodes.length ? 'Redraw path' : 'Draw path'}</button>
                        <button className="wide" disabled={!nodes.length} onClick={() => setHg({ nodes: undefined, toX: undefined, toY: undefined })}>Clear path</button>
                      </div>
                      {nodes.length ? (
                        <div className="hg-nodes">
                          <div className="hg-node-row start">
                            <span className="hg-node-idx">S</span>
                            <span className="hint">Start ({Math.round(el.x)}, {Math.round(el.y)})</span>
                          </div>
                          {nodes.map((nd, i) => (
                            <div className="hg-node-row" key={i}>
                              <span className="hg-node-idx">{i + 1}</span>
                              <span className="hint">({Math.round(nd.x)}, {Math.round(nd.y)})</span>
                              <NumField label="Stop ms" value={nd.pauseMs ?? 0} step={100} min={0} onChange={(n) => setNodes(nodes.map((x, j) => (j === i ? { ...x, pauseMs: n } : x)))} />
                              <button className="icon-btn" title="Remove node" disabled={nodes.length <= 1} onClick={() => setNodes(nodes.filter((_, j) => j !== i))}>
                                <Icon icon={X} size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="hint pad">Click “Draw path”, then click on the canvas to drop the start and each waypoint. Double-click or press Enter to finish; Esc cancels.</div>
                      )}
                    </>
                  )
                })()}
              <Row label="Easing">
                <Select
                  value={hg.easing ?? 'ease-in-out'}
                  onChange={(v) => setHg({ easing: v as NonNullable<HandguideConfig['easing']> })}
                  options={[
                    { value: 'linear', label: 'Linear' },
                    { value: 'ease', label: 'Ease' },
                    { value: 'ease-in', label: 'Ease in' },
                    { value: 'ease-out', label: 'Ease out' },
                    { value: 'ease-in-out', label: 'Ease in-out' },
                  ]}
                />
              </Row>
              <NumField label="Loop speed (ms)" value={hg.periodMs ?? (hg.mode === 'tap' ? 900 : 1500)} step={100} min={300} onChange={(n) => setHg({ periodMs: n })} />
              <div className="hint pad">Animates in Preview and export.</div>
            </>
          )
        })()}

      {el.type === 'choice' &&
        (() => {
          const ch = el.choice ?? {}
          const setCh = (patch: Partial<typeof ch>): void => patchElement(id, { choice: { ...ch, ...patch } })
          return (
            <>
              <div className="group-title">Choice</div>
              <Toggle label="Continue / next button" checked={!!ch.advance} onChange={(v) => setCh({ advance: v })} />
              {ch.advance ? (
                <NumField label="Advance delay (ms)" value={ch.advanceDelayMs ?? 0} step={100} min={0} onChange={(n) => setCh({ advanceDelayMs: n })} />
              ) : (
                <>
                  <Row label="Group">
                    <input className="text-input" value={ch.group ?? ''} placeholder="e.g. q1" onChange={(e) => setCh({ group: e.target.value || undefined })} />
                  </Row>
                  <div className="hint pad">Options sharing a Group are mutually exclusive (one selected at a time).</div>
                  <Toggle label="Quiz feedback (right/wrong)" checked={!!ch.feedback} onChange={(v) => setCh({ feedback: v })} />
                  {ch.feedback && <Toggle label="This is the correct answer" checked={!!ch.correct} onChange={(v) => setCh({ correct: v })} />}
                  <div className="grid2">
                    <ColorField label={ch.feedback ? 'Correct' : 'Selected'} value={ch.feedback ? ch.correctColor ?? '#22c55e' : ch.selectColor ?? '#7c3aed'} onChange={(c) => setCh(ch.feedback ? { correctColor: c ?? '#22c55e' } : { selectColor: c ?? '#7c3aed' })} />
                    {ch.feedback && <ColorField label="Wrong" value={ch.wrongColor ?? '#ef4444'} onChange={(c) => setCh({ wrongColor: c ?? '#ef4444' })} />}
                  </div>
                </>
              )}
              <div className="hint pad">Selecting and advancing run in Preview and export.</div>
            </>
          )
        })()}

      {el.type === 'countdown' &&
        (() => {
          const cfg: CountdownConfig = el.countdown ?? { mode: 'dynamic', dynamicDays: 1, format: '{hh}:{mm}:{ss}' }
          const setCd = (patch: Partial<CountdownConfig>): void => patchElement(id, { countdown: { ...cfg, ...patch } })
          return (
            <>
              <div className="group-title">Countdown / dynamic date</div>
              <Row label="Mode">
                <Select
                  value={cfg.mode}
                  onChange={(v) => setCd({ mode: v as CountdownConfig['mode'] })}
                  options={[
                    { value: 'dynamic', label: 'dynamic (now + days)' },
                    { value: 'timer', label: 'timer (countdown)' },
                    { value: 'date', label: 'fixed date' },
                  ]}
                />
              </Row>
              {cfg.mode === 'dynamic' && (
                <NumField label="Days from now" value={cfg.dynamicDays ?? 1} step={1} min={0} onChange={(n) => setCd({ dynamicDays: n })} />
              )}
              {cfg.mode === 'timer' && (
                <NumField label="Seconds" value={cfg.seconds ?? 3600} step={60} min={0} onChange={(n) => setCd({ seconds: n })} />
              )}
              {cfg.mode === 'date' && (
                <Row label="Target date/time">
                  <input
                    type="datetime-local"
                    value={(cfg.targetIso ?? '').slice(0, 16)}
                    onChange={(e) => setCd({ targetIso: e.target.value ? new Date(e.target.value).toISOString() : '' })}
                  />
                </Row>
              )}
              <Row label="Format">
                <input value={cfg.format} onChange={(e) => setCd({ format: e.target.value })} placeholder="{hh}:{mm}:{ss}" />
              </Row>
              {cfg.format.includes('{date}') && (
                <Row label="Date style">
                  <Select
                    value={cfg.dateStyle ?? 'short'}
                    onChange={(v) => setCd({ dateStyle: v as CountdownConfig['dateStyle'] })}
                    options={[
                      { value: 'short', label: 'Jun 24, 2026' },
                      { value: 'long', label: 'June 24, 2026' },
                      { value: 'numeric', label: '2026/06/24' },
                    ]}
                  />
                </Row>
              )}
              <div className="hint pad">
                <b>Timer</b> tokens (live): <b>{'{hh}:{mm}:{ss}'}</b> / <b>{'{d} {h} {m} {s}'}</b>. <b>Date</b> label (no ticking):{' '}
                <b>{'{date}'}</b>, e.g. “Order by {'{date}'}”. “Dynamic” recomputes from today whenever the ad runs.
              </div>
            </>
          )
        })()}

      {hasTextStyle && el.text && (
        <>
          <div className="group-title">Text</div>
          {el.type !== 'countdown' && (
            <Row label="Value">
              <textarea value={el.text.value} rows={2} onChange={(e) => setText({ value: e.target.value })} />
            </Row>
          )}
          <div className="grid2">
            <NumField label="Size" value={el.text.fontSizePx} onChange={(n) => setText({ fontSizePx: n })} />
            <NumField label="Weight" value={el.text.fontWeight ?? 700} step={100} onChange={(n) => setText({ fontWeight: n })} />
          </div>
          <Swatches label="Text color" value={el.text.color} onChange={(c) => setText({ color: c ?? '#ffffff' })} />
          <Row label="Align">
            <Select
              value={el.text.align ?? 'center'}
              onChange={(v) => setText({ align: v as TextConfig['align'] })}
              options={[
                { value: 'left', label: 'left' },
                { value: 'center', label: 'center' },
                { value: 'right', label: 'right' },
              ]}
            />
          </Row>
          <div className="grid2">
            <NumField label="Stroke px" value={el.text.strokePx ?? 0} onChange={(n) => setText({ strokePx: n })} />
            <ColorField label="Stroke col" value={el.text.strokeColor ?? '#000000'} onChange={(c) => setText({ strokeColor: c ?? '#000000' })} />
          </div>
        </>
      )}

      {el.type === 'cta' && (
        <Row label="Pulse">
          <Select
            value={el.cta?.pulse ?? 'medium'}
            onChange={(v) => patchElement(id, { cta: { ...(el.cta ?? { pulse: 'medium' }), pulse: v as CtaPulsePreset } })}
            options={[
              { value: 'calm', label: 'calm' },
              { value: 'medium', label: 'medium' },
              { value: 'strong', label: 'strong' },
            ]}
          />
        </Row>
      )}

      {el.type === 'background' && (
        <>
          <div className="group-title">Background</div>
          <AssetPicker label="Image" value={el.assetId} onChange={(aid) => patchElement(id, { assetId: aid })} />
          <Row label="Fit">
            <Select
              value={el.background?.objectFit ?? 'cover'}
              onChange={(v) => patchElement(id, { background: { objectFit: v as 'cover' | 'contain' } })}
              options={[
                { value: 'cover', label: 'cover' },
                { value: 'contain', label: 'contain' },
              ]}
            />
          </Row>
        </>
      )}

      {el.type === 'endscene' &&
        (() => {
          const cfg: EndsceneConfig = el.endscene ?? { objectFit: 'cover', bgColor: '#000000' }
          const setEnd = (patch: Partial<EndsceneConfig>): void => patchElement(id, { endscene: { ...cfg, ...patch } })
          return (
            <>
              <div className="group-title">Endscene video</div>
              <AssetPicker label="Portrait video" accept="video" allowNone value={cfg.portraitVideoId} onChange={(aid) => setEnd({ portraitVideoId: aid })} />
              <AssetPicker label="Landscape video (optional)" accept="video" allowNone value={cfg.landscapeVideoId} onChange={(aid) => setEnd({ landscapeVideoId: aid })} />
              <div className="group-title2">Image fallback (used if no video)</div>
              <AssetPicker label="Portrait image" allowNone value={cfg.portraitImageId} onChange={(aid) => setEnd({ portraitImageId: aid })} />
              <AssetPicker label="Landscape image (optional)" allowNone value={cfg.landscapeImageId} onChange={(aid) => setEnd({ landscapeImageId: aid })} />
              <Row label="Fit">
                <Select
                  value={cfg.objectFit}
                  onChange={(v) => setEnd({ objectFit: v as ObjectFit })}
                  options={[
                    { value: 'cover', label: 'cover (fill, may crop)' },
                    { value: 'contain', label: 'contain (letterbox)' },
                  ]}
                />
              </Row>
              {cfg.objectFit === 'contain' && (
                <>
                  <div className="group-title2">Portrait letterbox fill</div>
                  <Toggle
                    label="Split (top / bottom)"
                    checked={cfg.bgColor2 != null}
                    onChange={(v) => setEnd({ bgColor2: v ? (cfg.bgColor2 ?? cfg.bgColor ?? '#000000') : undefined })}
                  />
                  <ColorField label={cfg.bgColor2 != null ? 'Top' : 'Fill colour'} value={cfg.bgColor || '#000000'} onChange={(c) => setEnd({ bgColor: c ?? '#000000' })} />
                  {cfg.bgColor2 != null && (
                    <ColorField label="Bottom" value={cfg.bgColor2 || '#000000'} onChange={(c) => setEnd({ bgColor2: c ?? '#000000' })} />
                  )}

                  <div className="group-title2">Landscape letterbox fill</div>
                  <Toggle
                    label="Split (left / right)"
                    checked={cfg.bgColorL2 != null}
                    onChange={(v) => setEnd({ bgColorL2: v ? (cfg.bgColorL2 ?? cfg.bgColorL ?? cfg.bgColor ?? '#000000') : undefined })}
                  />
                  <ColorField label={cfg.bgColorL2 != null ? 'Left' : 'Fill colour'} value={cfg.bgColorL ?? cfg.bgColor ?? '#000000'} onChange={(c) => setEnd({ bgColorL: c ?? '#000000' })} />
                  {cfg.bgColorL2 != null && (
                    <ColorField label="Right" value={cfg.bgColorL2 || '#000000'} onChange={(c) => setEnd({ bgColorL2: c ?? '#000000' })} />
                  )}

                  <Toggle label="Match fill to clip edge(s)" checked={!!cfg.matchBgEdge} onChange={(v) => setEnd({ matchBgEdge: v })} />
                </>
              )}
              <Toggle label="Loop" checked={cfg.loop ?? true} onChange={(v) => setEnd({ loop: v })} />
              <div className="hint pad">
                Full-bleed by default; the clip auto-plays muted and tapping anywhere fires the CTA. For extreme aspect ratios use
                “contain” + <b>split fill</b> so the top/bottom (portrait) or left/right (landscape) bars match each edge. Turn on
                “match to edge(s)” to auto-sample them from the clip. Add a CTA/text element on top for the button.
              </div>
            </>
          )
        })()}

      {hasTextStyle && (
        <Accordion id="inspector.box" title="Background box" defaultOpen={false}>
          <Chips
            items={BOX_PRESETS.map((p) => ({
              key: p.key,
              label: p.label,
              active: JSON.stringify(el.box ?? null) === JSON.stringify(p.box ?? null),
              onClick: () => patchElement(id, { box: p.box }),
            }))}
          />
          <Swatches label="Fill" value={el.box?.bgColor} allowNone onChange={(c) => setBox({ bgColor: c })} />
          <Toggle label="Pill (full round)" checked={!!el.box?.pill} onChange={(v) => setBox({ pill: v })} />
          {!el.box?.pill && <Slider label="Corner radius" value={el.box?.radiusPx ?? 0} min={0} max={140} onChange={(n) => setBox({ radiusPx: n })} />}
          <Slider label="Padding X" value={el.box?.paddingXPx ?? 0} min={0} max={160} onChange={(n) => setBox({ paddingXPx: n })} />
          <Slider label="Padding Y" value={el.box?.paddingYPx ?? 0} min={0} max={160} onChange={(n) => setBox({ paddingYPx: n })} />
          <div className="group-title2">Shadow</div>
          <Chips
            items={(['none', 'soft', 'medium', 'strong'] as ShadowPreset[]).map((s) => ({
              key: s,
              label: s,
              active: (el.box?.shadow ?? 'none') === s,
              onClick: () => setBox({ shadow: s }),
            }))}
          />
          <div className="grid2">
            <NumField label="Border px" value={el.box?.borderPx ?? 0} onChange={(n) => setBox({ borderPx: n })} />
            <ColorField label="Border col" value={el.box?.borderColor ?? '#000000'} onChange={(c) => setBox({ borderColor: c ?? '#000000' })} />
          </div>
          <Slider label="Opacity" value={(el.opacity ?? 1) * 100} min={10} max={100} suffix="%" onChange={(n) => patchElement(id, { opacity: n / 100 })} />
          {el.type === 'text' && (
            <div className="grid2">
              <NumField label="Box W (0=auto)" value={el.w ?? 0} onChange={(n) => patchGeometry(id, { w: n > 0 ? n : undefined })} />
              <NumField label="Box H (0=auto)" value={el.h ?? 0} onChange={(n) => patchGeometry(id, { h: n > 0 ? n : undefined })} />
            </div>
          )}
        </Accordion>
      )}

      <Accordion id="inspector.animation" title="Animation" defaultOpen={false}>
        <AnimRow
          title="Entrance"
          trigger
          spec={el.animations?.entrance}
          presets={ENTRANCE_PRESETS}
          defaultSpec={{ preset: 'fade', durationMs: 450, delayMs: 0, easing: 'ease-out', trigger: 'onMount' }}
          onChange={(s) => patchElement(id, { animations: { ...(el.animations ?? {}), entrance: s } })}
        />
        <AnimRow
          title="Loop"
          spec={el.animations?.loop}
          presets={LOOP_PRESETS}
          defaultSpec={{ preset: 'float', durationMs: 2200, delayMs: 0, easing: 'ease-in-out', iterations: 'infinite' }}
          onChange={(s) => patchElement(id, { animations: { ...(el.animations ?? {}), loop: s } })}
        />
        <AnimRow
          title="Exit"
          spec={el.animations?.exit}
          presets={EXIT_PRESETS}
          defaultSpec={{ preset: 'fade-out', durationMs: 300, delayMs: 0, easing: 'ease-in' }}
          onChange={(s) => patchElement(id, { animations: { ...(el.animations ?? {}), exit: s } })}
        />
        <div className="hint pad">
          Loops preview live on the canvas. Entrance &amp; exit play in Preview/export (use Preview to watch). A CTA pulses by
          default; set a Loop here to override it.
        </div>
      </Accordion>

      <Accordion id="inspector.sound" title="Sound" defaultOpen={false}>
        <ElementSound el={el} />
      </Accordion>

      <div className="group-title" />
      <StyleButtons />
      <button className="wide" onClick={duplicateSelected}>
        Duplicate (Ctrl+D)
      </button>
      <button className="wide danger" onClick={removeSelected}>
        Delete
      </button>
    </div>
  )
}
