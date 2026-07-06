// The stage: builds the DOM for a scene and lays every element out in SCREEN
// pixels, mirroring coinsort's Placeable.relayout() FIT/EXTEND model.
//
// One stacking context (#pa-root) holds every element so zIndex interleaves
// correctly between EXTEND bars and FIT content. Each element is:
//   .pa-el        outer box — positioned in screen px; carries anchor translate
//                 + rotation; z-index.
//   .pa-el-anim   inner box — carries animation transforms (CTA pulse now; the
//                 full entrance/loop/exit system in Pass 4) so they never fight
//                 the positional layout.
//   content       the <img> / text / button.

import type { Anchor, Scene, SceneElement } from './scene'
import type { AssetEntry, AssetMap, RuntimeCtx } from './types'
import { isLandscape, scale, sx, sy, viewH, viewW } from './responsive'
import { composeElementAnim, entranceTriggers, exitCss, injectAnimStyles } from './anim'
import { createContainerContent, createImageContent, styleContainer } from './elements/image'
import { applyBarFill, createBarContent } from './elements/bar'
import { createTextContent } from './elements/text'
import { createCtaContent } from './elements/cta'
import { createButtonContent } from './elements/button'
import { createChoiceContent } from './elements/choice'
import { localize } from './i18n'
import { getPicks, isPicked, togglePick } from './selection'
import { createEndsceneContent, updateEndsceneMedia } from './elements/endscene'
import { applyUnboxingImages, createUnboxingContent } from './elements/unboxing'
import { computeDeadline, formatCountdown, needsTicker } from './elements/countdown'
import { createGameHost, type GameHost } from './gameHost'
import { mulberry32 } from './games/types'
import { attachScratchCover } from './reveal'
import { emit, on } from './emitter'

interface Rec {
  el: SceneElement
  outer: HTMLDivElement
  anim: HTMLDivElement
  content: HTMLElement | null
  intrinsic: { w: number; h: number }
  host?: GameHost | null
  deadline?: number // countdown target (ms epoch)
  ticker?: number // countdown setInterval id
  hg?: { stop(): void } // handguide animator
}

