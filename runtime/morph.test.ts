// Cross-scene morph — the "magic move" that flies an element onto its counterpart on
// the next screen (see MorphConfig in scene.ts, and the flight in morph.ts).
//
// Two contracts are worth pinning. The PLAN half decides which pairs can fly at all:
// dropping a pair silently is the right behaviour (a deleted target, a carry-over that
// was never rebuilt), but half-playing one is not — a source hidden with nothing to
// hand over to leaves a hole on screen. The FLIGHT half owes the author the geometry
// they authored: the copy has to LAND on the target's rect, at the target's size,
// whatever the two boxes happen to be — that is the whole feature.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { captureMorphs, launchMorphs, morphScale, planMorphs, MORPH_DEFAULT_EASING, MORPH_DEFAULT_MS, MORPH_OFF_CLASS } from './morph'
import type { MorphConfig, SceneDef, SceneElement } from './scene'

const el = (id: string, extra: Partial<SceneElement> = {}): SceneElement =>
  ({ id, type: 'image', name: id, x: 0, y: 0, anchor: 'center', zIndex: 1, mode: 'fit', ...extra }) as SceneElement

const scene = (id: string, elements: SceneElement[]): SceneDef => ({ id, name: id, kind: 'overlay', advance: { on: 'tap' }, elements })

const morph = (toSceneId: string, toElementId: string, extra: Partial<MorphConfig> = {}): MorphConfig => ({ toSceneId, toElementId, ...extra })

// ---------------------------------------------------------------------------
// planMorphs
// ---------------------------------------------------------------------------

