// Endscene element: a full-bleed card shown at the end of the ad.
//
// VIDEO mode (default): a <video> (with an <img> fallback). Portrait/landscape
// sources are chosen at layout time so a device rotation swaps the clip;
// object-fit cover|contain controls fill, and in 'contain' the letterbox gaps
// are filled with the configured colour(s). `matchBgEdge` samples the clip's
// edges to set fills automatically. Tap anywhere → CTA (a real click: see armCtaTap).
//
// HTML mode: an <iframe srcdoc> loaded from an HTML asset. A shim is injected
// that intercepts the standard ad CTA signals (gameEnd, mraid.open, etc.) and
// posts them back to the host, which then fires triggerCTA() — so CTA buttons
// inside the HTML work without needing a tap-overlay. Orientation swaps the
// srcdoc when a landscape asset is configured.

import type { SceneElement } from '../scene'
import type { RuntimeCtx } from '../types'
import { triggerCTA, notifyGameClose, notifyGameEnd } from '../networks'

// How long an end card ignores input after it appears.
//
// The card mounts SYNCHRONOUSLY inside the pointerdown that finished the previous scene,
// and on touch devices that same gesture still emits its compatibility ("ghost") mouse
// events ~300ms later — hit-tested against whatever is under the finger BY THEN, i.e. the
// freshly-mounted card. Without this window the player's last game tap installs for them.
const ARM_MS = 400

// Fire `run` on a deliberate click on `el`: a full press → release, and only once the
// card has been up for ARM_MS. A bare pointerdown is not enough — see ARM_MS.
function armCtaTap(el: HTMLElement, run: () => void): void {
  const armedAt = Date.now()
  let pressed = false
  el.addEventListener('pointerdown', () => {
    pressed = Date.now() - armedAt >= ARM_MS
  })
  el.addEventListener('pointercancel', () => {
    pressed = false
  })
  el.addEventListener('pointerup', () => {
    if (!pressed) return
    pressed = false
    run()
  })
}

// Injected at the top of the HTML <head> (before any user scripts) so that
// standard ad CTA signals inside the iframe bubble up to the host.
//
// Every hook below is gated on a real tap INSIDE the card: end-card HTML routinely calls
// gameEnd()/mraid.open()/window.open() on load to announce "the ad finished", and those
// must not read as "the player asked to install". Taps landing inside the arm window are
// ignored for the same reason the host ignores them (see ARM_MS).
const HTML_SHIM = `(function(){
var armedAt=Date.now();
var acted=false;
var ended=false;
function mark(){if(Date.now()-armedAt>=${ARM_MS})acted=true}
try{['pointerdown','mousedown','touchstart','click','keydown'].forEach(function(t){addEventListener(t,mark,true)})}catch(e){}
function cta(){if(!acted)return;try{parent.postMessage({__paEnd:'cta'},'*')}catch(e){}}
function end(){if(ended)return;ended=true;try{parent.postMessage({__paEnd:'end'},'*')}catch(e){}}
var noop=function(){};
try{
  window.gameEnd=end;window.gameClose=cta;window.install=cta;window.openAppStore=cta;
  window.open=function(){cta();return null};
  window.ExitApi={exit:cta};
  window.FbPlayableAd={onCTAClick:cta,onPause:noop,onResume:noop};
  window.playableSDK={openAppStore:cta,gameReady:noop,gameStart:noop,gameEnd:end};
  window.mraid={isViewable:function(){return true},getState:function(){return 'default'},getPlacementType:function(){return 'interstitial'},addEventListener:noop,removeEventListener:noop,open:function(){cta()},close:noop,useCustomClose:noop,expand:noop,getVersion:function(){return '3.0'},supports:function(){return false},getScreenSize:function(){return {width:innerWidth,height:innerHeight}}};
  window.Luna={Unity:{Playable:{openStoreUrl:cta,install:cta,InstallFullGame:cta}}};
}catch(e){}
})();`

