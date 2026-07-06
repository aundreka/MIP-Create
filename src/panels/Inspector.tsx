// Inspector — project meta (no selection), a multi-select panel, or the full
// single-element editor with a visual Background-box section.

import { useState, useEffect } from 'react'
import type { Anchor, AdvanceOn, AnimPresetId, AnimSpec, AnimTrigger, BackgroundConfig, BoxStyle, CountdownConfig, CtaPulsePreset, EndsceneConfig, HandguideConfig, HandguideNode, KeyframeStep, LayoutMode, ObjectFit, SceneElement, SceneKind, SceneOverlay, SfxBinding, ShadowPreset, TextConfig, TransitionType, UnboxingConfig } from '../../runtime/scene'
import { GAME_TEMPLATES } from '../../runtime/games/registry'
import type { ParamField } from '../../runtime/games/types'
import { importFont } from '../bridge'
import {
  activeSceneDef,
  addAsset,
  addGameHint,
  alignSelected,
  convertElement,
  copyStyle,
  duplicateSelected,
  groupSelected,
  pasteStyle,
  patchElement,
  patchGeometry,
  patchSceneDef,
  refreshScene,
  removeSelected,
  setSceneBg,
  setSceneBg2,
  setSyncScope,
  setTrace,
  singleSelected,
  toggleLock,
  toggleSyncToProject,
  ungroupSelected,
  useEditorState,
  type AlignOp,
  type ConvertTo,
} from '../store'
import { Accordion, Chips, ColorField, NumField, Row, Select, Slider, Swatches, Toggle } from '../ui'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Icon,
  type LucideIcon,
  Upload,
  Volume2,
  X,
} from '../icons'
import { AssetPicker } from './AssetPicker'
import { SfxLibrary } from './SfxLibrary'
import { startPathDraw } from '../drawMode'
import { useEditLocale } from '../locale'
import { setActiveVariant, useActiveVariant } from '../variantMode'
import { KeyframeEditor } from './KeyframeEditor'

const ANCHORS: Anchor[] = ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right']


// Per-element sounds: bind a sound (built-in library or upload) to a trigger.
// "Add sound" opens the sound library directly so the library is easy to find and
// the button visibly does something.
function ElementSound(props: { el: SceneElement }): JSX.Element {
  const { el } = props
  const { assets } = useEditorState()
  const [chooser, setChooser] = useState<number | null>(null) // binding index being chosen (>= length = new)
  const binds = el.sfx ?? []
  const setBinds = (b: SfxBinding[]): void => patchElement(el.id, { sfx: b.length ? b : undefined })
  // Trigger options grow with the element: scratch covers add a looped "while
  // scratching" sound; reveal targets add a "when revealed" one-shot.
  const isScratching = el.scratch || el.game?.templateId === 'scratch' || el.game?.templateId === 'scratch_grid'
  const eventOptions = [
    { value: 'tap', label: 'On tap' },
    { value: 'sceneEnter', label: 'On scene enter' },
    ...(isScratching ? [{ value: 'whileScratching', label: 'While scratching (loop)' }] : []),
    ...(isScratching || el.reveal ? [{ value: 'onReveal', label: 'When revealed / win' }] : []),
    ...(el.type === 'unboxing' ? [
      { value: 'onReveal', label: 'On reveal' },
      { value: 'onWin', label: 'On win' },
      { value: 'onLose', label: 'On lose' },
    ] : []),
  ]
  const defaultEvent = el.reveal ? 'onReveal' : isScratching ? 'whileScratching' : 'tap'
  const pick = (assetId: string): void => {
    if (chooser == null) return
    if (chooser >= binds.length) setBinds([...binds, { event: defaultEvent, assetId }])
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
            value={b.event || 'tap'}
            onChange={(v) => setBinds(binds.map((x, j) => (j === i ? { ...x, event: v } : x)))}
            options={eventOptions}
          />
          <button className="icon-btn" title="Remove" onClick={() => setBinds(binds.filter((_, j) => j !== i))}>
            <Icon icon={X} size={13} />
          </button>
        </div>
      ))}
      <button className="wide" onClick={() => setChooser(binds.length)}>
        <Icon icon={Volume2} size={14} /> Add sound
      </button>
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

// ---- mystery-box-grid inspector --------------------------------------------
type UnboxPieceKey = 'back' | 'front' | 'top'

function PiecePlacement({ label, pieceKey, el }: { label: string; pieceKey: UnboxPieceKey; el: SceneElement }): JSX.Element {
  const cfg = el.unboxing ?? {}
  const piece = cfg[pieceKey] ?? {}
  const set = (patch: Partial<UnboxingConfig[UnboxPieceKey]>): void =>
    patchElement(el.id, { unboxing: { ...cfg, [pieceKey]: { ...piece, ...patch } } })
  const isLid = pieceKey === 'top'

  return (
    <>
      <div className="group-title2">{label}</div>
      <AssetPicker label="Image" allowNone value={piece.assetId} onChange={(aid) => set({ assetId: aid ?? undefined })} />
      <div className="grid2">
        <NumField label="Center X %" value={piece.x ?? 50} step={1} onChange={(n) => set({ x: n })} />
        <NumField label="Center Y %" value={piece.y ?? (isLid ? 20 : 55)} step={1} onChange={(n) => set({ y: n })} />
      </div>
      <div className="grid2">
        <NumField label="Width %" value={piece.w ?? 100} step={2} min={1} max={200} onChange={(n) => set({ w: n })} />
        <NumField label="Rotation °" value={piece.rotation ?? 0} step={1} onChange={(n) => set({ rotation: n })} />
      </div>
      {isLid && (
        <>
          <div className="group-title2" style={{ marginTop: 4 }}>Lid end position</div>
          <div className="grid2">
            <NumField label="End X %" value={piece.endX ?? 60} step={2} onChange={(n) => set({ endX: n })} />
            <NumField label="End Y %" value={piece.endY ?? -35} step={2} onChange={(n) => set({ endY: n })} />
          </div>
          <div className="grid2">
            <NumField label="End °" value={piece.endRotation ?? -35} step={5} onChange={(n) => set({ endRotation: n })} />
            <NumField label="End α" value={piece.endOpacity ?? 0} step={0.1} min={0} max={1} onChange={(n) => set({ endOpacity: n })} />
          </div>
          <NumField label="Duration ms" value={piece.durationMs ?? 700} step={50} min={0} onChange={(n) => set({ durationMs: n })} />
        </>
      )}
    </>
  )
}

