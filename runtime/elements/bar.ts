// Header/footer bar fill (also used for 'fit'-mode rectangles). A bar STRETCHES
// to fill its box, so an image fill uses background-size:100% 100% (stretches
// reliably for raster + SVG; an <img> of an SVG honors preserveAspectRatio and
// refuses to stretch). A colour fill is just a solid background.
//
// Author header/footer bands stretchable; put logos/text on top as separate FIT
// elements so they stay crisp.

import type { SceneElement } from '../scene'
import type { RuntimeCtx } from '../types'

/**
 * Sample the average color of the bar image's TOP edge and cache it on the div
 * (data-pa-edge). Pinned/auto-top bars extend their box up through the letterbox
 * to the physical screen edge with the art bottom-anchored at its design height;
 * the extension above the art is painted with a flat color. Without a sampled
 * edge color that fill falls back to the SCENE background, which reads as the
 * header "detaching" from the top of the screen (a white/BG-colored gap above
 * the bar art) on any letterboxed viewport.
 */
function sampleTopEdge(div: HTMLDivElement, src: string): void {
  const img = new Image()
  img.onload = () => {
    try {
      const c = document.createElement('canvas')
      c.width = 1
      c.height = 1
      const g = c.getContext('2d')
      if (!g) return
      // Squeeze only the top 2 source rows into the 1x1 canvas => their average.
      g.drawImage(img, 0, 0, img.naturalWidth || img.width || 1, 2, 0, 0, 1, 1)
      const d = g.getImageData(0, 0, 1, 1).data
      if (d[3] < 200) return // (semi)transparent edge — no meaningful fill color
      const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
      div.dataset.paEdge = hex
      // Repaint an already-laid-out extension (image decode races the first layout).
      if (div.style.backgroundColor) div.style.backgroundColor = hex
      const outer = div.closest<HTMLElement>('.pa-el')
      if (outer && outer.style.background) outer.style.background = hex
    } catch {
      /* unreadable canvas — keep the scene-bg fallback */
    }
  }
  img.src = src
}

export function applyBarFill(div: HTMLDivElement, el: SceneElement, ctx: RuntimeCtx): void {
  const src = ctx.src(el.assetId)
  if (src) {
    div.style.background = ''
    div.style.backgroundImage = `url("${src}")`
    div.style.backgroundSize = '100% 100%'
    div.style.backgroundRepeat = 'no-repeat'
    div.style.backgroundPosition = 'center'
    if (div.dataset.paEdgeSrc !== src) {
      div.dataset.paEdgeSrc = src
      delete div.dataset.paEdge
      sampleTopEdge(div, src)
    }
  } else {
    div.style.backgroundImage = ''
    div.style.background = el.bar?.color ?? '#2a3350'
    delete div.dataset.paEdge
    delete div.dataset.paEdgeSrc
  }
}

export function createBarContent(el: SceneElement, ctx: RuntimeCtx): HTMLDivElement {
  const div = document.createElement('div')
  div.className = 'pa-bar'
  applyBarFill(div, el, ctx)
  return div
}
