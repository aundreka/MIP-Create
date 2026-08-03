import { DEFAULT_MEDIA, type MediaDefaults } from './export'
import type { CompressProfile } from '../runtime/types'

export interface ExportPrefs {
  optimize: boolean
  quality: number
  networks: string[]
}

const EXPORT_PREFS_KEY = 'pa:exportPrefs'
const VIDEO_COMPRESS_KEY = 'pa:vidCompress'
const AUDIO_COMPRESS_KEY = 'pa:audCompress'

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  optimize: true,
  quality: 82,
  networks: ['AppLovin'],
}

function clampQuality(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_EXPORT_PREFS.quality
  return Math.max(50, Math.min(100, Math.round(n)))
}

export function readExportPrefs(): ExportPrefs {
  try {
    const raw = localStorage.getItem(EXPORT_PREFS_KEY)
    if (!raw) return { ...DEFAULT_EXPORT_PREFS }
    const parsed = JSON.parse(raw) as Partial<ExportPrefs>
    return {
      optimize: parsed.optimize ?? DEFAULT_EXPORT_PREFS.optimize,
      quality: clampQuality(parsed.quality),
      networks: Array.isArray(parsed.networks) && parsed.networks.length ? parsed.networks.map(String) : [...DEFAULT_EXPORT_PREFS.networks],
    }
  } catch {
    return { ...DEFAULT_EXPORT_PREFS }
  }
}

export function writeExportPrefs(prefs: ExportPrefs): void {
  try {
    localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify({
      optimize: !!prefs.optimize,
      quality: clampQuality(prefs.quality),
      networks: prefs.networks.length ? prefs.networks : DEFAULT_EXPORT_PREFS.networks,
    }))
  } catch {
    // ignore storage failures
  }
}

function readCompressProfile(key: string, fallback: CompressProfile): CompressProfile {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }
  } catch {
    return { ...fallback }
  }
}

export function readStoredMediaDefaults(): MediaDefaults {
  return {
    video: readCompressProfile(VIDEO_COMPRESS_KEY, DEFAULT_MEDIA.video ?? {}),
    audio: readCompressProfile(AUDIO_COMPRESS_KEY, DEFAULT_MEDIA.audio ?? {}),
  }
}
