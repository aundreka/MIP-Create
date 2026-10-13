// SFX manager — iOS-safe audio for playable ad exports.
//
// WHY SOUNDS ONLY WORKED ON SCRATCH (pointerdown) BUT NOT WIN/REVEAL/ENTER:
//   iOS only allows el.play() from direct user-gesture handlers: pointerdown,
//   touchstart, click. It does NOT grant audio permission to pointermove,
//   setTimeout, or page-load callbacks — those calls are silently blocked.
//   Win sounds fire from pointermove (scratch reveal check), scene-enter sounds
//   fire at page load, onReveal fires from pointermove. All were blocked.
//
// FIX — PRIMING:
//   In unlock() (our pointerdown capture handler) we call el.play() on EVERY
//   loaded audio element while muted, then immediately pause it. iOS sees this
//   as a user-gesture play and marks each element as "user-permitted". After
//   priming, el.play() on those elements works from any context forever.
//
// IMPORTANT: one-shots must NOT clone the element (clones aren't primed).
//   We use slot.el directly. Concurrent overlapping plays of the same one-shot
//   aren't supported, but that's fine for playable ad use cases.
//
// Add #debug to the ad URL for an on-screen log overlay (works on iPhone).

import { on } from './emitter'
import type { Project } from './scene'
import type { AssetMap } from './types'

export interface SfxManager {
  destroy(): void
}

// ---------------------------------------------------------------------------
// On-screen debug overlay (#debug in URL)
// ---------------------------------------------------------------------------
const DEBUG = typeof window !== 'undefined' &&
  (window.location.hash.includes('debug') || window.location.search.includes('debug'))

let _dbgEl: HTMLDivElement | null = null
function dbg(msg: string): void {
  console.log('[SFX]', msg)
  if (!DEBUG) return
  if (!_dbgEl) {
    _dbgEl = document.createElement('div')
    _dbgEl.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;max-height:35vh;overflow-y:auto;' +
      'background:rgba(0,0,0,.85);color:#0f0;font:11px/1.4 monospace;' +
      'z-index:2147483647;padding:4px 6px;pointer-events:none'
    document.body.appendChild(_dbgEl)
  }
  const d = document.createElement('div')
  d.textContent = (Date.now() % 100000) + ' ' + msg
  _dbgEl.appendChild(d)
  if (_dbgEl.children.length > 40) _dbgEl.removeChild(_dbgEl.children[0])
  _dbgEl.scrollTop = _dbgEl.scrollHeight
}

// ---------------------------------------------------------------------------
// Shared AudioContext singleton
// ---------------------------------------------------------------------------
let sharedCtx: AudioContext | null = null
let sharedGain: GainNode | null = null

function getCtx(): AudioContext | null {
  if (sharedCtx) return sharedCtx
  if (typeof window === 'undefined') return null
  const W = window as unknown as Record<string, unknown>
  const AC = (W.AudioContext ?? W.webkitAudioContext) as (new (o?: AudioContextOptions) => AudioContext) | undefined
  if (!AC) return null
  try {
    sharedCtx = new AC({ latencyHint: 'interactive' })
    sharedGain = sharedCtx.createGain()
    sharedGain.gain.value = 1
    sharedGain.connect(sharedCtx.destination)
  } catch {
    sharedCtx = null
    sharedGain = null
  }
  return sharedCtx
}

// ---------------------------------------------------------------------------
// Slot: always has el (sync); buf populated async after decode
// ---------------------------------------------------------------------------
// `primed` records that a silent prime actually SETTLED for this element — iOS grants
// playback per element, so a gesture having happened is not proof that this voice may
// play. `gen` is bumped by every prime/play attempt so a late callback from an older
// attempt can never pause or reset a newer one. `unsupported` retires a voice whose media
// the browser refuses outright (NotSupportedError), so it is not retried forever.
interface Slot {
  buf: AudioBuffer | null
  el: HTMLAudioElement | null
  primed: boolean
  unsupported: boolean
  gen: number
}

// Elements currently "claimed" by active playback — priming .then() skips
// pausing these so it doesn't interrupt a sound that started in the same gesture.
const claimedEls = new WeakSet<HTMLAudioElement>()

