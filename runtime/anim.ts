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
@keyframes pa-slide-up{0%{transform:translateY(46px);opacity:0}70%{transform:translateY(-8px);opacity:1}100%{transform:translateY(0);opacity:1}}
@keyframes pa-slide-down{0%{transform:translateY(-46px);opacity:0}70%{transform:translateY(8px);opacity:1}100%{transform:translateY(0);opacity:1}}
@keyframes pa-slide-left{0%{transform:translateX(46px);opacity:0}70%{transform:translateX(-8px);opacity:1}100%{transform:translateX(0);opacity:1}}
@keyframes pa-slide-right{0%{transform:translateX(-46px);opacity:0}70%{transform:translateX(8px);opacity:1}100%{transform:translateX(0);opacity:1}}
@keyframes pa-bounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-18px)}55%{transform:translateY(0)}75%{transform:translateY(-7px)}}
@keyframes pa-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
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
@keyframes pa-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
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
  calm: 1.025, medium: 1.04, strong: 1.06,
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
  if (spec.preset === 'custom') return spec.custom?.length ? ensureCustomKeyframes(spec.custom) : ''
  return 'pa-' + spec.preset
}

/** CSS `animation` shorthand for one spec. `loop` => infinite + no fill; else fill `both`. */
function animationCss(spec: AnimSpec, loop: boolean, delayOverrideMs?: number): string {
  const name = keyframeName(spec)
  if (!name) return ''
  const iter = loop ? (spec.iterations === 'infinite' || spec.iterations == null ? 'infinite' : spec.iterations) : spec.iterations ?? 1
  const delay = delayOverrideMs != null ? delayOverrideMs : spec.delayMs || 0
  const fill = loop ? 'none' : 'both'
  return `${name} ${spec.durationMs}ms ${spec.easing || 'ease'} ${delay}ms ${iter} normal ${fill}`
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

// A phase can hold MULTIPLE stacked specs: the primary (`entrance`/`loop`/`exit`) plus any
// `…Extra[]` played together with it (e.g. entrance = pop + shine). Collect them in order.
type Phase = 'entrance' | 'loop' | 'exit'
export function phaseSpecs(el: SceneElement, phase: Phase): AnimSpec[] {
  const a = el.animations
  if (!a) return []
  const out: AnimSpec[] = []
  const primary = a[phase]
  if (primary) out.push(primary)
  const extra = a[(phase + 'Extra') as 'entranceExtra' | 'loopExtra' | 'exitExtra']
  if (Array.isArray(extra)) for (const s of extra) if (s) out.push(s)
  return out
}

/** The lightray spec from ANY phase (entrance/loop/exit) — drives the .pa-lightray pseudo sweep.
 * The reflection is an ambient class-driven effect, so it can be added in any phase, not just loop. */
export function lightraySpec(el: SceneElement): AnimSpec | undefined {
  return (['entrance', 'loop', 'exit'] as const).flatMap((p) => phaseSpecs(el, p)).find((s) => s.preset === 'lightray')
}

/** Earliest entrance start (min delay across stacked entrance specs) — when the element first appears. */
export function entranceLeadDelayMs(el: SceneElement): number {
  const ents = phaseSpecs(el, 'entrance')
  if (!ents.length) return 0
  return Math.max(0, Math.min(...ents.map((e) => e.delayMs || 0)))
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
