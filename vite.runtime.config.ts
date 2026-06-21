import { defineConfig } from 'vite'

// Builds the DOM/CSS runtime as a single self-contained IIFE that the editor
// inlines into exported playables. CSS is injected by the runtime at boot, so
// there is no separate stylesheet. Run via `npm run build:runtime`.
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
  },
})
