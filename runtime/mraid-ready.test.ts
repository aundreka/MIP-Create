// MRAID v2.0 compliance for the network layer. Two rules networks reject creatives over:
//   1. Nothing may call an MRAID API while the container is still loading — only
//      getState() and addEventListener('ready') are legal before the ready event.
//   2. Click-throughs go through mraid.open().
// Plus the lifecycle consequence of (1): if listener registration is skipped, the ad never
// pauses/mutes when it goes off screen or is closed.

import { describe, it, expect, afterEach, vi } from 'vitest'

type Listener = (...args: unknown[]) => void

/** A container stub that records every API touch, so a pre-ready call is visible. */
function makeMraid(opts: { state?: string; throwOn?: string[] } = {}) {
  const calls: string[] = []
  const listeners = new Map<string, Listener[]>()
  const mraid = {
    calls,
    listeners,
    state: opts.state ?? 'loading',
    getState() {
      calls.push('getState')
      return this.state
    },
    isViewable() {
      calls.push('isViewable')
      return true
    },
    open(url: string) {
      calls.push('open:' + url)
    },
    getVersion() {
      calls.push('getVersion')
      return '2.0'
    },
    supports() {
      calls.push('supports')
      return false
    },
    addEventListener(event: string, fn: Listener) {
      calls.push('addEventListener:' + event)
      if (opts.throwOn?.includes(event)) throw new Error('unsupported event ' + event)
      const arr = listeners.get(event) ?? []
      arr.push(fn)
      listeners.set(event, arr)
    },
    removeEventListener() {},
    fire(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args)
    },
  }
  return mraid
}

/** Everything the container is allowed to be asked before 'ready'. */
const PRE_READY_OK = new Set(['getState', 'addEventListener:ready'])

async function load() {
  vi.resetModules()
  return {
    net: await import('./networks'),
    emitter: await import('./emitter'),
  }
}

afterEach(() => {
  vi.useRealTimers()
  const W = window as unknown as Record<string, unknown>
  for (const key of ['mraid', 'isMraidUsable', 'PA_CLICKOUT', 'handleMraidOpen', 'handleTap', 'PA_TAP_RESET', 'clickTag', 'clickTag1', 'clickthrough', 'clickThrough']) delete W[key]
  vi.restoreAllMocks()
})

