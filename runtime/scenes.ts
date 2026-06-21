// Scene manager — plays a Project's flow: renders the start scene, arms its
// advance trigger (game won / timer / tap / manual), and transitions to the
// target scene (fade / slide) when triggered. Endscene-style scenes use
// advance.on='manual' so they just sit and loop. Used by preview + export; the
// editor canvas renders a single scene directly (no flow).

import { emit, on } from './emitter'
import { buildScene, type StageHandle } from './stage'
import { createSfxManager, type SfxManager } from './sfx'
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
  container.style.cssText = 'position:fixed;inset:0;overflow:hidden;'
  opts.mount.appendChild(container)

  const sfx: SfxManager | null = opts.interactive ? createSfxManager(project, assets, container) : null

  let current: { def: SceneDef; stage: StageHandle } | null = null
  let advanceTimer = 0
  let tapHandler: (() => void) | null = null
  let unsubGameDone: (() => void) | null = null
  let unsubAdvance: (() => void) | null = null

  const toScene = (def: SceneDef): Scene => ({
    meta: { ...project.meta, bgMatchColor: def.bgColor ?? project.meta.bgMatchColor },
    elements: def.elements,
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
    if (unsubGameDone) {
      unsubGameDone()
      unsubGameDone = null
    }
    if (unsubAdvance) {
      unsubAdvance()
      unsubAdvance = null
    }
  }

  const mountScene = (def: SceneDef): StageHandle => {
    const stage = buildScene(toScene(def), assets, { mount: container })
    stage.layoutAll()
    stage.startGames(opts.interactive)
    if (opts.interactive) {
      stage.playEntrances() // onMount entrances (skipped on the static editor canvas)
      if (def.kind === 'endscene') emit('sfx', 'endscene')
    }
    return stage
  }

  const armAdvance = (def: SceneDef): void => {
    clearTriggers()
    if (!opts.interactive) return
    const rule = def.advance
    const go = (): void => {
      const nid = nextId(def)
      if (nid) transitionTo(nid)
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
      unsubGameDone = on('game-complete', () => {
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
    if (!def || !current) return
    clearTriggers()
    const old = current
    old.stage.playExit() // exit animations play as the scene leaves
    const stage = mountScene(def)
    current = { def, stage }
    applyTransition(old.stage.root, stage.root, def.transition ?? { type: 'fade', durationMs: 350 }, () => old.stage.destroy())
    armAdvance(def)
  }

  const startDef = project.scenes.find((s) => s.id === project.startSceneId) ?? project.scenes[0]
  if (startDef) {
    current = { def: startDef, stage: mountScene(startDef) }
    armAdvance(startDef)
  }

  return {
    relayout() {
      current?.stage.layoutAll()
    },
    destroy() {
      clearTriggers()
      sfx?.destroy()
      current?.stage.destroy()
      container.remove()
    },
  }
}
