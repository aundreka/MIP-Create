// Element factory helpers used by the tool rail.

import type { SceneElement } from '../runtime/scene'
import { beginTransaction, endTransaction, getState, nextId, patchMeta } from './store'
import { DEFAULT_PROMO_CALENDAR } from './promoCalendar'

function topZ(): number {
  const zs = getState().scene.elements.map((e) => e.zIndex)
  return (zs.length ? Math.max(...zs) : 0) + 1
}
function meta() {
  return getState().scene.meta
}
function cx(): number {
  return Math.round(meta().baseW / 2)
}
function cy(): number {
  return Math.round(meta().baseH / 2)
}

export function makeText(): SceneElement {
  return {
    id: nextId('text'),
    type: 'text',
    name: 'Text',
    x: cx(),
    y: cy(),
    anchor: 'center',
    zIndex: topZ(),
    mode: 'fit',
    text: { value: 'New text', fontSizePx: 64, fontWeight: 700, color: '#ffffff', align: 'center' },
  }
}

export function makeCta(): SceneElement {
  return {
    id: nextId('cta'),
    type: 'cta',
    name: 'CTA button',
    x: cx(),
    y: Math.round(meta().baseH * 0.88),
    anchor: 'center',
    zIndex: topZ(),
    mode: 'fit',
    w: 560,
    h: 150,
    cta: { pulse: 'medium' },
    text: { value: 'PLAY NOW', fontSizePx: 64, fontWeight: 800, color: '#ffffff' },
    box: { bgColor: '#16a34a', radiusPx: 75 },
  }
}

export function makeButton(): SceneElement {
  return {
    id: nextId('btn'),
    type: 'button',
    name: 'Button',
    x: cx(),
    y: Math.round(meta().baseH * 0.88),
    anchor: 'center',
    zIndex: topZ(),
    mode: 'fit',
    w: 560,
    h: 150,
    button: {}, // targetSceneId chosen in the Inspector
    text: { value: 'CONTINUE', fontSizePx: 64, fontWeight: 800, color: '#ffffff' },
    box: { bgColor: '#3a7bd5', radiusPx: 75 },
  }
}

export function makeChoice(): SceneElement {
  const m = meta()
  return {
    id: nextId('choice'),
    type: 'choice',
    name: 'Answer option',
    x: cx(),
    y: cy(),
    anchor: 'center',
    zIndex: topZ(),
    mode: 'fit',
    w: Math.round(m.baseW * 0.86),
    h: 150,
    choice: { group: 'q1', feedback: false, selectColor: '#7c3aed' },
    text: { value: 'Answer option', fontSizePx: 46, fontWeight: 600, color: '#1b2a4a', align: 'left' },
    box: { bgColor: '#ffffff', radiusPx: 22, paddingXPx: 40, borderPx: 1, borderColor: '#e5e7eb' },
  }
}

export function makeBar(): SceneElement {
  return {
    id: nextId('bar'),
    type: 'bar',
    name: 'Header bar',
    x: cx(),
    y: 0,
    h: 170,
    anchor: 'top',
    zIndex: topZ(),
    mode: 'extend',
    bar: { color: '#1b2a4a' },
  }
}

export function makeRect(): SceneElement {
  return {
    id: nextId('rect'),
    type: 'bar', // a 'fit' bar is a colour rectangle
    name: 'Rectangle',
    x: cx(),
    y: cy(),
    w: 600,
    h: 360,
    anchor: 'center',
    zIndex: topZ(),
    mode: 'fit',
    bar: { color: '#3a7bd5' },
  }
}

export function makeImage(assetId: string, name: string, iw: number, ih: number): SceneElement {
  const scale = +((meta().baseW * 0.6) / Math.max(1, iw)).toFixed(3)
  return {
    id: nextId('img'),
    type: 'image',
    name: name || 'Image',
    assetId,
    x: cx(),
    y: cy(),
    anchor: 'center',
    zIndex: topZ(),
    mode: 'fit',
    scale,
  }
}

