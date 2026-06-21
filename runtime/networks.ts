// Ad-network SDK layer — ported from coinsort/src/networks.ts. Everything that
// talks to a network SDK lives here: the CTA fallback chain, MRAID 3.0
// init/lifecycle, generic pause/mute lifecycle, and the gameStart/End/Close
// notifiers. De-coupled from Phaser: lifecycle signals go through the local
// emitter (emitter.ts) instead of scene.game.events.

import { emit } from './emitter'

type Win = Record<string, any>
const W = window as unknown as Win

// Store pages — configured from scene.meta.clickUrl via setStoreUrl().
let STORE = {
  ios: 'https://apps.apple.com/app/id0000000000',
  android: 'https://play.google.com/store/apps/details?id=com.example.app',
}

export function setStoreUrl(url: { ios: string; android: string }): void {
  if (url && typeof url.ios === 'string' && typeof url.android === 'string') STORE = url
}

function storeUrl(): string {
  const ua = navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)
  return isIOS ? STORE.ios : STORE.android
}

// ---------------------------------------------------------------------------
// Lifecycle notifiers — call the window stubs preview tools detect.
// ---------------------------------------------------------------------------
function callStub(name: string): void {
  try {
    if (typeof W[name] === 'function') W[name]()
  } catch {
    /* ignore */
  }
}
export const notifyGameStart = (): void => callStub('gameStart')
export const notifyGameEnd = (): void => callStub('gameEnd')
export const notifyGameClose = (): void => callStub('gameClose')

// ---------------------------------------------------------------------------
// CTA fallback chain (AGENTS.md priority order).
// ---------------------------------------------------------------------------
export function triggerCTA(): void {
  const url = storeUrl()

  // 1. GoogleAds
  try {
    if (typeof W.ExitApi?.exit === 'function') return void W.ExitApi.exit()
  } catch { /* */ }
  // 2. Facebook / Moloco
  try {
    if (typeof W.FbPlayableAd?.onCTAClick === 'function') return void W.FbPlayableAd.onCTAClick()
  } catch { /* */ }
  // 3. Unity (Luna)
  try {
    const p = W.Luna?.Unity?.Playable
    if (p) {
      if (typeof p.openStoreUrl === 'function') return void p.openStoreUrl(url)
      if (typeof p.install === 'function') return void p.install()
      if (typeof p.InstallFullGame === 'function') return void p.InstallFullGame()
    }
  } catch { /* */ }
  // 4. Runtime playableSDK
  try {
    if (typeof W.playableSDK?.openAppStore === 'function') return void W.playableSDK.openAppStore()
  } catch { /* */ }
  // 5. Mintegral
  try {
    if (typeof W.install === 'function') return void W.install()
  } catch { /* */ }
  // 6. Runtime openAppStore
  try {
    if (typeof W.openAppStore === 'function') return void W.openAppStore()
  } catch { /* */ }
  // 7. Moloco clickTag fallback
  try {
    if (typeof W.clickTag === 'string' && W.clickTag) return void window.open(W.clickTag, '_blank')
  } catch { /* */ }
  // 8. Vungle
  try {
    if (W.__VUNGLE__ && window.parent) return void window.parent.postMessage('download', '*')
  } catch { /* */ }
  // 9. TikTok
  try {
    if (W.__TIKTOK__) {
      if (typeof W.openAppStore === 'function') return void W.openAppStore()
      return void window.open(url, '_blank')
    }
  } catch { /* */ }
  // 10. MRAID (Applovin / Ironsource / Unity fallback)
  try {
    if (typeof W.mraid?.open === 'function') {
      const state = typeof W.mraid.getState === 'function' ? W.mraid.getState() : 'ready'
      if (state !== 'loading') return void W.mraid.open(url)
    }
  } catch { /* */ }
  // 11. Fallback
  try {
    window.open(url, '_blank')
  } catch { /* */ }
}

// ---------------------------------------------------------------------------
// MRAID 3.0 init + cached viewability/volume.
// ---------------------------------------------------------------------------
let _mraidViewable = true
let _mraidExposed = true
let _mraidVolume = 1

