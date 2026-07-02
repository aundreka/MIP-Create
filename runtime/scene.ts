// The scene.json schema — the single source of truth the editor writes and the
// runtime reads. Generalizes coinsort's layout.json ({key,x,y,scale,zIndex,mode}).
//
// Coordinates are DESIGN SPACE (baseW x baseH, default 1080x1920, origin
// top-left). x/y is the element's ANCHOR point; `anchor` selects which point of
// the element's box sits at (x,y). Base values are PORTRAIT; `landscape` holds
// only the diffs.

export type LayoutMode = 'fit' | 'extend'

export type Anchor =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export type ElementType =
  | 'background'
  | 'bar'
  | 'image'
  | 'text'
  | 'cta'
  | 'choice'
  | 'handguide'
  | 'countdown'
  | 'dim'
  | 'game-mount'
  | 'endscene'
  | 'unboxing'

export type ObjectFit = 'contain' | 'cover'

// ---- animation (full preset library wired in Pass 4; CTA pulse used now) ----
export type AnimPresetId =
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'pop'
  | 'bounce'
  | 'shake'
  | 'wave'
  | 'shine'
  | 'glow'
  | 'spin'
  | 'float'
  | 'pulse'
  | 'fade-out'
  | 'scale-out'

export interface KeyframeStep {
  at: number // 0..100
  transform?: string
  opacity?: number
  filter?: string
}

export type AnimTrigger = 'onMount' | 'onGameStart' | 'onGameWin' | 'onEndscene'

export interface AnimSpec {
  preset: AnimPresetId | 'custom'
  custom?: KeyframeStep[]
  durationMs: number
  delayMs: number
  easing: string
  iterations?: number | 'infinite'
  trigger?: AnimTrigger
}

export interface ElementAnimations {
  entrance?: AnimSpec
  loop?: AnimSpec
  exit?: AnimSpec
}

export interface SfxBinding {
  // 'tap' | 'sceneEnter' for any element. For scratch/reveal elements also:
  // 'whileScratching' (looped while the cover is being scratched) and
  // 'onReveal' (one-shot when a reveal target is uncovered).
  event: string
  assetId: string
  volume?: number
}

// ---- scratch-to-reveal -----------------------------------------------------
// `scratch` turns ANY element into a scratch COVER: at runtime a canvas coating
// is painted over its box and erased by the pointer. Elements layered behind it
// (lower zIndex, within its bounds) that carry `reveal` fire as they're uncovered;
// the cover may also carry its own `reveal` (single-card case). Editor-only fields
// are inert until Preview/export, like games.
export interface ScratchConfig {
  threshold?: number // fraction of a target's area cleared to count as revealed (default 0.55)
  coverColor?: string // solid cover when no coverAssetId (default gold '#d9b25b')
  coverAssetId?: string // optional foil / cover image
  brushFactor?: number // brush radius vs min(box) (default 0.09, matches the scratch game)
  advanceOnAllRevealed?: boolean // emit 'game-complete' once every target is revealed (default true)
}

// `reveal` marks an element as a reveal TARGET. When its area under a cover is
// cleared past threshold it pops a money label and accumulates into a tally text.
export interface RevealConfig {
  amount?: number // money added on reveal (e.g. 7.99). If unset, random in [randMin,randMax]
  randMin?: number // optional runtime-random amount (deterministic via seeded rng)
  randMax?: number
  currency?: string // default '$'
  color?: string // popup colour; red for the finale
  big?: boolean // finale styling (larger popup); author marks the last app
  popup?: boolean // show the floating amount at the element (default true)
  tallyId?: string // id of a text element to accumulate the running total into
}

// ---- type-specific config blocks ----
export interface TextConfig {
  value: string
  // Per-locale overrides for `value`, keyed by language code (e.g. { es: '…' }).
  // The runtime picks one from navigator.language at boot; `value` is the base.
  i18n?: Record<string, string>
  fontFamily?: string
  fontSizePx: number
  fontWeight?: number
  letterSpacingPx?: number
  lineHeight?: number
  color?: string
  align?: 'left' | 'center' | 'right'
  strokePx?: number
  strokeColor?: string
  shadow?: string
  maxWidthPx?: number
}

