// Animation keyframe library + per-element animation composition. One injected
// <style> holds the named @keyframes (custom keyframe sets are appended on demand
// with a content-hashed name). Animations live on the inner `.pa-el-anim` node so
// they never fight the stage's positional transform on the outer `.pa-el`.
//
// Standardized CTA pulses (the fix for the 1.0-2.4s / 1.025-1.05 cross-MIP drift)
// double as a CTA's default loop. Per-element entrance / loop / exit specs come
// from element.animations (see scene.ts AnimSpec).

import type { AnimSpec, KeyframeStep, SceneElement } from './scene'

let injected = false
let styleEl: HTMLStyleElement | null = null

export const CTA_PULSE: Record<'calm' | 'medium' | 'strong', { name: string; durationMs: number }> = {
  calm: { name: 'pa-cta-pulse-calm', durationMs: 1600 },
  medium: { name: 'pa-cta-pulse-medium', durationMs: 1200 },
  strong: { name: 'pa-cta-pulse-strong', durationMs: 900 },
}

const KEYFRAMES = `
@keyframes pa-cta-pulse-calm{0%,100%{transform:scale(1)}50%{transform:scale(1.025)}}
@keyframes pa-cta-pulse-medium{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
@keyframes pa-cta-pulse-strong{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes pa-fade{0%{opacity:0;transform:scale(.985)}100%{opacity:1;transform:scale(1)}}
@keyframes pa-pop{0%{transform:scale(.5);opacity:0}55%{transform:scale(1.08);opacity:1}75%{transform:scale(.97)}100%{transform:scale(1);opacity:1}}
/* Travel distances are authored in DESIGN px and multiplied by --pa-s (the live FIT
   scale, published by responsive.computeMetrics) so a slide covers the same share of
   the composition on a small phone, a tablet and a zoomed-in editor canvas. Without
   the factor the motion would be a fixed screen distance and the element would settle
   from a visibly different place on every viewport. --pa-s defaults to 1 so these
   rules still read sensibly if a surface never ran computeMetrics. */
@keyframes pa-slide-up{0%{transform:translateY(calc(46px * var(--pa-s,1)));opacity:0}70%{transform:translateY(calc(-8px * var(--pa-s,1)));opacity:1}100%{transform:translateY(0);opacity:1}}
@keyframes pa-slide-down{0%{transform:translateY(calc(-46px * var(--pa-s,1)));opacity:0}70%{transform:translateY(calc(8px * var(--pa-s,1)));opacity:1}100%{transform:translateY(0);opacity:1}}
@keyframes pa-slide-left{0%{transform:translateX(calc(46px * var(--pa-s,1)));opacity:0}70%{transform:translateX(calc(-8px * var(--pa-s,1)));opacity:1}100%{transform:translateX(0);opacity:1}}
@keyframes pa-slide-right{0%{transform:translateX(calc(-46px * var(--pa-s,1)));opacity:0}70%{transform:translateX(calc(8px * var(--pa-s,1)));opacity:1}100%{transform:translateX(0);opacity:1}}
/* Swipes: a full-screen traversal, so the travel is VIEWPORT-relative (110vw always
   clears the physical screen from any on-screen position) rather than design-relative.
   "swipe-left" = the element flies in travelling leftwards (enters from the right edge);
   "swipe-up" = it flies in travelling upwards (enters from the bottom edge, 110vh away);
   "swipe-out-left" = it flies off past the left edge. The small overshoot at 88% gives
   the arrival some weight instead of a dead stop. */
@keyframes pa-swipe-left{0%{transform:translateX(110vw);opacity:0}60%{opacity:1}88%{transform:translateX(calc(-14px * var(--pa-s,1)))}100%{transform:translateX(0);opacity:1}}
@keyframes pa-swipe-right{0%{transform:translateX(-110vw);opacity:0}60%{opacity:1}88%{transform:translateX(calc(14px * var(--pa-s,1)))}100%{transform:translateX(0);opacity:1}}
@keyframes pa-swipe-up{0%{transform:translateY(110vh);opacity:0}60%{opacity:1}88%{transform:translateY(calc(-14px * var(--pa-s,1)))}100%{transform:translateY(0);opacity:1}}
@keyframes pa-swipe-out-left{0%{transform:translateX(0);opacity:1}12%{transform:translateX(calc(14px * var(--pa-s,1)))}70%{opacity:1}100%{transform:translateX(-110vw);opacity:0}}
@keyframes pa-swipe-out-right{0%{transform:translateX(0);opacity:1}12%{transform:translateX(calc(-14px * var(--pa-s,1)))}70%{opacity:1}100%{transform:translateX(110vw);opacity:0}}
/* DROP — a gravity fall from above the screen (viewport-relative start, like the swipes),
   landing at rest with two diminishing bounces. The per-keyframe timing functions make the
   fall accelerate and each rebound decelerate no matter which easing the author picked, so
   it always reads as weight rather than a linear glide. */
@keyframes pa-drop{0%{transform:translateY(-110vh);opacity:0;animation-timing-function:cubic-bezier(.55,.06,.68,.19)}8%{opacity:1}62%{transform:translateY(0);animation-timing-function:cubic-bezier(.22,1,.36,1)}76%{transform:translateY(calc(-22px * var(--pa-s,1)));animation-timing-function:cubic-bezier(.55,.06,.68,.19)}88%{transform:translateY(0);animation-timing-function:cubic-bezier(.22,1,.36,1)}94%{transform:translateY(calc(-7px * var(--pa-s,1)))}100%{transform:translateY(0);opacity:1}}
/* WIPES — the element stays put and a moving edge uncovers or erases it, like a
   squeegee crossing the box. clip-path:inset(top right bottom left): growing the
   RIGHT inset eats the box from the right edge inward, growing the LEFT inset eats
   it from the left. Direction names the way the edge TRAVELS:
     wipe-right     reveal, edge travels left→right   (content appears from the left)
     wipe-left      reveal, edge travels right→left
     wipe-out-left  erase,  edge travels right→left   (the left side is last to go)
     wipe-out-right erase,  edge travels left→right
   Percentages, so the sweep covers the whole element at any size — no --pa-s needed.
   A CSS animation outranks the inline clip-path layoutRec writes for the blur clip,
   so the two never fight. */
@keyframes pa-wipe-right{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes pa-wipe-left{from{clip-path:inset(0 0 0 100%)}to{clip-path:inset(0 0 0 0)}}
@keyframes pa-wipe-out-left{from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 100% 0 0)}}
@keyframes pa-wipe-out-right{from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 0 0 100%)}}
@keyframes pa-wipe-up{from{clip-path:inset(100% 0 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes pa-wipe-out-up{from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 0 100% 0)}}
/* Typewriter caret — a blinking bar parked at the end of the typed text. */
@keyframes pa-caret-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
.pa-typing-caret::after{content:'';display:inline-block;width:.08em;height:1em;margin-left:.06em;
  vertical-align:-.12em;background:currentColor;animation:pa-caret-blink 1s step-end infinite;}
@keyframes pa-bounce{0%,100%{transform:translateY(0)}30%{transform:translateY(calc(-18px * var(--pa-s,1)))}55%{transform:translateY(0)}75%{transform:translateY(calc(-7px * var(--pa-s,1)))}}
@keyframes pa-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(calc(-6px * var(--pa-s,1)))}40%{transform:translateX(calc(6px * var(--pa-s,1)))}60%{transform:translateX(calc(-4px * var(--pa-s,1)))}80%{transform:translateX(calc(4px * var(--pa-s,1)))}}
@keyframes pa-wave{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
@keyframes pa-shine{0%,100%{filter:brightness(1)}50%{filter:brightness(1.45)}}
@keyframes pa-glow{0%,100%{filter:drop-shadow(0 0 0 rgba(255,255,255,0))}50%{filter:drop-shadow(0 0 14px rgba(255,255,255,.85))}}
/* light-ray reflection sweep: a glossy highlight slides across the asset, clipped to its box
   (overflow:hidden). TWO layers sweep together on the SAME box (so they stay in sync): ::before is
   a wide soft halo/glow and ::after is a narrow bright core — together they read as a real specular
   reflection instead of a flat white line. 'screen' blend keeps it additive (lightens only). The
   band is rotated by --pa-lightray-ang and translated along its own x-axis, so ONE angle sets the
   direction: 0=left→right, 90=top→bottom, 180=right→left, 45=corner→corner, etc. Driven by the
   .pa-lightray class; duration/delay/easing/angle come from CSS vars set in applyMountAnim(). */
.pa-lightray{position:relative;overflow:hidden}
.pa-lightray::before,.pa-lightray::after{content:'';position:absolute;top:50%;left:50%;width:70%;height:320%;margin:-160% 0 0 -35%;pointer-events:none;z-index:2;mix-blend-mode:screen;transform:rotate(var(--pa-lightray-ang,20deg)) translateX(var(--pa-lightray-from,-340%));animation:pa-lightray-kf var(--pa-lightray-dur,2400ms) var(--pa-lightray-ease,ease-in-out) var(--pa-lightray-delay,0ms) infinite;will-change:transform}
/* wide soft halo (the glow around the glint) */
.pa-lightray::before{background:linear-gradient(90deg,rgba(255,255,255,0) 30%,rgba(255,255,255,0.07) 42%,rgba(255,255,255,0.20) 50%,rgba(255,255,255,0.07) 58%,rgba(255,255,255,0) 70%)}
/* narrow bright core with soft shoulders (the specular streak itself) */
.pa-lightray::after{background:linear-gradient(90deg,rgba(255,255,255,0) 41%,rgba(255,255,255,0.28) 46%,rgba(255,255,255,0.85) 49.5%,rgba(255,255,255,0.98) 50%,rgba(255,255,255,0.85) 50.5%,rgba(255,255,255,0.28) 54%,rgba(255,255,255,0) 59%)}
@keyframes pa-lightray-kf{0%{transform:rotate(var(--pa-lightray-ang,20deg)) translateX(var(--pa-lightray-from,-340%))}55%,100%{transform:rotate(var(--pa-lightray-ang,20deg)) translateX(var(--pa-lightray-to,340%))}}
@keyframes pa-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes pa-float{0%,100%{transform:translateY(0)}50%{transform:translateY(calc(-10px * var(--pa-s,1)))}}
@keyframes pa-subtle-float{0%,100%{transform:translateY(0)}50%{transform:translateY(calc(-3px * var(--pa-s,1)))}}
@keyframes pa-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
@keyframes pa-fade-out{from{opacity:1}to{opacity:0}}
@keyframes pa-scale-out{from{transform:scale(1);opacity:1}to{transform:scale(.7);opacity:0}}
`.trim()

