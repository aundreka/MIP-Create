// Button content: a <button> wrapping an image (assetId) or a text label — same
// visual as a CTA — but on click it NAVIGATES to another scene instead of firing
// the store redirect. Emits 'scene-goto' with the configured target scene id; if
// none is set it falls back to the scene's own advance rule via 'pa-advance'.
// Unlike the CTA it has no always-on pulse (animation is opt-in via el.animations)
// and it only floats above overlays when el.overlayImmune is toggled on.

import type { SceneElement } from '../scene'
import type { RuntimeCtx } from '../types'
import { localize } from '../i18n'

export function createButtonContent(el: SceneElement, ctx: RuntimeCtx): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'pa-cta' // reuse CTA base styling (reset border, cursor, etc.)

  const src = ctx.src(el.assetId)
  if (src) {
    const img = document.createElement('img')
    img.className = 'pa-img'
    img.alt = ''
    img.draggable = false
    img.src = src
    btn.appendChild(img)
  } else {
    // text label; visual styling (font/colour/fill/radius) applied at layout.
    btn.textContent = localize(el.text) || 'BUTTON'
  }

  // Swallow the pointer gesture so the scene's own tap-advance (a pointerdown
  // listener on the scene container, armed when advance.on === 'tap') can't fire
  // first and redirect to the scene's DEFAULT next scene before our click runs.
  // stopPropagation only (never preventDefault) so the click event still fires.
  btn.addEventListener('pointerdown', (ev) => ev.stopPropagation())
  btn.addEventListener('pointerup', (ev) => ev.stopPropagation())

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    ctx.emit('sfx', 'tap')
    const target = el.button?.targetSceneId
    if (target) ctx.emit('scene-goto', target)
    else ctx.emit('pa-advance') // no target chosen → behave like a tap-to-advance
  })

  return btn
}