export type CtaPulsePreset = 'calm' | 'medium' | 'strong' | 'custom'
export interface CtaConfig {
  pulse: CtaPulsePreset
  pulseScale?: number      // peak scale factor (e.g. 1.06 = 6% bigger); default from preset
  pulseMinScale?: number   // base/min scale factor (e.g. 0.96 = squish); default 1.0
  pulseDurationMs?: number // full cycle duration ms; default from preset
  customPulse?: KeyframeStep[]
  clickUrlOverride?: string
}

export interface EndsceneConfig {
  /** 'video' (default) shows a video/image card; 'html' embeds an HTML asset in an iframe. */
  mode?: 'video' | 'html'
  // --- video mode ---
  portraitVideoId?: string
  landscapeVideoId?: string
  portraitImageId?: string
  landscapeImageId?: string
  objectFit: ObjectFit
  // Letterbox fills are independent per orientation, since portrait splits the
  // bars top/bottom while landscape splits them left/right (and a clip's top/bottom
  // edges differ in colour from its left/right edges).
  //   Portrait:  bgColor = single fill / TOP bar; bgColor2 = BOTTOM bar (split)
  //   Landscape: bgColorL = single fill / LEFT bar; bgColorL2 = RIGHT bar (split)
  // Landscape falls back to the portrait colour(s) when its own are unset.
  bgColor: string
  bgColor2?: string
  bgColorL?: string
  bgColorL2?: string
  matchBgEdge?: boolean // sample the clip's edge(s) to auto-set the fill(s)
  loop?: boolean
  muteUntilInteraction?: boolean
  ctaElementId?: string
  // --- html mode ---
  htmlId?: string          // portrait HTML asset
  htmlLandscapeId?: string // landscape HTML asset (falls back to portrait)
  // Background color override injected as CSS into the iframe so custom gradients
  // can be applied without modifying the HTML asset itself.
  //   Portrait:  htmlBgTop  = top (or solid fill); htmlBgBottom = bottom (split)
  //   Landscape: htmlBgLeft = left (or solid fill); htmlBgRight  = right  (split)
  // Landscape falls back to portrait values when unset.
  htmlBgTop?: string
  htmlBgBottom?: string
  htmlBgLeft?: string
  htmlBgRight?: string
}

// A background "box" behind text / CTA content: fill colour, corner radius,
// padding, border. The box SIZE comes from the element's w/h (explicit box) or
// auto-sizes to the content + padding when w/h are absent. All px are design px.
export type ShadowPreset = 'none' | 'soft' | 'medium' | 'strong'
export interface BoxStyle {
  bgColor?: string
  radiusPx?: number
  pill?: boolean // fully rounded regardless of height
  borderPx?: number
  borderColor?: string
  paddingXPx?: number
  paddingYPx?: number
  shadow?: ShadowPreset
}

// A live countdown / dynamic date. 'timer' counts down `seconds` from load;
// 'date' counts to a fixed `targetIso`; 'dynamic' targets (now + dynamicDays) so
// the date auto-updates whenever the ad runs. `format` is a token string:
// {d}{h}{m}{s} (raw) / {dd}{hh}{mm}{ss} (2-digit) / {date} (localized date).
export interface CountdownConfig {
  mode: 'timer' | 'date' | 'dynamic'
  seconds?: number
  targetIso?: string
  dynamicDays?: number
  format: string
  dateStyle?: 'short' | 'long' | 'numeric' // how {date} renders
  capitalize?: boolean // upper-case the first letter of every word in the rendered text
}

export interface DimConfig {
  color: string
  alpha: number
  blocksInput?: boolean
  cutoutElementId?: string
}

// One waypoint on a hand-guide slide path, in design px. `pauseMs` is how long the
// hand dwells (taps) at this node before moving to the next.
export interface HandguideNode {
  x: number
  y: number
  pauseMs?: number
}