function decodeHtmlAsset(src: string): string {
  if (!src) return ''
  const b64 = /^data:text\/html;base64,(.*)$/s.exec(src)
  if (b64) {
    try { return decodeURIComponent(escape(atob(b64[1]))) } catch { try { return atob(b64[1]) } catch { return '' } }
  }
  const plain = /^data:text\/html(?:;charset=[^,]*)?,(.*)$/s.exec(src)
  if (plain) { try { return decodeURIComponent(plain[1]) } catch { return plain[1] } }
  return src
}

function withShim(html: string): string {
  const tag = `<script>${HTML_SHIM}</script>`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + tag)
  return tag + html
}

// Inject a CSS block that overrides the iframe's body background with the
// configured portrait/landscape gradient colors. Called only when at least one
// color is set; safe to apply to any HTML end card.
function withBgOverride(html: string, top: string, bottom: string, left: string, right: string): string {
  const t = top || ''
  const b = bottom || t
  const l = left || t
  const r = right || b
  if (!t && !l) return html
  const pGrad = t && b && b !== t
    ? `linear-gradient(180deg,${t} 50%,${b} 50%)`
    : (t || b)
  const lGrad = l && r && r !== l
    ? `linear-gradient(90deg,${l} 50%,${r} 50%)`
    : (l || r)
  const css =
    `<style>` +
    (pGrad ? `body,html{margin:0;padding:0}body{background:${pGrad}!important}` : '') +
    (lGrad ? `@media(orientation:landscape){body{background:${lGrad}!important}}` : '') +
    `</style>`
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, css + '</head>')
  return html + css
}

const PH_STYLE =
  'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;' +
  'color:#9fb0d0;font-size:clamp(12px,3vw,20px);padding:8%;background:repeating-linear-gradient(' +
  '45deg,rgba(255,255,255,.04),rgba(255,255,255,.04) 14px,transparent 14px,transparent 28px);'

