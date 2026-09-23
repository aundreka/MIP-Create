# MRAID v2.0 — the standard every export follows

Every playable this editor exports ships MRAID v2.0 compliance by default: the bridge
declaration, the readiness guard, a guarded clickout and the viewability lifecycle. This
is the spec those pieces implement, plus a map of where each one lives in this repo.

The validation error this exists to prevent:

> **"MRAID v2.0 support — mraid present but no ready-event / getState() guard"**

The `mraid` object is injected into `window` *before* the native container has finished
setting up the ad environment. During that stage `mraid.getState()` returns `"loading"`,
and calling any MRAID method (especially `open()` / `expand()`) violates the spec — it
causes crashes, rejected clicks and failed validator scans.

## Where it lives

| Piece | File |
| --- | --- |
| Bridge tag + `window.isMraidUsable()` head guard, injected into every export | `MRAID_HEAD` in [src/export.ts](../src/export.ts) |
| Initialization gate (waits for ready before starting the creative) | `MRAID_BOOT` in [src/export.ts](../src/export.ts) + `PA_START` in [runtime/export-entry.ts](../runtime/export-entry.ts) |
| Same guard for shells without the head script (preview, Vite source export) | `mraidUsable()` in [runtime/networks.ts](../runtime/networks.ts) |
| Guarded clickout, written longhand for the scan | `window.PA_CLICKOUT` in `MRAID_HEAD` ([src/export.ts](../src/export.ts)) |
| Guarded clickout + the click-macro fallback chain | `triggerCTA()` in [runtime/networks.ts](../runtime/networks.ts) |
| Ready/lifecycle registration, viewability, volume | `initMraid()` / `registerMraid()` in [runtime/networks.ts](../runtime/networks.ts) |
| Build-time enforcement (every network) | [src/preflight.ts](../src/preflight.ts) |
| Unit tests | [runtime/mraid-ready.test.ts](../runtime/mraid-ready.test.ts) |
| Real-export check in headless Chrome against a hostile 2.0 container | `node scripts/mraid-check.mjs` |

## Lifecycle

```
[*] --> loading      container injects mraid.js
loading --> default  mraid fires "ready" (getState() === 'default')
default --> expanded mraid.expand()
expanded --> default mraid.close()
default/expanded --> hidden   ad closed / dismissed
```

Valid states for calling into the container: `default` and `expanded`. While `loading`,
the only two things a creative may touch are `getState()` and
`addEventListener('ready', …)`.

## 1. Bridge declaration

```html
<script src="mraid.js"></script>
```

Goes in `<head>` of every export, regardless of network. It is a relative path the
container replaces with its own implementation; outside a container it 404s harmlessly and
is not an external resource for preflight purposes.

## 2. Head guard

Placed in `<head>` ahead of the creative bundle — some containers attach `window.mraid`
asynchronously, so the `ready` listener must be armed before that lands.

```html
<script>
  (function () {
    let mraidIsReady = false
    let mraidReadyListenerAttached = false

    // Subscribe to "ready" once; handles async injection of window.mraid.
    function trackMraidReadiness(mraid) {
      if (mraidReadyListenerAttached || !mraid || typeof mraid.addEventListener !== 'function') return
      try {
        mraid.addEventListener('ready', () => { mraidIsReady = true })
        mraidReadyListenerAttached = true
      } catch (err) {
        // Some non-standard containers throw on addEventListener;
        // getState() remains the primary check.
      }
    }

    // True when mraid.open() is safe to call per the MRAID contract.
    window.isMraidUsable = function (mraid) {
      if (!mraid) return false
      trackMraidReadiness(mraid)
      // Minimal/mock MRAID objects without getState() are treated as usable.
      if (typeof mraid.getState !== 'function') return true
      try {
        const state = mraid.getState()
        return state === 'default' || state === 'expanded'
      } catch (err) {
        return mraidIsReady // fall back to whether "ready" fired
      }
    }
  })()
</script>
```

## 2b. Initialization gate — write it longhand

**Validators static-scan the file.** Compliance that is only *behaviourally* correct fails
the scan: after minification the bundle's own wait reads `f.addEventListener("ready",a)`
and `e.getState()`, so a scanner looking for `mraid.addEventListener("ready", …)` and a
`getState() === "loading"` comparison finds neither and reports

> "Wait for mraid.ready or confirm mraid.getState() is not 'loading' before initialization."

So the gate is emitted as plain source at the end of `<body>`, after the runtime bundle,
with `mraid` as the literal identifier — and it is the real gate, not a decoration: the
head sets `window.PA_MRAID_GATE`, which makes the bundle publish `window.PA_START()`
instead of starting itself.

```javascript
(function () {
  var started = false
  function startCreative() {
    if (started) return
    started = true
    window.PA_MRAID_WAITED = true // the runtime skips its own duplicate wait
    if (typeof window.PA_START === "function") window.PA_START()
  }

  var mraid = window.mraid
  if (!mraid || typeof mraid.getState !== "function") { startCreative(); return }  // no container

  try {
    if (mraid.getState() === "loading") {                              // the guard, verbatim
      if (typeof mraid.addEventListener === "function") {
        mraid.addEventListener("ready", startCreative)                 // the only legal signal
      }
      window.setTimeout(startCreative, 2500)                           // never leave a blank ad
    } else {
      startCreative()
    }
  } catch (e) {
    // state unreadable — treat it as loading: same wait, same backstop (repeated on
    // purpose; hoisting it into a shared helper is what breaks the scan)
  }
})()
```

Three things about that shape are load-bearing, and each one was learned from a rejection:

