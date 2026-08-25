// Background removal — the wand's pixel pass.
//
// Two properties carry the whole feature. First, "only the connected area" has to
// mean it: a white subject on a white backdrop is the case that separates a usable
// wand from one that eats the artwork, and it is the exact case a playable's product
// shot hits. Second, the cut must be reversible in the sense that matters to a
// designer — the pass never touches a pixel it did not match, so raising and lowering
// the tolerance walks back to the same picture.

import { describe, it, expect } from 'vitest'
import { removeBackgroundPixels, type RemoveBgOptions } from './removeBg'

/** An `w × h` RGBA buffer from a colour-per-pixel function. */
function makeImage(w: number, h: number, at: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y)
      const i = (y * w + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return data
}

const alphaAt = (data: Uint8ClampedArray, w: number, x: number, y: number): number => data[(y * w + x) * 4 + 3]

const WHITE: [number, number, number] = [255, 255, 255]
const RED: [number, number, number] = [220, 30, 30]

// A red square (2,2)-(5,5) on white, 8×8 — a stand-in for a product shot.
const subject = (): Uint8ClampedArray => makeImage(8, 8, (x, y) => (x >= 2 && x <= 5 && y >= 2 && y <= 5 ? RED : WHITE))

// No fade band and no feather: those exist to soften an edge, and a test that wants
// to know WHICH pixels were cut should not have to reason about a gradient.
const HARD: RemoveBgOptions = { softness: 0, featherPx: 0 }

describe('removeBackgroundPixels', () => {
  it('cuts the backdrop and leaves the subject alone', () => {
    const data = subject()
    const removed = removeBackgroundPixels(data, 8, 8, HARD)
    expect(removed).toBe(64 - 16)
    expect(alphaAt(data, 8, 0, 0)).toBe(0)
    expect(alphaAt(data, 8, 3, 3)).toBe(255)
  })

  it('keeps a white subject when the backdrop is also white — the point of "connected only"', () => {
    // A white bar touching neither the corners nor the backdrop... except through the
    // backdrop's own colour. Contiguous keeps it; global matching cannot.
    const data = makeImage(8, 8, (x, y) => (x >= 2 && x <= 5 && y >= 2 && y <= 5 ? RED : WHITE))
    // Punch a white hole INSIDE the red square: same colour as the backdrop, but not
    // reachable from it without crossing red.
    const hole = (3 * 8 + 3) * 4
    data[hole] = 255
    data[hole + 1] = 255
    data[hole + 2] = 255

    const contiguous = new Uint8ClampedArray(data)
    removeBackgroundPixels(contiguous, 8, 8, HARD)
    expect(alphaAt(contiguous, 8, 3, 3)).toBe(255) // enclosed white survives

    const global = new Uint8ClampedArray(data)
    removeBackgroundPixels(global, 8, 8, { ...HARD, contiguous: false })
    expect(alphaAt(global, 8, 3, 3)).toBe(0) // …and is cut when the author asks for that
  })

  it('takes its colour from the pixels the author clicked, not the corners', () => {
    // Red corners, white middle band: the default corner seeds would cut the red.
    const data = makeImage(8, 8, (x, y) => (y >= 3 && y <= 4 ? WHITE : RED))
    removeBackgroundPixels(data, 8, 8, { ...HARD, seeds: [{ x: 0.5, y: 0.5 }] })
    expect(alphaAt(data, 8, 4, 3)).toBe(0) // the clicked white band went
    expect(alphaAt(data, 8, 0, 0)).toBe(255) // the red corners stayed
  })

  it('widens what counts as background as the tolerance rises', () => {
    // A backdrop that drifts from white to light grey down the frame, as a
    // photographed one does, sampled from its lightest corner only.
    const drift = (): Uint8ClampedArray => makeImage(8, 8, (x, y) => (x >= 2 && x <= 5 && y >= 2 && y <= 5 ? RED : [255 - y * 6, 255 - y * 6, 255 - y * 6]))
    const top: RemoveBgOptions = { ...HARD, seeds: [{ x: 0, y: 0 }] }
    const tight = drift()
    removeBackgroundPixels(tight, 8, 8, { ...top, tolerance: 1 })
    expect(alphaAt(tight, 8, 0, 7)).toBe(255) // the far end of the drift is still "not background"

    const loose = drift()
    removeBackgroundPixels(loose, 8, 8, { ...top, tolerance: 20 })
    expect(alphaAt(loose, 8, 0, 7)).toBe(0)
    expect(alphaAt(loose, 8, 3, 3)).toBe(255) // …without swallowing the subject
  })

  it('fades the rim instead of cutting it square when softness is on', () => {
    // One column midway between the backdrop and the subject: too far to cut, close
    // enough to fade. That partial pixel is what keeps a diagonal edge from stepping.
    const data = makeImage(4, 1, (x) => (x === 0 ? WHITE : x === 1 ? [200, 200, 200] : RED))
    removeBackgroundPixels(data, 4, 1, { tolerance: 5, softness: 40, featherPx: 0, seeds: [{ x: 0, y: 0 }] })
    expect(alphaAt(data, 4, 0, 0)).toBe(0)
    const rim = alphaAt(data, 4, 1, 0)
    expect(rim).toBeGreaterThan(0)
    expect(rim).toBeLessThan(255)
  })

  it('reports nothing removed rather than silently mangling an image it cannot read', () => {
    const opaque = makeImage(4, 4, () => RED)
    // Every seed sits on a transparent pixel → no background colour to match on.
    for (let p = 0; p < 16; p++) opaque[p * 4 + 3] = 0
    expect(removeBackgroundPixels(opaque, 4, 4, HARD)).toBe(0)
    // A buffer that does not match its stated size is a caller bug, not a crash.
    expect(removeBackgroundPixels(new Uint8ClampedArray(8), 4, 4, HARD)).toBe(0)
    expect(removeBackgroundPixels(new Uint8ClampedArray(0), 0, 0, HARD)).toBe(0)
  })

  it('paints the cut side of the edge with the subject’s colour, so scaling cannot bleed a halo back', () => {
    const data = subject()
    removeBackgroundPixels(data, 8, 8, HARD)
    // (1,3) is transparent and touches the red square: its RGB is no longer white, so a
    // lossy re-encode or a downscale blends red with red instead of ringing the subject.
    const i = (3 * 8 + 1) * 4
    expect(data[i + 3]).toBe(0)
    expect(data[i]).toBeGreaterThan(data[i + 1])
  })
})