export function createEndsceneContent(el: SceneElement, ctx: RuntimeCtx): HTMLElement {
  const cfg = el.endscene
  const wrap = document.createElement('div')
  wrap.className = 'pa-endscene'
  wrap.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;'

  const ph = document.createElement('div')
  ph.className = 'pa-endscene-ph'
  ph.style.cssText = PH_STYLE

  if (cfg?.mode === 'html') {
    // HTML mode: iframe srcdoc loaded from an HTML asset. The shim converts
    // in-HTML CTA signals into a postMessage that fires triggerCTA() here.
    wrap.dataset.mode = 'html'
    if (cfg.htmlBgTop)    wrap.dataset.bgHtmlTop  = cfg.htmlBgTop
    if (cfg.htmlBgBottom) wrap.dataset.bgHtmlBot  = cfg.htmlBgBottom
    if (cfg.htmlBgLeft)   wrap.dataset.bgHtmlLeft = cfg.htmlBgLeft
    if (cfg.htmlBgRight)  wrap.dataset.bgHtmlRight = cfg.htmlBgRight

    const ph_p = ctx.src(cfg.htmlId)
    const ph_l = ctx.src(cfg.htmlLandscapeId) || ph_p

    const iframe = document.createElement('iframe')
    iframe.className = 'pa-endscene-iframe'
    iframe.setAttribute('scrolling', 'no')
    iframe.allow = 'autoplay; fullscreen'
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:none;background:#000;'
    iframe.dataset.p = ph_p
    iframe.dataset.l = ph_l

    ph.textContent = 'HTML Endscene: pick an HTML asset'
    wrap.appendChild(iframe)
    wrap.appendChild(ph)

    // Second gate, in case the card ships its own copies of the hooks the shim installs:
    // a CTA signal arriving while the card is still arming is a load-time announcement,
    // not a tap.
    const armedAt = Date.now()
    const onMsg = (e: MessageEvent): void => {
      if (e.source && iframe.contentWindow && e.source !== iframe.contentWindow) return
      const d = e.data
      if (d && d.__paEnd === 'end') {
        notifyGameEnd()
      } else if (d && d.__paEnd === 'cta') {
        if (Date.now() - armedAt < ARM_MS) return
        ctx.emit('sfx', 'ctaClick')
        notifyGameClose()
        triggerCTA()
      }
    }
    const view = wrap.ownerDocument.defaultView ?? window
    const addMessage = view.addEventListener.bind(view)
    const removeMessage = view.removeEventListener.bind(view)
    addMessage('message', onMsg)
    // Clean up when the wrap is removed from the DOM
    const obs = new MutationObserver(() => {
      if (!wrap.isConnected) {
        try { removeMessage('message', onMsg) } catch { /* jsdom teardown */ }
        obs.disconnect()
      }
    })
    obs.observe(wrap.ownerDocument, { childList: true, subtree: true })

    return wrap
  }

  // VIDEO mode (default)
  wrap.dataset.mode = 'video'

  // Stash the per-orientation fill config on the node so the (orientation-aware)
  // layout pass can rebuild the letterbox fill without a closure. Sampled edge
  // colours (from matchBgEdge) get written into data-s* and take precedence.
  //   portrait  → bgP1 (single/top)  + bgP2 (bottom, splitP)
  //   landscape → bgL1 (single/left) + bgL2 (right,  splitL); falls back to portrait
  wrap.dataset.bgP1 = cfg?.bgColor || '#000000'
  wrap.dataset.bgP2 = cfg?.bgColor2 || ''
  wrap.dataset.splitP = cfg?.bgColor2 ? '1' : ''
  wrap.dataset.bgL1 = cfg?.bgColorL || cfg?.bgColor || '#000000'
  wrap.dataset.bgL2 = cfg?.bgColorL2 || ''
  wrap.dataset.splitL = cfg?.bgColorL2 ? '1' : ''
  // Transparent endcard: skip the fill entirely so a lower element shows through.
  wrap.dataset.transparent = cfg?.transparentBg ? '1' : ''
  wrap.style.background = cfg?.transparentBg ? 'transparent' : wrap.dataset.bgP1 // initial; layout refines per orientation

  // Fit is applied per-orientation by updateEndsceneMedia (so portrait and landscape can
  // differ); stash both here. Landscape inherits portrait when its overrides are unset.
  wrap.dataset.fitP = cfg?.objectFit ?? 'cover'
  wrap.dataset.fhP = cfg?.fullHeight ? '1' : ''
  wrap.dataset.fitL = cfg?.objectFitL ?? cfg?.objectFit ?? 'cover'
  wrap.dataset.fhL = (cfg?.fullHeightL ?? cfg?.fullHeight) ? '1' : ''
  wrap.dataset.zoomP = String(cfg?.zoom ?? 1)
  wrap.dataset.zoomL = String(cfg?.zoomL ?? cfg?.zoom ?? 1)
  const mediaCss = 'display:none;'

  // resolve sources; landscape falls back to portrait so a single clip works both ways
  const pv = ctx.src(cfg?.portraitVideoId)
  const lv = ctx.src(cfg?.landscapeVideoId) || pv
  const pi = ctx.src(cfg?.portraitImageId)
  const li = ctx.src(cfg?.landscapeImageId) || pi
  const pa = ctx.asset(cfg?.portraitVideoId) ?? ctx.asset(cfg?.portraitImageId)
  const la = ctx.asset(cfg?.landscapeVideoId) ?? ctx.asset(cfg?.landscapeImageId) ?? pa
  if (pa?.w && pa?.h) {
    wrap.dataset.mediaWP = String(pa.w)
    wrap.dataset.mediaHP = String(pa.h)
  }
  if (la?.w && la?.h) {
    wrap.dataset.mediaWL = String(la.w)
    wrap.dataset.mediaHL = String(la.h)
  }

  const video = document.createElement('video')
  video.className = 'pa-endscene-video'
  video.muted = true
  video.defaultMuted = true
  video.loop = cfg?.loop ?? true
  video.autoplay = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.preload = 'auto'
  video.style.cssText = mediaCss
  video.dataset.p = pv
  video.dataset.l = lv

  const img = document.createElement('img')
  img.className = 'pa-endscene-img'
  img.alt = ''
  img.draggable = false
  img.style.cssText = mediaCss
  img.dataset.p = pi
  img.dataset.l = li

  ph.textContent = 'Sample Endscene'

  wrap.appendChild(video)
  wrap.appendChild(img)
  wrap.appendChild(ph)

  // match-edge: sample the clip's edges once it has a decodable frame, then
  // re-apply the fill using the current orientation (recorded by the layout pass).
  if (cfg?.matchBgEdge) {
    const sampleFrom = (src: CanvasImageSource): void => {
      const e = sampleEdges(src)
      if (!e) return
      wrap.dataset.sTop = e.top
      wrap.dataset.sBottom = e.bottom
      wrap.dataset.sLeft = e.left
      wrap.dataset.sRight = e.right
      wrap.dataset.sSolid = e.solid
      applyEndsceneFill(wrap, wrap.dataset.land === '1')
    }
    video.addEventListener('loadeddata', () => sampleFrom(video))
    img.addEventListener('load', () => sampleFrom(img))
  }

  // tap anywhere → CTA (shielded by the selection overlay in the editor canvas)
  armCtaTap(wrap, () => {
    ctx.emit('sfx', 'ctaClick')
    notifyGameClose()
    triggerCTA()
  })

  return wrap
}

