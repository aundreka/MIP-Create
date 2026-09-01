# Dynamic Holiday — Implementation Plan (Dynamic date element)

Date: 2026-09-01
Origin: peakfootwear SIP1/SIP2 (see `~/Downloads/peakfootwear/promo-overlay-plan.md` for the
hand-built version and the promo calendar CSV `promo-calendar-2026-2027.csv`).

## Goal

Make "dynamic holiday text" a first-class feature of the existing **Dynamic date** element so a
designer can drop a label that reads the promo calendar (e.g. "Labor Day Sale" on 2026-08-31 →
09-07, "Winter Sale" in between) — and have it **scale and sit exactly like every other element**
in game scenes, floated overlay scenes and end cards, at every viewport, orientation and zoom.

Product rules already agreed for peakfootwear (carry over as defaults):
- Every calendar row produces a label (generic "Winter Sale" rows included). Outside the calendar
  the label is empty → the element hides (and a fallback element can show instead).
- The label is the calendar's Promo text verbatim; long names auto-shrink to a design-px width.
- The device's local date decides; re-evaluate at local midnight.

---

## 1. How the builder handles elements today (what we build on)

### 1.1 The "Dynamic date" element IS a `countdown` element
- Tool rail → `makeDynamicDate()` ([src/factories.ts](../src/factories.ts)) creates
  `{ type: 'countdown', countdown: { mode: 'dynamic', dynamicDays: 3, format: 'Order by {date}' } }`.
  Content is `el.text` (font, colour, box…) — it renders through the **text pipeline**
  (`createTextContent` → `.pa-textbox > .pa-text-inner`).
- The string comes from one shared formatter, `renderCountdownFormat()` in
  [runtime/elements/countdown.ts](../runtime/elements/countdown.ts) (tokens `{date} {MMMM} {Do} {hh}…`,
  `textCase`, locale). The same formatter drives the **pinned header band** (`header.ts`), the
  **countdown ring game** (`games/countdown.ts`) and the **scratch-grid cell date**
  (`games/scratch_grid.ts`). Anything added to the formatter reaches all four surfaces.
- Ticking: `startTicker()` in `stage.ts` computes `rec.deadline` and calls `tickCountdown()` on an
  interval only when the format has time tokens (`needsTicker`). A pure date label renders **once**
  — there is currently no midnight refresh for element dates.
- Inspector: the "Countdown / dynamic date" accordion in
  [src/panels/Inspector.tsx](../src/panels/Inspector.tsx) (~L5248) edits `CountdownConfig`.
- Schema: `CountdownConfig` in [runtime/scene.ts](../runtime/scene.ts) (~L469). All new fields
  below are optional → **no `CURRENT_SCHEMA` bump / migration needed** (`src/migrate.ts`).

### 1.2 How elements scale (the part that must not change)
One global design→screen transform lives in [runtime/responsive.ts](../runtime/responsive.ts):
`s = min(vw/baseW, vh/baseH)`, `offX` centred, `offY` top (or centred via `meta.vAlign`).
`computeMetrics()` is called from ONE place per host (`index.ts boot()` for exports,
`frame.ts` for the editor canvas/preview) on resize, visualViewport resize/scroll,
orientationchange (+100/300/600 ms retries), an 8-frame rAF poll and a pointer-down reconcile.
Then `manager.relayout()` → header relayout + `current.stage.layoutAll()` +
**every floated overlay stage `.layoutAll()`** (`scenes.ts` ~L1042).

A text/countdown element is laid out by `layoutText()` (`stage.ts` ~L3579) through one of four paths:

| Path | When | Position | Font |
|---|---|---|---|
| plain FIT | default | `round(sx(x))`, `round(sy(y))` | `fontSizePx · s · e.scale` |
| `headerScale` | toggle "Scale like the date band" | unrounded `sx/sy`, one `scale(s)` transform | raw design px inside the transform |
| `attachToId` | glued to an image/bar | offset inside the target's **rendered** rect | `fontSizePx · k` (k = target rect / design) |
| auto endscene lock | countdown/text drawn over an `endscene` card (no attachToId) | mapped into the card's **cover-cropped clip** (`endsceneMediaPos` / `attachedTextPos`) | `fontSizePx · clipScale` |

The last path is exactly the peakfootwear "stick to the video" contract and is already proven by
[runtime/endscene-lock.test.ts](../runtime/endscene-lock.test.ts) ("locks a dynamic date to the clip
in both orientations": position and font as a fraction of the live clip are constant across
1080×1920 / 540×960 / 390×844 / 1540×1135 / 2000×900).

