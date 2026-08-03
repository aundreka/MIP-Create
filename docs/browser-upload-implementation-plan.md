# Browser Upload Pipeline Implementation Plan

Date: 2026-08-03

## Recommendation

Build the browser version around a dedicated backend uploader service, not a Chrome extension and not direct browser-side page automation.

Why this is the best fit for this repo:

- The browser app can already build the playable payload locally.
- The current upload automation depends on native window control in [`electron/main.cjs`](../electron/main.cjs), which the browser cannot do.
- Cross-site login, file input automation, and result-link scraping belong on a trusted backend.
- A backend can return a clean final link to the browser UI.
- This avoids extension installation and reduces breakage when AppLovin or the file server UI changes.

## Decision Summary

Use this architecture:

1. Frontend browser app builds AppLovin-ready files.
2. Frontend sends an upload job to a backend service.
3. Backend uploads to one or both targets:
   - AppLovin
   - `http://20.255.60.183/file-upload/`
4. Backend returns structured results, including final link(s) when available.

Do not choose these as the primary path:

- Chrome extension:
  Good as a fallback, but higher maintenance and worse distribution.
- Direct browser upload to `20.255.60.183`:
  Only viable if that server exposes a documented CORS-friendly API. Assume it does not until verified.

## Recommended Repo Boundary

Keep everything in this repo, split into two parts:

- Frontend app:
  Existing `src/` code, plus a browser upload client and shared build helpers.
- Backend uploader service:
  Add a new `server/` directory for a long-running Node service.

Reason not to use Supabase Edge Functions for the upload worker:

- The upload worker will likely need session persistence and browser automation for AppLovin.
- That is a better fit for a long-running Node service than an edge function.
- Supabase can still be used for auth, storage, or job metadata later if useful, but should not be the first implementation boundary for the automation itself.

## Target Architecture

### Frontend responsibilities

- Build the upload batch from the current MIP or a grouped project.
- Show upload modal and progress.
- Send files to backend.
- Poll job status if backend is async.
- Display returned final links and per-destination status.

### Backend responsibilities

- Accept upload jobs and file payloads.
- Store temp files safely.
- Authenticate to AppLovin and file server.
- Upload files.
- Capture final URL(s) or success page URLs.
- Return structured job results.

## Concrete Frontend Task List

### 1. Extract the file-building logic from UI components

Current logic is split across:

- [`src/panels/ExportModal.tsx`](../src/panels/ExportModal.tsx)
- [`src/panels/UploadModal.tsx`](../src/panels/UploadModal.tsx)
- [`src/quickExport.ts`](../src/quickExport.ts)

Create:

- `src/upload/types.ts`
- `src/upload/buildUploadBatch.ts`

Proposed exports:

- `export interface UploadBuildRequest`
- `export interface UploadBuildFile`
- `export interface UploadBuildResult`
- `export async function buildUploadBatchForProject(input: UploadBuildRequest): Promise<UploadBuildResult>`
- `export async function buildUploadBatchForProjects(inputs: UploadBuildRequest[]): Promise<UploadBuildResult>`

Expected behavior:

- Input accepts project data, assets, variants, selected networks, optimize settings, and runtime source.
- Output returns:
  - `files`
  - `skipped`
  - `warnings`
  - `totalCount`

Notes:

- This should reuse `processAssetsAutoFit`, `pruneAssets`, `buildOutputs`, and `fileBaseName`.
- This module must be UI-free.

### 2. Separate desktop automation from browser upload client

Current upload path is coupled to Electron in:

- [`src/bridge.ts`](../src/bridge.ts)

Keep desktop-only functions:

- `applovinOpen`
- `applovinProbe`
- `applovinUpload`

Add browser/backend client module:

- `src/upload/browserClient.ts`

Proposed exports:

- `export interface CreateUploadJobRequest`
- `export interface UploadJobResult`
- `export async function createUploadJob(req: CreateUploadJobRequest): Promise<UploadJobResult>`
- `export async function getUploadJob(id: string): Promise<UploadJobResult>`

Optional if using multipart in two steps:

- `export async function uploadJobFiles(id: string, files: UploadBuildFile[]): Promise<void>`
- `export async function startUploadJob(id: string): Promise<UploadJobResult>`

### 3. Make `UploadModal` choose transport by platform

Current modal:

