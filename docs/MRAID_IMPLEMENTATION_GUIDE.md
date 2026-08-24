# MRAID Implementation Guidelines

This guide defines the MRAID v2 integration required for AppLovin MIP deliverables and related tasks.

## Scope

Use these guidelines only for AppLovin MIP playable HTML builds.

The implementation must:

1. Declare the host-provided MRAID bridge exactly once.
2. Track MRAID readiness near the start of `<head>`.
3. Delay creative initialization while MRAID is loading.
4. Use `mraid.open()` for click-through inside an MRAID container.
5. Preserve the supported click-tag and browser fallbacks.
6. Pause and resume media based on MRAID viewability.
7. Keep the playable self-contained and within the AppLovin size limit.

## 1. Add the MRAID bridge

Place this declaration in `<head>` before the MRAID helper code:

```html
<script src="mraid.js"></script>
```

Requirements:

- Include this declaration exactly once in the top-level document.
- Use the relative path `mraid.js` exactly as shown.
- Do not use a CDN or absolute URL for the bridge.
- Do not bundle a local implementation of `mraid.js`; the ad container provides it at runtime.

## 2. Add the readiness helpers

Place the helpers immediately after the bridge and before the creative's bundled application code.

```html
<script>
  (function () {
    let mraidIsReady = false;
    let mraidReadyListenerAttached = false;

    function trackMraidReadiness(mraid) {
      if (
        mraidReadyListenerAttached ||
        !mraid ||
        typeof mraid.addEventListener !== "function"
      ) {
        return;
      }

      try {
        mraid.addEventListener("ready", function () {
          mraidIsReady = true;
        });
        mraidReadyListenerAttached = true;
      } catch (error) {
        // getState() remains the primary readiness check.
      }
    }

    window.isMraidUsable = function (mraid) {
      if (!mraid) {
        return false;
      }

      trackMraidReadiness(mraid);
      if (typeof mraid.getState !== "function") {
        return true;
      }

      try {
        const state = mraid.getState();
        return state === "default" || state === "expanded";
      } catch (error) {
        return mraidIsReady;
      }
    };
  })();
</script>
```

Use the named `trackMraidReadiness()` function and define `window.isMraidUsable` after the bridge so the integration remains consistent across MIP builds.

## 3. Gate creative initialization

Do not initialize layout, interaction, media playback, or orientation handling until MRAID is ready.

Use the AppLovin loading-state guard in this form:

```js
function init() {
  // Make this function idempotent before starting the creative.
}

if (typeof mraid === "undefined") {
  // Normal browser preview without an MRAID host.
  init();
} else {
  if (mraid.getState() === "loading") {
    mraid.addEventListener("ready", init);
  } else {
    init();
  }
}
```

Important:

- The comparison must be `mraid.getState() === "loading"`.
- The `ready` listener must be inside the same loading guard.
- An inverse condition such as `getState() !== "loading"` does not pass validation.
- `init()` should protect against running twice.

Example idempotency guard:

```js
let creativeInitialized = false;

function init() {
  if (creativeInitialized) return;
  creativeInitialized = true;

  // Initialize the creative here.
}
```

## 4. Handle click-through with MRAID

Resolve the standard click variables in this order, use `mraid.open()` when MRAID is usable, and retain the network/browser fallback:

```js
function handleClickAction() {
  const mraid = window.mraid || {};
  const clickTarget =
    window.clickTag ||
    window.clickTag1 ||
    window.clickthrough ||
    window.clickThrough ||
    "";

  if (
    typeof mraid.open === "function" &&
    window.isMraidUsable(mraid)
  ) {
    try {
      if (clickTarget) {
        mraid.open(clickTarget);
      } else {
        mraid.open();
      }
      return;
    } catch (error) {
      // Continue to the network or browser fallback.
    }
  }

  // Insert any network-specific click-through adapter here.
  window.open(clickTarget || "about:blank", "_blank", "noopener");
}
```

Requirements:

- Do not use only `window.open()` for the playable click action.
- Guard `mraid.open()` with `window.isMraidUsable(mraid)`.
- Wrap `mraid.open()` in `try/catch` so previews and non-MRAID environments can fall back safely.
- Keep all four supported click variables in the fallback chain.

