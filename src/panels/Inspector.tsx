// Inspector — project meta (no selection), a multi-select panel, or the full
// single-element editor with a visual Background-box section.

import { useState, useEffect, useRef, useMemo, type PointerEvent as ReactPointerEvent } from 'react'
import type {
  Anchor,
  AdvanceOn,
  AnimPresetId,
  AnimSpec,
  AnimTrigger,
  BackgroundConfig,
  BoxStyle,
  ButtonConfig,
  ButtonTapEffect,
  ComboRoleConfig,
  ConfettiConfig,
  CountdownConfig,
  CtaPulsePreset,
  EndsceneConfig,
  HandguideConfig,
  HandguideNode,
  HeaderOrientationOverride,
  KeyframeStep,
  LayoutMode,
  ObjectFit,
  SceneDef,
  SceneElement,
  SceneKind,
  SceneOverlay,
  SfxBinding,
  ShadowPreset,
  TextConfig,
  TimingConfig,
  TransitionType,
  UnboxingConfig,
} from '../../runtime/scene'
import { headerAllowedFor } from '../../runtime/scene'
import { ownsSlot, patchSlot, projectLayoutPatch, resolvedLayout, seedSlot, withOwnSlot, withoutSlot, type Orient } from '../headerLayout'
import { TAP_FADE_DEFAULT_MS } from '../../runtime/elements/button'
import { GAME_TEMPLATES } from '../../runtime/games/registry'
import { splitList } from '../../runtime/games/holdgauge'
import type { ParamField } from '../../runtime/games/types'
import { importFont } from '../bridge'
import {
  activeSceneDef,
  addAsset,
  addGameHint,
  alignSelected,
  beginTransaction,
  clearLandscapeLayout,
  endTransaction,
  convertElement,
  copyElementsFromScene,
  copyStyle,
  duplicateSelected,
  groupSelected,
  pasteStyle,
  patchElement,
  patchGeometry,
  patchHeader,
  resetLocaleLayout,
  resetLocaleOverride,
  patchSceneDef,
  refreshScene,
  removeSelected,
  seedLandscapeLayout,
  selectOnly,
  setOrientation,
  setLocaleAsset,
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
  Languages,
  Plus,
  type LucideIcon,
  Trash2,
  Upload,
  Volume2,
  X,
} from '../icons'
import { AssetPicker } from './AssetPicker'
import {
  assignComboSlot,
  comboCandidates,
  comboLayers,
  comboMembers,
  comboOptionLabel,
  comboSlotSummary,
  setLayerCanvasVisible,
  type ComboSlotEdit,
} from '../comboSlots'
import { DATE_LOCALE_OPTIONS } from '../dateLocales'

// Tap feedback options, shared by the button element and images marked as buttons.
const TAP_EFFECTS = [
  { value: 'none', label: 'None' },
  { value: 'press', label: 'Press (shrink)' },
  { value: 'glow', label: 'Glow' },
  { value: 'outline', label: 'Outline' },
  { value: 'fade', label: 'Fade to another image' },
]

// Element types that may be carried across scene changes (SceneElement.persist).
// Everything omitted is bound to the scene it lives on — games, the end-card video,
// the unboxing/confetti one-shots, the hint hand, and the full-screen background/dim.
const CARRY_OVER_TYPES = new Set<SceneElement['type']>(['cta', 'image', 'text', 'bar', 'button', 'countdown'])

// Where a tappable image/button goes on click. '__stay' is not a scene id — it maps
// to button.stay, which plays the tap effect and goes nowhere (so a cross-fade is
// watchable instead of being cut off by the scene change).
const STAY = '__stay'

// Elements a tap can land on, so they can drive a linked press (see LinkedButtons).
const isTappable = (e: SceneElement): boolean => e.type === 'button' || e.type === 'cta' || e.type === 'choice' || !!e.button

// "Also pressed by": other buttons on this screen whose taps press THIS element too —
// it replays its tap effect and on-tap animation as if it had been tapped directly.
// Only the feedback is shared, never the redirect: the button the player actually hit
// decides where the ad goes, so its "Go to screen" always wins over this element's.
function LinkedButtons(props: { cfg: ButtonConfig; selfId: string; siblings: SceneElement[]; patch: (p: Partial<ButtonConfig>) => void }): JSX.Element {
  const { cfg, selfId, siblings, patch } = props
  const linked = cfg.linkedButtonIds ?? []
  const candidates = siblings.filter((e) => e.id !== selfId && isTappable(e))
  // A linked id whose element was deleted (or stopped being tappable) stays listed so
  // it can be seen and cleared, instead of silently doing nothing.
  const stale = linked.filter((lid) => !candidates.some((c) => c.id === lid))
  const set = (ids: string[]): void => patch({ linkedButtonIds: ids.length ? ids : undefined })
  return (
    <>
      <div className="group-title2" style={{ marginTop: 6 }}>
        Also pressed by
      </div>
      {!candidates.length && !stale.length && (
        <div className="hint pad">No other buttons on this screen yet — add a Button element (or make another image tappable) and it will appear here.</div>
      )}
      {candidates.map((c) => (
        <Toggle
          key={c.id}
          label={`${c.name || c.id} (${c.type})`}
          checked={linked.includes(c.id)}
          onChange={(v) => set(v ? [...linked, c.id] : linked.filter((x) => x !== c.id))}
        />
      ))}
      {stale.map((lid) => (
        <Toggle key={lid} label={`${lid} (missing)`} checked onChange={() => set(linked.filter((x) => x !== lid))} />
      ))}
      <div className="hint pad">
        Tapping any ticked button also presses this element — same tap effect and on-tap animation as a direct tap on it. A linked press never changes screen: the button that
        was tapped keeps its own <b>Go to screen</b>, so it wins whenever the two point at different places. If this element should only react to those buttons and do nothing
        when tapped itself, set its <b>Go to screen</b> to “stay on this screen”.
      </div>
    </>
  )
}

// The "Go to screen" + "Tap effect" rows, shared by the image-as-button panel and
// the Button element panel so the two can't drift apart. `fade` reveals its own
// picture + duration controls.
function ButtonTapFields(props: { cfg: ButtonConfig; others: SceneDef[]; selfId: string; siblings: SceneElement[]; patch: (p: Partial<ButtonConfig>) => void }): JSX.Element {
  const { cfg, others, patch } = props
  return (
    <>
      <Row label="Go to screen">
        <Select
          value={cfg.stay ? STAY : (cfg.targetSceneId ?? '')}
          onChange={(v) => (v === STAY ? patch({ stay: true, targetSceneId: undefined }) : patch({ stay: undefined, targetSceneId: v || undefined }))}
          options={[
            { value: '', label: '(next screen / advance)' },
            { value: STAY, label: '(stay on this screen)' },
            ...others.map((s) => ({ value: s.id, label: s.name || s.id })),
          ]}
        />
      </Row>
      <Row label="Tap effect">
        <Select value={cfg.tapEffect ?? 'none'} onChange={(v) => patch({ tapEffect: v === 'none' ? undefined : (v as ButtonTapEffect) })} options={TAP_EFFECTS} />
      </Row>
      {cfg.tapEffect === 'fade' && (
        <>
          <AssetPicker label="Fade to image" value={cfg.tapFadeAssetId} allowNone onChange={(aid) => patch({ tapFadeAssetId: aid ?? undefined })} />
          <Slider label="Fade duration" value={cfg.tapFadeMs ?? TAP_FADE_DEFAULT_MS} min={0} max={3000} step={50} suffix="ms" onChange={(n) => patch({ tapFadeMs: n })} />
          <div className="hint pad">
            On tap the picture cross-fades into this one and <b>stays</b> on it (it resets when the screen is re-entered).
          </div>
        </>
      )}
      {!cfg.stay && (
        <>
          <Slider label="Wait before switching" value={cfg.navDelayMs ?? 0} min={0} max={3000} step={50} suffix="ms" onChange={(n) => patch({ navDelayMs: n || undefined })} />
          <div className="hint pad">
            {cfg.tapEffect === 'fade'
              ? 'Holds the screen this long after the tap so the cross-fade can play out. Match it to the fade duration above (or set Go to screen to “stay on this screen” to never leave).'
              : 'Holds the screen this long after the tap before changing screen — useful to let the tap effect or a sound finish. 0 = switch immediately.'}
          </div>
        </>
      )}
      <LinkedButtons cfg={cfg} selfId={props.selfId} siblings={props.siblings} patch={patch} />
    </>
  )
}
import { SfxLibrary } from './SfxLibrary'
import { startPathDraw } from '../drawMode'
import { setEditLocale, useEditLocale } from '../locale'
import { localizeElement } from '../../runtime/i18n'
import { setActiveVariant, useActiveVariant } from '../variantMode'
import { getTimeline, setTimeline } from '../timeline'
import { KeyframeEditor } from './KeyframeEditor'
import { SceneTranslationModal } from './SceneTranslationModal'

const ANCHORS: Anchor[] = ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right']

// Reuse another scene's elements (background, images, text, …) in the current scene.
// Copies are independent per scene — same asset underneath (packed once on export),
// but each copy keeps its own position/animations, so a reused background or prop can
// animate differently here. Shown in the scene settings view (nothing selected).
function ReuseFromScene(props: { sceneId: string; scenes: SceneDef[] }): JSX.Element | null {
  const [fromId, setFromId] = useState('')
  const others = props.scenes.filter((s) => s.id !== props.sceneId)
  if (!others.length) return null
  const src = others.find((s) => s.id === fromId)
  // Backgrounds first (the most common reuse), then normal stacking order.
  const els = src ? [...src.elements].sort((a, b) => (a.type === 'background' ? -1 : 0) - (b.type === 'background' ? -1 : 0) || a.zIndex - b.zIndex) : []
  return (
    <Accordion id="inspector.reuse" title="Reuse from another scene" defaultOpen={false}>
      <div className="hint pad">
        Copy elements from another scene into this one. Copies share the same underlying assets (each asset is packed once on export, so this barely grows the file) but are edited
        independently — give this scene's copy its own animations. A copied element keeps its landscape layout too.
      </div>
      <Row label="Scene">
        <Select value={fromId} onChange={setFromId} options={[{ value: '', label: '(choose scene)' }, ...others.map((s) => ({ value: s.id, label: s.name }))]} />
      </Row>
      {src && !els.length && <div className="hint pad">That scene has no elements.</div>}
      {els.map((e) => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.name} <span style={{ opacity: 0.55 }}>({e.type})</span>
          </span>
          <button onClick={() => copyElementsFromScene(src!.id, [e.id])}>Copy</button>
        </div>
      ))}
      {src && els.length > 1 && (
        <button
          className="wide"
          onClick={() =>
            copyElementsFromScene(
              src.id,
              els.map((e) => e.id),
            )
          }
        >
          Copy all elements
        </button>
      )}
      {src && (src.bgColor || src.bgColor2) && (
        <button
          className="wide"
          onClick={() => {
            setSceneBg(src.bgColor ?? '')
            setSceneBg2(src.bgColor2)
          }}
        >
          Copy scene BG colours
        </button>
      )}
    </Accordion>
  )
}

// Per-element sounds: bind a sound (built-in library or upload) to a trigger.
// "Add sound" opens the sound library directly so the library is easy to find and
// the button visibly does something.
function ElementSound(props: { el: SceneElement }): JSX.Element {
  const { el } = props
  const { assets, scene } = useEditorState()
  const [chooser, setChooser] = useState<number | null>(null) // binding index being chosen (>= length = new)
  const binds = el.sfx ?? []
  const setBinds = (b: SfxBinding[]): void => patchElement(el.id, { sfx: b.length ? b : undefined })
  // Trigger options grow with the element: scratch covers add a looped "while
  // scratching" sound; reveal targets add a "when revealed" one-shot.
  const isScratching = el.scratch || el.game?.templateId === 'scratch' || el.game?.templateId === 'scratch_grid'
  const isFlipping = el.game?.templateId === 'memorymatch' || el.game?.templateId === 'flipmatch'
  const isFlipbook = el.game?.templateId === 'flipbook'
  const isCatchBasket = el.game?.templateId === 'catch'
  const isBasketDrop = el.game?.templateId === 'basket'
  // Hold gauge: one trigger per stage the dial can CLIMB into (the first stage is
  // where it rests, so it is never climbed into). Named with the author's own stage
  // labels — "When the dial reaches NEUTRAL" beats "stage 2".
  const isHoldGauge = el.game?.templateId === 'holdgauge'
  const hasThoughtWhacker = scene.elements.some((candidate) => candidate.game?.templateId === 'thoughtwhack')
  const isCombo = el.game?.templateId === 'combo'
  const hasCombo = scene.elements.some((candidate) => candidate.game?.templateId === 'combo')
  const gaugeStages = ((): { value: string; label: string }[] => {
    if (!isHoldGauge) return []
    const p = el.game?.params ?? {}
    const n = Math.max(1, Math.min(8, Math.round(Number(p.stages) || 3)))
    const names = splitList(typeof p.stageLabels === 'string' ? p.stageLabels : '')
    return Array.from({ length: n - 1 }, (_, k) => ({
      value: `stage${k + 2}`,
      label: `When the dial reaches ${names[k + 1] || `stage ${k + 2}`}`,
    }))
  })()
  const eventOptions = [
    { value: 'tap', label: 'On tap' },
    { value: 'sceneEnter', label: 'On scene enter' },
    { value: 'elementEnter', label: 'When this element enters' },
    ...(isFlipping
      ? [
          { value: 'flip', label: 'On card flip' },
          { value: 'correct', label: 'On pair found' },
          { value: 'wrong', label: 'Incorrect pair' },
        ]
      : []),
    ...(isFlipbook
      ? [
          { value: 'flip', label: 'On page flip' },
          { value: 'lastPage', label: 'On last page' },
        ]
      : []),
    ...(isCatchBasket
      ? [
          { value: 'basketStart', label: 'When basket first tap / drag starts' },
          { value: 'catch', label: 'When basket catches a falling item' },
        ]
      : []),
    ...(isBasketDrop
      ? [
          { value: 'itemPickUp', label: 'When an item is picked up' },
          { value: 'itemPlace', label: 'When an item is placed down' },
          { value: 'onReveal', label: 'When the game is won' },
        ]
      : []),
    ...(hasThoughtWhacker
      ? [
          { value: 'thoughtSpawn', label: 'When a thought spawns' },
          { value: 'thoughtWhack', label: 'When a thought is whacked' },
        ]
      : []),
    ...(hasCombo
      ? [
          { value: 'comboPick', label: 'When an option is picked up' },
          { value: 'comboDrop', label: 'When an option is dropped' },
          { value: 'comboNext', label: 'When the next question comes up' },
        ]
      : []),
    ...(isCombo ? [{ value: 'onReveal', label: 'When the game is won' }] : []),
    ...gaugeStages,
    ...(isScratching ? [{ value: 'whileScratching', label: 'While scratching (loop)' }] : []),
    ...(isScratching || el.reveal ? [{ value: 'onReveal', label: 'When revealed / win' }] : []),
    // Same wire ('onReveal' = the game's own win moment, timed to the "On game won"
    // animation phase), named for a game that is won rather than revealed.
    ...(isHoldGauge ? [{ value: 'onReveal', label: 'When the game is won' }] : []),
    ...(el.type === 'unboxing'
      ? [
          { value: 'onReveal', label: 'On reveal' },
          { value: 'onWin', label: 'On win' },
          { value: 'onLose', label: 'On lose' },
        ]
      : []),
  ]
  const defaultEvent = el.reveal ? 'onReveal' : isScratching ? 'whileScratching' : isFlipping ? 'flip' : isCatchBasket ? 'catch' : isBasketDrop ? 'itemPickUp' : 'tap'
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
        <div className="sfx-el-binding" key={i}>
          <div className="sfx-el-row">
            <button className="sfx-el-name" title="Change sound" onClick={() => setChooser(i)}>
              <Icon icon={Volume2} size={13} /> <span>{nameOf(b)}</span>
            </button>
            <Select value={b.event || 'tap'} onChange={(v) => setBinds(binds.map((x, j) => (j === i ? { ...x, event: v } : x)))} options={eventOptions} />
            <button className="icon-btn" title="Remove" onClick={() => setBinds(binds.filter((_, j) => j !== i))}>
              <Icon icon={X} size={13} />
            </button>
          </div>
          <div className="sfx-el-delay">
            <NumField
              label="Sound delay"
              value={b.delayMs ?? 0}
              min={0}
              max={60000}
              step={50}
              suffix="ms"
              onChange={(n) => setBinds(binds.map((x, j) => (j === i ? { ...x, delayMs: Math.max(0, Math.round(n)) || undefined } : x)))}
            />
          </div>
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
  const set = (patch: Partial<UnboxingConfig[UnboxPieceKey]>): void => patchElement(el.id, { unboxing: { ...cfg, [pieceKey]: { ...piece, ...patch } } })
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
          <div className="group-title2" style={{ marginTop: 4 }}>
            Lid end position
          </div>
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
  const set = (patch: Partial<UnboxingConfig>): void => patchElement(el.id, { unboxing: { ...cfg, ...patch } })
  const hasLose = !!cfg.loseAssetId

  return (
    <Accordion id="inspector.unboxing" title="Mystery Box">
      <div className="group-title2">Grid</div>
      <div className="grid2">
        <NumField
          label="Columns"
          value={cfg.cols ?? 2}
          step={1}
          min={1}
          max={6}
          onChange={(n) => {
            const newCount = n * (cfg.rows ?? 2)
            const cells = cfg.cells ? Array.from({ length: newCount }, (_, i): 'win' | 'lose' => cfg.cells![i] ?? 'win') : undefined
            set({ cols: n, ...(cells ? { cells } : {}) })
          }}
        />
        <NumField
          label="Rows"
          value={cfg.rows ?? 2}
          step={1}
          min={1}
          max={6}
          onChange={(n) => {
            const newCount = (cfg.cols ?? 2) * n
            const cells = cfg.cells ? Array.from({ length: newCount }, (_, i): 'win' | 'lose' => cfg.cells![i] ?? 'win') : undefined
            set({ rows: n, ...(cells ? { cells } : {}) })
          }}
        />
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
      <div className="group-title2" style={{ marginTop: 4 }}>
        Win product start
      </div>
      <div className="grid2">
        <NumField label="Start X %" value={cfg.productStartX ?? cfg.productX ?? 50} step={2} onChange={(n) => set({ productStartX: n })} />
        <NumField label="Start Y %" value={cfg.productStartY ?? 120} step={2} onChange={(n) => set({ productStartY: n })} />
      </div>
      <div className="group-title2" style={{ marginTop: 4 }}>
        Win product end
      </div>
      <div className="grid2">
        <NumField label="End X %" value={cfg.productX ?? 50} step={2} onChange={(n) => set({ productX: n })} />
        <NumField label="End Y %" value={cfg.productY ?? 28} step={2} onChange={(n) => set({ productY: n })} />
      </div>
      <NumField label="Width %" value={cfg.productW ?? 65} step={2} min={1} onChange={(n) => set({ productW: n })} />
      <NumField label="Rise ms" value={cfg.productDurationMs ?? 900} step={50} min={0} onChange={(n) => set({ productDurationMs: n })} />

      <AssetPicker label="Lose image (optional)" allowNone value={cfg.loseAssetId} onChange={(aid) => set({ loseAssetId: aid ?? undefined })} />
      {hasLose && (
        <>
          <div className="group-title2" style={{ marginTop: 4 }}>
            Lose product start
          </div>
          <div className="grid2">
            <NumField label="Start X %" value={cfg.loseProductStartX ?? cfg.productStartX ?? cfg.productX ?? 50} step={2} onChange={(n) => set({ loseProductStartX: n })} />
            <NumField label="Start Y %" value={cfg.loseProductStartY ?? cfg.productStartY ?? 120} step={2} onChange={(n) => set({ loseProductStartY: n })} />
          </div>
          <div className="group-title2" style={{ marginTop: 4 }}>
            Lose product end
          </div>
          <div className="grid2">
            <NumField label="End X %" value={cfg.loseProductX ?? cfg.productX ?? 50} step={2} onChange={(n) => set({ loseProductX: n })} />
            <NumField label="End Y %" value={cfg.loseProductY ?? cfg.productY ?? 28} step={2} onChange={(n) => set({ loseProductY: n })} />
          </div>
          <NumField label="Width %" value={cfg.loseProductW ?? cfg.productW ?? 65} step={2} min={1} onChange={(n) => set({ loseProductW: n })} />
        </>
      )}

      {hasLose &&
        (() => {
          const cols = cfg.cols ?? 2
          const rows = cfg.rows ?? 2
          const count = cols * rows
          const rawCells = cfg.cells
          // Normalize to current grid size (pad with 'win', truncate if shrunk)
          const cells: Array<'win' | 'lose'> | undefined = rawCells ? Array.from({ length: count }, (_, i) => rawCells[i] ?? 'win') : undefined
          const assignMode = !!cells && !cfg.randomize
          const randomMode = !!cfg.randomize

          const setMode = (mode: 'always' | 'assign' | 'random'): void => {
            if (mode === 'always') set({ randomize: false, cells: undefined })
            else if (mode === 'random') set({ randomize: true, cells: undefined })
            else {
              const arr = rawCells?.length === count ? rawCells : Array.from({ length: count }, (_, i): 'win' | 'lose' => (i % 2 === 0 ? 'win' : 'lose'))
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
                        const tmp = arr[i]
                        arr[i] = arr[j]
                        arr[j] = tmp
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
          ...(activeSceneDef()?.elements ?? []).filter((e) => e.type === 'image' && e.id !== el.id).map((e) => ({ value: e.id, label: e.name })),
        ]}
      />
      {cfg.revealSyncElementId && <AssetPicker label="Swap to asset" allowNone value={cfg.revealSyncAssetId} onChange={(aid) => set({ revealSyncAssetId: aid ?? undefined })} />}

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
// 'lightray' (the moving reflection) is a class-driven pseudo effect, so it can be picked in ANY
// phase — entrance, loop, or exit — not just as a loop.
const ENTRANCE_PRESETS: AnimPresetId[] = [
  'fade',
  'typewriter',
  'wipe-right',
  'wipe-left',
  'wipe-up',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'swipe-left',
  'swipe-right',
  'swipe-up',
  'drop',
  'pop',
  'bounce',
  'spin',
  'lightray',
]
const LOOP_PRESETS: AnimPresetId[] = ['pulse', 'float', 'subtle-float', 'bounce', 'shake', 'wave', 'shine', 'lightray', 'glow', 'spin']
const EXIT_PRESETS: AnimPresetId[] = ['fade-out', 'typewriter', 'wipe-out-left', 'wipe-out-right', 'wipe-out-up', 'scale-out', 'swipe-out-left', 'swipe-out-right', 'lightray']
// Presets offered for STACKED (extra) animations: every node-driven preset + the reflection.
const NODE_PRESETS: AnimPresetId[] = [
  'fade',
  'wipe-right',
  'wipe-left',
  'wipe-up',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'swipe-left',
  'swipe-right',
  'swipe-up',
  'drop',
  'pop',
  'bounce',
  'shake',
  'wave',
  'shine',
  'glow',
  'spin',
  'float',
  'subtle-float',
  'pulse',
  'fade-out',
  'wipe-out-left',
  'wipe-out-right',
  'wipe-out-up',
  'scale-out',
  'swipe-out-left',
  'swipe-out-right',
  'lightray',
]
const LOOP_EXTRA_PRESETS: AnimPresetId[] = NODE_PRESETS
// Friendly labels so effects are findable in the dropdown (the raw ids are terse).
const PRESET_LABELS: Partial<Record<AnimPresetId, string>> = {
  shine: 'shine (brightness glint)',
  lightray: 'shine — moving reflection',
  glow: 'glow (soft halo)',
  'slide-up': 'slide up',
  'slide-down': 'slide down',
  'slide-left': 'slide left',
  'slide-right': 'slide right',
  'wipe-right': 'wipe in → (uncovers left to right)',
  'wipe-left': 'wipe in ← (uncovers right to left)',
  'wipe-up': 'wipe in ↑ (uncovers bottom to top)',
  'wipe-out-left': 'wipe off ← (erases right to left)',
  'wipe-out-right': 'wipe off → (erases left to right)',
  'wipe-out-up': 'wipe off ↑ (erases bottom to top)',
  'swipe-left': 'slide across ← (flies in from the right)',
  'swipe-up': 'slide across ↑ (flies in from the bottom)',
  drop: 'drop / fall (falls in from above)',
  'swipe-right': 'slide across → (flies in from the left)',
  'swipe-out-left': 'slide off ← (flies past the left edge)',
  'swipe-out-right': 'slide off → (flies past the right edge)',
  'fade-out': 'fade out',
  'scale-out': 'scale out',
  'subtle-float': 'subtle float',
  typewriter: 'typewriter',
}
const presetLabel = (p: AnimPresetId): string => PRESET_LABELS[p] ?? (p as string)
// Direction options for the 'lightray' reflection sweep (mapped to an angle in degrees).
const LIGHTRAY_DIRECTIONS: { value: number; label: string }[] = [
  { value: 20, label: 'diagonal ↘ (default)' },
  { value: 0, label: 'left → right' },
  { value: 180, label: 'right → left' },
  { value: 90, label: 'top → bottom' },
  { value: 270, label: 'bottom → top' },
  { value: 45, label: 'corner ↘ (top-left → bottom-right)' },
  { value: 135, label: 'corner ↙ (top-right → bottom-left)' },
  { value: 315, label: 'corner ↗ (bottom-left → top-right)' },
  { value: 225, label: 'corner ↖ (bottom-right → top-left)' },
]
// Brush params rendered by the custom <BrushControls> block instead of the generic field list.
const BRUSH_PARAM_KEYS = new Set([
  'brushRadius',
  'brushScale',
  'brushTipX',
  'brushTipY',
  'brushSpawnX',
  'brushSpawnY',
  'brushFollow',
  'brushIntro',
  'brushIntroPath',
  'brushIntroDurationMs',
  'brushIntroLoops',
])
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
              onChange={(v) => (v === 'custom' && !spec.custom?.length ? patch({ preset: 'custom', custom: DEFAULT_CUSTOM }) : patch({ preset: v as AnimSpec['preset'] }))}
              options={[...props.presets.map((p) => ({ value: p as string, label: presetLabel(p) })), { value: 'custom', label: '✦ custom keyframes' }]}
            />
          </Row>
          {spec.preset === 'custom' && <KeyframeEditor steps={spec.custom ?? []} onChange={(c) => patch({ custom: c })} />}
          {spec.preset === 'lightray' && (
            <Row label="Direction">
              <Select
                value={String(spec.angleDeg ?? 20)}
                onChange={(v) => patch({ angleDeg: Number(v) })}
                options={LIGHTRAY_DIRECTIONS.map((d) => ({ value: String(d.value), label: d.label }))}
              />
            </Row>
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
                  { value: 'onGameWin', label: 'on game won' },
                ]}
              />
            </Row>
          )}
        </div>
      )}
    </div>
  )
}