// A hand-guide element (its own asset image). When interactive it animates:
// 'tap' bounces in place; 'slide' loops from its position through `nodes` (each
// with its own dwell time) in design px; 'smart' auto-targets the scene's CTA (or
// game) and slides/taps toward it. `toX/toY` is the legacy single-waypoint form,
// still honored when `nodes` is empty.
export interface HandguideConfig {
  mode: 'smart' | 'tap' | 'slide' | 'scratch'
  toX?: number
  toY?: number
  nodes?: HandguideNode[]
  periodMs?: number
  easing?: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'
  // Idle visibility (interactive runs only): hide on the player's tap, then reappear
  // after `idleMs` of no interaction, repeating. Defaults: hideOnInteract=true,
  // idleMs=4000, showInitially=true.
  idleMs?: number
  hideOnInteract?: boolean
  showInitially?: boolean
}

// A quiz/survey answer element (or, with advance=true, a "Continue"/next button).
// Styled like a CTA (box + text). When interactive: options in the same `group`
// are mutually exclusive; tapping selects (and, in `feedback` mode, reveals the
// correct answer green and a wrong pick red). An advance element fires the scene's
// next-step request on tap.
export interface ChoiceConfig {
  advance?: boolean
  group?: string
  correct?: boolean
  feedback?: boolean
  selectColor?: string
  correctColor?: string
  wrongColor?: string
  advanceDelayMs?: number
}

// Turn an asset into a container: its shape (alpha) masks an inner image, which
// fills per `fit` with optional inner padding. Works for any shape (heart, star…).
export interface ContainerConfig {
  imageId?: string
  fit: 'contain' | 'cover' | 'fill'
  padPx?: number
}

// Drag-and-drop slots. A `drag` element is a draggable item; a `slot` element is a
// drop target. Items + slots that share a `group` interact; an item snaps into a
// same-group slot on drop and can be dragged back out. Optional `key` lets a slot
// accept only a matching item (a "correct slot" puzzle). When every slot in a group
// is filled the runtime fires game completion (advances a gameWin scene).
export interface DragConfig {
  group?: string
  key?: string
}
export interface SlotConfig {
  group?: string
  key?: string
}

// Tap-to-select that fills display slots, with a generate step. A `pick` element is
// a tappable thumbnail; tapping it selects (single per group) and the group's `fill`
// slots show the chosen asset. A `generate` element (the result area) runs a circular
// progress when triggered (tapped, or a swipe) — gated until every `needs` group is
// picked — then reveals `resultId` (an image or video).
export interface PickConfig {
  group: string
}
export interface FillConfig {
  group: string
  index?: number // which pick of the group this slot shows (default = scene order)
}
export interface GenerateConfig {
  needs?: string[]
  durationMs?: number
  resultId?: string
  accent?: string
}

// Per-piece placement + animation end state.
// x/y = center of piece as % of element dimensions. w = width as % of element width.
export interface UnboxPiece {
  assetId?: string
  x?: number          // center X % (default 50)
  y?: number          // center Y % (default 50)
  w?: number          // width % of element width (default 100)
  rotation?: number   // initial rotation degrees (default 0)
  // Animation end state (used for the lid)
  endX?: number; endY?: number
  endRotation?: number; endScale?: number; endOpacity?: number
  durationMs?: number; delayMs?: number
}

// Mystery-box grid: shows N identical closed boxes composed of back+front+lid.
// Tap 1 → selected box flies to center (closed). Tap 2 → lid flies off, product rises.
// Layer order: back (z1) < product (z2) < front (z3) < lid (z4).
export interface UnboxingConfig {
  cols?: number; rows?: number; colGap?: number; rowGap?: number
  // Static container background
  bgAssetId?: string; bgScale?: number; bgX?: number; bgY?: number
  // Box pieces — define the closed state shown in each grid cell
  back?: UnboxPiece    // back face (static)
  front?: UnboxPiece   // front face (static, always in front of product)
  top?: UnboxPiece     // lid (flies off on reveal tap)
  // Product revealed inside (rises from below on reveal tap)
  winAssetId?: string; loseAssetId?: string
  productStartX?: number // product start center X % (default same as productX)
  productStartY?: number // product start center Y % (default 120 = below element)
  productX?: number      // product end center X % (default 50)
  productY?: number      // product end center Y % (default 28)
  productW?: number      // product width % (default 65)
  // Lose product overrides (fall back to win product values when unset)
  loseProductX?: number; loseProductY?: number; loseProductW?: number
  loseProductStartX?: number; loseProductStartY?: number
  productDurationMs?: number; productDelayMs?: number
  randomize?: boolean; winChance?: number
  cells?: Array<'win' | 'lose'>  // explicit per-cell outcome; overrides randomize when set
  // On reveal: swap another scene image element to a new asset
  revealSyncElementId?: string  // ID of a scene image element to update on reveal
  revealSyncAssetId?: string    // asset to swap it to
  // Timing
  selectMs?: number    // fly-to-center ms (default 450)
  centerSize?: number  // centered box width as % of element width (default 65)
  centerX?: number     // centered box position X offset in design-px (default 0 = centered)
  centerY?: number     // centered box position Y offset in design-px (default 0 = centered)
  tapHintMs?: number   // brief lock after centering to prevent accidental double-tap (default 300)
}

