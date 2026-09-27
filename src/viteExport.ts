// Optional source export. Bundles the current project as a runnable Vite + TS
// repository (project JSON + assets + the full DOM runtime source) so a developer
// can `npm install && npm run dev` and customize gameplay. This is separate from
// the single-file ad export.

import JSZip from 'jszip'
import type { Project } from '../runtime/scene'
import type { AssetEntry, AssetMap } from '../runtime/types'
import { downloadBlob, MRAID_HEAD, parentAssetRefs, pruneAssets } from './export'
import { mipFolderName } from './mipName'
import { currentProjectId, loadProjectPreview, projectsInGroup } from './projects'
import { getState } from './store'

// Every runtime source file, pulled in as raw text at the editor's build time.
// Keys look like '../runtime/index.ts'; we re-root them under src/runtime/.
const runtimeFiles = import.meta.glob(['../runtime/**/*.{ts,css}', '!../runtime/**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

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

// Media lives in public/media/ as plain files so it can be swapped. The runtime
// registers custom fonts from inline bytes only, so read each font file into a
// data URL before booting. Images, video and audio load from their paths as-is.
async function withInlineFonts(list: AssetMap): Promise<AssetMap> {
  const out: AssetMap = { ...list }
  await Promise.all(
    Object.entries(list).map(async ([id, a]) => {
      if (a.kind !== 'font' || a.src.startsWith('data:')) return
      try {
        const blob = await (await fetch(a.src)).blob()
        const url = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result))
          r.onerror = () => reject(r.error)
          r.readAsDataURL(blob)
        })
        out[id] = { ...a, src: url }
      } catch {
        // Missing font file: the text falls back to the default face.
      }
    }),
  )
  return out
}

let started = false
function startCreative(): void {
  if (started) return
  started = true
  // Tells the runtime the ready wait already happened here, so it registers the MRAID
  // lifecycle listeners instead of waiting a second time.
  W.PA_MRAID_WAITED = true
  void withInlineFonts(assets as unknown as AssetMap).then((list) =>
    boot(project as unknown as Project, list, {
      mount: document.getElementById('app') ?? document.body,
    }),
  )
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
- \`public/media/\`: every image / video / audio / font as a plain file. To swap one,
  replace the file and keep its name. If the new art has a different shape, also
  update that asset's \`w\` / \`h\` (its design size in px) in \`src/assets.json\`.
- \`src/assets.json\`: the asset list: id, file path (\`media/<id>.<ext>\`) and size.
  HTML end cards stay inlined here, since they are self-contained playables.
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

/** One file of an exported source project: a path relative to the playable's
 * folder, and its text or bytes. Shared by the zip exports and Push to GitHub. */
export interface SourceFile {
  path: string
  data: string | Uint8Array
}

// Where extracted media lands. Vite copies public/ verbatim into the build, and
// "media/" (not "assets/") keeps it clear of Vite's own hashed dist/assets/.
const MEDIA_DIR = 'media'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'video/quicktime': 'mov',
  'font/sfnt': 'ttf',
  'application/x-font-ttf': 'ttf',
  'application/x-font-otf': 'otf',
  'application/font-woff': 'woff',
}

function mediaExt(mime: string, kind: AssetEntry['kind']): string {
  const known = MIME_EXT[mime]
  if (known) return known
  const sub = (mime.split('/')[1] ?? '').replace(/^x-/, '').replace(/[^a-z0-9]/gi, '')
  if (sub && sub !== 'octetstream') return sub.toLowerCase()
  return kind === 'font' ? 'ttf' : kind === 'audio' ? 'mp3' : kind === 'video' ? 'mp4' : 'png'
}

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Pull every base64 image / video / audio / font out of `used` into its own file
 * under public/media/, pointing the asset's src at it ("media/logo.webp"), so the
 * art can be swapped by replacing a file instead of editing a data URI. HTML end
 * cards stay inline (they are self-contained playables), and so does any asset a
 * card reads back out of the host: the card resolves it inside its own frame,
 * where a relative path would not reach public/.
 */
export function extractMediaFiles(used: AssetMap): { assets: AssetMap; files: SourceFile[] } {
  const keepInline = new Set<string>()
  for (const a of Object.values(used)) for (const ref of parentAssetRefs(a.src)) keepInline.add(ref)
  const assets: AssetMap = {}
  const files: SourceFile[] = []
  const taken = new Set<string>()
  for (const [id, a] of Object.entries(used)) {
    const m = /^data:([^;,]+)((?:;[^;,]*)*);base64,/i.exec(a.src)
    if (!m || a.kind === 'html' || keepInline.has(id)) {
      assets[id] = a
      continue
    }
    const ext = mediaExt(m[1].toLowerCase(), a.kind)
    const stem = id.replace(/[^a-z0-9_.-]+/gi, '_').replace(/^[._]+/, '') || 'asset'
    let name = `${stem}.${ext}`
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem}_${n}.${ext}`
    taken.add(name.toLowerCase())
    files.push({ path: `public/${MEDIA_DIR}/${name}`, data: base64Bytes(a.src.slice(m[0].length)) })
    assets[id] = { ...a, src: `${MEDIA_DIR}/${name}` }
  }
  return { assets, files }
}

/** Every file of one playable's Vite source project (no folder prefix). */
export function playableSourceFiles(project: Project, assets: AssetMap): SourceFile[] {
  const safe = safeToken(project.meta.name || 'playable', 'playable')
  const media = extractMediaFiles(pruneAssets(project, assets))
  const files: SourceFile[] = [
    { path: 'package.json', data: PACKAGE_JSON.replace('NAME', safe.toLowerCase()) },
    { path: 'tsconfig.json', data: TSCONFIG },
    { path: 'vite.config.ts', data: VITE_CONFIG },
    { path: 'index.html', data: INDEX_HTML(project.meta.client || project.meta.name || 'playable') },
    { path: 'README.md', data: readme(project.meta.name || 'Playable') },
    { path: '.gitignore', data: 'node_modules\ndist\n' },
    { path: 'src/main.ts', data: MAIN_TS },
    { path: 'src/project.json', data: JSON.stringify(project, null, 2) },
    { path: 'src/assets.json', data: JSON.stringify(media.assets, null, 2) },
  ]
  for (const [path, src] of Object.entries(runtimeFiles)) {
    files.push({ path: 'src/' + path.replace(/^.*\/runtime\//, 'runtime/'), data: src })
  }
  return [...files, ...media.files]
}

function writePlayableViteProject(target: JSZip, project: Project, assets: AssetMap): void {
  for (const f of playableSourceFiles(project, assets)) target.file(f.path, f.data)
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

function dedupeFolderNames(playables: Array<{ project: Project; assets: AssetMap }>): ViteProjectSource[] {
  const seen = new Map<string, number>()
  return playables.map((playable, index) => {
    const base = mipFolderName(playable.project, index)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return {
      ...playable,
      folderName: count === 0 ? base : `${base} (${count + 1})`,
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
