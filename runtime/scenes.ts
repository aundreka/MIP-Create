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
import type { Project, Scene, SceneDef, Transition } from './scene'
import type { AssetMap } from './types'

export interface SceneManager {
  relayout(): void
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

export function playProject(
  project: Project,
  assets: AssetMap,
  opts: { mount: HTMLElement; interactive: boolean },
): SceneManager {
  const container = document.createElement('div')
  container.className = 'pa-stage'
  // overflow:clip (progressive enhancement over overflow:hidden) is NOT a scroll
  // container, so Chrome's compositor does not apply a scroll-container clip to
  // GPU-promoted position:fixed children — preventing the 1px compositor edge
  // artifact when immune elements (translateZ bars) live directly in pa-stage.
  // Falls back to overflow:hidden on WebViews that predate overflow:clip support.
  container.style.cssText = 'position:fixed;inset:0;overflow:hidden;overflow:clip;'
  opts.mount.appendChild(container)

  // The pinned date header is opt-in: only mount it when the project explicitly
  // configures `meta.header`. Projects without it export with no date band.
  const header = project.meta.header ? mountHeader(container, project.meta.header) : null

  const sfx: SfxManager | null = opts.interactive ? createSfxManager(project, assets, container) : null

  let current: { def: SceneDef; stage: StageHandle } | null = null
  let transitioning = false
  let advanceTimer = 0
  let tapHandler: (() => void) | null = null
  let unsubGameDone: (() => void) | null = null
  let unsubAdvance: (() => void) | null = null
  let unsubGoto: (() => void) | null = null
  // Set to true when a scene-overlay is emitted for the current game scene (e.g. by scratch_grid).
  // Prevents go() from emitting a second scene-overlay when game-complete fires after dismiss.
  let overlayShownThisScene = false
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

  const toScene = (def: SceneDef): Scene => ({
    meta: { ...project.meta, bgMatchColor: def.bgColor ?? project.meta.bgMatchColor },
    elements: def.elements,
    kind: def.kind,
    overlay: def.overlay,
  })

  const nextId = (def: SceneDef): string | null => {
    if (def.advance.to) return def.advance.to
    const i = project.scenes.findIndex((s) => s.id === def.id)
    return project.scenes[i + 1]?.id ?? null
  }

  const clearTriggers = (): void => {
    window.clearTimeout(advanceTimer)
    if (tapHandler) {
      container.removeEventListener('pointerdown', tapHandler)
      tapHandler = null
    }
    if (unsubGameDone) { unsubGameDone(); unsubGameDone = null }
    if (unsubAdvance) { unsubAdvance(); unsubAdvance = null }
  }

  const mountScene = (def: SceneDef): StageHandle => {
    const stage = buildScene(toScene(def), assets, { mount: container })
    stage.layoutAll()
    stage.startGames(opts.interactive)
    if (opts.interactive) {
      stage.playEntrances() // onMount entrances (skipped on the static editor canvas)
      if (def.kind === 'endscene') {
        emit('sfx', 'endscene')
        notifyGameEnd()
        // A coded end card (no full-bleed video element) is wrapped as an MRAID-style
        // click-through: tap anywhere installs, exactly like the video endcard does.
        if (!def.elements.some((e) => e.type === 'endscene')) {
          stage.root.style.cursor = 'pointer'
          stage.root.addEventListener('pointerdown', () => {
            emit('sfx', 'ctaClick')
            notifyGameClose()
            triggerCTA()
          })
        }
      }
    }
    return stage
  }

  const armAdvance = (def: SceneDef): void => {
    clearTriggers()
    overlayShownThisScene = false // reset per-scene flag
    if (!opts.interactive) return
    const rule = def.advance
    const go = (): void => {
      const nid = nextId(def)
      if (!nid) return
      const nextDef = project.scenes.find((s) => s.id === nid)
      if (nextDef?.kind === 'overlay' && !overlayShownThisScene) {
        // Float overlay scene on top of the running game so the dim is visible over game content.
        emit('scene-overlay', {
          sceneId: nid,
          onDone: () => {
            const afterId = nextId(nextDef)
            if (afterId) transitionTo(afterId)
          },
        })
      } else if (nextDef?.kind === 'overlay' && overlayShownThisScene) {
        // Game (e.g. scratch_grid) already showed the overlay via scene-overlay; skip past it.
        const afterId = nextId(nextDef)
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
        advanceTimer = window.setTimeout(go, rule.delayMs ?? 700)
      })
    } else if (rule.on === 'timer') {
      advanceTimer = window.setTimeout(go, rule.delayMs ?? 2000)
    } else if (rule.on === 'tap') {
      tapHandler = () => {
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
    const stage = mountScene(def)
    current = { def, stage }
    applyTransition(old.stage.root, stage.root, def.transition ?? { type: 'fade', durationMs: 350 }, () => {
      old.stage.destroy()
      transitioning = false
    })
    armAdvance(def)
  }

  // Game-driven navigation (e.g. scratch-grid lose cell → lose scene, then back).
  if (opts.interactive) {
    unsubGoto = on('scene-goto', (id: string) => {
      if (transitioning) return
      const target = project.scenes.find((s) => s.id === id)
      if (target?.kind === 'overlay' && current) {
        // Float an overlay-kind target over the running scene so its dim/blur shows the
        // game through (mounting it as a full scene would paint the dim over a blank
        // background — i.e. solid black). `redirectTo` carries the overlay's own next
        // scene (e.g. the end scene); from here the overlay scene's OWN advance duration
        // is the single control of when it cover-fades onward — no other timer competes.
        emit('scene-overlay', { sceneId: id, redirectTo: nextId(target) ?? undefined })
      } else {
        transitionTo(id)
      }
    })

    // Overlay a project scene on top of the current game scene without a transition.
    // The game stays mounted; the overlay appears above it and dismisses itself when
    // its own advance condition fires (tap, timer, etc.).
    on('scene-overlay', ({ sceneId, onDone, redirectTo }: { sceneId: string; onDone?: () => void; redirectTo?: string }) => {
      if (!current) return
      overlayShownThisScene = true
      const def = project.scenes.find((s) => s.id === sceneId)
      if (!def) { onDone?.(); return }
      // Redirect overlays (e.g. scratch win → end scene) leave the game for good. Suspend
      // the underlying game scene's still-armed advance NOW so ONLY this overlay scene's
      // own advance duration decides when we move on — otherwise the game's live timer/
      // tap trigger could fire first and redirect early, fighting the overlay's timing.
      if (redirectTo) clearTriggers()

      const gameRoot = current.stage.root
      const stageContainer = gameRoot.parentElement ?? gameRoot

      // Immune elements (header bar) must appear ABOVE the overlay dim.
      // pa-root has isolation:isolate which forms a stacking context at z-index:1
      // inside pa-stage — below overlayDiv at z-index:9000. Any z-index set on
      // elements inside pa-root can't escape that context. Fix: move immune elements
      // to stageContainer so they participate directly in pa-stage's stacking context.
      // applyBarExtend already made them position:fixed with bleed offsets; that layout
      // is viewport-relative and carries over unchanged when the DOM parent changes.
      const immuneEls = Array.from(gameRoot.querySelectorAll<HTMLElement>('.pa-el--immune'))
      const savedParents = immuneEls.map((el) => el.parentElement)
      const savedZ = immuneEls.map((el) => el.style.zIndex)
      const savedTransform = immuneEls.map((el) => el.style.transform)
      immuneEls.forEach((el) => {
        stageContainer.appendChild(el)
        // overlayTop elements ride a higher tier (10050) so they float above the
        // ordinary immune tier (10000). Both stay below the redirect scene (raised
        // to 11000 below) so an incoming win/end scene still fully covers them.
        el.style.zIndex = el.classList.contains('pa-el--immune-top') ? '10050' : '10000'
        // Remove translateZ(0) so the bar is no longer GPU-promoted inside pa-stage.
        // NOTE: reading style.transform back returns the CSSOM-SERIALIZED value, which
        // renders the authored translateZ(0) as "translateZ(0px)" — the regex must accept
        // the 0px form or the strip silently no-ops and the edge artifact returns.
        // A GPU-promoted fixed child inside pa-stage's scroll-container (overflow:hidden)
        // gets compositor-clipped at the viewport boundary, producing a 1px blend artifact
        // where overlay content (e.g. the endscene's beige bg) bleeds through the bar edge.
        // Non-promoted fixed elements are not subject to compositor scroll-container clips.
        const t = el.style.transform
        el.style.transform = t.replace(/\s*translateZ\(0(?:px)?\)/gi, '').trim() || 'none'
      })

      // Cover divs sit at z:9500 — between overlayDiv (z:9000) and immune bar (z:10000).
      // When the overlay scene has backdropFilter (from overlay.blurPx), Chrome GPU-promotes
      // the element behind it (game pa-root) AND forces anything above the promoted overlayDiv
      // (i.e. the immune bar at z:10000) into its own compositor layer — even after the
      // translateZ strip. The bar's compositor layer edge then anti-aliases against the
      // overlayDiv below it, picking up the overlay's background color (beige) as a 1px strip.
      // The cover has the same position/size/background as the immune bar; the bar's compositor
      // edge anti-aliases against the cover (dark navy) instead of the overlay's beige.
      const coverPairs: { cover: HTMLElement; el: HTMLElement }[] = []
      immuneEls.forEach((el) => {
        if (el.style.position !== 'fixed') return
        const cover = document.createElement('div')
        cover.style.cssText =
          `position:fixed;top:${el.style.top};left:${el.style.left};` +
          `width:${el.style.width};height:${el.style.height};` +
          `background:${el.style.background};z-index:9500;pointer-events:none;` +
          `transform:translateZ(0);`
        stageContainer.appendChild(cover)
        const pair = { cover, el }
        coverPairs.push(pair)
        overlayCovers.add(pair) // relayout() re-syncs it to the bar on resize
      })

      // Elements opted into "hide on overlay" vanish for the overlay's lifetime, then
      // restore their prior inline display on dismiss. Saved individually so an element
      // already hidden (display:none) is left hidden on restore.
      const hideEls = Array.from(gameRoot.querySelectorAll<HTMLElement>('.pa-el--hide-on-overlay'))
      const savedDisplay = hideEls.map((el) => el.style.display)
      hideEls.forEach((el) => { el.style.display = 'none' })

      const overlayDiv = document.createElement('div')
      overlayDiv.style.cssText = 'position:absolute;inset:0;z-index:9000;pointer-events:all;'
      stageContainer.appendChild(overlayDiv)

      const overScene: Scene = { meta: { ...project.meta, bgMatchColor: def.bgColor !== undefined ? def.bgColor : project.meta.bgMatchColor }, elements: def.elements, kind: def.kind, overlay: def.overlay }
      const overStage = buildScene(overScene, assets, { mount: overlayDiv, float: true })
      overStage.layoutAll()
      overStage.startGames(true)
      overStage.playEntrances()
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
      const restoreImmune = (): void => {
        immuneEls.forEach((el, i) => {
          savedParents[i]?.appendChild(el)
          el.style.zIndex = savedZ[i]
          el.style.transform = savedTransform[i]
        })
        hideEls.forEach((el, i) => { el.style.display = savedDisplay[i] })
      }
      const removeOverlayDom = (): void => {
        overlayStages.delete(overStage)
        overStage.destroy() // stops confetti/games; won't remove the lifted nodes (moved out of root)
        overTopEls.forEach((el) => el.remove()) // tear down the re-parented top-layer nodes
        overlayDiv.remove()
        coverPairs.forEach((p) => { overlayCovers.delete(p); p.cover.remove() })
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
          restoreImmune()      // immune bar returns to the old game root, torn down with it
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

  const startDef = project.scenes.find((s) => s.id === project.startSceneId) ?? project.scenes[0]
  if (startDef) {
    current = { def: startDef, stage: mountScene(startDef) }
    armAdvance(startDef)
  }

  return {
    relayout() {
      header?.relayout()
      current?.stage.layoutAll() // re-lays out the floated immune bars (they live in current.stage)
      for (const ov of overlayStages) ov.layoutAll() // keep floating win/lose overlays responsive
      // Re-sync each immune-bar cover to its (now re-laid-out) bar so the header backing tracks
      // the viewport on resize instead of keeping its mount-time size.
      for (const { cover, el } of overlayCovers) {
        cover.style.top = el.style.top
        cover.style.left = el.style.left
        cover.style.width = el.style.width
        cover.style.height = el.style.height
        cover.style.background = el.style.background
      }
    },
    destroy() {
      clearTriggers()
      if (unsubGoto) { unsubGoto(); unsubGoto = null }
      for (const ov of overlayStages) ov.destroy()
      overlayStages.clear()
      overlayCovers.clear() // cover divs are torn down with the container below
      sfx?.destroy()
      header?.destroy()
      current?.stage.destroy()
      container.remove()
    },
  }
}
