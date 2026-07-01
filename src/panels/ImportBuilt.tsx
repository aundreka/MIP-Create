// Import built playable — recover an editable project from a previously-BUILT
// .html or .zip. Own-editor builds embed the full project (window.PA_PROJECT) and
// come back fully editable; a third-party / React playable with no such payload is
// wrapped as ONE opaque embedded block you can frame with CTAs / overlays. This is
// the only place that writes to the store; all parsing lives in ../importBuilt.

import { useState } from 'react'
import { createProject } from '../projects'
import { addImportedScene, getState, nextId } from '../store'
import { htmlToDataUrl, pickBuiltFile } from '../bridge'
import { importBuiltFile, type ImportResult } from '../importBuilt'
import type { Project, SceneElement } from '../../runtime/scene'
import type { AssetEntry, AssetMap } from '../../runtime/types'
import { AlertTriangle, Icon, Plus, Upload } from '../icons'
import { confirmDestructive, Modal } from '../ui'

const DEFAULT_CLICK = {
  ios: 'https://apps.apple.com/app/id000000000',
  android: 'https://play.google.com/store/apps/details?id=com.example.app',
}

const KIND_LABEL: Record<ImportResult['kind'], string> = {
  'own-html': 'Editor build (single-file HTML)',
  'own-html-zip': 'Editor build (zipped HTML)',
  'own-vite-zip': 'Editor source zip',
  'foreign-html': 'Third-party playable',
  unknown: 'Unrecognized file',
}

/** A full-screen embed element that iframes the given HTML asset (Tier 2). */
function foreignEmbedElement(assetId: string, baseW: number, baseH: number): SceneElement {
  return {
    id: nextId('game'),
    type: 'game-mount',
    name: 'Imported ad',
    x: Math.round(baseW / 2),
    y: Math.round(baseH / 2),
    w: baseW,
    h: baseH,
    anchor: 'center',
    zIndex: 1,
    mode: 'fit',
    game: { templateId: 'embed', params: { html: assetId, complete: 'auto', timerMs: 8000 }, hintEnabled: false },
  }
}

export function ImportBuilt(props: { onClose: () => void }): JSX.Element {
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const choose = async (): Promise<void> => {
    setStatus(null)
    const file = await pickBuiltFile()
    if (!file) return
    setBusy(true)
    setResult(null)
    try {
      setResult(await importBuiltFile(file))
    } catch (e) {
      setStatus('Error: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Tier 1 — load a recovered own-editor project as a new library entry.
  const importOwn = async (): Promise<void> => {
    if (!result?.data) return
    if (result.schemaTooNew && !confirmDestructive('This build was made with a newer editor and may not import cleanly. Import anyway?')) return
    const data = result.data
    const base = data.project.meta.name || result.sourceName?.replace(/\.[^.]+$/, '') || 'Imported playable'
    data.project.meta = { ...data.project.meta, name: base.replace(/\s*\(imported\)$/i, '') + ' (imported)' }
    await createProject(data)
    props.onClose()
  }

  // Tier 2 — wrap a foreign playable as an opaque embed.
  const embedForeign = async (mode: 'scene' | 'project'): Promise<void> => {
    if (!result?.foreignHtml) return
    const assetId = nextId('embed')
    const entry: AssetEntry = { src: htmlToDataUrl(result.foreignHtml), w: 0, h: 0, kind: 'html' }
    const name = (result.sourceName?.replace(/\.[^.]+$/, '') || 'Imported ad').slice(0, 60)

    if (mode === 'scene') {
      const m = getState().scene.meta
      const el = foreignEmbedElement(assetId, m.baseW, m.baseH)
      addImportedScene(name, undefined, [el], { [assetId]: entry })
      props.onClose()
      return
    }
    if (!confirmDestructive('Create a new project from this embedded ad?')) return
    const baseW = 1080
    const baseH = 1920
    const el = foreignEmbedElement(assetId, baseW, baseH)
    const project: Project = {
      meta: { schemaVersion: 2, name, clickUrl: { ...DEFAULT_CLICK }, baseW, baseH },
      scenes: [{ id: 'scene1', name: 'Imported ad', kind: 'game', elements: [el], advance: { on: 'manual' } }],
      startSceneId: 'scene1',
    }
    const assets: AssetMap = { [assetId]: entry }
    await createProject({ project, assets })
    props.onClose()
  }

  const isOwn = result && (result.kind === 'own-html' || result.kind === 'own-html-zip' || result.kind === 'own-vite-zip')

  return (
    <Modal title="Import built playable" onClose={props.onClose} size="md">
      <button className="wide" disabled={busy} onClick={() => void choose()}>
        {busy ? 'Reading…' : <><Icon icon={Upload} size={14} /> Choose a built .html or .zip…</>}
      </button>

      {!result && (
        <div className="hint pad">
          Recover an editable project from a playable you already built. Files exported by this editor come back{' '}
          <b>fully editable</b> (every export embeds its own project data). A third-party or React ad with no editor
          data is embedded as a single block you can frame with CTAs, overlays and end-cards.
        </div>
      )}

      {result && (
        <>
          <div className="group-title">Detected: {KIND_LABEL[result.kind]}</div>

          {result.error && (
            <div className="hint pad" style={{ color: 'var(--danger, #e5484d)' }}>
              <Icon icon={AlertTriangle} size={13} /> {result.error}
            </div>
          )}

          {result.warnings.map((w, i) => (
            <div className="hint pad" key={i}>
              <Icon icon={AlertTriangle} size={13} /> {w}
            </div>
          ))}

          {isOwn && result.data && (
            <>
              <div className="hint pad">
                Recovered <b>{result.data.project.scenes.length}</b> scene
                {result.data.project.scenes.length === 1 ? '' : 's'} and{' '}
                <b>{Object.keys(result.data.assets).length}</b> asset
                {Object.keys(result.data.assets).length === 1 ? '' : 's'}. It will be added as a new project in your library.
              </div>
              <button className="primary wide" disabled={busy} onClick={() => void importOwn()}>
                <Icon icon={Plus} size={14} /> {result.schemaTooNew ? 'Import anyway (may break)' : 'Import as new project'}
              </button>
            </>
          )}

          {result.kind === 'foreign-html' && (
            <>
              <div className="hint pad">
                No editor project data was found; this looks like a third-party build. It can be embedded as a single
                block (an iframe you can wrap with CTAs / overlays), but its internals can’t be edited here.
              </div>
              <div className="grid2">
                <button className="primary" disabled={busy} onClick={() => void embedForeign('scene')} title="Append as a new scene in the current project">
                  <Icon icon={Plus} size={14} /> Add as new scene
                </button>
                <button disabled={busy} onClick={() => void embedForeign('project')} title="Create a fresh project containing this ad">
                  As new project
                </button>
              </div>
            </>
          )}
        </>
      )}

      {status && <div className="figma-status">{status}</div>}
    </Modal>
  )
}
