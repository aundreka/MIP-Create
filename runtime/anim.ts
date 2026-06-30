// Animation keyframe library + per-element animation composition. One injected
// <style> holds the named @keyframes (custom keyframe sets are appended on demand
// with a content-hashed name). Animations live on the inner `.pa-el-anim` node so
// they never fight the stage's positional transform on the outer `.pa-el`.
//
// Standardized CTA pulses (the fix for the 1.0-2.4s / 1.025-1.05 cross-MIP drift)
// double as a CTA's default loop. Per-element entrance / loop / exit specs come
// from element.animations (see scene.ts AnimSpec).

import type { AnimSpec, CtaPulsePreset, KeyframeStep, SceneElement } from './scene'

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
@keyframes pa-fade{from{opacity:0}to{opacity:1}}
@keyframes pa-pop{0%{transform:scale(.7);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes pa-slide-up{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes pa-slide-down{from{transform:translateY(-40px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes pa-slide-left{from{transform:translateX(40px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes pa-slide-right{from{transform:translateX(-40px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes pa-bounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-18px)}55%{transform:translateY(0)}75%{transform:translateY(-7px)}}
@keyframes pa-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
@keyframes pa-wave{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
@keyframes pa-shine{0%,100%{filter:brightness(1)}50%{filter:brightness(1.45)}}
@keyframes pa-glow{0%,100%{filter:drop-shadow(0 0 0 rgba(255,255,255,0))}50%{filter:drop-shadow(0 0 14px rgba(255,255,255,.85))}}
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

/** The element's persistent (loop) animation: an explicit loop, else the CTA pulse. */
function loopCss(el: SceneElement, delayMs = 0): string {
  const loop = el.animations?.loop
  if (loop) return animationCss(loop, true, delayMs)
  if (el.type === 'cta') {
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
  return ''
}

/**
 * Compose the `animation` value for an element's inner node.
 * - includeEntrance=false (mount, runs everywhere incl. editor): loop only.
 * - includeEntrance=true (interactive playback): entrance, then the loop delayed
 *   to start when the entrance ends, so transform-based presets don't fight.
 */
export function composeElementAnim(el: SceneElement, includeEntrance: boolean): string {
  const parts: string[] = []
  const entrance = el.animations?.entrance
  let loopDelay = 0
  if (includeEntrance && entrance) {
    parts.push(animationCss(entrance, false))
    loopDelay = (entrance.delayMs || 0) + entrance.durationMs
  }
  const loop = loopCss(el, loopDelay)
  if (loop) parts.push(loop)
  return parts.join(', ') || 'none'
}

/** The exit animation shorthand (or '' if none). */
export function exitCss(el: SceneElement): string {
  const exit = el.animations?.exit
  return exit ? animationCss(exit, false) : ''
}

/** Whether the element should play an entrance at the given trigger. */
export function entranceTriggers(el: SceneElement, trigger: 'onMount' | 'onGameWin'): boolean {
  const e = el.animations?.entrance
  if (!e) return false
  return (e.trigger ?? 'onMount') === trigger
}
