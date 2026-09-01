// Runtime entry. Boots a PROJECT (multi-scene flow). Boot order mirrors
// coinsort/src/main.ts: lifecycle stubs -> initMraid() -> compute metrics ->
// play the project's scene flow -> bindLifecycle -> wire resize/orientation.

import type { Project } from './scene'
import type { AssetMap } from './types'
import { computeMetrics, setDesign, setVAlign } from './responsive'
import { bindLifecycle, initMraid, notifyGameStart, setStoreUrl } from './networks'
import { resolveLocale, setActiveLocale } from './i18n'
import { setPromoCalendar } from './elements/promoCalendar'
import { playProject, type SceneManager } from './scenes'

const W = window as unknown as Record<string, any>

// Gesture types that can be "the first user interaction". pointer/touch are the real
// paths; mouse/click are backstops for containers that synthesize only mouse events.
const FIRST_TOUCH_EVENTS = ['pointerdown', 'touchstart', 'mousedown', 'click'] as const

function installLifecycleStubs(): void {
  for (const name of ['gameReady', 'gameStart', 'gameEnd', 'gameClose']) {
    if (typeof W[name] !== 'function') W[name] = () => {}
  }
}

function viewport(): { w: number; h: number } {
  const vv = window.visualViewport
  // Prefer visualViewport dimensions: on Chrome Android (which ignores user-scalable=no)
  // position:fixed;inset:0 tracks the *visual* viewport, so innerWidth/Height (layout
  // viewport) would give wrong metrics after a pinch-zoom. On desktop and iOS they match.
  if (vv) return { w: Math.max(1, Math.round(vv.width)), h: Math.max(1, Math.round(vv.height)) }
  const w = window.innerWidth || document.documentElement.clientWidth || 1
  const h = window.innerHeight || document.documentElement.clientHeight || 1
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
}

export async function boot(project: Project, assets: AssetMap, opts: { mount?: HTMLElement } = {}): Promise<SceneManager> {
  installLifecycleStubs()
  setDesign(project.meta.baseW || 1080, project.meta.baseH || 1920)
  setVAlign(project.meta.vAlign)
  // The {holiday} token's data. Export never sets a preview date, so the label always
  // resolves against the viewer's own local date.
  setPromoCalendar(project.meta.promoCalendar)
  const _ctaMode = project.meta.clickUrlMode ?? 'store'
  if (_ctaMode === 'none') {
    setStoreUrl({ ios: '', android: '' })
  } else if (_ctaMode === 'single' && project.meta.clickUrl) {
    const _single = project.meta.clickUrl.ios
    setStoreUrl({ ios: _single, android: _single })
  } else if (project.meta.clickUrl) {
    setStoreUrl(project.meta.clickUrl)
  }
  // pick the playable's language from the browser (falls back to the base copy)
  let currentLocale = resolveLocale(project.meta.locales)
  setActiveLocale(currentLocale)

  await initMraid()

  const first = viewport()
  computeMetrics(first.w, first.h)

  // Resume after a container-forced page reload (specifically AppLovin reloading the
  // creative on ORIENTATION CHANGE): scenes.ts records the active scene + orientation as
  // the player moves; a fresh boot within a short TTL re-enters that scene ONLY when the
  // orientation has flipped. A plain refresh (same orientation) — or a genuinely new
  // impression (stale/no record) — starts from the beginning. Export runtime only.
  let resumeSceneId: string | undefined
  try {
    const raw = window.sessionStorage.getItem('pa:resume-scene')
    if (raw) {
      const s = JSON.parse(raw) as { id?: string; t?: number; o?: string }
      const curO = window.innerWidth >= window.innerHeight ? 'l' : 'p'
      // Resume only on an orientation-change reload — a same-orientation reload (manual
      // refresh) is treated as a restart. Records without an orientation (legacy) never resume.
      if (s && typeof s.id === 'string' && Date.now() - (s.t ?? 0) < 30_000 && s.o && s.o !== curO) {
        resumeSceneId = s.id
      }
    }
  } catch { /* storage unavailable */ }

  const manager = playProject(project, assets, { mount: opts.mount ?? document.body, interactive: true, startSceneId: resumeSceneId })

  // Update the current screen when the browser's preferred-language list changes.
  const onLanguageChange = (): void => {
    const nextLocale = resolveLocale(project.meta.locales)
    if (nextLocale === currentLocale) return
    currentLocale = nextLocale
    setActiveLocale(nextLocale)
    manager.refreshLocale()
  }
  window.addEventListener('languagechange', onLanguageChange)
  const destroyManager = manager.destroy.bind(manager)
  manager.destroy = () => {
    window.removeEventListener('languagechange', onLanguageChange)
    destroyManager()
  }

  bindLifecycle()

  // Networks require the ad's timer to start on the FIRST user interaction, not on load.
  // gameStart() is the signal the SDKs listen for, so fire it from the first gesture and
  // never again (installLifecycleStubs guarantees the call is safe when no SDK is present).
  const onFirstInteraction = (): void => {
    for (const type of FIRST_TOUCH_EVENTS) window.removeEventListener(type, onFirstInteraction, true)
    notifyGameStart()
  }
  for (const type of FIRST_TOUCH_EVENTS)
    window.addEventListener(type, onFirstInteraction, { capture: true, passive: true })

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
