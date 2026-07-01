// Figma import modal — paste a frame link + a personal access token; rebuilds
// the frame as editable elements. Token is stored locally on this machine.

import { useState } from 'react'
import { getToken, importFigma, importFigmaFunnel, setToken, type FunnelImportResult, type ImportProgress } from '../figma'
import { addImportedScene, loadProject } from '../store'
import { buildFunnel, DEFAULT_STYLE } from '../quizFunnel'
import { Check, Icon, Plus } from '../icons'
import { Checkbox, confirmDestructive, Modal } from '../ui'

export function FigmaImport(props: { onClose: () => void }): JSX.Element {
  const [token, setTok] = useState(getToken())
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flatten, setFlatten] = useState(false)
  const [skipImages, setSkipImages] = useState(false)
  const [funnel, setFunnel] = useState<FunnelImportResult | null>(null)
  const [prog, setProg] = useState<ImportProgress | null>(null)

  // remember the token immediately so it never has to be re-entered
  const onToken = (v: string): void => {
    setTok(v)
    setToken(v)
  }

  const run = async (mode: 'scene' | 'project'): Promise<void> => {
    if (mode === 'project' && !confirmDestructive('Import as a new project? This replaces your current project and cannot be undone.')) return
    setBusy(true)
    setStatus(null)
    setProg({ phase: 'Starting…' })
    try {
      setToken(token)
      const r = await importFigma(url, token.trim(), { flatten, skipImages, onProgress: setProg })
      if (mode === 'scene') {
        addImportedScene(r.name, r.bgColor, r.elements, r.assets)
      } else {
        loadProject(
          {
            meta: { schemaVersion: 1, name: r.name, clickUrl: { ios: 'https://apps.apple.com/app/id000000000', android: 'https://play.google.com/store/apps/details?id=com.example.app' }, baseW: r.baseW, baseH: r.baseH, bgMatchColor: r.bgColor },
            scenes: [{ id: 'scene1', name: r.name, kind: 'overlay', bgColor: r.bgColor, elements: r.elements, advance: { on: 'tap' } }],
            startSceneId: 'scene1',
          },
          r.assets,
          null,
        )
      }
      props.onClose()
    } catch (e) {
      setStatus('Error: ' + (e as Error).message)
    } finally {
      setBusy(false)
      setProg(null)
    }
  }

  // Step 1: detect the funnel from a parent frame's children (no project change
  // yet) so the user can review the auto-detected roles before committing.
  const detectFunnel = async (): Promise<void> => {
    setBusy(true)
    setStatus(null)
    setProg({ phase: 'Reading frames…' })
    setFunnel(null)
    try {
      setToken(token)
      const r = await importFigmaFunnel(url, token.trim(), { skipImages, onProgress: setProg })
      if (!r.questions.length) {
        setStatus('No child frames detected. Point at a parent frame whose children are your screens.')
        return
      }
      setFunnel(r)
      setStatus(null)
    } catch (e) {
      setStatus('Error: ' + (e as Error).message)
    } finally {
      setBusy(false)
      setProg(null)
    }
  }

  // Step 2: build the reviewed funnel into editable scenes (replaces the project).
  const generateFunnel = (): void => {
    const r = funnel
    if (!r) return
    if (!confirmDestructive('Generate this funnel as a new project? This replaces your current project and cannot be undone.')) return
    const style = { ...DEFAULT_STYLE, brand: r.name, accent: r.accent ?? DEFAULT_STYLE.accent, bg: r.bgColor ?? DEFAULT_STYLE.bg, addIntro: false }
    const dims = { baseW: r.baseW, baseH: r.baseH }
    const images: Record<number, string> = {}
    r.questions.forEach((q, i) => {
      if (q.imageAssetId) images[i] = q.imageAssetId
    })
    const scenes = buildFunnel(r.questions, style, dims, images)
    loadProject(
      {
        meta: {
          schemaVersion: 1,
          name: r.name,
          clickUrl: { ios: 'https://apps.apple.com/app/id000000000', android: 'https://play.google.com/store/apps/details?id=com.example.app' },
          baseW: r.baseW,
          baseH: r.baseH,
          bgMatchColor: r.bgColor,
        },
        scenes,
        startSceneId: scenes[0].id,
      },
      r.assets,
      null,
    )
    props.onClose()
  }

  return (
    <Modal title="Import from Figma" onClose={props.onClose} size="md">
      <label className="field">
        <span>Figma frame URL (must contain node-id; select a frame, then “Copy link”)</span>
        <input value={url} placeholder="https://www.figma.com/design/KEY/...?node-id=1-2" onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="field">
        <span>
          Personal access token:{' '}
          <a href="https://www.figma.com/developers/api#access-tokens" target="_blank" rel="noreferrer">
            Figma → Settings → Security → personal access tokens
          </a>
        </span>
        <input type="password" value={token} placeholder="figd_..." onChange={(e) => onToken(e.target.value)} />
        {token && (
          <span className="saved-note">
            <Icon icon={Check} size={12} strokeWidth={3} /> saved on this computer; you won't need to re-enter it
          </span>
        )}
      </label>
      <label className="field">
        <Checkbox checked={flatten} onChange={setFlatten} label="Flatten everything to images (no editable text)" />
      </label>
      <label className="field">
        <Checkbox checked={skipImages} onChange={setSkipImages} label="Skip image rendering: text / layout only (avoids Figma rate limits)" />
      </label>
      <div className="grid2">
        <button className="primary" disabled={busy || !token.trim() || !url.trim()} onClick={() => void run('scene')}>
          {busy ? '…' : <><Icon icon={Plus} size={14} /> Add as new scene</>}
        </button>
        <button className="danger" disabled={busy || !token.trim() || !url.trim()} onClick={() => void run('project')} title="Replaces your current project">
          Replace project
        </button>
      </div>
      {prog && (
        <div className="fig-prog">
          <div className="fig-prog-row">
            <span>{prog.phase}</span>
            {prog.total ? <strong>{prog.done ?? 0}/{prog.total}</strong> : null}
          </div>
          <div className="bar-track">
            <div className={'bar-fill' + (prog.total ? '' : ' indet')} style={prog.total ? { width: `${Math.round(((prog.done ?? 0) / prog.total) * 100)}%` } : undefined} />
          </div>
        </div>
      )}
      {status && <div className="figma-status">{status}</div>}
      <div className="hint pad">
        “Add as new scene” appends this frame to your project and merges its images into the library; import several
        frames to build the flow. Text layers become editable text unless you flatten everything to images above; all
        other layers import as faithful images. Token is stored only on this computer.
      </div>

      <div className="group-title">Quiz / survey funnel</div>
      {!funnel ? (
        <>
          <button className="wide" disabled={busy || !token.trim() || !url.trim()} onClick={() => void detectFunnel()}>
            {busy ? '…' : 'Detect funnel from parent frame'}
          </button>
          <div className="hint pad">
            Point the URL at a <b>parent frame whose children are your question screens</b>. This detects each frame’s question,
            options, image and Continue button so you can <b>review before generating</b>. For best results name layers{' '}
            <b>question</b>, <b>option</b> (add <b>correct</b> to the right one), <b>image</b>, <b>continue</b>; otherwise it falls
            back to position (largest top text = question, answers stacked above the button).
          </div>
        </>
      ) : (
        <>
          <div className="hint pad">
            Detected <b>{funnel.questions.length}</b> screen{funnel.questions.length === 1 ? '' : 's'} in “{funnel.name}” ({funnel.baseW}×{funnel.baseH}). Review the auto-detected
            roles, then generate. Anything off can be fixed after generating (each scene stays editable).
          </div>
          <div className="fig-review">
            {funnel.questions.map((q, i) => (
              <div className="fig-q" key={i}>
                <div className="fig-q-head">
                  <span className="idx">{i + 1}.</span>
                  <span>{q.question || <em>(no question text detected)</em>}</span>
                  {q.imageAssetId && <span className="hint">· image ✓</span>}
                </div>
                {q.options.length ? (
                  <div className="fig-q-opts">
                    {q.options.map((o, j) => (
                      <span key={j} className={o.correct ? 'correct' : ''}>
                        {j > 0 ? ' · ' : ''}
                        {o.label}
                        {o.correct ? ' ✓' : ''}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="fig-q-opts">No options; will be an info/intro slide.</div>
                )}
              </div>
            ))}
          </div>
          <div className="grid2">
            <button onClick={() => { setFunnel(null); setStatus(null) }}>Back</button>
            <button className="danger" onClick={generateFunnel} title="Replaces your current project">
              Generate {funnel.questions.length + 1} scenes
            </button>
          </div>
          <div className="hint pad">Generating replaces the current project so the canvas matches your Figma frame size. A final end-card with a CTA is appended.</div>
        </>
      )}
    </Modal>
  )
}