1. **`mraid.getState()` is called inline**, not through a `getMraidState()` helper — a
   helper leaves no `mraid.getState()` in the file.
2. **It is an `if` statement**, not `var loading = mraid.getState() === "loading"` — the
   scanner looks for the guard, and a comparison stashed in a variable is not one.
3. **The `ready` subscription sits inside the branch**, not in a `waitForReady()` helper the
   branch calls — the scanner reads the branch body and has to find
   `mraid.addEventListener("ready", …)` there.

The same guard is also armed in `<head>`, ahead of the bundle: that is where "before
initialization" is visible to a reader, and a container can fire `ready` before the bundle
has finished parsing.

Rule of thumb: **any MRAID call a validator needs to see must appear in unminified source
with `mraid.` in front of it.** Aliases (`W.mraid`, a `m` parameter) and mangled bundle
identifiers are invisible to the scan.

## 3. Guarded clickout

Every CTA, endcard and clickout goes through one handler that checks the guard, wraps
`open()` in `try/catch`, and falls back to the browser. For the same static-scan reason as
the gate, it is emitted longhand into `<head>` as `window.PA_CLICKOUT` — inside the
minified bundle the identical code reads `Pa(tt.mraid)` and a validator sees an unguarded
`mraid.open()`.

```javascript
window.PA_CLICKOUT = function (url) {
  var mraid = window.mraid || {}

  // No single global is universal across DSPs / networks.
  var clickTarget =
    url || window.clickTag || window.clickTag1 || window.clickthrough || window.clickThrough || ''

  if (typeof mraid.open === 'function' && window.isMraidUsable(mraid)) {
    try {
      if (clickTarget) mraid.open(clickTarget)
      else mraid.open('')        // container substitutes its own configured store URL
      return true
    } catch (e) {
      // fall through to the browser fallback
    }
  }

  if (!clickTarget) return false
  try {
    return !!window.open(clickTarget, '_blank', 'noopener')
  } catch (e) {
    return false
  }
}
```

It returns `true` only when something actually opened. `triggerCTA()` calls it at the MRAID
step and treats `false` as "keep going", so a blocked popup still reaches the same-tab
retry below it.

This repo's `triggerCTA()` is the same contract inside a longer SDK priority chain
(ExitApi → FbPlayableAd → Luna → playableSDK → Mintegral → click macros → Vungle →
TikTok → **MRAID** → browser), and it passes the project's store URL rather than
`about:blank`. Empty string is deliberate for the MRAID branch: containers substitute
their own configured store URL, so a click still registers for `clickUrlMode: 'none'`
creatives.

## 4. Viewability and audio

MRAID v2.0 requires media to stop when the ad is not viewable. The runtime registers
`viewableChange` / `stateChange` (plus the 3.0 `exposureChange` / `audioVolumeChange` when
the container has them) and folds them into a single `ad-pause` / `ad-resume` signal that
stops audio, video and gameplay.

```javascript
function setupMraidViewability() {
  if (typeof mraid === 'undefined') return

  function handleViewableChange(viewable) {
    if (viewable) {
      // resume animations / audio
    } else {
      document.querySelectorAll('video, audio').forEach((el) => el.pause())
    }
  }

  if (typeof mraid.isViewable === 'function') handleViewableChange(mraid.isViewable())
  if (typeof mraid.addEventListener === 'function') mraid.addEventListener('viewableChange', handleViewableChange)
}
```

Register each listener in its **own** `try/catch`. A 2.0-only container throws on a
3.0-only event name, and one shared try block would skip every listener after it —
including `viewableChange`, the one that silences the ad off screen.

## Anti-patterns

| Anti-pattern | Why it fails | Fix |
| --- | --- | --- |
| `if (window.mraid) { mraid.open() }` | Ignores `getState() === 'loading'`. Violates the spec. | Check `window.isMraidUsable(mraid)` first. |
| Only `window.clickTag` | Networks use `clickTag`, `clickTag1`, `clickthrough`, or `clickThrough`. | Use the full fallback chain. |
| No `try/catch` around `mraid.open()` | Native containers throw on a bad URL or a failed bridge. | Wrap it; fall back to `window.open()`. |
| `ready` listener attached only at page load | Some containers inject `window.mraid` asynchronously. | Re-run `trackMraidReadiness()` on every `isMraidUsable()` query. |
| `if (mraid.getState() === "loading") waitForReady()` | Scanner reads the branch body and finds no `ready` subscription. | Inline `mraid.addEventListener("ready", …)` inside the branch. |
| Arming a click cooldown before the redirect fires | A no-op click (blocked popup, missing SDK) blocks the user's next real tap. | Arm it only after something actually opened. |

## Pre-flight checklist

- [ ] `<head>` includes `<script src="mraid.js">` and the `isMraidUsable` guard.
- [ ] A literal `mraid.getState() === "loading"` gate holds initialization, with
      `mraid.addEventListener("ready", …)` as the release.
- [ ] Every clickout checks `window.isMraidUsable(mraid)` before calling `mraid.open()`,
      in source a scanner can read — not only inside the bundle.
- [ ] `mraid.open()` is wrapped in `try/catch` with a `window.open()` fallback.
- [ ] The `clickTag` / `clickTag1` / `clickthrough` / `clickThrough` chain is implemented.
- [ ] No raw, unguarded `mraid.open(...)` in inline or minified scripts.
- [ ] Video / audio respect `viewableChange` and pause off screen.

Everything but the last is enforced on every export by `preflightNetwork()`; run
`node scripts/mraid-check.mjs` to verify all of them against a real export in headless
Chrome.
