# Contributing a new gameplay mechanic

This is how a developer adds a new mini-game to the editor so designers can use it,
and it automatically becomes a reusable starter template. It implements the
**git-contribution + registry-sync** model: mechanics live in this repo, you add
one by PR, CI validates the contract, and a merged change ships in the next editor
build.

## The contract

A mechanic is a `GameTemplate` (see [`runtime/games/types.ts`](../runtime/games/types.ts)).
You implement two things:

1. **`GameTemplate`** — metadata the editor reads to build the inspector UI:
   - `id` (unique, kebab/lower), `label` (shown in the dropdown)
   - `paramFields[]` — editable params (`number` | `color` | `select` | `text`); the
     inspector renders a control per field automatically
   - `assetSlots[]` — optional image/video/audio slots (use `list` + `countParam`
     for "one image per item", like Match's one-image-per-pair)
   - `defaultParams` — defaults for a freshly-added instance
   - `create()` — returns a `GameModule`

2. **`GameModule`** — the runtime behavior mounted into the game-mount slot:
   - `mount(ctx, params)` — build your DOM inside `ctx.root`; resolve assets with
     `ctx.assets.src(id)`, play sound with `ctx.sfx.play(event)`, and use `ctx.rng()`
     (deterministic — never `Math.random()`, so boards/hints stay reproducible)
   - `start()` — begin interactive play (skipped on the static editor canvas)
   - `relayout()` — re-position on resize
   - `getHint()` — return the next correct move in **screen px** (drives the hand hint),
     or `null`
   - `onComplete(cb)` — call `cb()` when the player wins
   - `destroy()` — tear down

Copy an existing small game (e.g. [`runtime/games/pick.ts`](../runtime/games/pick.ts) or
`match.ts`) as a starting point — it shows the full shape end to end.

## Steps

1. **Add the module:** `runtime/games/<your-id>.ts`, exporting
   `export const <YOURID>_TEMPLATE: GameTemplate = { ... }`.
2. **Register it:** import and add it to the `GAME_TEMPLATES` array in
   [`runtime/games/registry.ts`](../runtime/games/registry.ts). Array order is the
   display order in the inspector and the starter list — place it intentionally.
3. **Run the checks locally:**
   ```sh
   npm run typecheck        # contract is enforced by the GameTemplate type
   npm run dev              # the registry self-validates in dev; watch the console
   ```
   In dev, `registry.ts` runs `validateRegistry()` and logs any contract errors
   (unique id, required fields, select needs options, list slots reference a real
   `countParam`, etc.). See [`runtime/games/validate.ts`](../runtime/games/validate.ts).
4. **Open a PR.** CI runs the same validation (below). A reviewer checks it plays and
   that `getHint()` returns sane moves.
5. **Merge → release.** A merged PR builds the editor + runtime and publishes the new
   editor version (Electron auto-update / fresh download). On update, your game appears
   in the inspector **and** as an auto-generated starter template (the editor derives a
   starter per registered game in `src/templates.ts → gameTemplateStarters()`), so the
   "editor learns the new mechanic" payoff is automatic — no extra work.

## CI gate (example — GitHub Actions)

The contract is enforced by `tsc` plus `validateRegistry()`. Wire it into whatever CI
host you use. Example `.github/workflows/mechanics.yml`:

```yaml
name: mechanics
on: [pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build          # building runtime + editor proves it bundles
```

For a stricter gate that fails on a malformed registry without a full build, add a tiny
runner (the repo has no test framework yet; `tsx` is the lightest option):

```jsonc
// package.json
"scripts": { "validate:games": "tsx scripts/validate-games.ts" }
```
```ts
// scripts/validate-games.ts
import { GAME_TEMPLATES } from '../runtime/games/registry'
import { validateRegistry } from '../runtime/games/validate'
const errs = validateRegistry(GAME_TEMPLATES)
if (errs.length) { console.error('Registry contract errors:\n - ' + errs.join('\n - ')); process.exit(1) }
console.log(`OK — ${GAME_TEMPLATES.length} mechanics valid`)
```

## When a mechanic is too complex for the DOM contract

If a game is heavy (a full Phaser build, like `phaser test proj`), don't force it into
the DOM module contract — use the existing **`embed`** template, which mounts an external
built game in an iframe with a completion shim. The editor can't parameterize an embedded
game from the inspector, but it slots into the scene flow like any other mechanic.

## Where the repo lives ("do they upload it somewhere?")

Yes — this editor repo (or a dedicated `games` package/submodule split out of
`runtime/games/`) is the single source of truth, hosted on your git server
(GitHub/GitLab). Devs clone it, branch, add the module, and PR. There is no runtime
plugin upload: mechanics are bundled at build time so the single-file <5MB export stays
self-contained and there's one validated registry — which is exactly the
"git-contribution + registry-sync" model chosen for this project.
