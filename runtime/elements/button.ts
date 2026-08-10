// Button content: a <button> wrapping an image (assetId) or a text label — same
// visual as a CTA — but on click it NAVIGATES to another scene instead of firing
// the store redirect. Emits 'scene-goto' with the configured target scene id; if
// none is set it falls back to the scene's own advance rule via 'pa-advance'.
// Unlike the CTA it has no always-on pulse (animation is opt-in via el.animations)
// and it only floats above overlays when el.overlayImmune is toggled on.
//
// wireSceneNav is shared with plain IMAGE elements that opt into `el.button` —
// an image marked as a button navigates through this same code path, so the two
// can't drift apart.

import type { SceneElement } from '../scene'
import type { RuntimeCtx } from '../types'
import { localize } from '../i18n'

/**
 * Make `listen` navigate to button.targetSceneId on click, falling back to the
 * scene's own advance rule when no target is chosen, and play the configured tap
 * feedback on `effectNode`.
 *
 * `getEl` is a GETTER, not the element itself: the editor's live-update path
 * swaps rec.el in place without rebuilding content, so a captured `el` would
 * keep serving the target/effect the element had when the scene was first built
 * (i.e. inspector edits would silently do nothing until a full rebuild).
 *
 * `effectNode` is separate from `listen` because the tap effect must NOT land on
 * .pa-el-anim — a running CSS animation there overrides transform, which would
 * swallow the press scale on any animated element. Callers pass the content node.
 */
/** Default cross-fade duration for the 'fade' tap effect, in ms. */
export const TAP_FADE_DEFAULT_MS = 400

/**
 * The 'fade' tap effect: cross-fade the element's picture into button.tapFadeAssetId
 * and STAY on it (until the scene is rebuilt, e.g. on re-entry).
 *
 * Done by overlaying a CLONE of the live <img> rather than animating opacity on the
 * original: the clone inherits the crop styles applyImageCrop wrote inline, so a
 * cropped or masked image fades within the same window instead of jumping to the
 * uncropped frame. Once the fade lands, the source is handed to the original <img>
 * and the clone is dropped — so the swap survives the next relayout, which rewrites
 * the original's geometry but never its src.
 */
function fadeToImage(effectNode: HTMLElement, el: SceneElement, ctx: RuntimeCtx): void {
  const src = ctx.src(el.button?.tapFadeAssetId)
  if (!src) return
  // .pa-img for a plain image / image button; the inner <img> for a masked container.
  const base = (effectNode.tagName === 'IMG' ? effectNode : effectNode.querySelector('img')) as HTMLImageElement | null
  // Already swapped (or a fade to the same art is mid-flight) — a second tap is a no-op.
  if (!base || base.dataset.tapFadeTo === src) return
  base.dataset.tapFadeTo = src

  const ms = Math.max(0, el.button?.tapFadeMs ?? TAP_FADE_DEFAULT_MS)
  const parent = base.parentElement
  if (!parent || ms === 0) {
    base.src = src
    return
  }

  const over = base.cloneNode(false) as HTMLImageElement
  delete over.dataset.tapFadeTo
  over.src = src
  // A cropped image is already absolutely placed, so the clone lands exactly on top.
  // Anything else sits in normal flow and has to be lifted onto the original.
  if (base.style.position !== 'absolute') {
    if (!parent.style.position) parent.style.position = 'relative'
    over.style.position = 'absolute'
    over.style.inset = '0'
    over.style.width = '100%'
    over.style.height = '100%'
  }
  over.style.opacity = '0'
  over.style.transition = `opacity ${ms}ms ease`
  parent.appendChild(over)
  // Next frame, or applying the transition and the target value together means no
  // transition at all — the same reason the pa-tap-on class lands a frame late.
  requestAnimationFrame(() => {
    over.style.opacity = '1'
  })
  setTimeout(() => {
    base.src = src
    over.remove()
  }, ms + 40)
}

export function wireSceneNav(
  listen: HTMLElement,
  effectNode: HTMLElement,
  getEl: () => SceneElement,
  ctx: RuntimeCtx,
): void {
  let held = '' // the pa-tap-* class currently applied, '' when released

  const press = (): void => {
    const el = getEl()
    const fx = el.button?.tapEffect
    if (!fx || fx === 'none') return
    // The cross-fade is a one-shot swap, not a held state — it neither uses a
    // pa-tap-* class nor has anything for release() to undo.
    if (fx === 'fade') {
      fadeToImage(effectNode, el, ctx)
      return
    }
    if (held) return
    held = `pa-tap-${fx}`
    effectNode.classList.add(held)
    // Add the "on" state a frame later: applying the transition and the target
    // value in the same frame means no transition at all — the effect would snap.
    const cls = held
    requestAnimationFrame(() => {
      if (held === cls) effectNode.classList.add('pa-tap-on')
    })
  }
  // Release on cancel/leave too, or an aborted gesture (dragging off the element,
  // or the WebView stealing the pointer) leaves the effect stuck on.
  const release = (): void => {
    if (!held) return
    effectNode.classList.remove(held, 'pa-tap-on')
    held = ''
  }

  // Swallow the pointer gesture so the scene's own tap-advance (a pointerdown
  // listener on the scene container, armed when advance.on === 'tap') can't fire
  // first and redirect to the scene's DEFAULT next scene before our click runs.
  // stopPropagation only (never preventDefault) so the click event still fires.
  listen.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation()
    press()
  })
  listen.addEventListener('pointerup', (ev) => {
    ev.stopPropagation()
    release()
  })
  listen.addEventListener('pointercancel', release)
  listen.addEventListener('pointerleave', release)

  listen.addEventListener('click', (ev) => {
    ev.stopPropagation()
    ctx.emit('sfx', 'tap')
    const cfg = getEl().button
    if (cfg?.stay) return // tap effect only — deliberately goes nowhere
    const target = cfg?.targetSceneId
    if (target) ctx.emit('scene-goto', target)
    else ctx.emit('pa-advance') // no target chosen → behave like a tap-to-advance
  })
}

export function createButtonContent(el: SceneElement, getEl: () => SceneElement, ctx: RuntimeCtx): HTMLButtonElement {
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

  wireSceneNav(btn, btn, getEl, ctx)

  return btn
}