// Paint the letterbox fill for the current orientation. Split fills become a
// hard-stop 50/50 gradient (the contain media is centred, so the split sits under
// the media and each visible bar shows a single colour). Sampled edge colours win
// over the configured ones when matchBgEdge produced them.
// Apply the fit (cover / contain / extend-full-height + zoom) to a media element for
// the current orientation. Re-run on every orientation change so portrait and landscape
// can use different fits. Sets individual properties (not cssText) so `display` — owned
// by the source/visibility logic — is preserved.
function applyEndsceneMediaFit(el: HTMLElement, wrap: HTMLElement): void {
  const d = wrap.dataset
  const landscape = d.land === '1'
  const fullH = landscape ? d.fhL === '1' : d.fhP === '1'
  const fit = (landscape ? d.fitL : d.fitP) || 'cover'
  const zoom = (landscape ? d.zoomL : d.zoomP) || '1'
  el.style.position = 'absolute'
  el.style.transformOrigin = 'center'
  if (fullH) {
    // Full height: top & bottom at the screen edges, natural width, centred.
    el.style.left = '50%'
    el.style.top = '50%'
    el.style.right = ''
    el.style.bottom = ''
    el.style.width = 'auto'
    el.style.height = '100%'
    el.style.maxWidth = 'none'
    el.style.objectFit = ''
    el.style.transform = `translate(-50%,-50%) scale(${zoom})`
  } else {
    el.style.left = '0'
    el.style.top = '0'
    el.style.right = '0'
    el.style.bottom = '0'
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.maxWidth = ''
    el.style.objectFit = fit
    el.style.transform = `scale(${zoom})`
  }
}

export function applyEndsceneFill(wrap: HTMLElement, landscape: boolean): void {
  const d = wrap.dataset
  if (d.transparent === '1') {
    wrap.style.background = 'transparent'
    return
  }
  if (landscape) {
    if (d.splitL === '1') {
      const c1 = d.sLeft ?? d.bgL1 ?? '#000000'
      const c2 = d.sRight ?? d.bgL2 ?? '#000000'
      wrap.style.background = `linear-gradient(to right, ${c1} 0 50%, ${c2} 50% 100%)`
    } else {
      wrap.style.background = d.sSolid || d.bgL1 || '#000000'
    }
  } else {
    if (d.splitP === '1') {
      const c1 = d.sTop ?? d.bgP1 ?? '#000000'
      const c2 = d.sBottom ?? d.bgP2 ?? '#000000'
      wrap.style.background = `linear-gradient(to bottom, ${c1} 0 50%, ${c2} 50% 100%)`
    } else {
      wrap.style.background = d.sSolid || d.bgP1 || '#000000'
    }
  }
}

