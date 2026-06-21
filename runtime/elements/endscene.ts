// Endscene element: a full-bleed <video> (with an <img> fallback) shown at the
// end of the ad. Portrait/landscape sources are chosen by orientation at layout
// time (so a device rotation swaps the clip); object-fit cover|contain controls
// fill, and in 'contain' the letterbox gaps are filled with the configured
// colour(s). With a SPLIT fill the two bars are filled independently — top/bottom
// in portrait, left/right in landscape — so a clip whose edges differ in colour
// matches accurately on both sides. `matchBgEdge` samples the clip's edges to set
// those fills automatically. Tap anywhere → CTA.
//
// The clip is muted + looped + autoplay (muted autoplay needs no gesture), so it
// previews live in the editor too. Unmuting on first interaction lands with the
// SFX/audio-unlock work in the next pass.

import type { SceneElement } from '../scene'
import type { RuntimeCtx } from '../types'
import { triggerCTA, notifyGameClose } from '../networks'

const PH_STYLE =
  'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;' +
  'color:#9fb0d0;font-size:clamp(12px,3vw,20px);padding:8%;background:repeating-linear-gradient(' +
  '45deg,rgba(255,255,255,.04),rgba(255,255,255,.04) 14px,transparent 14px,transparent 28px);'

export function createEndsceneContent(el: SceneElement, ctx: RuntimeCtx): HTMLElement {
  const cfg = el.endscene
  const wrap = document.createElement('div')
  wrap.className = 'pa-endscene'
  wrap.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;'

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
  wrap.style.background = wrap.dataset.bgP1 // initial; layout refines per orientation

  const fit = cfg?.objectFit ?? 'cover'

  // resolve sources; landscape falls back to portrait so a single clip works both ways
  const pv = ctx.src(cfg?.portraitVideoId)
  const lv = ctx.src(cfg?.landscapeVideoId) || pv
  const pi = ctx.src(cfg?.portraitImageId)
  const li = ctx.src(cfg?.landscapeImageId) || pi

  const video = document.createElement('video')
  video.className = 'pa-endscene-video'
  video.muted = true
  video.defaultMuted = true
  video.loop = cfg?.loop ?? true
  video.autoplay = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.preload = 'auto'
  video.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:${fit};display:none;`
  video.dataset.p = pv
  video.dataset.l = lv

  const img = document.createElement('img')
  img.className = 'pa-endscene-img'
  img.alt = ''
  img.draggable = false
  img.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:${fit};display:none;`
  img.dataset.p = pi
  img.dataset.l = li

  const ph = document.createElement('div')
  ph.className = 'pa-endscene-ph'
  ph.style.cssText = PH_STYLE
  ph.textContent = '🎬  Endscene — pick a video (or image) in the inspector'

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
  wrap.addEventListener('pointerdown', () => {
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
export function applyEndsceneFill(wrap: HTMLElement, landscape: boolean): void {
  const d = wrap.dataset
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
  const video = wrap.querySelector('.pa-endscene-video') as HTMLVideoElement | null
  const img = wrap.querySelector('.pa-endscene-img') as HTMLImageElement | null
  const ph = wrap.querySelector('.pa-endscene-ph') as HTMLElement | null
  if (!video || !img) return

  wrap.dataset.land = landscape ? '1' : ''
  applyEndsceneFill(wrap, landscape)

  const vSrc = (landscape ? video.dataset.l : video.dataset.p) || ''
  const iSrc = (landscape ? img.dataset.l : img.dataset.p) || ''

  if (vSrc) {
    if (video.dataset.cur !== vSrc) {
      video.dataset.cur = vSrc
      video.src = vSrc
      video.load()
    }
    void video.play().catch(() => {})
    video.style.display = 'block'
    img.style.display = 'none'
    if (ph) ph.style.display = 'none'
  } else if (iSrc) {
    if (img.dataset.cur !== iSrc) {
      img.dataset.cur = iSrc
      img.src = iSrc
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
