// Quiz / survey funnel generator UI. Paste questions (straight from Figma text),
// set the brand look, and generate the whole scene flow in one click. Each
// generated scene is a normal editable scene.

import { useMemo, useState } from 'react'
import { addScenes, getState } from '../store'
import { remoteToDataUrl } from '../net'
import { buildFunnel, DEFAULT_STYLE, parseQuizText, type FunnelStyle } from '../quizFunnel'
import type { AssetMap } from '../../runtime/types'
import { ColorField, Modal, Select, Toggle } from '../ui'

const EXAMPLE = `What's your main goal?
- Lose weight
- Build strength
- Improve flexibility

What does "Gulag" stand for?
- Government Union for Labor
* Main Administration of Camps
- General Union of Laborers

How many minutes can you commit daily?
- 5 minutes
- 10 minutes
- 20+ minutes`

function imgDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 })
    img.onerror = () => resolve({ w: 800, h: 600 })
    img.src = src
  })
}

export function QuizFunnel(props: { onClose: () => void }): JSX.Element {
  const [text, setText] = useState('')
  const [st, setSt] = useState<FunnelStyle>(DEFAULT_STYLE)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<FunnelStyle>): void => setSt((s) => ({ ...s, ...patch }))

  const questions = useMemo(() => parseQuizText(text || EXAMPLE), [text])
  const usingExample = !text.trim()
  const quizCount = questions.filter((q) => q.options.some((o) => o.correct)).length

  const generate = async (): Promise<void> => {
    const qs = parseQuizText(text)
    if (!qs.length) return
    setBusy(true)
    try {
      const meta = getState().project.meta
      const dims = { baseW: meta.baseW, baseH: meta.baseH }
      // resolve any pasted image URLs to assets
      const images: Record<number, string> = {}
      const assets: AssetMap = {}
      for (let i = 0; i < qs.length; i++) {
        const url = qs[i].image
        if (!url) continue
        const data = await remoteToDataUrl(url)
        if (!data) continue
        const d = await imgDims(data)
        const id = `qimg_${i}_${Math.round(d.w)}`
        assets[id] = { src: data, w: d.w, h: d.h }
        images[i] = id
      }
      const scenes = buildFunnel(qs, st, dims, images)
      addScenes(scenes, assets)
      props.onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Quiz / survey funnel" onClose={props.onClose} size="lg">
      <div className="quiz-gen">
        <div className="quiz-gen-left">
          <div className="group-title">Paste questions</div>
          <textarea
            className="quiz-paste"
            value={text}
            placeholder={EXAMPLE}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="hint pad">
            One question per block, blank line between blocks. First line is the question; the rest are options. Mark a correct
            answer with <b>*</b> (that question becomes a quiz with green/red feedback). Add an <b>image: URL</b> line for a
            question image. Tip: select the text layers in Figma, copy, and paste here.
          </div>
        </div>

        <div className="quiz-gen-right">
          <div className="group-title">Brand &amp; style</div>
          <label className="field">
            <span>Brand name</span>
            <input className="text-input" value={st.brand} onChange={(e) => set({ brand: e.target.value })} />
          </label>
          <ColorField label="Accent (buttons)" value={st.accent} onChange={(c) => set({ accent: c ?? '#7c3aed' })} />
          <ColorField label="Background" value={st.bg} onChange={(c) => set({ bg: c ?? '#f3effa' })} />
          <ColorField label="Answer card" value={st.cardBg} onChange={(c) => set({ cardBg: c ?? '#ffffff' })} />
          <ColorField label="Text colour" value={st.ink} onChange={(c) => set({ ink: c ?? '#1b2a4a' })} />
          <label className="field">
            <span>End-card CTA text</span>
            <input className="text-input" value={st.ctaText} onChange={(e) => set({ ctaText: e.target.value })} />
          </label>
          <div className="field">
            <span>Answer behaviour</span>
            <Select
              value={st.forceMode}
              onChange={(v) => set({ forceMode: v as FunnelStyle['forceMode'] })}
              options={[
                { value: 'auto', label: 'Auto (quiz if * present)' },
                { value: 'survey', label: 'Survey (no right answer)' },
                { value: 'quiz', label: 'Quiz (correct/wrong)' },
              ]}
            />
          </div>
          <Toggle label="Add intro scene" checked={st.addIntro} onChange={(v) => set({ addIntro: v })} />
        </div>
      </div>

      <div className="quiz-gen-foot">
        <span className="hint">
          {questions.length ? (
            <>
              {usingExample ? 'Example: ' : ''}
              {questions.length} {questions.length === 1 ? 'question' : 'questions'}
              {quizCount ? ` · ${quizCount} with a correct answer` : ' · survey'}
              {st.addIntro ? ' · + intro' : ''} · + end card
            </>
          ) : (
            'Paste questions to begin.'
          )}
        </span>
        <button className="primary" disabled={busy || !text.trim() || !questions.length} onClick={() => void generate()}>
          {busy ? 'Generating…' : `Generate ${questions.length + (st.addIntro ? 1 : 0) + 1} scenes`}
        </button>
      </div>
    </Modal>
  )
}
