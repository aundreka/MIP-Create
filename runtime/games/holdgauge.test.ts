// Behaviour test for the Hold gauge: holding drives the dial toward the winning
// end at the configured speed, letting go slides it back at its own speed, the
// stage art and status label follow the dial's position, and the whole widget is
// laid out in design px under a single stage-scale transform — the same rule the
// countdown ring and the pinned header follow.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { barStops, createHoldGauge, parsePositions, splitList, stageAt, withAlpha } from './holdgauge'
import { mulberry32, type GameContext } from './types'

function makeGauge(params: Record<string, unknown> = {}, scale = 1) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const played: string[] = []
  const loops: string[] = []
  const ctx: GameContext = {
    root,
    assets: {
      src: (id) => (id ? `asset:${id}` : ''),
      size: () => null,
    },
    sfx: {
      play: (e) => played.push(e),
      loopStart: (e) => loops.push('start:' + e),
      loopStop: (e) => loops.push('stop:' + e),
    },
    rng: mulberry32(7),
    scale: () => scale,
  }
  const mod = createHoldGauge()
  mod.mount(ctx, { ...(params.stages == null ? { stages: 3 } : {}), ...params })
  let done = false
  let won = false
  mod.onComplete(() => (done = true))
  mod.onWin?.(() => (won = true))
  const wrap = root.firstElementChild as HTMLDivElement
  return {
    mod,
    root,
    wrap,
    played,
    loops,
    knob: wrap.querySelector('circle') as SVGCircleElement,
    knobImg: wrap.querySelector('svg + div') as HTMLDivElement | null,
    shadow: wrap.querySelector('feDropShadow') as SVGElement | null,
    bar: wrap.querySelector('path') as SVGPathElement,
    grad: wrap.querySelector('linearGradient') as SVGLinearGradientElement,
    stops: [...wrap.querySelectorAll('stop')],
    // The stage art layers live in their own container, under the bar; the status
    // label art in its own, above it (the text pill is always last). Each layer is an
    // outer node (position + crossfade) wrapping an inner one (the art + animation).
    layers: [...(wrap.firstElementChild as HTMLDivElement).children] as HTMLDivElement[],
    labelLayers: [...(wrap.children[wrap.children.length - 2] as HTMLDivElement).children] as HTMLDivElement[],
    inner: (el: Element) => el.firstElementChild as HTMLDivElement,
    pillWrap: wrap.lastElementChild as HTMLDivElement,
    pill: (wrap.lastElementChild as HTMLDivElement).firstElementChild as HTMLDivElement,
    value: () => Number(wrap.dataset.value),
    stage: () => Number(wrap.dataset.stage),
    completed: () => done,
    won: () => won,
  }
}

const press = (root: HTMLElement, x = 0, y = 0): void => {
  root.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }))
}
const release = (root: HTMLElement): void => {
  root.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
}