function emitVisibility(): void {
  const visible = _mraidViewable && _mraidExposed
  emit(visible ? 'ad-resume' : 'ad-pause')
}
function setVolume(vol: number): void {
  _mraidVolume = vol
  emit('ad-volume', vol)
}

function registerMraid(): void {
  const mraid = W.mraid
  if (!mraid || typeof mraid.addEventListener !== 'function') return
  try {
    if (typeof mraid.isViewable === 'function') _mraidViewable = !!mraid.isViewable()
  } catch { /* */ }
  try {
    mraid.addEventListener('error', (message: string, action: string) =>
      console.warn('[MRAID error]', { message, action }),
    )
    mraid.addEventListener('stateChange', (state: string) => console.log('[MRAID stateChange]', state))
    mraid.addEventListener('exposureChange', (exposed: number) => {
      _mraidExposed = typeof exposed === 'number' ? exposed > 0 : true
      emitVisibility()
    })
    mraid.addEventListener('viewableChange', (v: boolean) => {
      _mraidViewable = !!v
      emitVisibility()
    })
    mraid.addEventListener('audioVolumeChange', (pct: number | null) => {
      if (typeof pct === 'number') setVolume(pct / 100)
    })
  } catch { /* */ }
}

/**
 * Resolve once MRAID is ready (or after a timeout so startup never hangs).
 * Polls briefly for late `window.mraid` injection before giving up.
 */
export function initMraid(timeoutMs = 2000, detectTimeoutMs = 500): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      resolve()
    }

    const onReady = (): void => {
      registerMraid()
      finish()
    }

    const waitForReady = (): void => {
      const mraid = W.mraid
      if (!mraid) return finish()
      try {
        const state = typeof mraid.getState === 'function' ? mraid.getState() : 'ready'
        if (state === 'loading' && typeof mraid.addEventListener === 'function') {
          mraid.addEventListener('ready', onReady)
          window.setTimeout(onReady, timeoutMs)
        } else {
          onReady()
        }
      } catch {
        finish()
      }
    }

    if (W.mraid) {
      waitForReady()
      return
    }
    const startedAt = performance.now()
    const iv = window.setInterval(() => {
      if (W.mraid) {
        window.clearInterval(iv)
        waitForReady()
      } else if (performance.now() - startedAt >= detectTimeoutMs) {
        window.clearInterval(iv)
        finish()
      }
    }, 50)
    window.setTimeout(finish, timeoutMs + detectTimeoutMs + 250)
  })
}

// ---------------------------------------------------------------------------
// bindLifecycle: wire network pause/mute signals to the local emitter. The
// runtime listens for 'ad-pause' / 'ad-resume' / 'ad-mute' / 'ad-volume' and
// forwards to its SFX manager / game pausing.
// ---------------------------------------------------------------------------
export function bindLifecycle(): void {
  const pause = (): void => emit('ad-pause')
  const resume = (): void => emit('ad-resume')
  const mute = (m: boolean): void => emit('ad-mute', m)

  // Apply any MRAID state cached before binding.
  emitVisibility()
  if (_mraidVolume !== 1) setVolume(_mraidVolume)

  // Unity / Luna
  window.addEventListener('luna:pause', pause)
  window.addEventListener('luna:resume', resume)
  window.addEventListener('luna:mute', () => mute(true))
  window.addEventListener('luna:unmute', () => mute(false))
  // Vungle
  window.addEventListener('ad-event-pause', pause)
  window.addEventListener('ad-event-resume', resume)
  // Mintegral (postMessage)
  window.addEventListener('message', (e: MessageEvent) => {
    const d: any = e.data
    const t = typeof d === 'string' ? d : d?.type
    if (t === 'onPause') pause()
    else if (t === 'onResume') resume()
  })
  // Generic page visibility (GoogleAds / Facebook / Moloco + all)
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()))
  // Recovery backstops: always resume when the tab/window regains focus.
  window.addEventListener('focus', resume)
  window.addEventListener('pageshow', resume)
}
