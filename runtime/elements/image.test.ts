// applyImageCrop places the source image behind the element's box (the crop window)
// at its own size/offset so the window clips it — a Canva-style crop that never
// distorts the picture. No crop config (or a container) clears the styles so the
// <img> reverts to filling the box.

import { describe, it, expect } from 'vitest'
import { applyImageCrop } from './image'
import type { SceneElement } from '../scene'

function make(crop?: SceneElement['crop'], extra?: Partial<SceneElement>): { img: HTMLImageElement; anim: HTMLDivElement; el: SceneElement } {
  const anim = document.createElement('div')
  const img = document.createElement('img')
  anim.appendChild(img)
  const el = { id: 'i1', type: 'image', name: 'pic', x: 0, y: 0, anchor: 'center', zIndex: 0, mode: 'fit', crop, ...extra } as SceneElement
  return { img, anim, el }
}

describe('applyImageCrop', () => {
  it('no crop config → clears placement so the <img> fills the box', () => {
    const { img, anim, el } = make(undefined)
    img.style.position = 'absolute' // stale value
    applyImageCrop(img, anim, el, 400, 300, 800, 600)
    expect(img.style.position).toBe('')
    expect(img.style.width).toBe('')
    expect(img.style.left).toBe('')
  })

  it('default crop (full image, box seeded to image aspect) fills the box exactly', () => {
    // box 400x300, natural 800x600 (same 4:3 aspect) → image is exactly the box
    const { img, anim, el } = make({ scale: 1, x: 0, y: 0 })
    applyImageCrop(img, anim, el, 400, 300, 800, 600)
    expect(img.style.position).toBe('absolute')
    expect(img.style.width).toBe('400px')
    expect(img.style.height).toBe('300px')
    expect(img.style.left).toBe('0px')
    expect(img.style.top).toBe('0px')
  })

  it('scale + offset size and place the picture relative to the box', () => {
    // scale 2 → image is twice the box width; offset -0.25 of box in each axis
    const { img, anim, el } = make({ scale: 2, x: -0.25, y: -0.1 })
    applyImageCrop(img, anim, el, 400, 300, 800, 600)
    expect(img.style.width).toBe('800px') // 2 * 400
    expect(img.style.height).toBe('600px') // 800 * (600/800)
    expect(img.style.left).toBe('-100px') // -0.25 * 400
    expect(img.style.top).toBe('-30px') // -0.1 * 300
  })

  it('preserves the image aspect regardless of the box aspect', () => {
    // box 400x400 (square) but image 800x400 (2:1) → height follows the image ratio
    const { img, anim, el } = make({ scale: 1, x: 0, y: 0 })
    applyImageCrop(img, anim, el, 400, 400, 800, 400)
    expect(img.style.width).toBe('400px')
    expect(img.style.height).toBe('200px') // 400 * (400/800)
  })

  it('a container image is never crop-placed (masking owns the inner fit)', () => {
    const { img, anim, el } = make({ scale: 2, x: 0, y: 0 }, { container: { fit: 'cover' } })
    applyImageCrop(img, anim, el, 400, 300, 800, 600)
    expect(img.style.position).toBe('')
  })
})
