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
  | 'button'
  | 'choice'
  | 'handguide'
  | 'countdown'
  | 'dim'
  | 'game-mount'
  | 'endscene'
  | 'unboxing'
  | 'confetti'

export type ObjectFit = 'contain' | 'cover'

// ---- animation (full preset library wired in Pass 4; CTA pulse used now) ----
export type AnimPresetId =
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  // Swipes travel a VIEWPORT-relative distance (110vw), so the element always
  // starts/ends fully off the physical screen at any size — unlike the slides,
  // which move a short authored distance around their resting position.
  | 'swipe-left'
  | 'swipe-right'
  | 'swipe-out-left'
  | 'swipe-out-right'
  // Wipes DON'T move the element: a clip edge sweeps across the box, uncovering it
  // (wipe-*) or erasing it (wipe-out-*). The name says which way the edge travels.
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-out-left'
  | 'wipe-out-right'
  | 'wipe-out-up'
  | 'typewriter'
  | 'pop'
  | 'bounce'
  | 'shake'
  | 'wave'
  | 'shine'
  | 'lightray'
  | 'glow'
  | 'spin'
  | 'float'
  | 'subtle-float'
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
  // Direction of the 'lightray' reflection sweep, in degrees: 0 = left→right, 90 = top→bottom,
  // 180 = right→left, 270 = bottom→top, 45 = top-left→bottom-right, etc. Ignored by other presets.
  angleDeg?: number
}

export interface ElementAnimations {
  entrance?: AnimSpec
  loop?: AnimSpec
  exit?: AnimSpec
  gameWin?: AnimSpec
  // Additional specs stacked ON TOP of the primary one in each phase, played together with it
  // (e.g. entrance = pop + shine). Empty/absent = just the primary. The primary must exist for
  // extras to apply; extras share the primary entrance's trigger.
  entranceExtra?: AnimSpec[]
  loopExtra?: AnimSpec[]
  exitExtra?: AnimSpec[]
  gameWinExtra?: AnimSpec[]
}

/**
 * Video-editor style lifetime for an element on its scene's local timeline.
 * The clock starts when the scene is entered (t = 0).
 *
 *   inMs       when the element appears — its entrance animation starts here.
 *   durationMs how long it stays. Omitted = stays until the scene ends (an open
 *              clip). When set, the exit animation starts at inMs + durationMs
 *              and the element is removed once that exit finishes.
 *
 * The in/out animations themselves are the element's ordinary `animations.entrance`
 * / `animations.exit` specs, so there is exactly one animation model — timing only
 * decides WHEN they fire. Absent `timing` = today's behaviour (always visible).
 */
export interface TimingConfig {
  inMs: number
  durationMs?: number
}

/**
 * Typewriter reveal for a text / dynamic-date element: the string appears one
 * character at a time when the element enters.
 *
 * Driven in JS rather than the classic CSS steps()+width trick, which needs a
 * monospace font to land on character boundaries and can't handle wrapping — this
 * works with any font, any number of lines, and stays correct across relayouts
 * because the partial string is re-derived from the live text on every layout pass.
 *
 * Speed and total time are two views of the same thing: `durationMs` wins when set
 * (the whole string types in exactly that long, whatever its length), otherwise the
 * string types at `cps` characters per second.
 */
export interface TypingConfig {
  cps?: number // characters per second (default 24); ignored when durationMs is set
  durationMs?: number // total time to type the whole string, overrides cps
  delayMs?: number // wait this long after the element enters before typing starts
  caret?: boolean // show a blinking caret while typing
  keepCaret?: boolean // keep the caret after the last character (default: hide it)
  loop?: boolean // retype forever: type, hold, clear, repeat
  holdMs?: number // pause at the full string before looping (default 1500)
}

