import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import type { ServerResponse, IncomingMessage } from 'node:http'

// Server-side proxy so the browser editor can inline CORS-restricted remote
// assets (e.g. Figma's rendered-image URLs): GET /api/proxy?url=ENCODED.
function corsProxy(): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const m = /[?&]url=([^&]+)/.exec(req.url ?? '')
    const target = m ? decodeURIComponent(m[1]) : null
    if (!target) {
      res.statusCode = 400
      res.end('missing url')
      return
    }
    try {
      const r = await fetch(target)
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Content-Type', r.headers.get('content-type') ?? 'application/octet-stream')
      res.end(Buffer.from(await r.arrayBuffer()))
    } catch (e) {
      res.statusCode = 502
      res.end('proxy error: ' + (e as Error).message)
    }
  }
  const mw: Connect.NextHandleFunction = (req, res) => void handler(req, res)
  return {
    name: 'pa-cors-proxy',
    configureServer(s) {
      s.middlewares.use('/api/proxy', mw)
    },
    configurePreviewServer(s) {
      s.middlewares.use('/api/proxy', mw)
    },
  }
}

// Editor app (React renderer) + secondary pages:
//   index.html         -> the editor
//   runtime-frame.html -> the embedded runtime render surface (used in iframes)
//   demo.html          -> the standalone Pass-0 runtime demo
//
// The single-file production EXPORT of a playable uses a separate config
// (arrives in Pass 2); this config is for developing/running the editor.
export default defineConfig({
  plugins: [react(), corsProxy()],
  base: './',
  // Don't let the dev watcher hold handles on build outputs — electron-builder
  // writes/renames executables under release/ and the watcher caused EPERM.
  server: { watch: { ignored: ['**/release/**', '**/dist/**', '**/runtime-dist/**'] } },
  build: {
    target: 'es2018',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        'runtime-frame': resolve(__dirname, 'runtime-frame.html'),
        demo: resolve(__dirname, 'demo.html'),
      },
    },
  },
})
