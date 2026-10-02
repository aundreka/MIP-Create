// CTA content: a <button> wrapping the CTA art (or a text label). On click it
// fires notifyGameClose() BEFORE triggerCTA() (per coinsort/AGENTS.md ordering)
// and emits 'cta-click' for SFX wiring in a later pass. The steady pulse is
// applied to the element's animation node by the stage (ctaPulseAnimation).

import type { SceneElement } from '../scene'
import type { RuntimeCtx } from '../types'
import { triggerCTA, notifyGameClose, tapOnce } from '../networks'
import { localize } from '../i18n'

export function createCtaContent(el: SceneElement, ctx: RuntimeCtx): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'pa-cta'

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
    btn.textContent = localize(el.text) || 'PLAY'
  }

  // tapOnce: one gesture, one CTA. On iOS the touch and the compatibility click it
  // synthesises ~300ms later both land on this button, and without the 500ms collapse the
  // store opens twice (see tapOnce in ../networks).
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    tapOnce(() => {
      ctx.emit('sfx', 'ctaClick')
      notifyGameClose()
      triggerCTA()
    })
  })

  return btn
}