export interface SfxBinding {
  // 'tap' | 'sceneEnter' | 'elementEnter' for any element. 'elementEnter' fires one-shot as the
  // element animates in — at its entrance stagger delay — so staggered pop-ins each get their sound
  // (fires immediately if the element has no entrance). For scratch/reveal elements also:
  // 'whileScratching' (looped while the cover is being scratched) and
  // 'onReveal' (one-shot when a reveal target is uncovered). Game mounts can also
  // bind template-specific events such as 'catch' for the basket catch template.
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

// A plain clickable button. Visually it's a CTA (text label OR image via assetId,
// styled with the shared `box`), but on click it navigates to another SCENE instead
// of firing the store redirect. Animation is opt-in (via `el.animations`, not an
// always-on pulse) and it only floats above overlays when `overlayImmune` is set.
export interface ButtonConfig {
  // Target scene id to navigate to on click. Empty/unset = advance to the scene's
  // configured next scene (same as a tap), via the generic 'pa-advance' signal.
  targetSceneId?: string
  // Visual tap feedback, applied while the element is held down (:active).
  // Unset/'none' = no feedback. Also used by plain IMAGE elements marked as buttons.
  tapEffect?: ButtonTapEffect
}

// 'press' = brief scale-down (the most readable "tap registered" signal on touch);
// 'glow' = box-shadow bloom; 'outline' = a ring around the element.
export type ButtonTapEffect = 'none' | 'press' | 'glow' | 'outline'

export interface EndsceneConfig {
  /** 'video' (default) shows a video/image card; 'html' embeds an HTML asset in an iframe. */
  mode?: 'video' | 'html'
  // --- video mode ---
  portraitVideoId?: string
  landscapeVideoId?: string
  portraitImageId?: string
  landscapeImageId?: string
  objectFit: ObjectFit
  // 'extend (full height)' fill: the media always spans the FULL screen height at its
  // natural aspect, centred horizontally — cropping the sides when wider than the
  // screen, or showing the background fill beside it when narrower. Overrides objectFit.
  fullHeight?: boolean
  // Per-orientation FIT overrides for LANDSCAPE. When unset, landscape inherits the
  // portrait fit (objectFit / fullHeight); when set they win in landscape only — so a
  // clip can e.g. 'contain' in portrait but 'cover' in landscape.
  objectFitL?: ObjectFit
  fullHeightL?: boolean
  // Make the endcard background transparent instead of a solid/letterbox fill, so a
  // lower-zIndex element (e.g. a full-screen background image) shows through the gaps
  // around the media. Overrides the bgColor* fills.
  transparentBg?: boolean
  zoom?: number // scale factor (0.5 - 2.0); default 1.0 for no scaling
  // Per-orientation ZOOM override for LANDSCAPE. When unset, landscape inherits the
  // portrait zoom; when set it wins in landscape only.
  zoomL?: number
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
// {d}{h}{m}{s} (raw) / {dd}{hh}{mm}{ss} (2-digit) / {date} (localized date) /
// date parts of the target date: {MMMM} July, {MMM} Jul, {M}/{MM} 7/07,
// {D}/{DD} 12/12, {Do} 21st (ordinal day), {o} the bare suffix, {YYYY}/{YY} —
// month names follow dateLocale; the ordinal suffix is English-only.
export interface CountdownConfig {
  // 'clock' shows the CURRENT wall-clock time (default format '{hh}:{mm}' → "14:05"),
  // re-rendered every second; the other modes count toward a target instant.
  mode: 'timer' | 'date' | 'dynamic' | 'clock'
  seconds?: number
  targetIso?: string
  dynamicDays?: number
  format: string
  dateStyle?: 'short' | 'long' | 'numeric' | 'monthDay' // how {date} renders
  dateLocale?: string // BCP-47 tag for {date} rendering (default 'en-US')
  // Clock mode only: render {h}/{hh} as 1–12 instead of 0–23. The AM/PM suffix is the
  // separate {A} (PM) / {a} (pm) token, so it can sit anywhere in the format.
  hour12?: boolean
  // Case applied to the whole rendered string. Month names come out of Intl already
  // title-cased, so 'upper' is what turns "Jul" into "JUL"; 'title' only affects
  // lower-case words you typed yourself.
  textCase?: 'none' | 'title' | 'upper' | 'lower'
  /** @deprecated superseded by textCase ('title'); still honored for older projects. */
  capitalize?: boolean
  // Glue this element to another element (usually an image): position and font
  // size are derived from the TARGET's rendered rect instead of the global FIT
  // math, so the text keeps the same relative offset and proportional height at
  // every viewport size / zoom — even when the target lays out differently
  // (extend bars, pinned headers). x/y stay authored in design px; they become
  // an offset from the target's design position.
  attachToId?: string
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
// game) and slides/taps toward it; 'match' tap-bounces over the memory-match
// game's suggested card (the element marked data-mm-hint — one card of a pair,
// then its partner once the first is flipped). `toX/toY` is the legacy
// single-waypoint form, still honored when `nodes` is empty.
export interface IdleConfig {
  idleMs?: number
  hideOnInteract?: boolean
  reappearOnIdle?: boolean
  showInitially?: boolean
}

export interface HandguideConfig {
  // 'brush' points the hand at the scratch card's brush (appears only after the brush's intro).
  // 'still' places the hand and leaves it there — no motion of any kind (idle
  // show/hide still applies; it just never moves).
  mode: 'smart' | 'tap' | 'slide' | 'scratch' | 'match' | 'brush' | 'still'
  toX?: number
  toY?: number
  nodes?: HandguideNode[]
  periodMs?: number
  // 'brush' mode only: extra offset of the hand from the brush (screen px; the hand already sits
  // BELOW the brush by default), and a rotation. The hand mimes a drag across the card.
  brushOffsetX?: number
  brushOffsetY?: number
  brushRotateDeg?: number
  easing?: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'
  // Idle visibility (interactive runs only): hide on the player's tap, then reappear
  // after `idleMs` of no interaction, repeating. Defaults: hideOnInteract=true,
  // idleMs=4000, showInitially=true, reappearOnIdle=true.
  idleMs?: number
  hideOnInteract?: boolean
  reappearOnIdle?: boolean
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

// Crop an ordinary image element, Canva-style. The element's box (w/h) is the crop
// WINDOW; the source image sits behind it at its own size/offset and the box clips
// it. Dragging the window's edges reveals/hides the image (it does NOT rescale the
// picture); dragging inside pans it; scrolling zooms. Placement is stored RELATIVE
// to the box so it survives responsive scaling — the image always keeps its aspect.
//   scale = image width ÷ box width (1 = image exactly as wide as the box)
//   x / y = image top-left as a fraction of box width / height (may be negative)
// Absent = legacy behaviour (image simply fills the box, no clipping).
export interface ImageCropConfig {
  scale?: number // image width ÷ box width; default 1
  x?: number     // image left as a fraction of box width; default 0
  y?: number     // image top as a fraction of box height; default 0
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

// Full-screen celebratory confetti overlay. A self-contained canvas particle system
// ported from the react-confetti model (fluttering, drifting, spinning rectangles +
// circles) — no npm dependency. 'rain' falls from the top; 'burst' explodes from a
// point (originX/originY). It animates only during interactive playback
// (Preview/export); the editor canvas shows a single frozen frame so it can be placed.
export interface ConfettiConfig {
  mode?: 'rain' | 'burst'
  trigger?: 'sceneEnter' | 'onGameWin' // when it fires (default sceneEnter)
  pieces?: number // particle count (default 200)
  colors?: string[] // palette (default a Material-ish 16-colour set)
  gravity?: number // downward acceleration per frame (default 0.08 rain / 0.28 burst)
  wind?: number // constant horizontal drift (default 0)
  spread?: number // initial horizontal velocity range, rain (default 5)
  power?: number // launch/fall speed (default 8 rain / 9 burst)
  scalar?: number // piece-size multiplier (default 1)
  recycle?: boolean // rain: keep respawning pieces so it never runs out (default true)
  durationMs?: number // rain+recycle: emit for N ms then let it fall out (0/unset = forever)
  originX?: number // burst origin X, % of width (default 50)
  originY?: number // burst origin Y, % of height (default 45)
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
  // 'fill' stretches the image to the exact screen width AND height (no crop, may
  // distort) — for portrait-only art that should fill the screen without cropping.
  objectFit?: ObjectFit | 'fill'
  // Alternate image shown in LANDSCAPE instead of the element's assetId (which is
  // the portrait/default art). Unset = the same image is used in both orientations.
  landscapeAssetId?: string
  // Cover-crop focal point for PORTRAIT, as % of the image (0-100; default 50 = center).
  // Picks which part of the image stays visible when 'cover' crops it to fill the
  // frame. Landscape ignores these and always centers, so the image just covers the
  // whole (wider) screen.
  focusX?: number
  focusY?: number
  // Extra zoom applied on top of the object-fit crop. 1 = none; >1 zooms IN around
  // the focal point (portrait) / center (landscape); <1 zooms out (may reveal the
  // scene background at the edges). Overflow beyond the screen is clipped.
  zoom?: number
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

// Optional content/layout overrides for one browser language. Asset swaps are
// shared by both orientations; geometry is independent so translated artwork or
// longer copy can be composed separately in portrait and landscape. Every field
// falls back to the ordinary element when absent.
export interface LocaleElementOverride {
  assetId?: string
  portrait?: OrientationOverride
  landscape?: OrientationOverride
  // A complete element authored in another playable. This is used by the
  // "combine translated playables" workflow so text, art, game settings,
  // animations, and orientation layouts can travel together. Manual asset or
  // geometry overrides above are still applied last, making the result editable
  // with the ordinary Languages controls.
  source?: SceneElement
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
  relativeToBasketBar?: boolean