// A phase editor that stacks MULTIPLE animations: the primary AnimRow plus any number of extra
// rows played together with it (e.g. entrance = pop + shine). Extras only show once a primary
// exists; removing the primary clears the extras too.
function AnimPhase(props: {
  title: string
  trigger?: boolean
  primary?: AnimSpec
  extra?: AnimSpec[]
  presets: AnimPresetId[]
  extraPresets: AnimPresetId[]
  defaultSpec: AnimSpec
  defaultExtraSpec: AnimSpec
  onChange: (primary: AnimSpec | undefined, extra: AnimSpec[]) => void
}): JSX.Element {
  const extra = props.extra ?? []
  return (
    <div className="anim-phase">
      <AnimRow
        title={props.title}
        trigger={props.trigger}
        spec={props.primary}
        presets={props.presets}
        defaultSpec={props.defaultSpec}
        onChange={(s) => props.onChange(s, s ? extra : [])}
      />
      {props.primary && (
        <div className="anim-extra-list">
          {extra.map((sp, i) => (
            <AnimRow
              key={i}
              title={`+ ${props.title} ${i + 2}`}
              spec={sp}
              presets={props.extraPresets}
              defaultSpec={props.defaultExtraSpec}
              onChange={(s) => props.onChange(props.primary, s ? extra.map((x, j) => (j === i ? s : x)) : extra.filter((_, j) => j !== i))}
            />
          ))}
          <button className="btn" style={{ width: '100%', marginTop: 4 }} onClick={() => props.onChange(props.primary, [...extra, props.defaultExtraSpec])}>
            + Add another {props.title.toLowerCase()} animation
          </button>
        </div>
      )}
    </div>
  )
}

