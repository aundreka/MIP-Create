// Figma import modal — paste a frame link + a personal access token; rebuilds
// the frame as editable elements. Token is stored locally on this machine.

import { useState } from 'react'
import { getToken, importFigma, importFigmaFunnel, setToken } from '../figma'
import { addImportedScene, loadProject } from '../store'
import { buildFunnel, DEFAULT_STYLE } from '../quizFunnel'
import { Check, Icon, Plus } from '../icons'
import { Checkbox, Modal } from '../ui'

export function FigmaImport(props: { onClose: () => void }): JSX.Element {
  const [token, setTok] = useState(getToken())
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flatten, setFlatten] = useState(false)

  // remember the token immediately so it never has to be re-entered
  const onToken = (v: string): void => {
    setTok(v)
    setToken(v)
  }

  const run = async (mode: 'scene' | 'project'): Promise<void> => {
    setBusy(true)
    setStatus('Importing…')
    try {
      setToken(token)
      const r = await importFigma(url, token.trim(), { flatten })
      if (mode === 'scene') {
        addImportedScene(r.name, r.bgColor, r.elements, r.assets)
      } else {
        loadProject(
          {
            meta: { schemaVersion: 1, name: r.name, clickUrl: { ios: 'https://apps.apple.com/app/id000000000', android: 'https://play.google.com/store/apps/details?id=com.example.app' }, baseW: r.baseW, baseH: r.baseH, bgMatchColor: r.bgColor },
            scenes: [{ id: 'scene1', name: r.name, kind: 'custom', bgColor: r.bgColor, elements: r.elements, advance: { on: 'tap' } }],
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
    }
  }

  // Parent frame -> quiz/survey funnel: one editable scene per child frame.
  const runFunnel = async (): Promise<void> => {
    setBusy(true)
    setStatus('Reading frames…')
    try {
      setToken(token)
      const r = await importFigmaFunnel(url, token.trim())
      if (!r.questions.length) {
        setStatus('No child frames detected. Point at a parent frame whose children are your screens.')
        return
      }
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
    } catch (e) {
      setStatus('Error: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
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
      <div className="grid2">
        <button className="primary" disabled={busy || !token.trim() || !url.trim()} onClick={() => void run('scene')}>
          {busy ? '…' : <><Icon icon={Plus} size={14} /> Add as new scene</>}
        </button>
        <button className="danger" disabled={busy || !token.trim() || !url.trim()} onClick={() => void run('project')} title="Replaces your current project">
          Replace project
        </button>
      </div>
      {status && <div className="figma-status">{status}</div>}
      <div className="hint pad">
        “Add as new scene” appends this frame to your project and merges its images into the library; import several
        frames to build the flow. Text layers become editable text unless you flatten everything to images above; all
        other layers import as faithful images. Token is stored only on this computer.
      </div>

      <div className="group-title">Quiz / survey funnel</div>
      <button className="wide" disabled={busy || !token.trim() || !url.trim()} onClick={() => void runFunnel()} title="Replaces your current project">
        {busy ? '…' : 'Import parent frame as funnel'}
      </button>
      <div className="hint pad">
        Point the URL at a <b>parent frame whose children are your question screens</b> — this builds one editable scene per
        child frame (intro/questions/end), auto-detecting each frame’s question, options, image and Continue button. For best
        results name layers <b>question</b>, <b>option</b> (add <b>correct</b> to the right one), <b>image</b>, <b>continue</b>;
        otherwise it falls back to position (largest top text = question, the answers stacked above the button). Replaces the
        current project so the canvas matches your Figma frame size.
      </div>
    </Modal>
  )
}
