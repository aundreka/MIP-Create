import { useMemo, useState } from 'react'
import { createProject, loadProjectPreview, type ProjectRecord } from '../projects'
import { combineTranslatedPlayables, inferLanguageCode, LANGUAGE_SUGGESTIONS } from '../translationMerge'
import { Check, Icon, Languages, X } from '../icons'

interface RowState {
  selected: boolean
  locale: string
}

export function TranslationMergeModal(props: {
  projects: ProjectRecord[]
  initialSelectedIds?: string[]
  onClose: () => void
  onCreated: () => void
}): JSX.Element {
  const initialIds = useMemo(() => new Set(props.initialSelectedIds ?? []), [props.initialSelectedIds])
  const initialDefault = props.projects.find((project) => initialIds.has(project.id))?.id ?? props.projects[0]?.id ?? ''
  const [rows, setRows] = useState<Record<string, RowState>>(() => Object.fromEntries(props.projects.map((project) => [
    project.id,
    { selected: initialIds.has(project.id), locale: inferLanguageCode(project.name) },
  ])))
  const [defaultId, setDefaultId] = useState(initialDefault)
  const [newName, setNewName] = useState(() => {
    const source = props.projects.find((project) => project.id === initialDefault)
    return `${source?.projectName || source?.name || 'Playable'} multilingual`
  })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const selected = props.projects.filter((project) => rows[project.id]?.selected)
  const normalizedLocales = selected.map((project) => rows[project.id]?.locale.trim().toLowerCase().replace(/_/g, '-'))
  const duplicates = new Set(normalizedLocales.filter((locale, index) => locale && normalizedLocales.indexOf(locale) !== index))
  const ready = selected.length >= 2 && selected.every((project) => rows[project.id]?.locale.trim()) && !duplicates.size && selected.some((project) => project.id === defaultId) && newName.trim() && !creating

  const toggle = (id: string): void => {
    setRows((current) => {
      const nextSelected = !current[id]?.selected
      return { ...current, [id]: { ...(current[id] ?? { locale: '' }), selected: nextSelected } }
    })
    if (id === defaultId && rows[id]?.selected) {
      const next = selected.find((project) => project.id !== id)
      setDefaultId(next?.id ?? '')
    } else if (!defaultId || !selected.some((project) => project.id === defaultId)) {
      setDefaultId(id)
    }
    setError('')
  }

  const create = async (): Promise<void> => {
    if (!ready) return
    setCreating(true)
    setError('')
    try {
      const loaded = await Promise.all(selected.map((project) => loadProjectPreview(project.id)))
      const missing = loaded.findIndex((data) => !data)
      if (missing >= 0) throw new Error(`Could not load “${selected[missing].name}”.`)
      const defaultIndex = selected.findIndex((project) => project.id === defaultId)
      const merged = combineTranslatedPlayables(
        selected.map((project, index) => ({
          locale: rows[project.id].locale,
          data: loaded[index]!,
          label: project.name,
        })),
        defaultIndex,
        newName,
      )
      await createProject(merged)
      if (merged.warnings.length) console.warn('Translation merge fallbacks:', merged.warnings)
      props.onCreated()
    } catch (reason) {
      setCreating(false)
      setError(String((reason as Error)?.message ?? reason))
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
      <div className="modal modal-lg translation-merge-modal" role="dialog" aria-modal="true" aria-label="Combine translated playables">
        <div className="modal-bar">
          <Icon icon={Languages} size={16} />
          <strong className="modal-title">Combine translated playables</strong>
          <span className="spacer" />
          <button onClick={props.onClose} title="Close"><Icon icon={X} size={14} /></button>
        </div>
        <div className="modal-body translation-merge-body">
          <div className="translation-merge-intro">
            Select the language copies that belong together. The browser automatically shows the matching version, and uses the default playable whenever a translated element is missing.
          </div>

          <label className="translation-merge-name">
            <span>Combined playable name</span>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Campaign multilingual" />
          </label>

          <div className="translation-merge-head">
            <span>Use</span><span>Playable</span><span>Language</span><span>Fallback</span>
          </div>
          <div className="translation-merge-list">
            {props.projects.map((project) => {
              const row = rows[project.id]
              const duplicate = duplicates.has(row?.locale.trim().toLowerCase().replace(/_/g, '-'))
              return (
                <div className={'translation-merge-row' + (row?.selected ? ' selected' : '')} key={project.id}>
                  <label className="translation-merge-check" title="Include this playable">
                    <input type="checkbox" checked={!!row?.selected} onChange={() => toggle(project.id)} />
                    <span>{row?.selected && <Icon icon={Check} size={12} />}</span>
                  </label>
                  <button className="translation-merge-project" onClick={() => { if (!row?.selected) toggle(project.id) }}>
                    <strong>{project.name}</strong>
                    {project.projectName && <small>{project.projectName}</small>}
                  </button>
                  <input
                    list="translation-language-codes"
                    aria-label={`Language for ${project.name}`}
                    className={duplicate ? 'invalid' : ''}
                    value={row?.locale ?? ''}
                    disabled={!row?.selected}
                    placeholder="e.g. de"
                    onChange={(event) => {
                      setRows((current) => ({ ...current, [project.id]: { ...current[project.id], locale: event.target.value } }))
                      setError('')
                    }}
                  />
                  <label className="translation-merge-default" title="Use this playable when the browser language has no match">
                    <input type="radio" name="translation-default" checked={defaultId === project.id} disabled={!row?.selected} onChange={() => setDefaultId(project.id)} />
                    <span>Default</span>
                  </label>
                </div>
              )
            })}
          </div>
          <datalist id="translation-language-codes">
            {LANGUAGE_SUGGESTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </datalist>

          {selected.length < 2 && <div className="translation-merge-help">Select at least two playables.</div>}
          {!!duplicates.size && <div className="translation-merge-alert">Each playable needs a different language code.</div>}
          {!!error && <div className="translation-merge-alert">{error}</div>}
        </div>
        <div className="asset-flip-foot">
          <span className="hint">The original playables are never changed.</span>
          <span className="spacer" />
          <button onClick={props.onClose}>Cancel</button>
          <button className="primary" disabled={!ready} onClick={() => void create()}>
            <Icon icon={Languages} size={14} /> {creating ? 'Combining…' : `Combine ${selected.length || ''} playables`}
          </button>
        </div>
      </div>
    </div>
  )
}
