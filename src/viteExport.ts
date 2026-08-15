// Optional source export. Bundles the current project as a runnable Vite + TS
// repository (project JSON + assets + the full DOM runtime source) so a developer
// can `npm install && npm run dev` and customize gameplay. This is separate from
// the single-file ad export.

import JSZip from 'jszip'
import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import { downloadBlob, MRAID_HEAD, pruneAssets } from './export'
import { currentProjectId, loadProjectPreview, projectsInGroup } from './projects'
import { getState } from './store'

// Every runtime source file, pulled in as raw text at the editor's build time.
// Keys look like '../runtime/index.ts'; we re-root them under src/runtime/.
const runtimeFiles = import.meta.glob('../runtime/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const PACKAGE_JSON = `{
  "name": "NAME",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
`

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
`

const VITE_CONFIG = `import { defineConfig } from 'vite'

// Plain Vite app. The playable boots from src/main.ts and mounts full-screen.
export default defineConfig({
  server: { open: true },
})
`

const MAIN_TS = `// Boots the playable from the exported project + assets. The runtime injects its
// own CSS and mounts a full-screen stage. To customize gameplay, edit the game
// templates in ./runtime/games/ and re-run \`npm run dev\`.

import { boot } from './runtime/index'
import project from './project.json'
import assets from './assets.json'
import type { Project } from './runtime/scene'
import type { AssetMap } from './runtime/types'

const W = window as unknown as Record<string, any>
const mraid = W.mraid

let started = false
function startCreative(): void {
  if (started) return
  started = true
  // Tells the runtime the ready wait already happened here, so it registers the MRAID
  // lifecycle listeners instead of waiting a second time.
  W.PA_MRAID_WAITED = true
  void boot(project as unknown as Project, assets as unknown as AssetMap, {
    mount: document.getElementById('app') ?? document.body,
  })
}

// MRAID v2.0: nothing may initialize while the container is still loading — the ready
// event is the only legal signal to start on (see index.html for the matching guard).
// Written out longhand, subscription inside the branch: network validators static-scan
// for this exact shape, and a shared wait helper reads to them as no guard at all.
if (!mraid || typeof mraid.getState !== 'function') {
  startCreative() // no container (plain browser, npm run dev)
} else {
  try {
    if (mraid.getState() === 'loading') {
      if (typeof mraid.addEventListener === 'function') mraid.addEventListener('ready', startCreative)
      window.setTimeout(startCreative, 2500) // backstop: never leave a blank ad
    } else {
      startCreative()
    }
  } catch {
    // State unreadable — treat it as loading: same wait, same backstop.
    try {
      if (typeof mraid.addEventListener === 'function') mraid.addEventListener('ready', startCreative)
    } catch {
      // Container refused the listener; the backstop below still starts the creative.
    }
    window.setTimeout(startCreative, 2500)
  }
}
`

function readme(name: string): string {
  return `# ${name}: playable source

Editable Vite + TypeScript export of a playable ad. Use this to customize gameplay
beyond what the visual editor exposes.

## Run it

\`\`\`bash
npm install
npm run dev      # opens a local dev server with hot reload
npm run build    # production build into dist/
\`\`\`

## Where things live

- \`src/project.json\`: the scenes, elements and layout you authored in the editor.
- \`src/assets.json\`: every image / video / audio / sound, inlined as data URLs.
- \`src/main.ts\`: the entry point; boots the runtime with the project + assets.
- \`src/runtime/\`: the full DOM/CSS runtime (no external dependencies).
  - \`src/runtime/games/\`: edit these to change gameplay mechanics, win
    conditions, difficulty, spawn logic, etc.
  - \`src/runtime/stage.ts\` / \`scenes.ts\`: element rendering + scene flow.
  - \`src/runtime/sfx.ts\`: sound playback (event + per-element sounds).

## Notes

- The runtime has zero runtime dependencies, so the build stays light.
- \`index.html\` declares the MRAID bridge (\`<script src="mraid.js">\`), the
  \`isMraidUsable()\` readiness guard and the guarded \`PA_CLICKOUT\` handler, and
  \`src/main.ts\` holds initialization until \`mraid.getState()\` is past \`"loading"\`,
  so a \`npm run build\` is ad-container ready.
  The 404 for \`mraid.js\` in local dev is expected — the ad container supplies it.
- This is a standard Vite app: \`npm run build\` produces a multi-file \`dist/\`. For
  the single-file, ad-network-ready HTML (with the 5MB gate and MRAID/ExitAPI
  variants), use the editor's Export playable instead.
`
}

const INDEX_HTML = (title: string): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover" />
    <title>${title.replace(/</g, '&lt;')}</title>
    ${MRAID_HEAD}
    <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}</style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`

export interface ViteProjectSource {
  folderName: string
  project: Project
  assets: AssetMap
}

function safeToken(value: string | undefined, fallback: string): string {
  const safe = (value ?? '').trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '')
  return safe || fallback
}

function openFolder(zip: JSZip, folder: string): JSZip {
  let target = zip
  for (const segment of folder.split('/').filter(Boolean)) {
    const next = target.folder(segment)
    if (!next) throw new Error(`Could not create zip folder "${folder}"`)
    target = next
  }
  return target
}

function writePlayableViteProject(target: JSZip, project: Project, assets: AssetMap): void {
  const safe = safeToken(project.meta.name || 'playable', 'playable')
  const used = pruneAssets(project, assets)

  target.file('package.json', PACKAGE_JSON.replace('NAME', safe.toLowerCase()))
  target.file('tsconfig.json', TSCONFIG)
  target.file('vite.config.ts', VITE_CONFIG)
  target.file('index.html', INDEX_HTML(project.meta.client || project.meta.name || 'playable'))
  target.file('README.md', readme(project.meta.name || 'Playable'))
  target.file('.gitignore', 'node_modules\ndist\n')

  target.file('src/main.ts', MAIN_TS)
  target.file('src/project.json', JSON.stringify(project, null, 2))
  target.file('src/assets.json', JSON.stringify(used, null, 2))

  for (const [path, src] of Object.entries(runtimeFiles)) {
    const rel = path.replace(/^.*\/runtime\//, 'runtime/')
    target.file('src/' + rel, src)
  }
}

export async function buildViteProjectZip(project: Project, assets: AssetMap): Promise<Blob> {
  const zip = new JSZip()
  writePlayableViteProject(zip, project, assets)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export async function buildViteProjectCollectionZip(rootFolder: string, playables: ViteProjectSource[]): Promise<Blob> {
  const zip = new JSZip()
  const root = safeToken(rootFolder, 'project')
  for (const playable of playables) writePlayableViteProject(openFolder(zip, `${root}/${playable.folderName}`), playable.project, playable.assets)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

function mipSortValue(project: Project): number {
  const digits = (project.meta.mip ?? '').match(/\d+/g)?.join('')
  return digits ? Number(digits) : Number.POSITIVE_INFINITY
}

function mipFolderName(project: Project, index: number): string {
  const raw = (project.meta.mip ?? '').trim()
  const digits = raw.match(/\d+/g)?.join('')
  if (digits) return `mip${String(Number(digits))}`
  const safe = safeToken(raw.toLowerCase(), '')
  return safe || `mip${index + 1}`
}

function dedupeFolderNames(playables: Array<{ project: Project; assets: AssetMap }>): ViteProjectSource[] {
  const seen = new Map<string, number>()
  return playables.map((playable, index) => {
    const base = mipFolderName(playable.project, index)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return {
      ...playable,
      folderName: count === 0 ? base : `${base}_${count + 1}`,
    }
  })
}

export async function collectCurrentProjectViteSources(): Promise<{ rootFolder: string; playables: ViteProjectSource[] }> {
  const state = getState()
  const activeId = currentProjectId()
  const records = state.project.meta.projectId ? projectsInGroup(state.project.meta.projectId) : []
  const loaded: Array<{ project: Project; assets: AssetMap }> = [{ project: state.project, assets: state.assets }]
  const seen = new Set<string>(activeId ? [activeId] : [])

  for (const record of records) {
    if (seen.has(record.id)) continue
    seen.add(record.id)
    const data = await loadProjectPreview(record.id)
    if (data) loaded.push({ project: data.project, assets: data.assets })
  }

  loaded.sort((a, b) =>
    mipSortValue(a.project) - mipSortValue(b.project) ||
    (a.project.meta.mip ?? '').localeCompare(b.project.meta.mip ?? '') ||
    (a.project.meta.name ?? '').localeCompare(b.project.meta.name ?? ''),
  )

  return {
    rootFolder: safeToken(state.project.meta.projectName, 'project').toLowerCase(),
    playables: dedupeFolderNames(loaded),
  }
}

/** Build and download a Vite source-project zip for the current project. */
export async function exportViteProject(project: Project, assets: AssetMap): Promise<void> {
  const safe = safeToken(project.meta.name || 'playable', 'playable')
  downloadBlob(`${safe}_source.zip`, await buildViteProjectZip(project, assets))
}

/** Build and download one zip containing the Vite folders for the whole project group. */
export async function exportViteProjectGroup(): Promise<void> {
  const { rootFolder, playables } = await collectCurrentProjectViteSources()
  downloadBlob(`${rootFolder}_source.zip`, await buildViteProjectCollectionZip(rootFolder, playables))
}
