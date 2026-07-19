import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// Builds the DOM/CSS runtime as a single self-contained IIFE that the editor
// inlines into exported playables. CSS is injected by the runtime at boot, so
// there is no separate stylesheet. Run via `npm run build:runtime`.
//
// The output carries a version banner (package version + PA_BUILD, e.g. a git
// sha in CI) so any exported playable is traceable back to a runtime build.
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string
const build = process.env.PA_BUILD || 'dev'
const banner = `/*! playable-runtime v${version} (${build}) */`

export default defineConfig({
  plugins: [tailwindcss()],
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