/** Inject the keyframe stylesheet once; keep the node for custom-keyframe appends. */
export function injectAnimStyles(): void {
  if (injected) return
  injected = true
  styleEl = document.createElement('style')
  styleEl.id = 'pa-anim'
  styleEl.textContent = KEYFRAMES
  document.head.appendChild(styleEl)
}

// ---- preset peak scales (the max scale at the 50% keyframe for each preset) -
export const CTA_PULSE_PEAK: Record<'calm' | 'medium' | 'strong', number> = {
  calm: 1.025,
  medium: 1.04,
  strong: 1.06,
}

// ---- custom CTA pulse keyframe injection ------------------------------------
const customPulseCache = new Map<string, string>()
/** Ensure a @keyframes rule for `min → max → min` exists and return its name. */
export function ensureCustomPulse(minScale: number, maxScale: number): string {
  const key = `${Math.round(minScale * 10000)}_${Math.round(maxScale * 10000)}`
  if (customPulseCache.has(key)) return customPulseCache.get(key)!
  const name = `pa-cta-p${customPulseCache.size}`
  const css = `@keyframes ${name}{0%,100%{transform:scale(${minScale})}50%{transform:scale(${maxScale})}}`
  if (styleEl) styleEl.textContent += css
  customPulseCache.set(key, name)
  return name
}