// Average the border bands of a decoded frame, per edge + an overall ring.
// Returns null if the source is undecodable or the canvas is tainted (cross-origin).
function sampleEdges(src: CanvasImageSource): { top: string; bottom: string; left: string; right: string; solid: string } | null {
  try {
    const W = 24
    const H = 24
    const band = 3
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const g = c.getContext('2d')
    if (!g) return null
    g.drawImage(src, 0, 0, W, H)
    const data = g.getImageData(0, 0, W, H).data
    const avg = (pred: (x: number, y: number) => boolean): string => {
      let r = 0
      let gr = 0
      let b = 0
      let n = 0
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (!pred(x, y)) continue
          const i = (y * W + x) * 4
          r += data[i]
          gr += data[i + 1]
          b += data[i + 2]
          n++
        }
      if (!n) return 'rgb(0,0,0)'
      return `rgb(${Math.round(r / n)},${Math.round(gr / n)},${Math.round(b / n)})`
    }
    return {
      top: avg((_x, y) => y < band),
      bottom: avg((_x, y) => y >= H - band),
      left: avg((x) => x < band),
      right: avg((x) => x >= W - band),
      solid: avg((x, y) => x < band || x >= W - band || y < band || y >= H - band),
    }
  } catch {
    return null
  }
}

// Pick the source for the current orientation, toggle which node shows, repaint
// the letterbox fill, and start playback when a clip becomes visible. Called from
// the stage layout pass so a device rotation re-chooses clip + fill without a
// DOM rebuild.
export function updateEndsceneMedia(wrap: HTMLElement, landscape: boolean): void {
  const ph = wrap.querySelector('.pa-endscene-ph') as HTMLElement | null

  // HTML mode
  if (wrap.dataset.mode === 'html') {
    const iframe = wrap.querySelector('.pa-endscene-iframe') as HTMLIFrameElement | null
    if (!iframe) return
    const rawSrc = (landscape ? iframe.dataset.l : iframe.dataset.p) || ''
    if (rawSrc) {
      const bgTop   = wrap.dataset.bgHtmlTop   || ''
      const bgBot   = wrap.dataset.bgHtmlBot   || ''
      const bgLeft  = wrap.dataset.bgHtmlLeft  || ''
      const bgRight = wrap.dataset.bgHtmlRight || ''
      // Include bg colors in the cache key so a color change forces a srcdoc refresh
      const cacheKey = `${rawSrc}|${bgTop}|${bgBot}|${bgLeft}|${bgRight}`
      if (iframe.dataset.cur !== cacheKey) {
        iframe.dataset.cur = cacheKey
        let html = withShim(decodeHtmlAsset(rawSrc))
        html = withBgOverride(html, bgTop, bgBot, bgLeft, bgRight)
        iframe.srcdoc = html
      }
      iframe.style.display = 'block'
      if (ph) ph.style.display = 'none'
    } else {
      iframe.style.display = 'none'
      if (ph) ph.style.display = 'flex'
    }
    return
  }

  // Video mode
  const video = wrap.querySelector('.pa-endscene-video') as HTMLVideoElement | null
  const img = wrap.querySelector('.pa-endscene-img') as HTMLImageElement | null
  if (!video || !img) return

  wrap.dataset.land = landscape ? '1' : ''
  applyEndsceneFill(wrap, landscape)
  // Re-apply the (possibly per-orientation) fit to both media elements.
  applyEndsceneMediaFit(video, wrap)
  applyEndsceneMediaFit(img, wrap)

  const vSrc = (landscape ? video.dataset.l : video.dataset.p) || ''
  const iSrc = (landscape ? img.dataset.l : img.dataset.p) || ''

  if (vSrc) {
    if (video.dataset.cur !== vSrc) {
      video.dataset.cur = vSrc
      video.src = vSrc
      video.load()
      wrap.dispatchEvent(new CustomEvent('pa-endscene-media-reset', { bubbles: true }))
    }
    void video.play().catch(() => {})
    video.style.display = 'block'
    img.style.display = 'none'
    if (ph) ph.style.display = 'none'
  } else if (iSrc) {
    if (img.dataset.cur !== iSrc) {
      img.dataset.cur = iSrc
      img.src = iSrc
      wrap.dispatchEvent(new CustomEvent('pa-endscene-media-reset', { bubbles: true }))
    }
    img.style.display = 'block'
    video.style.display = 'none'
    if (ph) ph.style.display = 'none'
  } else {
    video.style.display = 'none'
    img.style.display = 'none'
    if (ph) ph.style.display = 'flex'
  }
}