// Visual picker for the brush tip — the point on the brush image where the scratch reveals.
// The box is sized to the brush image's aspect ratio (so it fills with no letterbox), so a
// click/drag maps directly to a 0..100% position within the image. Falls back to nothing when
// there's no brush image (caller shows number fields instead).
function BrushTipPicker(props: { src: string; tipXPct: number; tipYPct: number; onChange: (xPct: number, yPct: number) => void }): JSX.Element {
  const [aspect, setAspect] = useState(1)
  const dragging = useRef(false)
  const setFromEvent = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)))
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height)))
    props.onChange(Math.round(x * 100), Math.round(y * 100))
  }
  return (
    <div>
      <div className="hint pad">Click or drag on the brush to set its tip — the point that does the revealing (offset from the finger).</div>
      <div
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          setFromEvent(e)
        }}
        onPointerMove={(e) => {
          if (dragging.current) setFromEvent(e)
        }}
        onPointerUp={(e) => {
          dragging.current = false
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 200,
          margin: '4px auto 2px',
          aspectRatio: String(aspect || 1),
          backgroundImage: `url("${props.src}")`,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          backgroundColor: 'rgba(127,127,127,0.15)',
          border: '1px solid var(--border, #444)',
          borderRadius: 6,
          cursor: 'crosshair',
          touchAction: 'none',
        }}
      >
        <img
          src={props.src}
          alt=""
          style={{ display: 'none' }}
          onLoad={(e) => {
            const im = e.currentTarget
            if (im.naturalWidth && im.naturalHeight) setAspect(im.naturalWidth / im.naturalHeight)
          }}
        />
        <div style={{ position: 'absolute', left: `${props.tipXPct}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.5)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: `${props.tipYPct}%`, left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.5)', pointerEvents: 'none' }} />
        <div
          style={{
            position: 'absolute',
            left: `${props.tipXPct}%`,
            top: `${props.tipYPct}%`,
            width: 14,
            height: 14,
            transform: 'translate(-50%,-50%)',
            borderRadius: '50%',
            border: '2px solid #fff',
            boxShadow: '0 0 0 2px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  )
}

// Draw the brush intro path: click inside the card-shaped box to add points; the brush traces them
// in order. Points are stored as fractions 0..1 in a JSON list. Undo/clear provided.
function BrushPathEditor(props: { pathJson: string; aspect: number; onChange: (json: string) => void }): JSX.Element {
  const pts = useMemo<{ x: number; y: number }[]>(() => {
    try {
      const a = JSON.parse(props.pathJson || '[]')
      return Array.isArray(a) ? a : []
    } catch {
      return []
    }
  }, [props.pathJson])
  const addAt = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)))
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height)))
    props.onChange(JSON.stringify([...pts, { x: +x.toFixed(3), y: +y.toFixed(3) }]))
  }
  const poly = pts.map((p) => `${(p.x * 100).toFixed(1)},${(p.y * 100).toFixed(1)}`).join(' ')
  return (
    <div>
      <div className="hint pad">
        Click inside the box to add points — the brush traces them in order ({pts.length} point{pts.length === 1 ? '' : 's'}). Green = start.
      </div>
      <div
        onPointerDown={addAt}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 220,
          margin: '4px auto',
          aspectRatio: String(props.aspect || 1),
          background: 'rgba(127,127,127,0.12)',
          border: '1px solid var(--border, #444)',
          borderRadius: 6,
          cursor: 'crosshair',
          touchAction: 'none',
        }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {pts.length >= 2 && <polyline points={poly} fill="none" stroke="rgba(120,170,255,0.95)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={p.x * 100}
              cy={p.y * 100}
              r={2.6}
              fill={i === 0 ? '#4ade80' : '#fff'}
              stroke="rgba(0,0,0,0.6)"
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn" style={{ flex: 1 }} disabled={!pts.length} onClick={() => props.onChange(JSON.stringify(pts.slice(0, -1)))}>
          Undo point
        </button>
        <button className="btn" style={{ flex: 1 }} disabled={!pts.length} onClick={() => props.onChange('')}>
          Clear path
        </button>
      </div>
    </div>
  )
}

// Shared brush editor (used by both the scratch card and the scratch grid). Image + size + radius,
// a visual tip picker, spawn, and the optional intro path/speed.
function BrushControls(props: {
  params: Record<string, unknown>
  setParam: (k: string, v: unknown) => void
  setParams: (patch: Record<string, unknown>) => void
  brushSrc: string
  radiusLabel: string
  cardAspect: number
}): JSX.Element {
  const { params, setParam, setParams, brushSrc } = props
  const tipX = Number(params.brushTipX ?? 50)
  const tipY = Number(params.brushTipY ?? 50)
  const introOn = !!params.brushIntro && params.brushIntro !== 'off'
  const followOn = !!params.brushFollow && params.brushFollow !== 'off'
  return (
    <>
      <div className="group-title2">Brush (drag to scratch)</div>
      <AssetPicker label="Brush image (optional)" value={(params.brushImage as string) || undefined} allowNone onChange={(aid) => setParam('brushImage', aid ?? '')} />
      <NumField label="Brush image size (% of card)" value={Number(params.brushScale ?? 40)} step={5} min={5} max={200} onChange={(n) => setParam('brushScale', n)} />
      <NumField label={props.radiusLabel} value={Number(params.brushRadius ?? 10)} step={1} min={1} max={50} onChange={(n) => setParam('brushRadius', n)} />
      {brushSrc ? (
        <BrushTipPicker src={brushSrc} tipXPct={tipX} tipYPct={tipY} onChange={(x, y) => setParams({ brushTipX: x, brushTipY: y })} />
      ) : (
        <>
          <NumField label="Brush tip X — reveal point (%)" value={tipX} step={1} min={0} max={100} onChange={(n) => setParam('brushTipX', n)} />
          <NumField label="Brush tip Y — reveal point (%)" value={tipY} step={1} min={0} max={100} onChange={(n) => setParam('brushTipY', n)} />
        </>
      )}
      <Toggle label="Follow finger (appear only while scratching)" checked={followOn} onChange={(v) => setParam('brushFollow', v)} />
      {(!followOn || introOn) && (
        <>
          <NumField label="Spawn X — resting spot (% of card)" value={Number(params.brushSpawnX ?? 50)} step={1} min={0} max={100} onChange={(n) => setParam('brushSpawnX', n)} />
          <NumField label="Spawn Y — resting spot (% of card)" value={Number(params.brushSpawnY ?? 50)} step={1} min={0} max={100} onChange={(n) => setParam('brushSpawnY', n)} />
        </>
      )}
      <Toggle label="Intro animation (demo at start)" checked={introOn} onChange={(v) => setParam('brushIntro', v)} />
      {followOn ? (
        <div className="hint pad">
          The brush is hidden until the player scratches — it appears <b>centered under the finger</b>, follows it, and disappears on release. Scratching starts anywhere on the
          card (no need to grab the brush).{introOn ? ' The intro demo still plays from the spawn point, then the brush hides.' : ''}
        </div>
      ) : (
        <div className="hint pad">
          The brush stays on screen and can overflow past the card edges. Spawn sets where it rests; the intro plays a demo motion (like the hint hand) until the player touches.
        </div>
      )}
      {introOn && (
        <>
          <NumField
            label="Intro speed — ms per pass (lower = faster)"
            value={Number(params.brushIntroDurationMs ?? 1600)}
            step={100}
            min={200}
            max={8000}
            onChange={(n) => setParam('brushIntroDurationMs', n)}
          />
          <NumField label="Intro loops" value={Number(params.brushIntroLoops ?? 2)} step={1} min={1} max={20} onChange={(n) => setParam('brushIntroLoops', n)} />
          <BrushPathEditor pathJson={String(params.brushIntroPath ?? '')} aspect={props.cardAspect} onChange={(j) => setParam('brushIntroPath', j)} />
          <div className="hint pad">No path drawn = a default left-right rub at the spawn point.</div>
        </>
      )}
    </>
  )
}

// ---- Combo builder: per-question setup -------------------------------------
// Every element the game drives is assigned FROM HERE, not from each element's own
// panel: pick a question, then choose its title, its two options, and the LAYER each
// option leaves behind. Assigning writes the `comboRole` onto the chosen element and
// clears it off whoever held that slot before, so a slot is never double-booked.
//
// A layer is an ordinary element the author has already placed, so its position,
// size and crop come straight off the canvas — there is no rect to type in. Since
// every layer would otherwise pile up on the anchor while editing, each one gets a
// show/hide toggle here (authoring-only; play always starts with all of them hidden).
interface ComboSetupProps {
  params: Record<string, unknown>
  setParam: (k: string, v: unknown) => void
  elementId: string
  siblings: SceneElement[]
}
function ComboSetup({ params, setParam, elementId, siblings }: ComboSetupProps): JSX.Element {
  const [active, setActive] = useState(0)
  const questions = Math.max(1, Math.min(8, Number(params.questions ?? 3)))
  const q = Math.min(active, questions - 1)

  const mine = comboMembers(siblings, elementId)
  const anchors = mine.filter((e) => e.comboRole?.role === 'anchor')
  const allLayers = comboLayers(siblings, elementId)
  const titleFor = (n: number): SceneElement | undefined => mine.find((e) => e.comboRole?.role === 'title' && (e.comboRole.question ?? 1) === n)
  const slotFor = (role: 'option' | 'layer', n: number, choice: number): SceneElement | undefined =>
    mine.find((e) => e.comboRole?.role === role && (e.comboRole.question ?? 1) === n && (e.comboRole.choice ?? 1) === choice)
  const optionCount = (n: number): number => mine.filter((e) => e.comboRole?.role === 'option' && (e.comboRole.question ?? 1) === n).length

  const candidates = comboCandidates(siblings)
  const choices = (current: SceneElement | undefined): { value: string; label: string }[] => [
    { value: '', label: '— none —' },
    ...candidates.map((e) => ({ value: e.id, label: comboOptionLabel(e) + (current && e.id === current.id ? ' ✓' : '') })),
  ]

  const apply = (edits: ComboSlotEdit[]): void => {
    if (!edits.length) return
    beginTransaction()
    for (const e of edits) patchElement(e.id, e.patch)
    endTransaction()
  }

  const assign = (nextId: string, current: SceneElement | undefined, role: ComboRoleConfig['role'], question?: number, choice?: number): void =>
    apply(assignComboSlot({ nextId, current, role, gameId: elementId, question, choice, elements: siblings }))

  const setLayersVisible = (els: SceneElement[], visible: boolean): void => apply(els.map((e) => setLayerCanvasVisible(e, visible)))

  const jump = (el: SceneElement, label = 'Show on canvas'): JSX.Element => (
    <button className="btn" style={{ width: '100%', marginTop: 4 }} onClick={() => selectOnly(el.id)}>
      {label}
    </button>
  )

  const title = titleFor(q + 1)

  /** One option and the layer it leaves behind — the pair the author thinks in. */
  const optionSlot = (choice: number): JSX.Element => {
    const opt = slotFor('option', q + 1, choice)
    const layer = slotFor('layer', q + 1, choice)
    return (
      <div key={choice}>
        <div className="group-title2">
          Option {choice}
          {opt ? '' : ' — empty'}
        </div>
        <Row label="Draggable">
          <Select value={opt?.id ?? ''} onChange={(v) => assign(v, opt, 'option', q + 1, choice)} options={choices(opt)} />
        </Row>
        {opt && jump(opt, `Show “${opt.name || opt.id}” on canvas`)}
        <Row label="Layer it leaves">
          <Select value={layer?.id ?? ''} onChange={(v) => assign(v, layer, 'layer', q + 1, choice)} options={choices(layer)} />
        </Row>
        {layer && (
          <>
            <Toggle
              label="Show this layer on the canvas"
              checked={!!layer.comboRole?.showOnCanvas}
              onChange={(v) => setLayersVisible([layer], v)}
            />
            {jump(layer, `Position “${layer.name || layer.id}” on canvas`)}
          </>
        )}
        {opt && !layer && <div className="hint pad">This option leaves nothing behind — it will just fly to the anchor and vanish.</div>}
      </div>
    )
  }

  return (
    <>
      <div className="group-title2">Questions</div>
      <NumField label="How many questions" value={questions} step={1} min={1} max={8} onChange={(n) => setParam('questions', Math.round(n))} />
      <Chips
        items={Array.from({ length: questions }, (_, i) => ({
          key: String(i),
          label: `Q${i + 1}${optionCount(i + 1) ? '' : ' !'}`,
          active: i === q,
          onClick: () => setActive(i),
        }))}
      />
      <div className="hint pad">A question marked ! has no options yet and is skipped at runtime rather than stalling the game.</div>

      <div className="group-title2">Question {q + 1} title</div>
      <Row label="Title">
        <Select value={title?.id ?? ''} onChange={(v) => assign(v, title, 'title', q + 1)} options={choices(title)} />
      </Row>
      {title && jump(title, `Show “${title.name || title.id}” on canvas`)}
      <div className="hint pad">Shown while this question is up, swapped on advance. It never reacts to which option was picked.</div>

      {optionSlot(1)}
      {optionSlot(2)}
      <div className="hint pad">
        Only this question&apos;s options are visible and draggable during it. A layer is a normal element you place where it belongs on the anchor — the pick flies onto it and
        hands over, so its position, size and crop are whatever you set on the canvas.
      </div>

      <div className="group-title2">Layers on the canvas ({allLayers.length})</div>
      <div className="hint pad">
        Play always starts with every layer hidden and reveals them as picks land, so these toggles only affect what you see while editing.
      </div>
      {allLayers.length > 0 && (
        <div className="grid2">
          <button className="btn" onClick={() => setLayersVisible(allLayers, true)}>
            Show all
          </button>
          <button className="btn" onClick={() => setLayersVisible(allLayers, false)}>
            Hide all
          </button>
        </div>
      )}
      {allLayers.map((l) => (
        <Toggle
          key={l.id}
          label={`Q${l.comboRole?.question ?? 1} · option ${l.comboRole?.choice ?? 1} — ${l.name || l.id}`}
          checked={!!l.comboRole?.showOnCanvas}
          onChange={(v) => setLayersVisible([l], v)}
        />
      ))}

      <div className="group-title2">Drop area</div>
      <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => window.dispatchEvent(new CustomEvent('pa:zone-edit', { detail: { elementId } }))}>
        Set drop area on canvas
      </button>
      <div className="hint pad">
        Draw the invisible area an option must be released into. There is exactly one drop area for the whole game — drag the box to move it, corner handles to resize, Esc to
        finish.
      </div>

      <div className="group-title2">Anchor images ({anchors.length})</div>
      {anchors.map((a) => (
        <div key={a.id}>
          <Row label="Anchor">
            <Select value={a.id} onChange={(v) => assign(v, a, 'anchor')} options={choices(a)} />
          </Row>
          {jump(a, `Show “${a.name || a.id}” on canvas`)}
        </div>
      ))}
      <Row label="Add anchor">
        <Select
          value=""
          onChange={(v) => assign(v, undefined, 'anchor')}
          options={[{ value: '', label: '— pick an element —' }, ...candidates.filter((e) => e.comboRole?.role !== 'anchor').map((e) => ({ value: e.id, label: comboOptionLabel(e) }))]}
        />
      </Row>
      <div className="hint pad">
        The base art the layers build on top of. Optional: it is only used as the fly-to target for an option that has no layer of its own. Set an anchor to <b>none</b> to release
        it.
      </div>
      <div className="hint pad">
        Any scene element can use <b>On option picked up</b> / <b>On option dropped</b> / <b>On next question</b> in its Animation panel and the matching triggers in its Sounds
        panel.
      </div>
    </>
  )
}

interface ScratchGridCellsProps {
  params: Record<string, unknown>
  setParam: (k: string, v: unknown) => void
  setParams: (patch: Record<string, unknown>) => void
  elementId: string
  cardAspect: number
}
function ScratchGridCells({ params, setParam, setParams, elementId, cardAspect }: ScratchGridCellsProps): JSX.Element {
  const [activeCell, setActiveCell] = useState(0)
  const { project, assets } = useEditorState()
  const brushSrc = assets[(params.brushImage as string) || '']?.src ?? ''

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

  const rowLabel = (r: number): string => (rows > 1 ? (['top', 'middle', 'lower', 'bottom'][r] ?? `row ${r + 1}`) : '')
  const colLabel = (c: number): string => (cols > 1 ? (['left', 'center', 'right', 'far-right'][c] ?? `col ${c + 1}`) : '')
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
      <NumField label="Cell corner radius (%)" value={Number(params.cellRadius ?? 9)} step={1} min={0} max={50} onChange={(n) => setParam('cellRadius', n)} />
      <div className="hint pad">Rounds the grid&apos;s 4 outer cell corners (% of the cell&apos;s short side). Set 0 for square corners so cell images aren&apos;t clipped.</div>
      <NumField label="Reveal threshold" value={Number(params.threshold ?? 0.5)} step={0.05} min={0.2} max={0.9} onChange={(n) => setParam('threshold', n)} />
      <NumField label="Reveal zone left (%, per cell)" value={Number(params.zoneX ?? 0)} step={1} min={0} max={100} onChange={(n) => setParam('zoneX', n)} />
      <NumField label="Reveal zone top (%, per cell)" value={Number(params.zoneY ?? 0)} step={1} min={0} max={100} onChange={(n) => setParam('zoneY', n)} />
      <NumField label="Reveal zone width (%, per cell)" value={Number(params.zoneW ?? 100)} step={1} min={2} max={100} onChange={(n) => setParam('zoneW', n)} />
      <NumField label="Reveal zone height (%, per cell)" value={Number(params.zoneH ?? 100)} step={1} min={2} max={100} onChange={(n) => setParam('zoneH', n)} />
      <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => window.dispatchEvent(new CustomEvent('pa:zone-edit', { detail: { elementId } }))}>
        Edit reveal zone on canvas
      </button>
      <div className="hint pad">
        Only scratching inside the reveal zone counts toward a cell&apos;s threshold — anywhere outside never contributes. The same zone applies to every cell. Drag the box in the
        first cell to move, corner handles to resize. Esc to finish.
      </div>
      <ColorField label="Cover color" value={(params.coverColor as string) || undefined} allowNone onChange={(c) => setParam('coverColor', c ?? '')} />
      <ColorField label="Win cell bg" value={(params.winBgColor as string) || undefined} allowNone onChange={(c) => setParam('winBgColor', c ?? '')} />
      <ColorField label="Lose cell bg" value={(params.loseBgColor as string) || undefined} allowNone onChange={(c) => setParam('loseBgColor', c ?? '')} />
      <Row label="Image fit">
        <Select
          value={String(params.imageFit ?? 'cover')}
          onChange={(v) => setParam('imageFit', v)}
          options={[
            { value: 'cover', label: 'Cover (fill cell, may crop)' },
            { value: 'contain', label: 'Contain (fit whole image, no crop)' },
          ]}
        />
      </Row>

      <BrushControls params={params} setParam={setParam} setParams={setParams} brushSrc={brushSrc} radiusLabel="Brush/scratch radius (% of cell)" cardAspect={cardAspect} />

      <div className="group-title2">Scratch surface: double-click a cell on the canvas to select it</div>
      <AssetPicker label="Shared cover (fallback)" value={(params.cover as string) || undefined} allowNone onChange={(aid) => setParam('cover', aid ?? '')} />
      <AssetPicker label="Shared background (all cells)" value={(params.sharedBg as string) || undefined} allowNone onChange={(aid) => setParam('sharedBg', aid ?? '')} />
      <AssetPicker
        label="Shared text / product overlay (all cells)"
        value={(params.sharedText as string) || undefined}
        allowNone
        onChange={(aid) => setParam('sharedText', aid ?? '')}
      />

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
              style={{
                aspectRatio: '1',
                minHeight: 32,
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 4,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
              }}
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
          const next = pat
            .split('')
            .map((c, i) => (i === safeCell ? (win ? 'W' : 'L') : c))
            .join('')
          setParam('pattern', next)
        }
        return (
          <Row label="Cell type">
            <Select
              value={isW ? 'W' : 'L'}
              onChange={(v) => setWinLose(v === 'W')}
              options={[
                { value: 'W', label: 'Win: advances to win scene' },
                { value: 'L', label: 'Lose: navigates to lose scene' },
              ]}
            />
          </Row>
        )
      })()}
      <AssetPicker
        label="Cell cover (overrides shared)"
        value={(params[`cell${safeCell}cover`] as string) || undefined}
        allowNone
        onChange={(aid) => setParam(`cell${safeCell}cover`, aid ?? '')}
      />
      <AssetPicker label="Background reveal" value={(params[`cell${safeCell}`] as string) || undefined} allowNone onChange={(aid) => setParam(`cell${safeCell}`, aid ?? '')} />
      <AssetPicker
        label="Text / product overlay"
        value={(params[`cell${safeCell}text`] as string) || undefined}
        allowNone
        onChange={(aid) => setParam(`cell${safeCell}text`, aid ?? '')}
      />
      <NumField
        label="Text overlay scale (%)"
        value={Number(params[`cell${safeCell}textScale`] !== '' && params[`cell${safeCell}textScale`] != null ? params[`cell${safeCell}textScale`] : (params.textScale ?? 80))}
        step={5}
        min={10}
        max={100}
        onChange={(n) => setParam(`cell${safeCell}textScale`, n)}
      />
      <Row label="Cell label">
        <input value={String(params[`cell${safeCell}Label`] ?? '')} onChange={(e) => setParam(`cell${safeCell}Label`, e.target.value)} />
      </Row>
      {(() => {
        const off = params[`cell${safeCell}dateOff`]
        const isOff = off === true || off === 1 || off === '1' || off === 'on'
        return <Toggle label="Show dynamic date (this cell)" checked={!isOff} onChange={(v) => setParam(`cell${safeCell}dateOff`, v ? '' : 1)} />
      })()}
      <Row label="Dynamic date">
        <input
          value={String(params[`cell${safeCell}date`] ?? '')}
          placeholder="e.g. (MMMM D) — empty = fallback"
          onChange={(e) => setParam(`cell${safeCell}date`, e.target.value)}
        />
      </Row>

      <div className="group-title2">Hint path (this cell)</div>
      <div className="hint pad">The hint hand rubs from the start point to the end point. Values are % of the cell (0,0 = top-left). Default is a centered horizontal rub.</div>
      <NumField label="Start X (%)" value={Number(params[`cell${safeCell}hintFromX`] ?? 20)} step={5} min={0} max={100} onChange={(n) => setParam(`cell${safeCell}hintFromX`, n)} />
      <NumField label="Start Y (%)" value={Number(params[`cell${safeCell}hintFromY`] ?? 50)} step={5} min={0} max={100} onChange={(n) => setParam(`cell${safeCell}hintFromY`, n)} />
      <NumField label="End X (%)" value={Number(params[`cell${safeCell}hintToX`] ?? 80)} step={5} min={0} max={100} onChange={(n) => setParam(`cell${safeCell}hintToX`, n)} />
      <NumField label="End Y (%)" value={Number(params[`cell${safeCell}hintToY`] ?? 50)} step={5} min={0} max={100} onChange={(n) => setParam(`cell${safeCell}hintToY`, n)} />

      {cellIsWin && (
        <>
          <div className="hint pad">
            When this cell wins, it redirects to this scene without flashing back to the game (a normal scene replaces it; an overlay-type scene dims it). That scene’s own Advance
            then continues to the end scene. Leave blank to use the default below; if no scene is set, falls back to the overlay image.
          </div>
          <Row label="Cell win scene (redirect)">
            <Select
              value={String(params[`cell${safeCell}winSceneId`] ?? '')}
              onChange={(v) => setParam(`cell${safeCell}winSceneId`, v)}
              options={[{ value: '', label: '(use default below)' }, ...project.scenes.map((s) => ({ value: s.id, label: s.name || s.id }))]}
            />
          </Row>
          <AssetPicker
            label="Cell win overlay image"
            value={(params[`cell${safeCell}winOverlayImage`] as string) || undefined}
            allowNone
            onChange={(aid) => setParam(`cell${safeCell}winOverlayImage`, aid ?? '')}
          />
          <NumField
            label="Cell win image duration (ms)"
            value={Number(
              params[`cell${safeCell}winOverlayDurationMs`] !== '' && params[`cell${safeCell}winOverlayDurationMs`] != null
                ? params[`cell${safeCell}winOverlayDurationMs`]
                : (params.winOverlayDurationMs ?? 800),
            )}
            step={100}
            min={200}
            max={5000}
            onChange={(n) => setParam(`cell${safeCell}winOverlayDurationMs`, n)}
          />
        </>
      )}

      <div className="group-title2">Type fallbacks</div>
      <Row label="Win label">
        <input value={String(params.winLabel ?? 'Promo')} onChange={(e) => setParam('winLabel', e.target.value)} />
      </Row>
      <Row label="Lose label">
        <input value={String(params.loseLabel ?? 'TRY\nAGAIN')} onChange={(e) => setParam('loseLabel', e.target.value)} />
      </Row>
      <AssetPicker label="Win bg (fallback)" value={(params.winImage as string) || undefined} allowNone onChange={(aid) => setParam('winImage', aid ?? '')} />
      <AssetPicker label="Lose bg (fallback)" value={(params.loseImage as string) || undefined} allowNone onChange={(aid) => setParam('loseImage', aid ?? '')} />
      <AssetPicker label="Win text overlay (fallback)" value={(params.winTextImage as string) || undefined} allowNone onChange={(aid) => setParam('winTextImage', aid ?? '')} />
      <AssetPicker label="Lose text overlay (fallback)" value={(params.loseTextImage as string) || undefined} allowNone onChange={(aid) => setParam('loseTextImage', aid ?? '')} />
      <NumField label="Text overlay scale (%, default)" value={Number(params.textScale ?? 80)} step={5} min={10} max={100} onChange={(n) => setParam('textScale', n)} />

      <Accordion id="inspector.scratchGridDate" title="Dynamic date (inside cells)" defaultOpen={false}>
        <div className="hint pad">
          Shows a live date inside the cell reveal (under the cover), scaling with the cell like the cell art. Tokens: <b>MMMM</b> July, <b>MMM</b> Jul, <b>MM/M</b> 07/7,{' '}
          <b>DD/D</b> day, <b>Do</b> 21st, <b>YYYY/YY</b> year — e.g. “(MMMM Do)” → “(July 21st)”. Empty everywhere = no date; each cell can opt out with its “Show dynamic date”
          toggle.
        </div>
        <Row label="Win cells date">
          <input value={String(params.winDate ?? '')} placeholder="e.g. (MMMM D)" onChange={(e) => setParam('winDate', e.target.value)} />
        </Row>
        <Row label="Lose cells date">
          <input value={String(params.loseDate ?? '')} placeholder="empty = none" onChange={(e) => setParam('loseDate', e.target.value)} />
        </Row>
        <button className="btn" style={{ width: '100%', margin: '6px 0' }} onClick={() => window.dispatchEvent(new CustomEvent('pa:date-edit', { detail: { elementId } }))}>
          Drag date position on canvas
        </button>
        <div className="grid2">
          <NumField label="X (% of cell)" value={Number(params.dateX ?? 50)} step={1} min={0} max={100} onChange={(n) => setParam('dateX', n)} />
          <NumField label="Y (% of cell)" value={Number(params.dateY ?? 50)} step={1} min={0} max={100} onChange={(n) => setParam('dateY', n)} />
        </div>
        <div className="grid2">
          <NumField label="Size (% of cell)" value={Number(params.dateSize ?? 8)} step={1} min={2} max={40} onChange={(n) => setParam('dateSize', n)} />
          <NumField label="Days from today" value={Number(params.dateDays ?? 0)} step={1} min={0} max={60} onChange={(n) => setParam('dateDays', n)} />
        </div>
        <div className="grid2">
          <ColorField label="Color" value={(params.dateColor as string) || '#ffffff'} onChange={(c) => setParam('dateColor', c ?? '#ffffff')} />
          <NumField label="Weight" value={Number(params.dateWeight ?? 700)} step={100} min={100} max={900} onChange={(n) => setParam('dateWeight', n)} />
        </div>
        {(() => {
          // Same font picker as text elements: pick an uploaded font asset (its id is the
          // CSS family, embedded base64 on export) or upload a new one right here.
          const fontAssets = Object.entries(assets).filter(([, a]) => a.kind === 'font')
          const cur = String(params.dateFont ?? '')
          const custom = cur && !assets[cur] ? cur : null
          const uploadFont = async (): Promise<void> => {
            const f = await importFont()
            if (!f) return
            addAsset(f.id, { src: f.src, w: 0, h: 0, kind: 'font' })
            setParam('dateFont', f.id)
          }
          return (
            <Row label="Font">
              <div style={{ display: 'flex', gap: 4 }}>
                <Select
                  value={cur}
                  onChange={(v) => setParam('dateFont', v)}
                  options={[
                    { value: '', label: 'Default' },
                    ...fontAssets.map(([fid]) => ({ value: fid, label: fid.replace(/_/g, ' ') })),
                    ...(custom ? [{ value: custom, label: `${custom} (system)` }] : []),
                  ]}
                />
                <button
                  className="icon-btn"
                  title="Upload font (.ttf .otf .woff .woff2)"
                  onClick={() => {
                    void uploadFont()
                  }}
                >
                  <Icon icon={Upload} size={13} />
                </button>
              </div>
            </Row>
          )
        })()}
        <div className="hint pad">
          Dragging the round marker in any cell moves the shared position (Esc to finish). One position, size and style applies to every cell that shows a date.
        </div>
      </Accordion>

      <div className="group-title2">Container background</div>
      <AssetPicker label="Background image" value={(params.bgImage as string) || undefined} allowNone onChange={(aid) => setParam('bgImage', aid ?? '')} />
      <NumField label="BG scale (%)" value={Number(params.bgScale ?? 100)} step={5} min={10} max={300} onChange={(n) => setParam('bgScale', n)} />
      <NumField label="BG X (%)" value={Number(params.bgX ?? 50)} step={5} min={0} max={100} onChange={(n) => setParam('bgX', n)} />
      <NumField label="BG Y (%)" value={Number(params.bgY ?? 50)} step={5} min={0} max={100} onChange={(n) => setParam('bgY', n)} />

      <div className="group-title2">Lose &amp; win scenes</div>
      <div className="hint pad">
        Lose: the chosen scene pops up over the game, then dismisses on its own Advance and play resumes. Win: redirects to the chosen scene without flashing back to the game (a
        normal scene replaces it; an overlay-type scene dims it), and that scene’s own Advance continues to the end scene. If no scene is set, falls back to a plain image overlay.
        The win scene here is the default; each win cell can override it above.
      </div>
      <Row label="Lose overlay scene">
        <Select
          value={String(params.loseSceneId ?? '')}
          onChange={(v) => setParam('loseSceneId', v)}
          options={[{ value: '', label: '(none, use image below)' }, ...project.scenes.map((s) => ({ value: s.id, label: s.name || s.id }))]}
        />
      </Row>
      <AssetPicker
        label="Lose overlay image (fallback)"
        value={(params.loseOverlayImage as string) || undefined}
        allowNone
        onChange={(aid) => setParam('loseOverlayImage', aid ?? '')}
      />
      <NumField
        label="Lose image duration (ms)"
        value={Number(params.loseOverlayDurationMs ?? 1500)}
        step={100}
        min={200}
        max={5000}
        onChange={(n) => setParam('loseOverlayDurationMs', n)}
      />
      <Row label="Default win scene (redirect)">
        <Select
          value={String(params.winSceneId ?? '')}
          onChange={(v) => setParam('winSceneId', v)}
          options={[{ value: '', label: '(none, use image below)' }, ...project.scenes.map((s) => ({ value: s.id, label: s.name || s.id }))]}
        />
      </Row>
      <AssetPicker label="Default win overlay image" value={(params.winOverlayImage as string) || undefined} allowNone onChange={(aid) => setParam('winOverlayImage', aid ?? '')} />
      <NumField
        label="Default win image duration (ms)"
        value={Number(params.winOverlayDurationMs ?? 800)}
        step={100}
        min={200}
        max={5000}
        onChange={(n) => setParam('winOverlayDurationMs', n)}
      />
    </>
  )
}

interface CatchInspectorProps {
  params: Record<string, unknown>
  setParam: (k: string, v: unknown) => void
}

const numList = (value: unknown): number[] =>
  String(value ?? '')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter(Number.isFinite)
const writeNumList = (items: number[]): string => items.join(', ')

function NumberListEditor(props: {
  label: string
  value: unknown
  defaultValue: number
  step?: number
  min?: number
  max?: number
  onChange: (value: string) => void
}): JSX.Element {
  const items = numList(props.value)
  const nextItems = items.length ? items : [props.defaultValue]
  const setItem = (idx: number, value: number): void => props.onChange(writeNumList(nextItems.map((n, i) => (i === idx ? value : n))))
  const remove = (idx: number): void => props.onChange(writeNumList(nextItems.filter((_, i) => i !== idx)))
  return (
    <div>
      <div className="group-title2" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{props.label}</span>
        <button className="icon-btn" title="Add value" onClick={() => props.onChange(writeNumList([...nextItems, props.defaultValue]))}>
          <Icon icon={Plus} size={13} />
        </button>
      </div>
      {nextItems.map((value, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, alignItems: 'center' }}>
          <NumField label={`Item ${i + 1}`} value={value} step={props.step ?? 1} min={props.min} max={props.max} onChange={(n) => setItem(i, n)} />
          {nextItems.length > 1 && (
            <button className="icon-btn" title="Remove value" onClick={() => remove(i)}>
              <Icon icon={Trash2} size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function CatchAssetList(props: { params: Record<string, unknown>; setParam: (k: string, v: unknown) => void }): JSX.Element {
  const arr = Array.isArray(props.params.itemImages) ? (props.params.itemImages as string[]) : []
  const n = Math.max(1, Number(props.params.itemTypes ?? arr.length ?? 1))
  const setCount = (count: number): void => props.setParam('itemTypes', Math.max(1, count))
  return (
    <div>
      <div className="group-title2" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Falling item images</span>
        <button className="icon-btn" title="Add falling item" onClick={() => setCount(n + 1)}>
          <Icon icon={Plus} size={13} />
        </button>
      </div>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, alignItems: 'center' }}>
          <AssetPicker
            label={`Item ${i + 1}`}
            value={arr[i] || undefined}
            allowNone
            onChange={(aid) => {
              const next = arr.slice()
              next[i] = aid ?? ''
              props.setParam('itemImages', next)
            }}
          />
          {n > 1 && (
            <button
              className="icon-btn"
              title="Remove item"
              onClick={() => {
                const next = arr.slice()
                next.splice(i, 1)
                props.setParam('itemImages', next)
                setCount(n - 1)
              }}
            >
              <Icon icon={Trash2} size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function CatchTemplateInspector({ params, setParam }: CatchInspectorProps): JSX.Element {
  const uniqueMode = params.requireUnique !== false
  return (
    <>
      <Accordion id="inspector.catch.gameplay" title="Gameplay">
        <div className="grid2">
          <NumField label="Fall speed" value={Number(params.speed ?? 0.55)} step={0.05} min={0.2} max={3} onChange={(n) => setParam('speed', n)} />
          <NumField label="Spawn every ms" value={Number(params.spawnMs ?? 900)} step={50} min={100} max={10000} onChange={(n) => setParam('spawnMs', n)} />
        </div>
        <Toggle label="Random fall angles" checked={!!params.randomizeAngle} onChange={(v) => setParam('randomizeAngle', v)} />
        {!!params.randomizeAngle && <NumberListEditor label="Angle choices" value={params.randomAngles} defaultValue={0} step={5} onChange={(v) => setParam('randomAngles', v)} />}
        <Row label="Before first play">
          <Select
            value={params.visibleFirstRender ? 'side' : 'hidden'}
            onChange={(v) => setParam('visibleFirstRender', v === 'side')}
            options={[
              { value: 'hidden', label: 'Hide falling item' },
              { value: 'side', label: 'Show item at side' },
            ]}
          />
        </Row>
        <Row label="Start spawning">
          <Select
            value={params.spawnOnMove ? 'firstMove' : 'sceneStart'}
            onChange={(v) => setParam('spawnOnMove', v === 'firstMove')}
            options={[
              { value: 'sceneStart', label: 'When scene starts' },
              { value: 'firstMove', label: 'After first basket move' },
            ]}
          />
        </Row>
        <Row label="Score display">
          <Select
            value={String(params.scoreMode ?? 'Increment')}
            onChange={(v) => setParam('scoreMode', v)}
            options={[
              { value: 'Increment', label: 'Count up caught items' },
              { value: 'Decrement', label: 'Count down remaining items' },
            ]}
          />
        </Row>
      </Accordion>

      <Accordion id="inspector.catch.win" title="Winning Condition">
        <Row label="Win when">
          <Chips
            items={[
              { key: 'unique', label: 'Collect each unique item', active: uniqueMode, onClick: () => setParam('requireUnique', true) },
              { key: 'count', label: 'Catch a total amount', active: !uniqueMode, onClick: () => setParam('requireUnique', false) },
            ]}
          />
        </Row>
        <NumField label="Unique item types" value={Number(params.itemTypes ?? 3)} step={1} min={1} max={20} onChange={(n) => setParam('itemTypes', n)} />
        {uniqueMode ? (
          <div className="hint pad">The player wins after collecting one of each unique item. Total catches is ignored in this mode.</div>
        ) : (
          <NumField label="Catches to win" value={Number(params.catches ?? 5)} step={1} min={1} max={50} onChange={(n) => setParam('catches', n)} />
        )}
      </Accordion>

      <Accordion id="inspector.catch.items" title="Falling Items">
        <CatchAssetList params={params} setParam={setParam} />
        <NumberListEditor label="Item sizes" value={params.itemSizes} defaultValue={120} step={5} min={1} onChange={(v) => setParam('itemSizes', v)} />
      </Accordion>

      <Accordion id="inspector.catch.basketImages" title="Basket Images" defaultOpen={false}>
        <AssetPicker label="Front image" value={(params.frontBasketImage as string) || undefined} allowNone onChange={(aid) => setParam('frontBasketImage', aid ?? '')} />
        <AssetPicker label="Back image" value={(params.backBasketImage as string) || undefined} allowNone onChange={(aid) => setParam('backBasketImage', aid ?? '')} />
      </Accordion>

      <Accordion id="inspector.catch.basket" title="Basket" defaultOpen={false}>
        <div className="group-title2">Front layer</div>
        <div className="grid2">
          <NumField label="Width" value={Number(params.frontBasketWidth ?? 300)} step={10} min={50} max={3000} onChange={(n) => setParam('frontBasketWidth', n)} />
          <NumField label="Height" value={Number(params.frontBasketHeight ?? 150)} step={10} min={50} max={3000} onChange={(n) => setParam('frontBasketHeight', n)} />
        </div>
        <div className="grid2">
          <NumField label="Offset X" value={Number(params.frontBasketOffsetX ?? 0)} step={10} min={-2000} max={2000} onChange={(n) => setParam('frontBasketOffsetX', n)} />
          <NumField label="Offset Y" value={Number(params.frontBasketOffsetY ?? 0)} step={10} min={-2000} max={2000} onChange={(n) => setParam('frontBasketOffsetY', n)} />
        </div>
        <div className="group-title2">Back layer</div>
        <div className="grid2">
          <NumField label="Width" value={Number(params.backBasketWidth ?? 300)} step={10} min={50} max={3000} onChange={(n) => setParam('backBasketWidth', n)} />
          <NumField label="Height" value={Number(params.backBasketHeight ?? 150)} step={10} min={50} max={3000} onChange={(n) => setParam('backBasketHeight', n)} />
        </div>
        <div className="grid2">
          <NumField label="Offset X" value={Number(params.backBasketOffsetX ?? 0)} step={10} min={-2000} max={2000} onChange={(n) => setParam('backBasketOffsetX', n)} />
          <NumField label="Offset Y" value={Number(params.backBasketOffsetY ?? 0)} step={10} min={-2000} max={2000} onChange={(n) => setParam('backBasketOffsetY', n)} />
        </div>
        <Row label="Back layer follows">
          <Select
            value={String(params.basketLocked ?? 'Locked')}
            onChange={(v) => setParam('basketLocked', v)}
            options={[
              { value: 'Locked', label: 'Basket movement' },
              { value: 'Unlocked', label: 'Footer center' },
            ]}
          />
        </Row>
      </Accordion>

      <Accordion id="inspector.catch.caughtLayout" title="Caught Item Layout" defaultOpen={false}>
        <NumberListEditor label="X positions" value={params.caughtItemXs} defaultValue={0} step={5} onChange={(v) => setParam('caughtItemXs', v)} />
        <NumberListEditor label="Y positions" value={params.caughtItemYs} defaultValue={0} step={5} onChange={(v) => setParam('caughtItemYs', v)} />
        <NumberListEditor label="Rotations" value={params.caughtItemAngles} defaultValue={0} step={5} onChange={(v) => setParam('caughtItemAngles', v)} />
        <NumberListEditor label="Scales" value={params.caughtItemScales} defaultValue={0.7} step={0.05} min={0.05} max={5} onChange={(v) => setParam('caughtItemScales', v)} />
        <NumField label="Layer" value={Number(params.caughtItemZIndex ?? 1)} step={1} min={-10} max={10} onChange={(n) => setParam('caughtItemZIndex', n)} />
      </Accordion>

      <CatchPopupControls params={params} setParam={setParam} />

      <Accordion id="inspector.catch.preview" title="Editor Preview" defaultOpen={false}>
        <Toggle label="Show caught items" checked={!!params.showCaughtItemsPreview} onChange={(v) => setParam('showCaughtItemsPreview', v)} />
        <Toggle label="Show catch effects" checked={!!params.showPopupPreview} onChange={(v) => setParam('showPopupPreview', v)} />
      </Accordion>
    </>
  )
}

interface CatchPopupControlsProps {
  params: Record<string, unknown>
  setParam: (k: string, v: unknown) => void
}

function CatchPopupControls({ params, setParam }: CatchPopupControlsProps): JSX.Element | null {
  const rawItemTypes = Number(params.itemTypes)
  const popupImages = Array.isArray(params.popupImages) ? (params.popupImages as string[]) : []

  const popupConfigsStr = String(params.popupConfigs || '[]')
  let popupConfigs: any[] = []
  try {
    popupConfigs = JSON.parse(popupConfigsStr)
  } catch (e) {
    popupConfigs = []
  }

  const itemTypes = Number.isFinite(rawItemTypes) && rawItemTypes > 0 ? rawItemTypes : 0
  const effectCount = Math.max(1, itemTypes, popupImages.length, popupConfigs.length)

  const updateConfig = (idx: number, patch: any) => {
    const next = [...popupConfigs]
    next[idx] = { ...(next[idx] || {}), ...patch }
    setParam('popupConfigs', JSON.stringify(next))
  }

  return (
    <>
      <Accordion id="inspector.catch.effects" title="Catch Effects" defaultOpen={false}>
        {Array.from({ length: effectCount }).map((_, i) => {
          const conf = popupConfigs[i] || {}
          return (
            <Accordion key={i} id={`inspector.catchPopup${i}`} title={`Effect ${i + 1}`} defaultOpen={false}>
              <AssetPicker
                label="Image"
                value={popupImages[i] || undefined}
                allowNone
                onChange={(aid) => {
                  const pImages = [...popupImages]
                  pImages[i] = aid ?? ''
                  setParam('popupImages', pImages)
                }}
              />
              <Row label="Trigger">
                <Select
                  value={conf.trigger ?? 'unique'}
                  onChange={(v) => updateConfig(i, { trigger: v })}
                  options={[
                    { value: 'any', label: 'On any catch' },
                    { value: 'unique', label: 'On unique item catch' },
                  ]}
                />
              </Row>
              <div className="grid2">
                <NumField label="X" value={conf.x ?? 540} step={10} onChange={(n) => updateConfig(i, { x: n })} />
                <NumField label="Y" value={conf.y ?? 960} step={10} onChange={(n) => updateConfig(i, { y: n })} />
              </div>
              <div className="grid2">
                <NumField label="Scale" value={conf.scale ?? 1} step={0.1} min={0.1} max={5} onChange={(n) => updateConfig(i, { scale: n })} />
                <NumField label="Rotation" value={conf.angle ?? 0} step={5} onChange={(n) => updateConfig(i, { angle: n })} />
              </div>
              <div className="grid2">
                <NumField label="Layer" value={conf.zIndex ?? 10000} step={1} onChange={(n) => updateConfig(i, { zIndex: n })} />
                <NumField label="Opacity" value={conf.opacity ?? 1} step={0.1} min={0} max={1} onChange={(n) => updateConfig(i, { opacity: n })} />
              </div>
              <Row label="Animation">
                <Select
                  value={conf.anim ?? 'pop'}
                  onChange={(v) => updateConfig(i, { anim: v })}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'fade', label: 'Fade' },
                    { value: 'slide-up', label: 'Slide up' },
                    { value: 'slide-down', label: 'Slide down' },
                    { value: 'slide-left', label: 'Slide left' },
                    { value: 'slide-right', label: 'Slide right' },
                    { value: 'pop', label: 'Pop' },
                    { value: 'bounce', label: 'Bounce' },
                    { value: 'spin', label: 'Spin' },
                  ]}
                />
              </Row>
              <div className="grid2">
                <NumField label="Duration ms" value={conf.durationMs ?? 600} step={50} min={0} onChange={(n) => updateConfig(i, { durationMs: n })} />
                <NumField label="Delay ms" value={conf.delayMs ?? 0} step={50} min={0} onChange={(n) => updateConfig(i, { delayMs: n })} />
              </div>
              <Row label="Easing">
                <Select
                  value={conf.easing ?? 'cubic-bezier(.34,1.56,.64,1)'}
                  onChange={(v) => updateConfig(i, { easing: v })}
                  options={EASINGS.map((e) => ({ value: e.value, label: e.label }))}
                />
              </Row>
              <Row label="Repeat">
                <Select
                  value={String(conf.iterations ?? 1)}
                  onChange={(v) => updateConfig(i, { iterations: v === 'infinite' ? 'infinite' : Number(v) })}
                  options={[
                    { value: '1', label: 'Once' },
                    { value: '2', label: 'Twice' },
                    { value: '3', label: '3 times' },
                    { value: 'infinite', label: 'Loop' },
                  ]}
                />
              </Row>
            </Accordion>
          )
        })}
      </Accordion>
    </>
  )
}

export function Inspector(props: { onProjectSettings: () => void }): JSX.Element {
  const state = useEditorState()
  const [sceneTranslationId, setSceneTranslationId] = useState<string | null>(null)
  const editLocale = useEditLocale()
  const activeVariant = useActiveVariant()
  const variantName = state.project.meta.variants?.find((v) => v.id === activeVariant)?.name
  const variantBanner = activeVariant ? (
    <div className="variant-banner">
      Editing variant: <b>{variantName ?? activeVariant}</b>
      <button
        onClick={() => {
          setActiveVariant(null)
          refreshScene()
        }}
      >
        Done
      </button>
    </div>
  ) : null
  const landscape = state.orientation === 'landscape'

  if (state.selectedIds.length > 1) {
    const anyGroup = state.scene.elements.some((e) => state.selectedIds.includes(e.id) && e.groupId)
    // Animation controls edit all selected elements at once. The rows display the
    // first selected element's spec; any change writes that same spec to every
    // selected element, so identical timing makes them animate in sync as a group.
    const first = state.scene.elements.find((e) => e.id === state.selectedIds[0]) ?? state.scene.elements.find((e) => state.selectedIds.includes(e.id))
    const patchAllPhase = (
      phase: 'entrance' | 'loop' | 'exit' | 'gameWin' | 'tap' | 'thoughtSpawn' | 'thoughtWhack' | 'comboPick' | 'comboDrop' | 'comboNext',
      primary: AnimSpec | undefined,
      extra: AnimSpec[],
    ): void => {
      beginTransaction()
      for (const id of state.selectedIds) {
        const e = state.scene.elements.find((x) => x.id === id)
        if (!e) continue
        const legacyWin = e.animations?.entrance?.trigger === 'onGameWin'
        const legacyWinPrimary = legacyWin ? e.animations?.entrance : undefined
        const legacyWinExtra = legacyWin ? e.animations?.entranceExtra : undefined
        patchElement(id, {
          animations: {
            ...(e.animations ?? {}),
            [phase]: primary,
            [`${phase}Extra`]: extra.length ? extra : undefined,
            ...(phase === 'gameWin' && legacyWin ? { entrance: undefined, entranceExtra: undefined } : {}),
            ...(phase === 'entrance' && legacyWin && !e.animations?.gameWin ? { gameWin: legacyWinPrimary, gameWinExtra: legacyWinExtra } : {}),
          },
        })
      }
      endTransaction()
    }
    const legacyWin = first?.animations?.entrance?.trigger === 'onGameWin'
    const firstEntrance = legacyWin ? undefined : first?.animations?.entrance
    const firstEntranceExtra = legacyWin ? undefined : first?.animations?.entranceExtra
    const firstGameWin = first?.animations?.gameWin ?? (legacyWin ? first?.animations?.entrance : undefined)
    const firstGameWinExtra = first?.animations?.gameWinExtra ?? (legacyWin ? first?.animations?.entranceExtra : undefined)
    return (
      <div className="panel inspector">
        {variantBanner}
        <div className="panel-title">{state.selectedIds.length} selected</div>
        <div className="group-title">Align to canvas</div>
        <AlignRow />
        <Accordion id="inspector.multiAnimation" title="Animation (all selected)" defaultOpen={false}>
          <div className="hint pad">
            Applies the same animation(s) to every selected element — stack multiple per phase with “+ Add another”, and they animate together as a group.
          </div>
          <AnimPhase
            title="Entrance"
            primary={firstEntrance}
            extra={firstEntranceExtra}
            presets={ENTRANCE_PRESETS}
            extraPresets={NODE_PRESETS}
            defaultSpec={{ preset: 'slide-up', durationMs: 520, delayMs: 0, easing: 'ease-out' }}
            defaultExtraSpec={{ preset: 'shine', durationMs: 900, delayMs: 0, easing: 'ease-in-out' }}
            onChange={(primary, ex) => patchAllPhase('entrance', primary, ex)}
          />
          <AnimPhase
            title="On game won"
            primary={firstGameWin}
            extra={firstGameWinExtra}
            presets={NODE_PRESETS}
            extraPresets={NODE_PRESETS}
            defaultSpec={{ preset: 'pop', durationMs: 420, delayMs: 0, easing: 'ease-out' }}
            defaultExtraSpec={{ preset: 'shine', durationMs: 900, delayMs: 0, easing: 'ease-in-out' }}
            onChange={(primary, ex) => patchAllPhase('gameWin', primary, ex)}
          />
          <AnimPhase
            title="On tap"
            primary={first?.animations?.tap}
            extra={first?.animations?.tapExtra}
            presets={NODE_PRESETS}
            extraPresets={NODE_PRESETS}
            defaultSpec={{ preset: 'pop', durationMs: 320, delayMs: 0, easing: 'ease-out' }}
            defaultExtraSpec={{ preset: 'shine', durationMs: 900, delayMs: 0, easing: 'ease-in-out' }}
            onChange={(primary, ex) => patchAllPhase('tap', primary, ex)}
          />
          {state.scene.elements.some((e) => e.game?.templateId === 'combo') && (
            <>
              <AnimPhase
                title="On option picked up"
                primary={first?.animations?.comboPick}
                extra={first?.animations?.comboPickExtra}
                presets={NODE_PRESETS}
                extraPresets={NODE_PRESETS}
                defaultSpec={{ preset: 'pop', durationMs: 260, delayMs: 0, easing: 'ease-out' }}
                defaultExtraSpec={{ preset: 'glow', durationMs: 600, delayMs: 0, easing: 'ease-in-out' }}
                onChange={(primary, ex) => patchAllPhase('comboPick', primary, ex)}
              />
              <AnimPhase
                title="On option dropped"
                primary={first?.animations?.comboDrop}
                extra={first?.animations?.comboDropExtra}
                presets={NODE_PRESETS}
                extraPresets={NODE_PRESETS}
                defaultSpec={{ preset: 'pop', durationMs: 320, delayMs: 0, easing: 'ease-out' }}
                defaultExtraSpec={{ preset: 'shine', durationMs: 700, delayMs: 0, easing: 'ease-in-out' }}
                onChange={(primary, ex) => patchAllPhase('comboDrop', primary, ex)}
              />
              <AnimPhase
                title="On next question"
                primary={first?.animations?.comboNext}
                extra={first?.animations?.comboNextExtra}
                presets={NODE_PRESETS}
                extraPresets={NODE_PRESETS}
                defaultSpec={{ preset: 'pop', durationMs: 380, delayMs: 0, easing: 'ease-out' }}
                defaultExtraSpec={{ preset: 'shine', durationMs: 800, delayMs: 0, easing: 'ease-in-out' }}
                onChange={(primary, ex) => patchAllPhase('comboNext', primary, ex)}
              />
            </>
          )}
          {state.scene.elements.some((e) => e.game?.templateId === 'thoughtwhack') && (
            <>
              <AnimPhase
                title="On thought spawn"
                primary={first?.animations?.thoughtSpawn}
                extra={first?.animations?.thoughtSpawnExtra}
                presets={NODE_PRESETS}
                extraPresets={NODE_PRESETS}
                defaultSpec={{ preset: 'pop', durationMs: 320, delayMs: 0, easing: 'ease-out' }}
                defaultExtraSpec={{ preset: 'shine', durationMs: 700, delayMs: 0, easing: 'ease-in-out' }}
                onChange={(primary, ex) => patchAllPhase('thoughtSpawn', primary, ex)}
              />
              <AnimPhase
                title="On thought whack"
                primary={first?.animations?.thoughtWhack}
                extra={first?.animations?.thoughtWhackExtra}
                presets={NODE_PRESETS}
                extraPresets={NODE_PRESETS}
                defaultSpec={{ preset: 'shake', durationMs: 360, delayMs: 0, easing: 'ease-out' }}
                defaultExtraSpec={{ preset: 'glow', durationMs: 650, delayMs: 0, easing: 'ease-in-out' }}
                onChange={(primary, ex) => patchAllPhase('thoughtWhack', primary, ex)}
              />
            </>
          )}
          <AnimPhase
            title="Loop"
            primary={first?.animations?.loop}
            extra={first?.animations?.loopExtra}
            presets={LOOP_PRESETS}
            extraPresets={LOOP_EXTRA_PRESETS}
            defaultSpec={{ preset: 'float', durationMs: 2200, delayMs: 0, easing: 'ease-in-out', iterations: 'infinite' }}
            defaultExtraSpec={{ preset: 'lightray', durationMs: 2400, delayMs: 0, easing: 'ease-in-out', iterations: 'infinite' }}
            onChange={(primary, ex) => patchAllPhase('loop', primary, ex)}
          />
          <AnimPhase
            title="Exit"
            primary={first?.animations?.exit}
            extra={first?.animations?.exitExtra}
            presets={EXIT_PRESETS}
            extraPresets={NODE_PRESETS}
            defaultSpec={{ preset: 'fade-out', durationMs: 300, delayMs: 0, easing: 'ease-in' }}
            defaultExtraSpec={{ preset: 'scale-out', durationMs: 300, delayMs: 0, easing: 'ease-in' }}
            onChange={(primary, ex) => patchAllPhase('exit', primary, ex)}
          />
        </Accordion>
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
    const sd = activeSceneDef(state)
    const adv = sd.advance
    const tr = sd.transition ?? { type: 'fade' as TransitionType, durationMs: 350 }
    const others = state.project.scenes.filter((s) => s.id !== sd.id)
    // 'win'/'custom' are pre-v2 aliases for 'overlay' (see migrate.ts) — tolerated here so an
    // unmigrated project in memory still shows the overlay controls.
    const isOverlayKind = sd.kind === 'overlay' || (sd.kind as string) === 'win' || (sd.kind as string) === 'custom'
    // Acts as the MRAID end card: a real endscene, or an overlay opted into asEndscene.
    const actsAsEndscene = sd.kind === 'endscene' || (isOverlayKind && !!sd.asEndscene)
    return (
      <div className="panel inspector">
        {variantBanner}
        <div className="panel-title">Scene: {sd.name}</div>
        {activeVariant ? (
          <div className="hint pad">
            Scene settings (name, type, background, advance, transition) are <b>base-only</b>; they can"t differ per variant. Click <b>Done</b> above to exit variant mode and edit
            them.
          </div>
        ) : (
          <>
            <Row label="Scene name">
              <input value={sd.name} onChange={(e) => patchSceneDef(sd.id, { name: e.target.value })} />
            </Row>
            <button className="wide primary scene-language-inspector" onClick={() => setSceneTranslationId(sd.id)}>
              <Icon icon={Languages} size={15} />
              {Object.keys(sd.localeOverrides ?? {}).length ? `Language versions (${Object.keys(sd.localeOverrides ?? {}).join(', ')})` : '+ Add language version for this scene'}
            </button>
            {sceneTranslationId === sd.id && <SceneTranslationModal sceneId={sd.id} onClose={() => setSceneTranslationId(null)} />}
            <div className="scene-meta-row">
              <Row label="Type">
                <Select
                  value={(sd.kind as string) === 'win' || (sd.kind as string) === 'custom' ? 'overlay' : (sd.kind ?? 'overlay')}
                  // asEndscene only means anything on an overlay — drop it on the way out so a
                  // scene switched to game/endscene and back doesn't silently come back terminal.
                  onChange={(v) => patchSceneDef(sd.id, { kind: v as SceneKind, ...(v === 'overlay' ? {} : { asEndscene: undefined }) })}
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
            {isOverlayKind && <Toggle label="Also the MRAID end card" checked={!!sd.asEndscene} onChange={(v) => patchSceneDef(sd.id, { asEndscene: v || undefined })} />}
            {isOverlayKind && sd.asEndscene && (
              <div className="hint pad">
                This overlay <b>is</b> the end card. It stays floated over the finished game — the dim/blur shows the board through — and gets the endscene wrap: tap anywhere to
                install, <b>gameEnd</b> signalled to the network, no date header unless you turn it on below. It is
                <b> terminal</b>, so its Advance rule below is ignored: nothing dismisses it and it never continues to another scene.
              </div>
            )}
            {state.scene.meta.header && !actsAsEndscene && (
              <Toggle label="Hide date header in this scene" checked={!!sd.hideHeader} onChange={(v) => patchSceneDef(sd.id, { hideHeader: v || undefined })} />
            )}
            {state.scene.meta.header && actsAsEndscene && (
              <>
                <Toggle label="Show date header on this end card" checked={!!sd.showHeader} onChange={(v) => patchSceneDef(sd.id, { showHeader: v || undefined })} />
                <div className="hint pad">End cards hide the pinned date/countdown header by default. Turn this on to band it across the end card too — it stays tap-through, so the whole card still clicks out.</div>
              </>
            )}
            {/* Per-scene header LAYOUT — two independent switches, one per orientation.
                Each owns a complete snapshot of the layout, so an opted-in scene/orientation
                can never be moved by the project header or by another scene. Everything
                goes through src/headerLayout.ts. */}
            {state.scene.meta.header && headerAllowedFor(sd) && (() => {
              const projectHeader = state.scene.meta.header!
              const orient: Orient = landscape ? 'landscape' : 'portrait'
              const other: Orient = landscape ? 'portrait' : 'landscape'
              const owns = ownsSlot(sd.header, orient)
              const eff = resolvedLayout(projectHeader, sd.header, orient)
              // Any field edit lands in THIS scene's THIS-orientation slot (seeded on first
              // touch so it is a full snapshot, never a half-inherited override).
              const setHeaderLayout = (patch: HeaderOrientationOverride): void =>
                patchSceneDef(sd.id, { header: patchSlot(projectHeader, sd.header, orient, patch) })
              return (
                <>
                  <div className="group-title">Header in this scene ({orient})</div>
                  <Toggle
                    label={`Own header layout in ${orient}`}
                    checked={owns}
                    onChange={(v) =>
                      patchSceneDef(sd.id, { header: v ? withOwnSlot(projectHeader, sd.header, orient) : withoutSlot(sd.header, orient) })
                    }
                  />
                  {!owns && (
                    <div className="hint pad">
                      This scene follows the project header in {orient}. Turn this on — or just drag the band on the canvas — and it keeps a copy of what it shows now: from then on
                      nothing you change in the Header popover, or in another scene, can move it here.
                    </div>
                  )}
                  {owns && (
                    <>
                      <div className="grid2">
                        <NumField label="Move X" value={eff.offsetXPx ?? 0} suffix="px" onChange={(n) => setHeaderLayout({ offsetXPx: n || undefined })} />
                        <NumField label="Move Y" value={eff.offsetYPx ?? 0} suffix="px" onChange={(n) => setHeaderLayout({ offsetYPx: n || undefined })} />
                      </div>
                      <div className="grid2">
                        <NumField label="Font size" value={eff.fontSizePx ?? 64} min={1} suffix="px" onChange={(n) => setHeaderLayout({ fontSizePx: n })} />
                        <NumField label="Height" value={eff.heightPx ?? 120} min={0} suffix="px" onChange={(n) => setHeaderLayout({ heightPx: n })} />
                      </div>
                      <Row label="Alignment">
                        <Select
                          value={eff.align ?? 'center'}
                          options={[
                            { value: 'left', label: 'Left' },
                            { value: 'center', label: 'Center' },
                            { value: 'right', label: 'Right' },
                          ]}
                          onChange={(v) => setHeaderLayout({ align: v as HeaderOrientationOverride['align'] })}
                        />
                      </Row>
                      <button
                        className="wide"
                        onClick={() => {
                          patchHeader(projectLayoutPatch(projectHeader, orient, seedSlot(projectHeader, sd.header, orient)), editLocale)
                          patchSceneDef(sd.id, { header: withoutSlot(sd.header, orient) })
                        }}
                      >
                        Use this {orient} layout in every scene
                      </button>
                      <button className="wide" onClick={() => patchSceneDef(sd.id, { header: withoutSlot(sd.header, orient) })}>
                        Follow the project header again in {orient}
                      </button>
                    </>
                  )}
                  <div className="hint pad">
                    {other} is {ownsSlot(sd.header, other) ? <>this scene’s own too — switch the frame’s orientation chip to edit it</> : <>following the project header</>}. The two
                    orientations are stored separately, so one never changes the other. Content, colours and animation always come from the project header.
                  </div>
                </>
              )
            })()}
            {sd.kind === 'endscene' && (
              <div className="hint pad">
                Endscene = MRAID <b>end card</b>: in Preview/export the whole scene is tap-to-install and signals the network the ad ended. Add a <b>video endscene</b> element for
                a video card, or just build it like any scene (product + pulsing CTA) for a <b>coded</b> end card; both get the MRAID wrap.
              </div>
            )}

            {(sd.kind === 'overlay' || (sd.kind as string) === 'win' || (sd.kind as string) === 'custom') &&
              (() => {
                const ov: SceneOverlay = sd.overlay ?? {}
                const setOv = (patch: Partial<SceneOverlay>) => patchSceneDef(sd.id, { overlay: { ...ov, ...patch } })
                return (
                  <>
                    <div className="group-title">Dim / blur overlay</div>
                    <div className="hint pad" style={{ marginBottom: 4 }}>
                      Full-screen overlay rendered behind all scene elements. Uses an oversized div so edges are always off-screen; no edge artifacts on AppLovin.
                    </div>
                    <Row label="Fill">
                      <Select
                        value={ov.fillMode ?? 'solid'}
                        onChange={(v) => setOv({ fillMode: v === 'solid' ? undefined : (v as 'radial') })}
                        options={[
                          { value: 'solid', label: 'Solid' },
                          { value: 'radial', label: 'Radial' },
                        ]}
                      />
                    </Row>
                    <Slider
                      label={ov.fillMode === 'radial' ? 'Fill opacity' : 'Dim opacity'}
                      value={(ov.opacity ?? 0) * 100}
                      min={0}
                      max={100}
                      step={5}
                      suffix="%"
                      onChange={(n) => setOv({ opacity: n / 100 || undefined })}
                    />
                    <ColorField label={ov.fillMode === 'radial' ? 'Center color' : 'Color'} value={ov.color ?? '#000000'} onChange={(c) => setOv({ color: c ?? '#000000' })} />
                    {ov.fillMode === 'radial' && (
                      <>
                        <ColorField label="Edge color (empty = fade out)" value={ov.color2} allowNone onChange={(c) => setOv({ color2: c ?? undefined })} />
                        <Slider
                          label="Radial strength"
                          value={ov.radialStrength ?? 50}
                          min={0}
                          max={100}
                          step={5}
                          suffix="%"
                          onChange={(n) => setOv({ radialStrength: n === 50 ? undefined : n })}
                        />
                      </>
                    )}
                    <NumField label="Blur px" value={ov.blurPx ?? 0} step={1} min={0} max={30} onChange={(n) => setOv({ blurPx: n || undefined })} />
                    {(ov.blurPx ?? 0) > 0 && (
                      <>
                        <Row label="Falloff">
                          <Select
                            value={ov.blurMode ?? 'uniform'}
                            onChange={(v) => setOv({ blurMode: v === 'uniform' ? undefined : (v as 'progressive' | 'radial') })}
                            options={[
                              { value: 'uniform', label: 'Uniform' },
                              { value: 'progressive', label: 'Progressive' },
                              { value: 'radial', label: 'Radial' },
                            ]}
                          />
                        </Row>
                        {ov.blurMode === 'progressive' && (
                          <Row label="Direction">
                            <Select
                              value={ov.blurDir ?? 'down'}
                              onChange={(v) => setOv({ blurDir: v === 'down' ? undefined : (v as 'up' | 'left' | 'right') })}
                              options={[
                                { value: 'down', label: 'Top → bottom' },
                                { value: 'up', label: 'Bottom → top' },
                                { value: 'left', label: 'Right → left' },
                                { value: 'right', label: 'Left → right' },
                              ]}
                            />
                          </Row>
                        )}
                      </>
                    )}
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
              <NumField
                label="Delay (ms)"
                value={adv.delayMs ?? (adv.on === 'timer' ? 2000 : 0)}
                step={100}
                onChange={(n) => patchSceneDef(sd.id, { advance: { ...adv, delayMs: n } })}
              />
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

            <div className="group-title">Landscape layout</div>
            {(() => {
              const withLs = sd.elements.filter((e) => e.landscape && Object.keys(e.landscape).length > 0).length
              return (
                <>
                  <div className="hint pad">
                    Every element can hold its own <b>landscape</b> position &amp; size — same assets, same animations, only the layout differs. Toggle <b>Landscape</b> in the top
                    bar and drag/resize; those edits never touch portrait.{' '}
                    {withLs > 0 ? (
                      <>
                        <b>
                          {withLs}/{sd.elements.length}
                        </b>{' '}
                        elements carry landscape overrides in this scene.
                      </>
                    ) : (
                      <>No overrides yet — landscape currently mirrors the portrait layout.</>
                    )}
                  </div>
                  <button
                    className="wide"
                    onClick={() => {
                      seedLandscapeLayout()
                      setOrientation('landscape')
                    }}
                  >
                    Create separate landscape layout (opens landscape)
                  </button>
                  <div className="hint pad">
                    Snapshots the current portrait layout into landscape for <b>every element</b>, so the two orientations become fully independent — after this, moving things in
                    portrait won’t shift landscape. Reused elements keep their landscape layout when copied to another scene.
                  </div>
                  {withLs > 0 && (
                    <button className="wide danger" onClick={clearLandscapeLayout}>
                      Reset landscape — follow portrait again
                    </button>
                  )}
                </>
              )
            })()}

            <div className="group-title" />
            <ReuseFromScene sceneId={sd.id} scenes={state.project.scenes} />
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

  const localizedEl = localizeElement(el, editLocale)
  const ov = landscape ? (localizedEl.landscape ?? {}) : {}
  const g = {
    x: ov.x ?? localizedEl.x,
    y: ov.y ?? localizedEl.y,
    scale: ov.scale ?? localizedEl.scale ?? 1,
    w: ov.w ?? localizedEl.w,
    h: ov.h ?? localizedEl.h,
    anchor: ov.anchor ?? localizedEl.anchor,
    mode: ov.mode ?? localizedEl.mode,
  }
  const id = el.id
  const legacyWinAnim = el.animations?.entrance?.trigger === 'onGameWin'
  const entranceAnim = legacyWinAnim ? undefined : el.animations?.entrance
  const entranceExtra = legacyWinAnim ? undefined : el.animations?.entranceExtra
  const gameWinAnim = el.animations?.gameWin ?? (legacyWinAnim ? el.animations?.entrance : undefined)
  const gameWinExtra = el.animations?.gameWinExtra ?? (legacyWinAnim ? el.animations?.entranceExtra : undefined)
  const patchEntranceAnimations = (patch: Partial<AnimSpec> | null): void => {
    const nextEntrance = patch === null ? undefined : { ...(entranceAnim ?? { preset: 'fade' as AnimSpec['preset'], durationMs: 520, delayMs: 0, easing: 'ease-out' }), ...patch }
    patchElement(id, {
      animations: {
        ...(el.animations ?? {}),
        entrance: nextEntrance,
        entranceExtra: patch === null ? undefined : entranceExtra,
        ...(legacyWinAnim && !el.animations?.gameWin ? { gameWin: el.animations?.entrance, gameWinExtra: el.animations?.entranceExtra } : {}),
      },
    })
  }
  const patchGameWinAnimations = (primary: AnimSpec | undefined, extra: AnimSpec[]): void => {
    patchElement(id, {
      animations: {
        ...(el.animations ?? {}),
        gameWin: primary,
        gameWinExtra: extra.length ? extra : undefined,
        ...(legacyWinAnim ? { entrance: undefined, entranceExtra: undefined } : {}),
      },
    })
  }
  const setText = (patch: Partial<TextConfig>): void => patchElement(id, { text: { ...(el.text ?? { value: '', fontSizePx: 48 }), ...patch } })
  const setBox = (patch: Partial<BoxStyle>): void => patchElement(id, { box: { ...(el.box ?? {}), ...patch } })
  // Scene-timeline window. `durationMs: undefined` in the patch is meaningful — it
  // reopens the clip ("stays until the scene ends") — so this spreads rather than
  // filtering out undefined the way the ?? setters above do.
  const setTiming = (patch: Partial<TimingConfig>): void => patchElement(id, { timing: { ...(el.timing ?? { inMs: 0 }), ...patch } })
  // Same deal as setTiming — `durationMs: undefined` is meaningful here too (it hands
  // control back to the chars-per-second speed), so this spreads rather than filters.
  const isTextOrCta = el.type === 'text' || el.type === 'cta' || el.type === 'button' || el.type === 'choice'
  // countdown is styled like text (font/colour/box), so it shares those sections
  const hasTextStyle = isTextOrCta || el.type === 'countdown'
  // asset-ish elements can take a stroke/frame (border + radius + padding) too
  const canStroke = el.type === 'image' || el.type === 'bar' || el.type === 'game-mount' || el.type === 'handguide'
  // content elements can be a scratch cover and/or a reveal target
  const canScratch = el.type === 'image' || el.type === 'bar' || el.type === 'text' || el.type === 'cta' || el.type === 'handguide'
  const sceneHasCatch = activeSceneDef(state)?.elements.some((e) => e.game?.templateId === 'catch') ?? false
  // A flipbook in the scene lets any element be bound to one of its pages. Page 1 is
  // the shut cover when the book has one, then one page per opening.
  const flipbookEl = activeSceneDef(state)?.elements.find((e) => e.game?.templateId === 'flipbook')
  const bookPages = flipbookEl ? (flipbookEl.game?.params?.hasCover === false ? 0 : 1) + Math.max(1, Math.min(6, Number(flipbookEl.game?.params?.spreads ?? 2))) : 0
  const canIdleBehavior = el.type === 'image' || el.type === 'handguide' || (el.type === 'bar' && el.mode === 'fit')
  const setScratch = (patch: Partial<NonNullable<SceneElement['scratch']>>): void => patchElement(id, { scratch: { ...(el.scratch ?? {}), ...patch } })
  const setReveal = (patch: Partial<NonNullable<SceneElement['reveal']>>): void => patchElement(id, { reveal: { ...(el.reveal ?? {}), ...patch } })
  const setCrop = (patch: Partial<NonNullable<SceneElement['crop']>>): void => patchElement(id, { crop: { ...(el.crop ?? {}), ...patch } })
  // Turning crop on seeds an explicit w/h box (from the current display size, matching
  // the image's aspect) so the source fills it exactly, then opens the on-canvas editor.
  const enableCrop = (): void => {
    beginTransaction()
    if (g.w == null || g.h == null) {
      const a = state.assets[el.assetId ?? '']
      const sc = g.scale || 1
      const w = Math.max(1, Math.round((a?.w ?? 300) * sc))
      const h = Math.max(1, Math.round((a?.h ?? 300) * sc))
      patchGeometry(id, { w, h })
    }
    patchElement(id, { crop: { scale: 1, x: 0, y: 0 } })
    endTransaction()
    window.dispatchEvent(new CustomEvent('pa:crop-edit', { detail: { elementId: id } }))
  }

  const BOX_PRESETS: { key: string; label: string; box: BoxStyle | undefined }[] = [
    { key: 'none', label: 'None', box: undefined },
    { key: 'solid', label: 'Solid', box: { bgColor: '#16a34a', radiusPx: 16, paddingXPx: 44, paddingYPx: 18 } },
    { key: 'pill', label: 'Pill', box: { bgColor: '#16a34a', pill: true, paddingXPx: 52, paddingYPx: 18, shadow: 'soft' } },
    { key: 'outline', label: 'Outline', box: { radiusPx: 14, borderPx: 3, borderColor: '#ffffff', paddingXPx: 40, paddingYPx: 16 } },
    { key: 'soft', label: 'Soft', box: { bgColor: '#ffffff', radiusPx: 26, paddingXPx: 40, paddingYPx: 24, shadow: 'medium' } },
    {
      key: 'glass',
      label: 'Glass',
      box: { bgColor: 'rgba(255,255,255,0.16)', radiusPx: 24, borderPx: 1.5, borderColor: 'rgba(255,255,255,0.55)', paddingXPx: 36, paddingYPx: 20, shadow: 'soft' },
    },
  ]
  const locales = state.project.meta.locales ?? []
  const defaultLanguage = state.project.meta.defaultLocale || 'en'
  const localeOverride = editLocale ? el.localeOverrides?.[editLocale] : undefined
  const hasLocaleText = !!(editLocale && el.text?.i18n && Object.prototype.hasOwnProperty.call(el.text.i18n, editLocale))
  const canLocalizeAsset =
    !!el.assetId ||
    el.type === 'image' ||
    el.type === 'background' ||
    el.type === 'bar' ||
    el.type === 'handguide' ||
    el.type === 'cta' ||
    el.type === 'button' ||
    el.type === 'choice'
  const resetCurrentLanguage = (): void => {
    if (!editLocale) return
    beginTransaction()
    resetLocaleOverride(id, editLocale)
    if (el.text?.i18n && Object.prototype.hasOwnProperty.call(el.text.i18n, editLocale)) {
      const i18n = { ...el.text.i18n }
      delete i18n[editLocale]
      patchElement(id, { text: { ...el.text, i18n: Object.keys(i18n).length ? i18n : undefined } })
    }
    endTransaction()
  }
  return (
    <div className="panel inspector">
      {variantBanner}
      <div className="panel-title">
        {el.type === 'bar' && el.mode === 'fit' ? 'rectangle' : el.type} {editLocale && <span className="badge">{editLocale}</span>}{' '}
        {landscape && <span className="badge">landscape</span>}
      </div>

      <Row label="Name (layers)">
        <input value={el.name ?? ''} onChange={(e) => patchElement(id, { name: e.target.value })} />
      </Row>

      <div className="group-title">Languages</div>
      {locales.length ? (
        <>
          <Chips
            items={[
              { key: '', label: `Default (${defaultLanguage})`, active: !editLocale, onClick: () => setEditLocale(null) },
              ...locales.map((locale) => ({ key: locale, label: locale, active: editLocale === locale, onClick: () => setEditLocale(locale) })),
            ]}
          />
          {editLocale ? (
            <>
              {canLocalizeAsset && (
                <AssetPicker
                  label={`${editLocale} asset (optional)`}
                  allowNone
                  value={localeOverride?.assetId}
                  onChange={(assetId) => setLocaleAsset(id, editLocale, assetId ?? undefined)}
                />
              )}
              <div className="hint pad">
                Drag, resize, or edit Position below to save a{' '}
                <b>
                  {editLocale} {landscape ? 'landscape' : 'portrait'}
                </b>{' '}
                layout. Unset asset and layout fields automatically use the default ({defaultLanguage}) element.
              </div>
              {(localeOverride || hasLocaleText) && (
                <button className="wide" onClick={resetCurrentLanguage}>
                  Reset {editLocale} to default ({defaultLanguage})
                </button>
              )}
            </>
          ) : (
            <div className="hint pad">This is the default ({defaultLanguage}) element. Pick a language above to add only the differences.</div>
          )}
        </>
      ) : (
        <>
          <div className="hint pad">No extra build languages yet. The default is {defaultLanguage}.</div>
          <button className="wide" onClick={props.onProjectSettings}>
            Choose build languages…
          </button>
        </>
      )}
      {!activeVariant && <Toggle label="Lock element" checked={!!el.locked} onChange={() => toggleLock(id)} />}
      <Toggle label="Show on game win" checked={!!el.showOnWin} onChange={(v) => patchElement(id, { showOnWin: v })} />
      {(el.type === 'text' || el.type === 'image' || (el.type === 'bar' && el.mode === 'fit')) && sceneHasCatch && (
        <Toggle label="Show after basket moved" checked={!!el.showAfterInteraction} onChange={(v) => patchElement(id, { showAfterInteraction: v || undefined })} />
      )}
      {el.type !== 'cta' && <Toggle label="Above overlays" checked={!!el.overlayImmune} onChange={(v) => patchElement(id, { overlayImmune: v || undefined })} />}
      <Toggle label="Above other overlays (top layer)" checked={!!el.overlayTop} onChange={(v) => patchElement(id, { overlayTop: v || undefined })} />
      <Toggle label="Hide on overlay" checked={!!el.hideOnOverlay} onChange={(v) => patchElement(id, { hideOnOverlay: v || undefined })} />
      {CARRY_OVER_TYPES.has(el.type) && (
        <>
          <Toggle label="Carry across scenes" checked={!!el.persist} onChange={(v) => patchElement(id, { persist: v || undefined, persistScenes: undefined })} />
          {el.persist && (
            <>
              <div className="hint pad">
                Built once, above every scene — a scene change never rebuilds it, so the pulse (and any loop animation) runs straight through the transition instead of cutting.
                Untick a scene to fade it out there. The canvas still shows it only on this scene; Preview shows the rest.
              </div>
              {state.project.scenes.map((s) => {
                const shown = !el.persistScenes?.length || el.persistScenes.includes(s.id)
                return (
                  <Toggle
                    key={s.id}
                    label={`Show on “${s.name || s.id}”`}
                    checked={shown}
                    onChange={(v) => {
                      const all = state.project.scenes.map((x) => x.id)
                      const cur = el.persistScenes?.length ? el.persistScenes : all
                      const next = all.filter((x) => (x === s.id ? v : cur.includes(x)))
                      // Every scene ticked === the default, so store nothing.
                      patchElement(id, { persistScenes: next.length === all.length ? undefined : next })
                    }}
                  />
                )
              })}
            </>
          )}
        </>
      )}
      {bookPages > 0 && el.type !== 'game-mount' && (
        <Row label="Only on book page">
          <Select
            value={String(el.showOnPage ?? 0)}
            onChange={(v) => patchElement(id, { showOnPage: Number(v) || undefined })}
            options={[
              { value: '0', label: 'Every page' },
              ...Array.from({ length: bookPages }, (_, i) => ({
                value: String(i + 1),
                label: `Page ${i + 1}${i === 0 && flipbookEl?.game?.params?.hasCover !== false ? ' (cover)' : ''}`,
              })),
            ]}
          />
        </Row>
      )}

      {/* Per-orientation visibility: base `hidden` + landscape override `landscape.hidden`.
          The canvas reflects it live — the element only renders in the orientation(s) it
          shows in (reselect a hidden one via the Layers panel). */}
      {(() => {
        const baseHidden = !!el.hidden
        const lsHidden = el.landscape?.hidden ?? baseHidden
        const mode: 'both' | 'portrait' | 'landscape' | 'none' =
          !baseHidden && !lsHidden ? 'both' : !baseHidden && lsHidden ? 'portrait' : baseHidden && !lsHidden ? 'landscape' : 'none'
        const setMode = (m: 'both' | 'portrait' | 'landscape'): void => {
          const { hidden: _drop, ...restLs } = el.landscape ?? {}
          if (m === 'both') patchElement(id, { hidden: undefined, landscape: el.landscape ? restLs : undefined })
          else if (m === 'portrait') patchElement(id, { hidden: undefined, landscape: { ...restLs, hidden: true } })
          else patchElement(id, { hidden: true, landscape: { ...restLs, hidden: false } })
        }
        return (
          <>
            <Row label="Show in">
              <Chips
                items={[
                  { key: 'both', label: 'Both', active: mode === 'both', onClick: () => setMode('both') },
                  { key: 'portrait', label: 'Portrait only', active: mode === 'portrait', onClick: () => setMode('portrait') },
                  { key: 'landscape', label: 'Landscape only', active: mode === 'landscape', onClick: () => setMode('landscape') },
                ]}
              />
            </Row>
            {mode !== 'both' && (
              <div className="hint pad">
                {mode === 'none'
                  ? 'Currently hidden in BOTH orientations (Layers eye + landscape override) — pick a mode above to show it again.'
                  : mode === 'portrait'
                    ? 'Only rendered while the ad is in portrait. On the canvas it disappears in landscape view; reselect it from the Layers panel.'
                    : 'Only rendered while the ad is in landscape. On the canvas it disappears in portrait view; reselect it from the Layers panel.'}
              </div>
            )}
          </>
        )
      })()}

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
          {el.sync && <div className="hint pad">Shared across all MIPs in this project; edits here (position, size, text, style, everything) apply to every MIP.</div>}
        </>
      )}

      {!activeVariant &&
        el.type !== 'game-mount' &&
        el.type !== 'endscene' &&
        (() => {
          const curKey: ConvertTo = el.type === 'bar' ? (el.mode === 'fit' ? 'rect' : 'bar') : (el.type as ConvertTo)
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
        <button className="wide" onClick={() => (editLocale ? resetLocaleLayout(id, editLocale, 'landscape') : patchElement(id, { landscape: undefined }))}>
          Reset {editLocale ? `${editLocale} ` : ''}landscape overrides
        </button>
      )}

      <div className="group-title">Position {editLocale ? `(${editLocale}, ${landscape ? 'landscape' : 'portrait'})` : landscape ? '(landscape)' : ''}</div>
      {editLocale && !landscape && localeOverride?.portrait && (
        <button className="wide" onClick={() => resetLocaleLayout(id, editLocale, 'portrait')}>
          Reset {editLocale} portrait layout
        </button>
      )}
      <div className="grid2">
        <NumField label="X" value={g.x} suffix="px" onChange={(n) => patchGeometry(id, { x: n })} />
        <NumField label="Y" value={g.y} suffix="px" onChange={(n) => patchGeometry(id, { y: n })} />
      </div>
      {el.type === 'text' || el.type === 'countdown' || el.type === 'background' || el.type === 'confetti' || (el.type === 'endscene' && g.mode === 'extend') ? null : el.type ===
          'bar' && g.mode === 'extend' ? (
        <NumField label="Height" value={g.h} suffix="px" onChange={(n) => patchGeometry(id, { h: n })} />
      ) : g.w != null && g.h != null ? (
        <div className="grid2">
          <NumField label="W" value={g.w} suffix="px" onChange={(n) => patchGeometry(id, { w: n })} />
          <NumField label="H" value={g.h} suffix="px" onChange={(n) => patchGeometry(id, { h: n })} />
        </div>
      ) : (
        <NumField label="Scale" value={g.scale} step={0.01} onChange={(n) => patchGeometry(id, { scale: n })} />
      )}
      {
        <div className="grid2" style={{ marginTop: 4 }}>
          <NumField label="Angle" value={el.rotation ?? 0} suffix="°" onChange={(n) => patchElement(id, { rotation: n === 0 ? undefined : n })} />
        </div>
      }
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
      {(el.type === 'cta' || el.type === 'image' || el.type === 'button' || el.type === 'handguide' || el.type === 'bar') && (
        <Toggle label="Relative to footer" checked={!!el.relativeToBasketBar} onChange={(v) => patchElement(id, { relativeToBasketBar: v })} />
      )}

      {canIdleBehavior &&
        (() => {
          const idle = el.idle ?? (el.type === 'handguide' ? el.handguide : undefined) ?? {}
          const setIdle = (patch: any): void => patchElement(id, { idle: { ...idle, ...patch } })
          return (
            <Accordion id="inspector.idle" title="Idle behavior">
              <Toggle label="Hide on tap" checked={idle.hideOnInteract !== false} onChange={(v) => setIdle({ hideOnInteract: v })} />
              <Toggle label="Reappear when idle" checked={idle.reappearOnIdle !== false} onChange={(v) => setIdle({ reappearOnIdle: v })} />
              {idle.reappearOnIdle !== false && <NumField label="Reappear after (ms)" value={idle.idleMs ?? 4000} step={500} min={0} onChange={(n) => setIdle({ idleMs: n })} />}
              <Toggle label="Show at start (before first tap)" checked={idle.showInitially !== false} onChange={(v) => setIdle({ showInitially: v })} />
              {sceneHasCatch && (
                <Toggle
                  label="Hide after basket tap / drag"
                  checked={!!el.hideAfterBasketInteraction}
                  onChange={(v) => patchElement(id, { hideAfterBasketInteraction: v || undefined })}
                />
              )}
              <div className="hint pad">
                Animates in Preview and export. By default it hides on the player's first tap and reappears after {idle.idleMs ?? 4000}ms of no interaction.
              </div>
            </Accordion>
          )
        })()}

      {el.type === 'game-mount' &&
        (() => {
          const tpl = GAME_TEMPLATES.find((t) => t.id === (el.game?.templateId ?? 'match')) ?? GAME_TEMPLATES[0]
          const params: Record<string, unknown> = { ...tpl.defaultParams, ...(el.game?.params ?? {}) }
          const setParams = (patch: Record<string, unknown>): void =>
            patchElement(id, { game: { ...(el.game ?? { templateId: tpl.id, params: {} }), templateId: tpl.id, params: { ...params, ...patch } } })
          // Single-key setter must funnel through setParams — two back-to-back setParam calls would
          // each read the same stale `params` snapshot and the second would clobber the first.
          const setParam = (k: string, v: unknown): void => setParams({ [k]: v })
          const cardAspect = el.w && el.h ? el.w / el.h : 1 // for the brush intro-path editor box
          const renderField = (f: ParamField): JSX.Element | null => {
            const v = params[f.key]
            if (f.key === 'randomAngles' && !params.randomizeAngle) return null
            if (f.type === 'number')
              return <NumField key={f.key} label={f.label} value={typeof v === 'number' ? v : 0} step={f.step ?? 1} min={f.min} max={f.max} onChange={(n) => setParam(f.key, n)} />
            if (f.type === 'color')
              return <ColorField key={f.key} label={f.label} value={typeof v === 'string' && v ? v : undefined} allowNone onChange={(c) => setParam(f.key, c ?? '')} />
            if (f.type === 'boolean') return <Toggle key={f.key} label={f.label} checked={!!v} onChange={(b) => setParam(f.key, b)} />
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
                <ScratchGridCells params={params} setParam={setParam} setParams={setParams} elementId={id} cardAspect={cardAspect} />
              ) : (
                <>
                  {tpl.id === 'combo' && <ComboSetup params={params} setParam={setParam} elementId={id} siblings={activeSceneDef(state)?.elements ?? []} />}
                  {tpl.id === 'combo' && <div className="group-title2">Feel &amp; timing</div>}
                  {tpl.id === 'catch' ? (
                    <CatchTemplateInspector params={params} setParam={setParam} />
                  ) : (
                    tpl.paramFields
                      .filter(
                        (f) =>
                          !BRUSH_PARAM_KEYS.has(f.key) &&
                          !(tpl.id === 'scratch' && (f.key === 'coverColor' || f.key === 'shadowColor')) &&
                          // ComboSetup owns the question count, right above its per-question chips.
                          !(tpl.id === 'combo' && f.key === 'questions') &&
                          (f.showIf?.(params) ?? true),
                      )
                      .map(renderField)
                  )}
                  {tpl.id === 'scratch' && (
                    <ColorField
                      label="Cover color (none = transparent)"
                      value={(params.coverColor as string) || undefined}
                      allowNone
                      onChange={(c) => setParam('coverColor', c ?? '')}
                    />
                  )}
                  {tpl.id === 'scratch' && (
                    <ColorField
                      label="Reveal background (none = transparent)"
                      value={(params.revealBgColor as string) || undefined}
                      allowNone
                      onChange={(c) => setParam('revealBgColor', c ?? '')}
                    />
                  )}
                  {tpl.id === 'scratch' && (
                    <ColorField
                      label="Shadow color (none = no shadow)"
                      value={(params.shadowColor as string) || undefined}
                      allowNone
                      onChange={(c) => setParam('shadowColor', c ?? '')}
                    />
                  )}
                  {tpl.id === 'scratch' && (
                    <BrushControls
                      params={params}
                      setParam={setParam}
                      setParams={setParams}
                      brushSrc={state.assets[(params.brushImage as string) || '']?.src ?? ''}
                      radiusLabel="Brush/scratch radius (% of card)"
                      cardAspect={cardAspect}
                    />
                  )}
                  {tpl.id === 'scratch' && (
                    <>
                      <button
                        className="btn"
                        style={{ width: '100%', marginTop: 6 }}
                        onClick={() => window.dispatchEvent(new CustomEvent('pa:zone-edit', { detail: { elementId: id } }))}
                      >
                        Edit reveal zone on canvas
                      </button>
                      <div className="hint pad">
                        Only scratching inside the reveal zone counts toward the threshold — anywhere outside never contributes. Drag the box to move, corner handles to resize. Esc
                        to finish.
                      </div>
                    </>
                  )}
                  {tpl.id === 'scratch' && params.fit === 'fit' && (
                    <div className="hint pad">Double-click the card on the canvas to position &amp; scale the reveal image: drag to move, corner handles to resize.</div>
                  )}
                  {tpl.id === 'holdgauge' && params.stageSfx === true && (
                    <div className="hint pad">
                      Give each stage its own sound in this element&apos;s Sounds section — one trigger per stage the dial can climb into. They only play on the way up; sliding
                      back is silent.
                    </div>
                  )}
                  {tpl.id === 'memorymatch' && params.tracker !== 'off' && (
                    <div className="hint pad">
                      Double-click the game on the canvas to edit the tracker symbols: drag a symbol sideways to nudge it, drag its corner handle to resize (aspect locked — bottoms
                      always stay aligned). Esc or click outside to finish.
                    </div>
                  )}
                  {tpl.id === 'thoughtwhack' && (
                    <>
                      <button
                        className="btn"
                        style={{ width: '100%', marginTop: 6 }}
                        onClick={() => window.dispatchEvent(new CustomEvent('pa:thought-zone-edit', { detail: { elementId: id } }))}
                      >
                        Draw spawn areas + place subject marker
                      </button>
                      <div className="hint pad">
                        Drag empty game space to draw more areas. Drag an area to move it, use its corner handles to resize it, or × to remove it. Place the pink SUBJECT marker
                        over the subject&apos;s head/body anchor; both trailing bubbles always point there. Press Enter or Esc when done.
                      </div>
                      <div className="hint pad">
                        Any scene element can use <b>On thought spawn</b> / <b>On thought whack</b> in its Animation panel and the matching triggers in its Sounds panel.
                      </div>
                      <div className="hint pad">The animated hint hand follows a currently visible, unwhacked thought and retargets after every whack.</div>
                    </>
                  )}
                  {tpl.id === 'basket' && (
                    <>
                      <button
                        className="btn"
                        style={{ width: '100%', marginTop: 6 }}
                        onClick={() => window.dispatchEvent(new CustomEvent('pa:zone-edit', { detail: { elementId: id } }))}
                      >
                        Set basket area on canvas
                      </button>
                      <div className="hint pad">
                        Draw the invisible drop area over the basket artwork. Items keep the position where they are released inside it; a release within the snap border is pulled
                        just inside the area. Every item must be placed to win.
                      </div>
                      <div className="hint pad">
                        Prefer freeform items? Select any normal image and enable <b>Drag &amp; drop → Basket game item</b>. Marked scene images automatically replace the item slots
                        below.
                      </div>
                    </>
                  )}
                  {tpl.id !== 'catch' &&
                    (tpl.assetSlots ?? [])
                      .filter((slot) => slot.key !== 'brushImage' && slot.key !== 'popupImages' && (slot.showIf?.(params) ?? true))
                      .map((slot) => {
                        if (slot.list) {
                          const countKey = slot.countParam ?? ''
                          const n = Number(params[countKey]) || 0
                          const arr = Array.isArray(params[slot.key]) ? (params[slot.key] as string[]) : []
                          return (
                            <div key={slot.key}>
                              <div className="group-title2" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>{slot.label}</span>
                                <button
                                  className="btn"
                                  style={{ padding: '2px 8px', fontSize: 16, lineHeight: 1, minWidth: 28 }}
                                  title="Add another image slot"
                                  onClick={() => setParam(countKey, n + 1)}
                                >
                                  +
                                </button>
                              </div>
                              {Array.from({ length: n }).map((_, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <div style={{ flex: 1 }}>
                                    <AssetPicker
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
                                  </div>
                                  {n > 1 && (
                                    <button
                                      className="btn"
                                      style={{ padding: '2px 6px', fontSize: 14, lineHeight: 1, minWidth: 24, color: '#e55' }}
                                      title="Remove this slot"
                                      onClick={() => {
                                        const next = arr.slice()
                                        next.splice(i, 1)
                                        setParam(slot.key, next)
                                        setParam(countKey, Math.max(1, n - 1))
                                      }}
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
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
                <div className="hint pad">
                  Editable hint hand added: drag it on the canvas, edit its route with its path tool, or swap its image via the handguide"s own Source. (The auto hint hand is off
                  while a handguide exists.)
                </div>
              ) : (
                <button className="wide" onClick={() => addGameHint(id)}>
                  Add hint hand (editable)
                </button>
              )}
              <Toggle
                label="Hint hand (points at the next move)"
                checked={el.game?.hintEnabled !== false}
                onChange={(v) => patchElement(id, { game: { ...(el.game ?? { templateId: tpl.id, params: {} }), hintEnabled: v } })}
              />
              {el.game?.hintEnabled !== false && (
                <NumField
                  label="Hint after (ms)"
                  value={el.game?.hintIdleMs ?? tpl.defaultHintIdleMs ?? 4000}
                  step={500}
                  onChange={(n) => patchElement(id, { game: { ...(el.game ?? { templateId: tpl.id, params: {} }), hintIdleMs: n } })}
                />
              )}
              <div className="hint pad">Games are interactive in Preview/export; the canvas shows a static layout. Mark a CTA/text "Show on game win" to reveal it on win.</div>
            </Accordion>
          )
        })()}
      {el.type === 'bar' && (
        <Accordion id="inspector.bar" title="Bar Background">
          <AssetPicker label="Background Image" value={el.assetId} onChange={(aid) => patchElement(id, { assetId: aid })} allowNone />
          <div className="hint pad">If set, this image stretches to fill the bar.</div>
        </Accordion>
      )}

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
                <Slider
                  label="Inside padding"
                  value={el.container.padPx ?? 0}
                  min={0}
                  max={200}
                  onChange={(n) => patchElement(id, { container: { ...el.container!, padPx: n } })}
                />
                <div className="hint pad">The shape"s transparency masks the image; works on any shape (heart, star, etc.). The inside image is clipped to the shape.</div>
              </>
            )}
          </Accordion>
          {!el.container && el.assetId && (
            <Accordion id="inspector.crop" title="Crop">
              <Toggle label="Crop this image" checked={!!el.crop} onChange={(v) => (v ? enableCrop() : patchElement(id, { crop: undefined }))} />
              {el.crop && (
                <>
                  <button className="wide" onClick={() => window.dispatchEvent(new CustomEvent('pa:crop-edit', { detail: { elementId: id } }))}>
                    Adjust crop on canvas
                  </button>
                  <button className="wide" onClick={() => setCrop({ scale: undefined, x: undefined, y: undefined })}>
                    Reset crop
                  </button>
                  <div className="hint pad">
                    <b>Double-click the image</b> on the canvas to crop it — drag the <b>edges/corners</b> to change what shows, drag the <b>middle</b> to move the picture, and{' '}
                    <b>scroll</b> to zoom. Press <b>Enter</b> or click away when done.
                  </div>
                </>
              )}
            </Accordion>
          )}
          {(() => {
            const cfg = el.button
            const others = state.project.scenes.filter((s) => s.id !== activeSceneDef(state)?.id)
            const patch = (p: Partial<NonNullable<typeof cfg>>): void => patchElement(id, { button: { ...(cfg ?? {}), ...p } })
            return (
              <Accordion id="inspector.imagebutton" title="Button" defaultOpen={false}>
                <Toggle label="Tap this image to go to a screen" checked={!!cfg} onChange={(v) => patchElement(id, { button: v ? {} : undefined })} />
                {cfg && (
                  <>
                    <ButtonTapFields cfg={cfg} others={others} selfId={id} siblings={state.scene.elements} patch={patch} />
                    <div className="hint pad">Keeps the image’s own crop, mask &amp; animation — it just becomes tappable.</div>
                  </>
                )}
                <button className="wide" onClick={() => patchElement(id, { type: 'button', button: el.button ?? {} })}>
                  Convert to Button element
                </button>
                <div className="hint pad">
                  Turns this into a full Button element in the same spot — position, size &amp; scale stay exactly the same. It gains the Button’s fill/corner styling; a crop or
                  mask is dropped. Reversible from the Button’s panel.
                </div>
              </Accordion>
            )
          })()}
          <Accordion id="inspector.dragdrop" title="Drag & drop" defaultOpen={false}>
            {(() => {
              const basketGames = activeSceneDef(state)?.elements.filter((candidate) => candidate.type === 'game-mount' && candidate.game?.templateId === 'basket') ?? []
              return (
                <>
                  <Toggle
                    label="Basket game item"
                    checked={!!el.basketItem}
                    onChange={(v) =>
                      patchElement(id, {
                        basketItem: v ? { gameId: basketGames[0]?.id } : undefined,
                        drag: v ? undefined : el.drag,
                        comboRole: v ? undefined : el.comboRole,
                      })
                    }
                  />
                  {el.basketItem && basketGames.length > 1 && (
                    <Row label="Basket">
                      <Select
                        value={el.basketItem.gameId ?? ''}
                        onChange={(gameId) => patchElement(id, { basketItem: { gameId: gameId || undefined } })}
                        options={basketGames.map((game) => ({ value: game.id, label: game.name || game.id }))}
                      />
                    </Row>
                  )}
                  {el.basketItem && (
                    <div className="hint pad">
                      This image keeps its canvas position and size, but becomes draggable in Preview/export. Basket-item images replace the Basket game&apos;s internal item image
                      slots and all of them must be placed to win.
                    </div>
                  )}
                  {el.basketItem && basketGames.length === 0 && <div className="hint pad">Add a Basket drop game to this scene so the item has a destination.</div>}
                </>
              )
            })()}
            {el.comboRole &&
              (() => {
                // Read-only on purpose: which element fills which slot is chosen in the
                // Combo builder game's own panel, so one screen owns the whole wiring
                // instead of it being spread across every element.
                const r = el.comboRole
                const where = comboSlotSummary(r)
                const game = activeSceneDef(state)?.elements.find((c) => c.id === r.gameId)
                return (
                  <>
                    <div className="hint pad">
                      Combo builder: this element is <b>{where}</b>.
                    </div>
                    {game && <button className="btn" style={{ width: '100%', marginTop: 4 }} onClick={() => selectOnly(game.id)}>Edit in “{game.name || game.id}”</button>}
                    <div className="hint pad">Assign and re-assign slots from the Combo builder game&apos;s panel.</div>
                  </>
                )
              })()}
            <Toggle
              label="Draggable item"
              checked={!!el.drag}
              onChange={(v) =>
                patchElement(id, {
                  drag: v ? { group: el.slot?.group ?? 'a' } : undefined,
                  basketItem: v ? undefined : el.basketItem,
                  comboRole: v ? undefined : el.comboRole,
                })
              }
            />
            {el.drag && (
              <div className="grid2">
                <Row label="Group">
                  <input
                    className="text-input"
                    value={el.drag.group ?? ''}
                    placeholder="a"
                    onChange={(e) => patchElement(id, { drag: { ...el.drag!, group: e.target.value || undefined } })}
                  />
                </Row>
                <Row label="Match key">
                  <input
                    className="text-input"
                    value={el.drag.key ?? ''}
                    placeholder="optional"
                    onChange={(e) => patchElement(id, { drag: { ...el.drag!, key: e.target.value || undefined } })}
                  />
                </Row>
              </div>
            )}
            <Toggle label="Drop slot" checked={!!el.slot} onChange={(v) => patchElement(id, { slot: v ? { group: el.drag?.group ?? 'a' } : undefined })} />
            {el.slot && (
              <div className="grid2">
                <Row label="Group">
                  <input
                    className="text-input"
                    value={el.slot.group ?? ''}
                    placeholder="a"
                    onChange={(e) => patchElement(id, { slot: { ...el.slot!, group: e.target.value || undefined } })}
                  />
                </Row>
                <Row label="Accepts key">
                  <input
                    className="text-input"
                    value={el.slot.key ?? ''}
                    placeholder="optional"
                    onChange={(e) => patchElement(id, { slot: { ...el.slot!, key: e.target.value || undefined } })}
                  />
                </Row>
              </div>
            )}
            {(el.drag || el.slot) && (
              <div className="hint pad">
                Items + slots sharing a <b>Group</b> interact: drag an item onto a same-group slot to drop it in, or back out. A slot"s "accepts key" only takes an item whose
                "match key" matches. Filling every slot in a group completes the scene (advances a "game won" scene). Runs in Preview/export.
              </div>
            )}
          </Accordion>
          <Accordion id="inspector.selgen" title="Select & generate" defaultOpen={false}>
            <Toggle label="Tap-to-pick (thumbnail)" checked={!!el.pick} onChange={(v) => patchElement(id, { pick: v ? { group: 'a' } : undefined })} />
            {el.pick && (
              <Row label="Category">
                <input
                  className="text-input"
                  value={el.pick.group}
                  placeholder="any name (e.g. model)"
                  onChange={(e) => patchElement(id, { pick: { group: e.target.value || 'a' } })}
                />
              </Row>
            )}
            <Toggle label="Fill slot (shows a pick)" checked={!!el.fill} onChange={(v) => patchElement(id, { fill: v ? { group: 'a' } : undefined })} />
            {el.fill && (
              <div className="grid2">
                <Row label="Category">
                  <input
                    className="text-input"
                    value={el.fill.group}
                    placeholder="model"
                    onChange={(e) => patchElement(id, { fill: { ...el.fill!, group: e.target.value || 'a' } })}
                  />
                </Row>
                <NumField
                  label="Slot # (0=auto)"
                  value={(el.fill.index ?? -1) + 1}
                  step={1}
                  min={0}
                  onChange={(n) => patchElement(id, { fill: { ...el.fill!, index: n > 0 ? n - 1 : undefined } })}
                />
              </div>
            )}
            <Toggle
              label="Generate result (progress → reveal)"
              checked={!!el.generate}
              onChange={(v) => patchElement(id, { generate: v ? { needs: [], durationMs: 2500 } : undefined })}
            />
            {el.generate && (
              <>
                <Row label="Needs categories">
                  <input
                    className="text-input"
                    value={(el.generate.needs ?? []).join(', ')}
                    placeholder="model, song"
                    onChange={(e) =>
                      patchElement(id, {
                        generate: {
                          ...el.generate!,
                          needs: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                  />
                </Row>
                <NumField
                  label="Progress (ms)"
                  value={el.generate.durationMs ?? 2500}
                  step={250}
                  min={500}
                  onChange={(n) => patchElement(id, { generate: { ...el.generate!, durationMs: n } })}
                />
                <AssetPicker
                  label="Result (image/video)"
                  accept="media"
                  allowNone
                  value={el.generate.resultId}
                  onChange={(aid) => patchElement(id, { generate: { ...el.generate!, resultId: aid } })}
                />
                <ColorField
                  label="Progress color"
                  value={el.generate.accent ?? '#7c3aed'}
                  onChange={(c) => patchElement(id, { generate: { ...el.generate!, accent: c ?? '#7c3aed' } })}
                />
              </>
            )}
            {(el.pick || el.fill || el.generate) && (
              <div className="hint pad">
                Fully freeform: invent <b>any categories</b> (type any name) and place <b>as many thumbnails per category</b> as you like.{' '}
                <b>How many picks a category holds = how many Fill slots</b> you give it (1 slot = single-choice, 3 slots = pick 3). Slots fill in scene order, or set Slot #.{' '}
                <b>Generate</b> lists the categories it needs; tap it or <b>swipe up</b>→ circular % → result. Style/position every element yourself; nothing is grouped or laid out
                for you.
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
                    { value: 'hold', label: 'Hold (press and stay pressed)' },
                    { value: 'slide', label: 'Slide along a path' },
                    { value: 'scratch', label: 'Scratch (back-and-forth rub)' },
                    { value: 'match', label: 'Match pairs (follow the game’s next card)' },
                    { value: 'thoughtwhack', label: 'Whack-a-mole (follow an unwhacked thought)' },
                    { value: 'basket', label: 'Basket (drag next unplaced item)' },
                    { value: 'brush', label: 'Point at the scratch brush (after its intro)' },
                    { value: 'still', label: 'Still (no movement at all)' },
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
                        <button className="wide" onClick={() => startPathDraw(id)}>
                          {nodes.length ? 'Redraw path' : 'Draw path'}
                        </button>
                        <button className="wide" disabled={!nodes.length} onClick={() => setHg({ nodes: undefined, toX: undefined, toY: undefined })}>
                          Clear path
                        </button>
                      </div>
                      {nodes.length ? (
                        <div className="hg-nodes">
                          <div className="hg-node-row start">
                            <span className="hg-node-idx">S</span>
                            <span className="hint">
                              Start ({Math.round(el.x)}, {Math.round(el.y)})
                            </span>
                          </div>
                          {nodes.map((nd, i) => (
                            <div className="hg-node-row" key={i}>
                              <span className="hg-node-idx">{i + 1}</span>
                              <span className="hint">
                                ({Math.round(nd.x)}, {Math.round(nd.y)})
                              </span>
                              <NumField
                                label="Stop ms"
                                value={nd.pauseMs ?? 0}
                                step={100}
                                min={0}
                                onChange={(n) => setNodes(nodes.map((x, j) => (j === i ? { ...x, pauseMs: n } : x)))}
                              />
                              <button className="icon-btn" title="Remove node" disabled={nodes.length <= 1} onClick={() => setNodes(nodes.filter((_, j) => j !== i))}>
                                <Icon icon={X} size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="hint pad">
                          Click "Draw path", then click on the canvas to drop the start and each waypoint. Double-click or press Enter to finish; Esc cancels.
                        </div>
                      )}
                    </>
                  )
                })()}
              {hg.mode === 'brush' && (
                <>
                  <div className="hint pad">
                    The hand renders in front of the brush, sits below it, and mimes dragging it across the card. It only appears after the brush's intro. Adjust its offset &amp;
                    rotation:
                  </div>
                  <div className="grid2">
                    <NumField label="Offset X (px)" value={hg.brushOffsetX ?? 0} step={4} onChange={(n) => setHg({ brushOffsetX: n })} />
                    <NumField label="Offset Y (px)" value={hg.brushOffsetY ?? 0} step={4} onChange={(n) => setHg({ brushOffsetY: n })} />
                  </div>
                  <NumField label="Rotation (deg)" value={hg.brushRotateDeg ?? 0} step={5} min={-180} max={180} onChange={(n) => setHg({ brushRotateDeg: n })} />
                </>
              )}
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
              <NumField
                label="Loop speed (ms)"
                value={hg.periodMs ?? (hg.mode === 'tap' || hg.mode === 'thoughtwhack' ? 900 : 1500)}
                step={100}
                min={300}
                onChange={(n) => setHg({ periodMs: n })}
              />
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
                    <ColorField
                      label={ch.feedback ? 'Correct' : 'Selected'}
                      value={ch.feedback ? (ch.correctColor ?? '#22c55e') : (ch.selectColor ?? '#7c3aed')}
                      onChange={(c) => setCh(ch.feedback ? { correctColor: c ?? '#22c55e' } : { selectColor: c ?? '#7c3aed' })}
                    />
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
                  onChange={(v) => {
                    const mode = v as CountdownConfig['mode']
                    // A clock with a pure date format ("TODAY MMM D") would render a
                    // frozen label, so seed the canonical 00:00 format — unless the
                    // author already has time tokens they want to keep.
                    const needsClockFmt = mode === 'clock' && !/\{h{1,2}\}|\{m{1,2}\}|\{s{1,2}\}/.test(cfg.format || '')
                    setCd(needsClockFmt ? { mode, format: '{hh}:{mm}' } : { mode })
                  }}
                  options={[
                    { value: 'dynamic', label: 'dynamic (now + days)' },
                    { value: 'timer', label: 'timer (countdown)' },
                    { value: 'date', label: 'fixed date' },
                    { value: 'clock', label: 'clock (current time)' },
                  ]}
                />
              </Row>
              {cfg.mode === 'clock' && (
                <>
                  <Row label="Time format">
                    <Select
                      value={cfg.hour12 ? '12' : '24'}
                      onChange={(v) => {
                        const hour12 = v === '12'
                        // Keep the format in step with the choice: 12-hour needs the AM/PM
                        // token to be readable, 24-hour has no use for it.
                        const f = cfg.format || '{hh}:{mm}'
                        const hasMeridiem = /\{[Aa]\}/.test(f)
                        const format = hour12 ? (hasMeridiem ? f : `${f} {A}`) : f.replace(/\s*\{[Aa]\}/g, '')
                        setCd({ hour12: hour12 || undefined, format })
                      }}
                      options={[
                        { value: '24', label: '24-hour — 14:05' },
                        { value: '12', label: '12-hour — 2:05 PM' },
                      ]}
                    />
                  </Row>
                  <div className="hint pad">
                    Shows the viewer's own clock, updating every second. <b>{'{hh}:{mm}'}</b> → “{cfg.hour12 ? '02:05' : '14:05'}” (zero-padded); <b>{'{h}:{mm}'}</b> drops the
                    leading zero and <b>{'{ss}'}</b> adds seconds. <b>{'{A}'}</b> → PM, <b>{'{a}'}</b> → pm. Date tokens (<b>MMM</b>, <b>D</b>…) show today.
                  </div>
                </>
              )}
              {cfg.mode === 'dynamic' && <NumField label="Days from now" value={cfg.dynamicDays ?? 1} step={1} min={0} onChange={(n) => setCd({ dynamicDays: n })} />}
              {cfg.mode === 'timer' && <NumField label="Seconds" value={cfg.seconds ?? 3600} step={60} min={0} onChange={(n) => setCd({ seconds: n })} />}
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
                <textarea value={cfg.format} rows={2} onChange={(e) => setCd({ format: e.target.value })} placeholder="{hh}:{mm}:{ss}" />
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
                      { value: 'monthDay', label: 'June 24' },
                    ]}
                  />
                </Row>
              )}
              {(cfg.format.includes('{date}') || cfg.format.includes('{MMM')) && (
                <Row label="Date language">
                  <Select value={cfg.dateLocale ?? 'en-US'} onChange={(v) => setCd({ dateLocale: v === 'en-US' ? undefined : v })} options={DATE_LOCALE_OPTIONS} />
                </Row>
              )}
              <Row label="Text case">
                <Select
                  value={cfg.textCase ?? (cfg.capitalize ? 'title' : 'none')}
                  onChange={(v) => setCd({ textCase: v as CountdownConfig['textCase'], capitalize: undefined })}
                  options={[
                    { value: 'none', label: 'As typed' },
                    { value: 'upper', label: 'UPPERCASE' },
                    { value: 'title', label: 'Capitalize Each Word' },
                    { value: 'lower', label: 'lowercase' },
                  ]}
                />
              </Row>
              <div className="hint pad">
                Month names arrive already capitalized (<b>Jul</b>), so “Capitalize Each Word” won’t change them — pick <b>UPPERCASE</b> for <b>JUL</b>.
              </div>
              {(() => {
                const targets = state.scene.elements.filter((t) => t.id !== id && (t.type === 'image' || t.type === 'bar'))
                // A stale id (target deleted) stays listed so it can be seen + cleared.
                const stale = cfg.attachToId && !targets.some((t) => t.id === cfg.attachToId)
                return (
                  <Row label="Attach to">
                    <Select
                      value={cfg.attachToId ?? ''}
                      onChange={(v) => setCd({ attachToId: v || undefined })}
                      options={[
                        { value: '', label: 'None (free position)' },
                        ...targets.map((t) => ({ value: t.id, label: t.name || t.id })),
                        ...(stale ? [{ value: cfg.attachToId!, label: `${cfg.attachToId} (missing)` }] : []),
                      ]}
                    />
                  </Row>
                )
              })()}
              {cfg.attachToId && (
                <div className="hint pad">
                  Attached: position and size follow the target image's rendered box, so this text keeps the same height and Y as the image at every screen size and zoom. Drag it
                  where you want it relative to the image — the offset sticks.
                </div>
              )}
              <div className="hint pad">
                <b>Timer</b> tokens (live): <b>{'{hh}:{mm}:{ss}'}</b> / <b>{'{d} {h} {m} {s}'}</b>; <b>{'{ss}:{ms}'}</b> shows “06:99” for 6.99 seconds. <b>Date</b> label (no
                ticking): <b>{'{date}'}</b>, e.g. "Order by {'{date}'}", or build your own from parts: <b>MMMM</b> July, <b>MMM</b> Jul, <b>MM/M</b> 07/7, <b>DD/D</b> day,{' '}
                <b>Do</b> 21st, <b>YYYY/YY</b> year (braces optional — "MM.D" → "07.16") — e.g. "Ends MMMM Do" → "Ends July 21st". "Dynamic" recomputes from today whenever the ad
                runs.
              </div>
            </Accordion>
          )
        })()}

      {hasTextStyle && el.text && (
        <>
          <Accordion id="inspector.text" title="Text">
            {el.type !== 'countdown' &&
              (() => {
                // Attach: the label's position AND size come from the target's rendered
                // box, so it can never drift out of the image/bar it sits on when the
                // screen aspect changes. Countdowns keep their own picker below.
                const targets = state.scene.elements.filter((t) => t.id !== id && (t.type === 'image' || t.type === 'bar'))
                const stale = el.attachToId && !targets.some((t) => t.id === el.attachToId)
                if (!targets.length && !stale) return null
                return (
                  <>
                    <Row label="Attach to">
                      <Select
                        value={el.attachToId ?? ''}
                        onChange={(v) => patchElement(id, { attachToId: v || undefined })}
                        options={[
                          { value: '', label: 'None (free position)' },
                          ...targets.map((t) => ({ value: t.id, label: t.name || t.id })),
                          ...(stale ? [{ value: el.attachToId!, label: `${el.attachToId} (missing)` }] : []),
                        ]}
                      />
                    </Row>
                    {!el.attachToId && (
                      <Row label="Header scaling">
                        <Toggle
                          label="Scale like the date band"
                          checked={!!el.headerScale}
                          onChange={(v) => patchElement(id, { headerScale: v || undefined })}
                        />
                      </Row>
                    )}
                    {!el.attachToId && el.headerScale && (
                      <div className="hint pad">
                        Sizes this text with a single transform, the way the pinned date band does, instead of multiplying font size, spacing and padding by the layout scale
                        one at a time. Nothing lands on a rounded pixel, so it holds its exact design position and size at every screen — use it when a label must stay put
                        inside artwork.
                      </div>
                    )}
                    {el.attachToId && (
                      <div className="hint pad">
                        Locked to the target's rendered box: this text keeps the same offset and the same proportional size relative to that image at every screen size,
                        orientation and zoom. Drag it where you want it — the offset sticks. Note a landscape override on this text (and not on the target) still shifts it in
                        landscape; clear it under <b>Landscape layout</b> if you want them identical in both orientations.
                      </div>
                    )}
                  </>
                )
              })()}
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
                      options={[{ value: '', label: 'Default' }, ...fontAssets.map(([id]) => ({ value: id, label: id.replace(/_/g, ' ') }))]}
                    />
                    <button
                      className="icon-btn"
                      title="Upload font (.ttf .otf .woff .woff2)"
                      onClick={() => {
                        void uploadFont()
                      }}
                    >
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

      {el.type === 'cta' &&
        (() => {
          const PULSE_PEAK = { calm: 1.025, medium: 1.04, strong: 1.06 } as const
          const PULSE_DUR = { calm: 1600, medium: 1200, strong: 900 } as const
          const ctaBase = el.cta ?? { pulse: 'medium' as CtaPulsePreset }
          const pKey = (ctaBase.pulse as 'calm' | 'medium' | 'strong') ?? 'medium'
          const peakPct = Math.round((ctaBase.pulseScale ?? PULSE_PEAK[pKey] ?? 1.04) * 1000) / 10
          const minPct = Math.round((ctaBase.pulseMinScale ?? 1.0) * 1000) / 10
          const dur = ctaBase.pulseDurationMs ?? PULSE_DUR[pKey] ?? 1200
          const patch = (p: Partial<typeof ctaBase>): void => patchElement(id, { cta: { ...ctaBase, ...p } })
          return (
            <>
              <Row label="Pulse">
                <Select
                  value={ctaBase.pulse ?? 'medium'}
                  onChange={(v) => patch({ pulse: v as CtaPulsePreset })}
                  options={[
                    { value: 'calm', label: 'calm' },
                    { value: 'medium', label: 'medium' },
                    { value: 'strong', label: 'strong' },
                  ]}
                />
              </Row>
              <Slider label="Peak size" value={peakPct} min={100} max={130} step={0.5} suffix="%" onChange={(v) => patch({ pulseScale: +(v / 100).toFixed(4) })} />
              <Slider label="Squish" value={minPct} min={85} max={100} step={0.5} suffix="%" onChange={(v) => patch({ pulseMinScale: +(v / 100).toFixed(4) })} />
              <Slider label="Speed" value={dur} min={300} max={3000} step={50} suffix="ms" onChange={(v) => patch({ pulseDurationMs: v })} />
            </>
          )
        })()}

      {el.type === 'button' &&
        (() => {
          const cfg = el.button ?? {}
          const others = state.project.scenes.filter((s) => s.id !== activeSceneDef(state)?.id)
          const patch = (p: Partial<typeof cfg>): void => patchElement(id, { button: { ...cfg, ...p } })
          return (
            <Accordion id="inspector.button" title="Button">
              <ButtonTapFields cfg={cfg} others={others} selfId={id} siblings={state.scene.elements} patch={patch} />
              <AssetPicker label="Image (optional)" allowNone value={el.assetId} onChange={(aid) => patchElement(id, { assetId: aid ?? undefined })} />
              <div className="hint pad">
                Uses the image if set, otherwise the text label below. Style the fill &amp; corners in Background box. Animation is optional (Animation section). Toggle “Above
                overlays” at the top to float it over game win/lose cards.
              </div>
              {el.assetId && (
                <button className="wide" onClick={() => patchElement(id, { type: 'image' })}>
                  Convert back to Image
                </button>
              )}
            </Accordion>
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
              <AssetPicker label="Landscape image (optional)" value={bg.landscapeAssetId} allowNone onChange={(aid) => setBg({ landscapeAssetId: aid ?? undefined })} />
              <div className="hint pad">
                Shown instead of the image above when the device is in <b>landscape</b>. Leave unset to reuse the same image in both orientations.
              </div>
              <Row label="Fit">
                <Select
                  value={fit}
                  onChange={(v) => setBg({ objectFit: v as BackgroundConfig['objectFit'] })}
                  options={[
                    { value: 'cover', label: 'cover (fill, may crop)' },
                    { value: 'contain', label: 'contain (fit, no crop)' },
                    { value: 'fill', label: 'stretch (fill screen, may distort)' },
                  ]}
                />
              </Row>
              <Slider label="Zoom" value={bg.zoom ?? 1} min={0.5} max={4} step={0.05} suffix="×" onChange={(n) => setBg({ zoom: n === 1 ? undefined : n })} />
              {fit === 'cover' && (
                <>
                  <Slider label="Crop X (portrait)" value={Math.round(bg.focusX ?? 50)} min={0} max={100} suffix="%" onChange={(n) => setBg({ focusX: n })} />
                  <Slider label="Crop Y (portrait)" value={Math.round(bg.focusY ?? 50)} min={0} max={100} suffix="%" onChange={(n) => setBg({ focusY: n })} />
                  <div className="hint pad">
                    In <b>portrait</b>, these pick which part of the image stays visible when it's cropped to fill (0% = left/top, 100% = right/bottom). <b>Landscape</b> always
                    centers and crops to cover the whole screen.
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
                  <ColorField
                    label={cfg.htmlBgBottom != null ? 'Top' : 'Background colour'}
                    value={cfg.htmlBgTop || '#000000'}
                    onChange={(c) => setEnd({ htmlBgTop: c ?? undefined })}
                  />
                  {cfg.htmlBgBottom != null && <ColorField label="Bottom" value={cfg.htmlBgBottom || '#000000'} onChange={(c) => setEnd({ htmlBgBottom: c ?? undefined })} />}
                  <div className="group-title2">Landscape background</div>
                  <Toggle
                    label="Split (left / right)"
                    checked={cfg.htmlBgRight != null}
                    onChange={(v) => setEnd({ htmlBgRight: v ? (cfg.htmlBgRight ?? cfg.htmlBgLeft ?? cfg.htmlBgTop ?? '#000000') : undefined })}
                  />
                  <ColorField
                    label={cfg.htmlBgRight != null ? 'Left' : 'Background colour'}
                    value={cfg.htmlBgLeft ?? cfg.htmlBgTop ?? '#000000'}
                    onChange={(c) => setEnd({ htmlBgLeft: c ?? undefined })}
                  />
                  {cfg.htmlBgRight != null && <ColorField label="Right" value={cfg.htmlBgRight || '#000000'} onChange={(c) => setEnd({ htmlBgRight: c ?? undefined })} />}
                </>
              ) : (
                <>
                  <AssetPicker label="Portrait video" accept="video" allowNone value={cfg.portraitVideoId} onChange={(aid) => setEnd({ portraitVideoId: aid })} />
                  <AssetPicker label="Landscape video (optional)" accept="video" allowNone value={cfg.landscapeVideoId} onChange={(aid) => setEnd({ landscapeVideoId: aid })} />
                  <div className="group-title2">Image fallback (used if no video)</div>
                  <AssetPicker label="Portrait image" allowNone value={cfg.portraitImageId} onChange={(aid) => setEnd({ portraitImageId: aid })} />
                  <AssetPicker label="Landscape image (optional)" allowNone value={cfg.landscapeImageId} onChange={(aid) => setEnd({ landscapeImageId: aid })} />
                  <Row label="Fit (portrait)">
                    <Select
                      value={cfg.fullHeight ? 'height' : cfg.objectFit}
                      onChange={(v) => (v === 'height' ? setEnd({ fullHeight: true }) : setEnd({ objectFit: v as ObjectFit, fullHeight: undefined }))}
                      options={[
                        { value: 'cover', label: 'cover (fill, may crop)' },
                        { value: 'contain', label: 'contain (letterbox)' },
                        { value: 'height', label: 'extend (full height)' },
                      ]}
                    />
                  </Row>
                  <Row label="Fit (landscape)">
                    <Select
                      value={cfg.objectFitL === undefined && cfg.fullHeightL === undefined ? 'same' : cfg.fullHeightL ? 'height' : (cfg.objectFitL ?? 'cover')}
                      onChange={(v) =>
                        v === 'same'
                          ? setEnd({ objectFitL: undefined, fullHeightL: undefined })
                          : v === 'height'
                            ? setEnd({ fullHeightL: true, objectFitL: undefined })
                            : setEnd({ objectFitL: v as ObjectFit, fullHeightL: false })
                      }
                      options={[
                        { value: 'same', label: 'same as portrait' },
                        { value: 'cover', label: 'cover (fill, may crop)' },
                        { value: 'contain', label: 'contain (letterbox)' },
                        { value: 'height', label: 'extend (full height)' },
                      ]}
                    />
                  </Row>
                  <Slider label="Zoom (portrait)" value={cfg.zoom ?? 1} min={0.5} max={2} step={0.05} suffix="×" onChange={(n) => setEnd({ zoom: n })} />
                  <Slider label="Zoom (landscape)" value={cfg.zoomL ?? cfg.zoom ?? 1} min={0.5} max={2} step={0.05} suffix="×" onChange={(n) => setEnd({ zoomL: n })} />
                  <Toggle label="Transparent background (show element behind)" checked={!!cfg.transparentBg} onChange={(v) => setEnd({ transparentBg: v || undefined })} />
                  {cfg.transparentBg ? (
                    <div className="hint pad">
                      The endcard fill is transparent — put a full-screen <b>background image</b> (or any element) on a lower layer and it shows through the gaps around the{' '}
                      {cfg.fullHeight ? 'full-height' : cfg.objectFit === 'contain' ? 'contained' : ''} clip.
                    </div>
                  ) : (
                    <>
                      <div className="group-title2">Portrait background</div>
                      {cfg.objectFit === 'contain' && (
                        <Toggle
                          label="Split (top / bottom)"
                          checked={cfg.bgColor2 != null}
                          onChange={(v) => setEnd({ bgColor2: v ? (cfg.bgColor2 ?? cfg.bgColor ?? '#000000') : undefined })}
                        />
                      )}
                      <ColorField
                        label={cfg.objectFit === 'contain' && cfg.bgColor2 != null ? 'Top' : 'Background colour'}
                        value={cfg.bgColor || '#000000'}
                        onChange={(c) => setEnd({ bgColor: c ?? '#000000' })}
                      />
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
                      <ColorField
                        label={cfg.objectFit === 'contain' && cfg.bgColorL2 != null ? 'Left' : 'Background colour'}
                        value={cfg.bgColorL ?? cfg.bgColor ?? '#000000'}
                        onChange={(c) => setEnd({ bgColorL: c ?? '#000000' })}
                      />
                      {cfg.objectFit === 'contain' && cfg.bgColorL2 != null && (
                        <ColorField label="Right" value={cfg.bgColorL2 || '#000000'} onChange={(c) => setEnd({ bgColorL2: c ?? '#000000' })} />
                      )}

                      {cfg.objectFit === 'contain' && <Toggle label="Match fill to clip edge(s)" checked={!!cfg.matchBgEdge} onChange={(v) => setEnd({ matchBgEdge: v })} />}
                    </>
                  )}
                  <Toggle label="Loop" checked={cfg.loop ?? true} onChange={(v) => setEnd({ loop: v })} />
                  <div className="hint pad">
                    Full-bleed by default; the clip auto-plays muted and tapping anywhere fires the CTA. For extreme aspect ratios use "contain" + <b>split fill</b> so the
                    top/bottom (portrait) or left/right (landscape) bars match each edge. Turn on "match to edge(s)" to auto-sample them from the clip. Add a CTA/text element on
                    top for the button.
                  </div>
                </>
              )}
            </Accordion>
          )
        })()}

      {el.type === 'unboxing' && <UnboxingInspector el={el} />}

      {el.type === 'confetti' &&
        (() => {
          const cfg: ConfettiConfig = el.confetti ?? {}
          const set = (p: Partial<ConfettiConfig>): void => patchElement(id, { confetti: { ...cfg, ...p } })
          const mode = cfg.mode ?? 'rain'
          return (
            <Accordion id="inspector.confetti" title="Confetti">
              <Row label="Style">
                <Chips
                  items={[
                    { key: 'rain', label: 'Rain', active: mode === 'rain', onClick: () => set({ mode: 'rain' }) },
                    { key: 'burst', label: 'Burst', active: mode === 'burst', onClick: () => set({ mode: 'burst' }) },
                  ]}
                />
              </Row>
              <Row label="Fires">
                <Select
                  value={cfg.trigger ?? 'sceneEnter'}
                  onChange={(v) => set({ trigger: v as ConfettiConfig['trigger'] })}
                  options={[
                    { value: 'sceneEnter', label: 'when scene appears' },
                    { value: 'onGameWin', label: 'when game is won' },
                  ]}
                />
              </Row>
              <Slider label="Pieces" value={cfg.pieces ?? 200} min={20} max={600} step={10} onChange={(n) => set({ pieces: n })} />
              <Slider label="Size" value={cfg.scalar ?? 1} min={0.4} max={3} step={0.1} suffix="×" onChange={(n) => set({ scalar: n })} />
              <Slider label="Power" value={cfg.power ?? (mode === 'burst' ? 9 : 8)} min={2} max={20} step={0.5} onChange={(n) => set({ power: n })} />
              <Slider label="Gravity" value={cfg.gravity ?? (mode === 'burst' ? 0.28 : 0.08)} min={0} max={0.6} step={0.02} onChange={(n) => set({ gravity: n })} />
              <Slider label="Wind" value={cfg.wind ?? 0} min={-6} max={6} step={0.5} onChange={(n) => set({ wind: n || undefined })} />
              {mode === 'rain' ? (
                <>
                  <Slider label="Spread" value={cfg.spread ?? 5} min={0} max={20} step={0.5} onChange={(n) => set({ spread: n })} />
                  <Toggle label="Continuous (keep raining)" checked={cfg.recycle !== false} onChange={(v) => set({ recycle: v })} />
                  {cfg.recycle !== false && (
                    <NumField label="Emit for (ms, 0 = forever)" value={cfg.durationMs ?? 0} step={250} min={0} onChange={(n) => set({ durationMs: n || undefined })} />
                  )}
                </>
              ) : (
                <div className="grid2">
                  <Slider label="Origin X" value={cfg.originX ?? 50} min={0} max={100} suffix="%" onChange={(n) => set({ originX: n })} />
                  <Slider label="Origin Y" value={cfg.originY ?? 45} min={0} max={100} suffix="%" onChange={(n) => set({ originY: n })} />
                </div>
              )}
              <Row label="Colours">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {(cfg.colors ?? []).map((c, i) => (
                    <button
                      key={c + i}
                      className="swatch-dot"
                      title={`${c} — click to remove`}
                      style={{ background: c }}
                      onClick={() => set({ colors: (cfg.colors ?? []).filter((_, j) => j !== i) })}
                    />
                  ))}
                  <label className="swatch-dot" title="Add colour" style={{ display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                    +
                    <input type="color" style={{ display: 'none' }} onChange={(e) => set({ colors: [...(cfg.colors ?? []), e.target.value] })} />
                  </label>
                  {cfg.colors && cfg.colors.length > 0 && (
                    <button className="mini" onClick={() => set({ colors: undefined })}>
                      Reset
                    </button>
                  )}
                </div>
              </Row>
              {(!cfg.colors || cfg.colors.length === 0) && <div className="hint pad">Using the default multi-colour palette. Add colours to override it.</div>}
              <div className="hint pad">
                Full-screen celebration overlay — always covers the whole screen (position &amp; size are ignored). It only animates in <b>Preview</b> / export; here you see a
                frozen sample. Use the layers panel to place it above your content.
              </div>
            </Accordion>
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
        <Slider label="Background blur" value={el.backdropBlur ?? 0} min={0} max={80} suffix="px" onChange={(n) => patchElement(id, { backdropBlur: n || undefined })} />
        {el.backdropBlur ? (
          <>
            <div className="hint pad">
              Blurs the scene <b>behind</b> this element (like Figma’s Background blur). Use a full-screen overlay (dim/bar) to blur the whole scene below it.
            </div>
            <Row label="Falloff">
              <Select
                value={el.backdropBlurMode ?? 'uniform'}
                onChange={(v) => patchElement(id, { backdropBlurMode: v === 'uniform' ? undefined : (v as 'progressive' | 'radial') })}
                options={[
                  { value: 'uniform', label: 'Uniform' },
                  { value: 'progressive', label: 'Progressive' },
                  { value: 'radial', label: 'Radial' },
                ]}
              />
            </Row>
            {el.backdropBlurMode === 'progressive' && (
              <Row label="Direction">
                <Select
                  value={el.backdropBlurDir ?? 'down'}
                  onChange={(v) => patchElement(id, { backdropBlurDir: v === 'down' ? undefined : (v as 'up' | 'left' | 'right') })}
                  options={[
                    { value: 'down', label: 'Top → bottom' },
                    { value: 'up', label: 'Bottom → top' },
                    { value: 'left', label: 'Right → left' },
                    { value: 'right', label: 'Left → right' },
                  ]}
                />
              </Row>
            )}
          </>
        ) : null}
        <div className="group-title2">Fade with scratch progress</div>
        <div className="hint pad">Fade this element in/out based on how much of the scratch card/grid has been revealed (0–100%).</div>
        <Toggle label="Fade in at progress" checked={el.scratchShowAt != null} onChange={(v) => patchElement(id, { scratchShowAt: v ? (el.scratchShowAt ?? 30) : undefined })} />
        {el.scratchShowAt != null && <Slider label="Fade in at" value={el.scratchShowAt} min={0} max={100} suffix="%" onChange={(n) => patchElement(id, { scratchShowAt: n })} />}
        <Toggle label="Fade out at progress" checked={el.scratchHideAt != null} onChange={(v) => patchElement(id, { scratchHideAt: v ? (el.scratchHideAt ?? 80) : undefined })} />
        {el.scratchHideAt != null && <Slider label="Fade out at" value={el.scratchHideAt} min={0} max={100} suffix="%" onChange={(n) => patchElement(id, { scratchHideAt: n })} />}
      </Accordion>

      <Accordion id="inspector.timing" title="Timing (in / out)" defaultOpen={false}>
        <div className="hint pad">
          Give this element a clip on the scene timeline: it appears at <b>In</b> playing its entrance, then plays its exit and disappears when the clip ends. Drag the clip in the{' '}
          <b>Timeline</b> panel under the canvas to adjust it there.
        </div>
        <Toggle
          label="Timed appearance"
          checked={!!el.timing}
          onChange={(v) => patchElement(id, { timing: v ? { inMs: Math.round(getTimeline().ms), durationMs: 2000 } : undefined })}
        />
        {el.timing && (
          <>
            <div className="grid2">
              <NumField
                label="In (s)"
                value={Math.round((el.timing.inMs || 0) / 100) / 10}
                step={0.1}
                min={0}
                onChange={(n) => setTiming({ inMs: Math.max(0, Math.round(n * 1000)) })}
              />
              <NumField
                label="Duration (s)"
                value={el.timing.durationMs != null ? Math.round(el.timing.durationMs / 100) / 10 : 0}
                step={0.1}
                min={0}
                onChange={(n) => setTiming({ durationMs: n > 0 ? Math.round(n * 1000) : undefined })}
              />
            </div>
            <NumField
              label="Out (s)"
              value={el.timing.durationMs != null ? Math.round(((el.timing.inMs || 0) + el.timing.durationMs) / 100) / 10 : 0}
              step={0.1}
              min={0}
              onChange={(n) => {
                // Editing OUT holds the in point and moves the tail, the way a video
                // editor's out-point field behaves.
                const out = Math.round(n * 1000)
                setTiming({ durationMs: Math.max(100, out - (el.timing?.inMs || 0)) })
              }}
            />
            <Toggle label="Stays until the scene ends" checked={el.timing.durationMs == null} onChange={(v) => setTiming({ durationMs: v ? undefined : 2000 })} />
            <div className="grid2">
              <button className="btn" onClick={() => setTiming({ inMs: Math.round(getTimeline().ms) })}>
                In at playhead
              </button>
              <button className="btn" onClick={() => setTiming({ durationMs: Math.max(100, Math.round(getTimeline().ms) - (el.timing?.inMs || 0)) })}>
                Out at playhead
              </button>
            </div>
            <div className="group-title2">Animate in / out</div>
            <div className="hint pad">
              These are the same specs as the Entrance and Exit phases below — set them here for speed, or open Animation for stacking, easing and custom keyframes.
            </div>
            <Row label="Animate in">
              <Select
                value={(entranceAnim?.preset ?? 'none') as string}
                onChange={(v) => patchEntranceAnimations(v === 'none' ? null : { preset: v as AnimSpec['preset'] })}
                options={[{ value: 'none', label: 'none (just appears)' }, ...ENTRANCE_PRESETS.map((p) => ({ value: p as string, label: presetLabel(p) }))]}
              />
            </Row>
            {entranceAnim && (
              <>
                <div className="grid2">
                  <NumField label="In speed (ms)" value={entranceAnim.durationMs} step={50} min={0} onChange={(n) => patchEntranceAnimations({ durationMs: Math.max(0, n) })} />
                  <NumField label="In delay (ms)" value={entranceAnim.delayMs} step={50} min={0} onChange={(n) => patchEntranceAnimations({ delayMs: Math.max(0, n) })} />
                </div>
              </>
            )}
            <Row label="Animate out">
              <Select
                value={(el.animations?.exit?.preset ?? 'none') as string}
                onChange={(v) =>
                  patchElement(id, {
                    animations: {
                      ...(el.animations ?? {}),
                      exit: v === 'none' ? undefined : { ...(el.animations?.exit ?? { durationMs: 380, delayMs: 0, easing: 'ease-in' }), preset: v as AnimSpec['preset'] },
                      exitExtra: v === 'none' ? undefined : el.animations?.exitExtra,
                    },
                  })
                }
                options={[{ value: 'none', label: 'none (just disappears)' }, ...EXIT_PRESETS.map((p) => ({ value: p as string, label: presetLabel(p) }))]}
              />
            </Row>
            {el.animations?.exit && (
              <div className="grid2">
                <NumField
                  label="Out speed (ms)"
                  value={el.animations.exit.durationMs}
                  step={50}
                  min={0}
                  onChange={(n) => patchElement(id, { animations: { ...(el.animations ?? {}), exit: { ...el.animations!.exit!, durationMs: Math.max(0, n) } } })}
                />
                <NumField
                  label="Out delay (ms)"
                  value={el.animations.exit.delayMs}
                  step={50}
                  min={0}
                  onChange={(n) => patchElement(id, { animations: { ...(el.animations ?? {}), exit: { ...el.animations!.exit!, delayMs: Math.max(0, n) } } })}
                />
              </div>
            )}
            <button className="wide" onClick={() => setTimeline({ open: true, ms: el.timing?.inMs ?? 0, playing: false })}>
              Show on the timeline
            </button>
          </>
        )}
      </Accordion>

      <Accordion id="inspector.animation" title="Animation" defaultOpen={false}>
        <div className="hint pad">Stack multiple animations per phase with “+ Add another” — e.g. an entrance that pops in AND shines.</div>
        <AnimPhase
          title="Entrance"
          primary={entranceAnim}
          extra={entranceExtra}
          presets={ENTRANCE_PRESETS}
          extraPresets={NODE_PRESETS}
          defaultSpec={{ preset: 'fade', durationMs: 520, delayMs: 0, easing: 'ease-out' }}
          defaultExtraSpec={{ preset: 'shine', durationMs: 900, delayMs: 0, easing: 'ease-in-out' }}
          onChange={(primary, ex) =>
            patchElement(id, {
              animations: {
                ...(el.animations ?? {}),
                entrance: primary,
                entranceExtra: ex.length ? ex : undefined,
                ...(legacyWinAnim && !el.animations?.gameWin ? { gameWin: el.animations?.entrance, gameWinExtra: el.animations?.entranceExtra } : {}),
              },
            })
          }
        />
        <AnimPhase
          title="On game won"
          primary={gameWinAnim}
          extra={gameWinExtra}
          presets={NODE_PRESETS}
          extraPresets={NODE_PRESETS}
          defaultSpec={{ preset: 'pop', durationMs: 420, delayMs: 0, easing: 'ease-out' }}
          defaultExtraSpec={{ preset: 'shine', durationMs: 900, delayMs: 0, easing: 'ease-in-out' }}
          onChange={patchGameWinAnimations}
        />
        <AnimPhase
          title="On tap"
          primary={el.animations?.tap}
          extra={el.animations?.tapExtra}
          presets={NODE_PRESETS}
          extraPresets={NODE_PRESETS}
          defaultSpec={{ preset: 'pop', durationMs: 320, delayMs: 0, easing: 'ease-out' }}
          defaultExtraSpec={{ preset: 'shine', durationMs: 900, delayMs: 0, easing: 'ease-in-out' }}
          onChange={(primary, ex) => patchElement(id, { animations: { ...(el.animations ?? {}), tap: primary, tapExtra: ex.length ? ex : undefined } })}
        />
        {state.scene.elements.some((e) => e.game?.templateId === 'combo') && (
          <>
            <AnimPhase
              title="On option picked up"
              primary={el.animations?.comboPick}
              extra={el.animations?.comboPickExtra}
              presets={NODE_PRESETS}
              extraPresets={NODE_PRESETS}
              defaultSpec={{ preset: 'pop', durationMs: 260, delayMs: 0, easing: 'ease-out' }}
              defaultExtraSpec={{ preset: 'glow', durationMs: 600, delayMs: 0, easing: 'ease-in-out' }}
              onChange={(primary, ex) => patchElement(id, { animations: { ...(el.animations ?? {}), comboPick: primary, comboPickExtra: ex.length ? ex : undefined } })}
            />
            <AnimPhase
              title="On option dropped"
              primary={el.animations?.comboDrop}
              extra={el.animations?.comboDropExtra}
              presets={NODE_PRESETS}
              extraPresets={NODE_PRESETS}
              defaultSpec={{ preset: 'pop', durationMs: 320, delayMs: 0, easing: 'ease-out' }}
              defaultExtraSpec={{ preset: 'shine', durationMs: 700, delayMs: 0, easing: 'ease-in-out' }}
              onChange={(primary, ex) => patchElement(id, { animations: { ...(el.animations ?? {}), comboDrop: primary, comboDropExtra: ex.length ? ex : undefined } })}
            />
            <AnimPhase
              title="On next question"
              primary={el.animations?.comboNext}
              extra={el.animations?.comboNextExtra}
              presets={NODE_PRESETS}
              extraPresets={NODE_PRESETS}
              defaultSpec={{ preset: 'pop', durationMs: 380, delayMs: 0, easing: 'ease-out' }}
              defaultExtraSpec={{ preset: 'shine', durationMs: 800, delayMs: 0, easing: 'ease-in-out' }}
              onChange={(primary, ex) => patchElement(id, { animations: { ...(el.animations ?? {}), comboNext: primary, comboNextExtra: ex.length ? ex : undefined } })}
            />
            <div className="hint pad">
              The next-question phase fires once the incoming title and options are on screen, so a pop here animates them in. Tag them under Drag &amp; drop &rarr; Combo role.
            </div>
          </>
        )}
        {state.scene.elements.some((e) => e.game?.templateId === 'thoughtwhack') && (
          <>
            <AnimPhase
              title="On thought spawn"
              primary={el.animations?.thoughtSpawn}
              extra={el.animations?.thoughtSpawnExtra}
              presets={NODE_PRESETS}
              extraPresets={NODE_PRESETS}
              defaultSpec={{ preset: 'pop', durationMs: 320, delayMs: 0, easing: 'ease-out' }}
              defaultExtraSpec={{ preset: 'shine', durationMs: 700, delayMs: 0, easing: 'ease-in-out' }}
              onChange={(primary, ex) =>
                patchElement(id, {
                  animations: {
                    ...(el.animations ?? {}),
                    thoughtSpawn: primary,
                    thoughtSpawnExtra: ex.length ? ex : undefined,
                  },
                })
              }
            />
            <AnimPhase
              title="On thought whack"
              primary={el.animations?.thoughtWhack}
              extra={el.animations?.thoughtWhackExtra}
              presets={NODE_PRESETS}
              extraPresets={NODE_PRESETS}
              defaultSpec={{ preset: 'shake', durationMs: 360, delayMs: 0, easing: 'ease-out' }}
              defaultExtraSpec={{ preset: 'glow', durationMs: 650, delayMs: 0, easing: 'ease-in-out' }}
              onChange={(primary, ex) =>
                patchElement(id, {
                  animations: {
                    ...(el.animations ?? {}),
                    thoughtWhack: primary,
                    thoughtWhackExtra: ex.length ? ex : undefined,
                  },
                })
              }
            />
          </>
        )}
        {(el.animations?.tap || el.animations?.tapExtra?.length) && (
          <div className="hint pad">
            Replays every time this element is tapped, in <b>Preview</b> and the exported ad — on the canvas a click selects instead. It doesn’t swallow the tap, so a screen change
            on this element still happens.
          </div>
        )}
        <AnimPhase
          title="Loop"
          primary={el.animations?.loop}
          extra={el.animations?.loopExtra}
          presets={LOOP_PRESETS}
          extraPresets={LOOP_EXTRA_PRESETS}
          defaultSpec={{ preset: 'float', durationMs: 2200, delayMs: 0, easing: 'ease-in-out', iterations: 'infinite' }}
          defaultExtraSpec={{ preset: 'lightray', durationMs: 2400, delayMs: 0, easing: 'ease-in-out', iterations: 'infinite' }}
          onChange={(primary, ex) => patchElement(id, { animations: { ...(el.animations ?? {}), loop: primary, loopExtra: ex.length ? ex : undefined } })}
        />
        <AnimPhase
          title="Exit"
          primary={el.animations?.exit}
          extra={el.animations?.exitExtra}
          presets={EXIT_PRESETS}
          extraPresets={NODE_PRESETS}
          defaultSpec={{ preset: 'fade-out', durationMs: 300, delayMs: 0, easing: 'ease-in' }}
          defaultExtraSpec={{ preset: 'scale-out', durationMs: 300, delayMs: 0, easing: 'ease-in' }}
          onChange={(primary, ex) => patchElement(id, { animations: { ...(el.animations ?? {}), exit: primary, exitExtra: ex.length ? ex : undefined } })}
        />
      </Accordion>

      {canScratch && (
        <Accordion id="inspector.scratch" title="Scratchable" defaultOpen={false}>
          <Toggle label="Covered until scratched" checked={!!el.scratch} onChange={(v) => patchElement(id, { scratch: v ? (el.scratch ?? {}) : undefined })} />
          {el.scratch && (
            <>
              <Slider
                label="Reveal at"
                value={Math.round((el.scratch.threshold ?? 0.55) * 100)}
                min={20}
                max={95}
                suffix="%"
                onChange={(n) => setScratch({ threshold: n / 100 })}
              />
              <Swatches label="Cover color" value={el.scratch.coverColor ?? '#d9b25b'} onChange={(c) => setScratch({ coverColor: c ?? '#d9b25b' })} />
              <Toggle label="Advance when all revealed" checked={el.scratch.advanceOnAllRevealed ?? true} onChange={(v) => setScratch({ advanceOnAllRevealed: v })} />
              <div className="hint pad">
                A coating covers this element in Preview/export; scratching it reveals the elements layered <b>behind</b> it (lower layers inside its box). An image element uses
                its own art as the foil; otherwise the cover color is used. Bind a <b>While scratching</b> sound in the Sound section.
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
                  options={[
                    { value: '', label: '(none)' },
                    ...(activeSceneDef()?.elements ?? []).filter((e) => e.type === 'text' && e.id !== id).map((e) => ({ value: e.id, label: e.name })),
                  ]}
                />
              </Row>
              <div className="hint pad">
                When uncovered, this element pops its amount, plays its <b>When revealed</b> sound (Sound section), and adds to the chosen tally text element. Mark the last app{' '}
                <b>Finale</b> for the big red number.
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