- [`src/panels/UploadModal.tsx`](../src/panels/UploadModal.tsx)

Refactor it so:

- Desktop path uses Electron automation.
- Browser path uses backend API.

Proposed internal helpers inside `UploadModal.tsx` or a sibling helper:

- `runDesktopUpload(...)`
- `runBrowserUpload(...)`
- `formatUploadStatus(...)`

Browser UI requirements:

- Show build progress.
- Show upload progress.
- Show per-target result.
- Show returned links with copy button.
- Show skipped over-limit files.

### 4. Keep top-level entry points unchanged, but swap their internals to the shared builder

Existing entry points:

- [`src/panels/Topbar.tsx`](../src/panels/Topbar.tsx)
- [`src/panels/HomeScreen.tsx`](../src/panels/HomeScreen.tsx)
- [`src/App.tsx`](../src/App.tsx)

Task:

- Preserve:
  - current playable upload from topbar
  - single playable upload from Home card
  - grouped project upload from Home group header
- Route all of them through the new shared upload build module plus browser/backend client.

### 5. Add upload API config to the frontend

Create:

- `src/upload/config.ts`

Proposed exports:

- `export function uploadApiBase(): string`
- `export function isBrowserUploadConfigured(): boolean`

Use env vars such as:

- `VITE_UPLOAD_API_BASE`
- `VITE_UPLOAD_API_KEY` if needed for internal auth

### 6. Add frontend tests around pure upload-build logic

Create:

- `src/upload/buildUploadBatch.test.ts`

Test cases:

- builds one base playable
- includes selected variants
- skips over-limit outputs
- preserves iteration names
- produces stable filenames from `fileBaseName`

Do not try to test real backend uploads in Vitest.

## Concrete Backend Task List

## Backend folder layout

Add:

- `server/package.json`
- `server/tsconfig.json`
- `server/src/index.ts`
- `server/src/config.ts`
- `server/src/types.ts`
- `server/src/routes/upload.ts`
- `server/src/jobs/store.ts`
- `server/src/jobs/queue.ts`
- `server/src/jobs/runner.ts`
- `server/src/sessions/sessionStore.ts`
- `server/src/targets/applovin.ts`
- `server/src/targets/fileServer.ts`
- `server/src/utils/files.ts`
- `server/src/utils/resultLinks.ts`

Recommended server stack:

- Node + TypeScript
- Express or Fastify
- Playwright preferred for browser automation

If Playwright is added, it should live in `server/` dependencies, not the root app package.

### 1. Define backend API contract

For MVP, prefer a simple single endpoint:

- `POST /api/upload`

Request:

- target list
- label
- files
- options

Response:

- overall status
- per-target status
- per-file counts
- final link(s)
- result page URLs

Suggested request shape:

```ts
interface UploadApiRequest {
  label: string
  targets: Array<'applovin' | 'file_server'>
  files: Array<{
    name: string
    iteration: string
    text?: string
    dataUrl?: string
  }>
  options?: {
    waitForResultMs?: number
  }
}
```

Suggested response shape:

```ts
interface UploadApiResponse {
  ok: boolean
  jobId?: string
  results: Array<{
    target: 'applovin' | 'file_server'
    ok: boolean
    filesUploaded: number
    submitted?: boolean
    finalLink?: string
    pageUrl?: string
    error?: string
  }>
}
```

### 2. Implement temp-file handling

Create:

- `server/src/utils/files.ts`

Proposed exports:

- `writeTempUploadFiles(files)`
- `cleanupTempUploadFiles(paths)`

Behavior:

- write incoming HTML payloads to temp files
- sanitize filenames
- clean up after upload

### 3. Implement session persistence

Create:

- `server/src/sessions/sessionStore.ts`

Purpose:

- keep authenticated sessions for AppLovin and file server
- avoid logging in on every request

Proposed exports:

- `loadSession(target)`
- `saveSession(target, sessionData)`
- `clearSession(target)`

Storage approach:

- encrypted local file for MVP
- move to secret store later if needed

### 4. Implement `fileServer` target adapter

Create:

- `server/src/targets/fileServer.ts`

Proposed exports:

- `uploadToFileServer(input): Promise<TargetUploadResult>`

Implementation order:

1. Verify whether direct HTTP multipart upload is possible.
2. If yes, use direct HTTP request path.
3. If not, automate the page with Playwright.

Responsibilities:

