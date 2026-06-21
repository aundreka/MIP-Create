// Pass 0 demo harness. Hand-writes a scene + an inline-SVG asset map and boots
// the runtime — no editor yet. Verifies: background cover, an EXTEND header bar
// filling width, FIT content centered & letterboxed, a pulsing MRAID CTA, and
// the AppLovin-safe dim (press "d" to toggle).

import { boot } from '../runtime/index'
import type { Scene } from '../runtime/scene'
import type { AssetEntry, AssetMap } from '../runtime/types'

// `stretch` => preserveAspectRatio="none" so the SVG fills its box without
// letterboxing (needed for header/footer bands which stretch horizontally).
// Real raster assets (PNG/WebP) stretch by default and don't need this.
function svg(w: number, h: number, body: string, stretch = false): AssetEntry {
  const par = stretch ? ' preserveAspectRatio="none"' : ''
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${par}>${body}</svg>`
  return { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup), w, h }
}

const assets: AssetMap = {
  bg: svg(
    1080,
    1920,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="#27508f"/><stop offset="1" stop-color="#0b1733"/>
     </linearGradient></defs>
     <rect width="1080" height="1920" fill="url(#g)"/>
     <circle cx="160" cy="1520" r="440" fill="#ffffff" opacity="0.05"/>
     <circle cx="980" cy="480" r="320" fill="#ffffff" opacity="0.05"/>`,
  ),
  // Header is a clean band designed to stretch horizontally (stretch=true). The
  // logo/label go on top as separate FIT elements so they stay crisp.
  header: svg(
    1280,
    180,
    `<rect width="1280" height="180" fill="#11224a"/>
     <rect y="168" width="1280" height="12" fill="#0a1430"/>`,
    true,
  ),
  logo: svg(
    96,
    96,
    `<circle cx="48" cy="48" r="46" fill="#ffd34d"/>
     <circle cx="48" cy="48" r="46" fill="none" stroke="#0a1430" stroke-width="3"/>`,
  ),
  card: svg(
    760,
    980,
    `<rect width="760" height="980" rx="48" fill="#ffffff"/>
     <path d="M0 48 a48 48 0 0 1 48 -48 h664 a48 48 0 0 1 48 48 v192 h-760 z" fill="#3a7bd5"/>
     <text x="380" y="152" text-anchor="middle" font-family="Segoe UI, Arial" font-size="70" font-weight="800" fill="#ffffff">GAME AREA</text>
     <circle cx="240" cy="560" r="110" fill="#ffd34d"/>
     <circle cx="520" cy="560" r="110" fill="#ff7b9c"/>
     <rect x="160" y="770" width="440" height="120" rx="24" fill="#eef2f8"/>`,
  ),
  cta: svg(
    640,
    180,
    `<rect x="6" y="6" width="628" height="168" rx="84" fill="#16a34a"/>
     <rect x="6" y="6" width="628" height="86" rx="43" fill="#22c55e" opacity="0.45"/>
     <text x="320" y="118" text-anchor="middle" font-family="Segoe UI, Arial" font-size="66" font-weight="800" fill="#ffffff">PLAY NOW</text>`,
  ),
}

const scene: Scene = {
  meta: {
    schemaVersion: 1,
    name: 'pass0_demo',
    clickUrl: {
      ios: 'https://apps.apple.com/app/id000000000',
      android: 'https://play.google.com/store/apps/details?id=com.example.app',
    },
    baseW: 1080,
    baseH: 1920,
    bgMatchColor: '#0b1733',
  },
  elements: [
    { id: 'bg', type: 'background', name: 'Background', assetId: 'bg', x: 540, y: 960, anchor: 'center', zIndex: 0, mode: 'extend' },
    // Header tracks the design layout vertically (no pin) so its thickness stays
    // constant; the logo (centered) sits on it and shifts together with it.
    { id: 'header', type: 'bar', name: 'Header bar', assetId: 'header', x: 540, y: 0, anchor: 'top', zIndex: 10, mode: 'extend' },
    { id: 'logo', type: 'image', name: 'Logo', assetId: 'logo', x: 540, y: 90, anchor: 'center', zIndex: 12, mode: 'fit' },
    {
      id: 'title',
      type: 'text',
      name: 'Title',
      x: 540,
      y: 360,
      anchor: 'center',
      zIndex: 11,
      mode: 'fit',
      text: {
        value: 'Match the colors!',
        fontFamily: 'Segoe UI, Arial, sans-serif',
        fontSizePx: 78,
        fontWeight: 800,
        color: '#ffffff',
        align: 'center',
        strokePx: 6,
        strokeColor: '#0a1430',
      },
    },
    { id: 'card', type: 'image', name: 'Game card', assetId: 'card', x: 540, y: 1060, anchor: 'center', zIndex: 5, mode: 'fit' },
    {
      id: 'cta',
      type: 'cta',
      name: 'CTA button',
      assetId: 'cta',
      x: 540,
      y: 1740,
      anchor: 'center',
      zIndex: 20,
      mode: 'fit',
      cta: { pulse: 'medium' },
      landscape: { y: 1700 },
    },
    {
      id: 'dim',
      type: 'dim',
      name: 'Dim overlay',
      x: 540,
      y: 960,
      anchor: 'center',
      zIndex: 90,
      mode: 'fit',
      hidden: true,
      dim: { color: '#0a1024', alpha: 0.75, blocksInput: false },
    },
  ],
}

function addHud(toggleDim: () => boolean): void {
  const hud = document.createElement('div')
  hud.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:2147483647;pointer-events:none;' +
    'font:12px/1.4 monospace;color:#fff;background:rgba(0,0,0,.45);padding:6px 9px;border-radius:6px;'
  const render = (dimOn: boolean): void => {
    hud.textContent = `Pass 0 demo · press "d" = dim ${dimOn ? 'ON' : 'off'} · resize / rotate to test`
  }
  render(false)
  document.body.appendChild(hud)
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'd') render(toggleDim())
  })
}

// Wrap the single scene into a one-scene project for the multi-scene runtime.
const project = {
  meta: scene.meta,
  scenes: [{ id: 's1', name: 'Scene 1', elements: scene.elements, advance: { on: 'manual' as const } }],
  startSceneId: 's1',
}
void boot(project, assets, { mount: document.body }).then(() => {
  addHud(() => false)
  // eslint-disable-next-line no-console
  console.log('[demo] booted. Click PLAY NOW to test the CTA fallback (window.open).')
})
