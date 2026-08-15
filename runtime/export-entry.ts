// Standalone export entry. Bundled (IIFE) to runtime-dist/playable-runtime.js
// and inlined into the exported single HTML. Boots the project flow from globals
// the export template injects (window.PA_PROJECT + window.PA_ASSETS).

import { boot } from './index'
import type { Project } from './scene'
import type { AssetMap } from './types'

const w = window as unknown as {
  PA_PROJECT?: Project
  PA_ASSETS?: AssetMap
  PA_START?: () => void
  PA_MRAID_GATE?: boolean
}

let started = false
/** Start the creative. Idempotent — the MRAID gate can race its own timeout backstop. */
const start = (): void => {
  if (started || !w.PA_PROJECT) return
  started = true
  void boot(w.PA_PROJECT, w.PA_ASSETS ?? {})
}
w.PA_START = start

// The export shell sets PA_MRAID_GATE in <head> and calls PA_START() from its MRAID
// readiness gate at the end of <body> (MRAID_HEAD / MRAID_BOOT in src/export.ts), so the
// creative genuinely does not initialize while the container reports 'loading'. Any other
// host — editor preview, a hand-built page — has no gate, so boot immediately.
if (!w.PA_MRAID_GATE) start()