// "Sync to project": marks an element as shared across every MIP in the project
// group (see src/projectGroups.ts). All elements carrying the same `key` mirror one
// canonical definition — editing any of them updates all of them (position, size,
// text, asset, style — everything). `scope` decides placement: 'scene' = one copy
// per MIP; 'all' = one copy on every scene (a persistent overlay). Synced elements
// are ordinary SceneElements, so the runtime/export need no special handling.
export interface SyncConfig {
  key: string
  scope: 'scene' | 'all'
}

export interface GameMountConfig {
  templateId: string
  params: Record<string, unknown>
  winCondition?: Record<string, unknown>
  maxIterations?: number
  hintEnabled?: boolean
  hintIdleMs?: number
}

export interface BackgroundConfig {
  objectFit?: ObjectFit
  // Cover-crop focal point for PORTRAIT, as % of the image (0-100; default 50 = center).
  // Picks which part of the image stays visible when 'cover' crops it to fill the
  // frame. Landscape ignores these and always centers, so the image just covers the
  // whole (wider) screen.
  focusX?: number
  focusY?: number
}

// Header/footer bar (or, in 'fit' mode, a rectangle). Fill with a solid colour
// or stretch an image asset; if `color` is set and there's no assetId, the bar
// renders as a solid colour.
export interface BarConfig {
  color?: string
}

// ---- the element ----
export interface OrientationOverride {
  x?: number
  y?: number
  w?: number
  h?: number
  scale?: number
  mode?: LayoutMode
  anchor?: Anchor
  zIndex?: number
  hidden?: boolean
}

export interface SceneElement {
  id: string
  type: ElementType
  name: string
  assetId?: string

  x: number
  y: number
  w?: number
  h?: number
  scale?: number

  anchor: Anchor
  zIndex: number
  mode: LayoutMode

  // Pin an EXTEND bar to a true screen edge (header→'top', footer→'bottom')
  // instead of tracking the FIT layout vertically. Width still uses coverScale.
  pin?: 'top' | 'bottom'

  hidden?: boolean
  locked?: boolean // not selectable/movable on the editor canvas
  overlayImmune?: boolean // always rendered above in-game overlays (e.g. scratch-grid lose/win)
  groupId?: string // elements sharing a groupId select/move/scale together
  showOnWin?: boolean // revealed when the mounted game completes (endcard seed)
  rotation?: number
  opacity?: number
  blur?: number // uniform layer blur radius in design px (CSS filter: blur)

  sync?: SyncConfig // shared across all MIPs in the project group (editor-only marker)

  landscape?: OrientationOverride
  animations?: ElementAnimations
  sfx?: SfxBinding[]

  scratch?: ScratchConfig // this element is a scratch cover (canvas coating at runtime)
  reveal?: RevealConfig // this element pops money + adds to a tally when uncovered

  text?: TextConfig
  cta?: CtaConfig
  choice?: ChoiceConfig
  box?: BoxStyle // background box for text / cta / choice
  endscene?: EndsceneConfig
  countdown?: CountdownConfig
  game?: GameMountConfig
  dim?: DimConfig
  background?: BackgroundConfig
  bar?: BarConfig
  handguide?: HandguideConfig
  container?: ContainerConfig
  drag?: DragConfig
  slot?: SlotConfig
  pick?: PickConfig
  fill?: FillConfig
  generate?: GenerateConfig
  unboxing?: UnboxingConfig
}

