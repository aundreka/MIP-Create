// Runtime entry. Boots a PROJECT (multi-scene flow). Boot order mirrors
// coinsort/src/main.ts: lifecycle stubs -> initMraid() -> compute metrics ->
// play the project's scene flow -> bindLifecycle -> wire resize/orientation.

import type { Project } from './scene'
import type { AssetMap } from './types'
import { computeMetrics, setDesign } from './responsive'
import { bindLifecycle, initMraid, setStoreUrl } from './networks'
import { playProject, type SceneManager } from './scenes'

const W = window as unknown as Record<string, any>

function installLifecycleStubs(): void {
  for (const name of ['gameReady', 'gameStart', 'gameEnd', 'gameClose']) {
    if (typeof W[name] !== 'function') W[name] = () => {}
  }
}

function viewport(): { w: number; h: number } {
  const vv = window.visualViewport
  const w = window.innerWidth || vv?.width || document.documentElement.clientWidth || 1
  const h = window.innerHeight || vv?.height || document.documentElement.clientHeight || 1
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
}

export async function boot(project: Project, assets: AssetMap, opts: { mount?: HTMLElement } = {}): Promise<SceneManager> {
  installLifecycleStubs()
  setDesign(project.meta.baseW || 1080, project.meta.baseH || 1920)
  if (project.meta.clickUrl) setStoreUrl(project.meta.clickUrl)

  await initMraid()

  const first = viewport()
  computeMetrics(first.w, first.h)

  const manager = playProject(project, assets, { mount: opts.mount ?? document.body, interactive: true })

  bindLifecycle()

  let lastW = first.w
  let lastH = first.h
  const apply = (): void => {
    const { w, h } = viewport()
    lastW = w
    lastH = h
    computeMetrics(w, h)
    manager.relayout()
  }

  let raf = 0
  const debounced = (): void => {
    if (raf) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(apply)
  }
  window.addEventListener('resize', debounced)
  window.visualViewport?.addEventListener('resize', debounced)
  window.visualViewport?.addEventListener('scroll', debounced)
  window.addEventListener('orientationchange', () => {
    debounced()
    for (const t of [100, 300, 600]) window.setTimeout(apply, t)
  })

  let pollFrame = 0
  const poll = (): void => {
    if ((pollFrame++ & 7) === 0) {
      const { w, h } = viewport()
      if (Math.abs(w - lastW) > 0.5 || Math.abs(h - lastH) > 0.5) apply()
    }
    requestAnimationFrame(poll)
  }
  requestAnimationFrame(poll)

  const reconcile = (): void => {
    const { w, h } = viewport()
    if (Math.abs(w - lastW) > 0.5 || Math.abs(h - lastH) > 0.5) apply()
  }
  for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
    window.addEventListener(type, reconcile, { capture: true, passive: true })
  }

  W.gameReady()
  return manager
}

export type { Project, Scene, SceneDef } from './scene'
export type { AssetMap, AssetEntry } from './types'
