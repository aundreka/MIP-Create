# Playable Editor

A visual editor and runtime for building **playable ads** — interactive HTML creatives that ship as a single self-contained file (< 5 MB) to ad networks (AppLovin, Mintegral, Vungle, …).

## Architecture at a glance

Three tiers with strict, one-directional boundaries:

```
┌──────────────────────────────────────────────────────────────┐
│  native/  (electron/)   file save · ffmpeg transcode · upload │  Electron main + preload
│      ▲ window.editorAPI (contextBridge, contextIsolation)      │
├──────┴───────────────────────────────────────────────────────┤
│  editor/  (src/)        React authoring app                    │
│      • imports TYPES ONLY from runtime/  ─────────────┐        │
│      • renders the ad in a sandboxed <iframe>          │        │
│      • talks to it via a typed postMessage protocol    │        │
├────────────────────────────────────────────────────────┼──────┤
│  runtime/               framework-free DOM/CSS ad engine ▼      │
│      • zero dependencies, ships standalone                     │
│      • NEVER imports from src/                                 │
│      • built separately → runtime-dist/playable-runtime.js     │
└──────────────────────────────────────────────────────────────┘
```

- **`runtime/`** — the ad engine. Pure DOM/CSS, no React, no deps. It reads a `Project` + `AssetMap` (the shared schema in `runtime/scene.ts` / `runtime/types.ts`) and renders/plays the ad. Game mechanics are plugins (`runtime/games/`, see [docs/mechanics-contributing.md](docs/mechanics-contributing.md)). Built as a single IIFE.
- **`src/`** — the editor (React 18 + Vite + TypeScript). Custom store via `useSyncExternalStore` (`src/store.ts`). The canvas renders each scene in its own `<iframe>` and communicates only through the typed protocol in `runtime/frame-protocol.ts` — the editor's CSS can never leak into the ad.
- **`electron/`** — desktop shell (`main.cjs` + `preload.cjs`): native save/load, ffmpeg media transcode, and the AppLovin upload automation. The renderer reaches it through a minimal `contextBridge` surface (`window.editorAPI`).

**Export** (`src/export.ts`) assembles one HTML file: it inlines `runtime-dist/playable-runtime.js` (imported with `?raw`) + the project/assets as base64, applies per-network transforms (MRAID / ExitAPI / zip), and enforces the 5 MB budget.

## Project layout

```
runtime/         ad engine (scene graph, elements, games, i18n, frame protocol)
runtime-dist/    built runtime IIFE (build artifact; inlined into exports)
src/             editor app — store, canvas, panels, export, io, domain logic
electron/        desktop main + preload (CommonJS)
scripts/         smoke.mjs (headless render check) + fixtures
docs/            design + contribution notes
```

## Develop

```bash
npm install
npm run build:runtime   # build the runtime IIFE first (exports + tests depend on it)
npm run dev             # editor in the browser (Vite)
npm run app:dev         # editor in Electron (point at the dev server)
```

> The editor's export path and the test/smoke suites import `runtime-dist/playable-runtime.js`, so **build the runtime before** running them (CI does this automatically; `npm run build` chains both in order).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (editor) |
| `npm run build:runtime` | Build the runtime IIFE → `runtime-dist/` |
| `npm run build` | Build runtime **then** editor |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint over `src/` + `runtime/` |
| `npm run format` / `format:check` | Prettier write / check |
| `npm test` | Vitest unit tests (jsdom) |
| `npm run smoke` | Render the real exported HTML headless and assert it mounts |
| `npm run app` | Run the built app in Electron |
| `npm run dist` | Build + package installers (electron-builder) |

## Quality gates

CI (`.github/workflows/ci.yml`) runs **typecheck → lint → build:runtime → test → build → smoke** on every push/PR. Locally, run `npm run typecheck && npm test` before committing.

## Conventions

- **TypeScript strict**; avoid `any` (only the untyped Figma REST surface in `src/figma.ts` is exempt).
- The **runtime never imports from `src/`**; shared types live in `runtime/scene.ts` / `runtime/types.ts`.
- The editor **never posts theme/styles into the ad iframe** (see [design.md](design.md)).
- New **game mechanic** = one file in `runtime/games/` + one line in `registry.ts` (validated in dev).
