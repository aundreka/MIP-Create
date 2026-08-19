// Scene manager — plays a Project's flow: renders the start scene, arms its
// advance trigger (game won / timer / tap / manual), and transitions to the
// target scene (fade / slide) when triggered. Endscene-style scenes use
// advance.on='manual' so they just sit and loop. Used by preview + export; the
// editor canvas renders a single scene directly (no flow).

import { emit, on } from './emitter'
import { buildScene, type StageHandle } from './stage'
import { notifyGameClose, notifyGameEnd, triggerCTA } from './networks'
import { createSfxManager, type SfxManager } from './sfx'
import { mountHeader } from './header'
import { preloadScratchCover } from './games/scratch'
import { followLoopCss } from './anim'
import { localizeHeader, localizeSceneDef } from './i18n'
import type { Project, Scene, SceneDef, SceneElement, Transition } from './scene'
import type { AssetMap } from './types'

export interface SceneManager {
  relayout(): void
  /** Rebuild the current screen after navigator.language changes. */
  refreshLocale(): void
  destroy(): void
}

const SLIDE: Record<string, [string, string]> = {
  'slide-left': ['translateX(100%)', 'translateX(-28%)'],
  'slide-right': ['translateX(-100%)', 'translateX(28%)'],
  'slide-up': ['translateY(100%)', 'translateY(-28%)'],
  'slide-down': ['translateY(-100%)', 'translateY(28%)'],
}

function applyTransition(oldRoot: HTMLElement, newRoot: HTMLElement, t: Transition, done: () => void): void {
  if (t.type === 'none' || t.durationMs <= 0) {
    done()
    return
  }
  const dur = t.durationMs
  oldRoot.style.zIndex = '1'
  newRoot.style.zIndex = '2'
  if (t.type === 'fade') {
    newRoot.style.opacity = '0'
    newRoot.style.transition = `opacity ${dur}ms ease`
    requestAnimationFrame(() => requestAnimationFrame(() => (newRoot.style.opacity = '1')))
  } else {
    const [fromNew, toOld] = SLIDE[t.type] ?? SLIDE['slide-left']
    newRoot.style.transform = fromNew
    newRoot.style.transition = `transform ${dur}ms cubic-bezier(.4,0,.2,1)`
    oldRoot.style.transition = `transform ${dur}ms cubic-bezier(.4,0,.2,1)`
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        newRoot.style.transform = 'translate(0,0)'
        oldRoot.style.transform = toOld
      }),
    )
  }
  window.setTimeout(() => {
    newRoot.style.transition = ''
    newRoot.style.transform = ''
    newRoot.style.opacity = ''
    done()
  }, dur + 40)
}

// A tap on the CTA is a click-OUT, never a scene interaction: the CTA's own handler
// already fires triggerCTA(). So a scene whose advance rule is "on tap" — and a coded
// end card's tap-to-install surface — must ignore pointer events that started on it,
// or tapping the CTA would ALSO advance the flow underneath the store opening.
function fromCta(ev: Event): boolean {
  const t = ev.target as Element | null
  return !!(t && typeof t.closest === 'function' && t.closest('.pa-cta'))
}

