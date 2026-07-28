// countdown.attachToId: an attached date/countdown derives its position + font
// scale from the TARGET's rendered rect (not the global FIT math), so it keeps
// the same relative offset and proportional height at any viewport size / zoom.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { playProject } from './scenes'
import { computeMetrics, setDesign } from './responsive'
import type { Project, SceneElement } from './scene'

const DESIGN_W = 1080
const DESIGN_H = 1920

// Image at design rect (340,250)-(740,350); countdown anchored 'left' at (760,300)
// — inline to the image's right, vertically centered on it.
function makeProject(attachToId?: string): Project {
  const elements: SceneElement[] = [
    { id: 'img', type: 'image', name: 'Img', x: 540, y: 300, w: 400, h: 100, anchor: 'center', zIndex: 5, mode: 'fit', assetId: 'a1' },
    {
      id: 'cd',
      type: 'countdown',
      name: 'Date',
      x: 760,
      y: 300,
      anchor: 'left',
      zIndex: 6,
      mode: 'fit',
      text: { value: '', fontSizePx: 60, fontWeight: 800, color: '#fff', align: 'left' },
      countdown: { mode: 'dynamic', dynamicDays: 1, format: 'Ends {MMMM} {D}', attachToId },
    },
  ]
  return {
    meta: { schemaVersion: 1, name: 'attach', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H },
    startSceneId: 'game1',
    scenes: [{ id: 'game1', name: 'Game', kind: 'game', elements, advance: { on: 'manual' } }],
  }
}

function makeVideoProject(): Project {
  const elements: SceneElement[] = [
    {
      id: 'vid',
      type: 'endscene',
      name: 'Video',
      x: 540,
      y: 960,
      w: 1080,
      h: 1920,
      anchor: 'center',
      zIndex: 5,
      mode: 'extend',
      endscene: { portraitVideoId: 'pvid', landscapeVideoId: 'lvid', objectFit: 'cover', objectFitL: 'contain', loop: true, bgColor: '#000000' },
    },
    {
      id: 'cd',
      type: 'countdown',
      name: 'Date',
      x: 540,
      y: 1600,
      anchor: 'center',
      zIndex: 6,
      mode: 'fit',
      text: { value: '', fontSizePx: 60, fontWeight: 800, color: '#fff', align: 'center' },
      countdown: { mode: 'dynamic', dynamicDays: 1, format: 'Ends {MMMM} {D}', attachToId: 'vid' },
    },
  ]
  return {
    meta: { schemaVersion: 1, name: 'video-attach', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H },
    startSceneId: 'game1',
    scenes: [{ id: 'game1', name: 'Game', kind: 'endscene', elements, advance: { on: 'manual' } }],
  }
}

function makeLegacyCountdownProject(countdown: NonNullable<SceneElement['countdown']>): Project {
  const elements: SceneElement[] = [
    {
      id: 'vid',
      type: 'endscene',
      name: 'Video',
      x: 540,
      y: 960,
      w: 1080,
      h: 1920,
      anchor: 'center',
      zIndex: 1,
      mode: 'extend',
      endscene: {
        portraitVideoId: 'pvid',
        landscapeVideoId: 'lvid',
        objectFit: 'cover',
        objectFitL: 'contain',
        zoom: 1,
        zoomL: 1.35,
        loop: true,
        bgColor: '#000000',
      },
    },
    {
      id: 'cd',
      type: 'countdown',
      name: 'Countdown overlay',
      x: 539,
      y: 539,
      anchor: 'center',
      zIndex: 2,
      mode: 'fit',
      scale: 2.406,
      text: { value: '', fontSizePx: 64, fontWeight: 800, color: '#000', align: 'center' },
      countdown,
      landscape: { x: 1294, y: 374, scale: 2.531 },
    },
  ]
  return {
    meta: { schemaVersion: 1, name: 'legacy-video-countdown', clickUrl: { ios: '', android: '' }, baseW: DESIGN_W, baseH: DESIGN_H },
    startSceneId: 'game1',
    scenes: [{ id: 'game1', name: 'Game', kind: 'endscene', elements, advance: { on: 'manual' } }],
  }
}

function makeLegacyDynamicDateProject(): Project {
  return makeLegacyCountdownProject({ mode: 'dynamic', dynamicDays: 0, format: '{date}', dateStyle: 'short' })
}

function makeSip5LandscapeCountdownProject(): Project {
  const project = makeLegacyCountdownProject({ mode: 'dynamic', dynamicDays: 0, format: '{date}', dateStyle: 'short' })
  const vid = project.scenes[0].elements[0]
  if (vid.type === 'endscene' && vid.endscene) {
    vid.endscene.zoomL = 1.2
    vid.endscene.bgColorL = '#d4dce5'
  }
  const cd = project.scenes[0].elements[1]
  cd.x = 539
  cd.y = 1429
  cd.scale = 0.816
  cd.landscape = { x: -173, y: 1533 }
  return project
}