function UnboxingInspector({ el }: { el: SceneElement }): JSX.Element {
  const cfg = el.unboxing ?? {}
  const set = (patch: Partial<UnboxingConfig>): void =>
    patchElement(el.id, { unboxing: { ...cfg, ...patch } })
  const hasLose = !!cfg.loseAssetId

  return (
    <Accordion id="inspector.unboxing" title="Mystery Box">
      <div className="group-title2">Grid</div>
      <div className="grid2">
        <NumField label="Columns" value={cfg.cols ?? 2} step={1} min={1} max={6} onChange={(n) => {
          const newCount = n * (cfg.rows ?? 2)
          const cells = cfg.cells ? Array.from({ length: newCount }, (_, i): 'win' | 'lose' => cfg.cells![i] ?? 'win') : undefined
          set({ cols: n, ...(cells ? { cells } : {}) })
        }} />
        <NumField label="Rows" value={cfg.rows ?? 2} step={1} min={1} max={6} onChange={(n) => {
          const newCount = (cfg.cols ?? 2) * n
          const cells = cfg.cells ? Array.from({ length: newCount }, (_, i): 'win' | 'lose' => cfg.cells![i] ?? 'win') : undefined
          set({ rows: n, ...(cells ? { cells } : {}) })
        }} />
      </div>
      <div className="grid2">
        <NumField label="Col gap px" value={cfg.colGap ?? 24} step={4} min={0} onChange={(n) => set({ colGap: n })} />
        <NumField label="Row gap px" value={cfg.rowGap ?? 24} step={4} min={0} onChange={(n) => set({ rowGap: n })} />
      </div>

      <div className="group-title2">Background (static)</div>
      <AssetPicker label="Image" allowNone value={cfg.bgAssetId} onChange={(aid) => set({ bgAssetId: aid ?? undefined })} />
      <div className="grid2">
        <NumField label="Scale ×" value={cfg.bgScale ?? 1} step={0.05} onChange={(n) => set({ bgScale: n })} />
        <NumField label="X px" value={cfg.bgX ?? 0} step={10} onChange={(n) => set({ bgX: n })} />
      </div>
      <NumField label="Y px" value={cfg.bgY ?? 0} step={10} onChange={(n) => set({ bgY: n })} />

      <PiecePlacement label="Back face (z1, static)" pieceKey="back" el={el} />
      <PiecePlacement label="Front face (z3, occludes product)" pieceKey="front" el={el} />
      <PiecePlacement label="Lid (z4, flies off on reveal)" pieceKey="top" el={el} />

      <div className="group-title2">Product (inside box, z2)</div>
      <AssetPicker label="Win image" allowNone value={cfg.winAssetId} onChange={(aid) => set({ winAssetId: aid ?? undefined })} />
      <div className="group-title2" style={{ marginTop: 4 }}>Win product start</div>
      <div className="grid2">
        <NumField label="Start X %" value={cfg.productStartX ?? (cfg.productX ?? 50)} step={2} onChange={(n) => set({ productStartX: n })} />
        <NumField label="Start Y %" value={cfg.productStartY ?? 120} step={2} onChange={(n) => set({ productStartY: n })} />
      </div>
      <div className="group-title2" style={{ marginTop: 4 }}>Win product end</div>
      <div className="grid2">
        <NumField label="End X %" value={cfg.productX ?? 50} step={2} onChange={(n) => set({ productX: n })} />
        <NumField label="End Y %" value={cfg.productY ?? 28} step={2} onChange={(n) => set({ productY: n })} />
      </div>
      <NumField label="Width %" value={cfg.productW ?? 65} step={2} min={1} onChange={(n) => set({ productW: n })} />
      <NumField label="Rise ms" value={cfg.productDurationMs ?? 900} step={50} min={0} onChange={(n) => set({ productDurationMs: n })} />

      <AssetPicker label="Lose image (optional)" allowNone value={cfg.loseAssetId} onChange={(aid) => set({ loseAssetId: aid ?? undefined })} />
      {hasLose && <>
        <div className="group-title2" style={{ marginTop: 4 }}>Lose product start</div>
        <div className="grid2">
          <NumField label="Start X %" value={cfg.loseProductStartX ?? cfg.productStartX ?? (cfg.productX ?? 50)} step={2} onChange={(n) => set({ loseProductStartX: n })} />
          <NumField label="Start Y %" value={cfg.loseProductStartY ?? cfg.productStartY ?? 120} step={2} onChange={(n) => set({ loseProductStartY: n })} />
        </div>
        <div className="group-title2" style={{ marginTop: 4 }}>Lose product end</div>
        <div className="grid2">
          <NumField label="End X %" value={cfg.loseProductX ?? cfg.productX ?? 50} step={2} onChange={(n) => set({ loseProductX: n })} />
          <NumField label="End Y %" value={cfg.loseProductY ?? cfg.productY ?? 28} step={2} onChange={(n) => set({ loseProductY: n })} />
        </div>
        <NumField label="Width %" value={cfg.loseProductW ?? cfg.productW ?? 65} step={2} min={1} onChange={(n) => set({ loseProductW: n })} />
      </>}

      {hasLose && (() => {
        const cols = cfg.cols ?? 2
        const rows = cfg.rows ?? 2
        const count = cols * rows
        const rawCells = cfg.cells
        // Normalize to current grid size (pad with 'win', truncate if shrunk)
        const cells: Array<'win' | 'lose'> | undefined = rawCells
          ? Array.from({ length: count }, (_, i) => rawCells[i] ?? 'win')
          : undefined
        const assignMode = !!cells && !cfg.randomize
        const randomMode = !!cfg.randomize

        const setMode = (mode: 'always' | 'assign' | 'random'): void => {
          if (mode === 'always') set({ randomize: false, cells: undefined })
          else if (mode === 'random') set({ randomize: true, cells: undefined })
          else {
            const arr = rawCells?.length === count
              ? rawCells
              : Array.from({ length: count }, (_, i): 'win' | 'lose' => i % 2 === 0 ? 'win' : 'lose')
            set({ randomize: false, cells: arr as Array<'win' | 'lose'> })
          }
        }

        return (
          <>
            <div className="group-title2">Outcome mode</div>
            <Chips
              items={[
                { key: 'always', label: 'Always win', active: !randomMode && !assignMode, onClick: () => setMode('always') },
                { key: 'assign', label: 'Per box', active: assignMode, onClick: () => setMode('assign') },
                { key: 'random', label: 'Random', active: randomMode, onClick: () => setMode('random') },
              ]}
            />
            {randomMode && (
              <Slider label={`Win chance: ${cfg.winChance ?? 50}%`} value={cfg.winChance ?? 50} min={0} max={100} step={5} onChange={(n) => set({ winChance: n })} />
            )}
            {assignMode && cells && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4, margin: '6px 0 2px' }}>
                  {cells.map((outcome, i) => (
                    <button
                      key={i}
                      style={{
                        padding: '5px 0',
                        background: outcome === 'win' ? '#16a34a' : '#dc2626',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontWeight: 700,
                        fontSize: 11,
                        letterSpacing: '0.04em',
                      }}
                      onClick={() => {
                        const next = [...cells]
                        next[i] = next[i] === 'win' ? 'lose' : 'win'
                        set({ cells: next as Array<'win' | 'lose'> })
                      }}
                    >
                      {outcome === 'win' ? 'W' : 'L'}
                    </button>
                  ))}
                </div>
                <button
                  className="wide"
                  style={{ marginTop: 2 }}
                  onClick={() => {
                    const arr: Array<'win' | 'lose'> = Array.from({ length: count }, (_, i) => (i < Math.round(count / 2) ? 'win' : 'lose'))
                    for (let i = arr.length - 1; i > 0; i--) {
                      const j = Math.floor(Math.random() * (i + 1))
                      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
                    }
                    set({ cells: arr })
                  }}
                >
                  Shuffle equally
                </button>
              </>
            )}
          </>
        )
      })()}

      <div className="group-title2">On reveal: sync scene image</div>
      <Select
        label="Scene element"
        value={cfg.revealSyncElementId ?? ''}
        onChange={(v) => set({ revealSyncElementId: v || undefined })}
        options={[
          { value: '', label: '(none)' },
          ...(activeSceneDef()?.elements ?? [])
            .filter((e) => e.type === 'image' && e.id !== el.id)
            .map((e) => ({ value: e.id, label: e.name })),
        ]}
      />
      {cfg.revealSyncElementId && (
        <AssetPicker label="Swap to asset" allowNone value={cfg.revealSyncAssetId} onChange={(aid) => set({ revealSyncAssetId: aid ?? undefined })} />
      )}

      <div className="group-title2">Timing</div>
      <NumField label="Centered box size %" value={cfg.centerSize ?? 65} step={5} min={10} max={150} onChange={(n) => set({ centerSize: n })} />
      <div className="grid2">
        <NumField label="Offset X px" value={cfg.centerX ?? 0} step={10} onChange={(n) => set({ centerX: n })} />
        <NumField label="Offset Y px" value={cfg.centerY ?? 0} step={10} onChange={(n) => set({ centerY: n })} />
      </div>
      <NumField label="Fly to center ms" value={cfg.selectMs ?? 450} step={50} min={0} onChange={(n) => set({ selectMs: n })} />
    </Accordion>
  )
}

function StyleButtons(): JSX.Element {
  return (
    <div className="grid2 wide">
      <button onClick={copyStyle}>Copy style</button>
      <button onClick={pasteStyle}>Paste style</button>
    </div>
  )
}

// ---- animation sub-panel ---------------------------------------------------
// value = the CSS timing function; label = friendly name. "spring" overshoots and
// settles (a slight bounce) — pair it with fade/loop presets that don't already
// bake in an overshoot, since the slide/pop entrances have their own settle.
const EASINGS: { value: string; label: string }[] = [
  { value: 'ease-out', label: 'ease out' },
  { value: 'ease-in', label: 'ease in' },
  { value: 'ease-in-out', label: 'ease in-out' },
  { value: 'cubic-bezier(.34,1.56,.64,1)', label: 'spring (bounce)' },
  { value: 'cubic-bezier(.22,1,.36,1)', label: 'smooth' },
  { value: 'ease', label: 'ease' },
  { value: 'linear', label: 'linear' },
]
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
            <Select value={spec.easing} onChange={(v) => patch({ easing: v })} options={EASINGS} />
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

