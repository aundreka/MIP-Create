# UX TODO — ticket list

Prompt a session with: **"implement ticket N in TODO.md"**. Each ticket is self-contained.

## Rules for every ticket (read first)

- **Concurrency**: tickets are grouped into lanes. Two tickets from **different** lanes can run at the same time; never run two tickets from the **same** lane concurrently (they edit the same files).
- **editor.css is shared by every lane.** Never edit existing rules unless the ticket says so. Add new CSS **appended at the end of the file** under a banner comment: `/* ==== TODO ticket N: <title> ==== */`. This keeps concurrent sessions conflict-free.
- Locate code by the **anchor strings** given below (search for them), not line numbers — concurrent edits shift lines.
- Reuse the design tokens in `:root` (`--accent`, `--muted`, `--fill-subtle`, `--r-pill`, `--t-fast`, `--ease`…) and existing primitives (`Row`, `Help`, `Accordion`, `Icon`, `ContextMenu`). Match both themes (dark is default, light via `[data-theme='light']`).
- Before finishing: `npm run typecheck`, `npx eslint <touched files>`, `npx prettier --write <touched files>`, and `npx vitest related --run <touched files>`.
- Do **not** commit — leave changes in the working tree. Do not rebuild the runtime (these are editor-only tickets) unless the ticket touches `runtime/`.
- When a ticket is done, change its `Status:` line to `done (<date>)`.

## Lanes

| Lane | Tickets | Files owned |
| ---- | ------- | ----------- |
| A — Home screen | 1, 2, 4, 10 | `src/panels/HomeScreen.tsx`, `src/projects.ts`, `src/App.tsx` (boot only) |
| B — Inspector | 6, 7 | `src/panels/Inspector.tsx` |
| C — Project settings | 5, 8 | `src/panels/ProjectSettings.tsx` |
| D — Dialogs (app-wide) | 3 | new `src/panels/AppDialogs.tsx` + call sites in many panels |
| E — Topbar | 9 | `src/panels/Topbar.tsx` |

⚠ Ticket 3 touches call sites across several panels — run it **alone** (no other ticket in parallel), ideally first or last.
⚠ Ticket 2 should land **after** ticket 3 if both are planned (its confirm becomes an in-app dialog); if 3 isn't done yet, ship 2 with native `confirm()` and leave a `// TODO ticket 3` comment.

---

## Ticket 1 — Make the hover-held live preview discoverable

**Lane A · Status: done (2026-10-03)**

The Home screen plays a live preview after hovering a card for 2s, but nothing hints it exists.

- Anchor: `HOVER_DELAY_MS` in `src/panels/HomeScreen.tsx`.
- Drop the delay to **600ms**.
- While hovering (before the preview fires), show a small affordance on the thumbnail — e.g. a corner chip "Hold to preview" or a ▶ badge that fades in after ~300ms. Pure CSS on `.proj-open:hover` + one element in `renderCard`/`ProjectThumb` is enough.
- Keep the existing behavior that moving off the card cancels/closes (`endHover`).
- CSS appended under the ticket banner.

**Done when**: hovering any card shows the hint, preview opens in ~0.6s, leaving the card closes it, no layout shift on the grid.

## Ticket 2 — Undo-able delete instead of permanent confirm

**Lane A · Status: done (2026-10-03) · (soft-depends on ticket 3)**

Deleting a playable is permanent behind a native `confirm()`, and Delete is disabled on the last playable with no explanation.

- Anchors: `deleteProject(p.id)` and `disabled: projects.length <= 1` in `src/panels/HomeScreen.tsx`; `deleteProject` in `src/projects.ts`.
- Replace the confirm-then-purge flow with: remove the card immediately, show an **undo toast** ("Deleted \"name\" — Undo", ~8s). Purge storage only when the toast expires or Home closes; Undo restores the record in place.
  - Simplest implementation: keep a `pendingDelete` state in HomeScreen holding the full record + assets (load via `loadProjectPreview`/the raw storage entry before deleting), and re-insert on undo. Check `src/projects.ts` for an existing restore path (`importAllData` shows the storage shape).
