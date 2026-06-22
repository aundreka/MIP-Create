// Quiz/survey answer (or a "Continue"/next button when choice.advance). Renders a
// <button> with a text label (or image), styled like a CTA via styleCta. The tap
// behaviour (select / reveal correct / advance) is wired by the stage when the
// scene plays interactively; on the static editor canvas it's just a styled card.

import type { SceneElement } from '../scene'
import type { RuntimeCtx } from '../types'
import { localize } from '../i18n'

export function createChoiceContent(el: SceneElement, ctx: RuntimeCtx): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'pa-choice'
  const src = ctx.src(el.assetId)
  if (src) {
    const img = document.createElement('img')
    img.className = 'pa-img'
    img.alt = ''
    img.draggable = false
    img.src = src
    btn.appendChild(img)
  } else {
    btn.textContent = localize(el.text)
  }
  return btn
}
