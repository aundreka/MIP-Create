// Image / bar / background / handguide content: a real <img>. Using a real
// <img> (not a CSS background) keeps assets crisp as long as the source art is
// >= its on-screen display size (the no-blur rule; the editor warns otherwise).

import type { SceneElement } from '../scene'
import type { RuntimeCtx } from '../types'

export function createImageContent(el: SceneElement, ctx: RuntimeCtx): HTMLImageElement {
  const img = document.createElement('img')
  img.className = 'pa-img'
  img.alt = ''
  img.draggable = false
  const src = ctx.src(el.assetId)
  if (src) img.src = src
  return img
}

// Canva-style crop of a plain image (el.crop). The box (boxW×boxH px) is the crop
// WINDOW; the source image is absolutely positioned behind it at its own size/offset
// (keeping its natural aspect) and the window clips it. No crop config → clears the
// styles so the <img> reverts to filling the box (legacy behaviour). The window's
// own overflow is clipped by applyFrame when el.crop is set.
export function applyImageCrop(
  img: HTMLElement,
  anim: HTMLElement,
  el: SceneElement,
  boxW: number,
  boxH: number,
  natW: number,
  natH: number,
): void {
  const c = el.crop
  if (!c || el.container) {
    img.style.position = ''
    img.style.width = ''
    img.style.height = ''
    img.style.left = ''
    img.style.top = ''
    return
  }
  const sc = c.scale ?? 1
  const iw = sc * boxW
  const ih = natW > 0 ? iw * (natH / natW) : sc * boxH
  anim.style.position = 'relative'
  img.style.position = 'absolute'
  img.style.width = `${iw}px`
  img.style.height = `${ih}px`
  img.style.left = `${(c.x ?? 0) * boxW}px`
  img.style.top = `${(c.y ?? 0) * boxH}px`
}

// Container/mask: the element's own asset (e.g. a heart or star with transparency)
// becomes a MASK, and the inner asset (container.imageId — an IMAGE or a VIDEO) is
// clipped to that shape, filling per `fit`. Works for any shape (alpha mask).
export function createContainerContent(el: SceneElement, ctx: RuntimeCtx): HTMLDivElement {
  const d = document.createElement('div')
  d.className = 'pa-container'
  d.style.width = '100%'
  d.style.height = '100%'
  d.style.overflow = 'hidden'
  d.style.pointerEvents = 'none'
  styleContainer(d, el, ctx)
  return d
}

export function styleContainer(d: HTMLElement, el: SceneElement, ctx: RuntimeCtx): void {
  const shape = ctx.src(el.assetId)
  const mask = shape ? `url("${shape}") center / contain no-repeat` : ''
  d.style.setProperty('-webkit-mask', mask)
  d.style.setProperty('mask', mask)

  const id = el.container?.imageId ?? ''
  const a = ctx.asset(id)
  const isVideo = a?.kind === 'video'
  const fit = el.container?.fit === 'fill' ? 'fill' : (el.container?.fit ?? 'cover') // object-fit
  // Only (re)build the inner node when the source actually changes — so a video
  // isn't restarted by unrelated scene updates.
  const sig = `${id}|${isVideo ? 'v' : 'i'}`
  if (d.dataset.innerSig !== sig) {
    d.dataset.innerSig = sig
    d.innerHTML = ''
    if (id && a) {
      const node = document.createElement(isVideo ? 'video' : 'img') as HTMLImageElement & HTMLVideoElement
      node.src = a.src
      node.style.cssText = `width:100%;height:100%;display:block;object-position:center;`
      if (isVideo) {
        node.autoplay = true
        node.loop = true
        node.muted = true
        node.setAttribute('playsinline', '')
        node.setAttribute('muted', '')
        void node.play?.().catch(() => {})
      } else {
        node.alt = ''
      }
      d.appendChild(node)
    }
  }
  const inner = d.firstElementChild as HTMLElement | null
  if (inner) inner.style.objectFit = fit
}