// Animate a handguide element's image: loop a tap-bounce in place, or slide from
// its position toward a target (explicit point, or 'smart' = the scene's CTA/game),
// with a press dip at the ends. Self-contained; only runs when interactive.
function startHandguide(rec: Rec, recs: Rec[], root: HTMLElement): { stop(): void } {
  const cfg = rec.el.handguide ?? { mode: 'smart' as const }
  const content = rec.content
  const sx = rec.el.x
  const sy = rec.el.y
  // Waypoints (design px). 'slide' uses the configured nodes (or legacy toX/toY);
  // 'smart' targets the CTA/game; 'tap' stays in place (no waypoints).
  let pts: { x: number; y: number; pauseMs?: number }[] = []
  let kind: 'tap' | 'slide' | 'scratch' = 'tap'
  if (cfg.mode === 'slide') {
    if (cfg.nodes && cfg.nodes.length) pts = cfg.nodes.filter((p) => p && p.x != null && p.y != null)
    else if (cfg.toX != null && cfg.toY != null) pts = [{ x: cfg.toX, y: cfg.toY }]
    if (pts.length) kind = 'slide'
  } else if (cfg.mode === 'smart') {
    const t = recs.find((r) => r.el.type === 'cta') ?? recs.find((r) => r.el.type === 'game-mount')
    if (t && Math.hypot(t.el.x - sx, t.el.y - sy) > 24) {
      pts = [{ x: t.el.x, y: t.el.y }]
      kind = 'slide'
    }
  } else if (cfg.mode === 'scratch') {
    kind = 'scratch'
  }
  const travel = cfg.periodMs && cfg.periodMs > 0 ? cfg.periodMs : kind === 'scratch' ? 600 : kind === 'slide' ? 1500 : 900
  const cubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  const EASE: Record<string, (t: number) => number> = {
    linear: (t) => t,
    ease: cubic,
    'ease-in': (t) => t * t,
    'ease-out': (t) => 1 - (1 - t) * (1 - t),
    'ease-in-out': cubic,
  }
  const ease = EASE[cfg.easing ?? 'ease-in-out'] ?? cubic

  // Build a cyclic timeline: travel start -> node1 -> node2 ... then back to start
  // to loop. Each non-return leg dwells for its destination node's pauseMs (a tap
  // plays during the dwell). The "finger" stays pressed across the whole outbound
  // drag and lifts on the return leg.
  const wps = [{ x: sx, y: sy, pauseMs: 0 }, ...pts]
  type Step = { ax: number; ay: number; bx: number; by: number; dwell: number }
  const steps: Step[] = []
  for (let i = 0; i < wps.length; i++) {
    const a = wps[i]
    const b = wps[(i + 1) % wps.length]
    steps.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, dwell: Math.max(0, Math.round(b.pauseMs ?? 0)) })
  }
  if (steps.length) steps[steps.length - 1].dwell = 0 // the return-to-start leg never dwells
  const total = steps.reduce((s, st) => s + travel + st.dwell, 0) || travel
  const pressEnd = total - travel // the return leg begins here (finger lifts)
  const ramp = Math.min(140, pressEnd / 3 || 1)

  let raf = 0
  let running = false
  let t0 = performance.now()
  if (content) {
    content.style.transformOrigin = '22% 12%'
    content.style.transition = 'opacity 200ms ease'
  }
  const frame = (now: number): void => {
    if (!running || !content) return
    const s = scale()
    let ox = 0
    let oy = 0
    let press = 0
    if (kind === 'scratch') {
      // Target the first unscratched cell; query every frame so the hand
      // automatically shifts to the next cell once the current one is won.
      const cellEl = root.querySelector<HTMLElement>('[data-scratch-cell]:not([data-won])')
      if (cellEl) {
        const cellRect = cellEl.getBoundingClientRect()
        const guideRect = rec.outer.getBoundingClientRect()
        const guideCX = guideRect.left + guideRect.width / 2
        const guideCY = guideRect.top + guideRect.height / 2
        // Rub along this cell's configured per-cell hint path (start→end, as a 0..1
        // fraction of the cell — written to data-hint-* by the scratch grid). Falls
        // back to a centered horizontal rub when unset.
        const fx = parseFloat(cellEl.dataset.hintFx ?? '0.2')
        const fy = parseFloat(cellEl.dataset.hintFy ?? '0.5')
        const tx = parseFloat(cellEl.dataset.hintTx ?? '0.8')
        const ty = parseFloat(cellEl.dataset.hintTy ?? '0.5')
        const phase = ((now - t0) % travel) / travel
        const p = phase < 0.5 ? cubic(phase * 2) : cubic((1 - phase) * 2)
        ox = cellRect.left + cellRect.width * (fx + (tx - fx) * p) - guideCX
        oy = cellRect.top + cellRect.height * (fy + (ty - fy) * p) - guideCY
        // Smooth press in/out instead of a binary 0/1 snap (which popped the scale).
        press = phase < 0.14 ? cubic(phase / 0.14) : phase > 0.86 ? cubic((1 - phase) / 0.14) : 1
      }
    } else if (kind === 'slide') {
      const c = (now - t0) % total
      let rem = c
      let cx = sx
      let cy = sy
      for (const st of steps) {
        if (rem < travel) {
          const p = ease(rem / travel)
          cx = st.ax + (st.bx - st.ax) * p
          cy = st.ay + (st.by - st.ay) * p
          break
        }
        rem -= travel
        if (rem < st.dwell) {
          cx = st.bx
          cy = st.by
          break
        }
        rem -= st.dwell
        cx = st.bx
        cy = st.by
      }
      ox = (cx - sx) * s
      oy = (cy - sy) * s
      if (c < pressEnd) press = c < ramp ? c / ramp : c > pressEnd - ramp ? (pressEnd - c) / ramp : 1
    } else {
      const phase = ((now - t0) % travel) / travel
      press = phase < 0.5 ? Math.sin(phase * Math.PI) : 0
    }
    content.style.transform = `translate(${Math.round(ox)}px,${Math.round(oy)}px) scale(${(1 - press * 0.18).toFixed(3)})`
    raf = requestAnimationFrame(frame)
  }
  const show = (): void => {
    if (running || !content) return
    running = true
    t0 = performance.now() // replay the route from the start on each appearance
    content.style.opacity = '1'
    raf = requestAnimationFrame(frame)
  }
  const hide = (): void => {
    running = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    if (content) content.style.opacity = '0'
  }
  // Idle visibility: hide on the player's tap, reappear after idleMs of stillness,
  // repeating. hideOnInteract=false keeps the old always-looping behavior.
  const idleMs = Math.max(0, cfg.idleMs ?? 4000)
  const hideOnInteract = cfg.hideOnInteract !== false
  let idleTimer = 0
  let interacting = false
  const scheduleShow = (): void => {
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => { if (!interacting) show() }, idleMs)
  }
  const onInteractStart = (): void => {
    interacting = true
    hide()
    scheduleShow()
  }
  const onInteractEnd = (): void => {
    interacting = false
    scheduleShow()
  }
  if (hideOnInteract) {
    root.addEventListener('pointerdown', onInteractStart, true)
    root.addEventListener('pointerup', onInteractEnd, true)
    root.addEventListener('pointercancel', onInteractEnd, true)
    root.addEventListener('touchstart', onInteractStart, { capture: true, passive: true })
    root.addEventListener('touchend', onInteractEnd, { capture: true, passive: true })
    root.addEventListener('touchcancel', onInteractEnd, { capture: true, passive: true })
  }
  if (cfg.showInitially === false) {
    if (content) content.style.opacity = '0'
    scheduleShow()
  } else {
    show()
  }
  return {
    stop() {
      running = false
      if (raf) cancelAnimationFrame(raf)
      window.clearTimeout(idleTimer)
      root.removeEventListener('pointerdown', onInteractStart, true)
      root.removeEventListener('pointerup', onInteractEnd, true)
      root.removeEventListener('pointercancel', onInteractEnd, true)
      root.removeEventListener('touchstart', onInteractStart, true)
      root.removeEventListener('touchend', onInteractEnd, true)
      root.removeEventListener('touchcancel', onInteractEnd, true)
      if (content) {
        content.style.transform = ''
        content.style.opacity = ''
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Countdown ticker: rewrites the inner text once a second from the deadline.
// ---------------------------------------------------------------------------
function tickCountdown(rec: Rec): void {
  const inner = rec.content?.firstElementChild as HTMLElement | null
  if (!inner) return
  inner.textContent = formatCountdown(rec.el, rec.deadline ?? Date.now(), Date.now())
}
function startTicker(rec: Rec): void {
  if (rec.ticker) {
    window.clearInterval(rec.ticker)
    rec.ticker = 0
  }
  rec.deadline = computeDeadline(rec.el, Date.now())
  tickCountdown(rec)
  // a pure date label ({date}/{d}) doesn't change second-to-second — render once.
  if (needsTicker(rec.el)) rec.ticker = window.setInterval(() => tickCountdown(rec), 1000)
}

interface Effective {
  x: number
  y: number
  w?: number
  h?: number
  scale: number
  anchor: Anchor
  zIndex: number
  mode: 'fit' | 'extend'
  hidden: boolean
  rotation: number
  opacity?: number
}

export interface StageHandle {
  root: HTMLDivElement
  layoutAll(): void
  setHidden(id: string, hidden: boolean): void
  /**
   * Apply a new scene WITHOUT rebuilding the DOM, for smooth live editing.
   * Returns false if the structure changed (element added/removed/reordered,
   * type or asset swapped) — the caller should then do a full rebuild.
   */
  update(scene: Scene, assets: AssetMap): boolean
  /** Mount the game module(s) into their slot(s); interactive => start play+hints. */
  startGames(interactive: boolean): void
  /** Play onMount entrance animations (interactive playback only, not the editor). */
  playEntrances(): void
  /** Play exit animations (called as a scene leaves). */
  playExit(): void
  get(id: string): Rec | undefined
  destroy(): void
}

export interface BuildOptions {
  mount?: HTMLElement
  /** Floating overlay mode: pa-root background is transparent so game content shows through the dim. */
  float?: boolean
}

// ---------------------------------------------------------------------------
// Base stylesheet (injected once).
// ---------------------------------------------------------------------------
let baseInjected = false
function injectBaseStyles(): void {
  if (baseInjected) return
  baseInjected = true
  const style = document.createElement('style')
  style.id = 'pa-base'
  style.textContent = `
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;overscroll-behavior:none;background:#000;}
.pa-root{position:absolute;inset:0;overflow:hidden;overflow:clip;isolation:isolate;touch-action:none;
  font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
.pa-el{position:absolute;left:0;top:0;transform-origin:center center;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;}
.pa-el-anim{width:100%;height:100%;touch-action:none;}
.pa-img{display:block;width:100%;height:100%;pointer-events:none;user-select:none;-webkit-user-drag:none;}
.pa-bar{width:100%;height:100%;}
.pa-cta{display:block;width:100%;height:100%;padding:0;margin:0;border:0;background:transparent;cursor:pointer;
  -webkit-tap-highlight-color:transparent;}
.pa-choice{display:block;width:100%;height:100%;padding:0;margin:0;border:0;background:transparent;cursor:pointer;
  -webkit-tap-highlight-color:transparent;transition:background .12s ease,transform .12s ease,box-shadow .12s ease;}
.pa-choice:active{transform:scale(.985);}
.pa-choice-sel{box-shadow:0 0 0 3px rgba(124,58,237,.45);}
.pa-textbox{margin:0;display:inline-block;box-sizing:border-box;pointer-events:none;}
.pa-text-inner{display:block;}
`.trim()
  document.head.appendChild(style)
}

// ---------------------------------------------------------------------------
// Anchor -> translate(%) so (x,y) maps to the chosen point of the box.
// ---------------------------------------------------------------------------
const ANCHOR: Record<Anchor, [number, number]> = {
  center: [-50, -50],
  top: [-50, 0],
  bottom: [-50, -100],
  left: [0, -50],
  right: [-100, -50],
  'top-left': [0, 0],
  'top-right': [-100, 0],
  'bottom-left': [0, -100],
  'bottom-right': [-100, -100],
}

const round = (n: number): number => Math.round(n)

// ---------------------------------------------------------------------------
// Animation application (inner .pa-el-anim node, so it never fights the stage's
// positional transform on the outer .pa-el).
// ---------------------------------------------------------------------------
function setAnimHints(node: HTMLElement, on: boolean): void {
  node.style.willChange = on ? 'transform, opacity, filter' : ''
  node.style.backfaceVisibility = on ? 'hidden' : ''
}
// Persistent loop/pulse — applied at mount and after edits; runs everywhere
// (including the static editor canvas), like the CTA pulse always has.
function applyMountAnim(rec: Rec): void {
  const css = composeElementAnim(rec.el, false)
  rec.anim.style.animation = css === 'none' ? '' : css
  setAnimHints(rec.anim, css !== 'none')
}
function restartAnim(node: HTMLElement, css: string): void {
  node.style.animation = 'none'
  void node.offsetWidth // force reflow so the next assignment restarts the animation
  node.style.animation = css
  setAnimHints(node, true)
}
// Entrance (+ its loop, delayed to start after the entrance) — interactive only.
function runEntrance(rec: Rec): void {
  const css = composeElementAnim(rec.el, true)
  if (css !== 'none') restartAnim(rec.anim, css)
}

// ---------------------------------------------------------------------------
// Font injection — one <style> tag updated whenever buildScene is called.
// ---------------------------------------------------------------------------
function fontFormatHint(src: string): string {
  // Extract MIME from data URI header only; fall back to extension in the path.
  const mime = src.match(/^data:([^;,]+)/)?.[1] ?? ''
  if (mime === 'font/woff2' || src.includes('.woff2')) return "format('woff2')"
  if (mime === 'font/woff' || src.includes('.woff')) return "format('woff')"
  if (mime === 'font/otf' || mime === 'font/opentype' || mime === 'application/x-font-opentype' || src.includes('.otf')) return "format('opentype')"
  if (mime === 'font/ttf' || mime === 'application/x-font-ttf' || src.includes('.ttf')) return "format('truetype')"
  // Unknown MIME (e.g. application/octet-stream from Electron) — omit the hint
  // so the browser probes the file itself rather than rejecting on a wrong hint.
  return ''
}

function injectFontStyles(assets: AssetMap): void {
  const fonts = Object.entries(assets).filter(([, a]) => a.kind === 'font')
  if (!fonts.length) return
  const id = 'pa-fonts'
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = fonts
    .map(([assetId, a]) => {
      const hint = fontFormatHint(a.src)
      // font-weight range covers all weights so the browser never synthesizes
      // bold or falls back when the element uses a non-default weight.
      return `@font-face{font-family:'${assetId}';font-weight:100 900;src:url('${a.src}')${hint ? ' ' + hint : ''};}`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------
export function buildScene(scene: Scene, assets: AssetMap, opts: BuildOptions = {}): StageHandle {
  injectBaseStyles()
  injectAnimStyles()
  injectFontStyles(assets)

  const mount = opts.mount ?? document.body

  // AppLovin edge-bleed guard: AppLovin's Chromium WebView reports window.innerWidth/
  // innerHeight slightly smaller than the physical screen, so elements sized to 100%
  // leave a 1-2px gap at the edges. This fixed 300vmax div (same trick as layoutDim)
  // is placed DIRECTLY under the mount element — outside pa-root and its overflow:hidden
  // — so it can never be clipped, and always covers the physical screen edges.
  // Reuse across hot-updates rather than re-creating per scene.
  // Float mode (scene-overlay path): the overlay is mounted inside an overlayDiv that is already
  // above the game. A position:fixed bleed div inside it would join overlayDiv's stacking context
  // (z-index:9000) and cover the game with an opaque background, hiding game content behind the dim.
  // Skip bleed + body-bg updates entirely so the transparent pa-root shows the game through the dim.
  // Declared at function scope (not inside the `if`) so the `update` closure below
  // can re-apply the bleed background on live edits. Null in float mode (no bleed div).
  let bleedEl: HTMLDivElement | null = null
  if (!opts.float) {
    bleedEl = mount.querySelector<HTMLDivElement>('.pa-bleed')
    if (!bleedEl) {
      bleedEl = document.createElement('div')
      bleedEl.className = 'pa-bleed'
      bleedEl.style.cssText =
        'position:fixed;left:50%;top:50%;width:300vmax;height:300vmax;' +
        'transform:translate(-50%,-50%);pointer-events:none;z-index:0;'
      mount.insertBefore(bleedEl, mount.firstChild)
    }
    bleedEl.style.background = sceneBgCss(scene.meta.bgMatchColor, scene.meta.bgMatchColor2)
    // Belt-and-suspenders: also set body/html so even if bleedEl somehow gets
    // removed, the gap shows the scene colour instead of black.
    document.body.style.background = scene.meta.bgMatchColor || '#000'
    document.documentElement.style.background = scene.meta.bgMatchColor || '#000'
  }

  const root = document.createElement('div')
  root.className = 'pa-root'
  root.style.zIndex = '1' // sit above the bleed layer
  // In float mode (scene-overlay path) the pa-root is transparent so the dim/blur shows over game content below.
  root.style.background = opts.float ? 'transparent' : sceneBgCss(scene.meta.bgMatchColor, scene.meta.bgMatchColor2)
  // Fallback for bar-extension backgroundColor when the bar element has no explicit color.
  root.style.setProperty('--pa-bg', scene.meta.bgMatchColor || '#000000')
  if (scene.meta.cursor) root.style.cursor = scene.meta.cursor

  const ctx: RuntimeCtx = {
    scene,
    assets,
    src: (id?: string) => (id && assets[id] ? assets[id].src : ''),
    asset: (id?: string): AssetEntry | undefined => (id ? assets[id] : undefined),
    emit: (event: string, ...args: unknown[]) => emit(event, ...args), // → emitter (SFX etc.)
  }

  const recs: Rec[] = []
  // Hooks run after every layoutAll pass (initial mount + each resize). Interactive mechanics
  // that position content in raw pixels (e.g. drag-and-drop snapping) register here so their
  // offsets are recomputed against the new viewport instead of drifting when the screen resizes.
  const postLayout: (() => void)[] = []
  const byId = new Map<string, Rec>()
  let sfxWired = false // element tap/scene-enter sounds attached once
  let choicesWired = false // quiz/survey choice taps attached once
  let dragWired = false // drag-and-drop slots attached once
  let picksWired = false // tap-pick / fill / generate attached once
  let scratchWired = false // scratch-cover coatings attached once
  const scratchDisposers: (() => void)[] = []
  const tallies = new Map<string, number>() // running reveal totals, keyed by text element id

  // Built-in full-screen dim / blur overlay for win/lose scenes.
  // Uses a 300vmax centered absolute div so edges are always 150vmax off-screen —
  // zero edge artifacts on AppLovin regardless of how the viewport is reported.
  // Appended FIRST so it sits behind all scene elements in DOM order.
  if (scene.overlay) {
    const ov = scene.overlay
    const opacity = ov.opacity ?? 0
    const blur = ov.blurPx ?? 0
    if (opacity > 0 || blur > 0) {
      const color = ov.color ?? '#000000'
      const r = parseInt(color.slice(1, 3), 16) || 0
      const g = parseInt(color.slice(3, 5), 16) || 0
      const b = parseInt(color.slice(5, 7), 16) || 0
      const ovDiv = document.createElement('div')
      ovDiv.className = 'pa-scene-overlay'
      ovDiv.style.cssText =
        `position:absolute;left:50%;top:50%;width:300vmax;height:300vmax;` +
        `transform:translate(-50%,-50%);pointer-events:none;z-index:0;` +
        `background:rgba(${r},${g},${b},${opacity});`
      if (blur > 0) ovDiv.style.backdropFilter = `blur(${blur}px)`
      root.appendChild(ovDiv)
    }
  }

  const ordered = [...scene.elements].sort((a, b) => a.zIndex - b.zIndex)
  for (const el of ordered) {
    const outer = document.createElement('div')
    outer.className = 'pa-el'
    outer.dataset.id = el.id

    const anim = document.createElement('div')
    anim.className = 'pa-el-anim'
    outer.appendChild(anim)

    const content = mountContent(el, anim, ctx)

    // Non-interactive decorative elements must not absorb touches meant for the
    // game canvas or CTAs layered behind them in z-order. Scratch/reveal covers
    // keep their overlay canvas interactive; dim and the interactive widgets do too.
    const nonInteractive =
      el.type !== 'cta' && el.type !== 'choice' && el.type !== 'button' &&
      el.type !== 'game-mount' && el.type !== 'endscene' &&
      el.type !== 'unboxing' &&
      el.type !== 'dim' && !el.scratch && !el.reveal
    if (nonInteractive) {
      outer.style.pointerEvents = 'none'
      anim.style.pointerEvents = 'none'
    }

    root.appendChild(outer)

    const a = ctx.asset(el.assetId)
    const intrinsic = a ? { w: a.w, h: a.h } : { w: 100, h: 100 }
    const rec: Rec = { el, outer, anim, content, intrinsic }
    recs.push(rec)
    byId.set(el.id, rec)
  }

  mount.appendChild(root)

  for (const rec of recs) applyMountAnim(rec)
  for (const rec of recs) if (rec.el.type === 'countdown') startTicker(rec)

  // 'set-text' lets reveal tallies (and future score drivers) push a value into a
  // text element by id. Mutates the live element so later re-layouts keep the value.
  const offSetText = on('set-text', (id: string, value: string) => {
    const rec = byId.get(id)
    if (!rec || !rec.el.text) return
    rec.el.text.value = String(value)
    const inner = rec.content?.firstElementChild as HTMLElement | null
    if (inner) inner.textContent = String(value)
  })

  let stageWon = false
  const revealOnWin = (): void => {
    if (stageWon) return // idempotent: a game may report completion more than once
    stageWon = true
    for (const rec of recs) {
      if (rec.el.showOnWin && rec.el.hidden) {
        rec.el.hidden = false
        layoutRec(rec)
        runEntrance(rec) // a revealed element animates in
      } else if (entranceTriggers(rec.el, 'onGameWin')) {
        runEntrance(rec)
      }
    }
    emit('sfx', 'gameWin') // central win sound (every game template)
    emit('game-complete')
  }

  const handle: StageHandle = {
    root,
    layoutAll() {
      for (const rec of recs) layoutRec(rec)
      for (const rec of recs) if (rec.host) rec.host.relayout()
      for (const fn of postLayout) fn() // re-anchor imperatively-positioned mechanics (drag, …)
    },
    startGames(interactive) {
      for (const rec of recs) {
        if (rec.el.type === 'game-mount' && !rec.host && rec.content) {
          rec.host = createGameHost({
            slot: rec.content,
            handLayer: root,
            templateId: rec.el.game?.templateId ?? 'match',
            params: rec.el.game?.params ?? {},
            assets: ctx.assets,
            interactive,
            hintIdleMs: rec.el.game?.hintIdleMs ?? 4000,
            elementId: rec.el.id,
            navigate: (id) => emit('scene-goto', id),
            // An editable handguide element in the scene replaces the coded hint hand.
            hint: rec.el.game?.hintEnabled !== false && !recs.some((r) => r.el.type === 'handguide'),
            sfx: (event) => emit('sfx', event),
            sfxLoopStart: (event) => {
              const bind = (rec.el.sfx ?? []).find((b) => b.event === 'whileScratching' && b.assetId)
              if (bind) emit('sfx-asset-loop-start', bind.assetId, bind.volume ?? 1)
              else emit('sfx-loop-start', event)
            },
            sfxLoopStop: (event) => {
              const bind = (rec.el.sfx ?? []).find((b) => b.event === 'whileScratching' && b.assetId)
              if (bind) emit('sfx-asset-loop-stop', bind.assetId)
              else emit('sfx-loop-stop', event)
            },
            onWin: () => {
              for (const b of rec.el.sfx ?? [])
                if (b.event === 'onReveal' && b.assetId) emit('sfx-asset', b.assetId, b.volume ?? 1)
            },
            onComplete: () => {
              revealOnWin()
            },
          })
        } else if (rec.el.type === 'handguide' && interactive && !rec.hg && rec.content) {
          rec.hg = startHandguide(rec, recs, root)
        }
      }
      // quiz/survey choices: options select (mutually exclusive within a group);
      // in feedback mode the correct option turns green and a wrong pick red. An
      // advance choice (Continue/next) requests the scene's next step.
      if (interactive && !choicesWired) {
        choicesWired = true
        const choices = recs.filter((r) => r.el.type === 'choice')
        const options = choices.filter((r) => !r.el.choice?.advance)
        for (const r of choices) {
          const btn = r.content as HTMLButtonElement | null
          if (!btn) continue
          const cfg = r.el.choice ?? {}
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation()
            if (cfg.advance) {
              emit('sfx', 'tap')
              window.setTimeout(() => emit('pa-advance'), cfg.advanceDelayMs ?? 0)
              return
            }
            const group = cfg.group ?? '__'
            const groupOpts = options.filter((o) => (o.el.choice?.group ?? '__') === group)
            const feedback = groupOpts.some((o) => o.el.choice?.feedback)
            for (const o of groupOpts) {
              const ob = o.content as HTMLElement | null
              if (!ob) continue
              const oc = o.el.choice ?? {}
              ob.classList.toggle('pa-choice-sel', o === r)
              ob.style.background = o.el.box?.bgColor ?? ''
              if (feedback) {
                if (oc.correct) ob.style.background = oc.correctColor ?? '#22c55e'
                else if (o === r) ob.style.background = oc.wrongColor ?? '#ef4444'
              } else if (o === r) {
                ob.style.background = oc.selectColor ?? '#7c3aed'
              }
            }
            emit('sfx', feedback ? (cfg.correct ? 'correct' : 'wrong') : 'tap')
          })
        }
      }
      // drag-and-drop slots: drag an item into a same-group slot (it snaps in) or
      // back out; all slots in a group filled → game completion.
      if (interactive && !dragWired) {
        dragWired = true
        const items = recs.filter((r) => r.el.drag)
        const slots = recs.filter((r) => r.el.slot)
        if (items.length && slots.length) {
          const groupOf = (r: Rec): string => r.el.drag?.group ?? r.el.slot?.group ?? ''
          const home = new Map<Rec, { x: number; y: number }>()
          const off = new Map<Rec, { x: number; y: number }>()
          const itemSlot = new Map<Rec, Rec | null>()
          const slotItem = new Map<Rec, Rec | null>()
          const ctr = (r: Rec): { x: number; y: number } => {
            const b = r.outer.getBoundingClientRect()
            return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
          }
          const inside = (x: number, y: number, r: Rec): boolean => {
            const b = r.outer.getBoundingClientRect()
            return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
          }
          const setOff = (it: Rec, x: number, y: number, ease: boolean): void => {
            off.set(it, { x, y })
            it.anim.style.transition = ease ? 'transform .18s ease' : 'none'
            it.anim.style.transform = `translate(${x}px,${y}px)`
          }
          const checkWin = (): void => {
            const groups = new Set(slots.map(groupOf))
            for (const g of groups) {
              const gs = slots.filter((s) => groupOf(s) === g)
              if (gs.length && gs.every((s) => slotItem.get(s))) {
                emit('sfx', 'gameWin')
                emit('game-complete')
                return
              }
            }
          }
          requestAnimationFrame(() => {
            for (const it of items) {
              home.set(it, ctr(it))
              off.set(it, { x: 0, y: 0 })
              itemSlot.set(it, null)
            }
            for (const s of slots) slotItem.set(s, null)
          })
          // On resize: layoutRec has already re-placed every item/slot OUTER at its new FIT
          // position, so re-read each item's home and re-snap any item resting in a slot to the
          // slot's new center. Without this the cached home + pixel offset drift on resize.
          postLayout.push(() => {
            for (const it of items) {
              const h = ctr(it)
              home.set(it, h)
              const s = itemSlot.get(it)
              if (s) { const c = ctr(s); setOff(it, c.x - h.x, c.y - h.y, false) }
              else setOff(it, 0, 0, false)
            }
          })
          for (const it of items) {
            it.outer.style.cursor = 'grab'
            it.outer.style.touchAction = 'none'
            it.outer.style.pointerEvents = 'auto'
            it.outer.addEventListener('pointerdown', (e) => {
              const ev = e as PointerEvent
              it.outer.setPointerCapture(ev.pointerId)
              const start = { x: ev.clientX, y: ev.clientY }
              const base = off.get(it) ?? { x: 0, y: 0 }
              const prev = itemSlot.get(it) // picking up from a slot vacates it
              if (prev) {
                slotItem.set(prev, null)
                itemSlot.set(it, null)
              }
              it.outer.style.zIndex = '99999'
              const move = (m: PointerEvent): void => setOff(it, base.x + (m.clientX - start.x), base.y + (m.clientY - start.y), false)
              const up = (u: PointerEvent): void => {
                it.outer.removeEventListener('pointermove', move)
                it.outer.removeEventListener('pointerup', up)
                it.outer.style.zIndex = String(it.el.zIndex)
                const g = groupOf(it)
                const target = slots.find(
                  (s) => groupOf(s) === g && !slotItem.get(s) && (!s.el.slot?.key || s.el.slot.key === it.el.drag?.key) && inside(u.clientX, u.clientY, s),
                )
                if (target) {
                  const c = ctr(target)
                  const h = home.get(it) ?? c
                  setOff(it, c.x - h.x, c.y - h.y, true)
                  slotItem.set(target, it)
                  itemSlot.set(it, target)
                  emit('sfx', 'correct')
                  checkWin()
                } else {
                  setOff(it, 0, 0, true) // return home
                  emit('sfx', 'tap')
                }
              }
              it.outer.addEventListener('pointermove', move)
              it.outer.addEventListener('pointerup', up)
            })
          }
        }
      }
      // tap-pick → fill slot → generate (gated) → circular progress → reveal result.
      if (interactive && !picksWired) {
        picksWired = true
        const picks = recs.filter((r) => r.el.pick)
        const fills = recs.filter((r) => r.el.fill)
        const gens = recs.filter((r) => r.el.generate)
        if (picks.length || gens.length) {
          // place an image/video covering a rec's layer (fill slots + generate result)
          const fillInto = (rec: Rec, src: string, isVideo: boolean): void => {
            const prev = rec.anim.querySelector('.pa-fill')
            if (prev) prev.remove()
            if (!src) return
            const n = document.createElement(isVideo ? 'video' : 'img') as HTMLImageElement & HTMLVideoElement
            n.className = 'pa-fill'
            n.src = src
            const radius = rec.el.box?.pill ? '9999px' : rec.el.box?.radiusPx ? rec.el.box.radiusPx * scale() + 'px' : ''
            n.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;border-radius:${radius};`
            if (isVideo) {
              n.autoplay = true
              n.loop = true
              n.muted = true
              n.setAttribute('playsinline', '')
            }
            rec.anim.style.position = 'relative'
            rec.anim.appendChild(n)
            if (isVideo) void n.play?.().catch(() => {})
          }
          // Each group holds as many picks as it has fill slots (so the author
          // sets "how many per category" just by placing more fill slots). A
          // 1-slot group acts like a radio; an N-slot group holds N. Slots fill in
          // scene order unless a fill gives an explicit index.
          const recIndex = new Map<Rec, number>(recs.map((r, i) => [r, i]))
          const capacityOf = (group: string): number => fills.filter((f) => f.el.fill?.group === group).length
          const groupFills = (group: string): Rec[] =>
            fills.filter((f) => f.el.fill?.group === group).sort((a, b) => (a.el.fill!.index ?? recIndex.get(a)!) - (b.el.fill!.index ?? recIndex.get(b)!))
          const refreshFills = (group?: string): void => {
            const groups = group ? [group] : [...new Set(fills.map((f) => f.el.fill!.group))]
            for (const g of groups) {
              const ids = getPicks(g)
              groupFills(g).forEach((f, j) => {
                const a = ctx.asset(ids[j])
                fillInto(f, a?.src ?? '', a?.kind === 'video')
              })
            }
          }
          const highlight = (group: string): void => {
            for (const p of picks) {
              if (p.el.pick?.group !== group) continue
              const on = isPicked(group, p.el.assetId ?? '')
              p.outer.style.outline = on ? '5px solid #7c3aed' : ''
              p.outer.style.outlineOffset = on ? '3px' : ''
            }
          }
          requestAnimationFrame(() => refreshFills()) // initial (cross-scene picks)

          for (const p of picks) {
            p.outer.style.cursor = 'pointer'
            p.outer.style.pointerEvents = 'auto'
            p.outer.addEventListener('pointerdown', (e) => {
              ;(e as PointerEvent).stopPropagation()
              const g = p.el.pick!.group
              togglePick(g, p.el.assetId, capacityOf(g) || Infinity)
              highlight(g)
              refreshFills(g)
              emit('sfx', 'tap')
            })
          }

          const runGenerate = (rec: Rec): void => {
            const cfg = rec.el.generate!
            const accent = cfg.accent || '#7c3aed'
            const sz = Math.min(rec.outer.clientWidth, rec.outer.clientHeight) * 0.5
            const wrap = document.createElement('div')
            wrap.className = 'pa-gen'
            wrap.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${sz}px;height:${sz}px;`
            const ring = document.createElement('div')
            ring.style.cssText = `position:absolute;inset:0;border-radius:50%;-webkit-mask:radial-gradient(circle,transparent 58%,#000 59%);mask:radial-gradient(circle,transparent 58%,#000 59%);`
            const label = document.createElement('div')
            label.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:${sz * 0.2}px;`
            wrap.appendChild(ring)
            wrap.appendChild(label)
            rec.anim.style.position = 'relative'
            rec.anim.appendChild(wrap)
            const dur = cfg.durationMs && cfg.durationMs > 0 ? cfg.durationMs : 2500
            const t0 = performance.now()
            const tick = (now: number): void => {
              const pr = Math.min(1, (now - t0) / dur)
              const deg = pr * 360
              ring.style.background = `conic-gradient(${accent} ${deg}deg, rgba(255,255,255,.16) ${deg}deg)`
              label.textContent = Math.round(pr * 100) + '%'
              if (pr < 1) requestAnimationFrame(tick)
              else {
                wrap.remove()
                const a = ctx.asset(cfg.resultId)
                if (a) fillInto(rec, a.src, a.kind === 'video')
                emit('sfx', 'gameWin')
                emit('game-complete')
              }
            }
            requestAnimationFrame(tick)
          }

          const triggers = new Map<Rec, () => void>()
          for (const gen of gens) {
            let started = false
            const run = (): void => {
              if (started) return
              if (!(gen.el.generate?.needs ?? []).every((g) => getPicks(g).length >= Math.max(1, capacityOf(g)))) {
                emit('sfx', 'wrong')
                return
              }
              started = true
              runGenerate(gen)
            }
            triggers.set(gen, run)
            gen.outer.style.cursor = 'pointer'
            gen.outer.style.pointerEvents = 'auto'
            gen.outer.addEventListener('pointerdown', (e) => {
              ;(e as PointerEvent).stopPropagation()
              run()
            })
          }
          // swipe-up anywhere also starts the first generate ("SWIPE TO START").
          if (gens.length) {
            let sy = 0
            let st = 0
            root.addEventListener('pointerdown', (e) => {
              sy = (e as PointerEvent).clientY
              st = performance.now()
            })
            root.addEventListener('pointerup', (e) => {
              if (sy - (e as PointerEvent).clientY > 60 && performance.now() - st < 700) triggers.get(gens[0])?.()
            })
          }
        }
      }
      // scratch covers (interactive only): paint a canvas coating over each
      // `el.scratch` element and erase it to reveal the elements behind.
      if (interactive && !scratchWired) {
        scratchWired = true
        const covers = recs.filter((r) => r.el.scratch)
        if (covers.length) {
          const rng = mulberry32(0x5c0a7c)
          for (const rec of covers) scratchDisposers.push(attachScratchCover(rec, recs, ctx, ctx.emit, tallies, rng))
        }
      }
      // element-level sounds (interactive only): fire scene-enter once now; tap
      // sounds are hit-tested at the root so they never block the game/CTA beneath.
      if (interactive && !sfxWired) {
        sfxWired = true
        for (const rec of recs)
          if (!rec.el.hidden) // skip showOnWin elements — their sceneEnter would fire before they're visible
            for (const b of rec.el.sfx ?? []) if (b.event === 'sceneEnter' && b.assetId) emit('sfx-asset', b.assetId, b.volume ?? 1)
        const tapRecs = recs.filter((r) => r.el.sfx?.some((b) => b.event === 'tap' && b.assetId))
        if (tapRecs.length) {
          root.addEventListener(
            'pointerdown',
            (e) => {
              const x = (e as PointerEvent).clientX
              const y = (e as PointerEvent).clientY
              for (const r of tapRecs) {
                if (r.el.hidden) continue
                const rect = r.outer.getBoundingClientRect()
                if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
                  for (const b of r.el.sfx ?? []) if (b.event === 'tap' && b.assetId) emit('sfx-asset', b.assetId, b.volume ?? 1)
              }
            },
            { capture: true },
          )
        }
      }
    },
    playEntrances() {
      for (const rec of recs) {
        if (rec.el.hidden) continue // hidden/showOnWin elements animate when revealed
        if (entranceTriggers(rec.el, 'onMount')) runEntrance(rec)
      }
    },
    playExit() {
      for (const rec of recs) {
        const css = exitCss(rec.el)
        if (css) restartAnim(rec.anim, css)
      }
    },
    setHidden(id, hidden) {
      const rec = byId.get(id)
      if (!rec) return
      rec.el.hidden = hidden
      layoutRec(rec)
    },
    update(nextScene, nextAssets) {
      const ordered = [...nextScene.elements].sort((a, b) => a.zIndex - b.zIndex)
      if (ordered.length !== recs.length) return false
      for (let i = 0; i < ordered.length; i++) {
        const nel = ordered[i]
        const rec = recs[i]
        if (nel.id !== rec.el.id || nel.type !== rec.el.type || nel.assetId !== rec.el.assetId) return false
        // toggling container mode swaps the content node (img <-> masked div)
        if (!!nel.container !== !!rec.el.container) return false
        // a game's template/params change requires a full re-mount
        if (nel.type === 'game-mount' && JSON.stringify(nel.game) !== JSON.stringify(rec.el.game)) return false
        // an endscene's media/fit/bg change needs a fresh build (new <video>/<img>)
        if (nel.type === 'endscene' && JSON.stringify(nel.endscene) !== JSON.stringify(rec.el.endscene)) return false
        // unboxing config change — replay the animation with fresh images
        if (nel.type === 'unboxing' && JSON.stringify(nel.unboxing) !== JSON.stringify(rec.el.unboxing)) return false
      }
      ctx.assets = nextAssets
      // re-apply the scene background (set at build time) so background edits are live
      root.style.background = sceneBgCss(nextScene.meta.bgMatchColor, nextScene.meta.bgMatchColor2)
      root.style.setProperty('--pa-bg', nextScene.meta.bgMatchColor || '#000000')
      if (bleedEl) bleedEl.style.background = sceneBgCss(nextScene.meta.bgMatchColor, nextScene.meta.bgMatchColor2)
      document.body.style.background = nextScene.meta.bgMatchColor || '#000'
      document.documentElement.style.background = nextScene.meta.bgMatchColor || '#000'
      // re-apply built-in overlay so opacity/color/blur edits are live in the editor
      const existingOv = root.querySelector<HTMLDivElement>('.pa-scene-overlay')
      const nextOv = nextScene.overlay
      if (existingOv && nextOv) {
        const opacity = nextOv.opacity ?? 0
        const color = nextOv.color ?? '#000000'
        const r = parseInt(color.slice(1, 3), 16) || 0
        const g = parseInt(color.slice(3, 5), 16) || 0
        const b = parseInt(color.slice(5, 7), 16) || 0
        existingOv.style.background = `rgba(${r},${g},${b},${opacity})`
        existingOv.style.backdropFilter = (nextOv.blurPx ?? 0) > 0 ? `blur(${nextOv.blurPx}px)` : ''
      } else if (!existingOv && nextOv && ((nextOv.opacity ?? 0) > 0 || (nextOv.blurPx ?? 0) > 0)) {
        // overlay was just toggled on — need a full rebuild
        return false
      } else if (existingOv && !nextOv) {
        return false // overlay removed — full rebuild
      }
      for (let i = 0; i < ordered.length; i++) {
        const nel = ordered[i]
        const rec = recs[i]
        const prev = rec.el
        rec.el = nel
        byId.set(nel.id, rec)
        if (nel.type === 'cta' || nel.type === 'choice') {
          if (!nel.assetId && rec.content) {
            rec.content.textContent = localize(nel.text) || (nel.type === 'cta' ? 'PLAY' : '')
            rec.content.style.color = nel.text?.color ?? '#fff'
          }
        } else if (nel.type === 'background' && rec.content) {
          rec.content.style.objectFit = nel.background?.objectFit ?? 'cover'
        } else if (nel.type === 'bar' && rec.content) {
          applyBarFill(rec.content as HTMLDivElement, nel, ctx)
        } else if (nel.type === 'unboxing' && rec.content) {
          applyUnboxingImages(rec.content as HTMLDivElement, nel, ctx)
        } else if (nel.container && rec.content) {
          styleContainer(rec.content, nel, ctx) // live inner-image / fit updates
        }
        // re-apply the loop/pulse only when the animation or CTA config changed
        // (setting the same value would needlessly restart it)
        if (JSON.stringify(nel.animations) !== JSON.stringify(prev.animations) || JSON.stringify(nel.cta) !== JSON.stringify(prev.cta)) applyMountAnim(rec)
        // restart the countdown ticker when its config changed
        if (nel.type === 'countdown' && JSON.stringify(nel.countdown) !== JSON.stringify(prev.countdown)) startTicker(rec)
        // text value/style + all geometry are re-applied by layoutRec below.
      }
      for (const rec of recs) layoutRec(rec)
      return true
    },
    get: (id) => byId.get(id),
    destroy() {
      offSetText()
      for (const dispose of scratchDisposers) dispose()
      scratchDisposers.length = 0
      for (const rec of recs) {
        rec.host?.destroy()
        rec.hg?.stop()
        if (rec.ticker) window.clearInterval(rec.ticker)
      }
      root.remove()
    },
  }
  return handle
}

// ---------------------------------------------------------------------------
// Content creation per element type. Configures the anim node where needed.
// ---------------------------------------------------------------------------
function mountContent(el: SceneElement, anim: HTMLDivElement, ctx: RuntimeCtx): HTMLElement | null {
  switch (el.type) {
    case 'dim':
      return null
    case 'text': {
      const c = createTextContent(el)
      anim.style.display = 'inline-block'
      anim.style.width = 'auto'
      anim.style.height = 'auto'
      anim.appendChild(c)
      return c
    }
    case 'cta': {
      const c = createCtaContent(el, ctx)
      anim.appendChild(c) // loop/pulse applied by applyMountAnim after build
      return c
    }
    case 'button': {
      const c = createButtonContent(el, ctx)
      anim.appendChild(c) // no auto-pulse; animates only if el.animations is set
      return c
    }
    case 'choice': {
      const c = createChoiceContent(el, ctx)
      anim.appendChild(c)
      return c
    }
    case 'background': {
      const c = createImageContent(el, ctx)
      c.style.objectFit = el.background?.objectFit ?? 'cover'
      anim.appendChild(c)
      return c
    }
    case 'bar': {
      // Stretchable fill (background-size:100% 100%) — works for raster + SVG.
      const c = createBarContent(el, ctx)
      anim.appendChild(c)
      return c
    }
    case 'game-mount': {
      const c = document.createElement('div')
      c.className = 'pa-game'
      c.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;'
      anim.appendChild(c)
      return c
    }
    case 'endscene': {
      const c = createEndsceneContent(el, ctx)
      anim.appendChild(c)
      return c
    }
    case 'unboxing': {
      const c = createUnboxingContent(el, ctx)
      anim.appendChild(c)
      return c
    }
    case 'countdown': {
      // rendered like text (styled via el.text); the ticker sets the value
      const c = createTextContent(el)
      anim.appendChild(c)
      return c
    }
    default: {
      // image / handguide
      if (!el.assetId) return null
      const c = el.container ? createContainerContent(el, ctx) : createImageContent(el, ctx)
      anim.appendChild(c)
      return c
    }
  }
}

// ---------------------------------------------------------------------------
// Effective props: merge landscape overrides when the viewport is landscape.
// ---------------------------------------------------------------------------
function effective(el: SceneElement): Effective {
  const o = isLandscape() ? el.landscape : undefined
  return {
    x: o?.x ?? el.x,
    y: o?.y ?? el.y,
    w: o?.w ?? el.w,
    h: o?.h ?? el.h,
    scale: o?.scale ?? el.scale ?? 1,
    anchor: o?.anchor ?? el.anchor,
    zIndex: o?.zIndex ?? el.zIndex,
    mode: o?.mode ?? el.mode,
    hidden: (o?.hidden ?? el.hidden) ?? false,
    rotation: el.rotation ?? 0,
    opacity: el.opacity,
  }
}

// ---------------------------------------------------------------------------
// Layout one element.
// ---------------------------------------------------------------------------
function layoutRec(rec: Rec): void {
  const e = effective(rec.el)
  const outer = rec.outer

  // While an overlay is up, the scene-overlay handler re-parents immune elements
  // (CTA / overlayImmune bar / date) into pa-stage and lifts them to z:10000 ABOVE the
  // dim. A relayout (resize) must NOT reset them to their scene z — that drops them
  // BEHIND the dim (z:9000) and they vanish. Detect the floated state (outside any
  // pa-root, inside pa-stage) and preserve the overlay z; restoreImmune resets it later.
  const floatedImmune = !outer.closest('.pa-root') && !!outer.closest('.pa-stage')
  outer.style.zIndex = floatedImmune ? '10000' : String(e.zIndex)
  // CTA is always immune; other elements opt in via overlayImmune
  outer.classList.toggle('pa-el--immune', rec.el.type === 'cta' || !!rec.el.overlayImmune)
  outer.style.opacity = e.opacity != null ? String(e.opacity) : ''

  if (e.hidden) {
    outer.style.display = 'none'
    return
  }
  outer.style.display = ''
  // Reset edge-pins so an element switching mode/orientation never keeps stale
  // right/bottom values from a previous layout pass.
  outer.style.right = 'auto'
  outer.style.bottom = 'auto'
  // Uniform layer blur (scaled with the FIT scale so it looks the same at any size).
  rec.anim.style.filter = rec.el.blur ? `blur(${(rec.el.blur * scale()).toFixed(2)}px)` : ''
  // clip-path: inset(0) clips the blur to the element boundary AFTER filter rendering —
  // more reliable than parent overflow:hidden in old Chromium WebViews (AppLovin).
  rec.anim.style.clipPath = rec.el.blur ? 'inset(0)' : ''

  switch (rec.el.type) {
    case 'background':
      layoutBackground(rec)
      return
    case 'dim':
      layoutDim(rec)
      return
    case 'text':
    case 'countdown':
      layoutText(rec, e)
      return
    case 'bar':
      layoutAsset(rec, e, e.mode === 'fit' ? 'fit' : 'extend')
      applyFrame(rec)
      return
    case 'endscene':
      layoutEndscene(rec, e)
      return
    case 'unboxing':
      layoutAsset(rec, e, 'fit')
      return
    default:
      layoutAsset(rec, e, e.mode === 'extend' ? 'extend' : 'fit')
      if ((rec.el.type === 'cta' || rec.el.type === 'choice' || rec.el.type === 'button') && rec.content) styleCta(rec.content, rec.el, scale())
      else {
        applyFrame(rec) // image / handguide / game-mount: stroke + radius + padding
        if (rec.el.container) {
          rec.anim.style.boxSizing = 'border-box'
          rec.anim.style.padding = `${((rec.el.container.padPx ?? 0) * scale()).toFixed(1)}px`
        } else if (rec.anim.style.padding) {
          rec.anim.style.padding = ''
        }
      }
  }
}

// Generic stroke/frame for non-text elements (image / bar / game / handguide),
// applied to the animation wrapper. The stroke is an OUTSIDE stroke (a CSS outline,
// which draws beyond the box and never shrinks the content); "padding" becomes the
// gap between the element and the stroke (outline-offset). Corner radius rounds the
// element and clips its content; the outline follows the radius.
function applyFrame(rec: Rec): void {
  const box = rec.el.box
  const anim = rec.anim
  const s = scale()
  const radius = !box ? '' : box.pill ? '9999px' : box.radiusPx ? box.radiusPx * s + 'px' : ''
  anim.style.borderRadius = radius
  anim.style.overflow = radius ? 'hidden' : ''
  anim.style.background = box?.bgColor ?? ''
  anim.style.boxShadow = box ? shadowCss(box.shadow, s) : ''
  if (box?.borderPx) {
    anim.style.outline = `${(box.borderPx * s).toFixed(2)}px solid ${box.borderColor ?? '#000'}`
    anim.style.outlineOffset = `${((box.paddingXPx ?? 0) * s).toFixed(2)}px`
  } else {
    anim.style.outline = ''
    anim.style.outlineOffset = ''
  }
}

function applyBox(
  outer: HTMLDivElement,
  px: number,
  py: number,
  w: number,
  h: number,
  tx: number,
  ty: number,
  rotation: number,
): void {
  outer.style.left = round(px) + 'px'
  outer.style.top = round(py) + 'px'
  outer.style.width = w + 'px'
  outer.style.height = h + 'px'
  outer.style.transform = `translate(${tx}%,${ty}%)` + (rotation ? ` rotate(${rotation}deg)` : '')
}

function layoutAsset(rec: Rec, e: Effective, mode: 'fit' | 'extend'): void {
  const a = rec.intrinsic
  const s = scale()
  const outer = rec.outer

  if (mode === 'extend') {
    // A bar fills the FULL viewport WIDTH via CSS (left:0; width:100% of pa-root).
    // Any edge gap from AppLovin's viewport inaccuracy is covered by the pa-bleed
    // element (outside pa-root) which shows the scene background colour instead of black.
    const h = (e.h != null ? e.h : a.h * e.scale) * s
    const ay = ANCHOR[e.anchor][1] // 0 top, -50 center, -100 bottom (%)
    const naturalTop = sy(e.y) + (ay / 100) * h // screen-px top of the design rect
    // Reset position; pin:top/autoTop will override to 'fixed' for physical-edge bleed.
    outer.style.position = ''
    outer.style.left = '0'
    outer.style.width = '100%'
    // translateZ(0) forces a GPU compositing layer for blurred elements — without it,
    // AppLovin's Chromium WebView shows white bleeding edges around filter:blur().
    const gpu = rec.el.blur ? ' translateZ(0)' : ''
    outer.style.transform = e.rotation ? `rotate(${e.rotation}deg)${gpu}` : (gpu.trim() || 'none')
    // Clip blur so it never bleeds outside the element's rect in Chromium WebViews.
    outer.style.overflow = rec.el.blur ? 'hidden' : ''

    // Pin EXTENDS the band across the letterbox gap to the true screen edge.
    // Auto-extend to top when:
    //   (a) element is designed with y<0 (anchor:top) — sits in the letterbox band, and
    //       without extension AppLovin's injected white or the game scene background shows
    //       in the gap above the element; OR
    //   (b) element has blur — the blur feathers to transparent at the gap edge and
    //       AppLovin Chromium compositor turns those transparent pixels white.
    const pin = rec.el.pin
    const inLetterbox = !pin && e.anchor === 'top' && (e.y ?? 0) < 0
    const autoTop = inLetterbox || (!pin && !!rec.el.blur)
    // Resolve --pa-bg to a literal hex at layout time so the value survives any DOM
    // reparenting (e.g. immune elements moved to stageContainer during overlay).
    const paBg = (rec.outer.closest<HTMLElement>('.pa-root')?.style.getPropertyValue('--pa-bg') ?? '') || '#000000'
    // Image bars: prefer the sampled top-edge color of the art (data-pa-edge, see
    // sampleTopEdge in elements/bar.ts) so the extend-to-screen-top band blends
    // seamlessly with the image instead of showing the scene background as a gap.
    const edgeColor = rec.content instanceof HTMLElement ? rec.content.dataset.paEdge : undefined
    const barBgColor = rec.el.bar?.color ?? edgeColor ?? paBg
    const isBarDiv = (rec.el.type === 'bar' || rec.el.type === 'image') && !rec.el.blur
      && rec.content instanceof HTMLDivElement
    // BLEED: for top-pinned/letterbox bars, switch to position:fixed so the bar can
    // extend BEYOND the CSS viewport into the physical screen gap that AppLovin's WebView
    // leaves at the edges. position:fixed bypasses pa-root's overflow:hidden so BLEED px
    // of extra coverage actually reaches the device screen edge instead of being clipped.
    const BLEED = 6
    // Minimum visible height for pin:'top' bars — keeps the header usable on compressed
    // viewports (height-limited desktop) where the bar would otherwise be only ~18px.
    // NOTE: this floor can make the bar taller than its design proportion and overlap
    // content designed right below it; bars designed above the fold (y<0, anchor:top)
    // auto-extend WITHOUT the floor, so they usually don't need an explicit pin.
    const PIN_TOP_MIN_VIS = 60
    if (pin === 'top' || autoTop) {
      outer.style.position = 'fixed'
      outer.style.top = -BLEED + 'px'
      outer.style.left = -BLEED + 'px'
      outer.style.width = `calc(100% + ${2 * BLEED}px)`
      outer.style.height = Math.max(0, naturalTop + h + BLEED, (pin === 'top' ? PIN_TOP_MIN_VIS : 0) + BLEED) + 'px'
      // translateZ(0) forces a GPU compositing layer so the bar escapes pa-root's
      // overflow clip and covers the physical screen gap. Skip when the bar is in
      // pa-stage directly (immune overlay mode) — there it must stay non-promoted so
      // Chrome's compositor doesn't anti-alias its edge against the overlay content.
      const inImmune = !outer.closest('.pa-root') && !!outer.closest('.pa-stage')
      if (!inImmune) {
        outer.style.transform = e.rotation ? `rotate(${e.rotation}deg) translateZ(0)` : 'translateZ(0)'
      }
      // Fill the outer div (including its 6px bleed extensions) with the bar color so the
      // bleed area is bar-colored rather than transparent. Without this, the 6px halo around
      // the bar content div has no background and the body bg bleeds through compositor edges.
      outer.style.background = barBgColor
      if (isBarDiv) {
        const barDiv = rec.content as HTMLDivElement
        barDiv.style.backgroundColor = barBgColor
        // Image bars: keep the art at its PROPORTIONAL design height (h px), bottom-anchored
        // to the bar's design rect, instead of letting background-size:100% 100% stretch it
        // up through the whole top-extended outer. Without this the header art grows and
        // distorts as the viewport aspect (the offY letterbox) changes — the extension above
        // just shows the bar color. (applyBarFill resets to 100% 100% on edits; re-pin here.)
        if (barDiv.style.backgroundImage && barDiv.style.backgroundImage !== 'none') {
          barDiv.style.backgroundSize = `100% ${Math.max(1, Math.round(h))}px`
          barDiv.style.backgroundPosition = 'center bottom'
        }
      }
      // Match body/html background to bar color so any compositor edge artifact (which
      // composites the GPU layer against the body bg) shows bar color — invisible against
      // the bar itself. Only apply in the game scene (pa-root directly in pa-stage), not
      // in float/overlay mode where body bg is owned by the game scene below.
      const isGameScene = (outer.closest<HTMLElement>('.pa-root')?.parentElement
        ?.classList.contains('pa-stage')) ?? false
      if (isGameScene) {
        document.body.style.background = barBgColor
        document.documentElement.style.background = barBgColor
      }
    } else if (pin === 'bottom') {
      outer.style.background = ''
      outer.style.top = round(naturalTop) + 'px'
      // Extend 4px past the reported viewport to cover AppLovin's 1-2px physical edge gap.
      outer.style.height = Math.max(0, viewH() - naturalTop + 4) + 'px'
    } else {
      outer.style.background = ''
      outer.style.top = round(naturalTop) + 'px'
      outer.style.height = h + 'px'
    }
    // Clear backgroundColor override when not extending (e.g. landscape flip with no letterbox).
    if (!pin && !autoTop && isBarDiv) {
      (rec.content as HTMLDivElement).style.backgroundColor = ''
    }
    return
  }

  // FIT
  const px = sx(e.x)
  const py = sy(e.y)
  let w: number
  let h: number
  if (e.w != null && e.h != null) {
    w = e.w * s
    h = e.h * s
  } else {
    w = a.w * e.scale * s
    h = a.h * e.scale * s
  }
  const [tx, ty] = ANCHOR[e.anchor]
  applyBox(outer, px, py, w, h, tx, ty, e.rotation)
}

function sceneBgCss(c1?: string, c2?: string): string {
  if (!c1) return ''
  if (!c2) return c1
  return `linear-gradient(${isLandscape() ? 'to right' : 'to bottom'}, ${c1}, ${c2})`
}

// Apply a background-box style (fill / radius / padding / border) to a node,
// scaling design-px values by the current FIT scale. Shared by text + cta.
function shadowCss(kind: string | undefined, s: number): string {
  if (kind === 'soft') return `0 ${4 * s}px ${12 * s}px rgba(0,0,0,.28)`
  if (kind === 'medium') return `0 ${8 * s}px ${22 * s}px rgba(0,0,0,.4)`
  if (kind === 'strong') return `0 ${14 * s}px ${40 * s}px rgba(0,0,0,.55)`
  return ''
}
function applyBoxStyle(node: HTMLElement, box: SceneElement['box'], s: number): void {
  node.style.background = box?.bgColor ?? ''
  node.style.borderRadius = box?.pill ? '9999px' : box?.radiusPx ? box.radiusPx * s + 'px' : ''
  node.style.border = box?.borderPx ? box.borderPx * s + 'px solid ' + (box.borderColor ?? '#000') : ''
  node.style.padding = (box?.paddingYPx ?? 0) * s + 'px ' + (box?.paddingXPx ?? 0) * s + 'px'
  node.style.boxShadow = shadowCss(box?.shadow, s)
  node.style.boxSizing = 'border-box'
}

function layoutText(rec: Rec, e: Effective): void {
  const t = rec.el.text
  const box = rec.content
  if (!t || !box) return
  const inner = box.firstElementChild as HTMLElement | null
  if (!inner) return
  const s = scale()

  // inner text styling (re-applied each layout so edits stay reactive).
  // Countdown elements show the live formatted time, not the static value.
  inner.textContent = rec.el.type === 'countdown' ? formatCountdown(rec.el, rec.deadline ?? Date.now(), Date.now()) : localize(t)
  inner.style.fontFamily = t.fontFamily ?? ''
  inner.style.fontWeight = String(t.fontWeight ?? 400)
  inner.style.color = t.color ?? '#fff'
  inner.style.textAlign = t.align ?? 'center'
  inner.style.lineHeight = String(t.lineHeight ?? 1.15)
  inner.style.textShadow = t.shadow ?? ''
  inner.style.fontSize = t.fontSizePx * s + 'px'
  inner.style.letterSpacing = (t.letterSpacingPx ?? 0) * s + 'px'
  inner.style.setProperty('-webkit-text-stroke', t.strokePx ? t.strokePx * s + 'px ' + (t.strokeColor ?? '#000') : '')
  inner.style.whiteSpace = e.w != null || t.maxWidthPx ? 'normal' : 'nowrap'
  inner.style.maxWidth = t.maxWidthPx ? t.maxWidthPx * s + 'px' : ''

  // background box
  applyBoxStyle(box, rec.el.box, s)
  if (e.w != null && e.h != null) {
    // fixed-size box: flex-center the text (length & width come from w/h)
    box.style.width = e.w * s + 'px'
    box.style.height = e.h * s + 'px'
    box.style.display = 'flex'
    box.style.alignItems = 'center'
    box.style.justifyContent = t.align === 'left' ? 'flex-start' : t.align === 'right' ? 'flex-end' : 'center'
  } else {
    // auto-size: box hugs text + padding
    box.style.display = 'inline-block'
    box.style.width = 'auto'
    box.style.height = 'auto'
  }

  // Make the outer shrink-wrap the text at any scale: inline-block gives it
  // intrinsic width so translate(-50%,-50%) anchors correctly on all screen sizes.
  rec.anim.style.display = 'inline-block'
  rec.anim.style.width = 'auto'
  rec.anim.style.height = 'auto'

  const outer = rec.outer
  // All text elements use position:absolute + px (not %) to avoid two problems:
  // 1. % drift — top:X% is relative to pa-root.clientHeight (= window.innerHeight). Using
  //    visualViewport.height as divisor causes drift when they differ (mobile keyboard,
  //    DevTools simulation). Absolute px is never relative to anything so it never drifts.
  // 2. overlay gap — position:fixed escapes pa-root's stacking context. Absolute stays
  //    inside pa-root's clip. pa-root is position:absolute;inset:0, so top:Xpx absolute
  //    == top:Xpx from viewport top — same visual result as fixed, no side-effects.
  // Text/countdown is plain FIT content: positioned with sy(e.y) exactly like
  // images, so it scales and keeps its designed position relative to everything
  // else at every viewport size. (el.pin is bar-only; a leftover pin value on a
  // text element from older scenes is deliberately ignored.)
  // Unlike fixed assets, text elements need to shrink-wrap their content —
  // don't set width/height so the nested inline-block chain sizes correctly.
  const [tx, ty] = ANCHOR[e.anchor]
  outer.style.position = ''
  outer.style.left = round(sx(e.x)) + 'px'
  outer.style.top = round(sy(e.y)) + 'px'
  outer.style.width = ''
  outer.style.height = ''
  outer.style.transform = `translate(${tx}%,${ty}%)` + (e.rotation ? ` rotate(${e.rotation}deg)` : '')
}

// Style a CTA button: background box + (for text CTAs) flex-centered scaled label.
function styleCta(btn: HTMLElement, el: SceneElement, s: number): void {
  applyBoxStyle(btn, el.box, s)
  btn.style.overflow = el.box?.radiusPx ? 'hidden' : ''
  if (!el.assetId) {
    const align = el.text?.align ?? 'center'
    btn.style.display = 'flex'
    btn.style.alignItems = 'center'
    btn.style.justifyContent = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
    btn.style.textAlign = align
    btn.style.color = el.text?.color ?? '#fff'
    btn.style.fontWeight = String(el.text?.fontWeight ?? 800)
    btn.style.fontSize = (el.text?.fontSizePx ?? 48) * s + 'px'
  }
}

// Background always covers the full viewport. Edge gaps on AppLovin are covered
// by the pa-bleed element (outside pa-root) rather than overshooting here.
function layoutBackground(rec: Rec): void {
  const outer = rec.outer
  outer.style.position = ''
  outer.style.left = '0'
  outer.style.top = '0'
  outer.style.right = ''
  outer.style.bottom = ''
  outer.style.width = '100%'
  outer.style.height = '100%'
  outer.style.transform = 'none'
  // The <img> fills this full-screen box; object-fit crops it. In PORTRAIT the user
  // picks which part of the cover-crop stays visible (focusX/focusY). LANDSCAPE always
  // centers, so the image simply crops to cover the wider screen. Re-applied every
  // layout pass, so an orientation flip swaps the behaviour with no rebuild.
  const img = rec.content
  if (img) {
    const bg = rec.el.background
    img.style.objectFit = bg?.objectFit ?? 'cover'
    img.style.objectPosition = isLandscape() ? '50% 50%' : `${bg?.focusX ?? 50}% ${bg?.focusY ?? 50}%`
  }
}

// Endscene: 'extend' fills the whole viewport (the usual full-bleed endscene
// video); 'fit' uses the element's design box (a framed clip). Either way the
// inner <video>/<img> handles cover/contain itself; we just pick the orientation
// source here so a rotation swaps the clip without a rebuild.
function layoutEndscene(rec: Rec, e: Effective): void {
  const outer = rec.outer
  if (e.mode === 'extend') {
    // Edge gaps on AppLovin are covered by the pa-bleed element (outside pa-root).
    outer.style.position = ''
    outer.style.left = '0'
    outer.style.top = '0'
    outer.style.right = ''
    outer.style.bottom = ''
    outer.style.width = '100%'
    outer.style.height = '100%'
    outer.style.transform = e.rotation ? `rotate(${e.rotation}deg)` : 'none'
  } else {
    const s = scale()
    const a = rec.intrinsic
    const px = sx(e.x)
    const py = sy(e.y)
    const w = e.w != null ? e.w * s : a.w * e.scale * s
    const h = e.h != null ? e.h * s : a.h * e.scale * s
    const [tx, ty] = ANCHOR[e.anchor]
    applyBox(outer, px, py, w, h, tx, ty, e.rotation)
  }
  if (rec.content) updateEndsceneMedia(rec.content, isLandscape())
}

// AppLovin-safe dim — ported from coinsort EndCard.show(): an oversized,
// screen-pinned box (300vmax == the DOM equivalent of max(viewW,viewH)*3), so a
// mis-reported viewport offset only pushes the overflow off-screen and the
// visible area is always fully covered. NEVER 100vw/100vh.
function layoutDim(rec: Rec): void {
  const d = rec.el.dim
  const outer = rec.outer
  outer.style.position = 'fixed'
  outer.style.left = '50%'
  outer.style.top = '50%'
  outer.style.width = '300vmax'
  outer.style.height = '300vmax'
  outer.style.transform = 'translate(-50%,-50%)'
  outer.style.background = d?.color ?? '#000'
  outer.style.opacity = String(d?.alpha ?? 0.6)
  outer.style.pointerEvents = d?.blocksInput ? 'auto' : 'none'
}
