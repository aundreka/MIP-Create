// Device detection for the {device} / {os} token of the dynamic date element.
// Answers "what is the viewer running?" with one of five platforms — iOS, Android,
// Windows, Mac, Linux — so ad copy can read "Available on iOS" or "Download for
// Android" without a per-platform build. Pure detection (detectDevice) is separated
// from the navigator lookup (currentDevice) so it is unit-testable and the editor can
// force a platform for preview exactly like setNowOverride does for the date.

export type DeviceId = 'ios' | 'android' | 'windows' | 'mac' | 'linux' | 'unknown'

/** Copy the token renders. 'unknown' is empty on purpose — a blank beats "Unknown"
 * in the middle of a headline. */
export const DEVICE_LABELS: Record<DeviceId, string> = {
  ios: 'iOS',
  android: 'Android',
  windows: 'Windows',
  mac: 'Mac',
  linux: 'Linux',
  unknown: '',
}

export const DEVICE_IDS: readonly DeviceId[] = ['ios', 'android', 'windows', 'mac', 'linux']

/** Everything detection reads, passed explicitly so a test (or the editor) can hand
 * in any combination without touching the global navigator. */
export interface DeviceSignals {
  /** navigator.userAgent */
  ua?: string
  /** navigator.platform ('iPhone', 'MacIntel', 'Win32', 'Linux armv8l', …). */
  platform?: string
  /** navigator.userAgentData.platform — Chromium's client hint ('Android', 'Windows',
   * 'macOS', 'Linux', 'Chrome OS'). Preferred when present: Chromium has frozen the
   * UA string, so the hint is the one field guaranteed to stay truthful. */
  hintPlatform?: string
  /** 'ontouchend' in document — the classic iPad tell. */
  touch?: boolean
  /** navigator.maxTouchPoints. iPadOS 13+ reports 5 while calling itself a Mac. */
  maxTouchPoints?: number
}

/** Classify a set of signals. Order matters: Android before Linux (every Android UA
 * says "Linux"), iPhone/iPad before Mac (the iPad UA says "like Mac OS X"), and the
 * Mac-with-a-touch-screen case reads as iOS because no Mac has one — that is how
 * iPadOS's "Request Desktop Website" default is unmasked. */
export function detectDevice(s: DeviceSignals = {}): DeviceId {
  const ua = s.ua || ''
  const platform = s.platform || ''
  const hint = (s.hintPlatform || '').trim().toLowerCase()
  const touch = !!s.touch || (s.maxTouchPoints ?? 0) > 1

  if (hint) {
    if (hint === 'android') return 'android'
    if (hint === 'ios') return 'ios'
    if (hint === 'windows') return 'windows'
    if (hint === 'macos' || hint === 'mac os x') return 'mac'
    if (hint === 'linux' || hint === 'chrome os' || hint === 'chromium os') return 'linux'
  }

  if (/Windows Phone/i.test(ua)) return 'windows' // its UA also says "Android"
  if (/iPhone|iPad|iPod/i.test(ua) || /^iP(hone|ad|od)/.test(platform)) return 'ios'
  if (/Macintosh|Mac OS X/.test(ua) && touch) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  if (/Windows|Win32|Win64|WinCE/.test(ua) || /^Win/.test(platform)) return 'windows'
  if (/Macintosh|Mac OS X|Mac_PowerPC/.test(ua) || /^Mac/.test(platform)) return 'mac'
  if (/Linux|X11|CrOS/.test(ua) || /^Linux/.test(platform)) return 'linux'
  return 'unknown'
}

/** The label for an id — '' for 'unknown'. */
export function deviceLabel(id: DeviceId): string {
  return DEVICE_LABELS[id] ?? ''
}

// The real detection runs once: the platform cannot change under a running ad, and
// the token is re-rendered on every ticker frame of a live countdown.
let cached: DeviceId | null = null
// Editor preview: render as another platform without spoofing the browser. Export
// never sets it.
let override: DeviceId | null = null

export function setDeviceOverride(id: DeviceId | null | undefined): void {
  override = id && id in DEVICE_LABELS ? id : null
}

/** Read the signals off the global navigator/document, guarded for non-browser hosts. */
function browserSignals(): DeviceSignals {
  if (typeof navigator === 'undefined') return {}
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  let touch = false
  try {
    touch = typeof document !== 'undefined' && 'ontouchend' in document
  } catch {
    touch = false
  }
  return {
    ua: nav.userAgent,
    platform: nav.platform,
    hintPlatform: nav.userAgentData?.platform,
    maxTouchPoints: nav.maxTouchPoints,
    touch,
  }
}

/** The viewer's platform id: the preview override when one is set, else the (cached)
 * detection from the browser. */
export function currentDevice(): DeviceId {
  if (override) return override
  if (!cached) cached = detectDevice(browserSignals())
  return cached
}

/** What {device} renders. */
export function currentDeviceLabel(): string {
  return deviceLabel(currentDevice())
}

/** Test hook: forget the cached detection so the next currentDevice() re-reads. */
export function resetDeviceCache(): void {
  cached = null
}
