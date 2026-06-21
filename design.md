# Design System — Playable Ad Editor

This document describes the editor's UI design system: tokens, theming, icons, the
shared component layer, and the conventions that keep the surface consistent. It
covers the **editor chrome only** — the rendered ad (inside an isolated `<iframe>`)
is never touched by these styles.

> Golden rule: the editor theme styles the *tool*, never the *ad*. The ad renders
> in `runtime-frame.html` via `postMessage`; editor CSS cannot reach inside it.
> Never post theme tokens into the iframe.

**Look & feel:** minimal, compact, modern. Type is **Montserrat** (loaded in
`index.html`, with a system stack fallback for offline). Chrome surfaces use
**glassmorphism** — translucent, blurred panels over an ambient gradient
(`.app` background). Accent-tinted, low-contrast states; few hard borders.

---

## 1. Theming

Two themes (light + dark) share one token contract. The active theme is a single
attribute on `<html>`:

```html
<html data-theme="dark">   <!-- or "light" -->
```

- **Scales** (spacing, radius, type, motion) are theme-independent → defined once in `:root`.
- **Colors + shadows** are theme-specific → defined in `:root, [data-theme="dark"]` and `[data-theme="light"]`.

Both palettes are always present in the stylesheet, so flipping the attribute
re-themes instantly with no flash and no reflow.

**State & toggle** — `src/theme.ts`
- `initTheme()` runs in `main.tsx` *before* `createRoot` (no flash). Idempotent (StrictMode-safe).
- Persisted to `localStorage` key `pa:theme`; falls back to `prefers-color-scheme`, then dark.
- `useTheme()` is a `useSyncExternalStore` hook; `toggleTheme()` flips + persists + notifies.
- The toggle button (Sun/Moon) lives in the Topbar; the command palette also exposes it.

**Why theme state is NOT in `store.ts`** — `store.ts` snapshots `project`+`assets`
into undo/redo history and is debounce-autosaved. UI preferences (theme, accordion
open/closed, layer-group collapse) must never enter that history, so they live in
separate `localStorage` modules: `src/theme.ts` and `src/uiState.ts`.

---

## 2. Tokens

All tokens are CSS custom properties in `src/editor.css`. **Never hardcode a hex**
in a component rule — route it through a token. The only sanctioned literal is
`#fff` for icons/handles that sit *on top of* the accent color or the artboard.

### Scales (theme-independent, `:root`)

| Group | Tokens | Values |
|-------|--------|--------|
| Spacing | `--s1 --s2 --s3 --s4 --s5` | 4 / 8 / 12 / 16 / 24 px |
| Radius | `--r-sm --r-md --r-lg --r-pill` | 6 / 8 / 12 / 999 px |
| Type | `--fs-xs --fs-sm --fs-md --fs-lg` | 11 / 12 / 13 / 16 px |
| Motion | `--t-fast --t-mid --ease` | 120ms / 200ms / `cubic-bezier(.2,.7,.2,1)` |

### Colors + shadows (per theme)

| Token | Role |
|-------|------|
| `--bg` | app background |
| `--panel` / `--panel-2` | panel surface / hover & secondary surface |
| `--line` | borders / dividers |
| `--ink` / `--text` | primary text (`--text` is an alias kept for legacy refs) |
| `--muted` | secondary text, icons at rest |
| `--accent` | primary interactive (buttons, selection, focus ring) |
| `--accent-2` | success / size-meter green |
| `--danger` | destructive actions, warnings |
| `--guide` | snap guides (pink) |
| `--selected` | the **one** selected-state fill (collapsed the old `#1a2748`/`#25407e`) |
| `--input-bg` | input / track / sunken-cell fill |
| `--surface-sunken` | dashed cards, blank-card fill |
| `--canvas-bg` | flat workspace behind the artboard |
| `--checker-a` / `--checker-b` | transparency checker (preview stage, project thumbs) |
| `--artboard-void` | the artboard frame — **identical in both themes** (always black) |
| `--sh-1 / --sh-2 / --sh-3` | elevation ramp (subtle → modal) |
| `--glass-bg` | translucent panel fill (chrome surfaces) |
| `--glass-strong` | denser glass for floating surfaces (modals, menus, tooltips) |
| `--glass-border` | hairline glass edge (white-ish, low alpha) |
| `--glass-hi` | top inset highlight / faint fill for chips & hover |
| `--glass-blur` | backdrop blur radius (px) |