- On the last remaining playable, keep Delete enabled but have it create a fresh blank project first (or show why in the menu label: "Delete (kept — last playable)") — pick whichever is less code, but the state must be explained, not silently disabled.
- Toast CSS appended under the ticket banner (fixed bottom-center, `--sh-2`, auto-dismiss animation).

**Done when**: delete is instant + undoable within the toast window, storage is only purged after expiry, the last-playable case is self-explanatory, nothing breaks if the user deletes several in a row.

## Ticket 3 — Replace native alert/confirm with in-app dialogs

**Lane D (run alone) · Status: done (2026-10-04)**

Native `alert()`/`confirm()` dialogs clash with the UI and can't show detail.

- Create `src/panels/AppDialogs.tsx` exporting `appAlert(message, opts?)` and `appConfirm(message, opts?): Promise<boolean>` built on the existing `Modal` in `src/ui.tsx` (portal, Esc, focus handling already solved there). A module-level store + one `<AppDialogHost />` mounted in `src/App.tsx` is fine.
- Migrate call sites — find them with `grep -rn "alert(\|confirm(" src --include="*.tsx" --include="*.ts"` (skip tests and anything in `runtime/`). Known ones: HomeScreen (restore/import/delete), Topbar (`Save failed`), plus whatever the grep finds in other panels.
- Style: reuse `.modal` chrome; confirm gets a primary + quiet button, destructive confirms a `--danger` primary.
- Keep the functions awaitable so call sites stay one-liners.

**Done when**: `grep` finds no `window.alert`/`window.confirm` in `src/` (runtime excluded), dialogs render over everything (including the Home overlay and drawers), Esc cancels, Enter confirms.

## Ticket 4 — Discoverable rename on playable cards

**Lane A · Status: done (2026-10-04)**

Rename is double-click-only on the card name (tooltip-hinted) plus the ⋯ menu.