describe('hold gauge — pure helpers', () => {
  it('spreads colour stops evenly, and differently per gradient mode', () => {
    // A smooth ramp reaches its end colours; hard bands are equal slices.
    expect(parsePositions('', 3, false)).toEqual([0, 0.5, 1])
    expect(parsePositions('', 4, true)).toEqual([0, 0.25, 0.5, 0.75])
  })

  it('takes authored levels, and ignores a list that cannot describe every stop', () => {
    expect(parsePositions('0,40,80', 3, true)).toEqual([0, 0.4, 0.8])
    expect(parsePositions('0,40', 3, true)).toEqual([0, 1 / 3, 2 / 3]) // too short → even
    expect(parsePositions('0,x,80', 3, true)).toEqual([0, 1 / 3, 2 / 3]) // unparseable → even
    expect(parsePositions('0,80,40', 3, true)).toEqual([0, 0.8, 0.8]) // backwards → clamped flat
  })

  it('holds each colour flat to the next level in hard-band mode', () => {
    const smooth = barStops(['#a', '#b'], [0, 1], false)
    expect(smooth).toEqual([{ o: 0, c: '#a' }, { o: 1, c: '#b' }])
    const hard = barStops(['#a', '#b'], [0, 0.6], true)
    expect(hard).toEqual([
      { o: 0, c: '#a' },
      { o: 0.6, c: '#a' },
      { o: 0.6, c: '#b' },
      { o: 1, c: '#b' },
    ])
  })

  it('reads the dial position back as a stage', () => {
    const starts = [0, 0.4, 0.8]
    expect(stageAt(0, starts)).toBe(0)
    expect(stageAt(0.39, starts)).toBe(0)
    expect(stageAt(0.4, starts)).toBe(1) // exactly on a boundary belongs to the new stage
    expect(stageAt(1, starts)).toBe(2)
  })

  it('re-mixes a hex colour at an alpha, and leaves anything else alone', () => {
    expect(withAlpha('#000000', 0.3)).toBe('rgba(0,0,0,0.3)')
    expect(withAlpha('#0f0', 1)).toBe('rgba(0,255,0,1)')
    expect(withAlpha('rgba(1,2,3,.5)', 0.3)).toBe('rgba(1,2,3,.5)') // carries its own alpha
  })

  it('splits status labels on pipes or commas', () => {
    expect(splitList('HIGH|NEUTRAL|LOW')).toEqual(['HIGH', 'NEUTRAL', 'LOW'])
    expect(splitList('a, b')).toEqual(['a', 'b'])
    expect(splitList('  ')).toEqual([])
  })

})