// ---- custom keyframes (from the editor's KeyframeStep[]) -------------------
const customCache = new Map<string, string>()
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
function ensureCustomKeyframes(steps: KeyframeStep[]): string {
  const key = JSON.stringify(steps)
  const cached = customCache.get(key)
  if (cached) return cached
  const name = 'pa-custom-' + hash(key)
  const body = steps
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((s) => {
      const props: string[] = []
      if (s.transform) props.push(`transform:${s.transform}`)
      if (s.opacity != null) props.push(`opacity:${s.opacity}`)
      if (s.filter) props.push(`filter:${s.filter}`)
      return `${s.at}%{${props.join(';')}}`
    })
    .join('')
  if (styleEl) styleEl.textContent += `\n@keyframes ${name}{${body}}`
  customCache.set(key, name)
  return name
}

// ---- shorthand builders ----------------------------------------------------
function keyframeName(spec: AnimSpec): string {
  if (spec.preset === 'typewriter') return ''
  if (spec.preset === 'custom') return spec.custom?.length ? ensureCustomKeyframes(spec.custom) : ''
  return 'pa-' + spec.preset
}

/** CSS `animation` shorthand for one spec. `loop` => infinite + no fill; else fill `both`. */
function animationCss(spec: AnimSpec, loop: boolean, delayOverrideMs?: number): string {
  const name = keyframeName(spec)
  if (!name) return ''
  const iter = loop ? (spec.iterations === 'infinite' || spec.iterations == null ? 'infinite' : spec.iterations) : (spec.iterations ?? 1)
  const delay = delayOverrideMs != null ? delayOverrideMs : spec.delayMs || 0
  const fill = loop ? 'none' : 'both'
  return `${name} ${spec.durationMs}ms ${spec.easing || 'ease'} ${delay}ms ${iter} normal ${fill}`
}