function makeSip3LandscapeCountdownProject(): Project {
  const project = makeLegacyCountdownProject({ mode: 'dynamic', dynamicDays: 0, format: 'MMM D, YYYY', dateStyle: 'short', textCase: 'upper' })
  const vid = project.scenes[0].elements[0]
  if (vid.type === 'endscene' && vid.endscene) vid.endscene.zoomL = 1.2
  const cd = project.scenes[0].elements[1]
  cd.x = 540
  cd.y = 797
  cd.scale = 1.318
  cd.landscape = { x: 1137, y: 696, scale: 1.544 }
  return project
}

const fakeRect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

function mountAt(attachToId?: string): { mount: HTMLElement; relayout: () => void } {
  document.body.innerHTML = ''
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  setDesign(DESIGN_W, DESIGN_H)
  computeMetrics(390, 844)
  const mgr = playProject(makeProject(attachToId), { a1: { src: 'data:image/png;base64,', w: 400, h: 100 } }, { mount, interactive: true })
  return { mount, relayout: () => mgr.relayout() }
}

const q = (mount: HTMLElement, id: string): HTMLElement => mount.querySelector<HTMLElement>(`.pa-el[data-id="${id}"]`)!
const videoAssets = {
  pvid: { src: 'data:video/mp4;base64,', w: 1080, h: 1920, kind: 'video' as const },
  lvid: { src: 'data:video/mp4;base64,', w: 1920, h: 1080, kind: 'video' as const },
}

