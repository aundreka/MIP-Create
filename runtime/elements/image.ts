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
