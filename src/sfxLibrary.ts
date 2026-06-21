// Built-in SFX library. Common UI/game sounds are synthesized to short mono
// 22.05kHz WAV data URLs, so the editor ships a usable sound palette with no
// bundled audio files (no licensing). Clips render lazily and cache; picking one
// adds it to the shared asset library like any uploaded sound, so it exports with
// the playable normally.

import { addAsset, getState } from './store'

const SR = 22050

type Wave = 'sine' | 'square' | 'saw' | 'tri'
interface Tone { t: 'tone'; at?: number; dur: number; freq: number; to?: number; wave?: Wave; gain?: number; decay?: number }
interface Noise { t: 'noise'; at?: number; dur: number; gain?: number; decay?: number; lp?: number }
type Seg = Tone | Noise

interface Def { label: string; group: string; dur: number; segs: Seg[] }

// decay is an exponential rate per second (higher = snappier).
const DEFS: Record<string, Def> = {
  // --- UI ---
  tap: { label: 'Tap', group: 'UI', dur: 0.1, segs: [{ t: 'tone', dur: 0.09, freq: 660, to: 520, wave: 'sine', decay: 38 }] },
  click: { label: 'Click', group: 'UI', dur: 0.06, segs: [{ t: 'noise', dur: 0.02, gain: 0.5, decay: 140 }, { t: 'tone', dur: 0.05, freq: 1200, wave: 'square', gain: 0.25, decay: 90 }] },
  pop: { label: 'Pop', group: 'UI', dur: 0.14, segs: [{ t: 'tone', dur: 0.13, freq: 380, to: 940, wave: 'sine', decay: 20 }] },
  whoosh: { label: 'Whoosh', group: 'UI', dur: 0.28, segs: [{ t: 'noise', dur: 0.28, gain: 0.6, decay: 9, lp: 0.18 }] },
  swipe: { label: 'Swipe', group: 'UI', dur: 0.16, segs: [{ t: 'noise', dur: 0.16, gain: 0.5, decay: 16, lp: 0.4 }] },
  toggle: { label: 'Toggle', group: 'UI', dur: 0.1, segs: [{ t: 'tone', dur: 0.05, freq: 520, wave: 'square', gain: 0.4, decay: 60 }, { t: 'tone', at: 0.05, dur: 0.05, freq: 780, wave: 'square', gain: 0.4, decay: 60 }] },
  // --- Reward ---
  coin: { label: 'Coin', group: 'Reward', dur: 0.2, segs: [{ t: 'tone', dur: 0.05, freq: 988, wave: 'square', gain: 0.4, decay: 30 }, { t: 'tone', at: 0.05, dur: 0.15, freq: 1319, wave: 'square', gain: 0.4, decay: 14 }] },
  ding: { label: 'Ding', group: 'Reward', dur: 0.5, segs: [{ t: 'tone', dur: 0.5, freq: 1245, wave: 'sine', gain: 0.6, decay: 7 }, { t: 'tone', dur: 0.5, freq: 2490, wave: 'sine', gain: 0.18, decay: 9 }] },
  success: { label: 'Success', group: 'Reward', dur: 0.36, segs: [{ t: 'tone', dur: 0.12, freq: 523, wave: 'sine', decay: 14 }, { t: 'tone', at: 0.1, dur: 0.12, freq: 659, wave: 'sine', decay: 14 }, { t: 'tone', at: 0.2, dur: 0.16, freq: 784, wave: 'sine', decay: 11 }] },
  chime: { label: 'Chime', group: 'Reward', dur: 0.6, segs: [{ t: 'tone', dur: 0.6, freq: 880, wave: 'sine', gain: 0.5, decay: 5 }, { t: 'tone', at: 0.08, dur: 0.52, freq: 1320, wave: 'sine', gain: 0.3, decay: 6 }] },
  levelUp: { label: 'Level up', group: 'Reward', dur: 0.5, segs: [{ t: 'tone', dur: 0.1, freq: 523, wave: 'square', gain: 0.35, decay: 16 }, { t: 'tone', at: 0.09, dur: 0.1, freq: 659, wave: 'square', gain: 0.35, decay: 16 }, { t: 'tone', at: 0.18, dur: 0.1, freq: 784, wave: 'square', gain: 0.35, decay: 16 }, { t: 'tone', at: 0.27, dur: 0.22, freq: 1046, wave: 'square', gain: 0.35, decay: 9 }] },
  sparkle: { label: 'Sparkle', group: 'Reward', dur: 0.4, segs: [{ t: 'tone', dur: 0.1, freq: 1568, wave: 'sine', gain: 0.3, decay: 22 }, { t: 'tone', at: 0.08, dur: 0.1, freq: 2093, wave: 'sine', gain: 0.25, decay: 22 }, { t: 'tone', at: 0.16, dur: 0.24, freq: 2637, wave: 'sine', gain: 0.22, decay: 12 }] },
  // --- Game ---
  collect: { label: 'Collect', group: 'Game', dur: 0.16, segs: [{ t: 'tone', dur: 0.15, freq: 700, to: 1300, wave: 'sine', decay: 16 }] },
  merge: { label: 'Merge', group: 'Game', dur: 0.22, segs: [{ t: 'tone', dur: 0.1, freq: 300, to: 600, wave: 'tri', gain: 0.5, decay: 16 }, { t: 'tone', at: 0.09, dur: 0.13, freq: 600, to: 900, wave: 'tri', gain: 0.5, decay: 13 }] },
  bounce: { label: 'Bounce', group: 'Game', dur: 0.14, segs: [{ t: 'tone', dur: 0.13, freq: 520, to: 220, wave: 'sine', gain: 0.6, decay: 24 }] },
  powerUp: { label: 'Power up', group: 'Game', dur: 0.34, segs: [{ t: 'tone', dur: 0.34, freq: 300, to: 1200, wave: 'saw', gain: 0.4, decay: 7 }] },
  // --- Negative ---
  error: { label: 'Error', group: 'Negative', dur: 0.24, segs: [{ t: 'tone', dur: 0.12, freq: 220, wave: 'square', gain: 0.4, decay: 16 }, { t: 'tone', at: 0.11, dur: 0.13, freq: 165, wave: 'square', gain: 0.4, decay: 14 }] },
  wrong: { label: 'Wrong', group: 'Negative', dur: 0.3, segs: [{ t: 'tone', dur: 0.3, freq: 200, to: 120, wave: 'saw', gain: 0.45, decay: 7 }] },
  lose: { label: 'Lose', group: 'Negative', dur: 0.5, segs: [{ t: 'tone', dur: 0.16, freq: 440, wave: 'tri', gain: 0.45, decay: 9 }, { t: 'tone', at: 0.15, dur: 0.16, freq: 330, wave: 'tri', gain: 0.45, decay: 9 }, { t: 'tone', at: 0.3, dur: 0.2, freq: 220, wave: 'tri', gain: 0.45, decay: 7 }] },
  buzz: { label: 'Buzz', group: 'Negative', dur: 0.22, segs: [{ t: 'tone', dur: 0.22, freq: 110, wave: 'square', gain: 0.4, decay: 5 }] },
}

