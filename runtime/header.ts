// Pinned header that stays at the physical top of the screen (never drifts with
// letterbox reflow). Fixed positioning + transform scale only — no _offY term.

import { cssFontFamily } from './font'
import { isLandscape, scale, viewW } from './responsive'
import { braceBareTokens, formatTickerIntervalMs, renderCountdownFormat } from './elements/countdown'
import { injectAnimStyles, loopAnimationCss, oneShotAnimationCss } from './anim'
import type { AnimSpec } from './scene'

export interface HeaderConfig {
  bgColor?: string
  color?: string
  heightPx?: number
  fontSizePx?: number
  fontWeight?: number
  fontFamily?: string
  topPaddingPx?: number
  align?: 'left' | 'center' | 'right'
  letterSpacingPx?: number
  prefix?: string
  suffix?: string
  zIndex?: number
  mode?: 'date' | 'countdown'
  countdownTarget?: 'duration' | 'midnight'
  countdownSeconds?: number
  countdownFormat?: string
  dateFormat?: string
  // Case applied to the rendered date/timer (the band's own prefix/suffix are left
  // as typed). Passed straight through to the shared formatter — these used to be
  // dropped here, so the project-level date silently ignored them.
  textCase?: 'none' | 'title' | 'upper' | 'lower'
  dateLocale?: string
  dateStyle?: 'short' | 'long' | 'numeric' | 'monthDay'
  entrance?: AnimSpec
  // Looping motion for the band's TEXT (the date/countdown itself — the bar art stays put,
  // since scaling the fixed-height band would clip against its own overflow:hidden).
  // Starts after `entrance` finishes, like a scene element's loop does.
  loop?: AnimSpec
  // Beat with the CTA instead of authoring `loop`: the header copies the pulse of the
  // current scene's CTA button — same keyframes, duration and post-entrance delay, restarted
  // together with it so the two run in phase. Scenes with no CTA fall back to `loop`.
  loopFollowsCta?: boolean
  // Nudge the band away from the physical top-centre, in DESIGN px (they scale with
  // everything else). +x right, +y down. The band keeps its full-bleed width, so an
  // x offset only matters once it is narrower than the screen or its text is aligned.
  offsetXPx?: number
  offsetYPx?: number
  // Optional LANDSCAPE-only layout. Present keys win in landscape; absent ones inherit
  // the portrait values above, so a header can sit lower and smaller on a wide screen
  // without duplicating its content settings. `hidden` drops the band in that
  // orientation entirely.
  landscape?: HeaderOrientationOverride
  // Only ever arrives from an orientation/scene override (see effectiveHeader) — the band
  // is dropped entirely while it is true.
  hidden?: boolean
}

/** A single scene's own header layout (SceneDef.header): one independent slot per
 * orientation. See the doc comment on the same type in scene.ts. */
export interface HeaderSceneOverride {
  portrait?: HeaderOrientationOverride
  landscape?: HeaderOrientationOverride
}

/** The header layout fields that can differ between portrait and landscape. Content
 * (mode, format, prefix/suffix, colours, animations) is shared by both. */
export interface HeaderOrientationOverride {
  heightPx?: number
  fontSizePx?: number
  fontWeight?: number
  topPaddingPx?: number
  align?: 'left' | 'center' | 'right'
  letterSpacingPx?: number
  offsetXPx?: number
  offsetYPx?: number
  hidden?: boolean
}

interface HeaderHandle {
  relayout(): void
  /** Show/hide the band (per-scene `hideHeader`). Fades after the first call; instant at mount. */
  setVisible(visible: boolean): void
  /** Apply the CURRENT scene's own layout override (SceneDef.header), or null to fall
   * back to the project layout. Re-lays the band out immediately. */
  setSceneLayout(override: HeaderSceneOverride | null | undefined): void
  /** Adopt the loop of the scene's CTA (`loopFollowsCta`). `css` is that element's loop
   * shorthand — see followLoopCss — or null for a scene with no CTA, which restores the
   * header's own `loop`. A no-op unless the header opted into following. */
  followCta(css: string | null): void
  /** Freeze a live countdown at its current displayed instant for the rest of this playable. */
  freezeCountdown(): void
  destroy(): void
}

