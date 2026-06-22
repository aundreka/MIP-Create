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
  event: string
  assetId: string
  volume?: number
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
  customPulse?: KeyframeStep[]
  clickUrlOverride?: string
}

export interface EndsceneConfig {
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
  mode: 'smart' | 'tap' | 'slide'
  toX?: number
  toY?: number
  nodes?: HandguideNode[]
  periodMs?: number
  easing?: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'
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
  groupId?: string // elements sharing a groupId select/move/scale together
  showOnWin?: boolean // revealed when the mounted game completes (endcard seed)
  rotation?: number
  opacity?: number

  landscape?: OrientationOverride
  animations?: ElementAnimations
  sfx?: SfxBinding[]

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
}

export interface ProjectMeta {
  schemaVersion: 1
  name: string
  clickUrl: { ios: string; android: string }
  baseW: number
  baseH: number
  bgMatchColor?: string
  networks?: string[]
  iterations?: string[]
  // First-class identity for cross-MIP QA (and, later, the shared team library).
  // A "MIP" is one playable variant; many MIPs belong to one client and are
  // checked for style/SFX/animation consistency against each other. Optional and
  // additive — older projects simply lack these and read as "unassigned".
  client?: string
  mip?: string
  mipVersion?: string
  // Localization: extra language codes this playable carries (the base copy lives
  // in each TextConfig.value). At runtime the playable picks one from the
  // browser language, falling back to the base. e.g. ['es','fr','de'].
  locales?: string[]
  defaultLocale?: string // label for the base copy (informational), e.g. 'en'
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

export type SceneKind = 'game' | 'win' | 'endscene' | 'custom'

export interface SceneDef {
  id: string
  name: string
  kind?: SceneKind
  bgColor?: string // per-scene background (overrides project meta.bgMatchColor)
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