// ---- ready-made blocks (grouped) -----------------------------------------
export function makeHeaderBlock(): SceneElement[] {
  const gid = nextId('grp')
  const bar: SceneElement = { ...makeBar(), groupId: gid }
  const title: SceneElement = { ...makeText(), name: 'Header title', x: cx(), y: 86, anchor: 'center', groupId: gid, zIndex: topZ() + 1, text: { value: 'BRAND', fontSizePx: 64, fontWeight: 800, color: '#ffffff', align: 'center' } }
  return [bar, title]
}
export function makeEndcardBlock(): SceneElement[] {
  const gid = nextId('grp')
  const m = meta()
  const title: SceneElement = { ...makeText(), name: 'Endcard title', x: cx(), y: Math.round(m.baseH * 0.32), groupId: gid, zIndex: topZ() + 1, text: { value: 'Get the app!', fontSizePx: 110, fontWeight: 800, color: '#ffffff', align: 'center' } }
  const sub: SceneElement = { ...makeText(), name: 'Endcard subtitle', x: cx(), y: Math.round(m.baseH * 0.44), groupId: gid, zIndex: topZ() + 2, text: { value: 'Tap to play now', fontSizePx: 54, fontWeight: 600, color: '#cdd6ea', align: 'center' } }
  const cta: SceneElement = { ...makeCta(), y: Math.round(m.baseH * 0.62), groupId: gid, zIndex: topZ() + 3 }
  return [title, sub, cta]
}

export function makeGame(): SceneElement {
  const m = meta()
  return {
    id: nextId('game'),
    type: 'game-mount',
    name: 'Mini-game',
    x: cx(),
    y: Math.round(m.baseH * 0.52),
    w: Math.round(m.baseW * 0.9),
    h: Math.round(m.baseH * 0.5),
    anchor: 'center',
    zIndex: topZ(),
    mode: 'fit',
    game: { templateId: 'match', params: {}, hintEnabled: true, hintIdleMs: 4000 },
  }
}

// A live ticking countdown clock — urgency. Defaults to "always 24h from now"
// (dynamic) so it stays fresh whenever the ad runs.
export function makeCountdownTimer(): SceneElement {
  const m = meta()
  return {
    id: nextId('count'),
    type: 'countdown',
    name: 'Countdown timer',
    x: cx(),
    y: Math.round(m.baseH * 0.2),
    anchor: 'center',
    zIndex: topZ(),
    mode: 'fit',
    text: { value: '', fontSizePx: 96, fontWeight: 800, color: '#ffffff', align: 'center' },
    countdown: { mode: 'dynamic', dynamicDays: 1, format: '{hh}:{mm}:{ss}' },
  }
}

// A dynamic DATE label (no ticking) — auto-computed from today, e.g. "Order by
// Jun 24". Updates relative to whenever the ad is shown.
export function makeDynamicDate(): SceneElement {
  const m = meta()
  return {
    id: nextId('date'),
    type: 'countdown',
    name: 'Dynamic date',
    x: cx(),
    y: Math.round(m.baseH * 0.2),
    anchor: 'center',
    zIndex: topZ(),
    mode: 'fit',
    text: { value: '', fontSizePx: 64, fontWeight: 800, color: '#ffffff', align: 'center' },
    countdown: { mode: 'dynamic', dynamicDays: 3, format: 'Order by {date}', dateStyle: 'short' },
  }
}

/**
 * The dynamic-holiday label: the SAME countdown element, with the {holiday} token and
 * a visibility rule tied to the promo calendar. Defaults chosen from the peakfootwear
 * build: header-style scaling (one transform, nothing rounded — the path a label glued
 * inside artwork wants), and an auto-shrink at 86% of the design width so the longest
 * row in the calendar ("Thanksgiving, Black Friday & Cyber Monday Sale") still fits the
 * composition instead of running off it.
 *
 * Pair it with a second element carrying `showWhen: 'noHoliday'` to cover the days the
 * calendar says nothing about — see makeDynamicHolidayPair.
 */