/** Public one-shot shorthand for non-stage surfaces (such as the pinned header)
 * that use the same entrance preset library as ordinary scene elements. */
export function oneShotAnimationCss(spec: AnimSpec): string {
  return animationCss(spec, false)
}

/** The CSS `animation` shorthand for a CTA's pulse (used in static export contexts). */
export function ctaPulseAnimation(cta: import('./scene').CtaConfig | undefined): string {
  if (cta?.pulse === 'custom') return 'none'
  const presetKey = (cta?.pulse as 'calm' | 'medium' | 'strong') ?? 'medium'
  const preset = CTA_PULSE[presetKey] ?? CTA_PULSE.medium
  const min = cta?.pulseMinScale ?? 1.0
  const max = cta?.pulseScale ?? CTA_PULSE_PEAK[presetKey] ?? 1.04
  const dur = cta?.pulseDurationMs ?? preset.durationMs
  const hasCustomShape = cta?.pulseScale != null || cta?.pulseMinScale != null
  const name = hasCustomShape ? ensureCustomPulse(min, max) : preset.name
  return `${name} ${dur}ms ease-in-out infinite`
}

// A phase can hold MULTIPLE stacked specs: the primary (`entrance`/`loop`/`exit`/`gameWin`) plus any
// `…Extra[]` played together with it (e.g. entrance = pop + shine). Collect them in order.
type Phase = 'entrance' | 'loop' | 'exit' | 'gameWin' | 'tap' | 'thoughtSpawn' | 'thoughtWhack'
export function phaseSpecs(el: SceneElement, phase: Phase): AnimSpec[] {
  const a = el.animations
  if (!a) return []
  const out: AnimSpec[] = []
  const legacyGameWin = phase === 'gameWin' && a.entrance?.trigger === 'onGameWin'
  const legacyPrimary = legacyGameWin ? a.entrance : undefined
  const primary = phase === 'entrance' ? (a.entrance?.trigger === 'onGameWin' ? undefined : a.entrance) : (a[phase] ?? legacyPrimary)
  if (primary) out.push(primary)
  const legacyExtra = legacyGameWin ? a.entranceExtra : undefined
  const extra =
    phase === 'entrance'
      ? a.entrance?.trigger === 'onGameWin'
        ? undefined
        : a.entranceExtra
      : (a[(phase + 'Extra') as 'entranceExtra' | 'loopExtra' | 'exitExtra' | 'gameWinExtra' | 'tapExtra' | 'thoughtSpawnExtra' | 'thoughtWhackExtra'] ?? legacyExtra)
  if (Array.isArray(extra)) for (const s of extra) if (s) out.push(s)
  return out
}