**Overlay scenes** are not a different coordinate space: `scenes.ts` builds them with
`buildScene(overScene, assets, { mount: overlayDiv, float: true })` where `overlayDiv` is
`position:absolute; inset:0` inside the same `stageContainer` as the game root, so `sx/sy` map
identically, and `relayout()` re-lays every floated stage. `float` only makes the root transparent
and skips the bleed div.

> **Design rule for this feature:** the holiday feature changes only the *string* a countdown
> element renders (and optionally whether it is visible). It must never add a new layout path.
> Everything that keeps the element glued in game/overlay/endscene scenes is then inherited for
> free, including the editor canvas (which renders through the same runtime in an iframe and reads
> element rects back via `pa:layout`).

---

## 2. Feature design

### 2.1 Data: the promo calendar
- **Schema** (`runtime/scene.ts`):
  ```ts
  export interface PromoCalendarEntry { start: string; end: string; label: string } // 'YYYY-MM-DD', inclusive
  // ProjectMeta
  promoCalendar?: PromoCalendarEntry[]
  ```
- **Editor-owned default** — `src/promoCalendar.ts`: the 2026–2027 CSV baked in as the default
  entries (58 rows, ~3 KB), plus `parsePromoCsv(text)` (handles quoted fields, typographic
  apostrophes, header row `Year,Start Date,End Date,Promo,Key Holiday Dates`) and
  `validatePromoCalendar()` (sorted, no overlaps, reports gaps). The runtime carries **no data**;
  a project gets `meta.promoCalendar` the first time a holiday element is created (or via
  "Load default calendar" / "Import CSV…" in Project settings). Only projects using the feature pay
  the bytes.
- **Runtime registry** — `runtime/elements/promoCalendar.ts`:
  `setPromoCalendar(entries | undefined)`, `promoLabelFor(nowMs): string` (local-date compare using
  `new Date(y, m-1, d)`, never `Date.parse('YYYY-MM-DD')` which is UTC), `nextPromoBoundary(nowMs)`.
  Registered exactly where `setActiveLocale`/`setDesign` are: `index.ts boot()`, `frame.ts render()`
  and `play()`.

