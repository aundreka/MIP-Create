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