describe('MRAID readiness', () => {
  it('touches no MRAID API besides getState/ready while the container is loading', async () => {
    vi.useFakeTimers()
    const mraid = makeMraid({ state: 'loading' })
    ;(window as unknown as Record<string, unknown>).mraid = mraid
    const { net } = await load()

    const booted = net.initMraid(2000, 500)
    // Never fire 'ready': the timeout must release boot WITHOUT calling into MRAID.
    await vi.advanceTimersByTimeAsync(4000)
    await booted

    expect(mraid.calls.filter((c) => !PRE_READY_OK.has(c))).toEqual([])
  })

  it('registers the lifecycle listeners once the ready event arrives', async () => {
    vi.useFakeTimers()
    const mraid = makeMraid({ state: 'loading' })
    ;(window as unknown as Record<string, unknown>).mraid = mraid
    const { net, emitter } = await load()

    const booted = net.initMraid(2000, 500)
    mraid.state = 'default'
    mraid.fire('ready')
    await booted

    expect(mraid.calls).toContain('addEventListener:viewableChange')
    expect(mraid.calls).toContain('isViewable')

    const seen: string[] = []
    const offs = [
      emitter.on('ad-pause', () => seen.push('pause')),
      emitter.on('ad-resume', () => seen.push('resume')),
    ]
    mraid.fire('viewableChange', false)
    expect(seen).toContain('pause')
    for (const off of offs) off()
  })

  it('boots straight through when the container is already past loading', async () => {
    const mraid = makeMraid({ state: 'default' })
    ;(window as unknown as Record<string, unknown>).mraid = mraid
    const { net } = await load()

    await net.initMraid(2000, 500)
    expect(mraid.calls).toContain('addEventListener:viewableChange')
    expect(mraid.calls).not.toContain('addEventListener:ready')
  })

  it('still registers 2.0 listeners when a 3.0-only event is rejected', async () => {
    // A strict 2.0 container throws on exposureChange. Registration must continue —
    // viewableChange is what stops audio when the ad leaves the screen.
    const mraid = makeMraid({ state: 'default', throwOn: ['exposureChange', 'audioVolumeChange'] })
    ;(window as unknown as Record<string, unknown>).mraid = mraid
    const { net } = await load()

    await net.initMraid(2000, 500)
    expect(mraid.listeners.has('viewableChange')).toBe(true)
    expect(mraid.listeners.has('stateChange')).toBe(true)
  })

  it('pauses when the container reports the ad hidden (closed)', async () => {
    const mraid = makeMraid({ state: 'default' })
    ;(window as unknown as Record<string, unknown>).mraid = mraid
    const { net, emitter } = await load()
    await net.initMraid(2000, 500)

    const seen: string[] = []
    const off = emitter.on('ad-pause', () => seen.push('pause'))
    mraid.fire('stateChange', 'hidden')
    expect(seen).toEqual(['pause'])
    off()
  })

  it('routes the click-through through mraid.open()', async () => {
    const mraid = makeMraid({ state: 'default' })
    ;(window as unknown as Record<string, unknown>).mraid = mraid
    const { net } = await load()
    net.setStoreUrl({ ios: 'https://play.google.com/x', android: 'https://play.google.com/x' })

    net.triggerCTA()
    expect(mraid.calls.some((c) => c.startsWith('open:'))).toBe(true)
  })

  it('does not open through a still-loading container', async () => {
    const mraid = makeMraid({ state: 'loading' })
    ;(window as unknown as Record<string, unknown>).mraid = mraid
    const { net } = await load()
    net.setStoreUrl({ ios: 'https://play.google.com/x', android: 'https://play.google.com/x' })
    vi.spyOn(window, 'open').mockReturnValue(window)

    net.triggerCTA()
    expect(mraid.calls.some((c) => c.startsWith('open:'))).toBe(false)
  })

  it('opens through an expanded container', async () => {
    const mraid = makeMraid({ state: 'expanded' })
    ;(window as unknown as Record<string, unknown>).mraid = mraid
    const { net } = await load()
    net.setStoreUrl({ ios: 'https://play.google.com/x', android: 'https://play.google.com/x' })

    net.triggerCTA()
    expect(mraid.calls.some((c) => c.startsWith('open:'))).toBe(true)
  })

  it('defers to the shell guard (window.isMraidUsable) when the export installs one', async () => {
    // The head guard is armed before the runtime boots, so it can know about a 'ready'
    // that fired early. Its verdict wins over the runtime's own getState() read.
    const mraid = makeMraid({ state: 'default' })
    const W = window as unknown as Record<string, unknown>
    W.mraid = mraid
    W.isMraidUsable = () => false
    const { net } = await load()
    net.setStoreUrl({ ios: 'https://play.google.com/x', android: 'https://play.google.com/x' })
    vi.spyOn(window, 'open').mockReturnValue(window)

    net.triggerCTA()
    expect(mraid.calls.some((c) => c.startsWith('open:'))).toBe(false)
  })

  it('never falls back to the browser when mraid.open() throws', async () => {
    // Validators reject any non-MRAID click-through, so a failed open is logged, not retried.
    const mraid = makeMraid({ state: 'default' })
    mraid.open = () => { throw new Error('bridge failure') }
    ;(window as unknown as Record<string, unknown>).mraid = mraid
    const { net } = await load()
    net.setStoreUrl({ ios: 'https://apps.apple.com/x', android: 'https://apps.apple.com/x' })
    const open = vi.spyOn(window, 'open').mockReturnValue(window)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    net.triggerCTA()
    expect(open).not.toHaveBeenCalled()
  })

  it('routes the clickout through the shell handler (window.PA_CLICKOUT) when present', async () => {
    // The export shell publishes the guarded open longhand so validators can see it; the
    // runtime must actually use it rather than duplicating the call.
    const mraid = makeMraid({ state: 'default' })
    const W = window as unknown as Record<string, unknown>
    W.mraid = mraid
    const seen: unknown[] = []
    W.PA_CLICKOUT = (url: string) => { seen.push(url); return true }
    const { net } = await load()
    net.setStoreUrl({ ios: 'https://apps.apple.com/x', android: 'https://apps.apple.com/x' })
    const open = vi.spyOn(window, 'open').mockReturnValue(window)

    net.triggerCTA()
    expect(seen).toEqual(['https://apps.apple.com/x'])
    // The shell handler owns the open — no duplicate call into the container or the browser.
    expect(mraid.calls.some((c) => c.startsWith('open:'))).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('prefers window.handleMraidOpen over the older PA_CLICKOUT name', async () => {
    // The shell publishes one guarded open under both names. handleMraidOpen is the name
    // compliance tooling scans for, so it is the one the runtime reaches for first.
    const mraid = makeMraid({ state: 'default' })
    const W = window as unknown as Record<string, unknown>
    W.mraid = mraid
    const seen: string[] = []
    W.handleMraidOpen = (url: string) => { seen.push('handleMraidOpen:' + url); return true }
    W.PA_CLICKOUT = (url: string) => { seen.push('PA_CLICKOUT:' + url); return true }
    const { net } = await load()
    net.setStoreUrl({ ios: 'https://apps.apple.com/x', android: 'https://apps.apple.com/x' })

    net.triggerCTA()
    expect(seen).toEqual(['handleMraidOpen:https://apps.apple.com/x'])
  })

  it('does not fall back to the browser when the shell handler reports nothing opened', async () => {
    const mraid = makeMraid({ state: 'loading' })
    const W = window as unknown as Record<string, unknown>
    W.mraid = mraid
    W.PA_CLICKOUT = () => false
    const { net } = await load()
    net.setStoreUrl({ ios: 'https://apps.apple.com/x', android: 'https://apps.apple.com/x' })
    const open = vi.spyOn(window, 'open').mockReturnValue(window)

    net.triggerCTA()
    expect(open).not.toHaveBeenCalled()
  })
})

describe('click macro chain', () => {
  // Networks publish the destination under four different global names; hardcoding only
  // window.clickTag drops the click on the ones that use the others.
  // The macro is the destination; the click itself still goes through mraid.open().
  for (const key of ['clickTag', 'clickTag1', 'clickthrough', 'clickThrough']) {
    it(`redirects to window.${key} through mraid.open()`, async () => {
      const W = window as unknown as Record<string, unknown>
      const mraid = makeMraid({ state: 'default' })
      W.mraid = mraid
      W[key] = 'https://dsp.example/click'
      const { net } = await load()
      const open = vi.spyOn(window, 'open').mockReturnValue(window)

      net.triggerCTA()
      expect(mraid.calls).toContain('open:https://dsp.example/click')
      expect(open).not.toHaveBeenCalled()
    })
  }
})

describe('one action per gesture (tapOnce)', () => {
  it('collapses the ghost pair iOS fires for a single tap', async () => {
    const { net } = await load()
    const ran: number[] = []

    expect(net.tapOnce(() => ran.push(1))).toBe(true)
    // The compatibility click for the SAME touch, ~300ms later.
    expect(net.tapOnce(() => ran.push(2))).toBe(false)
    expect(ran).toEqual([1])
  })

  it('lets a deliberate second tap through once the window has passed', async () => {
    vi.useFakeTimers()
    const { net } = await load()
    const ran: number[] = []

    net.tapOnce(() => ran.push(1))
    vi.advanceTimersByTime(500)
    net.tapOnce(() => ran.push(2))
    expect(ran).toEqual([1, 2])
  })

  it('defers to the shell debounce (window.handleTap) when the export installs one', async () => {
    // Both halves must share ONE window, or a tap collapsed by the runtime still counts
    // against the shell's and the ad needs two taps to redirect.
    const W = window as unknown as Record<string, unknown>
    const seen: string[] = []
    W.handleTap = (run: () => void) => { seen.push('shell'); run(); return true }
    const { net } = await load()

    expect(net.tapOnce(() => seen.push('ran'))).toBe(true)
    expect(seen).toEqual(['shell', 'ran'])
  })

  it('clears the shell window too when the ad is re-shown', async () => {
    // Returning from the store is a fresh gesture: it must redirect on the FIRST tap.
    const W = window as unknown as Record<string, unknown>
    let reset = 0
    W.PA_TAP_RESET = () => { reset++ }
    const { net } = await load()

    net.tapOnce(() => {})
    net.resetCtaCooldown()
    expect(reset).toBe(1)
    expect(net.tapOnce(() => {})).toBe(true)
  })
})