export interface SfxItem { id: string; label: string; group: string }

function render(def: Def): Float32Array {
  const n = Math.ceil(def.dur * SR)
  const out = new Float32Array(n)
  for (const seg of def.segs) {
    const at = Math.floor((seg.at ?? 0) * SR)
    const len = Math.floor(seg.dur * SR)
    const gain = seg.gain ?? 0.8
    const decay = seg.decay ?? 8
    if (seg.t === 'tone') {
      let phase = 0
      for (let i = 0; i < len; i++) {
        const lt = i / SR
        const f = seg.to != null ? seg.freq + (seg.to - seg.freq) * (i / len) : seg.freq
        phase += f / SR
        const ph = phase % 1
        const wave = seg.wave ?? 'sine'
        let s: number
        if (wave === 'sine') s = Math.sin(2 * Math.PI * ph)
        else if (wave === 'square') s = ph < 0.5 ? 1 : -1
        else if (wave === 'saw') s = 2 * ph - 1
        else s = 1 - 4 * Math.abs(ph - 0.5)
        const env = Math.min(1, lt / 0.005) * Math.exp(-decay * lt)
        const idx = at + i
        if (idx < n) out[idx] += s * gain * env
      }
    } else {
      let lpPrev = 0
      const lp = seg.lp ?? 1
      for (let i = 0; i < len; i++) {
        const lt = i / SR
        const white = Math.random() * 2 - 1
        lpPrev = lpPrev + lp * (white - lpPrev)
        const env = Math.min(1, lt / 0.003) * Math.exp(-decay * lt)
        const idx = at + i
        if (idx < n) out[idx] += lpPrev * gain * env
      }
    }
  }
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 1) for (let i = 0; i < n; i++) out[i] /= peak
  return out
}

function encodeWav(samples: Float32Array): string {
  const n = samples.length
  const buffer = new ArrayBuffer(44 + n * 2)
  const view = new DataView(buffer)
  const wr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  wr(0, 'RIFF')
  view.setUint32(4, 36 + n * 2, true)
  wr(8, 'WAVE')
  wr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SR, true)
  view.setUint32(28, SR * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  wr(36, 'data')
  view.setUint32(40, n * 2, true)
  let off = 44
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true)
    off += 2
  }
  const bytes = new Uint8Array(buffer)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)))
  return 'data:audio/wav;base64,' + btoa(bin)
}

const cache: Record<string, string> = {}
export function sfxDataUrl(id: string): string {
  if (cache[id]) return cache[id]
  const def = DEFS[id]
  if (!def) return ''
  return (cache[id] = encodeWav(render(def)))
}

export function sfxItems(): SfxItem[] {
  return Object.entries(DEFS).map(([id, d]) => ({ id, label: d.label, group: d.group }))
}

/** Add a built-in sound to the shared asset library (idempotent) and return its
 * asset id, so it can be bound to events or element triggers like any asset. */
export function ensureLibrarySfx(id: string): string {
  const assetId = 'sfx_' + id
  if (!getState().assets[assetId]) addAsset(assetId, { src: sfxDataUrl(id), w: 0, h: 0, kind: 'audio' })
  return assetId
}
