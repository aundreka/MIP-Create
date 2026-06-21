// Audio manager. Ad containers forbid autoplay, so NOTHING plays until the first
// user gesture: a one-time capture pointerdown/touchstart "unlocks" audio (primes
// each pooled <audio> within the gesture, starts BGM, and unmutes endscene clips).
// Before unlock, play() is a no-op. Honors the MRAID lifecycle relayed through the
// emitter: ad-mute, ad-volume, ad-pause, ad-resume.
//
// Event→sound mapping + BGM come from the project (project.sfx / project.bgm).
// The runtime emits SFX events on the 'sfx' channel; this manager plays them.

import { on } from './emitter'
import type { Project } from './scene'
import type { AssetMap } from './types'

export interface SfxManager {
  destroy(): void
}

const POOL_MAX = 4

export function createSfxManager(project: Project, assets: AssetMap, mount: HTMLElement): SfxManager {
  // event → sound (last binding wins for a given event)
  const map: Record<string, { src: string; volume: number }> = {}
  for (const b of project.sfx ?? []) {
    const a = assets[b.assetId]
    if (a) map[b.event] = { src: a.src, volume: b.volume ?? 1 }
  }
  // element-level sounds (tap / scene enter) reference assets directly; collect
  // them so they get primed on unlock and can play outside a fresh gesture.
  const elementAssetIds = new Set<string>()
  for (const sc of project.scenes ?? [])
    for (const el of sc.elements ?? [])
      for (const b of el.sfx ?? []) if (assets[b.assetId]) elementAssetIds.add(b.assetId)
  const bgmAsset = project.bgm?.assetId ? assets[project.bgm.assetId] : undefined
  const bgmVol = project.bgm?.volume ?? 0.5

  let unlocked = false
  let muted = false
  let master = 1

  const pools: Record<string, HTMLAudioElement[]> = {}
  const assetPools: Record<string, HTMLAudioElement[]> = {}
  let bgm: HTMLAudioElement | null = null
  if (bgmAsset) {
    bgm = new Audio()
    bgm.src = bgmAsset.src
    bgm.loop = true
    bgm.preload = 'auto'
    bgm.volume = bgmVol * master
  }

  const mkEl = (src: string): HTMLAudioElement => {
    const a = new Audio()
    a.src = src
    a.preload = 'auto'
    return a
  }

  const forEachVideo = (fn: (v: HTMLVideoElement) => void): void => {
    mount.querySelectorAll<HTMLVideoElement>('video.pa-endscene-video').forEach(fn)
  }

  const play = (event: string): void => {
    if (!unlocked || muted) return
    const e = map[event]
    if (!e) return
    const pool = (pools[event] ??= [])
    let el = pool.find((a) => a.paused || a.ended)
    if (!el && pool.length < POOL_MAX) {
      el = mkEl(e.src)
      pool.push(el)
    }
    if (!el) el = pool[0]
    el.volume = Math.max(0, Math.min(1, e.volume * master))
    try {
      el.currentTime = 0
    } catch {
      /* not seekable yet */
    }
    void el.play().catch(() => {})
  }

  // Play an arbitrary library/uploaded asset by id (element-level tap / scene-enter
  // sounds). Pooled per asset, same as event sounds.
  const playAsset = (assetId: string, volume: number): void => {
    if (!unlocked || muted) return
    const a = assets[assetId]
    if (!a) return
    const pool = (assetPools[assetId] ??= [])
    let el = pool.find((x) => x.paused || x.ended)
    if (!el && pool.length < POOL_MAX) {
      el = mkEl(a.src)
      pool.push(el)
    }
    if (!el) el = pool[0]
    el.volume = Math.max(0, Math.min(1, volume * master))
    try {
      el.currentTime = 0
    } catch {
      /* not seekable yet */
    }
    void el.play().catch(() => {})
  }

  const setMuted = (m: boolean): void => {
    muted = m
    if (bgm) bgm.muted = m
    forEachVideo((v) => (v.muted = m))
  }
  const setVolume = (v: number): void => {
    master = Math.max(0, Math.min(1, v))
    if (bgm) bgm.volume = bgmVol * master
  }
  const pauseBgm = (): void => bgm?.pause()
  const resumeBgm = (): void => {
    if (unlocked && !muted) void bgm?.play().catch(() => {})
  }

  const unlock = (): void => {
    if (unlocked) return
    unlocked = true
    // Prime each mapped sound inside the gesture so later programmatic play() is
    // allowed (muted play→pause "blesses" the element).
    for (const event of Object.keys(map)) {
      const el = mkEl(map[event].src)
      el.muted = true
      el
        .play()
        .then(() => {
          el.pause()
          el.currentTime = 0
          el.muted = false
        })
        .catch(() => {})
      ;(pools[event] ??= []).push(el)
    }
    for (const assetId of elementAssetIds) {
      const a = assets[assetId]
      if (!a) continue
      const el = mkEl(a.src)
      el.muted = true
      el
        .play()
        .then(() => {
          el.pause()
          el.currentTime = 0
          el.muted = false
        })
        .catch(() => {})
      ;(assetPools[assetId] ??= []).push(el)
    }
    if (bgm) {
      bgm.muted = muted
      void bgm.play().catch(() => {})
    }
    // endscene clips start muted (for autoplay); give them sound after first tap
    forEachVideo((v) => (v.muted = muted))
  }

  window.addEventListener('pointerdown', unlock, { capture: true, once: true })
  window.addEventListener('touchstart', unlock, { capture: true, once: true })

  const offs = [
    on('sfx', (event: string) => play(event)),
    on('sfx-asset', (assetId: string, volume?: number) => playAsset(assetId, typeof volume === 'number' ? volume : 1)),
    on('ad-mute', (m: boolean) => setMuted(!!m)),
    on('ad-volume', (v: number) => setVolume(typeof v === 'number' ? v : 1)),
    on('ad-pause', pauseBgm),
    on('ad-resume', resumeBgm),
  ]

  return {
    destroy() {
      for (const off of offs) off()
      window.removeEventListener('pointerdown', unlock, { capture: true } as EventListenerOptions)
      window.removeEventListener('touchstart', unlock, { capture: true } as EventListenerOptions)
      bgm?.pause()
      for (const pool of [...Object.values(pools), ...Object.values(assetPools)])
        for (const a of pool) {
          a.pause()
          a.src = ''
        }
    },
  }
}