To add a token: add it to **both** theme blocks (and `:root` if it's a scale).
To add a new theme: copy a `[data-theme]` block and reassign the color/shadow set —
nothing else changes.

### Glassmorphism

Chrome surfaces are frosted glass. The recipe (drive it with tokens):

```css
background: var(--glass-bg);                 /* or --glass-strong for floats */
backdrop-filter: blur(var(--glass-blur));
-webkit-backdrop-filter: blur(var(--glass-blur));
border: 1px solid var(--glass-border);
box-shadow: inset 0 1px 0 var(--glass-hi);   /* subtle top highlight */
```

Applied to: topbar, scenes strip, tool rail, side panels + sticky titles, modals,
preview modal, command palette, asset popover, context menu, tooltips. The blur
needs something behind it — that's the **ambient gradient** painted on `.app`
(two accent/`accent-2` radial glows over `--bg`). Glass only reads where a panel
overlaps that gradient, so don't make `.app` a flat fill. Selected/active states
use `color-mix(var(--accent) …%, transparent)` tints, not solid fills.

---

## 3. Icons

One icon language: [lucide-react](https://lucide.dev), imported **only** through
`src/icons.tsx` (keeps tree-shaking effective and the set curated). Components never
import from `lucide-react` directly.

```tsx
import { Icon, Undo2, SCENE_KIND_ICON } from '../icons'

<Icon icon={Undo2} size={16} />                 // default stroke 1.8 (matches the tool rail)
<Icon icon={SCENE_KIND_ICON[kind]} size={13} /> // shared kind map
```

- `Icon({ icon, size=16, strokeWidth=1.8, title?, fill? })` — the only render path.
- `SCENE_KIND_ICON` / `LAYER_TYPE_ICON` — shared maps (previously duplicated across
  ScenesStrip/PreviewOverlay/FlowPreview/LayersPanel).
- The left **tool rail keeps its bespoke inline SVGs** — they're already one
  consistent 1.8-stroke line language and encode ad-specific semantics (header bar,
  endcard block) that lucide lacks. New rail tools should match the `S` style object.
- Inline icons inside text get `vertical-align: middle` globally; buttons are
  `inline-flex` with a `gap`, so `<Icon/> Label` aligns automatically.

No emoji, no Unicode dingbats. If you need a glyph, it's an `Icon`.

---

## 4. Component primitives (`src/ui.tsx`)

Build with these; don't drop raw `<select>` / `<input type="color">` /
`<input type="checkbox">` into panels.

| Primitive | Signature (abbrev.) | Notes |
|-----------|--------------------|-------|
| `NumField` | `{label, value, onChange, step?, min?, max?}` | drag-the-label-to-scrub number field |
| `Slider` | `{label, value, onChange, min, max, step?, suffix?}` | |
| `Toggle` | `{label, checked, onChange}` | animated switch |
| `Swatches` | `{label, value?, onChange, allowNone?}` | palette + custom + eyedropper |
| `ColorField` | same as Swatches | the canonical color control (wraps `Swatches`) |
| `Chips` | `{items:[{key,label,active?,onClick}]}` | preset chip row |
| `Select<T>` | `{value, onChange, options:[{value,label,disabled?}], label?, title?, className?}` | real `<select>` + chevron overlay; preserves keyboard + the canvas keydown guard |
| `Checkbox` | `{label, checked, onChange, title?}` | themed box + check |
| `Tooltip` | `{label, side?, children}` | CSS-only, keyboard-friendly via `:focus-within` |
| `Modal` | `{title, onClose, size?, headerExtra?, children}` | backdrop blur, Esc, focus, enter animation |
| `Accordion` | `{id, title, defaultOpen?, children}` | open state persisted by `id` in `uiState.ts` |

**Color editing** is unified on `ColorField`/`Swatches` everywhere — no bare OS
color pickers. **Selects** stay real `<select>` elements (styled with
`appearance:none` + a chevron) so keyboard semantics and the EditorCanvas keydown
guard (which ignores `SELECT`) keep working.

---

## 5. Motion & focus

- Global `:focus-visible` ring on every interactive element (`2px var(--accent)`).
- Hover/press transitions on `button, .tool, .scene-chip, .layer-row, .chip, …`
  via `--t-fast`/`--ease`; subtle `:active` translate/scale.
- Modals: backdrop fade + panel `modal-pop` (translate+scale).
- Row actions (Layers, Scenes) **reveal on hover/focus** (`opacity` transition) to
  cut clutter at rest.
- Everything is gated by `@media (prefers-reduced-motion: reduce)`.

---

## 6. Surfaces & structure

- **Elevation over borders** — prefer `--panel`/`--panel-2`/`--sh-*` to hard 1px
  dividers where practical.
- **Modals** share the `Modal` shell (`.modal-overlay` + `.modal`). Sizes:
  `sm/md/lg/preview/full`. Use `headerExtra` for rich bars (Preview).
- **Inspector** long sections are `Accordion`s (Animation + Background box default
  collapsed) to manage cognitive load.
- **Layers** render a one-level tree (`src/layersTree.ts` → `buildLayerTree`):
  consecutive same-`groupId` elements collapse under a folder header; DnD reorder
  stays on the flat id list so `reorderLayers` is untouched.
- **Command palette** (`Ctrl/⌘+K`): `src/commands.ts` registry → `CommandPalette.tsx`.
  Commands only invoke existing store actions / overlay openers — no new mutation
  paths. Add a command by appending to `buildCommands()`.
- **Canvas** is a Figma-style multi-frame world (`src/canvas/EditorCanvas.tsx`):
  every scene renders as a frame (its own iframe) on a pan/zoom world over a subtle
  dot grid. Drag a frame's label to rearrange (positions persist via
  `src/canvasLayout.ts`, localStorage); click a frame to activate it. The **active**
  frame carries the editing overlay — selection, handles, snap guides, marquee,
  inline text, and live dimension badges (counter-scaled to zoom,
  `pointer-events:none`). Per-frame coordinate math is identical to single-frame
  editing; pan = drag empty space / Space-drag / middle-drag, zoom = ⌘/Ctrl-wheel,
  Fit frames all scenes.
- **Scene thumbnails** (`src/preview/SceneThumb.tsx`) are keyed on per-scene
  identity and capped (`MAX_THUMBS`), so editing the active scene only re-renders
  that one thumbnail.

---

## 7. Conventions (do / don't)

**Do**
- Route color/radius/shadow/spacing through tokens.
- Use the glass recipe (`--glass-*`) for new chrome surfaces and floating UI; tint
  active/selected states with `color-mix(var(--accent) …, transparent)`.
- Render every glyph via `Icon` from `src/icons.tsx`.
- Use the `ui.tsx` primitives for selects, colors, checkboxes, modals, tooltips, accordions.
- Put new UI preferences in `theme.ts` / `uiState.ts` (localStorage), never `store.ts`.
- Give icon-only controls a `Tooltip` and an `aria-label`.

**Don't**
- Hardcode hex (except `#fff` on accent/artboard) or magic radii/shadows.
- Add emoji or Unicode dingbats.
- Import from `lucide-react` directly.
- Push editor-chrome state into the undo/autosave store.
- Let theme tokens reach the ad iframe.

---

## 8. File map

| File | Responsibility |
|------|----------------|
| `src/editor.css` | all tokens, theme blocks, focus/motion, component styles |
| `src/theme.ts` | theme load/apply/toggle + `useTheme` (localStorage) |
| `src/uiState.ts` | accordion + layer-group collapse persistence (localStorage) |
| `src/icons.tsx` | single lucide import site + shared icon maps + `Icon` |
| `src/ui.tsx` | shared primitives (controls, Modal, Accordion, Tooltip) |
| `src/layersTree.ts` | flat element list → one-level group tree |
| `src/commands.ts` | command palette registry |
| `src/panels/CommandPalette.tsx` | ⌘K palette UI |
| `src/preview/SceneThumb.tsx` | reusable static scene thumbnail (iframe) |

---

## 9. Verify

```bash
npm run typecheck     # types
npm run build         # runtime + editor (run from the package root, not src/)
npm run dev           # browser dev server
npm run app           # Electron
```

When changing theming, confirm in the running app that toggling light/dark restyles
the chrome **but leaves the artboard and preview device frames visually identical** —
that's the iframe-isolation guarantee in action.