- sign in if needed
- upload files
- submit if required
- detect final link or success page URL

### 5. Implement `AppLovin` target adapter

Create:

- `server/src/targets/applovin.ts`

Proposed exports:

- `uploadToApplovin(input): Promise<TargetUploadResult>`

Responsibilities:

- restore session or log in
- open upload page
- add rows if needed
- attach files
- fill iteration names
- submit if requested
- capture resulting URL or success page

### 6. Add result-link detection helpers

Create:

- `server/src/utils/resultLinks.ts`

Proposed exports:

- `findResultLink(page, options)`
- `findResultUrlInDom(page, options)`

Goal:

- centralize heuristics for extracting returned links
- share logic across AppLovin and file server adapters

### 7. Add async job mode only if upload duration becomes a problem

For MVP, synchronous `POST /api/upload` is acceptable if:

- file counts are modest
- upload times are short enough

If needed later, add:

- `POST /api/upload-jobs`
- `GET /api/upload-jobs/:id`

Then create:

- `server/src/jobs/store.ts`
- `server/src/jobs/queue.ts`
- `server/src/jobs/runner.ts`

For now, keep this as Phase 2 unless sync upload proves too slow.

## Credential and Auth Plan

Do not store upload credentials in the browser app.

For MVP:

- store service credentials on backend via env vars

Suggested backend env vars:

- `APPLOVIN_USERNAME`
- `APPLOVIN_PASSWORD`
- `FILE_SERVER_USERNAME`
- `FILE_SERVER_PASSWORD`
- `UPLOAD_API_KEY` if you want to protect the endpoint quickly

If multiple operators need different credentials later:

- add backend credential profiles
- or integrate with existing account system

## Proposed Implementation Order

### Phase 1: Shared builder and browser backend path for file server

1. Create `src/upload/types.ts`
2. Create `src/upload/buildUploadBatch.ts`
3. Refactor `UploadModal.tsx` to use shared builder
4. Add `src/upload/browserClient.ts`
5. Add `server/` skeleton
6. Implement `POST /api/upload`
7. Implement `fileServer` adapter
8. Return final link and show it in `UploadModal`

Definition of done:

- Browser build can upload current playable to `20.255.60.183`
- UI shows returned link or result page URL
- grouped project bulk upload works from Home

### Phase 2: AppLovin backend adapter

1. Implement `server/src/targets/applovin.ts`
2. Add session persistence
3. Add backend-side result link extraction
4. Extend browser modal target selection to support AppLovin

Definition of done:

- Browser build can upload to AppLovin without Electron
- returned page/result info is surfaced in UI

### Phase 3: Hardening

1. Add retries and clearer error messages
2. Add screenshots/HTML dumps on automation failure
3. Add optional async job polling if uploads are slow
4. Add tests for upload-build module
5. Add backend smoke tests if feasible

## File-by-File Fresh Session Checklist

### Frontend files to create

- `src/upload/types.ts`
- `src/upload/buildUploadBatch.ts`
- `src/upload/browserClient.ts`
- `src/upload/config.ts`
- `src/upload/buildUploadBatch.test.ts`

### Frontend files to update

- `src/panels/UploadModal.tsx`
- `src/panels/ExportModal.tsx`
- `src/quickExport.ts`
- `src/App.tsx`
- `src/panels/Topbar.tsx`
- `src/panels/HomeScreen.tsx`
- `src/bridge.ts`

### Backend files to create

- `server/package.json`
- `server/tsconfig.json`
- `server/src/index.ts`
- `server/src/config.ts`
- `server/src/types.ts`
- `server/src/routes/upload.ts`
- `server/src/utils/files.ts`
- `server/src/utils/resultLinks.ts`
- `server/src/sessions/sessionStore.ts`
- `server/src/targets/fileServer.ts`
- `server/src/targets/applovin.ts`

### Optional later backend files

- `server/src/jobs/store.ts`
- `server/src/jobs/queue.ts`
- `server/src/jobs/runner.ts`

## Notes for the Implementing Session

- Preserve the existing Electron upload path. Do not break desktop behavior while adding browser support.
- Keep upload-build logic UI-free and reusable.
- Treat `UploadModal` as the single delivery UI for both browser and desktop.
- Prefer implementing file server browser upload first, then AppLovin.
- If the file server turns out to expose a real API, use that instead of browser automation.
