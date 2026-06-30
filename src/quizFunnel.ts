// Quiz / survey funnel generator. Turns a pasted block of text (questions +
// options, copyable straight from Figma) into a full, editable scene flow:
//   intro? -> one scene per question -> single end card (CTA).
// Each question scene is built from native elements (header, optional image,
// question text, selectable `choice` cards, a Continue button), so everything
// stays editable after generation. An option marked correct (a leading/trailing
// `*`) flips that question into quiz mode (green correct / red wrong feedback);
// otherwise it's a survey (tap to select, Continue to advance).

import type { SceneDef, SceneElement } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import { nextId } from './store'

export interface ParsedOption {
  label: string
  correct: boolean
}
export interface ParsedQuestion {
  question: string
  options: ParsedOption[]
  image?: string // a URL/data-URL from an `image:` line (resolved to an asset by the caller)
}

export interface FunnelStyle {
  brand: string
  accent: string // buttons / selected fill
  bg: string // scene background
  cardBg: string // answer card fill
  ink: string // question / answer text colour
  ctaText: string
  forceMode: 'auto' | 'survey' | 'quiz'
  addIntro: boolean
  introTagline: string
}

export const DEFAULT_STYLE: FunnelStyle = {
  brand: 'Brand',
  accent: '#7c3aed',
  bg: '#f3effa',
  cardBg: '#ffffff',
  ink: '#1b2a4a',
  ctaText: 'DOWNLOAD NOW',
  forceMode: 'auto',
  addIntro: true,
  introTagline: 'Answer a few quick questions',
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// strip a leading bullet / letter prefix ("- ", "* ", "A. ", "B) ", "• ")
const stripPrefix = (s: string): string => s.replace(/^\s*(?:[-*•]\s+|[A-Ha-h][.)]\s+)/, '').trim()

/** Parse pasted text into questions. Blank lines separate questions; the first
 * line of a block is the question, the rest are options. A `*` (leading or
 * trailing) marks the correct option. An `image:` line sets the question image. */
export function parseQuizText(text: string): ParsedQuestion[] {
  const blocks = text
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((b) => b.length)

  const out: ParsedQuestion[] = []
  for (const lines of blocks) {
    let image: string | undefined
    const body = lines.filter((l) => {
      const m = /^image\s*[:=]\s*(.+)$/i.exec(l)
      if (m) {
        image = m[1].trim()
        return false
      }
      return true
    })
    if (!body.length) continue
    const question = stripPrefix(body[0]).replace(/\*+\s*$/, '').trim()
    const options: ParsedOption[] = []
    for (const raw of body.slice(1)) {
      if (/^(continue|next|submit)$/i.test(raw.replace(/[^a-z]/gi, ''))) continue // skip a pasted button label
      const lead = /^\s*\*/.test(raw)
      const trail = /\*\s*$/.test(raw)
      const label = stripPrefix(raw.replace(/^\s*\*\s*/, '').replace(/\s*\*\s*$/, '')).trim()
      if (!label) continue
      options.push({ label, correct: lead || trail })
    }
    if (question && options.length) out.push({ question, options, image })
  }
  return out
}

// ---- scene building --------------------------------------------------------

interface Dims {
  baseW: number
  baseH: number
}

function questionScene(q: ParsedQuestion, index: number, total: number, st: FunnelStyle, dims: Dims, imageAssetId?: string): SceneDef {
  const { baseW, baseH } = dims
  const cx = Math.round(baseW / 2)
  const z = (n: number): number => n
  const els: SceneElement[] = []
  const group = `q${index + 1}`
  const quizMode = st.forceMode === 'quiz' || (st.forceMode === 'auto' && q.options.some((o) => o.correct))

  // brand header
  els.push({
    id: nextId('text'),
    type: 'text',
    name: 'Brand',
    x: cx,
    y: Math.round(baseH * 0.05),
    anchor: 'center',
    zIndex: z(10),
    mode: 'fit',
    text: { value: st.brand, fontSizePx: 52, fontWeight: 800, color: st.accent, align: 'center' },
  })

  // progress label
  els.push({
    id: nextId('text'),
    type: 'text',
    name: 'Progress',
    x: cx,
    y: Math.round(baseH * 0.1),
    anchor: 'center',
    zIndex: z(10),
    mode: 'fit',
    text: { value: `${index + 1} / ${total}`, fontSizePx: 34, fontWeight: 600, color: st.ink, align: 'center' },
  })

  let y = Math.round(baseH * 0.16)
  if (imageAssetId) {
    els.push({
      id: nextId('img'),
      type: 'image',
      name: 'Question image',
      assetId: imageAssetId,
      x: cx,
      y,
      w: Math.round(baseW * 0.8),
      h: Math.round(baseH * 0.22),
      anchor: 'top',
      zIndex: z(11),
      mode: 'fit',
    })
    y += Math.round(baseH * 0.25)
  }

  // question
  els.push({
    id: nextId('text'),
    type: 'text',
    name: 'Question',
    x: cx,
    y,
    w: Math.round(baseW * 0.86),
    anchor: 'top',
    zIndex: z(11),
    mode: 'fit',
    text: { value: q.question, fontSizePx: 60, fontWeight: 800, color: st.ink, align: 'center', maxWidthPx: Math.round(baseW * 0.86) },
  })

  // options
  const optH = 150
  const gap = 28
  const optW = Math.round(baseW * 0.86)
  let oy = Math.round(baseH * 0.4)
  q.options.slice(0, 8).forEach((o, i) => {
    els.push({
      id: nextId('choice'),
      type: 'choice',
      name: `Option ${LETTERS[i]}`,
      x: cx,
      y: oy,
      w: optW,
      h: optH,
      anchor: 'top',
      zIndex: z(12),
      mode: 'fit',
      choice: { group, feedback: quizMode, correct: o.correct, selectColor: st.accent, correctColor: '#22c55e', wrongColor: '#ef4444' },
      text: { value: `${LETTERS[i]}. ${o.label}`, fontSizePx: 42, fontWeight: 600, color: st.ink, align: 'left' },
      box: { bgColor: st.cardBg, radiusPx: 22, paddingXPx: 40, borderPx: 1, borderColor: '#e5e7eb' },
    })
    oy += optH + gap
  })

  // Continue (advance) button
  els.push({
    id: nextId('choice'),
    type: 'choice',
    name: 'Continue',
    x: cx,
    y: Math.round(baseH * 0.93),
    w: optW,
    h: 150,
    anchor: 'center',
    zIndex: z(20),
    mode: 'fit',
    choice: { advance: true, advanceDelayMs: quizMode ? 350 : 0 },
    text: { value: 'Continue', fontSizePx: 54, fontWeight: 800, color: '#ffffff', align: 'center' },
    box: { bgColor: st.accent, radiusPx: 75 },
  })

  return {
    id: nextId('scene'),
    name: `Q${index + 1}`,
    kind: 'overlay',
    bgColor: st.bg,
    elements: els,
    advance: { on: 'manual' },
    transition: { type: 'slide-left', durationMs: 320 },
  }
}