/** The lightray spec from ANY phase (entrance/loop/exit/gameWin/tap) — drives the .pa-lightray pseudo sweep.
 * The reflection is an ambient class-driven effect, so it can be added in any phase, not just loop. */
export function lightraySpec(el: SceneElement): AnimSpec | undefined {
  return (['entrance', 'loop', 'exit', 'gameWin', 'tap', 'thoughtSpawn', 'thoughtWhack'] as const).flatMap((p) => phaseSpecs(el, p)).find((s) => s.preset === 'lightray')
}

/** Total wall time a phase occupies (the latest `delay + duration` across its stacked
 * specs), i.e. how long after the phase is triggered until every part of it has finished.
 * The scene timeline uses it to know when an exit is done and the element can go away. */
export function phaseTotalMs(el: SceneElement, phase: Phase): number {
  const specs = phaseSpecs(el, phase)
  if (!specs.length) return 0
  return Math.max(0, ...specs.map((s) => (s.delayMs || 0) + s.durationMs))
}

/**
 * Animation shorthand that renders ONE FROZEN FRAME of a phase, `elapsedMs` into it —
 * the editor timeline's scrub. A NEGATIVE animation-delay starts an animation partway
 * through, and pausing it (the caller sets animation-play-state) holds it exactly there,
 * so dragging the playhead steps through the real entrance/exit motion rather than a
 * simple on/off. Before its own delay the spec still fills from its 0% frame (fill:both).
 */
export function phaseFrameCss(el: SceneElement, phase: Phase, elapsedMs: number): string {
  return phaseSpecs(el, phase)
    .filter((s) => s.preset !== 'lightray') // pseudo-driven sweep, not a node animation
    .filter((s) => s.preset !== 'typewriter') // JS-driven text reveal/erase
    .map((s) => {
      const name = keyframeName(s)
      if (!name) return ''
      const delay = s.delayMs || 0
      const t = Math.max(0, Math.min(elapsedMs, delay + s.durationMs))
      return `${name} ${s.durationMs}ms ${s.easing || 'ease'} ${delay - t}ms 1 normal both`
    })
    .filter(Boolean)
    .join(', ')
}

/** Earliest entrance start (min delay across stacked entrance specs) — when the element first appears. */
export function entranceLeadDelayMs(el: SceneElement): number {
  return phaseLeadDelayMs(el, 'entrance')
}

/** Earliest start inside a phase (min delay across stacked specs). */
export function phaseLeadDelayMs(el: SceneElement, phase: Phase): number {
  const specs = phaseSpecs(el, phase)
  if (!specs.length) return 0
  return Math.max(0, Math.min(...specs.map((s) => s.delayMs || 0)))
}

/** The CTA's default pulse shorthand (used only when the element has no explicit loop spec). */
function ctaPulseCss(el: SceneElement, delayMs: number): string {
  if (el.type !== 'cta') return ''
  if (el.cta?.pulse === 'custom') return ''
  const presetKey = (el.cta?.pulse as 'calm' | 'medium' | 'strong') ?? 'medium'
  const preset = CTA_PULSE[presetKey] ?? CTA_PULSE.medium
  const min = el.cta?.pulseMinScale ?? 1.0
  const max = el.cta?.pulseScale ?? CTA_PULSE_PEAK[presetKey] ?? 1.04
  const dur = el.cta?.pulseDurationMs ?? preset.durationMs
  const hasCustomShape = el.cta?.pulseScale != null || el.cta?.pulseMinScale != null
  const name = hasCustomShape ? ensureCustomPulse(min, max) : preset.name
  return `${name} ${dur}ms ease-in-out ${delayMs}ms infinite`
}

