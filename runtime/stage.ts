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
import { isLandscape, scale, sx, sy, viewH } from './responsive'
import { composeElementAnim, entranceTriggers, exitCss, injectAnimStyles } from './anim'
import { createImageContent } from './elements/image'
import { applyBarFill, createBarContent } from './elements/bar'
import { createTextContent } from './elements/text'
import { createCtaContent } from './elements/cta'
import { createChoiceContent } from './elements/choice'
import { localize } from './i18n'
import { createEndsceneContent, updateEndsceneMedia } from './elements/endscene'
import { computeDeadline, formatCountdown, needsTicker } from './elements/countdown'
import { createGameHost, type GameHost } from './gameHost'
import { emit } from './emitter'

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
function startHandguide(rec: Rec, recs: Rec[]): { stop(): void } {
  const cfg = rec.el.handguide ?? { mode: 'smart' as const }
  const content = rec.content
  const sx = rec.el.x
  const sy = rec.el.y
  // Waypoints (design px). 'slide' uses the configured nodes (or legacy toX/toY);
  // 'smart' targets the CTA/game; 'tap' stays in place (no waypoints).
  let pts: { x: number; y: number; pauseMs?: number }[] = []
  let kind: 'tap' | 'slide' = 'tap'
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
  }
  const travel = cfg.periodMs && cfg.periodMs > 0 ? cfg.periodMs : kind === 'slide' ? 1500 : 900
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
  let active = true
  const t0 = performance.now()
  if (content) content.style.transformOrigin = '22% 12%'
  const frame = (now: number): void => {
    if (!active || !content) return
    const s = scale()
    let ox = 0
    let oy = 0
    let press = 0
    if (kind === 'slide') {
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
  raf = requestAnimationFrame(frame)
  return {
    stop() {
      active = false
      if (raf) cancelAnimationFrame(raf)
      if (content) content.style.transform = ''
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
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;}
.pa-root{position:absolute;inset:0;overflow:hidden;isolation:isolate;
  font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
.pa-el{position:absolute;left:0;top:0;transform-origin:center center;}
.pa-el-anim{width:100%;height:100%;}
.pa-img{display:block;width:100%;height:100%;pointer-events:none;user-select:none;-webkit-user-drag:none;}
.pa-bar{width:100%;height:100%;}
.pa-cta{display:block;width:100%;height:100%;padding:0;margin:0;border:0;background:transparent;cursor:pointer;
  -webkit-tap-highlight-color:transparent;}
.pa-choice{display:block;width:100%;height:100%;padding:0;margin:0;border:0;background:transparent;cursor:pointer;
  -webkit-tap-highlight-color:transparent;transition:background .12s ease,transform .12s ease,box-shadow .12s ease;}
.pa-choice:active{transform:scale(.985);}
.pa-choice-sel{box-shadow:0 0 0 3px rgba(124,58,237,.45);}
.pa-textbox{margin:0;display:inline-block;box-sizing:border-box;}
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
// Build.
// ---------------------------------------------------------------------------
export function buildScene(scene: Scene, assets: AssetMap, opts: BuildOptions = {}): StageHandle {
  injectBaseStyles()
  injectAnimStyles()

  const mount = opts.mount ?? document.body

  const root = document.createElement('div')
  root.className = 'pa-root'
  if (scene.meta.bgMatchColor) root.style.background = scene.meta.bgMatchColor

  const ctx: RuntimeCtx = {
    scene,
    assets,
    src: (id?: string) => (id && assets[id] ? assets[id].src : ''),
    asset: (id?: string): AssetEntry | undefined => (id ? assets[id] : undefined),
    emit: (event: string, ...args: unknown[]) => emit(event, ...args), // → emitter (SFX etc.)
  }

  const recs: Rec[] = []
  const byId = new Map<string, Rec>()
  let sfxWired = false // element tap/scene-enter sounds attached once
  let choicesWired = false // quiz/survey choice taps attached once

  const ordered = [...scene.elements].sort((a, b) => a.zIndex - b.zIndex)
  for (const el of ordered) {
    const outer = document.createElement('div')
    outer.className = 'pa-el'
    outer.dataset.id = el.id

    const anim = document.createElement('div')
    anim.className = 'pa-el-anim'
    outer.appendChild(anim)

    const content = mountContent(el, anim, ctx)

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

  const revealOnWin = (): void => {
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
            sfx: (event) => emit('sfx', event),
            onComplete: revealOnWin,
          })
        } else if (rec.el.type === 'handguide' && interactive && !rec.hg && rec.content) {
          rec.hg = startHandguide(rec, recs)
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
      // element-level sounds (interactive only): fire scene-enter once now; tap
      // sounds are hit-tested at the root so they never block the game/CTA beneath.
      if (interactive && !sfxWired) {
        sfxWired = true
        for (const rec of recs)
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
        // a game's template/params change requires a full re-mount
        if (nel.type === 'game-mount' && JSON.stringify(nel.game) !== JSON.stringify(rec.el.game)) return false
        // an endscene's media/fit/bg change needs a fresh build (new <video>/<img>)
        if (nel.type === 'endscene' && JSON.stringify(nel.endscene) !== JSON.stringify(rec.el.endscene)) return false
      }
      ctx.assets = nextAssets
      // re-apply the scene background (set at build time) so background edits are live
      root.style.background = nextScene.meta.bgMatchColor ?? ''
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
    case 'countdown': {
      // rendered like text (styled via el.text); the ticker sets the value
      const c = createTextContent(el)
      anim.style.display = 'inline-block'
      anim.style.width = 'auto'
      anim.style.height = 'auto'
      anim.appendChild(c)
      return c
    }
    default: {
      // image / handguide
      if (!el.assetId) return null
      const c = createImageContent(el, ctx)
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

  outer.style.zIndex = String(e.zIndex)
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

  switch (rec.el.type) {
    case 'background':
      layoutBackground(outer)
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
      return
    case 'endscene':
      layoutEndscene(rec, e)
      return
    default:
      layoutAsset(rec, e, e.mode === 'extend' ? 'extend' : 'fit')
      if ((rec.el.type === 'cta' || rec.el.type === 'choice') && rec.content) styleCta(rec.content, rec.el, scale())
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
    // A bar fills the FULL viewport WIDTH via CSS (left:0; width:100% of the
    // fixed-inset #pa-root) — bulletproof, no dependency on a JS-measured width.
    // Vertically it has a natural design rect whose HEIGHT tracks the FIT scale
    // (so it stays proportional, never balloons). The bar art stretches to fill
    // (author bands to be stretchable; put logos/text as separate FIT elements).
    // Height comes from an explicit design `h` (colour bars / rectangles) or the
    // asset's intrinsic height.
    const h = (e.h != null ? e.h : a.h * e.scale) * s
    const ay = ANCHOR[e.anchor][1] // 0 top, -50 center, -100 bottom (%)
    const naturalTop = sy(e.y) + (ay / 100) * h // screen-px top of the design rect
    outer.style.left = '0'
    outer.style.width = '100%'
    outer.style.transform = e.rotation ? `rotate(${e.rotation}deg)` : 'none'

    // Pin EXTENDS the band across the letterbox gap to the true screen edge,
    // keeping the band's near edge at its design position so FIT content placed
    // on the bar (logo/text) stays attached. Without pin it tracks the design
    // layout exactly (same offset as FIT content).
    const pin = rec.el.pin
    if (pin === 'top') {
      // grow upward to the screen top; bottom edge stays at the design bottom.
      outer.style.top = '0'
      outer.style.height = Math.max(0, naturalTop + h) + 'px'
    } else if (pin === 'bottom') {
      // grow downward to the screen bottom; top edge stays at the design top.
      outer.style.top = round(naturalTop) + 'px'
      outer.style.height = Math.max(0, viewH() - naturalTop) + 'px'
    } else {
      outer.style.top = round(naturalTop) + 'px'
      outer.style.height = h + 'px'
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

  const outer = rec.outer
  outer.style.left = round(sx(e.x)) + 'px'
  outer.style.top = round(sy(e.y)) + 'px'
  outer.style.width = ''
  outer.style.height = ''
  const [tx, ty] = ANCHOR[e.anchor]
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

// Background always covers the full viewport (the "landscape = portrait bg made
// to fit the whole screen" model). object-fit set at mount time.
function layoutBackground(outer: HTMLDivElement): void {
  outer.style.left = '0'
  outer.style.top = '0'
  outer.style.width = '100%'
  outer.style.height = '100%'
  outer.style.transform = 'none'
}

// Endscene: 'extend' fills the whole viewport (the usual full-bleed endscene
// video); 'fit' uses the element's design box (a framed clip). Either way the
// inner <video>/<img> handles cover/contain itself; we just pick the orientation
// source here so a rotation swaps the clip without a rebuild.
function layoutEndscene(rec: Rec, e: Effective): void {
  const outer = rec.outer
  if (e.mode === 'extend') {
    outer.style.left = '0'
    outer.style.top = '0'
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
