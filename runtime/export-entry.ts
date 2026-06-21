// Standalone export entry. Bundled (IIFE) to runtime-dist/playable-runtime.js
// and inlined into the exported single HTML. Boots the project flow from globals
// the export template injects (window.PA_PROJECT + window.PA_ASSETS).

import { boot } from './index'
import type { Project } from './scene'
import type { AssetMap } from './types'

const w = window as unknown as { PA_PROJECT?: Project; PA_ASSETS?: AssetMap }
if (w.PA_PROJECT) void boot(w.PA_PROJECT, w.PA_ASSETS ?? {})
