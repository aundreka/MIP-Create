import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import type { ServerResponse, IncomingMessage } from 'node:http'

// Block non-public targets so the dev proxy can't be used to reach internal /
// loopback services (SSRF). http(s) public hosts only.
function blockedRemote(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return true
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true
  const h = u.hostname.toLowerCase()
  if (!h || h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    if (a === 0 || a === 127 || a === 10) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}

// Server-side proxy so the browser editor can inline CORS-restricted remote
// assets (e.g. Figma's rendered-image URLs): GET /api/proxy?url=ENCODED.
function corsProxy(): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const m = /[?&]url=([^&]+)/.exec(req.url ?? '')
    const target = m ? decodeURIComponent(m[1]) : null
    if (!target || blockedRemote(target)) {
      res.statusCode = 400
      res.end('blocked or missing url')
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
  plugins: [react(), tailwindcss(), corsProxy()],
  base: './',
  // Don't let the dev watcher hold handles on build outputs — electron-builder
  // writes/renames executables under release/ and the watcher caused EPERM.
  server: { host: 'localhost', port: 5173, watch: { ignored: ['**/release/**', '**/dist/**', '**/runtime-dist/**'] } },
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
