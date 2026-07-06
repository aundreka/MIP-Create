// Optional source export. Bundles the current project as a runnable Vite + TS
// repository (project JSON + assets + the full DOM runtime source) so a developer
// can `npm install && npm run dev` and customize gameplay — the game templates
// live in src/runtime/games/. This is separate from the single-file ad export.

import JSZip from 'jszip'
import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import { downloadBlob, pruneAssets } from './export'

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

void boot(project as unknown as Project, assets as unknown as AssetMap, {
  mount: document.getElementById('app') ?? document.body,
})
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
  - \`src/runtime/games/\`: **the game templates. Edit these to change gameplay
    mechanics, win conditions, difficulty, spawn logic, etc.**
  - \`src/runtime/stage.ts\` / \`scenes.ts\`: element rendering + scene flow.
  - \`src/runtime/sfx.ts\`: sound playback (event + per-element sounds).

## Notes

- The runtime has zero runtime dependencies, so the build stays light.
- This is a standard Vite app: \`npm run build\` produces a multi-file \`dist/\`. For
  the single-file, ad-network-ready HTML (with the 5MB gate and MRAID/ExitAPI
  variants), use the editor's **Export playable** instead.
`
}

const INDEX_HTML = (title: string): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover" />
    <title>${title.replace(/</g, '&lt;')}</title>
    <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}</style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`

/** Build and download a Vite source-project zip for the current project. */
export async function exportViteProject(project: Project, assets: AssetMap): Promise<void> {
  const safe = (project.meta.name || 'playable').replace(/[^a-z0-9_-]+/gi, '_')
  const used = pruneAssets(project, assets)

  const zip = new JSZip()
  zip.file('package.json', PACKAGE_JSON.replace('NAME', safe.toLowerCase()))
  zip.file('tsconfig.json', TSCONFIG)
  zip.file('vite.config.ts', VITE_CONFIG)
  zip.file('index.html', INDEX_HTML(project.meta.client || project.meta.name || 'playable'))
  zip.file('README.md', readme(project.meta.name || 'Playable'))
  zip.file('.gitignore', 'node_modules\ndist\n')

  zip.file('src/main.ts', MAIN_TS)
  zip.file('src/project.json', JSON.stringify(project, null, 2))
  zip.file('src/assets.json', JSON.stringify(used, null, 2))

  // re-root runtime/** under src/runtime/**
  for (const [path, src] of Object.entries(runtimeFiles)) {
    const rel = path.replace(/^.*\/runtime\//, 'runtime/')
    zip.file('src/' + rel, src)
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  downloadBlob(`${safe}_source.zip`, blob)
}