  hidden?: boolean
  locked?: boolean // not selectable/movable on the editor canvas
  overlayImmune?: boolean // always rendered above in-game overlays (e.g. scratch-grid lose/win)
  overlayTop?: boolean // a HIGHER immune tier — floats above other "above overlays" elements
  hideOnOverlay?: boolean // hidden while a floating overlay (win/lose card) is up over this scene
  groupId?: string // elements sharing a groupId select/move/scale together
  showOnWin?: boolean // revealed when the mounted game completes (endcard seed)
  showAfterInteraction?: boolean // revealed only after the user's first interaction (e.g. dragging the basket)
  hideAfterBasketInteraction?: boolean // hidden after the user's first Catch basket tap/drag
  // Fade this element in/out based on the scratch game's live progress (0..100%). scratchShowAt:
  // starts hidden and fades IN once progress >= the value. scratchHideAt: fades OUT once progress >=
  // the value. Set both for a visible window [showAt, hideAt). Unset = always visible (default).
  scratchShowAt?: number
  scratchHideAt?: number
  // Show this element ONLY while the given page of a flipbook in the scene is open —
  // 1-based, page 1 being the shut cover when the book has one. Unset = always
  // visible. The editor canvas ignores it so every page's elements stay placeable.
  showOnPage?: number
  rotation?: number
  opacity?: number
  blur?: number // uniform layer blur radius in design px (CSS filter: blur)
  // Background (backdrop) blur — blurs the SCENE CONTENT BEHIND this element's box,
  // like Figma's "Background blur" effect (as opposed to `blur`, which blurs the
  // element's OWN content). Radius is in design px, scaled with the fit.
  //   backdropBlurMode: 'uniform' (default) — even blur across the whole box;
  //     'progressive' — blur ramps along `backdropBlurDir` via a linear-gradient mask
  //        (clear at the near edge → full blur at the far edge);
  //     'radial' — clear in the centre, blurring toward the edges (radial-gradient mask).
  // Progressive/radial fade the whole layer, so they suit overlay-style boxes (dim/bar).
  backdropBlur?: number
  backdropBlurMode?: 'uniform' | 'progressive' | 'radial'
  backdropBlurDir?: 'up' | 'down' | 'left' | 'right' // progressive ramp direction (default 'down')

