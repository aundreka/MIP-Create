// The {device} token: the shared countdown formatter renders the viewer's platform
// (iOS / Android / Windows / Mac / Linux) detected once from the browser. Detection is
// a pure function of the navigator signals so every branch is pinned here.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DEVICE_IDS, currentDevice, currentDeviceLabel, deviceLabel, detectDevice, resetDeviceCache, setDeviceOverride } from './elements/device'
import { formatCountdown, needsMidnightRefresh, renderCountdownFormat } from './elements/countdown'
import type { SceneElement } from './scene'

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadLegacy: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ "Request Desktop Website" default: identical to a Mac UA.
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  windowsPhone: 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.14977',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

const el = (format: string, extra: Record<string, unknown> = {}): SceneElement => ({
  id: 'cd', type: 'countdown', name: 'cd', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit',
  countdown: { mode: 'dynamic', dynamicDays: 3, format, ...extra },
})

describe('detectDevice', () => {
  it('reads iOS from iPhone / iPad user agents and platforms', () => {
    expect(detectDevice({ ua: UA.iphone })).toBe('ios')
    expect(detectDevice({ ua: UA.ipadLegacy })).toBe('ios')
    expect(detectDevice({ platform: 'iPhone' })).toBe('ios')
    expect(detectDevice({ platform: 'iPad' })).toBe('ios')
  })

  // The UA is byte-for-byte a Mac; only the touch surface says otherwise.
  it('unmasks an iPad that presents as a Mac by its touch screen', () => {
    expect(detectDevice({ ua: UA.ipadDesktop })).toBe('mac')
    expect(detectDevice({ ua: UA.ipadDesktop, touch: true })).toBe('ios')
    expect(detectDevice({ ua: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios')
    expect(detectDevice({ ua: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('mac')
  })

  // Every Android UA also says "Linux" — Android has to win.
  it('reads Android before Linux', () => {
    expect(detectDevice({ ua: UA.android })).toBe('android')
    expect(detectDevice({ ua: UA.androidWebView })).toBe('android')
    expect(detectDevice({ ua: UA.android, platform: 'Linux armv8l' })).toBe('android')
  })

  it('reads Windows, including Windows Phone whose UA also says Android', () => {
    expect(detectDevice({ ua: UA.windows })).toBe('windows')
    expect(detectDevice({ ua: UA.windowsFirefox })).toBe('windows')
    expect(detectDevice({ ua: UA.windowsPhone })).toBe('windows')
    expect(detectDevice({ platform: 'Win32' })).toBe('windows')
  })

  it('reads Mac from the UA or platform when there is no touch screen', () => {
    expect(detectDevice({ ua: UA.mac })).toBe('mac')
    expect(detectDevice({ ua: UA.mac, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('mac')
    expect(detectDevice({ platform: 'MacIntel' })).toBe('mac')
  })

  it('reads Linux, Ubuntu and ChromeOS as Linux', () => {
    expect(detectDevice({ ua: UA.linux })).toBe('linux')
    expect(detectDevice({ ua: UA.linuxFirefox })).toBe('linux')
    expect(detectDevice({ ua: UA.chromeOs })).toBe('linux')
    expect(detectDevice({ platform: 'Linux x86_64' })).toBe('linux')
  })

  // Chromium has frozen the UA string; the client hint is the truthful field there.
  it('prefers the userAgentData client hint over the UA string', () => {
    expect(detectDevice({ ua: UA.mac, hintPlatform: 'Windows' })).toBe('windows')
    expect(detectDevice({ ua: UA.linux, hintPlatform: 'Android' })).toBe('android')
    expect(detectDevice({ ua: UA.windows, hintPlatform: 'macOS' })).toBe('mac')
    expect(detectDevice({ ua: UA.windows, hintPlatform: 'Chrome OS' })).toBe('linux')
    expect(detectDevice({ ua: UA.windows, hintPlatform: 'Linux' })).toBe('linux')
    expect(detectDevice({ ua: UA.windows, hintPlatform: 'iOS' })).toBe('ios')
  })

  it('falls through to the UA when the hint is empty or unrecognised', () => {
    expect(detectDevice({ ua: UA.android, hintPlatform: '' })).toBe('android')
    expect(detectDevice({ ua: UA.android, hintPlatform: 'Fuchsia' })).toBe('android')
  })

  it('is unknown (and renders empty) when nothing matches', () => {
    expect(detectDevice({})).toBe('unknown')
    expect(detectDevice({ ua: 'curl/8.4.0' })).toBe('unknown')
    expect(deviceLabel('unknown')).toBe('')
  })

  it('labels every id with its display copy', () => {
    expect(DEVICE_IDS.map(deviceLabel)).toEqual(['iOS', 'Android', 'Windows', 'Mac', 'Linux'])
  })
})

describe('{device} in the shared formatter', () => {
  beforeEach(() => {
    resetDeviceCache()
    setDeviceOverride('ios')
  })
  afterEach(() => {
    setDeviceOverride(null)
    resetDeviceCache()
  })

  it('renders the platform label, and {os} is an alias', () => {
    const t = Date.now()
    expect(renderCountdownFormat('{device}', t, t)).toBe('iOS')
    expect(renderCountdownFormat('{os}', t, t)).toBe('iOS')
    expect(renderCountdownFormat('Get it on {device}', t, t)).toBe('Get it on iOS')
  })

  it('follows the override for every platform', () => {
    const t = Date.now()
    for (const id of DEVICE_IDS) {
      setDeviceOverride(id)
      expect(renderCountdownFormat('{device}', t, t)).toBe(deviceLabel(id))
    }
  })

  it('honours textCase like every other token', () => {
    const t = Date.now()
    setDeviceOverride('android')
    expect(renderCountdownFormat('{device}', t, t, { textCase: 'upper' })).toBe('ANDROID')
    expect(renderCountdownFormat('{device}', t, t, { textCase: 'lower' })).toBe('android')
  })

  it('composes with a live timer and with date tokens', () => {
    const now = new Date(2026, 8, 1, 12).getTime()
    setDeviceOverride('windows')
    expect(formatCountdown(el('{device} — {hh}:{mm}:{ss}', { mode: 'timer' }), now + 3661000, now)).toBe('Windows — 01:01:01')
    expect(formatCountdown(el('{device} offer ends {date}'), now + 3 * 86400000, now)).toBe('Windows offer ends Sep 4, 2026')
  })

  // {os} must not be eaten by the {o} ordinal-suffix or {ss} seconds tokens, and {device}
  // must survive the {d} days token.
  it('does not collide with the {o}, {d} or {ss} tokens', () => {
    const t = Date.now()
    setDeviceOverride('mac')
    expect(renderCountdownFormat('{os}{o}', t, t)).toMatch(/^Mac(st|nd|rd|th)$/)
    expect(renderCountdownFormat('{d} {device}', t, t)).toBe('0 Mac')
  })

  it('renders empty on an unknown platform rather than a placeholder', () => {
    const t = Date.now()
    setDeviceOverride('unknown')
    expect(renderCountdownFormat('[{device}]', t, t)).toBe('[]')
  })

  it('leaves an unknown-looking literal alone', () => {
    const t = Date.now()
    expect(renderCountdownFormat('device {device}', t, t)).toBe('device iOS')
  })

  it('does not need a midnight refresh — the platform never changes', () => {
    expect(needsMidnightRefresh('{device}')).toBe(false)
    expect(needsMidnightRefresh('Get it on {os}')).toBe(false)
  })
})

describe('currentDevice', () => {
  beforeEach(() => {
    setDeviceOverride(null)
    resetDeviceCache()
  })

  it('reads the browser once and caches; an override wins and a cleared one restores', () => {
    const real = currentDevice()
    expect(DEVICE_IDS.includes(real) || real === 'unknown').toBe(true)
    setDeviceOverride('linux')
    expect(currentDevice()).toBe('linux')
    expect(currentDeviceLabel()).toBe('Linux')
    setDeviceOverride(null)
    expect(currentDevice()).toBe(real)
  })

  it('ignores a bogus override value', () => {
    const real = currentDevice()
    setDeviceOverride('toaster' as never)
    expect(currentDevice()).toBe(real)
  })
})