function loadSlot(src: string, label: string, done: (slot: Slot) => void): void {
  if (!src) return
  const slot: Slot = { buf: null, el: null, primed: false, unsupported: false, gen: 0 }

  // Phase 1 — sync: HTMLAudioElement ready immediately (before first gesture)
  try {
    const el = document.createElement('audio')
    el.preload = 'auto'
    el.src     = src
    el.load()
    // A one-shot that reached its end releases the element: nothing is playing through it
    // any more, so a later prime may reset it and a later cue may restart it from 0.
    el.addEventListener('ended', () => claimedEls.delete(el))
    slot.el = el
  } catch (e) {
    dbg('el err ' + label + ': ' + (e as Error).message)
  }
  done(slot)  // slot ready now; slot.buf will fill in async

  // Phase 2 — async: decode to AudioBuffer for Web Audio path (better quality)
  const ctx = getCtx()
  if (!ctx) return

  const onDecoded = (buf: AudioBuffer): void => {
    slot.buf = buf
    dbg('buf ' + label + ' ' + buf.duration.toFixed(2) + 's')
  }
  const decode = (arr: ArrayBuffer): void => {
    try {
      const r = ctx.decodeAudioData(arr.slice(0), onDecoded, () => {})
      if (r && typeof (r as Promise<AudioBuffer>).then === 'function')
        (r as Promise<AudioBuffer>).then((b) => { if (b?.duration > 0) onDecoded(b) }).catch(() => {})
    } catch { /* el fallback in place */ }
  }

  if (src.startsWith('data:')) {
    try {
      const comma = src.indexOf(',')
      const b64 = (comma >= 0 ? src.slice(comma + 1) : src)
        .replace(/[\s\r\n]/g, '').replace(/-/g, '+').replace(/_/g, '/')
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      decode(bytes.buffer as ArrayBuffer)
    } catch { /* el fallback in place */ }
  } else {
    fetch(src).then((r) => r.arrayBuffer()).then(decode).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
export function createSfxManager(project: Project, assets: AssetMap, mount: HTMLElement): SfxManager {
  const map: Record<string, { src: string; volume: number; delayMs: number }> = {}
  for (const b of project.sfx ?? []) {
    const a = assets[b.assetId]
    if (a) map[b.event] = { src: a.src, volume: b.volume ?? 1, delayMs: Math.max(0, b.delayMs ?? 0) }
  }

  const elementAssetIds = new Set<string>()
  for (const sc of project.scenes ?? [])
    for (const el of sc.elements ?? [])
      for (const b of el.sfx ?? []) if (assets[b.assetId]) elementAssetIds.add(b.assetId)

  const bgmAsset = project.bgm?.assetId ? assets[project.bgm.assetId] : undefined
  const bgmVol   = project.bgm?.volume ?? 0.5
  let muted  = false
  let master = 1

  const projectSlots: Record<string, Slot> = {}
  const assetSlots:   Record<string, Slot> = {}
  let   bgmSlot: Slot | null = null
  let   bgmUnlocked = false
  let   adPaused = false

  dbg('init events=' + Object.keys(map).join(',') + ' assets=' + [...elementAssetIds].length)

  for (const [event, e] of Object.entries(map))
    loadSlot(e.src, 'evt:' + event, (s) => { projectSlots[event] = s })
  for (const id of elementAssetIds) {
    const a = assets[id]
    if (a) loadSlot(a.src, 'a:' + id.slice(-6), (s) => { assetSlots[id] = s })
  }
  if (bgmAsset)
    loadSlot(bgmAsset.src, 'bgm', (s) => { bgmSlot = s; if (bgmUnlocked) startBgm() })

  const forEachVideo = (fn: (v: HTMLVideoElement) => void): void =>
    mount.querySelectorAll<HTMLVideoElement>('video.pa-endscene-video').forEach(fn)

  const ensureRunning = (): void => {
    const ctx = getCtx()
    if (ctx && ctx.state === 'suspended') void ctx.resume()
  }

  interface Handle { stop: () => void }

  const makeHandle = (
    slot: Slot,
    vol: number,
    loop: boolean,
    label: string,
    onPlaybackFailure?: () => void,
  ): Handle | null => {
    const ctx  = getCtx()
    const gain = sharedGain
    dbg('make ' + label + ' buf=' + !!slot.buf + ' el=' + !!slot.el + ' ctx=' + (ctx?.state ?? 'null'))

    // Web Audio API — only when context is already running.
    // On iOS ctx.resume() is async; context may still be 'suspended' here
    // even inside the same pointerdown event that called resume().
    if (slot.buf && ctx && gain && ctx.state === 'running') {
      const g = ctx.createGain()
      g.gain.value = Math.max(0, Math.min(1, vol))
      g.connect(gain)
      const src = ctx.createBufferSource()
      src.buffer = slot.buf
      src.loop   = loop
      src.connect(g)
      src.start(ctx.currentTime)
      dbg('→ WebAudio ' + label)
      return { stop: () => { try { src.stop() } catch { /* */ } } }
    }

    if (slot.el && !slot.unsupported) {
      const el = slot.el
      // Mark claimed BEFORE any async op so priming .then() won't pause it
      claimedEls.add(el)
      // This attempt owns the element from here on: an older prime or play settling later
      // sees a stale generation and leaves it alone.
      const gen = ++slot.gen
      el.loop        = loop
      el.muted       = muted
      el.currentTime = 0
      el.volume      = Math.min(1, vol)
      const p = el.play()
      if (p) p
        .then(() => {
          // Reaching playback proves this element is authorized, whatever happened to its
          // silent prime.
          slot.primed = true
          dbg('→ el OK ' + label)
        })
        .catch((e: Error) => {
          if (slot.gen !== gen) return // superseded — the newer request owns the element
          // iOS can reject a play after an overlay/scene handoff even though the
          // gesture that requested it was valid. Do not leave the loop registered
          // as active in that case: the next real gesture must be allowed to retry.
          claimedEls.delete(el)
          // NotSupportedError means the media itself cannot play — retrying is pointless.
          // Anything else (NotAllowedError above all) is an authorization failure: this
          // voice is no longer primed, and the cue is handed to the caller to re-queue.
          if (e?.name === 'NotSupportedError') slot.unsupported = true
          else slot.primed = false
          onPlaybackFailure?.()
          dbg('→ el BLOCKED ' + label + ': ' + e.message)
        })
      else dbg('→ el (no promise) ' + label)
      return {
        stop: () => {
          el.pause()
          el.currentTime = 0
          claimedEls.delete(el)
        },
      }
    }

    dbg('WARN no slot ' + label)
    return null
  }

  // ---- One-shot plays --------------------------------------------------------
  // Nothing may make a sound before the first user interaction (network policy: no
  // audio autoplay). A sceneEnter binding on the FIRST scene fires at load, so the
  // gate lives here rather than at the call sites. iOS blocks those plays anyway;
  // this makes the containers that DO allow autoplay behave the same way.
  const delayedOneShots = new Set<number>()
  const scheduleOneShot = (delayMs: number, run: () => void): void => {
    if (delayMs <= 0) { run(); return }
    const timer = window.setTimeout(() => {
      delayedOneShots.delete(timer)
      if (!muted && !adPaused) run()
    }, delayMs)
    delayedOneShots.add(timer)
  }
  const clearDelayedOneShots = (): void => {
    for (const timer of delayedOneShots) window.clearTimeout(timer)
    delayedOneShots.clear()
  }

  // Cues iOS rejected. A scene-enter sound is requested from a timer, with no gesture of
  // its own, so a single rejection used to lose it for good — the sound simply never
  // played. Hold it instead and re-attempt it on the next real gesture boundary (a
  // pointerdown/up anywhere), on the SAME element: a new <audio> would not carry whatever
  // authorization the old one has. Never retried from a timer, because a timer is not a
  // user gesture and would not be authorized either. A cue is dropped once it is older
  // than the freshness window, so a sound cannot arrive long after the moment it marked:
  // roughly one scene's worth of time, past which a scene's own sound is no longer its.
  const PENDING_TTL_MS = 4000
  interface Pending { slot: Slot; vol: number; label: string; expires: number }
  const pendingShots = new Set<Pending>()

  const requestOneShot = (slot: Slot, vol: number, label: string): void => {
    ensureRunning()
    const queue = (): void => {
      if (slot.unsupported) return
      pendingShots.add({ slot, vol, label, expires: Date.now() + PENDING_TTL_MS })
    }
    makeHandle(slot, vol, false, label, queue)
  }

  // Audible recovery for cues still inside their freshness window. Runs at a gesture
  // boundary, before any silent priming, so a sound the player is owed is requested ahead
  // of preparation for sounds they are not.
  const retryPendingShots = (): void => {
    if (!pendingShots.size) return
    const now = Date.now()
    for (const pending of [...pendingShots]) {
      pendingShots.delete(pending)
      if (muted || adPaused || pending.slot.unsupported || now > pending.expires) continue
      makeHandle(pending.slot, pending.vol, false, pending.label, () => {
        // Still refused: keep it for the next boundary until the window closes.
        if (!pending.slot.unsupported && Date.now() <= pending.expires) pendingShots.add(pending)
      })
    }
  }

  const play = (event: string): void => {
    if (muted || adPaused) return
    const e = map[event]; if (!e) return
    const slot = projectSlots[event]
    if (!slot) { dbg('no slot evt:' + event); return }
    if (!unlocked) { dbg('pre-gesture drop evt:' + event); return }
    scheduleOneShot(e.delayMs, () => requestOneShot(slot, e.volume * master, 'evt:' + event))
  }

  const playAsset = (id: string, vol: number, delayMs = 0): void => {
    if (muted || adPaused) return
    const slot = assetSlots[id]
    if (!slot) { dbg('no slot a:' + id.slice(-6)); return }
    if (!unlocked) { dbg('pre-gesture drop a:' + id.slice(-6)); return }
    scheduleOneShot(Math.max(0, delayMs), () => requestOneShot(slot, vol * master, 'a:' + id.slice(-6)))
  }

  // ---- Loops -----------------------------------------------------------------
  const activeLoops:      Record<string, Handle> = {}
  const activeAssetLoops: Record<string, Handle> = {}
  // Loops armed before the first gesture (e.g. an ambient sceneEnter loop on scene 1)
  // are held, not dropped, and start together with the BGM inside unlock().
  const pendingLoops      = new Set<string>()
  const pendingAssetLoops = new Map<string, { volume: number; delayMs: number }>()
  const loopTimers = new Map<string, number>()
  const assetLoopTimers = new Map<string, number>()

  const clearLoopTimer = (timers: Map<string, number>, key: string): void => {
    const timer = timers.get(key)
    if (timer == null) return
    window.clearTimeout(timer)
    timers.delete(key)
  }

  const startLoop = (event: string): void => {
    if (muted || adPaused || activeLoops[event] || loopTimers.has(event)) return
    const e = map[event]; if (!e) return
    const slot = projectSlots[event]
    if (!slot) { dbg('no slot loop:' + event); return }
    if (!unlocked) { pendingLoops.add(event); dbg('defer loop:' + event); return }
    if (e.delayMs > 0) {
      const timer = window.setTimeout(() => {
        loopTimers.delete(event)
        if (!muted && !adPaused) startLoopNow(event, e, slot)
      }, e.delayMs)
      loopTimers.set(event, timer)
      return
    }
    startLoopNow(event, e, slot)
  }
  const startLoopNow = (event: string, e: { volume: number }, slot: Slot): void => {
    ensureRunning()
    let h: Handle | null = null
    const onFailure = (): void => {
      if (h && activeLoops[event] === h) delete activeLoops[event]
    }
    h = makeHandle(slot, e.volume * master, true, 'loop:' + event, onFailure)
    if (h) activeLoops[event] = h
  }
  const stopLoop = (event: string): void => {
    pendingLoops.delete(event)
    clearLoopTimer(loopTimers, event)
    const h = activeLoops[event]; if (!h) return
    h.stop(); delete activeLoops[event]
  }

  const startAssetLoop = (id: string, vol: number, delayMs = 0): void => {
    if (muted || adPaused || activeAssetLoops[id] || assetLoopTimers.has(id)) return
    const slot = assetSlots[id]
    if (!slot) { dbg('no slot loop:a:' + id.slice(-6)); return }
    const delay = Math.max(0, delayMs)
    if (!unlocked) { pendingAssetLoops.set(id, { volume: vol, delayMs: delay }); dbg('defer loop:a:' + id.slice(-6)); return }
    if (delay > 0) {
      const timer = window.setTimeout(() => {
        assetLoopTimers.delete(id)
        if (!muted && !adPaused) startAssetLoopNow(id, vol, slot)
      }, delay)
      assetLoopTimers.set(id, timer)
      return
    }
    startAssetLoopNow(id, vol, slot)
  }
  const startAssetLoopNow = (id: string, vol: number, slot: Slot): void => {
    ensureRunning()
    let h: Handle | null = null
    const onFailure = (): void => {
      if (h && activeAssetLoops[id] === h) delete activeAssetLoops[id]
    }
    h = makeHandle(slot, vol * master, true, 'loop:a:' + id.slice(-6), onFailure)
    if (h) activeAssetLoops[id] = h
  }
  const stopAssetLoop = (id: string): void => {
    pendingAssetLoops.delete(id)
    clearLoopTimer(assetLoopTimers, id)
    const h = activeAssetLoops[id]; if (!h) return
    h.stop(); delete activeAssetLoops[id]
  }

  // ---- BGM -------------------------------------------------------------------
  let bgmHandle: Handle | null = null
  function startBgm(): void {
    if (muted || bgmHandle || !bgmSlot) return
    ensureRunning()
    bgmHandle = makeHandle(bgmSlot, bgmVol * master, true, 'bgm')
  }

  // ---- Ad pause / hide / close ----------------------------------------------
  // Networks require audio to STOP or MUTE when the ad is hidden or closed. Suspending
  // the shared AudioContext only silences the Web Audio path — on iOS every sound
  // actually plays through an HTMLAudioElement (see the priming note at the top), and
  // those keep going through a suspend. So pause the elements too, and mute any video.
  const forEachAudioEl = (fn: (el: HTMLAudioElement) => void): void => {
    for (const slot of [...Object.values(projectSlots), ...Object.values(assetSlots)])
      if (slot.el) fn(slot.el)
    if (bgmSlot?.el) fn(bgmSlot.el)
  }

  // Only the elements WE paused are resumed, so a one-shot that had already finished
  // doesn't restart when the player comes back.
  const pausedEls: HTMLAudioElement[] = []
  const pauseBgm = (): void => {
    if (adPaused) return
    adPaused = true
    clearDelayedOneShots()
    pendingShots.clear() // a cue owed before the ad was hidden must not fire on return
    for (const timer of loopTimers.values()) window.clearTimeout(timer)
    for (const timer of assetLoopTimers.values()) window.clearTimeout(timer)
    loopTimers.clear()
    assetLoopTimers.clear()
    void sharedCtx?.suspend()
    pausedEls.length = 0
    forEachAudioEl((el) => {
      if (el.paused) return
      pausedEls.push(el)
      el.pause()
    })
    forEachVideo((v) => (v.muted = true))
  }
  const resumeBgm = (): void => {
    if (!adPaused) return
    adPaused = false
    void sharedCtx?.resume()
    for (const el of pausedEls) { el.muted = muted; void el.play()?.catch(() => {}) }
    pausedEls.length = 0
    // Videos stay muted until the first gesture has happened (no audio autoplay).
    if (unlocked) forEachVideo((v) => (v.muted = muted))
  }

  // ---- Mute / volume ---------------------------------------------------------
  const setMuted = (m: boolean): void => {
    muted = m
    dbg('setMuted ' + m)
    if (sharedGain) sharedGain.gain.value = m ? 0 : 1
    forEachVideo((v) => (v.muted = m))
    for (const slot of [...Object.values(projectSlots), ...Object.values(assetSlots)])
      if (slot.el) slot.el.muted = m
    if (bgmSlot?.el) bgmSlot.el.muted = m
  }
  const setVolume = (v: number): void => { master = Math.max(0, Math.min(1, v)) }

  // ---- Gesture boundaries: unlock, recovery, priming -------------------------
  // iOS grants playback PER ELEMENT, and only from a real user gesture. Priming — a
  // muted play() inside a gesture — is what lets a later cue from a timer or a scene
  // change play at all. A prime can fail or never settle, so one pass is not enough:
  // every gesture boundary re-primes the voices that still have no authorization, which
  // is what gives a sound bound to a LATER scene more than one chance to become playable.

  /** Silent preparation for voices that are idle and not yet known-playable. */
  const primeIdle = (): void => {
    if (muted || adPaused) return
    for (const slot of [...Object.values(projectSlots), ...Object.values(assetSlots)]) {
      const el = slot.el
      // Skip a voice that is already authorized, retired, or busy playing for real.
      if (!el || slot.primed || slot.unsupported || claimedEls.has(el)) continue
      const gen = ++slot.gen
      el.muted = true  // silent prime
      const p = el.play()
      if (!p) continue
      p.then(() => {
        slot.primed = true
        if (slot.gen !== gen) return // a real cue took this element over; leave it playing
        if (!claimedEls.has(el)) {
          el.pause()
          el.currentTime = 0
        }
        el.muted = muted  // restore correct mute state
      }).catch((e: Error) => {
        if (e?.name === 'NotSupportedError') slot.unsupported = true
        if (slot.gen === gen) el.muted = muted
      })
    }
  }

  let unlocked = false
  const unlock = (): void => {
    unlocked = true
    ensureRunning()

    bgmUnlocked = true
    if (bgmSlot) startBgm()
    forEachVideo((v) => (v.muted = muted))

    // Loops armed before this gesture were held back by the no-autoplay gate — start
    // them now, inside the gesture, so iOS grants them playback permission too.
    const heldLoops = [...pendingLoops]
    const heldAssetLoops = [...pendingAssetLoops]
    pendingLoops.clear()
    pendingAssetLoops.clear()
    for (const event of heldLoops) startLoop(event)
    for (const [id, pending] of heldAssetLoops) startAssetLoop(id, pending.volume, pending.delayMs)
  }

  // Audible work first, silent preparation second: a sound the player is already owed
  // must not queue behind priming for sounds that may never be needed.
  const onGesture = (): void => {
    if (!unlocked) {
      dbg('UNLOCK ctx=' + (sharedCtx?.state ?? 'null'))
      unlock()
    } else {
      retryPendingShots()
    }
    primeIdle()
  }

  // Every gesture type that can carry authorization. pointerdown/touchstart are the real
  // paths; mousedown/click are backstops for containers that synthesize only mouse events
  // — without them the no-autoplay gate would leave the ad permanently silent there. The
  // release events matter as much as the presses: a cue rejected during a quick tap gets
  // its retry on the matching up, still inside the same interaction.
  const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'] as const
  for (const type of UNLOCK_EVENTS)
    window.addEventListener(type, onGesture, { capture: true })

  // ---- Event bindings --------------------------------------------------------
  const offs = [
    on('sfx',                  (e: string) => play(e)),
    on('sfx-asset',            (id: string, v?: number, delayMs?: number) => playAsset(id, typeof v === 'number' ? v : 1, typeof delayMs === 'number' ? delayMs : 0)),
    on('sfx-loop-start',       (e: string) => startLoop(e)),
    on('sfx-loop-stop',        (e: string) => stopLoop(e)),
    on('sfx-asset-loop-start', (id: string, v?: number, delayMs?: number) => startAssetLoop(id, typeof v === 'number' ? v : 1, typeof delayMs === 'number' ? delayMs : 0)),
    on('sfx-asset-loop-stop',  (id: string) => stopAssetLoop(id)),
    on('ad-mute',              (m: boolean) => setMuted(!!m)),
    on('ad-volume',            (v: number) => setVolume(typeof v === 'number' ? v : 1)),
    on('ad-pause',             pauseBgm),
    on('ad-resume',            resumeBgm),
  ]

  return {
    destroy() {
      for (const off of offs) off()
      for (const type of UNLOCK_EVENTS)
        window.removeEventListener(type, onGesture, { capture: true } as EventListenerOptions)
      pendingLoops.clear()
      pendingAssetLoops.clear()
      pendingShots.clear()
      clearDelayedOneShots()
      for (const timer of loopTimers.values()) window.clearTimeout(timer)
      for (const timer of assetLoopTimers.values()) window.clearTimeout(timer)
      loopTimers.clear()
      assetLoopTimers.clear()
      for (const h of [...Object.values(activeLoops), ...Object.values(activeAssetLoops)]) h.stop()
      bgmHandle?.stop()
    },
  }
}