- Anchor: `onDoubleClick={() => setEditId(p.id)}` in `src/panels/HomeScreen.tsx`.
- Add a small pencil icon button next to `.proj-name`, visible on card hover/focus-within only (like `.tpl-tag`'s opacity pattern), that calls `setEditId(p.id)`. Import `Pencil` from `src/icons.tsx` — add the lucide re-export there if it's missing.
- Keep double-click and the menu entry working.
- CSS appended under the ticket banner.

**Done when**: hovering a card reveals a pencil; clicking it opens the inline rename input; keyboard users can Tab to it.

## Ticket 5 — Surface naming-critical settings out of tooltips

**Lane C · Status: done (2026-10-04)**

Settings that change export filenames ("Unique creative" off → `…_none`, Subconcept tokens) explain themselves only in hover `title`s.

- Anchors: `label="Subconcept"` and `label="Unique creative"` in `src/panels/ProjectSettings.tsx`.
- Under each of the two controls, render one short always-visible hint line (reuse `.hint`, 11px, muted) showing the **live consequence**, e.g. `ends the filename …_dd_unique` — compute from the current `subconceptToken(m)` and `m.unique` so it updates as they change (`fileBaseName(project)` already encodes the logic; showing its last two tokens is enough).
- Keep it to one line each; the full explainer stays in the existing `Help`.

**Done when**: toggling Unique or changing Subconcept visibly updates the hint without opening Help, drawer doesn't grow more than ~2 lines total.

## Ticket 6 — Colorblind-safe WIN/LOSE cell markers

**Lane B · Status: done (2026-10-04)**

The scratch-grid cell selector distinguishes WIN/LOSE only by green/red 9px text.

- Anchor: `{isW ? 'WIN' : 'LOSE'}` in `src/panels/Inspector.tsx` (scratch grid cell buttons; the same pattern may exist for other grid templates — grep `'WIN' : 'LOSE'` and fix all hits).
- Add a shape cue alongside color: ✓ for win, ✗ for lose (text glyph or `Check`/`X` from `src/icons.tsx`), and bump the label to 10px. Keep the colors but use theme-safe ones with enough contrast in light mode (e.g. `var(--accent-2)` / `var(--danger)` instead of raw `#4ade80`/`#f87171`).
- While there, move those inline styles into a class (`.cell-pick-btn`) appended in editor.css under the ticket banner.

**Done when**: win/lose is distinguishable with color vision deficiency (shape differs), contrast is fine in both themes, every grid template that had the pattern is covered.

## Ticket 7 — Pair stacked numeric fields into grid2 rows

**Lane B · Status: done (2026-10-04)**

Game inspectors stack related NumFields full-width (e.g. "Reveal zone left/top/width/height" = 4 rows).

- Anchor: `label="Reveal zone left"` in `src/panels/Inspector.tsx`. The existing pattern to copy: `<div className="grid2">` around two `NumField`s (see `Base W`/`Base H` in ProjectSettings).
- Pair logically-related fields across the game inspectors: zone left+top, zone width+height, and sweep the rest of Inspector.tsx for runs of ≥2 adjacent same-unit NumFields (durations, scales, offsets, min/max pairs) — pair them where labels stay readable at half width (shorten labels if needed: "Reveal zone left (%, per cell)" → "Zone left %").
- Don't pair fields that conditionally render independently of each other.

**Done when**: the scratch/catch/slider inspectors are visibly shorter, no label truncates confusingly, typecheck passes (no JSX structure mistakes).

## Ticket 8 — Stop Project Settings from mutating the project on open

**Lane C · Status: done (2026-10-04)**

A `useEffect` writes `mipDate`/`exportDate` the first time Settings opens with a Client/MIP set — the project goes dirty from just looking at settings.

- Anchor: `Give the MIP a fixed date the first time` comment in `src/panels/ProjectSettings.tsx`.
- Move the defaulting to where it's **consumed** instead of written on open: `mipName`/`fileBaseName` in `src/mipName.ts` should fall back to `exportDate ?? todayLabel()` when `mipDate` is blank (check — they may already). Then write `mipDate` only when the user actually edits Client/MIP/Date (i.e. inside those `patchMeta` handlers), not in a mount effect.
- Delete the effect. Verify an exported filename is unchanged for a project that already has `mipDate`, and still gets today's date when blank.
- `npx vitest related --run src/mipName.ts` must pass (mipName has tests).

**Done when**: opening + closing Settings on a clean project leaves it clean (no dirty dot in the topbar), names/exports unchanged otherwise.

## Ticket 9 — Topbar overflow strategy for narrow windows

**Lane E · Status: done (2026-10-04)**

Nothing wraps; on narrow windows the controls collide.

- File: `src/panels/Topbar.tsx` + appended CSS.
- Below ~1100px viewport width (CSS `@media`), hide the lower-value middle controls and fold them into the existing ⋯/app menu: the Portrait/Landscape `seg` becomes an icon toggle, hide `.zoom` (keep Shift+1 fit shortcut), hide the handles toggle, shrink `.repo-quick` further (`max-width: 110px`), and let `.proj-switch` truncate earlier.
- Prefer CSS-only hiding + a `useMediaQuery`-style `matchMedia` hook (or plain CSS for everything you can) over restructuring the bar. Add the folded items to `appItems` so they stay reachable (they can be always-present menu entries — harmless at full width).
- Nothing may overlap or clip at 900px width with a project group, locale select and variant select all visible.

**Done when**: at 1440px the bar is unchanged; at 900px everything fits on one line, and hidden controls are reachable from the menu.

## Ticket 10 — Storage persistence + backup nudge

**Lane A · Status: done (2026-10-04)**

The whole library lives in localStorage; browsers can evict it, and backups are manual.

- Boot: in `src/App.tsx` (or `src/main.tsx` — wherever one-time boot effects live), call `navigator.storage?.persist?.()` once, fire-and-forget, in the browser only (skip when `window.editorAPI` exists — that's the desktop app with its own storage).
- Nudge: record the timestamp of each successful backup (`doBackup` in `src/panels/HomeScreen.tsx` — write `localStorage['pa:lastBackupAt']`). On Home open, if there are ≥5 projects and the last backup is older than **14 days** (or never), show one dismissible `.hint`-style banner above the playables grid: "Last backup: N days ago — Download backup" (button calls the existing `doBackup`). Dismissing hides it for 7 days (another localStorage stamp).
- No modal, no repeat-nagging; banner CSS appended under the ticket banner.

**Done when**: persist is requested on boot without errors in desktop or browser, the banner shows/hides per the rules above, backup from the banner works and resets the timer.