  sync?: SyncConfig // shared across all MIPs in the project group (editor-only marker)

  // Per-language asset and layout overrides, keyed by BCP-47 code ("es",
  // "pt-BR", ...). The base element is the default-language/English fallback.
  localeOverrides?: Record<string, LocaleElementOverride>

  landscape?: OrientationOverride
  timing?: TimingConfig // scene-timeline in/out window (see TimingConfig)
  typing?: TypingConfig // typewriter reveal for text / countdown elements
  animations?: ElementAnimations
  sfx?: SfxBinding[]
  idle?: IdleConfig

  scratch?: ScratchConfig // this element is a scratch cover (canvas coating at runtime)
  reveal?: RevealConfig // this element pops money + adds to a tally when uncovered

  text?: TextConfig
  cta?: CtaConfig
  button?: ButtonConfig
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
  crop?: ImageCropConfig // crop/pan/zoom an ordinary image within its box
  drag?: DragConfig
  slot?: SlotConfig
  pick?: PickConfig
  fill?: FillConfig
  generate?: GenerateConfig
  unboxing?: UnboxingConfig
  confetti?: ConfettiConfig
}

export interface HeaderConfig {
  bgColor?: string
  color?: string
  heightPx?: number
  fontSizePx?: number
  fontWeight?: number
  fontFamily?: string
  // Distance from the physical top of the band to the date text. When set, the
  // text is top-anchored inside the band; when omitted the text is vertically
  // centred (the original behaviour).
  topPaddingPx?: number
  // Horizontal alignment of the date text within the band. Default 'center'.
  align?: 'left' | 'center' | 'right'
  // Extra letter spacing (tracking) in px. Default 0.
  letterSpacingPx?: number
  // Literal text wrapped around the formatted date, e.g. prefix "DAY " → "DAY JULY 3, 2026".
  prefix?: string
  suffix?: string
  // What the band displays. 'date' (default) renders today's date; 'countdown'
  // renders a live timer counting down from countdownSeconds after load, using
  // the same {hh}/{mm}/{ss} tokens as the countdown element.
  mode?: 'date' | 'countdown'
  countdownSeconds?: number // timer length in seconds (default 300)
  countdownFormat?: string // token string, e.g. '{mm} {ss}' (default '{mm}:{ss}')
  // Custom layout for date mode, e.g. 'MMMM D, YYYY' → "July 15, 2026". Tokens
  // (bare or {braced}): MMMM full month, MMM short month, MM/M numeric month,
  // DD/D day, Do ordinal day (21st), YYYY/YY year. Empty → localized full date,
  // uppercased (legacy English shape: "JULY 15, 2026").
  dateFormat?: string
  dateLocale?: string // BCP-47 tag for date/month rendering (default 'en-US')
  dateStyle?: 'short' | 'long' | 'numeric' | 'monthDay' // how {date} renders in custom formats
  // Case applied to the rendered date/timer. 'upper' is what turns "Jul" into "JUL" —
  // Intl hands back month names already title-cased, so 'title' is a no-op on them.
  textCase?: 'none' | 'title' | 'upper' | 'lower'
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
  // Optional complete header configurations for browser languages. Missing
  // entries inherit `header`, just like localized elements inherit their base.
  headerI18n?: Record<string, HeaderConfig>
  // First-class identity for cross-MIP QA (and, later, the shared team library).
  // A "MIP" is one playable variant; many MIPs belong to one client and are
  // checked for style/SFX/animation consistency against each other. Optional and
  // additive — older projects simply lack these and read as "unassigned".
  client?: string
  mip?: string
  mipVersion?: string
  // Fixed per-MIP date label (YYYY-MM-DD), set once when the MIP first gets a
  // client/MIP id and editable in Project settings. Part of the canonical MIP
  // name "<client> <mip> <mipDate>".
  mipDate?: string
  // Export filename date token (YYYY-MM-DD in Project settings; written as
  // YYYYMMDD in the delivered filename). Kept separate from `mipDate` because
  // delivery naming can follow a different schedule than the MIP's canonical
  // identity date.
  exportDate?: string
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
  // Vertical anchor for the FIT content block on screens taller than the design
  // aspect. 'top' (default) glues content to the top and pools spare height at the
  // bottom; 'center' splits the spare height top/bottom so the composition sits in
  // the middle. Top-pinned headers/bars stay pinned regardless.
  vAlign?: 'top' | 'center'
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
  timelineMs?: number
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
  // Falloff for the backdrop blur (mirrors an element's Background-blur effect):
  //   'uniform' (default) — even blur across the whole screen;
  //   'progressive' — blur ramps along `blurDir` (linear-gradient mask);
  //   'radial' — clear in the centre, blurring toward the edges (radial-gradient mask).
  blurMode?: 'uniform' | 'progressive' | 'radial'
  blurDir?: 'up' | 'down' | 'left' | 'right' // progressive ramp direction (default 'down')
  // Overlay fill shape. 'solid' (default) — an even `color` tint at `opacity`.
  // 'radial' — a radial gradient from `color` at the CENTRE to `color2` at the EDGES
  //   (both at `opacity`); when `color2` is unset the edge fades to transparent, giving
  //   a centre glow / vignette, like Figma's Radial fill.
  fillMode?: 'solid' | 'radial'
  color2?: string
  // Radial fill strength, 0-100 (default 50): how much of the radius holds the full
  // centre colour before fading to the edge. Higher = the colour covers more of the
  // screen with a tighter, more pronounced edge; lower = a soft, subtle glow.
  radialStrength?: number
}

export interface SceneDef {
  id: string
  name: string
  kind?: SceneKind
  bgColor?: string  // per-scene gradient start: top (portrait) / left (landscape)
  bgColor2?: string // per-scene gradient end: bottom (portrait) / right (landscape)
  overlay?: SceneOverlay // built-in full-screen dim/blur overlay (win/lose scenes)
  // Overlay scenes only: ALSO treat this scene as the MRAID end card. It still floats over
  // the running game (so its dim/blur shows the game through) but gets the endscene's
  // wrap — gameEnd signalled to the network, the whole surface tap-to-install, no date
  // header — and is TERMINAL: its advance rule is ignored, nothing dismisses it. Use it for
  // an end card that keeps the finished game board visible behind the dim, instead of
  // cutting to a separate full-screen endscene. Ignored unless kind === 'overlay'.
  asEndscene?: boolean
  elements: SceneElement[]
  advance: AdvanceRule
  transition?: Transition // how THIS scene ENTERS
  hideHeader?: boolean // hide the pinned date/countdown header (meta.header) while this scene is current
  // Length of the editor's timeline ruler for this scene, in ms (editor-only —
  // the runtime never reads it; element timing windows are absolute). Absent =
  // the timeline sizes itself to the longest clip.
  timelineMs?: number
  // Optional complete visual/content versions of this scene for individual
  // browser languages. Flow (`advance`) and transition stay owned by the master
  // scene so importing a translated scene cannot break navigation.
  localeOverrides?: Record<string, LocaleSceneOverride>
}

export interface LocaleSceneOverride {
  source: SceneDef
}

export interface Project {
  meta: ProjectMeta
  scenes: SceneDef[]
  startSceneId: string
  sfx?: SfxBinding[]
  bgm?: { assetId: string; volume: number }
}