describe('planMorphs', () => {
  it('pairs an element with its target and fills in every default', () => {
    const a = scene('s1', [el('logo', { morph: morph('s2', 'badge') })])
    const b = scene('s2', [el('badge')])
    expect(planMorphs(a, b)).toEqual([
      {
        fromId: 'logo',
        toId: 'badge',
        effect: 'cross-fade',
        scaleMode: 'fit',
        endScale: 1,
        durationMs: MORPH_DEFAULT_MS,
        delayMs: 0,
        easing: MORPH_DEFAULT_EASING,
      },
    ])
  })

  it('keeps the author’s knobs when they set them', () => {
    const a = scene('s1', [el('logo', { morph: morph('s2', 'badge', { effect: 'move', scaleMode: 'stretch', endScale: 1.2, durationMs: 900, delayMs: 120, easing: 'linear' }) })])
    expect(planMorphs(a, scene('s2', [el('badge')]))[0]).toMatchObject({
      effect: 'move',
      scaleMode: 'stretch',
      endScale: 1.2,
      durationMs: 900,
      delayMs: 120,
      easing: 'linear',
    })
  })

  it('only fires on the screen the morph names', () => {
    const a = scene('s1', [el('logo', { morph: morph('s2', 'badge') })])
    expect(planMorphs(a, scene('s3', [el('badge')]))).toEqual([])
  })

  it('drops a pair whose target is gone, hidden, or a carry-over', () => {
    const a = scene('s1', [el('logo', { morph: morph('s2', 'badge') })])
    expect(planMorphs(a, scene('s2', [el('other')]))).toEqual([]) // deleted / renamed
    expect(planMorphs(a, scene('s2', [el('badge', { hidden: true })]))).toEqual([])
    expect(planMorphs(a, scene('s2', [el('badge', { persist: true })]))).toEqual([])
  })

  it('drops a source that is hidden or carried across scenes', () => {
    const b = scene('s2', [el('badge')])
    expect(planMorphs(scene('s1', [el('logo', { hidden: true, morph: morph('s2', 'badge') })]), b)).toEqual([])
    // A carry-over is built once above every scene and never rebuilt by the cut, so
    // there is no hand-over to animate — morphing it would hide it for nothing.
    expect(planMorphs(scene('s1', [el('logo', { persist: true, morph: morph('s2', 'badge') })]), b)).toEqual([])
  })

  it('lets several sources converge on one target', () => {
    const a = scene('s1', [el('c1', { morph: morph('s2', 'pile') }), el('c2', { morph: morph('s2', 'pile') })])
    expect(planMorphs(a, scene('s2', [el('pile')])).map((p) => p.fromId)).toEqual(['c1', 'c2'])
  })

  it('never morphs a scene into itself, or across a missing scene', () => {
    const a = scene('s1', [el('logo', { morph: morph('s1', 'other') }), el('other')])
    expect(planMorphs(a, a)).toEqual([])
    expect(planMorphs(a, null)).toEqual([])
    expect(planMorphs(null, a)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// morphScale
// ---------------------------------------------------------------------------

describe('morphScale', () => {
  const a = { cx: 0, cy: 0, w: 100, h: 100 }

  it('fits contain-style — the smaller ratio, so the flyer never spills past the target', () => {
    expect(morphScale('fit', a, { cx: 0, cy: 0, w: 400, h: 200 })).toEqual([2, 2])
  })

  it('stretches each axis on its own when asked to land on the box exactly', () => {
    expect(morphScale('stretch', a, { cx: 0, cy: 0, w: 400, h: 200 })).toEqual([4, 2])
  })

  it('leaves the size alone for a pure move', () => {
    expect(morphScale('none', a, { cx: 0, cy: 0, w: 400, h: 200 })).toEqual([1, 1])
  })

  it('falls back to 1 rather than dividing by an unmeasurable box', () => {
    expect(morphScale('fit', { cx: 0, cy: 0, w: 0, h: 0 }, a)).toEqual([1, 1])
  })
})

// ---------------------------------------------------------------------------
// the flight
// ---------------------------------------------------------------------------

/** jsdom reports every rect as 0×0, so each node carries the box it is meant to have. */
function node(box: { x: number; y: number; w: number; h: number }): HTMLDivElement {
  const n = document.createElement('div')
  n.className = 'pa-el'
  const anim = document.createElement('div')
  anim.className = 'pa-el-anim'
  n.appendChild(anim)
  n.getBoundingClientRect = () => ({ left: box.x, top: box.y, width: box.w, height: box.h, right: box.x + box.w, bottom: box.y + box.h, x: box.x, y: box.y, toJSON: () => ({}) })
  return n
}

const plan = (extra: Partial<ReturnType<typeof planMorphs>[number]> = {}): ReturnType<typeof planMorphs>[number] => ({
  fromId: 'a',
  toId: 'b',
  effect: 'cross-fade',
  scaleMode: 'fit',
  endScale: 1,
  durationMs: 400,
  delayMs: 0,
  easing: 'linear',
  ...extra,
})

/** Run the double-rAF the flight defers its end styles behind. */
const flushFrames = (): void => {
  vi.advanceTimersByTime(32)
}

describe('the flight', () => {
  let container: HTMLElement
  let src: HTMLDivElement
  let dst: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    // rAF isn't driven by jsdom's clock; run the callback on a timer so fake timers reach it.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16) as unknown as number)
    document.body.innerHTML = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    src = node({ x: 0, y: 0, w: 100, h: 100 }) // centre (50,50)
    dst = node({ x: 300, y: 500, w: 200, h: 200 }) // centre (400,600)
  })

  const run = (p = plan()) => {
    const caps = captureMorphs([p], () => src)
    return { caps, run: launchMorphs(container, caps, () => dst) }
  }

  it('hides both ends and lifts a copy into its own layer', () => {
    const { run: r } = run()
    expect(r).not.toBeNull()
    expect(src.classList.contains(MORPH_OFF_CLASS)).toBe(true)
    expect(dst.classList.contains(MORPH_OFF_CLASS)).toBe(true)
    const layer = container.firstElementChild as HTMLElement
    // cross-fade flies both ends: the source copy out, the target copy in.
    expect(layer.children).toHaveLength(2)
    // The copies are copies — the originals stay in their own scenes.
    expect(layer.contains(src)).toBe(false)
    expect(layer.contains(dst)).toBe(false)
  })

  it('lands the copy on the target’s centre, at the target’s size', () => {
    const { run: r } = run()
    flushFrames()
    const fly = container.firstElementChild!.firstElementChild as HTMLElement
    // (400,600) - (50,50) = (350,550); 200/100 = 2x
    expect(fly.style.transform).toBe('translate(350.00px,550.00px) scale(2.0000,2.0000)')
    expect(fly.style.transformOrigin).toBe('50px 50px') // scaled about the SOURCE's centre
    expect(fly.style.transition).toContain('transform 400ms linear 0ms')
    r!.finish()
  })

  it('settles over the target when the author asks it to, without moving the target', () => {
    const { run: r } = run(plan({ endScale: 1.25 }))
    flushFrames()
    const layer = container.firstElementChild!
    expect((layer.children[0] as HTMLElement).style.transform).toContain('scale(2.5000,2.5000)')
    // The incoming copy still ends at the target's own authored size — 'lands at' is a
    // flourish on the departing art, not a resize of what stays on screen.
    expect((layer.children[1] as HTMLElement).style.transform).toBe('translate(0.00px,0.00px) scale(1.0000,1.0000)')
    r!.finish()
  })

  it('flies the target copy backwards down the same path so the two stay superimposed', () => {
    const { run: r } = run()
    const ghost = container.firstElementChild!.children[1] as HTMLElement
    // Starts on the source's box: (50,50) - (400,600), shrunk 100/200.
    expect(ghost.style.transform).toBe('translate(-350.00px,-550.00px) scale(0.5000,0.5000)')
    expect(ghost.style.opacity).toBe('0')
    flushFrames()
    expect(ghost.style.transform).toBe('translate(0.00px,0.00px) scale(1.0000,1.0000)') // ends at rest
    expect(ghost.style.opacity).toBe('1')
    r!.finish()
  })

  it('hands over at the landing frame for "move" — one flight, no second copy', () => {
    const { run: r } = run(plan({ effect: 'move' }))
    expect(container.firstElementChild!.children).toHaveLength(1)
    flushFrames()
    expect((container.firstElementChild!.firstElementChild as HTMLElement).style.opacity).toBe('') // never fades
    r!.finish()
  })

  it('sequences the hand-off for "fade-through" instead of blending the two', () => {
    const { run: r } = run(plan({ effect: 'fade-through', durationMs: 400 }))
    flushFrames()
    const [fly, ghost] = Array.from(container.firstElementChild!.children) as HTMLElement[]
    expect(fly.style.transition).toContain('opacity 180ms linear 0ms') // out over the first 45%
    expect(ghost.style.transition).toContain('opacity 220ms linear 180ms') // in over the rest
    r!.finish()
  })

  it('reveals the target and drops the layer once the flight lands', () => {
    const { run: r } = run(plan({ durationMs: 400, delayMs: 100 }))
    flushFrames()
    vi.advanceTimersByTime(400) // still in the air (delay 100 + duration 400)
    expect(dst.classList.contains(MORPH_OFF_CLASS)).toBe(true)
    vi.advanceTimersByTime(200)
    expect(dst.classList.contains(MORPH_OFF_CLASS)).toBe(false)
    expect(container.firstElementChild!.children).toHaveLength(0)
    r!.finish()
  })

  it('holds a shared target until the LAST of its flights lands', () => {
    const src2 = node({ x: 0, y: 0, w: 50, h: 50 })
    const byId: Record<string, HTMLElement> = { a: src, a2: src2 }
    const caps = captureMorphs([plan({ durationMs: 200 }), plan({ fromId: 'a2', durationMs: 800 })], (id) => byId[id])
    const r = launchMorphs(container, caps, () => dst)!
    flushFrames()
    vi.advanceTimersByTime(400) // the short flight has landed, the long one has not
    expect(dst.classList.contains(MORPH_OFF_CLASS)).toBe(true)
    vi.advanceTimersByTime(500)
    expect(dst.classList.contains(MORPH_OFF_CLASS)).toBe(false)
    r.finish()
  })

  it('puts the source back rather than blinking it out when the target can’t be found', () => {
    const caps = captureMorphs([plan()], () => src)
    expect(src.classList.contains(MORPH_OFF_CLASS)).toBe(true)
    expect(launchMorphs(container, caps, () => null)).toBeNull() // nothing to fly
    expect(src.classList.contains(MORPH_OFF_CLASS)).toBe(false)
    expect(container.children).toHaveLength(0)
  })

  it('finish() snaps everything home — no copy left over a screen it no longer belongs to', () => {
    const { run: r } = run()
    r!.finish()
    expect(container.children).toHaveLength(0)
    expect(dst.classList.contains(MORPH_OFF_CLASS)).toBe(false)
    r!.finish() // idempotent
    expect(dst.classList.contains(MORPH_OFF_CLASS)).toBe(false)
  })

  it('restoreSources() gives the source back to a scene that is coming back (overlay dismiss)', () => {
    const { run: r } = run()
    r!.finish()
    expect(src.classList.contains(MORPH_OFF_CLASS)).toBe(true) // still gone: it BECAME the target
    r!.restoreSources()
    expect(src.classList.contains(MORPH_OFF_CLASS)).toBe(false)
  })

  it('freezes the copy so a live loop can’t drag it off the rect it was measured at', () => {
    src.querySelector<HTMLElement>('.pa-el-anim')!.style.animation = 'pa-pulse 1s infinite'
    const { run: r } = run()
    const copy = container.querySelector('.pa-el-anim') as HTMLElement
    expect(copy.style.animation).toBe('none')
    // …and the original is left exactly as it was, pulse included.
    expect(src.querySelector<HTMLElement>('.pa-el-anim')!.style.animation).toBe('pa-pulse 1s infinite')
    r!.finish()
  })
})