/**
 * Compose the `animation` value for an element's inner node — a comma-joined list so
 * stacked specs (e.g. pop + shine) run together.
 * - includeEntrance=false (mount, runs everywhere incl. editor): loop only.
 * - includeEntrance=true (interactive playback): entrances, then the loop delayed to
 *   start when the LAST entrance ends, so transform-based presets don't fight.
 * 'lightray' loop specs are excluded here — that sweep lives on the .pa-lightray pseudo-element.
 */
export function composeElementAnim(el: SceneElement, includeEntrance: boolean): string {
  const parts: string[] = []
  let loopDelay = 0
  if (includeEntrance) {
    for (const e of phaseSpecs(el, 'entrance')) {
      if (e.preset === 'lightray') continue // pseudo-driven sweep, not a node animation
      if (e.preset === 'typewriter') continue // JS-driven text reveal
      const css = animationCss(e, false)
      if (css) parts.push(css)
      loopDelay = Math.max(loopDelay, (e.delayMs || 0) + e.durationMs)
    }
  }
  const loops = phaseSpecs(el, 'loop')
  const nodeLoops = loops.filter((s) => s.preset !== 'lightray') // lightray is pseudo-driven
  if (loops.length) {
    for (const l of nodeLoops) {
      const css = animationCss(l, true, loopDelay)
      if (css) parts.push(css)
    }
  } else {
    const pulse = ctaPulseCss(el, loopDelay) // no explicit loop → CTA default pulse
    if (pulse) parts.push(pulse)
  }
  return parts.join(', ') || 'none'
}

/** The exit animation shorthand — all stacked exit specs, comma-joined ('' if none). */
export function exitCss(el: SceneElement): string {
  return phaseSpecs(el, 'exit')
    .filter((e) => e.preset !== 'lightray') // pseudo-driven sweep, not a node animation
    .filter((e) => e.preset !== 'typewriter') // JS-driven text erase
    .map((e) => animationCss(e, false))
    .filter(Boolean)
    .join(', ')
}

/** Whether the element should play an entrance at the given trigger (primary entrance gates the phase). */
export function entranceTriggers(el: SceneElement, trigger: 'onMount' | 'onGameWin'): boolean {
  const e = el.animations?.entrance
  if (!e) return false
  return (e.trigger ?? 'onMount') === trigger
}

/** Win animation shorthand: game-win phase, then the ordinary loop delayed until the win phase ends. */
export function composeGameWinAnim(el: SceneElement): string {
  return composeOneShotAnim(el, 'gameWin')
}

/** Tap animation shorthand — same shape as the win phase, replayed on every tap. */
export function composeTapAnim(el: SceneElement): string {
  return composeOneShotAnim(el, 'tap')
}

/** Thought-game event animation — reusable by any other element in the scene. */
export function composeThoughtEventAnim(el: SceneElement, event: 'thoughtSpawn' | 'thoughtWhack'): string {
  return composeOneShotAnim(el, event)
}

/**
 * A one-shot phase (game win / tap) followed by the element's ordinary loop, held
 * back until the phase has finished so the two never fight over transform. Falls
 * back to the CTA pulse when the element has no authored loop, exactly as the loop
 * path does, so a CTA keeps pulsing after the phase instead of going still.
 */
function composeOneShotAnim(el: SceneElement, phase: 'gameWin' | 'tap' | 'thoughtSpawn' | 'thoughtWhack'): string {
  const parts: string[] = []
  let loopDelay = 0
  for (const e of phaseSpecs(el, phase)) {
    if (e.preset === 'lightray') continue
    if (e.preset === 'typewriter') continue
    const css = animationCss(e, false)
    if (css) parts.push(css)
    loopDelay = Math.max(loopDelay, (e.delayMs || 0) + e.durationMs)
  }
  const loops = phaseSpecs(el, 'loop')
  const nodeLoops = loops.filter((s) => s.preset !== 'lightray')
  if (loops.length) {
    for (const l of nodeLoops) {
      const css = animationCss(l, true, loopDelay)
      if (css) parts.push(css)
    }
  } else {
    const pulse = ctaPulseCss(el, loopDelay)
    if (pulse) parts.push(pulse)
  }
  return parts.join(', ') || 'none'
}
