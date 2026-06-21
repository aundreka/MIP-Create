// Header/footer bar fill (also used for 'fit'-mode rectangles). A bar STRETCHES
// to fill its box, so an image fill uses background-size:100% 100% (stretches
// reliably for raster + SVG; an <img> of an SVG honors preserveAspectRatio and
// refuses to stretch). A colour fill is just a solid background.
//
// Author header/footer bands stretchable; put logos/text on top as separate FIT
// elements so they stay crisp.

import type { SceneElement } from '../scene'
import type { RuntimeCtx } from '../types'

export function applyBarFill(div: HTMLDivElement, el: SceneElement, ctx: RuntimeCtx): void {
  const src = ctx.src(el.assetId)
  if (src) {
    div.style.background = ''
    div.style.backgroundImage = `url("${src}")`
    div.style.backgroundSize = '100% 100%'
    div.style.backgroundRepeat = 'no-repeat'
    div.style.backgroundPosition = 'center'
  } else {
    div.style.backgroundImage = ''
    div.style.background = el.bar?.color ?? '#2a3350'
  }
}

export function createBarContent(el: SceneElement, ctx: RuntimeCtx): HTMLDivElement {
  const div = document.createElement('div')
  div.className = 'pa-bar'
  applyBarFill(div, el, ctx)
  return div
}