### 2.2 Token: `{holiday}` in the shared formatter
- `renderCountdownFormat()` gains `{holiday}` (alias `{promo}`) → `promoLabelFor(now)`. It resolves
  against **today** (the viewer's date), not the countdown's target — a "3 days from now" offer
  still says today's promo. `textCase` applies (so "LABOR DAY SALE" is one select away).
- `formatTicks()` unchanged (no per-second ticking), but `needsMidnightRefresh(fmt)` is added for
  formats containing `{holiday}`/`{date}`/date parts.
- Because it is in the shared formatter, the **pinned header** (`dateFormat: "{holiday}"`), the
  **countdown ring** label and the **scratch-grid cell date** get it with no further code.

### 2.3 Element config (`CountdownConfig`)
```ts
// Hide the element unless the calendar has / lacks a label for today.
showWhen?: 'always' | 'holiday' | 'noHoliday'
// Auto-shrink: max rendered width in DESIGN px; the font scales down (never up) to fit.
fitWidthPx?: number
```
- `showWhen` is what builds the peakfootwear fallback layout inside the builder: element A
  (`format: '{holiday}'`, `showWhen: 'holiday'`, big green) and element B (`format: 'Buy 1 Get 1 Free'`
  — a literal format is legal — `showWhen: 'noHoliday'`, big green), plus the normal black
  "Buy 1 Get 1 Free" with `showWhen: 'holiday'`. Designers compose both states on the canvas by
  flipping the preview date (2.6).
- Implementation of `showWhen`: evaluated in `layoutRec()` next to `e.hidden` (class
  `pa-el--holiday-off`, `display:none`). Re-evaluated on the midnight refresh (2.5). Not a new
  layout path — hidden elements simply skip layout, as today.
- Implementation of `fitWidthPx` (must be **scale-invariant**): inside `layoutText()` after the font
  is applied, and again after every `tickCountdown()` (text changed):
  - plain FIT / attached: `factor = min(1, fitWidthPx · s / inner.scrollWidth)`;
  - `headerScale`: the box is in raw design px inside a transform, so `factor = min(1, fitWidthPx / inner.scrollWidth)`;
  - apply `inner.style.fontSize = base · factor` (and letter-spacing). Text width is linear in font
    size, so `factor` is identical at every viewport → the label keeps a constant size relative to
    the composition. Measure with `whiteSpace: pre` (no wrap) unless `text.maxWidthPx` is set —
    `maxWidthPx` (already exists) remains the "wrap to 2 lines" option; `fitWidthPx` is the
    "shrink" option; both may combine (wrap first, then shrink).
  - Re-run when custom fonts finish loading (`document.fonts.ready` → `layoutAll()`); verify during
    implementation whether `stage.ts` already relayouts on font load, add it if not.

### 2.4 Scaling guarantees per scene kind (no new code — verified paths)
- **Game scene**: plain FIT / `headerScale`. Recommend the inspector default for a holiday label to
  be `headerScale: true` (single transform, unrounded — the "never drifts" path the date band uses).
- **Overlay scene** (win/lose card floated over the game): same `layoutText()`; `relayout()` covers
  `overlayStages`. Immune/`overlayTop` reparenting keeps `z` but never changes the FIT mapping.
- **Endscene / SIP card**: a countdown over a cover-fitted `endscene` element auto-locks to the clip
  (`autoEndsceneTarget`) — position and font are fractions of the rendered, cropped clip, which is
  exactly the SIP contract. For an image-backed composition use **Attach to** (`attachToId`).
- **Editor canvas**: renders the same runtime in an iframe (`frame.ts`), so WYSIWYG holds; the text
  width change updates the selection rect through `pa:layout` automatically.

### 2.5 Midnight refresh (element + header)
- Move `nextMidnight()` from `header.ts` into `elements/countdown.ts` (header re-exports/uses it).
- `startTicker()` in `stage.ts`: when `needsMidnightRefresh(format)` or `showWhen !== 'always'`,
  schedule `setTimeout(nextMidnight(now) - now + 1000)` → `tickCountdown(rec)`, re-fit width,
  re-evaluate `showWhen` (call `layoutRec(rec)`), reschedule. Clear in `destroy`.
- Header `date` mode: same timer around its `render()`.
- Also refresh on `visibilitychange → visible` (ads get frozen and resumed across days in dev
  previews; cheap insurance).

### 2.6 Editor: preview date (designers must see both states)
- `frame-protocol.ts`: add `previewNow?: number | null` to `pa:render` and `pa:play`.
- Runtime: `setNowOverride(ms | null)` + `runtimeNow()` in `elements/countdown.ts`; **only** the
  date/holiday rendering reads it (`formatCountdown`, header date, scratch-grid date, `promoLabelFor`)
  — timers/clock keep real time so nothing else in the runtime changes behaviour.
- Editor state: `src/uiState.ts` (`pa:previewDate`, localStorage — a UI preference, **not** in the
  undo store per design.md). Control: a date input + "Today" reset in the countdown accordion and a
  small chip in the Topbar when a preview date is active (so nobody ships while forgetting it is on).
  Export never sends it.

### 2.7 Authoring surface
- `src/factories.ts`: `makeDynamicHoliday()` → countdown, `format: '{holiday}'`, `showWhen: 'holiday'`,
  `fitWidthPx: round(baseW · 0.86)`, `headerScale: true`, weight 800, `textCase: 'none'`.
  Tool rail: "Dynamic holiday" (icon: `CalendarHeart` or reuse `CalendarDays`), registered through
  `src/icons.tsx` only.
- Inspector countdown accordion: a **Holiday** section — "Insert {holiday}" button, calendar status
  line ("58 periods · 2026-01-01 → 2027-12-31 · today: Labor Day Sale"), `showWhen` select,
  `fitWidthPx` NumField, preview-date input, link to Project settings.
- Project settings (`ProjectSettings.tsx`): "Promo calendar" accordion — rows count/range, Import CSV,
  Load default, Clear; validation messages from `validatePromoCalendar()`.
- Header popover: mention `{holiday}` in the Format placeholder/hint.
- `mipGen.ts` / `GenerateMip.tsx`: `endscene.dynamicHoliday` toggle that seeds the element and the
  calendar.

### 2.8 Delivery naming & preflight
- `meta.subconcept` already has `'dh'` (dynamic holiday) — `src/mipName.ts`. Preflight
  (`src/preflight.ts`): `info` when `{holiday}` is used and subconcept is not `dh`/`dtd`; `warn`
  when `{holiday}` is used and the calendar is missing or does not cover the next 12 months from
  `meta.exportDate`; `warn` on calendar gaps/overlaps.
- `src/export.ts`: strip `meta.promoCalendar` when no element/header format contains `{holiday}`
  (size hygiene; it is already stripping editor-only meta such as `variants`).

### 2.9 Localisation (phase 2, flagged)
Labels are English CSV text. `TextConfig.i18n` does not apply to countdown (its value is the format).
If needed: `PromoCalendarEntry.labelI18n?: Record<string,string>` resolved through
`localeEntry()` in `i18n.ts`. Not required for peakfootwear.

---

## 3. Implementation steps (order matters; each step leaves CI green)

1. **Runtime calendar + token** — `runtime/elements/promoCalendar.ts` (new), `{holiday}` in
   `renderCountdownFormat`, `setPromoCalendar` wired in `index.ts`/`frame.ts`, `nextMidnight` moved.
   Tests: `runtime/holiday-token.test.ts`.
2. **Schema** — `PromoCalendarEntry`, `meta.promoCalendar`, `CountdownConfig.showWhen/fitWidthPx`.
   Typecheck only (optional fields, no migration).
3. **Stage behaviour** — `showWhen` in `layoutRec`, `fitWidthPx` in `layoutText` + after
   `tickCountdown`, midnight timer in `startTicker`/destroy, `update()` diff already restarts the
   ticker when `JSON.stringify(nel.countdown)` changes (stage.ts ~L2752) — confirm the new fields
   fall inside that compare. Tests: `runtime/holiday-visibility.test.ts`, `runtime/holiday-scale.test.ts`.
4. **Preview date** — protocol field, `setNowOverride`, uiState, EditorCanvas/FlowPreview/SceneThumb
   post it, Topbar chip. Test: token resolves against the override in `frame`-less unit test.
5. **Editor authoring** — `src/promoCalendar.ts` (default data + CSV parser + validator, tests),
   factory + tool rail, Inspector Holiday section, Project settings accordion, header popover hint,
   mipGen option.
6. **Naming/preflight/export** — preflight findings, calendar stripping, ProjectSettings hint update.
7. **Docs** — add a "Dynamic holiday" paragraph to the Inspector hint and README feature list.

---

## 4. Tests that pin the scaling requirement (vitest + jsdom, patterns already in repo)

`runtime/holiday-scale.test.ts`, modelled on `endscene-lock.test.ts` / `text-scale.test.ts` /
`overlay-base.test.ts`:
- Fixture: project with a **game** scene, an **overlay** scene (`kind:'overlay'`, floated via
  `emit('scene-overlay')`) and an **endscene** (854×1138 / 1138×854 clip like the peakfootwear SIP),
  each holding a `{holiday}` countdown (one plain FIT, one `headerScale`, one auto-locked on the card).
- For viewports `[1080×1920, 540×960, 390×844, 1540×1135, 2000×900]` assert, per element:
  `left/top` and `fontSize` expressed as fractions of the FIT frame (game/overlay) or of the live
  cover-cropped clip (endscene) are equal to the 1080×1920 reference (`toBeCloseTo`, 3 dp).
- Same assertion with the preview date forced to the longest label
  ("Thanksgiving, Black Friday & Cyber Monday Sale", 2026-11-23) — the shrink `factor` must be
  identical at every viewport, and `left/top` unchanged versus the short label.
- Overlay-specific: after `manager.relayout()` at a new viewport, the floated overlay's countdown
  moved by exactly the FIT delta (proves `overlayStages` relayout covers it).
- `showWhen`: element hidden outside the calendar (2028-01-01), visible inside; a `noHoliday`
  sibling shows the inverse; with fake timers, crossing local midnight from 2026-09-07 → 09-08 flips
  "Labor Day Sale" → "Summer Sale" without a rebuild.
- Header: `dateFormat: '{holiday}'` renders the label and keeps its `scale(s)` transform math
  (existing `header.test.ts` style).

Manual QA (Electron/dev): canvas + Preview at phone/tablet/desktop device presets, rotate, browser
zoom 50–200 %, AppLovin preview iframe; confirm the label never moves relative to its artwork and
that the preview-date chip is visible while active.

---

## 5. Out of scope / decisions taken
- No new countdown `mode` — the token composes with `dynamic`/`clock`/`date` and literal formats.
  (Optional UX: a "holiday (promo calendar)" preset in the Mode select that just sets
  `format: '{holiday}'`.)
- No runtime-bundled calendar data; the editor seeds it per project.
- Device-local time only; no fixed-timezone option.
- Holiday labels not localised in this phase (2.9).
