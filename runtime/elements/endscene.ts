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
import { on } from '../emitter'

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
// Every CTA hook below is gated on a real tap INSIDE the card: end-card HTML routinely calls
// gameEnd()/mraid.open()/window.open() on load to announce "the ad finished", and those
// must not read as "the player asked to install". Taps landing inside the arm window are
// ignored for the same reason the host ignores them (see ARM_MS).
//
// roll() is the other half of autoplayHtmlEndscene: events inside a frame never reach the
// host, so a tap on the card — the one gesture a strict container WILL honour for this
// document — has to be turned into a play() from in here, on that gesture's own stack.
const HTML_SHIM = `(function(){
var armedAt=Date.now();
var acted=false;
var ended=false;
function mark(){if(Date.now()-armedAt>=${ARM_MS})acted=true;roll()}
try{['pointerdown','mousedown','touchstart','click','keydown'].forEach(function(t){addEventListener(t,mark,true)})}catch(e){}
function cta(){if(!acted)return;try{parent.postMessage({__paEnd:'cta'},'*')}catch(e){}}
function end(){if(ended)return;ended=true;try{parent.postMessage({__paEnd:'end'},'*')}catch(e){}}
function roll(){try{Array.prototype.forEach.call(document.querySelectorAll('video'),function(v){if(!v.paused||v.ended)return;v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');var p=v.play();if(p&&p.catch)p.catch(function(){if(v.muted)return;v.muted=true;var q=v.play();if(q&&q.catch)q.catch(function(){})})})}catch(e){}}
try{['loadeddata','canplay','loadedmetadata'].forEach(function(t){addEventListener(t,roll,true)})}catch(e){}
try{addEventListener('message',function(e){if(e&&e.data&&e.data.__paEnd==='roll')roll()})}catch(e){}
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
function htmlBgCss(top: string, bottom: string, left: string, right: string, landscape: boolean): string {
  const t = top || ''
  const b = bottom || t
  const l = left || t
  const r = right || b
  const c1 = landscape ? l : t
  const c2 = landscape ? r : b
  if (!c1 && !c2) return ''
  if (c1 && c2 && c2 !== c1) return `linear-gradient(${landscape ? '90deg' : '180deg'},${c1} 50%,${c2} 50%)`
  return c1 || c2
}

function htmlEndsceneFill(wrap: HTMLElement, landscape: boolean): string {
  const d = wrap.dataset
  return htmlBgCss(d.bgHtmlTop || '', d.bgHtmlBot || '', d.bgHtmlLeft || '', d.bgHtmlRight || '', landscape) || '#000000'
}

function applyHtmlEndsceneFill(wrap: HTMLElement, iframe: HTMLIFrameElement, landscape: boolean): string {
  const bg = htmlEndsceneFill(wrap, landscape)
  wrap.style.background = bg
  iframe.style.background = bg
  return bg
}

function withBgOverride(html: string, top: string, bottom: string, left: string, right: string): string {
  const pGrad = htmlBgCss(top, bottom, left, right, false)
  const lGrad = htmlBgCss(top, bottom, left, right, true)
  if (!pGrad && !lGrad) return html
  const css =
    `<style>` +
    (pGrad ? `html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden;background:${pGrad}!important}` : '') +
    (lGrad ? `@media(orientation:landscape){html,body{background:${lGrad}!important}}` : '') +
    `</style>`
  // Put the reset at the start of <head> so an iframe never exposes its default
  // white canvas while AppLovin is settling the endcard frame.
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + css)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + `<head>${css}</head>`)
  return css + html
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
    wrap.dataset.bgHtmlTop = cfg.htmlBgTop || cfg.bgColor || '#000000'
    wrap.dataset.bgHtmlBot = cfg.htmlBgBottom || ''
    wrap.dataset.bgHtmlLeft = cfg.htmlBgLeft || ''
    wrap.dataset.bgHtmlRight = cfg.htmlBgRight || ''
    wrap.style.background = htmlEndsceneFill(wrap, false)

    const ph_p = ctx.src(cfg.htmlId)
    const ph_l = ctx.src(cfg.htmlLandscapeId) || ph_p

    const iframe = document.createElement('iframe')
    iframe.className = 'pa-endscene-iframe'
    iframe.setAttribute('scrolling', 'no')
    iframe.allow = 'autoplay; fullscreen'
    iframe.style.cssText = `position:absolute;inset:0;width:100%;height:100%;border:0;display:none;visibility:hidden;background:${wrap.style.background || '#000'};`
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

  // Elements locked to the clip (endsceneMediaPos) need its NATURAL size, which a
  // <video> only reports once metadata has arrived — and the project's asset record
  // may not carry one either. Announce the moment it becomes known so those elements
  // are re-laid out against the real crop instead of keeping the plain-FIT position
  // they were given while the clip still measured 0x0.
  const announceMedia = (): void => {
    wrap.dispatchEvent(new CustomEvent('pa-endscene-media-reset', { bubbles: true }))
  }
  video.addEventListener('loadedmetadata', announceMedia)
  img.addEventListener('load', announceMedia)

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
// The frame a COVER end card actually fills, matching the SIP video template these
// cards are authored against (see setVideoForOrientation in any exported …_sip_… file).
//
// A SIP normally lets its video container fill the screen. On an EXTREME viewport —
// long side / short side past 1.8 — it pulls the container back to a CENTRED band of
// exactly 16:9 (9:16 in portrait) and covers that instead, so a very tall phone
// letterboxes rather than cropping the clip's sides away. Our end cards have to crop
// identically or the same clip reads differently in a MIP than in the SIP it came from.
//
// One function for both halves of the runtime: the DOM fit below sizes the <video> to
// this frame, and stage.ts measures against it, so the two can never disagree about
// where the clip is. The design frame (1080x1920 = 16:9) is never extreme, so authoring
// is unaffected — the band only appears on devices past the threshold.
export const COVER_TARGET_ASPECT = 16 / 9
export const COVER_EXTREME_RATIO = 1.8

export function endsceneCoverFrame(width: number, height: number): { left: number; top: number; width: number; height: number } {
  const full = { left: 0, top: 0, width, height }
  if (!(width > 0) || !(height > 0)) return full
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (long / short <= COVER_EXTREME_RATIO) return full
  if (height > width) {
    const h = width * COVER_TARGET_ASPECT
    return { left: 0, top: (height - h) / 2, width, height: h }
  }
  const w = height * COVER_TARGET_ASPECT
  return { left: (width - w) / 2, top: 0, width: w, height }
}

function applyEndsceneMediaFit(el: HTMLElement, wrap: HTMLElement, box?: { w: number; h: number }): void {
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
    // Cover on an extreme viewport fills the centred band instead of the whole card;
    // everywhere else `band` IS the card's box and this is the plain inset-0 fit.
    // Null on every non-extreme viewport, where the band IS the card's box — the clip
    // then keeps the plain inset-0 fit rather than an equivalent 0%/100% restatement.
    const frame = fit === 'cover' && box ? endsceneCoverFrame(box.w, box.h) : null
    const band = frame && (frame.width !== box!.w || frame.height !== box!.h) ? frame : null
    const pct = (v: number, of: number): string => (of > 0 ? (v / of) * 100 : 0) + '%'
    el.style.left = band ? pct(band.left, box!.w) : '0'
    el.style.top = band ? pct(band.top, box!.h) : '0'
    el.style.right = band ? '' : '0'
    el.style.bottom = band ? '' : '0'
    el.style.width = band ? pct(band.width, box!.w) : '100%'
    el.style.height = band ? pct(band.height, box!.h) : '100%'
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

// The card's own backdrop clip inside an HTML endscene, measured through the
// same-origin srcdoc iframe.
//
// Scene elements the MIP draws ON TOP of an HTML card (a badge next to a line of
// the card's own text, say) have to ride that clip's rendered box: the card
// positions its own overlays against the cover-fitted clip, and it sizes the clip
// itself — the Fabulous SIP card, for one, pulls it into a centred 16:9 band on
// extreme aspect ratios — so neither the iframe's rect nor the FIT design box is a
// safe stand-in. Returns null when there is no full-bleed clip to follow (a
// CSS-only card), which leaves those elements on plain FIT layout.
export function htmlEndsceneMediaEl(wrap: HTMLElement): HTMLVideoElement | HTMLImageElement | null {
  if (wrap.dataset.mode !== 'html') return null
  const iframe = wrap.querySelector<HTMLIFrameElement>('.pa-endscene-iframe')
  if (!iframe) return null
  let doc: Document | null = null
  try {
    doc = iframe.contentDocument
  } catch {
    return null // a card served cross-origin: not measurable, fall back to FIT
  }
  const view = doc?.documentElement
  if (!doc || !view) return null
  for (const m of Array.from(doc.querySelectorAll<HTMLVideoElement | HTMLImageElement>('video,img'))) {
    // Only a near-full-bleed element is the backdrop — logos and badges inside the
    // card must never be mistaken for it.
    if (m.clientWidth >= view.clientWidth * 0.9 || m.clientHeight >= view.clientHeight * 0.9) return m
  }
  return null
}

// Natural size of a clip, tag-sniffed rather than instanceof: the element may live
// in an HTML card's iframe document, and a different realm's HTMLVideoElement is
// never an instanceof the host's — that check silently reports every clip as 0x0.
export function mediaNaturalSize(m: HTMLVideoElement | HTMLImageElement | null): { w: number; h: number } {
  if (!m) return { w: 0, h: 0 }
  if (m.tagName === 'VIDEO') {
    const v = m as HTMLVideoElement
    return { w: v.videoWidth, h: v.videoHeight }
  }
  const i = m as HTMLImageElement
  return { w: i.naturalWidth, h: i.naturalHeight }
}

// Announce the moment an HTML card's clip becomes measurable (and every later
// resize of it), so the stage can re-lay out the elements riding that clip. Without
// this they keep the plain-FIT position they were given on the first pass, when the
// iframe had not loaded and the clip had no intrinsic size yet. The card also
// re-sizes its clip a frame AFTER a rotation (its own rAF), so the observer — not
// the host's resize handler — is what puts the overlays in the right place.
function watchHtmlEndsceneMedia(wrap: HTMLElement, iframe: HTMLIFrameElement): void {
  if (iframe.dataset.watch === iframe.dataset.cur) return
  iframe.dataset.watch = iframe.dataset.cur
  const announce = (): void => {
    wrap.dispatchEvent(new CustomEvent('pa-endscene-media-reset', { bubbles: true }))
  }
  let observed: Element | null = null
  let tries = 0
  const poll = (): void => {
    if (!wrap.isConnected || iframe.dataset.watch !== iframe.dataset.cur) return // rebuilt / rotated away
    const m = htmlEndsceneMediaEl(wrap)
    const { w, h } = mediaNaturalSize(m)
    if (m && w > 0 && h > 0) {
      if (m !== observed) {
        observed = m
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(announce).observe(m)
        announce()
      }
      return
    }
    // The clip is loaded lazily by the card (the SIP template sets its <source> in a
    // rAF and only then calls load()), so give it a bounded window to report a size.
    if (++tries <= 40) setTimeout(poll, 150)
  }
  poll()
}

// Roll an HTML end card's own clip.
//
// A VIDEO-mode card plays because the runtime calls play() on it — synchronously inside
// the tap that finished the previous scene, so the gesture is still on the stack. An HTML
// card gets no such help: its <video> lives in a document that has never been touched, and
// the card's own play() runs a frame or more after load, long past any gesture. Every
// container that gates playback on a user gesture then parks the card on its first frame
// until the player taps it — and an end card the player has to press play on is a dead end
// card. The card can also lose the clip on its own: the SIP template pauses on `blur`, and
// a tap that moves focus into the frame leaves it stopped.
//
// The srcdoc frame is same-origin, so the host drives the clip instead — a watchdog that
// restarts any clip found stopped while the ad is on screen. It has to be a watchdog and
// not a one-shot: the card fills in its <source> a frame or more after load and re-sets it
// on rotation, and the stops keep coming after the first success. The one stop we must NOT
// undo is the card going quiet because the ad left the screen, so the watchdog holds off
// between 'ad-pause' and 'ad-resume' — the same MRAID/lifecycle signal the SFX manager
// uses, rather than document.visibilityState, which a webview leaves 'visible' for an ad
// the container has already scrolled away.
const ROLL_POLL_MS = 250

function cardClips(iframe: HTMLIFrameElement): HTMLVideoElement[] {
  let doc: Document | null = null
  try {
    doc = iframe.contentDocument
  } catch {
    return [] // a card served cross-origin: not ours to drive
  }
  try {
    return doc ? Array.from(doc.querySelectorAll('video')) : []
  } catch {
    return []
  }
}

// Muting is the fallback, not the opening move: a card that authored sound keeps it
// wherever the container allows sound, and gives it up only when that is the difference
// between playing and not playing at all.
function rollClip(v: HTMLVideoElement): void {
  try {
    v.setAttribute('playsinline', '')
    v.setAttribute('webkit-playsinline', '')
    const p = v.play() as Promise<void> | undefined
    if (!p || typeof p.catch !== 'function') return
    p.catch(() => {
      if (v.muted) return
      v.muted = true
      try {
        void v.play()?.catch(() => {})
      } catch { /* no media stack (jsdom) */ }
    })
  } catch { /* no media stack (jsdom) */ }
}

function autoplayHtmlEndscene(wrap: HTMLElement, iframe: HTMLIFrameElement): void {
  if (iframe.dataset.roll === iframe.dataset.cur) return
  iframe.dataset.roll = iframe.dataset.cur

  const view = wrap.ownerDocument.defaultView ?? window
  const stale = (): boolean => !wrap.isConnected || iframe.dataset.roll !== iframe.dataset.cur
  let offScreen = false
  const offAdPause = on('ad-pause', () => {
    offScreen = true
  })
  const offAdResume = on('ad-resume', () => {
    offScreen = false
  })
  const kick = (): void => {
    if (offScreen) return
    const clips = cardClips(iframe)
    for (const v of clips) if (v.paused && !v.ended) rollClip(v)
    // Nothing to reach for means the card either has no clip yet or is one whose document
    // we cannot read; ask the shim to do it from the inside, where both are visible.
    if (!clips.length) {
      try {
        iframe.contentWindow?.postMessage({ __paEnd: 'roll' }, '*')
      } catch { /* frame not reachable yet */ }
    }
  }

  // A container that only grants playback on a gesture's own stack never grants it to the
  // card, whose document is never touched — but the host's is, by every tap on the ad. So
  // take the gesture here, while it is still live, rather than waiting for the next tick.
  const onGesture = (): void => {
    if (!done()) kick()
  }

  // The card is the last thing in the ad, so the watchdog runs until the ad does — but not
  // past a rebuild or an orientation swap, each of which starts a watchdog of its own.
  const done = (): boolean => {
    if (!stale()) return false
    offAdPause()
    offAdResume()
    view.removeEventListener('pointerdown', onGesture, true)
    return true
  }

  const poll = (): void => {
    if (done()) return
    kick()
    setTimeout(poll, ROLL_POLL_MS)
  }
  view.addEventListener('pointerdown', onGesture, true)
  poll()
}

// Pick the source for the current orientation, toggle which node shows, repaint
// the letterbox fill, and start playback when a clip becomes visible. Called from
// the stage layout pass so a device rotation re-chooses clip + fill without a
// DOM rebuild.
export function updateEndsceneMedia(wrap: HTMLElement, landscape: boolean, box?: { w: number; h: number }): void {
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
        iframe.style.visibility = 'hidden'
        const loadToken = String((Number(iframe.dataset.loadToken) || 0) + 1)
        iframe.dataset.loadToken = loadToken
        iframe.addEventListener('load', () => {
          if (iframe.dataset.loadToken === loadToken) iframe.style.visibility = ''
        }, { once: true })
        let html = withShim(decodeHtmlAsset(rawSrc))
        html = withBgOverride(html, bgTop, bgBot, bgLeft, bgRight)
        iframe.srcdoc = html
      }
      applyHtmlEndsceneFill(wrap, iframe, landscape)
      iframe.style.display = 'block'
      if (ph) ph.style.display = 'none'
      watchHtmlEndsceneMedia(wrap, iframe)
      autoplayHtmlEndscene(wrap, iframe)
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
  applyEndsceneMediaFit(video, wrap, box)
  applyEndsceneMediaFit(img, wrap, box)

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