interface ScratchGridCellsProps {
  params: Record<string, unknown>
  setParam: (k: string, v: unknown) => void
  elementId: string
}
function ScratchGridCells({ params, setParam, elementId }: ScratchGridCellsProps): JSX.Element {
  const [activeCell, setActiveCell] = useState(0)
  const { project } = useEditorState()

  useEffect(() => {
    const handler = (e: Event): void => {
      const ce = e as CustomEvent<{ elementId: string; cellIdx: number }>
      if (ce.detail.elementId === elementId) setActiveCell(ce.detail.cellIdx)
    }
    window.addEventListener('pa:grid-cell-select', handler)
    return () => window.removeEventListener('pa:grid-cell-select', handler)
  }, [elementId])

  const cols = Math.max(1, Math.min(4, Number(params.cols ?? 2)))
  const rows = Math.max(1, Math.min(4, Number(params.rows ?? 2)))
  const total = cols * rows
  const safeCell = Math.min(activeCell, total - 1)
  const cellIsWin = (String(params.pattern ?? 'LWWL')[safeCell] ?? 'L').toUpperCase() === 'W'

  const rowLabel = (r: number): string => rows > 1 ? ['top', 'middle', 'lower', 'bottom'][r] ?? `row ${r + 1}` : ''
  const colLabel = (c: number): string => cols > 1 ? ['left', 'center', 'right', 'far-right'][c] ?? `col ${c + 1}` : ''
  const cellName = (i: number): string => {
    const r = Math.floor(i / cols)
    const c = i % cols
    const parts = [rowLabel(r), colLabel(c)].filter(Boolean)
    return `Cell ${i + 1}${parts.length ? ` (${parts.join('-')})` : ''}`
  }

  return (
    <>
      <div className="group-title2">Layout</div>
      <NumField label="Columns" value={Number(params.cols ?? 2)} step={1} min={1} max={4} onChange={(n) => setParam('cols', n)} />
      <NumField label="Rows" value={Number(params.rows ?? 2)} step={1} min={1} max={4} onChange={(n) => setParam('rows', n)} />
      <Row label="Win pattern">
        <input value={String(params.pattern ?? 'LWWL')} onChange={(e) => setParam('pattern', e.target.value)} />
      </Row>
      <NumField label="Outer padding" value={Number(params.gap ?? 10)} step={2} min={0} max={60} onChange={(n) => setParam('gap', n)} />
      <NumField label="Column gap" value={Number(params.colGap ?? params.gap ?? 10)} step={2} min={0} max={60} onChange={(n) => setParam('colGap', n)} />
      <NumField label="Row gap" value={Number(params.rowGap ?? params.gap ?? 10)} step={2} min={0} max={60} onChange={(n) => setParam('rowGap', n)} />
      <NumField label="Reveal threshold" value={Number(params.threshold ?? 0.5)} step={0.05} min={0.2} max={0.9} onChange={(n) => setParam('threshold', n)} />
      <NumField label="Reveal zone left (%, per cell)" value={Number(params.zoneX ?? 0)} step={1} min={0} max={100} onChange={(n) => setParam('zoneX', n)} />
      <NumField label="Reveal zone top (%, per cell)" value={Number(params.zoneY ?? 0)} step={1} min={0} max={100} onChange={(n) => setParam('zoneY', n)} />
      <NumField label="Reveal zone width (%, per cell)" value={Number(params.zoneW ?? 100)} step={1} min={2} max={100} onChange={(n) => setParam('zoneW', n)} />
      <NumField label="Reveal zone height (%, per cell)" value={Number(params.zoneH ?? 100)} step={1} min={2} max={100} onChange={(n) => setParam('zoneH', n)} />
      <button
        className="btn"
        style={{ width: '100%', marginTop: 6 }}
        onClick={() => window.dispatchEvent(new CustomEvent('pa:zone-edit', { detail: { elementId } }))}
      >
        Edit reveal zone on canvas
      </button>
      <div className="hint pad">Only scratching inside the reveal zone counts toward a cell&apos;s threshold — anywhere outside never contributes. The same zone applies to every cell. Drag the box in the first cell to move, corner handles to resize. Esc to finish.</div>
      <ColorField label="Cover color" value={(params.coverColor as string) || undefined} allowNone onChange={(c) => setParam('coverColor', c ?? '')} />
      <ColorField label="Win cell bg" value={(params.winBgColor as string) || undefined} allowNone onChange={(c) => setParam('winBgColor', c ?? '')} />
      <ColorField label="Lose cell bg" value={(params.loseBgColor as string) || undefined} allowNone onChange={(c) => setParam('loseBgColor', c ?? '')} />
      <Row label="Image fit">
        <Select
          value={String(params.imageFit ?? 'cover')}
          onChange={(v) => setParam('imageFit', v)}
          options={[{ value: 'cover', label: 'Cover (fill cell, may crop)' }, { value: 'contain', label: 'Contain (fit whole image, no crop)' }]}
        />
      </Row>

      <div className="group-title2">Scratch surface: double-click a cell on the canvas to select it</div>
      <AssetPicker label="Shared cover (fallback)" value={(params.cover as string) || undefined} allowNone onChange={(aid) => setParam('cover', aid ?? '')} />
      <AssetPicker label="Shared background (all cells)" value={(params.sharedBg as string) || undefined} allowNone onChange={(aid) => setParam('sharedBg', aid ?? '')} />
      <AssetPicker label="Shared text / product overlay (all cells)" value={(params.sharedText as string) || undefined} allowNone onChange={(aid) => setParam('sharedText', aid ?? '')} />

      <div className="group-title2">{cellName(safeCell)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 48px))`, justifyContent: 'start', gap: 4, padding: '6px 0 8px', marginBottom: 2 }}>
        {Array.from({ length: total }, (_, i) => {
          const pat = String(params.pattern ?? 'LWWL')
          const isW = (pat[i] ?? 'L').toUpperCase() === 'W'
          return (
            <button
              key={i}
              className={safeCell === i ? 'on' : ''}
              onClick={() => setActiveCell(i)}
              title={`${cellName(i)}: ${isW ? 'WIN' : 'LOSE'}`}
              style={{ aspectRatio: '1', minHeight: 32, fontSize: 11, fontWeight: 700, borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}
            >
              <span>{i + 1}</span>
              <span style={{ fontSize: 9, opacity: 0.7, color: isW ? '#4ade80' : '#f87171' }}>{isW ? 'WIN' : 'LOSE'}</span>
            </button>
          )
        })}
      </div>
      {(() => {
        const pat = String(params.pattern ?? 'LWWL')
        const isW = (pat[safeCell] ?? 'L').toUpperCase() === 'W'
        const setWinLose = (win: boolean): void => {
          const next = pat.split('').map((c, i) => i === safeCell ? (win ? 'W' : 'L') : c).join('')
          setParam('pattern', next)
        }
        return (
          <Row label="Cell type">
            <Select
              value={isW ? 'W' : 'L'}
              onChange={(v) => setWinLose(v === 'W')}
              options={[{ value: 'W', label: 'Win: advances to win scene' }, { value: 'L', label: 'Lose: navigates to lose scene' }]}
            />
          </Row>
        )
      })()}
      <AssetPicker label="Cell cover (overrides shared)" value={(params[`cell${safeCell}cover`] as string) || undefined} allowNone onChange={(aid) => setParam(`cell${safeCell}cover`, aid ?? '')} />
      <AssetPicker label="Background reveal" value={(params[`cell${safeCell}`] as string) || undefined} allowNone onChange={(aid) => setParam(`cell${safeCell}`, aid ?? '')} />
      <AssetPicker label="Text / product overlay" value={(params[`cell${safeCell}text`] as string) || undefined} allowNone onChange={(aid) => setParam(`cell${safeCell}text`, aid ?? '')} />
      <NumField
        label="Text overlay scale (%)"
        value={Number(params[`cell${safeCell}textScale`] !== '' && params[`cell${safeCell}textScale`] != null ? params[`cell${safeCell}textScale`] : (params.textScale ?? 80))}
        step={5} min={10} max={100}
        onChange={(n) => setParam(`cell${safeCell}textScale`, n)}
      />
      <Row label="Cell label">
        <input value={String(params[`cell${safeCell}Label`] ?? '')} onChange={(e) => setParam(`cell${safeCell}Label`, e.target.value)} />
      </Row>

      <div className="group-title2">Hint path (this cell)</div>
      <div className="hint pad">The hint hand rubs from the start point to the end point. Values are % of the cell (0,0 = top-left). Default is a centered horizontal rub.</div>
      <NumField label="Start X (%)" value={Number(params[`cell${safeCell}hintFromX`] ?? 20)} step={5} min={0} max={100} onChange={(n) => setParam(`cell${safeCell}hintFromX`, n)} />
      <NumField label="Start Y (%)" value={Number(params[`cell${safeCell}hintFromY`] ?? 50)} step={5} min={0} max={100} onChange={(n) => setParam(`cell${safeCell}hintFromY`, n)} />
      <NumField label="End X (%)" value={Number(params[`cell${safeCell}hintToX`] ?? 80)} step={5} min={0} max={100} onChange={(n) => setParam(`cell${safeCell}hintToX`, n)} />
      <NumField label="End Y (%)" value={Number(params[`cell${safeCell}hintToY`] ?? 50)} step={5} min={0} max={100} onChange={(n) => setParam(`cell${safeCell}hintToY`, n)} />

      {cellIsWin && (
        <>
          <div className="hint pad">When this cell wins, it redirects to this scene without flashing back to the game (a normal scene replaces it; an overlay-type scene dims it). That scene’s own Advance then continues to the end scene. Leave blank to use the default below; if no scene is set, falls back to the overlay image.</div>
          <Row label="Cell win scene (redirect)">
            <Select
              value={String(params[`cell${safeCell}winSceneId`] ?? '')}
              onChange={(v) => setParam(`cell${safeCell}winSceneId`, v)}
              options={[{ value: '', label: '(use default below)' }, ...project.scenes.map((s) => ({ value: s.id, label: s.name || s.id }))]}
            />
          </Row>
          <AssetPicker label="Cell win overlay image" value={(params[`cell${safeCell}winOverlayImage`] as string) || undefined} allowNone onChange={(aid) => setParam(`cell${safeCell}winOverlayImage`, aid ?? '')} />
          <NumField
            label="Cell win image duration (ms)"
            value={Number(params[`cell${safeCell}winOverlayDurationMs`] !== '' && params[`cell${safeCell}winOverlayDurationMs`] != null ? params[`cell${safeCell}winOverlayDurationMs`] : (params.winOverlayDurationMs ?? 800))}
            step={100} min={200} max={5000}
            onChange={(n) => setParam(`cell${safeCell}winOverlayDurationMs`, n)}
          />
        </>
      )}

      <div className="group-title2">Type fallbacks</div>
      <Row label="Win label"><input value={String(params.winLabel ?? 'Promo')} onChange={(e) => setParam('winLabel', e.target.value)} /></Row>
      <Row label="Lose label"><input value={String(params.loseLabel ?? 'TRY\nAGAIN')} onChange={(e) => setParam('loseLabel', e.target.value)} /></Row>
      <AssetPicker label="Win bg (fallback)" value={(params.winImage as string) || undefined} allowNone onChange={(aid) => setParam('winImage', aid ?? '')} />
      <AssetPicker label="Lose bg (fallback)" value={(params.loseImage as string) || undefined} allowNone onChange={(aid) => setParam('loseImage', aid ?? '')} />
      <AssetPicker label="Win text overlay (fallback)" value={(params.winTextImage as string) || undefined} allowNone onChange={(aid) => setParam('winTextImage', aid ?? '')} />
      <AssetPicker label="Lose text overlay (fallback)" value={(params.loseTextImage as string) || undefined} allowNone onChange={(aid) => setParam('loseTextImage', aid ?? '')} />
      <NumField label="Text overlay scale (%, default)" value={Number(params.textScale ?? 80)} step={5} min={10} max={100} onChange={(n) => setParam('textScale', n)} />

      <div className="group-title2">Container background</div>
      <AssetPicker label="Background image" value={(params.bgImage as string) || undefined} allowNone onChange={(aid) => setParam('bgImage', aid ?? '')} />
      <NumField label="BG scale (%)" value={Number(params.bgScale ?? 100)} step={5} min={10} max={300} onChange={(n) => setParam('bgScale', n)} />
      <NumField label="BG X (%)" value={Number(params.bgX ?? 50)} step={5} min={0} max={100} onChange={(n) => setParam('bgX', n)} />
      <NumField label="BG Y (%)" value={Number(params.bgY ?? 50)} step={5} min={0} max={100} onChange={(n) => setParam('bgY', n)} />

      <div className="group-title2">Lose &amp; win scenes</div>
      <div className="hint pad">
        Lose: the chosen scene pops up over the game, then dismisses on its own Advance and play resumes. Win: redirects to the chosen scene without flashing back to the game (a normal scene replaces it; an overlay-type scene dims it), and that scene’s own Advance continues to the end scene. If no scene is set, falls back to a plain image overlay. The win scene here is the default; each win cell can override it above.
      </div>
      <Row label="Lose overlay scene">
        <Select
          value={String(params.loseSceneId ?? '')}
          onChange={(v) => setParam('loseSceneId', v)}
          options={[{ value: '', label: '(none, use image below)' }, ...project.scenes.map((s) => ({ value: s.id, label: s.name || s.id }))]}
        />
      </Row>
      <AssetPicker label="Lose overlay image (fallback)" value={(params.loseOverlayImage as string) || undefined} allowNone onChange={(aid) => setParam('loseOverlayImage', aid ?? '')} />
      <NumField label="Lose image duration (ms)" value={Number(params.loseOverlayDurationMs ?? 1500)} step={100} min={200} max={5000} onChange={(n) => setParam('loseOverlayDurationMs', n)} />
      <Row label="Default win scene (redirect)">
        <Select
          value={String(params.winSceneId ?? '')}
          onChange={(v) => setParam('winSceneId', v)}
          options={[{ value: '', label: '(none, use image below)' }, ...project.scenes.map((s) => ({ value: s.id, label: s.name || s.id }))]}
        />
      </Row>
      <AssetPicker label="Default win overlay image" value={(params.winOverlayImage as string) || undefined} allowNone onChange={(aid) => setParam('winOverlayImage', aid ?? '')} />
      <NumField label="Default win image duration (ms)" value={Number(params.winOverlayDurationMs ?? 800)} step={100} min={200} max={5000} onChange={(n) => setParam('winOverlayDurationMs', n)} />
    </>
  )
}

export function Inspector(props: { onProjectSettings: () => void }): JSX.Element {
  const state = useEditorState()
  const editLocale = useEditLocale()
  const activeVariant = useActiveVariant()
  const variantName = state.project.meta.variants?.find((v) => v.id === activeVariant)?.name
  const variantBanner = activeVariant ? (
    <div className="variant-banner">
      Editing variant: <b>{variantName ?? activeVariant}</b>
      <button onClick={() => { setActiveVariant(null); refreshScene() }}>Done</button>
    </div>
  ) : null
  const landscape = state.orientation === 'landscape'

  if (state.selectedIds.length > 1) {
    const anyGroup = state.scene.elements.some((e) => state.selectedIds.includes(e.id) && e.groupId)
    return (
      <div className="panel inspector">
        {variantBanner}
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
        {variantBanner}
        <div className="panel-title">Scene: {sd.name}</div>
        {activeVariant ? (
          <div className="hint pad">
            Scene settings (name, type, background, advance, transition) are <b>base-only</b>; they can"t differ per variant. Click <b>Done</b> above to exit variant mode and edit them.
          </div>
        ) : (
        <>
        <Row label="Scene name">
          <input value={sd.name} onChange={(e) => patchSceneDef(sd.id, { name: e.target.value })} />
        </Row>
        <div className="scene-meta-row">
          <Row label="Type">
            <Select
              value={(sd.kind as string) === 'win' || (sd.kind as string) === 'custom' ? 'overlay' : (sd.kind ?? 'overlay')}
              onChange={(v) => patchSceneDef(sd.id, { kind: v as SceneKind })}
              options={[
                { value: 'game', label: 'game scene' },
                { value: 'overlay', label: 'overlay scene' },
                { value: 'endscene', label: 'endscene' },
              ]}
            />
          </Row>
          <ColorField label={landscape ? 'BG left' : 'BG top'} value={sd.bgColor || undefined} allowNone onChange={(c) => setSceneBg(c ?? '')} />
          <ColorField label={landscape ? 'BG right' : 'BG bottom'} value={sd.bgColor2 || undefined} allowNone onChange={(c) => setSceneBg2(c)} />
        </div>
        {sd.kind === 'endscene' && (
          <div className="hint pad">
            Endscene = MRAID <b>end card</b>: in Preview/export the whole scene is tap-to-install and signals the network the ad
            ended. Add a <b>video endscene</b> element for a video card, or just build it like any scene (product + pulsing CTA) for
            a <b>coded</b> end card; both get the MRAID wrap.
          </div>
        )}

        {(sd.kind === 'overlay' || (sd.kind as string) === 'win' || (sd.kind as string) === 'custom') && (() => {
          const ov: SceneOverlay = sd.overlay ?? {}
          const setOv = (patch: Partial<SceneOverlay>) => patchSceneDef(sd.id, { overlay: { ...ov, ...patch } })
          return (
            <>
              <div className="group-title">Dim / blur overlay</div>
              <div className="hint pad" style={{ marginBottom: 4 }}>
                Full-screen overlay rendered behind all scene elements. Uses an oversized div so edges are
                always off-screen; no edge artifacts on AppLovin.
              </div>
              <Slider label="Dim opacity" value={(ov.opacity ?? 0) * 100} min={0} max={100} step={5} suffix="%" onChange={(n) => setOv({ opacity: n / 100 || undefined })} />
              <ColorField label="Color" value={ov.color ?? '#000000'} onChange={(c) => setOv({ color: c ?? '#000000' })} />
              <NumField label="Blur px" value={ov.blurPx ?? 0} step={1} min={0} max={30} onChange={(n) => setOv({ blurPx: n || undefined })} />
            </>
          )
        })()}

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
        </>
        )}

        <div className="group-title">Project</div>
        <button className="wide" onClick={props.onProjectSettings}>
          Project settings…
        </button>
        <div className="hint pad">Name, client/MIP, size &amp; store URLs, audio, languages and variants live in Project settings.</div>

        <div className="group-title">Trace backdrop (editor only)</div>
        <AssetPicker label="Mockup image" allowNone value={state.trace.assetId} onChange={(id) => setTrace({ assetId: id })} />
        <Toggle label="Show backdrop" checked={state.trace.visible} onChange={(v) => setTrace({ visible: v })} />
        <Slider label="Opacity" value={Math.round(state.trace.opacity * 100)} min={5} max={100} suffix="%" onChange={(n) => setTrace({ opacity: n / 100 })} />
        <div className="hint pad">A mockup overlaid faintly on the canvas to trace/align against. Never rendered at runtime or exported.</div>
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
  // asset-ish elements can take a stroke/frame (border + radius + padding) too
  const canStroke = el.type === 'image' || el.type === 'bar' || el.type === 'game-mount' || el.type === 'handguide'
  // content elements can be a scratch cover and/or a reveal target
  const canScratch = el.type === 'image' || el.type === 'bar' || el.type === 'text' || el.type === 'cta' || el.type === 'handguide'
  const setScratch = (patch: Partial<NonNullable<SceneElement['scratch']>>): void =>
    patchElement(id, { scratch: { ...(el.scratch ?? {}), ...patch } })
  const setReveal = (patch: Partial<NonNullable<SceneElement['reveal']>>): void =>
    patchElement(id, { reveal: { ...(el.reveal ?? {}), ...patch } })

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
      {variantBanner}
      <div className="panel-title">
        {el.type === 'bar' && el.mode === 'fit' ? 'rectangle' : el.type} {landscape && <span className="badge">landscape</span>}
      </div>

      <Row label="Name">
        <input value={el.name} onChange={(e) => patchElement(id, { name: e.target.value })} />
      </Row>
      {!activeVariant && <Toggle label="Lock element" checked={!!el.locked} onChange={() => toggleLock(id)} />}
      <Toggle label="Show on game win" checked={!!el.showOnWin} onChange={(v) => patchElement(id, { showOnWin: v })} />
      {el.type !== 'cta' && (
        <Toggle label="Above overlays" checked={!!el.overlayImmune} onChange={(v) => patchElement(id, { overlayImmune: v || undefined })} />
      )}

      {!activeVariant && (
        <>
          <Toggle
            label={state.project.meta.projectName ? `Sync to “${state.project.meta.projectName}”` : 'Sync to project'}
            checked={!!el.sync}
            onChange={() => toggleSyncToProject(id)}
          />
          {el.sync && (
            <Row label="Appears on">
              <Select
                value={el.sync.scope}
                onChange={(v) => setSyncScope(id, v as 'scene' | 'all')}
                options={[
                  { value: 'scene', label: 'One scene' },
                  { value: 'all', label: 'Every scene (overlay)' },
                ]}
              />
            </Row>
          )}
          {el.sync && (
            <div className="hint pad">
              Shared across all MIPs in this project; edits here (position, size, text, style, everything) apply to every MIP.
            </div>
          )}
        </>
      )}

      {!activeVariant && el.type !== 'game-mount' && el.type !== 'endscene' &&
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
        <NumField label="X" value={g.x} suffix="px" onChange={(n) => patchGeometry(id, { x: n })} />
        <NumField label="Y" value={g.y} suffix="px" onChange={(n) => patchGeometry(id, { y: n })} />
      </div>
      {el.type === 'text' || el.type === 'countdown' || el.type === 'background' || (el.type === 'endscene' && g.mode === 'extend') ? null : el.type === 'bar' && g.mode === 'extend' ? (
        <NumField label="Height" value={g.h} suffix="px" onChange={(n) => patchGeometry(id, { h: n })} />
      ) : g.w != null && g.h != null ? (
        <div className="grid2">
          <NumField label="W" value={g.w} suffix="px" onChange={(n) => patchGeometry(id, { w: n })} />
          <NumField label="H" value={g.h} suffix="px" onChange={(n) => patchGeometry(id, { h: n })} />
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
            <Accordion id="inspector.game" title="Game">
              <Row label="Template">
                <Select
                  value={tpl.id}
                  onChange={(v) => patchElement(id, { game: { ...(el.game ?? { params: {} }), templateId: v, params: {} } })}
                  options={GAME_TEMPLATES.map((t) => ({ value: t.id, label: t.label }))}
                />
              </Row>
              {tpl.id === 'scratch_grid' ? (
                <ScratchGridCells params={params} setParam={setParam} elementId={id} />
              ) : (
              <>
              {tpl.paramFields.map(renderField)}
              {tpl.id === 'scratch' && (
                <>
                  <button
                    className="btn"
                    style={{ width: '100%', marginTop: 6 }}
                    onClick={() => window.dispatchEvent(new CustomEvent('pa:zone-edit', { detail: { elementId: id } }))}
                  >
                    Edit reveal zone on canvas
                  </button>
                  <div className="hint pad">Only scratching inside the reveal zone counts toward the threshold — anywhere outside never contributes. Drag the box to move, corner handles to resize. Esc to finish.</div>
                </>
              )}
              {tpl.id === 'scratch' && params.fit === 'fit' && (
                <div className="hint pad">Double-click the card on the canvas to position &amp; scale the reveal image: drag to move, corner handles to resize.</div>
              )}
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
              </>
              )}
              {activeSceneDef()?.elements.some((e) => e.type === 'handguide') ? (
                <div className="hint pad">Editable hint hand added: drag it on the canvas, edit its route with its path tool, or swap its image via the handguide"s own Source. (The auto hint hand is off while a handguide exists.)</div>
              ) : (
                <button className="wide" onClick={() => addGameHint(id)}>
                  Add hint hand (editable)
                </button>
              )}
              <NumField label="Hint after (ms)" value={el.game?.hintIdleMs ?? 4000} step={500} onChange={(n) => patchElement(id, { game: { ...(el.game ?? { templateId: tpl.id, params: {} }), hintIdleMs: n } })} />
              <div className="hint pad">Games are interactive in Preview/export; the canvas shows a static layout. Mark a CTA/text "Show on game win" to reveal it on win.</div>
            </Accordion>
          )
        })()}

      {el.type === 'image' && (
        <>
          <Accordion id="inspector.image" title="Image">
          <AssetPicker label={el.container ? 'Shape (mask)' : 'Source'} value={el.assetId} onChange={(aid) => patchElement(id, { assetId: aid })} />
          <Toggle
            label="Use as container (mask an image into this shape)"
            checked={!!el.container}
            onChange={(v) => patchElement(id, { container: v ? { fit: 'cover' } : undefined })}
          />
          {el.container && (
            <>
              <AssetPicker label="Image inside" allowNone value={el.container.imageId} onChange={(aid) => patchElement(id, { container: { ...el.container!, imageId: aid } })} />
              <Row label="Fit">
                <Select
                  value={el.container.fit}
                  onChange={(v) => patchElement(id, { container: { ...el.container!, fit: v as 'contain' | 'cover' | 'fill' } })}
                  options={[
                    { value: 'cover', label: 'Cover (fill, may crop)' },
                    { value: 'contain', label: 'Fit (whole image)' },
                    { value: 'fill', label: 'Stretch' },
                  ]}
                />
              </Row>
              <Slider label="Inside padding" value={el.container.padPx ?? 0} min={0} max={200} onChange={(n) => patchElement(id, { container: { ...el.container!, padPx: n } })} />
              <div className="hint pad">The shape"s transparency masks the image; works on any shape (heart, star, etc.). The inside image is clipped to the shape.</div>
            </>
          )}

          </Accordion>
          <Accordion id="inspector.dragdrop" title="Drag & drop" defaultOpen={false}>
          <Toggle label="Draggable item" checked={!!el.drag} onChange={(v) => patchElement(id, { drag: v ? { group: el.slot?.group ?? 'a' } : undefined })} />
          {el.drag && (
            <div className="grid2">
              <Row label="Group">
                <input className="text-input" value={el.drag.group ?? ''} placeholder="a" onChange={(e) => patchElement(id, { drag: { ...el.drag!, group: e.target.value || undefined } })} />
              </Row>
              <Row label="Match key">
                <input className="text-input" value={el.drag.key ?? ''} placeholder="optional" onChange={(e) => patchElement(id, { drag: { ...el.drag!, key: e.target.value || undefined } })} />
              </Row>
            </div>
          )}
          <Toggle label="Drop slot" checked={!!el.slot} onChange={(v) => patchElement(id, { slot: v ? { group: el.drag?.group ?? 'a' } : undefined })} />
          {el.slot && (
            <div className="grid2">
              <Row label="Group">
                <input className="text-input" value={el.slot.group ?? ''} placeholder="a" onChange={(e) => patchElement(id, { slot: { ...el.slot!, group: e.target.value || undefined } })} />
              </Row>
              <Row label="Accepts key">
                <input className="text-input" value={el.slot.key ?? ''} placeholder="optional" onChange={(e) => patchElement(id, { slot: { ...el.slot!, key: e.target.value || undefined } })} />
              </Row>
            </div>
          )}
          {(el.drag || el.slot) && (
            <div className="hint pad">
              Items + slots sharing a <b>Group</b> interact: drag an item onto a same-group slot to drop it in, or back out. A
              slot"s "accepts key" only takes an item whose "match key" matches. Filling every slot in a group completes the scene
              (advances a "game won" scene). Runs in Preview/export.
            </div>
          )}

          </Accordion>
          <Accordion id="inspector.selgen" title="Select & generate" defaultOpen={false}>
          <Toggle label="Tap-to-pick (thumbnail)" checked={!!el.pick} onChange={(v) => patchElement(id, { pick: v ? { group: 'a' } : undefined })} />
          {el.pick && (
            <Row label="Category">
              <input className="text-input" value={el.pick.group} placeholder="any name (e.g. model)" onChange={(e) => patchElement(id, { pick: { group: e.target.value || 'a' } })} />
            </Row>
          )}
          <Toggle label="Fill slot (shows a pick)" checked={!!el.fill} onChange={(v) => patchElement(id, { fill: v ? { group: 'a' } : undefined })} />
          {el.fill && (
            <div className="grid2">
              <Row label="Category">
                <input className="text-input" value={el.fill.group} placeholder="model" onChange={(e) => patchElement(id, { fill: { ...el.fill!, group: e.target.value || 'a' } })} />
              </Row>
              <NumField label="Slot # (0=auto)" value={(el.fill.index ?? -1) + 1} step={1} min={0} onChange={(n) => patchElement(id, { fill: { ...el.fill!, index: n > 0 ? n - 1 : undefined } })} />
            </div>
          )}
          <Toggle label="Generate result (progress → reveal)" checked={!!el.generate} onChange={(v) => patchElement(id, { generate: v ? { needs: [], durationMs: 2500 } : undefined })} />
          {el.generate && (
            <>
              <Row label="Needs categories">
                <input className="text-input" value={(el.generate.needs ?? []).join(', ')} placeholder="model, song" onChange={(e) => patchElement(id, { generate: { ...el.generate!, needs: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} />
              </Row>
              <NumField label="Progress (ms)" value={el.generate.durationMs ?? 2500} step={250} min={500} onChange={(n) => patchElement(id, { generate: { ...el.generate!, durationMs: n } })} />
              <AssetPicker label="Result (image/video)" accept="media" allowNone value={el.generate.resultId} onChange={(aid) => patchElement(id, { generate: { ...el.generate!, resultId: aid } })} />
              <ColorField label="Progress color" value={el.generate.accent ?? '#7c3aed'} onChange={(c) => patchElement(id, { generate: { ...el.generate!, accent: c ?? '#7c3aed' } })} />
            </>
          )}
          {(el.pick || el.fill || el.generate) && (
            <div className="hint pad">
              Fully freeform: invent <b>any categories</b> (type any name) and place <b>as many thumbnails per category</b> as you
              like. <b>How many picks a category holds = how many Fill slots</b> you give it (1 slot = single-choice, 3 slots = pick
              3). Slots fill in scene order, or set Slot #. <b>Generate</b> lists the categories it needs; tap it or <b>swipe up</b>
              → circular % → result. Style/position every element yourself; nothing is grouped or laid out for you.
            </div>
          )}
          </Accordion>
        </>
      )}

      {el.type === 'bar' && (
        <>
          <Accordion id="inspector.fill" title="Fill">
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
          </Accordion>
        </>
      )}

      {el.type === 'handguide' &&
        (() => {
          const hg: HandguideConfig = el.handguide ?? { mode: 'smart' }
          const setHg = (patch: Partial<HandguideConfig>): void => patchElement(id, { handguide: { ...hg, ...patch } })
          return (
            <Accordion id="inspector.handguide" title="Hand guide">
              <AssetPicker label="Hand image" value={el.assetId} onChange={(aid) => patchElement(id, { assetId: aid })} />
              <Row label="Animation">
                <Select
                  value={hg.mode}
                  onChange={(v) => setHg({ mode: v as HandguideConfig['mode'] })}
                  options={[
                    { value: 'smart', label: 'Smart (auto-point at CTA / game)' },
                    { value: 'tap', label: 'Tap (bounce in place)' },
                    { value: 'slide', label: 'Slide along a path' },
                    { value: 'scratch', label: 'Scratch (back-and-forth rub)' },
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
                        <div className="hint pad">Click "Draw path", then click on the canvas to drop the start and each waypoint. Double-click or press Enter to finish; Esc cancels.</div>
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
              <div className="group-title2">Idle behavior</div>
              <Toggle label="Hide on tap, reappear when idle" checked={hg.hideOnInteract !== false} onChange={(v) => setHg({ hideOnInteract: v })} />
              {hg.hideOnInteract !== false && (
                <>
                  <NumField label="Reappear after (ms)" value={hg.idleMs ?? 4000} step={500} min={0} onChange={(n) => setHg({ idleMs: n })} />
                  <Toggle label="Show at start (before first tap)" checked={hg.showInitially !== false} onChange={(v) => setHg({ showInitially: v })} />
                </>
              )}
              <div className="hint pad">Animates in Preview and export. By default it hides on the player"s first tap and reappears after {hg.idleMs ?? 4000}ms of no interaction.</div>
            </Accordion>
          )
        })()}

      {el.type === 'choice' &&
        (() => {
          const ch = el.choice ?? {}
          const setCh = (patch: Partial<typeof ch>): void => patchElement(id, { choice: { ...ch, ...patch } })
          return (
            <Accordion id="inspector.choice" title="Choice">
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
            </Accordion>
          )
        })()}

      {el.type === 'countdown' &&
        (() => {
          const cfg: CountdownConfig = el.countdown ?? { mode: 'dynamic', dynamicDays: 1, format: '{hh}:{mm}:{ss}' }
          const setCd = (patch: Partial<CountdownConfig>): void => patchElement(id, { countdown: { ...cfg, ...patch } })
          return (
            <Accordion id="inspector.countdown" title="Countdown / dynamic date">
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
              <Toggle label="Capitalize text" checked={!!cfg.capitalize} onChange={(v) => setCd({ capitalize: v || undefined })} />
              <div className="hint pad">
                <b>Timer</b> tokens (live): <b>{'{hh}:{mm}:{ss}'}</b> / <b>{'{d} {h} {m} {s}'}</b>. <b>Date</b> label (no ticking):{' '}
                <b>{'{date}'}</b>, e.g. "Order by {'{date}'}". "Dynamic" recomputes from today whenever the ad runs.
              </div>
            </Accordion>
          )
        })()}

      {hasTextStyle && el.text && (
        <>
          <Accordion id="inspector.text" title="Text">
          {el.type !== 'countdown' && (
            <Row label={editLocale ? `Value (${editLocale})` : 'Value'}>
              {editLocale ? (
                <textarea
                  value={el.text.i18n?.[editLocale] ?? ''}
                  rows={2}
                  placeholder={el.text.value}
                  onChange={(e) => setText({ i18n: { ...(el.text?.i18n ?? {}), [editLocale]: e.target.value } })}
                />
              ) : (
                <textarea value={el.text.value} rows={2} onChange={(e) => setText({ value: e.target.value })} />
              )}
            </Row>
          )}
          {(() => {
            const fontAssets = Object.entries(state.assets).filter(([, a]) => a.kind === 'font')
            const uploadFont = async (): Promise<void> => {
              const f = await importFont()
              if (!f) return
              addAsset(f.id, { src: f.src, w: 0, h: 0, kind: 'font' })
              setText({ fontFamily: f.id })
            }
            return (
              <Row label="Font">
                <div style={{ display: 'flex', gap: 4 }}>
                  <Select
                    value={el.text?.fontFamily ?? ''}
                    onChange={(v) => setText({ fontFamily: v || undefined })}
                    options={[
                      { value: '', label: 'Default' },
                      ...fontAssets.map(([id]) => ({ value: id, label: id.replace(/_/g, ' ') })),
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
          </Accordion>
        </>
      )}

      {el.type === 'cta' && (() => {
        const PULSE_PEAK = { calm: 1.025, medium: 1.04, strong: 1.06 } as const
        const PULSE_DUR  = { calm: 1600,  medium: 1200,  strong: 900  } as const
        const ctaBase   = el.cta ?? { pulse: 'medium' as CtaPulsePreset }
        const pKey      = (ctaBase.pulse as 'calm' | 'medium' | 'strong') ?? 'medium'
        const peakPct   = Math.round((ctaBase.pulseScale    ?? PULSE_PEAK[pKey] ?? 1.04) * 1000) / 10
        const minPct    = Math.round((ctaBase.pulseMinScale ?? 1.0)               * 1000) / 10
        const dur       = ctaBase.pulseDurationMs ?? PULSE_DUR[pKey] ?? 1200
        const patch = (p: Partial<typeof ctaBase>): void => patchElement(id, { cta: { ...ctaBase, ...p } })
        return (
          <>
            <Row label="Pulse">
              <Select
                value={ctaBase.pulse ?? 'medium'}
                onChange={(v) => patch({ pulse: v as CtaPulsePreset })}
                options={[
                  { value: 'calm',   label: 'calm'   },
                  { value: 'medium', label: 'medium' },
                  { value: 'strong', label: 'strong' },
                ]}
              />
            </Row>
            <Slider label="Peak size" value={peakPct} min={100} max={130} step={0.5} suffix="%" onChange={(v) => patch({ pulseScale: +(v / 100).toFixed(4) })} />
            <Slider label="Squish"    value={minPct}  min={85}  max={100} step={0.5} suffix="%" onChange={(v) => patch({ pulseMinScale: +(v / 100).toFixed(4) })} />
            <Slider label="Speed"     value={dur}     min={300} max={3000} step={50} suffix="ms" onChange={(v) => patch({ pulseDurationMs: v })} />
          </>
        )
      })()}

      {el.type === 'background' &&
        (() => {
          const bg: BackgroundConfig = el.background ?? {}
          const setBg = (patch: Partial<BackgroundConfig>): void => patchElement(id, { background: { ...bg, ...patch } })
          const fit = bg.objectFit ?? 'cover'
          return (
            <Accordion id="inspector.background" title="Background">
              <AssetPicker label="Image" value={el.assetId} onChange={(aid) => patchElement(id, { assetId: aid })} />
              <Row label="Fit">
                <Select
                  value={fit}
                  onChange={(v) => setBg({ objectFit: v as ObjectFit })}
                  options={[
                    { value: 'cover', label: 'cover (fill, may crop)' },
                    { value: 'contain', label: 'contain (fit, no crop)' },
                  ]}
                />
              </Row>
              {fit === 'cover' && (
                <>
                  <Slider label="Crop X (portrait)" value={Math.round(bg.focusX ?? 50)} min={0} max={100} suffix="%" onChange={(n) => setBg({ focusX: n })} />
                  <Slider label="Crop Y (portrait)" value={Math.round(bg.focusY ?? 50)} min={0} max={100} suffix="%" onChange={(n) => setBg({ focusY: n })} />
                  <div className="hint pad">
                    In <b>portrait</b>, these pick which part of the image stays visible when it's cropped to fill (0% = left/top, 100% =
                    right/bottom). <b>Landscape</b> always centers and crops to cover the whole screen.
                  </div>
                </>
              )}
            </Accordion>
          )
        })()}

      {el.type === 'endscene' &&
        (() => {
          const cfg: EndsceneConfig = el.endscene ?? { objectFit: 'cover', bgColor: '#000000' }
          const setEnd = (patch: Partial<EndsceneConfig>): void => patchElement(id, { endscene: { ...cfg, ...patch } })
          const mode = cfg.mode ?? 'video'
          return (
            <Accordion id="inspector.endscene" title="Endscene">
              <Row label="Type">
                <Chips
                  items={[
                    { key: 'video', label: 'Video / Image', active: mode === 'video', onClick: () => setEnd({ mode: 'video' }) },
                    { key: 'html', label: 'HTML', active: mode === 'html', onClick: () => setEnd({ mode: 'html' }) },
                  ]}
                />
              </Row>
              {mode === 'html' ? (
                <>
                  <AssetPicker label="Portrait HTML" accept="html" allowNone value={cfg.htmlId} onChange={(aid) => setEnd({ htmlId: aid })} />
                  <AssetPicker label="Landscape HTML (optional)" accept="html" allowNone value={cfg.htmlLandscapeId} onChange={(aid) => setEnd({ htmlLandscapeId: aid })} />
                  <div className="group-title2">Portrait background</div>
                  <Toggle
                    label="Split (top / bottom)"
                    checked={cfg.htmlBgBottom != null}
                    onChange={(v) => setEnd({ htmlBgBottom: v ? (cfg.htmlBgBottom ?? cfg.htmlBgTop ?? '#000000') : undefined })}
                  />
                  <ColorField label={cfg.htmlBgBottom != null ? 'Top' : 'Background colour'} value={cfg.htmlBgTop || '#000000'} onChange={(c) => setEnd({ htmlBgTop: c ?? undefined })} />
                  {cfg.htmlBgBottom != null && (
                    <ColorField label="Bottom" value={cfg.htmlBgBottom || '#000000'} onChange={(c) => setEnd({ htmlBgBottom: c ?? undefined })} />
                  )}
                  <div className="group-title2">Landscape background</div>
                  <Toggle
                    label="Split (left / right)"
                    checked={cfg.htmlBgRight != null}
                    onChange={(v) => setEnd({ htmlBgRight: v ? (cfg.htmlBgRight ?? cfg.htmlBgLeft ?? cfg.htmlBgTop ?? '#000000') : undefined })}
                  />
                  <ColorField label={cfg.htmlBgRight != null ? 'Left' : 'Background colour'} value={cfg.htmlBgLeft ?? cfg.htmlBgTop ?? '#000000'} onChange={(c) => setEnd({ htmlBgLeft: c ?? undefined })} />
                  {cfg.htmlBgRight != null && (
                    <ColorField label="Right" value={cfg.htmlBgRight || '#000000'} onChange={(c) => setEnd({ htmlBgRight: c ?? undefined })} />
                  )}
                </>
              ) : (
                <>
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
                  <div className="group-title2">Portrait background</div>
                  {cfg.objectFit === 'contain' && (
                    <Toggle
                      label="Split (top / bottom)"
                      checked={cfg.bgColor2 != null}
                      onChange={(v) => setEnd({ bgColor2: v ? (cfg.bgColor2 ?? cfg.bgColor ?? '#000000') : undefined })}
                    />
                  )}
                  <ColorField label={cfg.objectFit === 'contain' && cfg.bgColor2 != null ? 'Top' : 'Background colour'} value={cfg.bgColor || '#000000'} onChange={(c) => setEnd({ bgColor: c ?? '#000000' })} />
                  {cfg.objectFit === 'contain' && cfg.bgColor2 != null && (
                    <ColorField label="Bottom" value={cfg.bgColor2 || '#000000'} onChange={(c) => setEnd({ bgColor2: c ?? '#000000' })} />
                  )}

                  <div className="group-title2">Landscape background</div>
                  {cfg.objectFit === 'contain' && (
                    <Toggle
                      label="Split (left / right)"
                      checked={cfg.bgColorL2 != null}
                      onChange={(v) => setEnd({ bgColorL2: v ? (cfg.bgColorL2 ?? cfg.bgColorL ?? cfg.bgColor ?? '#000000') : undefined })}
                    />
                  )}
                  <ColorField label={cfg.objectFit === 'contain' && cfg.bgColorL2 != null ? 'Left' : 'Background colour'} value={cfg.bgColorL ?? cfg.bgColor ?? '#000000'} onChange={(c) => setEnd({ bgColorL: c ?? '#000000' })} />
                  {cfg.objectFit === 'contain' && cfg.bgColorL2 != null && (
                    <ColorField label="Right" value={cfg.bgColorL2 || '#000000'} onChange={(c) => setEnd({ bgColorL2: c ?? '#000000' })} />
                  )}

                  {cfg.objectFit === 'contain' && (
                    <Toggle label="Match fill to clip edge(s)" checked={!!cfg.matchBgEdge} onChange={(v) => setEnd({ matchBgEdge: v })} />
                  )}
                  <Toggle label="Loop" checked={cfg.loop ?? true} onChange={(v) => setEnd({ loop: v })} />
                  <div className="hint pad">
                    Full-bleed by default; the clip auto-plays muted and tapping anywhere fires the CTA. For extreme aspect ratios use
                    "contain" + <b>split fill</b> so the top/bottom (portrait) or left/right (landscape) bars match each edge. Turn on
                    "match to edge(s)" to auto-sample them from the clip. Add a CTA/text element on top for the button.
                  </div>
                </>
              )}
            </Accordion>
          )
        })()}

      {el.type === 'unboxing' && <UnboxingInspector el={el} />}

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

      {canStroke && (
        <>
          <Accordion id="inspector.stroke" title="Stroke" defaultOpen={false}>
          <div className="grid2">
            <NumField label="Width" value={el.box?.borderPx ?? 0} min={0} onChange={(n) => setBox({ borderPx: n || undefined })} />
            <ColorField label="Color" value={el.box?.borderColor ?? '#ffffff'} onChange={(c) => setBox({ borderColor: c ?? '#ffffff' })} />
          </div>
          <Slider label="Corner radius" value={el.box?.radiusPx ?? 0} min={0} max={240} onChange={(n) => setBox({ radiusPx: n })} />
          <Slider label="Padding" value={el.box?.paddingXPx ?? 0} min={0} max={240} onChange={(n) => setBox({ paddingXPx: n, paddingYPx: n })} />
          <Swatches label="Fill (behind)" value={el.box?.bgColor} allowNone onChange={(c) => setBox({ bgColor: c })} />
          </Accordion>
        </>
      )}

      <Accordion id="inspector.effects" title="Effects" defaultOpen={false}>
        <Slider label="Layer blur" value={el.blur ?? 0} min={0} max={80} suffix="px" onChange={(n) => patchElement(id, { blur: n || undefined })} />
      </Accordion>

      <Accordion id="inspector.animation" title="Animation" defaultOpen={false}>
        <AnimRow
          title="Entrance"
          trigger
          spec={el.animations?.entrance}
          presets={ENTRANCE_PRESETS}
          defaultSpec={{ preset: 'fade', durationMs: 520, delayMs: 0, easing: 'ease-out', trigger: 'onMount' }}
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
      </Accordion>

      {canScratch && (
        <Accordion id="inspector.scratch" title="Scratchable" defaultOpen={false}>
          <Toggle label="Covered until scratched" checked={!!el.scratch} onChange={(v) => patchElement(id, { scratch: v ? (el.scratch ?? {}) : undefined })} />
          {el.scratch && (
            <>
              <Slider label="Reveal at" value={Math.round((el.scratch.threshold ?? 0.55) * 100)} min={20} max={95} suffix="%" onChange={(n) => setScratch({ threshold: n / 100 })} />
              <Swatches label="Cover color" value={el.scratch.coverColor ?? '#d9b25b'} onChange={(c) => setScratch({ coverColor: c ?? '#d9b25b' })} />
              <Toggle label="Advance when all revealed" checked={el.scratch.advanceOnAllRevealed ?? true} onChange={(v) => setScratch({ advanceOnAllRevealed: v })} />
              <div className="hint pad">
                A coating covers this element in Preview/export; scratching it reveals the elements layered <b>behind</b> it (lower layers
                inside its box). An image element uses its own art as the foil; otherwise the cover color is used. Bind a <b>While scratching</b>{' '}
                sound in the Sound section.
              </div>
            </>
          )}
        </Accordion>
      )}

      {canScratch && (
        <Accordion id="inspector.reveal" title="Reveal (money + tally)" defaultOpen={false}>
          <Toggle label="Pops a price when revealed" checked={!!el.reveal} onChange={(v) => patchElement(id, { reveal: v ? (el.reveal ?? { popup: true }) : undefined })} />
          {el.reveal && (
            <>
              <div className="grid2">
                <NumField label="Amount" value={el.reveal.amount ?? 0} step={0.01} onChange={(n) => setReveal({ amount: n })} />
                <Row label="Currency">
                  <input value={el.reveal.currency ?? '$'} onChange={(e) => setReveal({ currency: e.target.value })} />
                </Row>
              </div>
              <Toggle label="Finale (big, red)" checked={!!el.reveal.big} onChange={(v) => setReveal({ big: v, color: v ? '#ef4444' : undefined })} />
              <Swatches label="Label color" value={el.reveal.color ?? (el.reveal.big ? '#ef4444' : '#ffffff')} onChange={(c) => setReveal({ color: c ?? '#ffffff' })} />
              <Toggle label="Show floating amount" checked={el.reveal.popup ?? true} onChange={(v) => setReveal({ popup: v })} />
              <Row label="Add to tally">
                <Select
                  value={el.reveal.tallyId ?? ''}
                  onChange={(v) => setReveal({ tallyId: v || undefined })}
                  options={[{ value: '', label: '(none)' }, ...(activeSceneDef()?.elements ?? []).filter((e) => e.type === 'text' && e.id !== id).map((e) => ({ value: e.id, label: e.name }))]}
                />
              </Row>
              <div className="hint pad">
                When uncovered, this element pops its amount, plays its <b>When revealed</b> sound (Sound section), and adds to the chosen
                tally text element. Mark the last app <b>Finale</b> for the big red number.
              </div>
            </>
          )}
        </Accordion>
      )}

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
