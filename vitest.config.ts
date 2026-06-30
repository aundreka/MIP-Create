import { defineConfig } from 'vitest/config'

// Unit tests for the pure logic modules. jsdom gives localStorage/navigator/
// document so modules that transitively import the store/projects/runtime load
// cleanly; `?raw` imports (export.ts inlines the built runtime) resolve via Vite.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'runtime/**/*.test.ts'],
    globals: false,
  },
})
