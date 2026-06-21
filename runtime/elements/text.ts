// Text content = a background "box" (.pa-textbox) wrapping an inner text node
// (.pa-text-inner). The box carries the optional background/radius/padding/border
// and the explicit w/h size; the inner node carries the font styling. All styles
// are (re)applied at layout time (they're scale-dependent and must stay reactive),
// so this just builds the structure.

import type { SceneElement } from '../scene'

export function createTextContent(_el: SceneElement): HTMLDivElement {
  const box = document.createElement('div')
  box.className = 'pa-textbox'
  const inner = document.createElement('div')
  inner.className = 'pa-text-inner'
  box.appendChild(inner)
  return box
}