describe('hold gauge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T10:00:00Z'))
    // jsdom never fires rAF under fake timers — drive it off the timer queue.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('draws in design px under a single stage-scale transform', () => {
    const g = makeGauge({ sizePx: 700, thicknessPx: 56, knobSizePx: 80, knobBorderWidthPx: 10 }, 0.5)
    expect(g.wrap.style.width).toBe('700px')
    expect(g.knob.getAttribute('r')).toBe('35') // 80/2 - 10/2, in design px
    // The arc's centre is the mount box's centre, and the only viewport-dependent
    // term is the scale.
    expect(g.wrap.style.transform).toBe('translate(-50%,-50%) scale(0.5)')
    // A nudge is design px, so it rides inside that scale rather than beside it.
    const moved = makeGauge({ sizePx: 700, nudgeYPx: -40 }, 0.5)
    expect(moved.wrap.style.transform).toBe('translate(-50%,-50%) scale(0.5) translate(0px,-40px)')
  })

  it('ramps the bar colours along the bar, inside the path"s own rotation', () => {
    const g = makeGauge({ sizePx: 700, thicknessPx: 56, colorStart: '#0f0', colorMid: '', colorMid2: '', colorEnd: '#f00' })
    expect(g.stops.map((s) => [s.getAttribute('offset'), s.getAttribute('stop-color')])).toEqual([
      ['0', '#0f0'],
      ['1', '#f00'],
    ])
    // The bar is drawn from 12 o'clock and rotated into place, and a gradient rides
    // that rotation — so a half-circle's ramp is defined 12 → 6 o'clock, which the
    // rotate turns into the on-screen left → right.
    expect(g.bar.getAttribute('transform')).toBe('rotate(-90 350 350)')
    expect([g.grad.getAttribute('x1'), g.grad.getAttribute('y1')]).toEqual(['350', '28'])
    expect([g.grad.getAttribute('x2'), g.grad.getAttribute('y2')]).toEqual(['350', '672'])
  })

  it('parks the dial at the resting end — the end that does not win', () => {
    const g = makeGauge({ sizePx: 700, thicknessPx: 56, winEnd: 'Start of the bar' })
    // Win at the arc's start (9 o'clock), so resting is its end (3 o'clock).
    expect(Number(g.knob.getAttribute('cx'))).toBeCloseTo(672, 0) // 350 + (700-56)/2
    expect(Number(g.knob.getAttribute('cy'))).toBeCloseTo(350, 0)

    const flipped = makeGauge({ sizePx: 700, thicknessPx: 56, winEnd: 'End of the bar' })
    expect(Number(flipped.knob.getAttribute('cx'))).toBeCloseTo(28, 0)
  })

  it('climbs while held at the configured speed and completes at the top', () => {
    const g = makeGauge({ fillSecs: 2, sizePx: 700, thicknessPx: 56 })
    g.mod.start()
    expect(g.value()).toBe(0)

    press(g.root)
    vi.advanceTimersByTime(1000)
    expect(g.value()).toBeCloseTo(0.5, 1) // half the bar in half the fill time
    expect(g.completed()).toBe(false)

    vi.advanceTimersByTime(1100)
    expect(g.completed()).toBe(true)
    expect(g.won()).toBe(true)
    expect(g.played).toContain('gameWin')
    // Parked at the winning end (the arc's start, 9 o'clock).
    expect(Number(g.knob.getAttribute('cx'))).toBeCloseTo(28, 0)
  })

  it('slides back down on release, at its own speed', () => {
    const g = makeGauge({ fillSecs: 2, dropSecs: 4 })
    g.mod.start()
    press(g.root)
    vi.advanceTimersByTime(1000)
    const top = g.value()
    release(g.root)
    vi.advanceTimersByTime(1000)
    // Falling half as fast as it climbed: a quarter of the bar per second.
    expect(g.value()).toBeCloseTo(top - 0.25, 1)
    vi.advanceTimersByTime(2000)
    expect(g.value()).toBe(0)
    expect(g.completed()).toBe(false)
  })

  it('waits out the grace period before it starts falling', () => {
    const g = makeGauge({ fillSecs: 2, dropSecs: 2, releaseDelayMs: 800 })
    g.mod.start()
    press(g.root)
    vi.advanceTimersByTime(1000)
    const top = g.value()
    release(g.root)
    vi.advanceTimersByTime(700)
    expect(g.value()).toBeCloseTo(top, 2) // still parked
    vi.advanceTimersByTime(600)
    expect(g.value()).toBeLessThan(top - 0.1)
  })

  it('makes the win zone hold-able rather than instant', () => {
    const g = makeGauge({ fillSecs: 1, holdAtTopMs: 600 })
    g.mod.start()
    press(g.root)
    vi.advanceTimersByTime(1100)
    expect(g.value()).toBe(1)
    expect(g.completed()).toBe(false) // at the top, but not for long enough
    vi.advanceTimersByTime(600)
    expect(g.completed()).toBe(true)
  })

  it('swaps stage art and the status label as the dial crosses each level', () => {
    const g = makeGauge({
      fillSecs: 1,
      stages: 3,
      stageStopsPct: '0,40,80',
      stageImages: ['high', 'mid', 'low'],
      stageLabels: 'HIGH|NEUTRAL|LOW',
    })
    g.mod.start()
    expect(g.stage()).toBe(0)
    expect(g.pill.textContent).toBe('HIGH')
    expect(g.layers.map((l) => l.style.opacity)).toEqual(['1', '0', '0'])
    expect(g.inner(g.layers[0]).style.backgroundImage).toContain('asset:high')

    press(g.root)
    vi.advanceTimersByTime(500) // 50% of travel → stage 1
    expect(g.stage()).toBe(1)
    expect(g.pill.textContent).toBe('NEUTRAL')
    expect(g.layers.map((l) => l.style.opacity)).toEqual(['0', '1', '0'])

    vi.advanceTimersByTime(400) // 90% → stage 2
    expect(g.stage()).toBe(2)
    expect(g.pill.textContent).toBe('LOW')
  })

  it('plays the chosen animation on arriving in a new stage', () => {
    const g = makeGauge({ fillSecs: 1, dropSecs: 1, stages: 3, stageStopsPct: '0,40,80', stageAnim: 'Pop', stageAnimMs: 300, stageLabels: 'A|B|C' })
    g.mod.start()
    // The opening state is not an arrival — nothing plays yet.
    expect(g.inner(g.layers[0]).style.animation).toBe('')

    press(g.root)
    vi.advanceTimersByTime(500) // → stage 2
    expect(g.inner(g.layers[1]).style.animation).toContain('pa-pop')
    expect(g.inner(g.layers[1]).style.animation).toContain('300ms')
    expect(g.pill.style.animation).toContain('pa-pop') // the label pops with it

    // Positioning lives on the outer node, so an animation that writes transform
    // can never drag the art off its mark.
    expect(g.layers[1].style.transform).toContain('translate(')

    // It replays on the next crossing rather than firing once for the round.
    vi.advanceTimersByTime(400) // → stage 3
    expect(g.inner(g.layers[2]).style.animation).toContain('pa-pop')
  })

  it('can animate the label alone, and can be switched off', () => {
    const only = makeGauge({ fillSecs: 1, stages: 3, stageAnim: 'Bounce', stageAnimTarget: 'Label only', stageLabels: 'A|B|C' })
    only.mod.start()
    press(only.root)
    vi.advanceTimersByTime(400)
    expect(only.pill.style.animation).toContain('pa-bounce')
    expect(only.inner(only.layers[1]).style.animation).toBe('')

    const off = makeGauge({ fillSecs: 1, stages: 3, stageAnim: 'None', stageLabels: 'A|B|C' })
    off.mod.start()
    press(off.root)
    vi.advanceTimersByTime(400)
    expect(off.stage()).toBe(1) // it did cross…
    expect(off.inner(off.layers[1]).style.animation).toBe('') // …silently
    expect(off.pill.style.animation).toBe('')
  })

  it('pins --pa-s so a bounce is not scaled twice', () => {
    // The shared keyframes multiply their px offsets by --pa-s (the stage scale), and
    // everything here already sits inside one scale().
    const g = makeGauge({ stageAnim: 'Bounce' }, 0.5)
    expect(g.wrap.style.getPropertyValue('--pa-s')).toBe('1')
  })

  it('gives every stage its own sound, and only on the way up', () => {
    const g = makeGauge({ fillSecs: 1, dropSecs: 1, stages: 3, stageStopsPct: '0,40,80', stageSfx: true })
    g.mod.start()
    expect(g.played).not.toContain('stage1') // the resting stage is never climbed into

    press(g.root)
    vi.advanceTimersByTime(500) // → stage 2
    expect(g.played.filter((e) => e.startsWith('stage'))).toEqual(['stage2'])
    vi.advanceTimersByTime(400) // → stage 3, its own sound
    expect(g.played.filter((e) => e.startsWith('stage'))).toEqual(['stage2', 'stage3'])

    // Falling back through both boundaries is a loss, not progress: silence.
    release(g.root)
    vi.advanceTimersByTime(1200)
    expect(g.value()).toBe(0)
    expect(g.played.filter((e) => e.startsWith('stage'))).toEqual(['stage2', 'stage3'])

    // Climbing the same ground again does sound again.
    press(g.root)
    vi.advanceTimersByTime(500)
    expect(g.played.filter((e) => e.startsWith('stage'))).toEqual(['stage2', 'stage3', 'stage2'])
  })

  it('casts no knob shadow until one is asked for', () => {
    const g = makeGauge({})
    expect(g.shadow).toBeNull()
    expect(g.knob.getAttribute('filter')).toBeNull()
  })

  it('drops a shadow under the drawn knob, in design px', () => {
    const g = makeGauge({ knobShadow: true, knobShadowColor: '#123456', knobShadowOpacity: 45, knobShadowBlurPx: 24, knobShadowXPx: 3, knobShadowYPx: 10 })
    const ds = g.shadow as SVGElement
    expect(ds).not.toBeNull()
    expect(ds.getAttribute('dx')).toBe('3')
    expect(ds.getAttribute('dy')).toBe('10')
    expect(ds.getAttribute('stdDeviation')).toBe('12') // a CSS blur radius is 2 deviations
    expect(ds.getAttribute('flood-color')).toBe('#123456')
    expect(ds.getAttribute('flood-opacity')).toBe('0.45')
    // The filter region has to be roomy or an offset blur comes out clipped.
    const filter = ds.parentElement as unknown as SVGElement
    expect([filter.getAttribute('x'), filter.getAttribute('width')]).toEqual(['-100%', '300%'])
    expect(g.knob.getAttribute('filter')).toBe(`url(#${filter.getAttribute('id')})`)
  })

  it('shadows an uploaded knob image by its own alpha instead', () => {
    const g = makeGauge({ knobImage: 'knob', knobShadow: true, knobShadowColor: '#000000', knobShadowOpacity: 30, knobShadowBlurPx: 16, knobShadowYPx: 8 })
    expect(g.knobImg?.style.filter).toBe('drop-shadow(0px 8px 16px rgba(0,0,0,0.3))')
    // The drawn circle is out of the picture entirely, shadow included.
    expect(g.knob.getAttribute('filter')).toBeNull()
    expect(g.knob.getAttribute('fill')).toBe('none')
  })

  it('shows uploaded status-label art instead of the drawn pill', () => {
    const g = makeGauge({
      fillSecs: 1,
      stages: 3,
      stageLabels: 'HIGH|NEUTRAL|LOW',
      stageLabelImages: ['pill-high', '', 'pill-low'], // the middle stage has none
      labelImageWidthPx: 320,
    })
    g.mod.start()
    // Two slots filled → two layers, the first one showing and the pill hidden.
    expect(g.labelLayers.length).toBe(2)
    expect(g.inner(g.labelLayers[0]).style.backgroundImage).toContain('asset:pill-high')
    expect(g.labelLayers[0].style.width).toBe('320px')
    expect(g.labelLayers.map((l) => l.style.opacity)).toEqual(['1', '0'])
    expect(g.pillWrap.style.display).toBe('none')

    press(g.root)
    vi.advanceTimersByTime(400) // stage 2 of 3 — no art, so the typed pill covers it
    expect(g.labelLayers.map((l) => l.style.opacity)).toEqual(['0', '0'])
    expect(g.pillWrap.style.display).toBe('')
    expect(g.pill.textContent).toBe('NEUTRAL')

    vi.advanceTimersByTime(400)
    expect(g.labelLayers.map((l) => l.style.opacity)).toEqual(['0', '1'])
    expect(g.pillWrap.style.display).toBe('none')
  })

  it('hides label art with the status label switched off', () => {
    const g = makeGauge({ stages: 2, stageLabels: 'A|B', stageLabelImages: ['a', 'b'], showLabel: false })
    g.mod.start()
    expect(g.labelLayers.map((l) => l.style.opacity)).toEqual(['0', '0'])
    expect(g.pillWrap.style.display).toBe('none')
  })

  it('recolours the pill per stage, falling back to the one colour', () => {
    const g = makeGauge({ fillSecs: 1, stageLabels: 'A|B|C', labelBgColor: '#111111', stageLabelBgColors: '#ff0000||#00ff00' })
    g.mod.start()
    expect(g.pill.style.background).toBe('rgb(255, 0, 0)')
    press(g.root)
    vi.advanceTimersByTime(400) // stage 2 of 3 — no colour of its own
    expect(g.pill.textContent).toBe('B')
    expect(g.pill.style.background).toBe('rgb(17, 17, 17)')
    vi.advanceTimersByTime(400)
    expect(g.pill.style.background).toBe('rgb(0, 255, 0)')
  })

  it('shows the editor preview position without being started', () => {
    const g = makeGauge({ previewPct: 100, stages: 3, stageLabels: 'HIGH|NEUTRAL|LOW', sizePx: 700, thicknessPx: 56 })
    expect(g.value()).toBe(1)
    expect(g.stage()).toBe(2)
    expect(Number(g.knob.getAttribute('cx'))).toBeCloseTo(28, 0) // parked at the win end
    // …and starting the round drops it back to the authored start position.
    g.mod.start()
    expect(g.value()).toBe(0)
    expect(g.pill.textContent).toBe('HIGH')
  })

  it('holds from anywhere on the screen by default', () => {
    const g = makeGauge({ fillSecs: 1 })
    g.mod.start()
    // A press that never touches the game — the copy, the CTA, the margin.
    const elsewhere = document.createElement('div')
    document.body.appendChild(elsewhere)
    press(elsewhere)
    vi.advanceTimersByTime(500)
    expect(g.value()).toBeCloseTo(0.5, 1)
    // Releasing off the game ends the hold too, or the dial would climb unattended.
    release(document.body)
    vi.advanceTimersByTime(400)
    expect(g.value()).toBeLessThan(0.5)
  })

  it('never holds from the CTA — that press belongs to the store', () => {
    const g = makeGauge({ fillSecs: 1 })
    g.mod.start()
    const cta = document.createElement('button')
    cta.className = 'pa-cta'
    const label = document.createElement('span') // the press usually lands on the label
    cta.appendChild(label)
    document.body.appendChild(cta)

    press(label)
    vi.advanceTimersByTime(400)
    expect(g.value()).toBe(0)
    // …and the rest of the screen still holds.
    press(document.body)
    vi.advanceTimersByTime(400)
    expect(g.value()).toBeGreaterThan(0.3)
  })

  it('confines the hold to the game when asked', () => {
    const g = makeGauge({ fillSecs: 1, holdArea: 'Anywhere on the game' })
    g.mod.start()
    const elsewhere = document.createElement('div')
    document.body.appendChild(elsewhere)
    press(elsewhere)
    vi.advanceTimersByTime(400)
    expect(g.value()).toBe(0)
    press(g.root)
    vi.advanceTimersByTime(400)
    expect(g.value()).toBeGreaterThan(0.3)
  })

  it('takes its document listeners back off on destroy', () => {
    const g = makeGauge({ holdSfx: true })
    g.mod.start()
    g.mod.destroy()
    press(document.body)
    // Nothing left listening: no loop sound, and no detached dial being driven.
    expect(g.loops).toEqual([])
  })

  it('points a press-and-hold hand at the knob', () => {
    const g = makeGauge({ sizePx: 700, thicknessPx: 56 })
    g.mod.start()
    expect(g.mod.getHint()?.kind).toBe('hold')
  })

  it('ignores presses off the bar when the hold area is the bar itself', () => {
    // jsdom reports a zero-size box, so design px and client px line up 1:1.
    const g = makeGauge({ sizePx: 700, thicknessPx: 56, fillSecs: 1, holdArea: 'The bar and knob only' })
    g.mod.start()
    press(g.root, 350, 350) // the middle of the gauge — inside the arc, not on it
    vi.advanceTimersByTime(300)
    expect(g.value()).toBe(0)

    release(g.root)
    press(g.root, 28, 350) // the bar's left end
    vi.advanceTimersByTime(300)
    expect(g.value()).toBeGreaterThan(0.2)
  })

  it('loops the drag sound only while the press is held', () => {
    const g = makeGauge({ holdSfx: true, fillSecs: 4 })
    g.mod.start()
    press(g.root)
    expect(g.loops).toEqual(['start:drag'])
    vi.advanceTimersByTime(200)
    release(g.root)
    expect(g.loops).toEqual(['start:drag', 'stop:drag'])
  })

  it('sounds the slide back once, when there is ground to lose', () => {
    const g = makeGauge({ fillSecs: 2, dropSecs: 2, dropSfx: 'Once on release', dropSfxMs: 500 })
    g.mod.start()
    // Letting go at rest has lost nothing, so it stays quiet.
    press(g.root)
    release(g.root)
    vi.advanceTimersByTime(300)
    expect(g.played).not.toContain('release')

    press(g.root)
    vi.advanceTimersByTime(600)
    release(g.root)
    vi.advanceTimersByTime(100)
    expect(g.played.filter((e) => e === 'release')).toHaveLength(1)
    // Still one: the sound belongs to the slide, not to every frame of it.
    vi.advanceTimersByTime(300)
    expect(g.played.filter((e) => e === 'release')).toHaveLength(1)
  })

  it('keeps the hold loop off the channel until the slide-back sound is done', () => {
    const g = makeGauge({ fillSecs: 2, dropSecs: 4, holdSfx: true, dropSfx: 'Once on release', dropSfxMs: 500 })
    g.mod.start()
    press(g.root)
    vi.advanceTimersByTime(600)
    release(g.root)
    expect(g.loops).toEqual(['start:drag', 'stop:drag'])
    vi.advanceTimersByTime(100) // the slide (and its sound) is under way
    expect(g.played).toContain('release')

    // Grab it again straight away: the dial responds at once, the loop does not.
    press(g.root)
    vi.advanceTimersByTime(100)
    expect(g.value()).toBeGreaterThan(0) // still climbing — input is never blocked
    expect(g.loops).toEqual(['start:drag', 'stop:drag'])

    // …and once the slide-back sound has had its 500ms, the loop starts by itself.
    vi.advanceTimersByTime(400)
    expect(g.loops).toEqual(['start:drag', 'stop:drag', 'start:drag'])
  })

  it('never starts the waiting hold loop if the player let go again', () => {
    const g = makeGauge({ fillSecs: 2, dropSecs: 4, holdSfx: true, dropSfx: 'Once on release', dropSfxMs: 500 })
    g.mod.start()
    press(g.root)
    vi.advanceTimersByTime(600)
    release(g.root)
    vi.advanceTimersByTime(100)
    press(g.root) // queued behind the slide-back sound…
    release(g.root) // …but gone before it finishes
    vi.advanceTimersByTime(1000)
    expect(g.loops).toEqual(['start:drag', 'stop:drag'])
  })

  it('loops the slide-back sound for exactly as long as the slide lasts', () => {
    const g = makeGauge({ fillSecs: 1, dropSecs: 1, holdSfx: true, dropSfx: 'Loop while it falls' })
    g.mod.start()
    press(g.root)
    vi.advanceTimersByTime(500)
    release(g.root)
    vi.advanceTimersByTime(100)
    // The hold loop stopped before the slide loop started — never both at once.
    expect(g.loops).toEqual(['start:drag', 'stop:drag', 'start:release'])
    vi.advanceTimersByTime(600) // lands back at rest
    expect(g.value()).toBe(0)
    expect(g.loops).toEqual(['start:drag', 'stop:drag', 'start:release', 'stop:release'])
    // Nothing to wait out this time — a loop stops on command, so the hold resumes at once.
    press(g.root)
    expect(g.loops[g.loops.length - 1]).toBe('start:drag')
  })

  it('takes the slide-back loop off the channel when the player grabs the dial', () => {
    const g = makeGauge({ fillSecs: 1, dropSecs: 4, holdSfx: true, dropSfx: 'Loop while it falls' })
    g.mod.start()
    press(g.root)
    vi.advanceTimersByTime(500)
    release(g.root)
    vi.advanceTimersByTime(100)
    expect(g.loops).toContain('start:release')
    press(g.root)
    // Stopped first, started second — in that order, so they never overlap.
    expect(g.loops.slice(-2)).toEqual(['stop:release', 'start:drag'])
  })

  it('rebuilds its geometry on relayout without redrawing in screen px', () => {
    const g = makeGauge({ sizePx: 400, thicknessPx: 40 }, 1)
    g.mod.relayout()
    expect(g.wrap.style.width).toBe('400px')
    expect(g.knob.getAttribute('cx')).toBe(String(200 + 180)) // (400-40)/2 out from centre
  })
})