export function makeDynamicHoliday(): SceneElement {
  const m = meta()
  return {
    id: nextId('holiday'),
    type: 'countdown',
    name: 'Dynamic holiday',
    x: cx(),
    y: Math.round(m.baseH * 0.2),
    anchor: 'center',
    zIndex: topZ(),
    mode: 'fit',
    headerScale: true,
    text: { value: '', fontSizePx: 64, fontWeight: 800, color: '#ffffff', align: 'center' },
    countdown: { mode: 'dynamic', dynamicDays: 3, format: '{holiday}', showWhen: 'holiday', fitWidthPx: Math.round(m.baseW * 0.86), textCase: 'none' },
  }
}

/** The holiday label plus its fallback, stacked in the same spot: exactly one of the
 * two is ever on screen, so the composition never has a hole in it. */
export function makeDynamicHolidayPair(): SceneElement[] {
  const promo = makeDynamicHoliday()
  const fallback: SceneElement = {
    ...makeDynamicHoliday(),
    id: nextId('holiday'),
    name: 'Holiday fallback',
    zIndex: promo.zIndex + 1,
    countdown: { ...promo.countdown!, format: 'Buy 1 Get 1 Free', showWhen: 'noHoliday' },
  }
  return [promo, fallback]
}

/** Give the project a promo calendar if it has none — the runtime carries no rows, so
 * a holiday element without this renders nothing. Only projects using the feature pay
 * the bytes. Existing rows (an imported client calendar) are never overwritten. */
export function ensurePromoCalendar(): void {
  if (meta().promoCalendar?.length) return
  patchMeta({ promoCalendar: DEFAULT_PROMO_CALENDAR.map((e) => ({ ...e })) })
}

/** Insert the holiday pair AND seed the calendar as one undo step. */
export function insertDynamicHoliday(add: (els: SceneElement[]) => void): void {
  beginTransaction()
  try {
    ensurePromoCalendar()
    add(makeDynamicHolidayPair())
  } finally {
    endTransaction()
  }
}

export function makeEndsceneVideo(): SceneElement {
  const m = meta()
  return {
    id: nextId('end'),
    type: 'endscene',
    name: 'Endscene video',
    x: cx(),
    y: cy(),
    w: m.baseW,
    h: m.baseH,
    anchor: 'center',
    zIndex: 1, // full-bleed, behind title/CTA
    mode: 'extend', // fill the whole screen (portrait + landscape)
    endscene: { objectFit: 'cover', bgColor: '#000000', loop: true, matchBgEdge: false, muteUntilInteraction: true },
  }
}

export function makeUnboxing(): SceneElement {
  const m = meta()
  return {
    id: nextId('unbox'),
    type: 'unboxing',
    name: 'Mystery Box',
    x: cx(),
    y: cy(),
    w: Math.round(m.baseW * 0.9),
    h: Math.round(m.baseH * 0.55),
    anchor: 'center',
    zIndex: topZ(),
    mode: 'fit',
    unboxing: {
      cols: 2, rows: 2, colGap: 24, rowGap: 24,
      back:  { x: 50, y: 55, w: 85 },
      front: { x: 50, y: 67, w: 85 },
      top:   { x: 50, y: 22, w: 85, endX: 60, endY: -35, endRotation: -35, endOpacity: 0, durationMs: 700 },
      productX: 50, productY: 28, productW: 60, productDurationMs: 900, productDelayMs: 160,
    },
  }
}

// Full-screen celebratory confetti overlay (canvas particle system, no dependency).
// Sits above scene content; by default rains continuously when the scene appears.
export function makeConfetti(): SceneElement {
  const m = meta()
  return {
    id: nextId('confetti'),
    type: 'confetti',
    name: 'Confetti',
    x: cx(),
    y: cy(),
    w: m.baseW,
    h: m.baseH,
    anchor: 'center',
    zIndex: topZ() + 40, // celebration floats above everything else
    mode: 'extend',
    confetti: { mode: 'rain', trigger: 'sceneEnter', pieces: 200, recycle: true, durationMs: 0 },
  }
}

export function makeBackground(assetId: string, name: string): SceneElement {
  return {
    id: nextId('bg'),
    type: 'background',
    name: name || 'Background',
    assetId,
    x: cx(),
    y: cy(),
    anchor: 'center',
    zIndex: 0,
    mode: 'extend',
    background: { objectFit: 'cover' },
  }
}
