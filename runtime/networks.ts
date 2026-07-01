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
let _lastCta = 0
// Clear the CTA cooldown. Called whenever the page is re-shown/refocused — i.e. the
// user has RETURNED from wherever the last CTA sent them (store, new tab, MRAID
// expand). The 800ms guard below only exists to collapse a SINGLE gesture's double-fire
// (whole-card pointerdown + CTA-button click); once the user has left and come back,
// their next tap is a fresh, deliberate interaction that must redirect on the FIRST
// click. Without this reset that return tap lands inside the lingering 800ms window and
// gets swallowed, so the endcard "needs two clicks" to redirect the second time around.
export function resetCtaCooldown(): void { _lastCta = 0 }
export function triggerCTA(): void {
  // Cooldown so a whole-scene endcard tap + the CTA button tap (or rapid double-taps)
  // can't fire the store open twice. CRITICAL: arm it only AFTER a redirect ACTUALLY
  // fires (via done() / the fallback below). If we armed it up-front, a tap that no-ops —
  // e.g. a popup-blocked about:blank, or a missing SDK — would still block the user's next
  // deliberate tap for 800ms, so the endcard would "need 2+ clicks" to redirect.
  const t = performance.now()
  if (t - _lastCta < 800) return
  const url = storeUrl()
  // 'about:blank' means "no real destination" — normalise to '' so MRAID fires an
  // empty click signal (network still registers the tap) but no navigation happens.
  // A truly-empty url (clickUrlMode:'none') keeps '' and skips MRAID entirely.
  const dest = url === 'about:blank' ? '' : url
  // Run the redirect, then arm the cooldown — if the action throws it's caught below and
  // the next handler/path still gets a chance (and the cooldown stays disarmed).
  const done = (fn: () => void): void => { fn(); _lastCta = t }

  // 1. GoogleAds
  try {
    if (typeof W.ExitApi?.exit === 'function') return done(() => W.ExitApi.exit())
  } catch { /* */ }
  // 2. Facebook / Moloco
  try {
    if (typeof W.FbPlayableAd?.onCTAClick === 'function') return done(() => W.FbPlayableAd.onCTAClick())
  } catch { /* */ }
  // 3. Unity (Luna)
  try {
    const p = W.Luna?.Unity?.Playable
    if (p) {
      if (typeof p.openStoreUrl === 'function') return done(() => p.openStoreUrl(dest))
      if (typeof p.install === 'function') return done(() => p.install())
      if (typeof p.InstallFullGame === 'function') return done(() => p.InstallFullGame())
    }
  } catch { /* */ }
  // 4. Runtime playableSDK
  try {
    if (typeof W.playableSDK?.openAppStore === 'function') return done(() => W.playableSDK.openAppStore())
  } catch { /* */ }
  // 5. Mintegral
  try {
    if (typeof W.install === 'function') return done(() => W.install())
  } catch { /* */ }
  // 6. Runtime openAppStore
  try {
    if (typeof W.openAppStore === 'function') return done(() => W.openAppStore())
  } catch { /* */ }
  // 7. Moloco clickTag fallback
  try {
    if (typeof W.clickTag === 'string' && W.clickTag) return done(() => window.open(W.clickTag, '_blank'))
  } catch { /* */ }
  // 8. Vungle
  try {
    if (W.__VUNGLE__ && window.parent) return done(() => window.parent.postMessage('download', '*'))
  } catch { /* */ }
  // 9. TikTok
  try {
    if (W.__TIKTOK__) {
      if (typeof W.openAppStore === 'function') return done(() => W.openAppStore())
      if (url) return done(() => window.open(url, '_blank'))
      return
    }
  } catch { /* */ }
  // 10. MRAID (Applovin / Ironsource / Unity fallback)
  // Always fires when MRAID is present — even with no URL (dest=''). The SDK uses
  // its own configured store URL when given an empty string, so the redirect still
  // happens for mode:'none' / about:blank ads inside a MRAID container.
  try {
    if (typeof W.mraid?.open === 'function') {
      const state = typeof W.mraid.getState === 'function' ? W.mraid.getState() : 'ready'
      if (state !== 'loading') return done(() => W.mraid.open(dest))
    }
  } catch { /* */ }
  // 11. Fallback — standalone HTML (no network SDK present). Try a new tab first; if the
  // browser blocks the popup (common when the exported file is opened directly / served
  // from plain hosting) window.open returns null, so navigate the CURRENT tab instead.
  // Without this the popup-block swallows the first tap(s) and the redirect only fires after
  // several presses. The cooldown is armed only when something actually opens/navigates.
  // Skipped only when truly no URL (mode:'none').
  if (url) {
    let opened: Window | null = null
    try {
      opened = window.open(url, '_blank')
    } catch { /* */ }
    if (opened) { _lastCta = t; return }
    // about:blank has no meaningful same-tab destination — only redirect in place for a real URL.
    if (url !== 'about:blank') {
      try {
        window.location.href = url
        _lastCta = t
      } catch { /* */ }
    }
  }
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
  // Re-show/refocus = the user came back from a CTA destination. Drop the CTA cooldown so
  // their next tap redirects on the first click (otherwise the second redirect "needs two
  // clicks" — see resetCtaCooldown). Safe: a single gesture's double-fire is collapsed
  // synchronously before any focus/visibility change, so this never re-opens a live tap.
  const resume = (): void => { resetCtaCooldown(); emit('ad-resume') }
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
