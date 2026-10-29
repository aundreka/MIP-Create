import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// Builds the DOM/CSS runtime as a single self-contained IIFE that the editor
// inlines into exported playables. CSS is injected by the runtime at boot, so
// there is no separate stylesheet. Run via `npm run build:runtime`.
//
// The output carries its version (package version + PA_BUILD, e.g. a git sha in CI) so
// any exported playable is traceable back to a runtime build. As a global, not a /*! */
// banner: exports must ship no legal-style comment banners (docs/AGENTS.md).
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string
const build = process.env.PA_BUILD || 'dev'
const banner = `window.PA_RUNTIME_VERSION=${JSON.stringify(`${version} (${build})`)};`

export default defineConfig({
  build: {
    target: 'es2018',
    outDir: 'runtime-dist',
    emptyOutDir: true,
    minify: 'esbuild',
    lib: {
      entry: 'runtime/export-entry.ts',
      formats: ['iife'],
      name: 'PARuntime',
      fileName: () => 'playable-runtime.js',
    },
    rollupOptions: {
      output: { banner },
    },
  },
})