export function playProject(
  project: Project,
  assets: AssetMap,
  opts: { mount: HTMLElement; interactive: boolean; startSceneId?: string },
): SceneManager {
  const container = document.createElement('div')
  container.className = 'pa-stage'
  // overflow:clip (progressive enhancement over overflow:hidden) is NOT a scroll
  // container, so Chrome's compositor does not apply a scroll-container clip to
  // GPU-promoted position:fixed children — preventing the 1px compositor edge
  // artifact when immune elements (translateZ bars) live directly in pa-stage.
  // Falls back to overflow:hidden on WebViews that predate overflow:clip support.
  container.style.cssText = 'position:fixed;inset:0;overflow:hidden;overflow:clip;'
  // Text elements are pointer-events:none, so drags over them land on the scene
  // ROOT — which used to fire an unprevented selectstart: the browser entered
  // selection mode and painted a "whole screen selected" highlight while players
  // scratched/dragged. The base CSS sets user-select:none everywhere; this guard
  // covers engines/old WebViews that ignore user-select on plain divs.
  container.addEventListener('selectstart', (e) => e.preventDefault())
  opts.mount.appendChild(container)

  // Decode every scratch cover up front so the card paints its cover on the first frame it
  // mounts — no transparent gap where the reveal/background flashes through (a scratch scene
  // is usually reached mid-flow, so there's ample time to decode before the player gets there).
  if (opts.interactive) {
    for (const base of project.scenes) {
      const s = localizeSceneDef(base)
      for (const e of s.elements)
        if (e.type === 'game-mount' && e.game?.templateId === 'scratch') {
          const coverId = e.game.params?.cover
          const src = typeof coverId === 'string' ? assets[coverId]?.src : ''
          if (src) preloadScratchCover(src)
        }
    }
  }

  // The pinned date header is opt-in: only mount it when the project explicitly
  // configures `meta.header`. Projects without it export with no date band.
  const headerConfig = () => localizeHeader(project.meta)
  let header = headerConfig() ? mountHeader(container, headerConfig()!) : null
  const refreshHeader = (): void => {
    header?.destroy()
    const config = headerConfig()
    header = config ? mountHeader(container, config) : null
  }

  const sfx: SfxManager | null = opts.interactive ? createSfxManager(project, assets, container) : null

  let current: { def: SceneDef; stage: StageHandle } | null = null
  let transitioning = false
  let advanceTimer = 0
  let tapHandler: ((ev: Event) => void) | null = null
  let unsubGameDone: (() => void) | null = null
  let unsubAdvance: (() => void) | null = null
  let unsubGoto: (() => void) | null = null
  let unsubWinRoute: (() => void) | null = null
  let unsubWinPersist: (() => void) | null = null
  let unsubOverlay: (() => void) | null = null
  // True once the (current) game has been completed. From that point the flow is
  // post-win (win overlay / next scene / end card) and a reload must RESTART the ad,
  // not resume — so the resume record stays cleared until another game scene mounts.
  let gameWon = false
  // The header belongs to the first scene in this play-through where it is allowed
  // to appear. Only that scene's game win freezes its countdown; later games cannot
  // change the already-finalized urgency value.
  let headerGameWinSceneId: string | null = null
  // Does this scene contain something winnable? (game mount, unboxing, or scratch/reveal
  // cells — everything that can emit 'game-complete'.) Mounting one re-arms resume.
  const hasGame = (def: SceneDef): boolean =>
    def.elements.some((e) => e.type === 'game-mount' || e.type === 'unboxing' || !!e.scratch || !!e.reveal)
  // Set to true once THIS scene's game-win advance has already floated its target overlay.
  // Prevents duplicate win overlays if 'game-complete' fires again after the overlay dismisses.
  // Plain overlays shown during the same game scene (for example scratch-grid lose feedback)
  // must NOT flip this on, or a later real win would skip its authored overlay.
  let overlayShownThisScene = false
  // Some games choose the destination scene at the moment the player wins (e.g. a per-cell
  // scratch-grid win scene). Store that choice here so the ordinary scene-level
  // "Advance on game won" rule can still apply its authored delay before leaving.
  let pendingWinSceneId: string | null = null
  // Active floating overlay stages (win/lose scenes shown over the running game). Tracked so
  // relayout() re-lays them out on resize / zoom / orientation — otherwise an overlay keeps the
  // metrics it was mounted with and drifts (e.g. the badge shrinks + slides toward a corner when
  // AppLovin's WebView settles from its initial size to true landscape AFTER the overlay is up).
  const overlayStages = new Set<StageHandle>()
  // Static cover divs sit behind each floated immune bar (AppLovin edge-artifact guard). They
  // capture the bar's geometry at overlay-open, so relayout() must re-sync them to the bar on
  // resize — otherwise the bar re-lays out but its backing rectangle keeps the mount-time size
  // and the header background appears mis-sized.
  const overlayCovers = new Set<{ cover: HTMLElement; el: HTMLElement }>()
  // Background-image gap covers: cloned <img>s in pa-stage that continue the scene's
  // background art past the CSS viewport (see parkImmune). The clone must track the
  // real img's fit / focus / zoom, which layoutBackground rewrites per orientation.
  const bgCovers = new Set<{ img: HTMLImageElement; src: HTMLImageElement }>()
  // Re-copy each cover's geometry/background from its bar. Runs on relayout (resize),
  // shortly after park (the bar's sampled image-edge color lands async, after the art
  // decodes — the cover must not keep the bar.color fallback captured at mount), and
  // at overlay-open.
  const syncCovers = (): void => {
    for (const { cover, el } of overlayCovers) {
      cover.style.top = el.style.top
      cover.style.left = el.style.left
      cover.style.width = el.style.width
      cover.style.height = el.style.height
      cover.style.background = el.style.background
    }
    for (const { img, src } of bgCovers) {
      img.style.objectFit = src.style.objectFit
      img.style.objectPosition = src.style.objectPosition
      img.style.transformOrigin = src.style.transformOrigin
      img.style.transform = src.style.transform
      if (img.src !== src.src) img.src = src.src // asset swapped (editor live-edit)
    }
  }
  // Immune elements are parked OUT of their scene's pa-root into pa-stage for the
  // scene's WHOLE life, not just while an overlay is up. Inside pa-root a
  // top-extended bar needs translateZ(0) to escape the root's overflow clip on
  // AppLovin, but that GPU promotion makes AppLovin's compositor blend the
  // promoted layer's clipped edge against whatever sits behind it — a visible
  // tinted strip along the bar's top/left even in the plain game scene. Parked
  // directly in pa-stage (overflow:clip — not a scroll container, see above) the
  // bar renders un-promoted with a sharp paint clip: the state overlays always
  // used, which is confirmed artifact-free on AppLovin. relayout() still reaches
  // parked elements via current.stage.layoutAll(); applyBarExtend's inImmune
  // guard keeps translateZ off while parked.
  const parkedByStage = new Map<StageHandle, {
    els: HTMLElement[]
    covers: { cover: HTMLElement; el: HTMLElement }[]
    bgPairs: { cover: HTMLElement; img: HTMLImageElement; src: HTMLImageElement }[]
  }>()
  const parkImmune = (stage: StageHandle): void => {
    const els = Array.from(stage.root.querySelectorAll<HTMLElement>('.pa-el--immune'))
    els.forEach((el) => {
      container.appendChild(el)
      el.style.zIndex = el.classList.contains('pa-el--immune-top') ? '10050' : '10000'
      // Strip the GPU promotion the initial in-root layout pass applied. Reading
      // style.transform returns the CSSOM-serialized value ("translateZ(0px)").
      el.style.transform = el.style.transform.replace(/\s*translateZ\(0(?:px)?\)/gi, '').trim() || 'none'
    })
    // Backing cover per fixed (edge-hugging) element, alive as long as the parking.
    // Two jobs, both compositor-related: (1) it is PROMOTED (translateZ), so unlike
    // un-promoted paint it reaches past the CSS viewport into the 1-3px physical gap
    // AppLovin leaves at the screen edges — the gap reads as bar color (the faint
    // "blue vignette") instead of body bg; (2) anything that forces the bar above it
    // into an implicit compositor layer (e.g. an overlay's backdropFilter) now has the
    // bar's layer edge anti-alias against SAME-COLORED cover instead of whatever is
    // underneath. Geometry/background re-sync on relayout via overlayCovers.
    const covers: { cover: HTMLElement; el: HTMLElement }[] = []
    els.forEach((el) => {
      if (el.style.position !== 'fixed') return
      const cover = document.createElement('div')
      cover.style.cssText =
        `position:fixed;top:${el.style.top};left:${el.style.left};` +
        `width:${el.style.width};height:${el.style.height};` +
        `background:${el.style.background};z-index:9500;pointer-events:none;` +
        `transform:translateZ(0);`
      container.appendChild(cover)
      const pair = { cover, el }
      covers.push(pair)
      overlayCovers.add(pair)
    })
    // Background images get the same physical-gap treatment as the bar: a promoted
    // (translateZ) cover in pa-stage extending 6px past the CSS viewport on ALL sides
    // continues the IMAGE into AppLovin's 1-3px edge gap — pa-bleed only fills the gap
    // with the scene COLOR, which reads as a tinted strip against a photo background.
    // The cover sits at z:0, above pa-bleed (later in DOM) but below every scene root
    // (z:1+), so inside the viewport it is fully hidden by the opaque root; only the
    // gap ever shows it. The clone renders the same art in a box 12px larger (~3%
    // zoom), which is indistinguishable at the screen edge.
    const bgPairs: { cover: HTMLElement; img: HTMLImageElement; src: HTMLImageElement }[] = []
    stage.root.querySelectorAll<HTMLImageElement>('.pa-el--background img').forEach((src) => {
      const cover = document.createElement('div')
      cover.style.cssText =
        'position:fixed;top:-6px;left:-6px;width:calc(100% + 12px);height:calc(100% + 12px);' +
        'z-index:0;overflow:hidden;pointer-events:none;transform:translateZ(0);'
      const img = src.cloneNode(false) as HTMLImageElement
      img.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;'
      cover.appendChild(img)
      container.appendChild(cover)
      const pair = { cover, img, src }
      bgPairs.push(pair)
      bgCovers.add(pair)
    })
    if (els.length || bgPairs.length) {
      parkedByStage.set(stage, { els, covers, bgPairs })
      syncCovers() // copy the img fit/focus/zoom (and bar geometry) captured by layoutAll
      // One-shot delayed syncs pick up the async sampled edge color (see syncCovers).
      if (covers.length) {
        window.setTimeout(syncCovers, 250)
        window.setTimeout(syncCovers, 1200)
      }
    }
  }
  // Move a stage's parked elements back inside its root so they fade/slide out
  // WITH the scene (and are torn down by the root's destroy), then forget them.
  const unparkInto = (stage: StageHandle): void => {
    const parked = parkedByStage.get(stage)
    if (parked) {
      parked.els.forEach((el) => stage.root.appendChild(el))
      parked.covers.forEach((p) => { overlayCovers.delete(p); p.cover.remove() })
      parked.bgPairs.forEach((p) => { bgCovers.delete(p); p.cover.remove() })
      parkedByStage.delete(stage)
    }
  }

  // ---- carry-over layer ----------------------------------------------------
  // Elements flagged `persist` (typically the CTA) are built ONCE into their own
  // stage above every scene root, instead of once per scene. A transition then
  // never tears them down: the CTA's pulse keeps its phase across the cut and the
  // fade/slide moves only the scene behind it. They are stripped from the scene
  // defs (see toScene / the overlay path) so nothing renders twice.
  //
  // z 12000 puts the layer above both immune tiers (10000 / 10050) AND above the
  // redirect cover (11000) that coverRedirect fades the destination scene in at —
  // so even a win-overlay → end-card redirect plays out underneath a CTA that
  // never blinks.
  const persistDefs: SceneElement[] = []
  {
    const seen = new Set<string>()
    for (const s of project.scenes)
      for (const e of s.elements) {
        if (!e.persist) continue
        const key = e.sync?.key ?? e.id // copies of one synced element are ONE carry-over
        if (seen.has(key)) continue
        seen.add(key)
        persistDefs.push(e)
      }
  }
  const stripPersist = (els: SceneElement[]): SceneElement[] =>
    persistDefs.length ? els.filter((e) => !e.persist) : els

  let persistLayer: HTMLDivElement | null = null
  let persistStage: StageHandle | null = null
  // Which carry-over elements take taps. Only interactive ones (anything wrapping a
  // <button> — the CTA) do; static art stays click-through so the scene beneath still
  // receives the tap that advances it.
  const persistTappable = new Map<string, boolean>()
  const persistHidden = new Set<string>()
  // The opacity layoutRec computed for each carry-over element (locale / orientation
  // overrides included), captured right after a layout pass — the value a fade-in
  // must return to. Ours is written over it, so it can only be read before we do.
  const persistOpacity = new Map<string, string>()
  const showsOn = (el: SceneElement, sceneId: string): boolean =>
    !el.persistScenes?.length || el.persistScenes.includes(sceneId)
  // Re-lay out the layer and re-impose the carry-over state: layoutRec rewrites outer
  // opacity from the element, undoing an in-progress fade-out on every resize.
  const layoutPersist = (): void => {
    if (!persistStage) return
    persistStage.layoutAll()
    for (const el of persistDefs) {
      const rec = persistStage.get(el.id)
      if (rec) persistOpacity.set(el.id, rec.outer.style.opacity)
    }
    applyPersistVis()
  }
  const applyPersistVis = (): void => {
    if (!persistStage) return
    for (const el of persistDefs) {
      const rec = persistStage.get(el.id)
      if (!rec) continue
      const off = persistHidden.has(el.id)
      rec.outer.style.transition = 'opacity 220ms ease'
      rec.outer.style.opacity = off ? '0' : persistOpacity.get(el.id) ?? ''
      rec.outer.style.pointerEvents = off || !persistTappable.get(el.id) ? 'none' : 'auto'
    }
  }
  const syncPersist = (sceneId: string): void => {
    if (!persistStage) return
    persistHidden.clear()
    for (const el of persistDefs) if (!showsOn(el, sceneId)) persistHidden.add(el.id)
    applyPersistVis()
  }
  const buildPersist = (): void => {
    if (!persistDefs.length) return
    persistLayer = document.createElement('div')
    persistLayer.style.cssText = 'position:absolute;inset:0;z-index:12000;pointer-events:none;'
    container.appendChild(persistLayer)
    // float:true keeps the stage's pa-root transparent and skips the bleed div (the
    // scene below owns the background). buildScene localizes the elements itself.
    persistStage = buildScene({ meta: project.meta, elements: persistDefs }, assets, { mount: persistLayer, float: true })
    for (const el of persistDefs) {
      const rec = persistStage.get(el.id)
      if (rec) persistTappable.set(el.id, !!rec.outer.querySelector('button'))
    }
    layoutPersist()
    // Wires the same per-element behaviour a scene would give them: tap animations,
    // element SFX, idle show/hide. (There are no games up here.)
    persistStage.startGames(opts.interactive)
    if (opts.interactive) persistStage.playEntrances()
  }
  const destroyPersist = (): void => {
    persistStage?.destroy()
    persistLayer?.remove()
    persistStage = null
    persistLayer = null
    persistTappable.clear()
    persistHidden.clear()
    persistOpacity.clear()
  }

  const toScene = (def: SceneDef): Scene => ({
    meta: { ...project.meta, bgMatchColor: def.bgColor ?? project.meta.bgMatchColor },
    elements: stripPersist(def.elements),
    kind: def.kind,
    overlay: def.overlay,
    timelineMs: def.timelineMs,
  })

  const nextId = (def: SceneDef): string | null => {
    if (def.advance.to) return def.advance.to
    const i = project.scenes.findIndex((s) => s.id === def.id)
    return project.scenes[i + 1]?.id ?? null
  }

  const afterOverlay = (ov: SceneDef): string | null => (isEndscene(ov) ? null : nextId(ov))

  const clearTriggers = (): void => {
    window.clearTimeout(advanceTimer)
    if (tapHandler) {
      container.removeEventListener('pointerdown', tapHandler)
      tapHandler = null
    }
    if (unsubGameDone) { unsubGameDone(); unsubGameDone = null }
    if (unsubAdvance) { unsubAdvance(); unsubAdvance = null }
  }

  // Does this scene act as the end card? Either a real endscene, or an overlay scene opted
  // into asEndscene — an end card that stays floated over the finished game instead of
  // cutting to a full-screen scene. Both get the MRAID wrap; both are terminal.
  const isEndscene = (def: SceneDef): boolean =>
    def.kind === 'endscene' || (def.kind === 'overlay' && def.asEndscene === true)

  // Per-scene header visibility: scenes flagged hideHeader suppress the pinned date band while
  // they're current. End cards hide it by default (an end card usually carries no date/countdown
  // urgency) unless they opt back in with showHeader; hideHeader still wins over that opt-in.
  const headerAllowed = (def: SceneDef): boolean =>
    !def.hideHeader && (!isEndscene(def) || def.showHeader === true)

  // meta.header.loopFollowsCta: the band beats with the CTA button of whatever scene is on
  // screen. Copy that element's loop (its pulse, or an explicit loop spec) and hand it to the
  // header at mount time, so both animations start on the same frame and stay in phase.
  // Scenes without a CTA pass null — the header falls back to its own authored loop.
  const syncHeaderCta = (def: SceneDef): void => {
    if (!header) return
    const cta = def.elements.find((e) => e.type === 'cta' && !e.hidden)
    header.followCta(cta ? followLoopCss(cta, opts.interactive) || null : null)
  }

  // A reload must never drop the player back onto a finished play-through.
  const clearResume = (): void => {
    try { window.sessionStorage.removeItem('pa:resume-scene') } catch { /* storage unavailable */ }
  }

  // Wrap a scene as an MRAID end card: tell the network the ad ended, and make `surface`
  // tap-to-install. A scene carrying an 'endscene' ELEMENT wires its own tap (the video
  // card handles it), so only a CODED end card gets the blanket handler.
  const armEndcard = (def: SceneDef, surface: HTMLElement): void => {
    emit('sfx', 'endscene')
    notifyGameEnd()
    if (def.elements.some((e) => e.type === 'endscene')) return
    surface.style.cursor = 'pointer'
    surface.addEventListener('pointerdown', (ev) => {
      if (fromCta(ev)) return // the CTA button fires its own click-out — don't double-trigger
      emit('sfx', 'ctaClick')
      notifyGameClose()
      triggerCTA()
    })
  }

  const mountScene = (def: SceneDef): StageHandle => {
    const displayDef = localizeSceneDef(def)
    const showsHeader = headerAllowed(displayDef)
    if (header && showsHeader && headerGameWinSceneId == null) headerGameWinSceneId = def.id
    header?.setVisible(showsHeader)
    const stage = buildScene(toScene(displayDef), assets, { mount: container })
    stage.layoutAll()
    parkImmune(stage)
    syncPersist(def.id) // carry-over elements follow the destination scene's allow-list
    stage.startGames(opts.interactive)
    if (opts.interactive) {
      // Remember where the player is: some containers (AppLovin) RELOAD the page
      // on orientation change. boot() re-enters this scene within a short TTL so
      // rotating doesn't restart the ad from the first scene.
      //
      // BUT the terminal end card must never be resumed: once the player reaches it,
      // any reload (a manual refresh, or AppLovin reopening the creative after the
      // player taps Exit) should start the ad over — not drop straight back onto the
      // end card. So entering an end card CLEARS the resume record instead of saving it.
      // The same applies to every scene AFTER a game win (win overlay redirect target,
      // "next" scene, …): the play-through is over, so a reload restarts the flow.
      // A scene that carries its own game re-arms resume (multi-game flows).
      if (hasGame(displayDef)) gameWon = false
      try {
        if (isEndscene(displayDef) || gameWon) {
          window.sessionStorage.removeItem('pa:resume-scene')
        } else {
          // Record the orientation too: resume is meant ONLY for AppLovin's reload-on-
          // orientation-change. boot() resumes solely when the orientation differs from
          // this record — so a plain refresh (same orientation) restarts the flow.
          const o = window.innerWidth >= window.innerHeight ? 'l' : 'p'
          window.sessionStorage.setItem('pa:resume-scene', JSON.stringify({ id: def.id, t: Date.now(), o }))
        }
      } catch { /* storage unavailable — rotation reloads restart the flow */ }
      stage.playEntrances() // onMount entrances (skipped on the static editor canvas)
      // An overlay+asEndscene scene normally reaches the player floated (see 'scene-overlay'),
      // but it can also be mounted outright — as the start scene, or as a plain transition
      // target — and it must still be an end card when it does.
      if (isEndscene(displayDef)) armEndcard(displayDef, stage.root)
    }
    syncHeaderCta(displayDef)
    return stage
  }

  const armAdvance = (def: SceneDef): void => {
    clearTriggers()
    overlayShownThisScene = false // reset per-scene flag
    pendingWinSceneId = null
    if (!opts.interactive) return
    const rule = def.advance
    const go = (): void => {
      const nid = pendingWinSceneId ?? nextId(def)
      pendingWinSceneId = null
      if (!nid) return
      const nextDef = project.scenes.find((s) => s.id === nid)
      if (nextDef?.kind === 'overlay' && !overlayShownThisScene) {
        const afterId = afterOverlay(nextDef)
        overlayShownThisScene = true
        // Float overlay scene on top of the running game so the dim is visible over game content.
        emit('scene-overlay', {
          sceneId: nid,
          // When the overlay continues to an endscene/next scene, keep it visible until
          // the destination has faded fully over it. This avoids a one-frame flash back
          // to the game between the win overlay and end card.
          ...(afterId ? { redirectTo: afterId } : {}),
        })
      } else if (nextDef?.kind === 'overlay' && overlayShownThisScene) {
        // Game (e.g. scratch_grid) already showed the overlay via scene-overlay; skip past it.
        const afterId = afterOverlay(nextDef)
        if (afterId) transitionTo(afterId)
      } else {
        transitionTo(nid)
      }
    }
    // A quiz/survey "Continue" choice requests advance regardless of the rule.
    // One-shot so rapid double-taps can't schedule two transitions.
    unsubAdvance = on('pa-advance', () => {
      if (unsubAdvance) {
        unsubAdvance()
        unsubAdvance = null
      }
      advanceTimer = window.setTimeout(go, rule.delayMs ?? 0)
    })
    if (rule.on === 'gameWin') {
      // One-shot: some games emit 'game-complete' more than once (central revealOnWin
      // + a per-game win check). Without this the end scene would mount twice and its
      // entrance animation would play twice.
      unsubGameDone = on('game-complete', () => {
        if (unsubGameDone) {
          unsubGameDone()
          unsubGameDone = null
        }
        advanceTimer = window.setTimeout(go, rule.delayMs ?? 0)
      })
    } else if (rule.on === 'timer') {
      advanceTimer = window.setTimeout(go, rule.delayMs ?? 2000)
    } else if (rule.on === 'tap') {
      tapHandler = (ev) => {
        if (fromCta(ev)) return // the CTA clicks out; it never counts as the scene's tap
        advanceTimer = window.setTimeout(go, rule.delayMs ?? 0)
      }
      container.addEventListener('pointerdown', tapHandler)
    }
  }

  const transitionTo = (id: string): void => {
    const def = project.scenes.find((s) => s.id === id)
    if (!def || !current || transitioning) return // guard re-entrancy (double-tap / double win)
    transitioning = true
    clearTriggers()
    const old = current
    old.stage.playExit() // exit animations play as the scene leaves
    unparkInto(old.stage) // parked header leaves with the old scene, not on top of the new one
    const stage = mountScene(def)
    current = { def, stage }
    applyTransition(old.stage.root, stage.root, def.transition ?? { type: 'fade', durationMs: 350 }, () => {
      old.stage.destroy()
      transitioning = false
    })
    armAdvance(def)
  }

  const navigateTo = (id: string): void => {
    if (transitioning) return
    const target = project.scenes.find((s) => s.id === id)
    if (target?.kind === 'overlay' && current) {
      const after = afterOverlay(target)
      emit('scene-overlay', { sceneId: id, redirectTo: after ?? undefined })
    } else {
      transitionTo(id)
    }
  }

  // Game-driven navigation (e.g. scratch-grid lose cell → lose scene, then back).
  if (opts.interactive) {
    // The moment the game is won the resume record dies: a refresh during the win
    // celebration (win overlay floating over the still-mounted game scene) must
    // restart the ad, not resume into an already-completed game. Persistent — unlike
    // armAdvance's one-shot subscription — so it fires no matter how the win happens.
    unsubWinPersist = on('game-complete', () => {
      gameWon = true
      if (current?.def.id === headerGameWinSceneId) header?.freezeCountdown()
      try { window.sessionStorage.removeItem('pa:resume-scene') } catch { /* ignore */ }
    })
    unsubWinRoute = on('scene-goto-after-win', (id: string) => {
      pendingWinSceneId = id || null
    })
    unsubGoto = on('scene-goto', (id: string) => {
      navigateTo(id)
    })

    // Overlay a project scene on top of the current game scene without a transition.
    // The game stays mounted; the overlay appears above it and dismisses itself when
    // its own advance condition fires (tap, timer, etc.).
    // Tracked so destroy() can drop it. The emitter is module-global, so a discarded
    // unsubscribe outlived the manager: a second playProject (an editor preview remount)
    // left the dead manager still listening, and one 'scene-overlay' then mounted the
    // overlay once per manager ever created — against torn-down stages.
    unsubOverlay = on('scene-overlay', ({ sceneId, onDone, redirectTo }: { sceneId: string; onDone?: () => void; redirectTo?: string }) => {
      if (!current) return
      const masterDef = project.scenes.find((s) => s.id === sceneId)
      if (!masterDef) { onDone?.(); return }
      const def = localizeSceneDef(masterDef)
      // Per-scene header hide applies to floated overlay scenes too — they never pass through
      // mountScene. Restored to the underlying scene's setting on dismiss (see restoreImmune);
      // a redirect's mountScene sets it for the destination scene.
      if (!headerAllowed(def)) header?.setVisible(false)
      else if (def.showHeader) header?.setVisible(true) // end card opted the band back in
      // An overlay opted into asEndscene is the end card itself: it floats over the finished
      // game (dim/blur showing the board through) and STAYS. Nothing dismisses it, so its
      // advance rule is ignored below.
      const terminal = isEndscene(def)
      // Redirect overlays (e.g. scratch win → end scene) leave the game for good. Suspend
      // the underlying game scene's still-armed advance NOW so ONLY this overlay scene's
      // own advance duration decides when we move on — otherwise the game's live timer/
      // tap trigger could fire first and redirect early, fighting the overlay's timing.
      // A terminal end card does the same for a blunter reason: the game's armed advance
      // must not navigate out from under it.
      if (redirectTo || terminal) clearTriggers()
      if (terminal) clearResume() // the play-through is over — a reload restarts the ad

      const gameRoot = current.stage.root
      const stageContainer = gameRoot.parentElement ?? gameRoot

      // Immune elements (header bar / logo) already live in pa-stage at z 10000/10050
      // — parked there at scene mount (see parkImmune above), un-promoted, above the
      // overlay dim (z 9000) and below a redirecting scene (raised to 11000 below).
      // Nothing to move or restore here; they stay parked across the overlay's life.
      // The z:9500 backing covers (between overlayDiv z:9000 and the bar z:10000)
      // already exist too — created at park time. They matter here doubly: when the
      // overlay scene has backdropFilter (overlay.blurPx), Chrome force-promotes the
      // bar above the promoted overlayDiv into its own compositor layer, and the
      // bar's layer edge anti-aliases against the same-colored cover instead of the
      // overlay's background.
      syncCovers()

      // Elements opted into "hide on overlay" vanish for the overlay's lifetime, then
      // restore their prior inline display on dismiss. Saved individually so an element
      // already hidden (display:none) is left hidden on restore.
      // IMMUNE elements (the CTA always, plus anything opted into overlayImmune /
      // overlayTop) are not under gameRoot at all — parkImmune moved them into the
      // stage container at mount — so they have to be collected from the park list
      // too, or "hide on overlay" would silently do nothing for exactly the elements
      // that stay on top of the overlay. Only THIS scene's parked nodes, never the
      // overlay's own.
      // Carry-over elements (persist layer) are a third home the class can live in.
      const parkedEls = parkedByStage.get(current.stage)?.els ?? []
      const hideEls = [
        ...new Set([
          ...gameRoot.querySelectorAll<HTMLElement>('.pa-el--hide-on-overlay'),
          ...parkedEls.filter((el) => el.classList.contains('pa-el--hide-on-overlay')),
          ...(persistStage?.root.querySelectorAll<HTMLElement>('.pa-el--hide-on-overlay') ?? []),
        ]),
      ]
      const savedDisplay = hideEls.map((el) => el.style.display)
      hideEls.forEach((el) => { el.style.display = 'none' })

      const overlayDiv = document.createElement('div')
      overlayDiv.style.cssText = 'position:absolute;inset:0;z-index:9000;pointer-events:all;'
      stageContainer.appendChild(overlayDiv)

      // A floated overlay scene gets the same carry-over treatment as a mounted one:
      // its own copies are stripped, and the persistent layer follows ITS allow-list
      // for as long as it is up (restored to the underlying scene on dismiss).
      syncPersist(def.id)
      const overScene: Scene = { meta: { ...project.meta, bgMatchColor: def.bgColor !== undefined ? def.bgColor : project.meta.bgMatchColor }, elements: stripPersist(def.elements), kind: def.kind, overlay: def.overlay }
      const overStage = buildScene(overScene, assets, { mount: overlayDiv, float: true })
      overStage.layoutAll()
      overStage.startGames(true)
      overStage.playEntrances()
      syncHeaderCta(def) // an end-card overlay carries its own CTA — follow THAT one
      overlayStages.add(overStage)

      // Lift the overlay scene's OWN "top layer" (overlayTop) elements OUT of overlayDiv.
      // overlayDiv is a z:9000 stacking context, so anything inside it — including overlay
      // confetti — is trapped below the game's immune header/logo that were pulled up to
      // z:10000. Re-parent those top-layer nodes into stageContainer at z:10050 so they
      // render ABOVE the immune header/logo. They stay full-screen (their .pa-el uses
      // left/top/width/height:100%), keep animating (same DOM node), and relayout() keeps
      // their z (stage.ts sets 10050 for floated overlayTop). Removed on teardown.
      const overTopEls = Array.from(overStage.root.querySelectorAll<HTMLElement>('.pa-el--immune-top'))
      overTopEls.forEach((el) => { el.style.zIndex = '10050'; stageContainer.appendChild(el) })

      let dismissed = false
      // Immune elements stay parked (see parkImmune) — only hidden elements restore.
      const restoreImmune = (): void => {
        hideEls.forEach((el, i) => { el.style.display = savedDisplay[i] })
        // Header follows whichever scene is current after the overlay closes: the game scene
        // on a plain dismiss, or the redirect destination (mountScene already set it; same value).
        if (current) header?.setVisible(headerAllowed(current.def))
        if (current) syncHeaderCta(localizeSceneDef(current.def)) // back to the underlying scene's CTA
        if (current) syncPersist(current.def.id)
      }
      const removeOverlayDom = (): void => {
        overlayStages.delete(overStage)
        overStage.destroy() // stops confetti/games; won't remove the lifted nodes (moved out of root)
        overTopEls.forEach((el) => el.remove()) // tear down the re-parented top-layer nodes
        overlayDiv.remove()
        // covers persist with the parking (removed by unparkInto / container teardown)
      }
      // Redirect path (e.g. scratch win overlay → end scene). Mount the destination scene
      // ABOVE the overlay (and the floated immune bar) and fade IT in so it covers the
      // whole win composite in one clean cross-dissolve, then tear the game + overlay down
      // behind it once it's fully opaque. (The old path faded the overlay OUT while the end
      // scene cross-faded over the GAME beneath it — the game peeked through and the
      // incoming scene looked dimmed by the lingering dim.)
      const coverRedirect = (toId: string): void => {
        const next = project.scenes.find((s) => s.id === toId)
        if (!next || !current || transitioning) { removeOverlayDom(); restoreImmune(); return }
        transitioning = true
        const old = current
        const stage = mountScene(next)
        current = { def: next, stage }
        const t = next.transition
        const dur = t && t.type === 'fade' && t.durationMs > 0 ? t.durationMs : 380
        // z above the overlay (9000) and BOTH immune tiers (10000 / overlayTop 10050) so
        // the incoming scene covers everything as it fades in; reset to normal after.
        stage.root.style.zIndex = '11000'
        stage.root.style.opacity = '0'
        stage.root.style.transition = `opacity ${dur}ms ease`
        requestAnimationFrame(() => requestAnimationFrame(() => { stage.root.style.opacity = '1' }))
        window.setTimeout(() => {
          removeOverlayDom()
          restoreImmune()
          unparkInto(old.stage) // parked header rejoins the old game root, torn down with it
          old.stage.destroy()
          stage.root.style.transition = ''
          stage.root.style.opacity = ''
          stage.root.style.zIndex = '2'
          transitioning = false
        }, dur + 40)
        armAdvance(next)
      }
      const dismiss = (): void => {
        if (dismissed) return
        dismissed = true
        if (redirectTo) { coverRedirect(redirectTo); return }
        if (onDone) {
          overlayDiv.style.transition = 'opacity 200ms ease'
          overlayDiv.style.opacity = '0'
          onDone()
          window.setTimeout(() => { removeOverlayDom(); restoreImmune() }, 250)
        } else {
          overlayDiv.style.transition = 'opacity 280ms ease'
          overlayDiv.style.opacity = '0'
          window.setTimeout(() => { removeOverlayDom(); restoreImmune() }, 300)
        }
      }

      // Terminal end card: wire the MRAID wrap onto the overlay surface and arm NOTHING
      // else. overlayDiv is pointer-events:all and spans the stage, so a tap anywhere over
      // the dim installs — while the game board stays visible underneath it.
      if (terminal) {
        armEndcard(def, overlayDiv)
        return
      }

      const rule = def.advance
      if (rule.on === 'timer') {
        window.setTimeout(dismiss, rule.delayMs ?? 2000)
      } else if (rule.on === 'tap') {
        overlayDiv.addEventListener('pointerdown', dismiss, { once: true })
      } else if (rule.on === 'gameWin') {
        const unsub = on('game-complete', () => { unsub(); dismiss() })
      }
      // 'manual' = stays until game logic dismisses it (no auto-dismiss)
    })
  }

  const startDef = project.scenes.find((s) => s.id === (opts.startSceneId ?? project.startSceneId)) ?? project.scenes[0]
  if (startDef) {
    // Built before the first scene mounts so mountScene's syncPersist has a stage to
    // talk to — the layer then outlives every scene until destroy().
    buildPersist()
    current = { def: startDef, stage: mountScene(startDef) }
    armAdvance(startDef)
  }

  return {
    relayout() {
      header?.relayout()
      current?.stage.layoutAll() // re-lays out the floated immune bars (they live in current.stage)
      layoutPersist() // the carry-over layer is responsive too (and keeps its fade state)
      for (const ov of overlayStages) ov.layoutAll() // keep floating win/lose overlays responsive
      // Re-sync each immune-bar cover to its (now re-laid-out) bar so the header backing tracks
      // the viewport on resize instead of keeping its mount-time size.
      syncCovers()
    },
    refreshLocale() {
      if (!current) return
      const def = current.def
      clearTriggers()
      for (const ov of overlayStages) ov.destroy()
      overlayStages.clear()
      unparkInto(current.stage)
      current.stage.destroy()
      refreshHeader()
      destroyPersist() // carry-over elements carry text/assets too — rebuild in the new locale
      buildPersist()
      current = { def, stage: mountScene(def) }
      armAdvance(def)
    },
    destroy() {
      clearTriggers()
      if (unsubGoto) { unsubGoto(); unsubGoto = null }
      if (unsubWinRoute) { unsubWinRoute(); unsubWinRoute = null }
      if (unsubWinPersist) { unsubWinPersist(); unsubWinPersist = null }
      if (unsubOverlay) { unsubOverlay(); unsubOverlay = null }
      for (const ov of overlayStages) ov.destroy()
      overlayStages.clear()
      overlayCovers.clear() // cover divs are torn down with the container below
      destroyPersist()
      sfx?.destroy()
      header?.destroy()
      current?.stage.destroy()
      container.remove()
    },
  }
}
