// Templates modal — start a new MIP from a built-in starter or a saved
// `.playable-template.zip`, and save the current project as a reusable template
// (locks chrome / CTA / pulse / SFX / flow so every MIP from it stays consistent).

import { useRef, useState } from 'react'
import { downloadBlob } from '../export'
import { loadProject, useEditorState } from '../store'
import { buildTemplateZip, readTemplateZip, STARTERS } from '../templates'
import { Icon, Save, Upload } from '../icons'
import { confirmDestructive, Modal } from '../ui'

export function TemplatesModal(props: { onClose: () => void }): JSX.Element {
  const { project, assets } = useEditorState()
  const [name, setName] = useState(project.meta.name || 'template')
  const [status, setStatus] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const startFrom = (id: string): void => {
    const s = STARTERS.find((x) => x.id === id)
    if (!s) return
    if (!confirmDestructive('Start from this template? This replaces your current project and cannot be undone.')) return
    const data = s.build()
    loadProject(data.project, data.assets, null)
    props.onClose()
  }

  const saveTemplate = async (): Promise<void> => {
    setStatus('Packing…')
    const blob = await buildTemplateZip({ project, assets }, name)
    downloadBlob(`${name.replace(/[^a-z0-9_-]+/gi, '_') || 'template'}.playable-template.zip`, blob)
    setStatus('Saved (downloaded).')
  }

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setStatus('Reading…')
    const data = await readTemplateZip(file)
    if (!data) {
      setStatus('Not a valid .playable-template.zip')
      return
    }
    if (!confirmDestructive('Load this template? This replaces your current project and cannot be undone.')) return
    loadProject(data.project, data.assets, null)
    props.onClose()
  }

  return (
    <Modal title="Templates" onClose={props.onClose} size="md">
      <div className="group-title">Start from a built-in</div>
      {STARTERS.map((s) => (
        <button key={s.id} className="tpl-card" onClick={() => startFrom(s.id)}>
          <strong>{s.label}</strong>
          <span>{s.description}</span>
        </button>
      ))}

      <div className="group-title">Open a saved template</div>
      <button className="wide" onClick={() => fileRef.current?.click()}>
        <Icon icon={Upload} size={14} /> Open .playable-template.zip…
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".zip,.playable-template.zip,application/zip"
        style={{ display: 'none' }}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      <div className="group-title">Save current as template</div>
      <label className="field">
        <span>Template name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button className="primary wide" onClick={() => void saveTemplate()}>
        <Icon icon={Save} size={14} /> Save as .playable-template.zip
      </button>

      {status && <div className="figma-status">{status}</div>}
      <div className="hint pad">
        Loading a starter or template <b>replaces</b> the current project. Save the current one first if you need it. A
        template bundles the scene flow, chrome, CTA pulse, SFX and assets, so every MIP started from it stays on-brand.
      </div>
    </Modal>
  )
}