const LEGACY_DATE_OPTS: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }
// Keep the pinned header above every runtime overlay tier, including lifted
// overlayTop elements (10050) and redirect cover scenes (11000).
const HEADER_OVERLAY_Z = 20000
const FIRST_INTERACTION_EVENTS = ['pointerdown', 'touchstart', 'mousedown', 'click'] as const

/** Start of the next local day (tonight's 12am). setHours(24,…) rolls the date over
 * through month/year ends and follows the device's own DST rules, so the remaining
 * time is whatever the viewer's clock says is left in the day. */
export function nextMidnight(now: number): number {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

function formatHeaderDate(d = new Date(), locale = 'en-US'): string {
  try {
    return d.toLocaleDateString(locale, LEGACY_DATE_OPTS).toUpperCase()
  } catch {
    return d.toLocaleDateString('en-US', LEGACY_DATE_OPTS).toUpperCase()
  }
}

function mergeDefined(into: HeaderConfig, from: HeaderOrientationOverride | HeaderSceneOverride | undefined): void {
  if (!from) return
  for (const [k, v] of Object.entries(from as Record<string, unknown>)) {
    if (k !== 'landscape' && v !== undefined) (into as Record<string, unknown>)[k] = v
  }
}

/**
 * The scene's slot for one orientation — the ONLY part of a scene override that can affect
 * what is on screen. Pre-v3 projects stored the layout flat on the override (meaning "both
 * orientations", with a nested `landscape` on top); that shape is still read here so an
 * unmigrated project in memory renders exactly as it did.
 */
export function sceneHeaderSlot(scene: HeaderSceneOverride | null | undefined, landscape: boolean): HeaderOrientationOverride | undefined {
  if (!scene) return undefined
  const slot = landscape ? scene.landscape : scene.portrait
  const legacy = Object.entries(scene as Record<string, unknown>).filter(([k]) => k !== 'portrait' && k !== 'landscape')
  if (!legacy.length) return slot
  return { ...(Object.fromEntries(legacy) as HeaderOrientationOverride), ...(landscape ? scene.landscape : {}), ...slot }
}

/**
 * The layout in force right now, most specific last:
 *   project portrait → project landscape → THIS SCENE's slot for this orientation.
 * A scene with no slot for the orientation on screen simply plays the project header.
 */
export function effectiveHeader(opts: HeaderConfig, landscape = isLandscape(), scene?: HeaderSceneOverride | null): HeaderConfig {
  const slot = sceneHeaderSlot(scene, landscape)
  if (!slot && (!landscape || !opts.landscape)) return opts
  const out: HeaderConfig = { ...opts }
  if (landscape) mergeDefined(out, opts.landscape)
  mergeDefined(out, slot)
  return out
}

/**
 * The endscene clip the band should ride, if any. Read fresh on every relayout, so a
 * scene change / rotation / a clip that has only just reported its size all land
 * without the caller re-mounting the band. See StageHandle.endsceneClip.
 */
export interface HeaderClip {
  k: number
  mapY(designY: number): number
}

export function mountHeader(container: HTMLElement, opts: HeaderConfig, clip?: () => HeaderClip | null): HeaderHandle {
  const band = document.createElement('div')
  band.className = 'pa-header'

  // Position:fixed anchors to the physical viewport top (always top:0, never drifts
  // with _offY). Transform scale only — the sole viewport-dependent term is scale().
  band.style.cssText =
    'position:fixed;top:0;left:50%;display:grid;overflow:hidden;' +
    'box-sizing:border-box;line-height:1.15;' +
    'white-space:pre-line;pointer-events:none;transform-origin:top center;'

  band.style.zIndex = String(Math.max(opts.zIndex ?? 0, HEADER_OVERLAY_Z))

  // Keep the responsive scale/position on `band` and animate this full-size inner
  // surface instead. That lets transform-based entrances move the whole header
  // (including its background) without fighting relayout's transform.
  const surface = document.createElement('div')
  surface.className = 'pa-header-surface'
  surface.style.cssText = 'width:100%;height:100%;display:grid;box-sizing:border-box;line-height:1.15;white-space:pre-line;'
  if (opts.bgColor) surface.style.backgroundColor = opts.bgColor
  surface.style.color = opts.color ?? '#ffffff'
  surface.style.fontFamily = cssFontFamily(opts.fontFamily) || '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'

  // Everything that a landscape override may change is (re)applied here, so a rotation
  // — which only re-runs relayout() — picks up the other orientation's layout.
  let sceneLayout: HeaderSceneOverride | null = null
  const applyLayout = (): HeaderConfig => {
    const cfg = effectiveHeader(opts, isLandscape(), sceneLayout)
    const align = cfg.align ?? 'center'
    // When a top padding is set, top-anchor the text so the gap is measured from the
    // band's top edge; otherwise keep the original vertically-centred behaviour.
    const topPadded = cfg.topPaddingPx != null
    band.style.height = (cfg.heightPx ?? 120) + 'px'
    // `hidden` is only ever set on an orientation override, so it reaches cfg's root only
    // when that override is the one in force.
    band.style.display = cfg.hidden ? 'none' : 'grid'
    surface.style.alignItems = topPadded ? 'start' : 'center'
    surface.style.justifyItems = align === 'left' ? 'start' : align === 'right' ? 'end' : 'center'
    surface.style.textAlign = align
    surface.style.padding = (topPadded ? cfg.topPaddingPx : 0) + 'px 24px 0'
    surface.style.fontSize = (cfg.fontSizePx ?? 64) + 'px'
    surface.style.fontWeight = String(cfg.fontWeight ?? 500)
    surface.style.letterSpacing = cfg.letterSpacingPx ? cfg.letterSpacingPx + 'px' : ''
    return cfg
  }

  if (opts.entrance) {
    injectAnimStyles()
    surface.style.animation = oneShotAnimationCss(opts.entrance)
  }

  const text = document.createElement('div')
  text.className = 'pa-header-text'
  text.style.whiteSpace = 'pre-line'
  surface.appendChild(text)
  band.appendChild(surface)

  // The loop lives on the text node, not the surface: it can then run alongside a
  // transform-based entrance (different nodes never fight over `transform`) and it
  // pulses the date rather than the band's background.
  const entranceEndMs = opts.entrance ? (opts.entrance.delayMs || 0) + opts.entrance.durationMs : 0
  const ownLoopCss = opts.loop ? loopAnimationCss(opts.loop, entranceEndMs) : ''
  // Restarted on each assignment (animation:none + reflow) so a followed CTA pulse starts
  // its cycle with the CTA that was just mounted instead of mid-beat.
  const applyLoop = (css: string): void => {
    if (css) injectAnimStyles()
    text.style.animation = 'none'
    void text.offsetWidth // force reflow so the next assignment restarts the animation
    text.style.animation = css
    text.style.willChange = css ? 'transform' : ''
  }
  if (ownLoopCss) applyLoop(ownLoopCss)

  // 'countdown' mode ticks down from countdownSeconds after load — or, with
  // countdownTarget 'midnight', from however much of the viewer's day is left
  // ("only 7 hours left" at 5pm); 'date' (default) renders once. Both wrap the
  // value in the shared prefix/suffix literals.
  let timer = 0
  let removeStartListeners = (): void => {}
  let freezeCountdown = (): void => {}
  if (opts.mode === 'countdown') {
    const midnight = opts.countdownTarget === 'midnight'
    // Hours matter for a to-midnight timer, so its default format carries {hh}
    // — a bare {mm}:{ss} would show "00:00" with 7 hours still on the clock.
    const fmt = opts.countdownFormat || (midnight ? '{hh}:{mm}:{ss}' : '{mm}:{ss}')
    const durationMs = Math.max(0, opts.countdownSeconds ?? 300) * 1000
    const storedDeadline = Number(container.dataset.paCountdownDeadline || 0)
    const storedFrozenAt = Number(container.dataset.paCountdownFrozenAt || 0)
    let frozenAt = storedFrozenAt
    let frozen = storedFrozenAt > 0 && storedDeadline > 0
    let deadline = frozen ? storedDeadline : midnight ? nextMidnight(Date.now()) : storedDeadline
    let started = midnight || storedDeadline > 0
    if (midnight && !frozen) container.dataset.paCountdownDeadline = String(deadline)
    const render = (): void => {
      const now = frozen ? frozenAt : Date.now()
      // Before the first gesture, keep a duration countdown visibly parked at its
      // full authored value. Its real deadline is created only when playback starts.
      const displayDeadline = started ? deadline : now + durationMs
      text.textContent = (opts.prefix ?? '') + renderCountdownFormat(fmt, displayDeadline, now, opts) + (opts.suffix ?? '')
    }
    const intervalMs = formatTickerIntervalMs(fmt)
    const startTicker = (): void => {
      if (frozen || !intervalMs || timer || Date.now() >= deadline) return
      timer = window.setInterval(() => {
        render()
        if (Date.now() >= deadline) {
          window.clearInterval(timer)
          timer = 0
        }
      }, intervalMs)
    }
    const startDurationCountdown = (): void => {
      if (started || frozen) return
      started = true
      deadline = Date.now() + durationMs
      container.dataset.paCountdownDeadline = String(deadline)
      removeStartListeners()
      render()
      startTicker()
    }
    freezeCountdown = (): void => {
      if (frozen) return
      frozenAt = Date.now()
      // An auto-completing game can win before a gesture. In that case the header
      // freezes at its full authored duration instead of inventing elapsed time.
      if (!started) {
        started = true
        deadline = frozenAt + durationMs
      }
      frozen = true
      container.dataset.paCountdownDeadline = String(deadline)
      container.dataset.paCountdownFrozenAt = String(frozenAt)
      removeStartListeners()
      if (timer) {
        window.clearInterval(timer)
        timer = 0
      }
      render()
    }

    render()
    if (midnight) {
      // Midnight is an absolute wall-clock deadline, so it remains live from mount.
      startTicker()
    } else if (started) {
      // Preserve the original deadline across a localized-header remount.
      startTicker()
    } else {
      removeStartListeners = (): void => {
        for (const type of FIRST_INTERACTION_EVENTS) container.removeEventListener(type, startDurationCountdown, true)
      }
      for (const type of FIRST_INTERACTION_EVENTS) container.addEventListener(type, startDurationCountdown, { capture: true, passive: true })
    }
  } else {
    // Custom layouts render today via the shared token formatter (deadline=now
    // makes the date tokens target today); empty keeps the legacy fixed style.
    const now = Date.now()
    const date = opts.dateFormat ? renderCountdownFormat(braceBareTokens(opts.dateFormat), now, now, opts) : formatHeaderDate(new Date(now), opts.dateLocale)
    text.textContent = (opts.prefix ?? '') + date + (opts.suffix ?? '')
  }

  container.appendChild(band)

  const relayout = (): void => {
    const cfg = applyLayout() // orientation may have flipped since the last pass
    // Over a full-bleed endscene card the band rides the CLIP instead of the FIT frame:
    // the clip is one element that extends past the scene, and the date belongs to the
    // card's composition, so it scales and sits where the card's own top does — the same
    // lock every element drawn over the card gets (endsceneMediaPos in stage.ts). Every
    // other scene keeps the band pinned to the physical screen top at the FIT scale.
    const onClip = clip?.() ?? null
    const s = onClip ? onClip.k : scale() // from responsive.ts — NO _offY term
    // Full-bleed either way: the width is divided by the scale the transform then
    // re-applies, so the band still reaches both screen edges at any clip scale.
    band.style.width = (viewW() + 24) / s + 'px'
    band.style.top = onClip ? onClip.mapY(0) + 'px' : '0'
    // The authored offset is in design px, so it scales with the band. It is applied
    // BEFORE scale() in screen px (hence the × s) and after the -50% centring, which
    // is measured against the band's own unscaled width.
    const dx = (cfg.offsetXPx ?? 0) * s
    const dy = (cfg.offsetYPx ?? 0) * s
    const move = dx || dy ? ` translate(${dx}px, ${dy}px)` : ''
    band.style.transform = `translateX(-50%)${move} scale(${s})`
  }

  relayout()

  // First setVisible applies instantly (a scene that starts with the header hidden must not
  // flash it at load); later calls fade so mid-flow scene changes read as a soft toggle.
  let visInit = false

  return {
    relayout,
    setVisible(visible: boolean) {
      band.style.transition = visInit ? 'opacity 250ms ease' : ''
      band.style.opacity = visible ? '1' : '0'
      visInit = true
    },
    setSceneLayout(override) {
      const next = override && Object.keys(override).length ? override : null
      if (JSON.stringify(next) === JSON.stringify(sceneLayout)) return
      sceneLayout = next
      relayout() // applyLayout runs inside, so size AND position land together
    },
    followCta(css: string | null) {
      if (!opts.loopFollowsCta) return
      applyLoop(css || ownLoopCss)
    },
    freezeCountdown,
    destroy() {
      removeStartListeners()
      if (timer) window.clearInterval(timer)
      band.remove()
    },
  }
}