## 5. Handle media viewability

Any build containing `<video>` or `<audio>` must use `mraid.isViewable()` and subscribe to `viewableChange`.

```js
let mraidViewable = true;

function syncMediaState() {
  const media = document.querySelectorAll("video, audio");
  media.forEach(function (element) {
    if (!mraidViewable) {
      element.pause();
    } else if (element.tagName === "VIDEO" && element.autoplay) {
      element.play().catch(function () {});
    }
  });
}

function setupMraidViewability() {
  if (typeof mraid === "undefined") return;

  function handleViewableChange(viewable) {
    mraidViewable = Boolean(viewable);
    syncMediaState();
  }

  if (typeof mraid.isViewable === "function") {
    try {
      mraidViewable = Boolean(mraid.isViewable());
    } catch (error) {
      mraidViewable = true;
    }
  }

  if (typeof mraid.addEventListener === "function") {
    mraid.addEventListener("viewableChange", handleViewableChange);
  }
}
```

Call `setupMraidViewability()` from `init()` before starting media playback.

## 6. Package the AppLovin MIP

Apply these packaging rules to the final AppLovin MIP build:

- The HTML file must be no larger than 5 MB.
- Images, fonts, media, styles, and scripts must be embedded or otherwise self-contained.
- Remote `http://`, `https://`, protocol-relative, and WebSocket resources are blocked.
- Runtime requests such as `fetch`, XMLHttpRequest, WebSocket, `sendBeacon`, EventSource, dynamic imports, jQuery AJAX, Axios, and service workers must not call external URLs.
- Navigation through the approved click-through path is allowed.
- The relative `<script src="mraid.js"></script>` declaration is allowed because the ad host supplies it.

Prefer `data:` URIs for embedded assets. Do not convert the MRAID bridge to a data URI.

## Acceptance requirements

Before delivery, confirm that the final HTML includes:

- Exactly one MRAID bridge.
- `trackMraidReadiness()` and `window.isMraidUsable()` after the bridge in `<head>`.
- The loading-state and ready-event initialization guard.
- A guarded `mraid.open()` inside `try/catch`.
- The four click-target variables and a `window.open()` fallback.
- `isViewable()` and `viewableChange` when media is present.

## Common validation failures

| Message or symptom | Cause | Fix |
| --- | --- | --- |
| Add exactly one MRAID bridge | The bridge is missing, duplicated, escaped inside generated markup, or uses an absolute URL | Keep one top-level `<script src="mraid.js"></script>` in `<head>` |
| Place readiness helpers after the bridge | Helpers are missing, renamed, placed before the bridge, or buried inside the bundled application code | Put the reference helper block immediately after the bridge in `<head>` |
| Missing AppLovin loading-state guard | The condition is inverted or the ready listener is outside the guard | Use the exact `getState() === "loading"` pattern shown above |
| Missing `mraid.open()` | Clicks use only anchors or `window.open()` | Route the primary click action through `mraid.open()` |
| Guard `mraid.open()` | The call is unguarded or not protected by `try/catch` | Check `window.isMraidUsable(mraid)` and wrap the call |
| Missing click fallback | One or more supported click variables or `window.open()` is absent | Use the complete click-target chain |
| Missing media viewability | A video or audio element exists without MRAID lifecycle handling | Add `isViewable()` and `viewableChange` handling |
| External resources found | The build references a CDN, remote asset, or runtime network request | Embed the asset and remove the external request |

## Preflight checklist

- [ ] The bridge appears exactly once and uses `src="mraid.js"`.
- [ ] Readiness helpers immediately follow the bridge in `<head>`.
- [ ] Creative startup waits for `ready` when state is `loading`.
- [ ] `init()` is safe to call only once.
- [ ] The primary click action uses guarded `mraid.open()`.
- [ ] All four click variables and the browser fallback are present.
- [ ] Media pauses and resumes through MRAID viewability events.
- [ ] All creative assets are self-contained.
- [ ] The final HTML is 5 MB or smaller.