function introScene(st: FunnelStyle, dims: Dims): SceneDef {
  const { baseW, baseH } = dims
  const cx = Math.round(baseW / 2)
  return {
    id: nextId('scene'),
    name: 'Intro',
    kind: 'overlay',
    bgColor: st.bg,
    elements: [
      { id: nextId('text'), type: 'text', name: 'Brand', x: cx, y: Math.round(baseH * 0.34), anchor: 'center', zIndex: 10, mode: 'fit', text: { value: st.brand, fontSizePx: 96, fontWeight: 800, color: st.accent, align: 'center' } },
      { id: nextId('text'), type: 'text', name: 'Tagline', x: cx, y: Math.round(baseH * 0.46), w: Math.round(baseW * 0.8), anchor: 'center', zIndex: 10, mode: 'fit', text: { value: st.introTagline, fontSizePx: 54, fontWeight: 600, color: st.ink, align: 'center', maxWidthPx: Math.round(baseW * 0.8) } },
      { id: nextId('choice'), type: 'choice', name: 'Start', x: cx, y: Math.round(baseH * 0.7), w: Math.round(baseW * 0.86), h: 160, anchor: 'center', zIndex: 20, mode: 'fit', choice: { advance: true }, text: { value: 'Start', fontSizePx: 56, fontWeight: 800, color: '#ffffff', align: 'center' }, box: { bgColor: st.accent, radiusPx: 80 } },
    ],
    advance: { on: 'manual' },
    transition: { type: 'fade', durationMs: 300 },
  }
}

function endCard(st: FunnelStyle, dims: Dims): SceneDef {
  const { baseW, baseH } = dims
  const cx = Math.round(baseW / 2)
  return {
    id: nextId('scene'),
    name: 'End card',
    kind: 'endscene',
    bgColor: st.bg,
    elements: [
      { id: nextId('text'), type: 'text', name: 'Headline', x: cx, y: Math.round(baseH * 0.34), w: Math.round(baseW * 0.86), anchor: 'center', zIndex: 10, mode: 'fit', text: { value: `Get ${st.brand}`, fontSizePx: 92, fontWeight: 800, color: st.ink, align: 'center', maxWidthPx: Math.round(baseW * 0.86) } },
      { id: nextId('text'), type: 'text', name: 'Subtitle', x: cx, y: Math.round(baseH * 0.46), w: Math.round(baseW * 0.8), anchor: 'center', zIndex: 10, mode: 'fit', text: { value: 'Tap below to continue', fontSizePx: 48, fontWeight: 600, color: st.ink, align: 'center', maxWidthPx: Math.round(baseW * 0.8) } },
      { id: nextId('cta'), type: 'cta', name: 'CTA', x: cx, y: Math.round(baseH * 0.66), w: Math.round(baseW * 0.86), h: 170, anchor: 'center', zIndex: 20, mode: 'fit', cta: { pulse: 'medium' }, text: { value: st.ctaText, fontSizePx: 56, fontWeight: 800, color: '#ffffff' }, box: { bgColor: st.accent, radiusPx: 85 } },
    ],
    advance: { on: 'manual' },
    transition: { type: 'fade', durationMs: 300 },
  }
}

/** Build the full funnel as scene defs. `images` maps a question index to a
 * pre-imported asset id (optional). */
export function buildFunnel(questions: ParsedQuestion[], st: FunnelStyle, dims: Dims, images: Record<number, string> = {}): SceneDef[] {
  const scenes: SceneDef[] = []
  if (st.addIntro) scenes.push(introScene(st, dims))
  questions.forEach((q, i) => scenes.push(questionScene(q, i, questions.length, st, dims, images[i])))
  scenes.push(endCard(st, dims))
  return scenes
}

// Re-export the assets type so callers can pass image assets through unchanged.
export type { AssetMap }
