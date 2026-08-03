import { useEffect, useMemo, useState } from 'react'
import type { ProjectData } from '../bridge'
import { currentProjectId, listProjects, loadProjectPreview } from '../projects'
import { removeSceneLocaleSource, setLocaleHeader, setSceneLocaleSource, useEditorState } from '../store'
import { buildHeaderTranslation, buildSceneTranslation, inferLanguageCode, LANGUAGE_SUGGESTIONS } from '../translationMerge'
import { Icon, Languages, Trash2, X } from '../icons'
import { setEditLocale } from '../locale'

export function SceneTranslationModal(props: { sceneId: string; onClose: () => void }): JSX.Element {
  const { project, assets } = useEditorState()
  const master = project.scenes.find((scene) => scene.id === props.sceneId) ?? project.scenes[0]
  const projects = useMemo(() => listProjects().filter((item) => item.id !== currentProjectId()), [])
  const existing = Object.keys(master?.localeOverrides ?? {})
  const firstUnused = (project.meta.locales ?? []).find((locale) => !existing.includes(locale)) ?? ''
  const [locale, setLocale] = useState(firstUnused)
  const [sourceProjectId, setSourceProjectId] = useState(projects[0]?.id ?? '')
  const [sourceData, setSourceData] = useState<ProjectData | null>(null)
  const [sourceSceneId, setSourceSceneId] = useState('')
  const [loading, setLoading] = useState(!!projects.length)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sourceProjectId) { setSourceData(null); setLoading(false); return }
    let alive = true
    setLoading(true)
    setError('')
    void loadProjectPreview(sourceProjectId).then((data) => {
      if (!alive) return
      setSourceData(data)
      setLoading(false)
      if (!data) { setError('That playable could not be loaded.'); return }
      const masterIndex = project.scenes.findIndex((scene) => scene.id === master?.id)
      const best = data.project.scenes.find((scene) => scene.id === master?.id)
        ?? data.project.scenes.find((scene) => scene.name.trim().toLowerCase() === master?.name.trim().toLowerCase())
        ?? data.project.scenes[masterIndex]
        ?? data.project.scenes[0]
      setSourceSceneId(best?.id ?? '')
      if (!locale) setLocale(inferLanguageCode(data.project.meta.name, data.project.meta.defaultLocale || ''))
    })
    return () => { alive = false }
  }, [sourceProjectId, master?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const sourceScene = sourceData?.project.scenes.find((scene) => scene.id === sourceSceneId)
  const ready = !!master && !!sourceScene && !!locale.trim() && !loading && !saving

  const save = (): void => {
    if (!ready || !master || !sourceScene || !sourceData) return
    setSaving(true)
    try {
      const built = buildSceneTranslation(master, sourceScene, sourceData.assets, assets, locale, sourceData.project.meta.header)
      const code = locale.trim().replace(/_/g, '-')
      setSceneLocaleSource(master.id, code, built.source, built.assets, built.header)
      setEditLocale(code)
      props.onClose()
    } catch (reason) {
      setSaving(false)
      setError(String((reason as Error)?.message ?? reason))
    }
  }
  const copyHeaderOnly = (): void => {
    if (!sourceData?.project.meta.header || !locale.trim() || saving) return
    setSaving(true)
    try {
      const code = locale.trim().replace(/_/g, '-')
      const built = buildHeaderTranslation(sourceData.project.meta.header, sourceData.assets, assets, code)
      setLocaleHeader(code, built.header, built.assets)
      setEditLocale(code)
      props.onClose()
    } catch (reason) {
      setSaving(false)
      setError(String((reason as Error)?.message ?? reason))
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
      <div className="modal scene-translation-modal" role="dialog" aria-modal="true" aria-label="Add a scene language">
        <div className="modal-bar">
          <Icon icon={Languages} size={16} />
          <strong className="modal-title">Add language to “{master?.name}”</strong>
          <span className="spacer" />
          <button onClick={props.onClose} title="Close"><Icon icon={X} size={14} /></button>
        </div>
        <div className="modal-body scene-translation-body">
          <div className="translation-merge-intro">
            This playable stays the master. For the selected language, this scene is replaced by a scene from another playable; every other scene still falls back to the master.
          </div>

          {!!existing.length && (
            <div className="scene-translation-existing">
              <strong>Already added</strong>
              {existing.map((code) => (
                <span key={code}>
                  <button onClick={() => setLocale(code)}>{code}</button>
                  <button title={`Remove ${code} scene override`} onClick={() => removeSceneLocaleSource(master.id, code)}><Icon icon={Trash2} size={12} /></button>
                </span>
              ))}
            </div>
          )}

          <label className="scene-translation-field">
            <span>1. Language</span>
            <input list="scene-language-codes" value={locale} onChange={(event) => setLocale(event.target.value)} placeholder="e.g. de" />
          </label>
          <div className="scene-language-quick">
            {LANGUAGE_SUGGESTIONS.slice(0, 8).map(([code, label]) => <button key={code} className={locale === code ? 'on' : ''} onClick={() => setLocale(code)} title={label}>{code}</button>)}
          </div>
          <datalist id="scene-language-codes">
            {LANGUAGE_SUGGESTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </datalist>

          <label className="scene-translation-field">
            <span>2. Playable to copy from</span>
            <select value={sourceProjectId} onChange={(event) => setSourceProjectId(event.target.value)}>
              {!projects.length && <option value="">No other playables yet</option>}
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>

          <label className="scene-translation-field">
            <span>3. Scene to use</span>
            <select value={sourceSceneId} disabled={!sourceData || loading} onChange={(event) => setSourceSceneId(event.target.value)}>
              {loading && <option value="">Loading scenes…</option>}
              {sourceData?.project.scenes.map((scene, index) => <option key={scene.id} value={scene.id}>{index + 1}. {scene.name}</option>)}
            </select>
          </label>

          {sourceScene && (
            <div className="scene-translation-preview">
              <span><strong>{sourceScene.name}</strong>{sourceScene.elements.length} element{sourceScene.elements.length === 1 ? '' : 's'}</span>
              <span>Both portrait and landscape layouts will be copied.</span>
            </div>
          )}
          {!!error && <div className="translation-merge-alert">{error}</div>}
        </div>
        <div className="asset-flip-foot">
          <span className="hint">Master flow and transitions stay unchanged.</span>
          <span className="spacer" />
          <button onClick={props.onClose}>Cancel</button>
          {sourceData?.project.meta.header && (
            <button disabled={!locale.trim() || saving} onClick={copyHeaderOnly} title="Copy only this playable's date/countdown header; keep the existing language scene unchanged">
              Copy header only
            </button>
          )}
          <button className="primary" disabled={!ready} onClick={save}>
            <Icon icon={Languages} size={14} /> {saving ? 'Adding…' : existing.includes(locale) ? 'Replace language scene' : 'Add language scene'}
          </button>
        </div>
      </div>
    </div>
  )
}