export interface HeaderConfig {
  bgColor?: string
  color?: string
  heightPx?: number
  fontSizePx?: number
  fontWeight?: number
  fontFamily?: string
}

export interface ProjectMeta {
  schemaVersion: number // bumped when the saved shape changes; see src/migrate.ts
  name: string
  clickUrl: { ios: string; android: string }
  clickUrlMode?: 'store' | 'single' | 'none'
  baseW: number
  baseH: number
  bgMatchColor?: string
  bgMatchColor2?: string // gradient end: bottom (portrait) or right (landscape)
  networks?: string[]
  iterations?: string[]
  header?: HeaderConfig
  // First-class identity for cross-MIP QA (and, later, the shared team library).
  // A "MIP" is one playable variant; many MIPs belong to one client and are
  // checked for style/SFX/animation consistency against each other. Optional and
  // additive — older projects simply lack these and read as "unassigned".
  client?: string
  mip?: string
  mipVersion?: string
  // Fixed per-MIP date label (YYYY-MM-DD), set once when the MIP first gets a
  // client/MIP id and editable in Project settings. Part of the canonical MIP
  // name "<client> <mip> <mipDate>" that also drives the export filename
  // (see src/mipName.ts).
  mipDate?: string
  // Project grouping: several MIPs (each a `Project` in the code) belong to one
  // real-world "project" (brand + date + theme, e.g. "Bioma 2026-07 Scratch").
  // `projectId` is the stable group id (see src/projectGroups.ts); `projectName`
  // is denormalized for display. Optional/additive — unassigned MIPs lack them.
  projectId?: string
  projectName?: string
  // Localization: extra language codes this playable carries (the base copy lives
  // in each TextConfig.value). At runtime the playable picks one from the
  // browser language, falling back to the base. e.g. ['es','fr','de'].
  locales?: string[]
  defaultLocale?: string // label for the base copy (informational), e.g. 'en'
  cursor?: 'default' | 'none' | 'pointer' | 'crosshair'
  // Export-time variants — slightly different mechanics/win-conditions of the same
  // MIP. Each is a set of element patches applied on top of the base; export emits
  // one playable per variant. Editor-only field (stripped from the rendered scene).
  variants?: Variant[]
}

// A MIP variant: overrides applied to the base project at export. `patches` map
// an element id to a partial override (game params, win condition, swapped asset,
// text, etc.). Language is NOT a variant — it's resolved at runtime.
export interface VariantPatch {
  elementId: string
  patch: Partial<SceneElement>
}
export interface Variant {
  id: string
  name: string
  patches: VariantPatch[]
}

// `Scene` is the per-scene RENDER UNIT (what the stage builds). A project is an
// ordered list of scenes (SceneDef) with flow rules between them.
export interface Scene {
  meta: ProjectMeta
  elements: SceneElement[]
  kind?: SceneKind
  overlay?: SceneOverlay
  sfx?: SfxBinding[]
  bgm?: { assetId: string; volume: number }
}

export type AdvanceOn = 'gameWin' | 'timer' | 'tap' | 'manual'
export interface AdvanceRule {
  on: AdvanceOn
  delayMs?: number // for timer, or delay after gameWin/tap
  to?: string // target scene id (defaults to the next scene in order)
}

export type TransitionType = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'
export interface Transition {
  type: TransitionType
  durationMs: number
}

export type SceneKind = 'game' | 'overlay' | 'endscene'

export interface SceneOverlay {
  opacity?: number  // 0-1 dim strength
  color?: string    // hex, default '#000000'
  blurPx?: number   // backdrop-filter blur radius in px (blurs content behind the dim)
}

export interface SceneDef {
  id: string
  name: string
  kind?: SceneKind
  bgColor?: string  // per-scene gradient start: top (portrait) / left (landscape)
  bgColor2?: string // per-scene gradient end: bottom (portrait) / right (landscape)
  overlay?: SceneOverlay // built-in full-screen dim/blur overlay (win/lose scenes)
  elements: SceneElement[]
  advance: AdvanceRule
  transition?: Transition // how THIS scene ENTERS
}

export interface Project {
  meta: ProjectMeta
  scenes: SceneDef[]
  startSceneId: string
  sfx?: SfxBinding[]
  bgm?: { assetId: string; volume: number }
}
