# AppLovin Rendering Artifact Guide

AppLovin's Chromium WebView produces a recurring class of visual artifacts on every MIP export. This guide explains each one, why it happens, and the exact fix. Read this before debugging any "white edge / bar edge / overlay edge" complaint.

---

## 1. Bar edges (top / left / right of the header bar)

**What you see:** 1–3 px lighter strip at the top, left, or right of the header bar.

**Why it happens:**
AppLovin's physical screen extends 1–3 px BEYOND the CSS viewport boundary. The gap is normally filled by `pa-bleed` (using the scene background color). If the bar color ≠ scene background color, that gap is visibly tinted.

`position:absolute` bars are clipped by pa-root's `overflow:hidden` at the CSS viewport edge, so they can't reach the physical gap.

Even `position:fixed; top:-6px` doesn't help **unless the element has its own GPU compositing layer**. This is because `overflow:hidden` on an `isolation:isolate` element clips `position:fixed` children that share the parent's paint layer — it's a Chromium-specific compositing behavior.

**The fix (in `applyBarExtend` for `pin === 'top'` / autoTop bars):**

```ts
const BLEED = 6
outer.style.position = 'fixed'
outer.style.top    = -BLEED + 'px'
outer.style.left   = -BLEED + 'px'
outer.style.width  = `calc(100% + ${2 * BLEED}px)`
outer.style.height = Math.max(0, naturalTop + h + BLEED) + 'px'
// translateZ(0) is mandatory — it promotes the element to its own GPU layer
// so it composites at the viewport level and escapes pa-root's overflow clip.
outer.style.transform = e.rotation ? `rotate(${e.rotation}deg) translateZ(0)` : 'translateZ(0)'
```

**Golden rule:** `translateZ(0)` on any element that must physically extend beyond the CSS viewport. Without it, the bleed is silently clipped to `top:0`.

---

## 2. Overlay dim edges

**What you see:** 1–3 px white strip at the top or sides of the dim overlay.

**Why it happens (two separate causes):**

**A. `pa-bleed` created inside the overlay div**
`pa-bleed` is `position:fixed; z-index:0` inside `overlayDiv` (z-index:9000). It joins the overlay's stacking context and blankets the game content, making the dim invisible and causing edge artifacts.

Fix: skip `pa-bleed` creation when `opts.float === true` (overlay scenes).

**B. `??` instead of `||` for background colors**
`scene.meta.bgMatchColor` can be an empty string `''`. The `??` operator treats `''` as a valid value (only catches `null`/`undefined`). This leaves `body.background`, `html.background`, and `--pa-bg` as empty strings → transparent → browser fills with white.

Fix: use `||` everywhere:
```ts
document.body.style.background = scene.meta.bgMatchColor || '#000'
document.documentElement.style.background = scene.meta.bgMatchColor || '#000'
root.style.setProperty('--pa-bg', scene.meta.bgMatchColor || '#000000')
```

---

## 3. White flash when overlay appears or disappears

**What you see:** Brief white bleeding edges when the overlay fades in or out.

**Why it happens:** Applying `filter:blur()` to the game root during overlay mount/dismiss forces Chromium to create or destroy a GPU compositing layer. AppLovin's compositor fills the momentarily-empty layer slot with white.

**Fix:** Never apply `filter:blur()` to the game root during overlay transitions. No blur.

---

## 4. Immune elements hidden under the overlay

**What you see:** The header bar (`.pa-el--immune`) disappears under the dim instead of floating above it.

**Why it happens:**
`isolation:isolate` on pa-root creates a stacking context. Every child — including `position:fixed` children — is painted within pa-root's compositing layer. Pa-root itself sits at `z-index:1` inside pa-stage. Setting `z-index:10000` on an element inside pa-root has no effect from pa-stage's perspective; it still loses to `overlayDiv` at `z-index:9000` in pa-stage.

**Fix:** Move immune elements to `stageContainer` (pa-stage) directly during overlay:
```ts
// On overlay open:
const savedParents = immuneEls.map((el) => el.parentElement)
const savedZ       = immuneEls.map((el) => el.style.zIndex)
immuneEls.forEach((el) => {
  stageContainer.appendChild(el)  // escape pa-root's stacking context
  el.style.zIndex = '10000'       // now directly beats overlayDiv (9000)
})

// On overlay close (cleanup):
immuneEls.forEach((el, i) => {
  savedParents[i]?.appendChild(el)
  el.style.zIndex = savedZ[i]
})
```

The element's `position:fixed` layout (top/left/width/height with bleed offsets) is viewport-relative and doesn't change when the DOM parent changes.

**Important:** Before moving an element, resolve any `var(--pa-bg)` references to a literal hex so the inline style survives outside pa-root:
```ts
const paBg = (el.closest<HTMLElement>('.pa-root')?.style.getPropertyValue('--pa-bg') ?? '') || '#000000'
```

---

## 5. Bar edge compositor blend during overlay (beige / wrong-color 1px at top/left)

**What you see:** Before the overlay, the bar's top/left edge shows a faint dark strip. During the overlay (endscene), that strip turns beige (or the endscene's background color).

**Why it happens:**
`translateZ(0)` on the bar promotes it to a GPU compositing layer. Chrome composites this layer against pa-stage's rect. At the clip boundary (top:0, left:0), Chrome anti-aliases the GPU layer edge — the 1px blend picks up whatever is **directly behind the bar in pa-stage's stacking context**:
- Before overlay → dark game content (blend is invisible)
- During overlay → `overlayDiv` (z:9000) with the endscene's beige bg → visible beige strip

**Fix (in `scene-overlay` handler, `scenes.ts`):**
Strip `translateZ(0)` from immune elements when moved to pa-stage. Non-promoted `position:fixed` elements use paint-layer clipping (sharp cut, no anti-aliasing). No GPU layer edge → no compositor blend artifact.

```ts
const savedTransform = immuneEls.map((el) => el.style.transform)
immuneEls.forEach((el) => {
  stageContainer.appendChild(el)
  el.style.zIndex = '10000'
  // Strip translateZ so the bar is non-GPU-promoted in pa-stage.
  // GPU-promoted layers get compositor-clipped at pa-stage's rect and
  // anti-aliased against overlayDiv (beige endscene) behind them.
  const t = el.style.transform
  el.style.transform = t.replace(/\s*translateZ\(0\)/gi, '').trim() || 'none'
})
// restore in cleanup:
immuneEls.forEach((el, i) => { el.style.transform = savedTransform[i] })
```

**Belt-and-suspenders (in `applyBarExtend`, `stage.ts`):**
Guard against `relayout()` (resize) restoring `translateZ` while the bar is mid-overlay:

```ts
const inImmune = !outer.closest('.pa-root') && !!outer.closest('.pa-stage')
if (!inImmune) {
  outer.style.transform = e.rotation ? `rotate(${e.rotation}deg) translateZ(0)` : 'translateZ(0)'
}
```

---

## Pre-export checklist

Before shipping any AppLovin MIP:

- [ ] Header bar has `position:fixed` + `translateZ(0)` + 6 px bleed on all sides
- [ ] All background color assignments use `||`, not `??`
- [ ] `pa-bleed` is skipped in float/overlay scenes (`!opts.float`)
- [ ] No `filter:blur()` applied to game root during any transition
- [ ] Immune elements move to `stageContainer` (not just change z-index) when overlay opens
- [ ] `--pa-bg` is resolved to a literal hex before any DOM reparenting
