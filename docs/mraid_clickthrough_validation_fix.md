# MRAID Click-Through Validation Issue

## Purpose

This document explains the validation error found in the uploaded HTML creatives and describes the required code change.

The main issue is that the creatives use `window.open()` as a fallback for click-through behavior. The client-side validator requires click-throughs to use `mraid.open()` instead.

---

## Validation Error

The client checker reports an error similar to:

```text
Click-through — window.open() used — must use mraid.open() instead
```

This means the HTML contains a direct call to:

```js
window.open(...)
```

even though the creative also uses `mraid.open()`.

---

## Root Cause

The HTML files are MRAID creatives and already include:

```html
<script src="mraid.js"></script>
```

The click-through logic is designed to use `mraid.open()` when MRAID is available, but it falls back to `window.open()` when MRAID is unavailable or an error occurs.

The current logic is conceptually similar to:

```js
try {
    if (
        typeof mraid !== "undefined" &&
        typeof mraid.open === "function"
    ) {
        mraid.open(clickTarget);
        return;
    }
} catch (e) {
    // Fall through to window.open if mraid.open fails
}

window.open(clickTarget || "about:blank", "_blank", "noopener");
```

The client validator rejects this because `window.open()` appears in the creative.

---

## Required Fix

Remove the `window.open()` fallback completely.

The click-through should use `mraid.open()` only.

Recommended implementation:

```js
function handleClickThrough(clickTarget) {
    try {
        if (
            typeof mraid !== "undefined" &&
            typeof mraid.open === "function"
        ) {
            mraid.open(clickTarget);
        }
    } catch (e) {
        console.error("mraid.open failed", e);
    }
}
```

If the existing code already has a click handler, preserve the existing handler and replace only the part that calls `window.open()`.

---

## Important Cleanup

Remove all remaining references to `window.open` from the final production HTML.

This includes:

- Actual JavaScript calls to `window.open(...)`
- Comments mentioning `window.open`
- Header documentation mentioning a `window.open` fallback
- Dead or unused fallback code containing `window.open`

Some automated validators perform static text or code scanning, so even an unused `window.open()` reference may still cause the file to fail validation.

---

## Header Comment Update

If the file currently contains wording similar to:

```text
mraid.open() clickthrough handling with window.open fallback
```

change it to something like:

```text
mraid.open() clickthrough handling
```

---

## Expected Result After Fix

After removing `window.open()`:

- Click-through behavior should use `mraid.open()` only.
- The client's MRAID validation should no longer report the `window.open()` error.
- All uploaded creatives using the same template should be updated consistently.

---

## Additional QA Warning

The screenshot also contains a warning similar to:

```text
3 of 6 had no readable copy (text or images) — eyeball manually.
```

This appears to be a separate QA warning, not the main click-through failure.

The creatives contain video content embedded as Base64 data inside the HTML. Automated scanners may not be able to extract readable ad copy from the video itself.

This means those creatives may require manual visual review.

---

## AI Task Instructions

When modifying the creative files:

1. Find every occurrence of `window.open`.
2. Remove the `window.open()` fallback logic.
3. Keep `mraid.open(clickTarget)` as the only click-through method.
4. Remove comments that mention `window.open`.
5. Do not change the video, Base64 media data, styling, orientation logic, or unrelated MRAID behavior.
6. Preserve the original click target URL logic.
7. Verify that no `window.open` string remains anywhere in the final HTML.
8. Apply the same fix to every HTML creative generated from this template.

---

## Validation Checklist

Before delivery, confirm:

```text
[ ] mraid.js is still included
[ ] mraid.open() is used for click-through
[ ] window.open() does not exist anywhere in the file
[ ] No comments mention window.open
[ ] Click target URL is unchanged
[ ] Video playback behavior is unchanged
[ ] Portrait/landscape switching is unchanged
[ ] No unrelated JavaScript was modified
```

---

## Summary

The client upload/validation failure is caused by the presence of `window.open()` in the click-through fallback code.

The required fix is:

```text
REMOVE: window.open(...)
KEEP:   mraid.open(...)
```

Apply this change to all affected HTML files before resubmitting them to the client server.