describe('countdown attachToId', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  })

  it('follows the target rect: offset and font scale by the target render scale', () => {
    const { mount, relayout } = mountAt('img')
    // Pretend the image renders at 2× its design size, at screen (10,20) — a layout
    // the plain FIT math would never produce (e.g. an extend/pinned target).
    q(mount, 'img').getBoundingClientRect = () => fakeRect(10, 20, 800, 200)
    relayout()
    const cd = q(mount, 'cd')
    // design offset from image top-left (340,250): (420,50), scaled by k=200/100=2
    expect(parseFloat(cd.style.left)).toBe(10 + 420 * 2)
    expect(parseFloat(cd.style.top)).toBe(20 + 50 * 2)
    const inner = cd.querySelector<HTMLElement>('.pa-text-inner')!
    expect(parseFloat(inner.style.fontSize)).toBe(60 * 2)
  })

  it('falls back to plain FIT layout when the target is missing', () => {
    const { mount: a, relayout: ra } = mountAt('nope')
    ra()
    const attachedLeft = parseFloat(q(a, 'cd').style.left)
    const attachedTop = parseFloat(q(a, 'cd').style.top)
    const { mount: b, relayout: rb } = mountAt(undefined)
    rb()
    expect(attachedLeft).toBe(parseFloat(q(b, 'cd').style.left))
    expect(attachedTop).toBe(parseFloat(q(b, 'cd').style.top))
  })

  it('uses the rendered per-orientation video fit for an attached dynamic date', () => {
    document.body.innerHTML = ''
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(844, 390)
    const mgr = playProject(makeVideoProject(), videoAssets, { mount, interactive: true })
    q(mount, 'vid').getBoundingClientRect = () => fakeRect(0, 0, 844, 390)
    mgr.relayout()

    const k = Math.min(844 / 1920, 390 / 1080)
    const mediaW = 1920 * k
    const mediaH = 1080 * k
    const expectedTop = (390 - mediaH) / 2 + (1600 / DESIGN_H) * mediaH
    const cd = q(mount, 'cd')
    expect(parseFloat(cd.style.left)).toBe(Math.round((844 - mediaW) / 2 + (540 / DESIGN_W) * mediaW))
    expect(parseFloat(cd.style.top)).toBe(Math.round(expectedTop))
    expect(parseFloat(cd.querySelector<HTMLElement>('.pa-text-inner')!.style.fontSize)).toBeCloseTo(60 * (mediaH / DESIGN_H), 1)
  })

  it('does not move upward in portrait when cover crops the video sides', () => {
    document.body.innerHTML = ''
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(390, 844)
    const mgr = playProject(makeVideoProject(), videoAssets, { mount, interactive: true })
    const vid = q(mount, 'vid')
    vid.getBoundingClientRect = () => fakeRect(0, 0, 390, 844)
    mgr.relayout()
    const topA = parseFloat(q(mount, 'cd').style.top)

    computeMetrics(340, 844)
    vid.getBoundingClientRect = () => fakeRect(0, 0, 340, 844)
    mgr.relayout()
    const topB = parseFloat(q(mount, 'cd').style.top)

    expect(topB).toBe(topA)
  })

  it('auto-attaches legacy dynamic dates to the endscene video frame', () => {
    document.body.innerHTML = ''
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(1642, 898)
    const mgr = playProject(makeLegacyDynamicDateProject(), videoAssets, { mount, interactive: true })
    const vid = q(mount, 'vid')
    vid.getBoundingClientRect = () => fakeRect(0, 0, 1642, 898)
    mgr.relayout()

    const refFit = 1080 / DESIGN_H
    const refMedia = { left: -336, top: -189, width: 2592, height: 1458 }
    const refNormalLeft = (1920 - DESIGN_W * refFit) / 2 + 1294 * refFit
    const refNormalTop = 374 * refFit
    const nx = (refNormalLeft - refMedia.left) / refMedia.width
    const ny = (refNormalTop - refMedia.top) / refMedia.height
    const k = Math.min(1642 / 1920, 898 / 1080) * 1.35
    const media = {
      left: (1642 - 1920 * k) / 2,
      top: (898 - 1080 * k) / 2,
      width: 1920 * k,
      height: 1080 * k,
    }
    const cd = q(mount, 'cd')
    expect(parseFloat(cd.style.left)).toBe(Math.round(media.left + nx * media.width))
    expect(parseFloat(cd.style.top)).toBe(Math.round(media.top + ny * media.height))
    expect(parseFloat(cd.querySelector<HTMLElement>('.pa-text-inner')!.style.fontSize)).toBeCloseTo(64 * 2.531 * refFit * (media.height / refMedia.height), 1)
  })

  it('keeps legacy dynamic dates from drifting right on narrower landscape screens', () => {
    document.body.innerHTML = ''
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(1122, 920)
    const mgr = playProject(makeLegacyDynamicDateProject(), videoAssets, { mount, interactive: true })
    const vid = q(mount, 'vid')
    vid.getBoundingClientRect = () => fakeRect(0, 0, 1122, 920)
    mgr.relayout()

    const cd = q(mount, 'cd')
    const plainFitLeft = (1122 - DESIGN_W * Math.min(1122 / DESIGN_W, 920 / DESIGN_H)) / 2 + 1294 * Math.min(1122 / DESIGN_W, 920 / DESIGN_H)
    expect(parseFloat(cd.style.left)).toBeLessThan(plainFitLeft - 80)
  })

  it('auto-attaches legacy clock overlays to the endscene video frame', () => {
    document.body.innerHTML = ''
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(1122, 920)
    const mgr = playProject(makeLegacyCountdownProject({ mode: 'clock', format: '{hh}:{mm}' }), videoAssets, { mount, interactive: true })
    const vid = q(mount, 'vid')
    vid.getBoundingClientRect = () => fakeRect(0, 0, 1122, 920)
    mgr.relayout()

    const cd = q(mount, 'cd')
    const plainFitLeft = (1122 - DESIGN_W * Math.min(1122 / DESIGN_W, 920 / DESIGN_H)) / 2 + 1294 * Math.min(1122 / DESIGN_W, 920 / DESIGN_H)
    expect(parseFloat(cd.style.left)).toBeLessThan(plainFitLeft - 80)
  })

  it('auto-attaches legacy timer overlays to the endscene video frame', () => {
    document.body.innerHTML = ''
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(1122, 920)
    const mgr = playProject(makeLegacyCountdownProject({ mode: 'timer', seconds: 30, format: '{ss}' }), videoAssets, { mount, interactive: true })
    const vid = q(mount, 'vid')
    vid.getBoundingClientRect = () => fakeRect(0, 0, 1122, 920)
    mgr.relayout()

    const cd = q(mount, 'cd')
    const plainFitFontSize = 64 * 2.531 * Math.min(1122 / DESIGN_W, 920 / DESIGN_H)
    expect(parseFloat(cd.querySelector<HTMLElement>('.pa-text-inner')!.style.fontSize)).toBeLessThan(plainFitFontSize - 20)
  })

  it('keeps SIP5-style landscape countdown overlays from drifting downward on taller letterboxed screens', () => {
    document.body.innerHTML = ''
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(1122, 920)
    const mgr = playProject(makeSip5LandscapeCountdownProject(), videoAssets, { mount, interactive: true })
    const vid = q(mount, 'vid')
    vid.getBoundingClientRect = () => fakeRect(0, 0, 1122, 920)
    mgr.relayout()

    const cd = q(mount, 'cd')
    expect(parseFloat(cd.style.top)).toBe(Math.round(1533 * Math.min(1122 / DESIGN_W, 920 / DESIGN_H)))
  })

  it('keeps SIP3-style upper landscape countdown overlays from nudging vertically', () => {
    document.body.innerHTML = ''
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    setDesign(DESIGN_W, DESIGN_H)
    computeMetrics(1022, 944)
    const mgr = playProject(makeSip3LandscapeCountdownProject(), videoAssets, { mount, interactive: true })
    const vid = q(mount, 'vid')
    vid.getBoundingClientRect = () => fakeRect(0, 0, 1022, 944)
    mgr.relayout()

    const cd = q(mount, 'cd')
    expect(parseFloat(cd.style.top)).toBe(Math.round(696 * Math.min(1022 / DESIGN_W, 944 / DESIGN_H)))
  })
})
