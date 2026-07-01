// Embedded playable: mounts an external single-file game (an HTML asset, e.g. a
// built HPL-MIP Phaser playable) in the game slot via an <iframe srcdoc>. A shim
// injected ahead of the game overrides the standard ad lifecycle/CTA hooks
// (gameEnd/gameClose, ExitApi/FbPlayableAd/mraid.open/window.open/…) so that when
// the embedded game finishes or its CTA is tapped, it posts a completion message
// to the host instead of navigating away — the host then advances the scene flow.
// No getHint (the embedded game runs its own hints); host points at the CTA.

import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { num, str } from './types'

// Runs INSIDE the iframe, before the game's own scripts. Turns every "the ad is
// done / user clicked install" signal into a postMessage to the parent, and
// suppresses the real navigation so OUR flow + CTA stay in control.
const SHIM = `(function(){
function done(){try{parent.postMessage({__paEmbed:'complete'},'*')}catch(e){}}
var noop=function(){};
try{
  window.gameEnd=done;window.gameClose=done;window.gameStart=noop;window.gameReady=noop;
  window.install=done;window.openAppStore=done;
  window.open=function(){done();return null};
  window.ExitApi={exit:done};
  window.FbPlayableAd={onCTAClick:done,onPause:noop,onResume:noop};
  window.playableSDK={openAppStore:done,gameReady:noop,gameStart:noop,gameEnd:done};
  window.mraid={isViewable:function(){return true},getState:function(){return 'default'},getPlacementType:function(){return 'interstitial'},addEventListener:noop,removeEventListener:noop,open:function(){done()},close:noop,useCustomClose:noop,expand:noop,getVersion:function(){return '3.0'},supports:function(){return false},getScreenSize:function(){return {width:innerWidth,height:innerHeight}}};
  window.Luna={Unity:{Playable:{openStoreUrl:done,install:done,InstallFullGame:done}}};
}catch(e){}
addEventListener('message',function(e){var d=(e&&e.data)||{};if(d&&d.__paEmbed==='mute'){try{document.querySelectorAll('audio,video').forEach(function(m){m.muted=!!d.value})}catch(_){}}});
})();`

function decodeHtml(src: string): string {
  if (!src) return ''
  const b64 = /^data:text\/html;base64,(.*)$/s.exec(src)
  if (b64) {
    try {
      return decodeURIComponent(escape(atob(b64[1])))
    } catch {
      try {
        return atob(b64[1])
      } catch {
        return ''
      }
    }
  }
  const plain = /^data:text\/html(?:;charset=[^,]*)?,(.*)$/s.exec(src)
  if (plain) {
    try {
      return decodeURIComponent(plain[1])
    } catch {
      return plain[1]
    }
  }
  return src // assume raw HTML
}

function withShim(html: string): string {
  const tag = `<script>${SHIM}</script>`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + tag)
  return tag + html
}

const PLACEHOLDER =
  'display:flex;align-items:center;justify-content:center;text-align:center;color:#9fb0d0;' +
  'font:600 14px -apple-system,Segoe UI,Roboto,sans-serif;padding:8%;height:100%;box-sizing:border-box;' +
  'background:repeating-linear-gradient(45deg,rgba(255,255,255,.04),rgba(255,255,255,.04) 14px,transparent 14px,transparent 28px);'

export function createEmbed(): GameModule {
  let ctx: GameContext
  let iframe: HTMLIFrameElement | null = null
  let completeCb: (() => void) | null = null
  let onMsg: ((e: MessageEvent) => void) | null = null
  let timer = 0
  let done = false
  let mode = 'auto'
  let timerMs = 8000

  const finish = (): void => {
    if (done) return
    done = true
    ctx.sfx.play('gameWin')
    completeCb?.()
  }

  return {
    mount(c, params) {
      ctx = c
      mode = str(params.complete, 'auto')
      timerMs = Math.max(1000, num(params.timerMs, 8000))
      const html = decodeHtml(ctx.assets.src(params.html as string))
      ctx.root.style.touchAction = 'auto'
      if (!html) {
        const ph = document.createElement('div')
        ph.style.cssText = PLACEHOLDER
        ph.textContent = '🧩  Embedded playable: pick a built game HTML in the inspector'
        ctx.root.appendChild(ph)
        return
      }
      iframe = document.createElement('iframe')
      iframe.setAttribute('scrolling', 'no')
      iframe.allow = 'autoplay; fullscreen'
      iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#000;'
      iframe.srcdoc = withShim(html)
      ctx.root.appendChild(iframe)
    },
    start() {
      if (!iframe) return
      onMsg = (e: MessageEvent): void => {
        if (iframe && e.source !== iframe.contentWindow) return
        const d = e.data
        if (d === 'download' || (d && (d.__paEmbed === 'complete' || d.type === 'complete' || d.event === 'complete'))) finish()
      }
      window.addEventListener('message', onMsg)
      if (mode === 'timer') timer = window.setTimeout(finish, timerMs)
    },
    relayout: () => {},
    getHint(): HintMove | null {
      return null
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      window.clearTimeout(timer)
      if (onMsg) window.removeEventListener('message', onMsg)
      onMsg = null
      iframe?.remove()
      iframe = null
      ctx.root.innerHTML = ''
    },
  }
}

export const EMBED_TEMPLATE: GameTemplate = {
  id: 'embed',
  label: 'Embedded playable (HTML)',
  paramFields: [
    { key: 'complete', label: 'Advance when', type: 'select', options: ['auto', 'timer'] },
    { key: 'timerMs', label: 'Timer ms (if timer)', type: 'number', min: 1000, max: 60000, step: 500 },
  ],
  assetSlots: [{ key: 'html', label: 'Game HTML file', accept: 'html' }],
  defaultParams: { complete: 'auto', timerMs: 8000, html: '' },
  // Generic centered "tap to play" hint (external iframe game the editor can't parameterize).
  defaultHandguide: {
    nodes: [{ x: 0.5, y: 0.5 }],
  },
  create: createEmbed,
}
