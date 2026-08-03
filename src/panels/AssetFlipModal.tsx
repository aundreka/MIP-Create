import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectData } from '../bridge'
import { readImageFile } from '../bridge'
import { createProject, loadProjectPreview, type ProjectRecord } from '../projects'
import {
  analyzeAssetFlipUploads,
  assetFlipName,
  assetFlipRenameErrors,
  buildAssetFlipData,
  collectAssetFlipSlots,
  type AssetFlipUpload,
} from '../assetFlip'
import { Check, Copy, Icon, Upload, X } from '../icons'

const SUPPORTED_IMAGE = /\.(?:png|jpe?g|webp)$/i

export function AssetFlipModal(props: {
  projects: ProjectRecord[]
  initialSourceId?: string
  onClose: () => void
  onCreated: () => void
}): JSX.Element {
  const firstId = props.initialSourceId ?? props.projects[0]?.id ?? ''
  const [sourceId, setSourceId] = useState(firstId)
  const [source, setSource] = useState<ProjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [renames, setRenames] = useState<Record<string, string>>({})
  const [uploads, setUploads] = useState<AssetFlipUpload[]>([])
  const [unsupported, setUnsupported] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setSource(null)
    setUploads([])
    setUnsupported([])
    void loadProjectPreview(sourceId).then((data) => {
      if (!alive) return
      setSource(data)
      setLoading(false)
      if (!data) return
      const slots = collectAssetFlipSlots(data.project, data.assets)
      setRenames(Object.fromEntries(slots.map((slot) => [slot.id, slot.id])))
      setNewName(`${data.project.meta.name || 'Untitled'} flip`)
    })
    return () => { alive = false }
  }, [sourceId])

  const slots = useMemo(() => source ? collectAssetFlipSlots(source.project, source.assets) : [], [source])
  const expectedNames = useMemo(() => slots.map((slot) => assetFlipName(renames[slot.id] ?? slot.id)), [renames, slots])
  const analysis = useMemo(() => analyzeAssetFlipUploads(expectedNames, uploads), [expectedNames, uploads])
  const renameErrors = source ? assetFlipRenameErrors(
    Object.fromEntries(slots.map((slot) => [slot.id, assetFlipName(renames[slot.id] ?? slot.id)])),
    Object.entries(source.assets)
      .filter(([, asset]) => !!asset.kind && asset.kind !== 'image')
      .map(([id]) => id),
  ) : []

  const addFiles = async (files: File[]): Promise<void> => {
    const supported = files.filter((file) => SUPPORTED_IMAGE.test(file.name))
    setUnsupported(files.filter((file) => !SUPPORTED_IMAGE.test(file.name)).map((file) => file.name))
    setReading(true)
    const read = await Promise.all(supported.map(async (file) => {
      const image = await readImageFile(file)
      return image ? { name: file.name, asset: { src: image.src, w: image.w, h: image.h } } : null
    }))
    setUploads(read.filter((item): item is AssetFlipUpload => item !== null))
    setReading(false)
  }

  const create = async (): Promise<void> => {
    if (!source || creating || renameErrors.length || analysis.duplicate.length) return
    setCreating(true)
    const renameById = Object.fromEntries(slots.map((slot) => [slot.id, assetFlipName(renames[slot.id] ?? slot.id)]))
    const replacements = Object.fromEntries(Object.entries(analysis.matches).map(([name, upload]) => [name, upload.asset]))
    const built = buildAssetFlipData(source.project, source.assets, newName, renameById, replacements)
    await createProject({ ...built, trace: source.trace })
    props.onCreated()
  }

  const copyOnly = async (): Promise<void> => {
    if (!source || creating) return
    setCreating(true)
    const copy = buildAssetFlipData(source.project, source.assets, newName, {}, {})
    await createProject({ ...copy, trace: source.trace })
    props.onCreated()
  }

  const ready = !!source && slots.length > 0 && !reading && !creating && !renameErrors.length && !analysis.duplicate.length
  const matchedCount = Object.keys(analysis.matches).length

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose() }}>
      <div className="modal modal-lg asset-flip-modal" role="dialog" aria-modal="true" aria-label="Copy playable or create asset flip">
        <div className="modal-bar">
          <Icon icon={Copy} size={16} />
          <strong className="modal-title">Copy playable / Asset flip</strong>
          <span className="spacer" />
          <button onClick={props.onClose} title="Close"><Icon icon={X} size={14} /></button>
        </div>
        <div className="modal-body asset-flip-body">
          <div className="asset-flip-intro">Copy a playable, optionally rename its referenced images, then replace any of them in one upload. Filenames are matched without the .png, .jpg, .jpeg, or .webp extension. Images without a matching upload keep their current artwork.</div>

          <div className="asset-flip-fields">
            <label>
              <span>Project to copy</span>
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                {props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label>
              <span>New playable name</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New playable name" />
            </label>
          </div>

          {loading ? <div className="hint pad">Loading project assets…</div> : !source ? (
            <div className="asset-flip-alert error">This project could not be loaded.</div>
          ) : (
            <>
              <div className="asset-flip-section-head">
                <div><strong>1. Rename image assets</strong><span>{slots.length} referenced image{slots.length === 1 ? '' : 's'}</span></div>
                <span className="hint">Includes nested minigame and landscape assets</span>
              </div>
              {!slots.length ? <div className="asset-flip-alert error">No referenced image assets were found in this project.</div> : (
                <div className="asset-flip-assets">
                  {slots.map((slot) => {
                    const expected = assetFlipName(renames[slot.id] ?? slot.id)
                    const matched = analysis.matches[expected]
                    const duplicate = analysis.duplicate.includes(expected)
                    return (
                      <div className="asset-flip-row" key={slot.id}>
                        <span className="asset-flip-thumb" style={{ backgroundImage: `url("${slot.asset.src}")` }} />
                        <div className="asset-flip-old" title={slot.references.join('\n')}>
                          <strong>{slot.sceneNames.join(' + ')} - {slot.id}</strong>
                          <span>{slot.asset.w}×{slot.asset.h} · {slot.references.length} reference{slot.references.length === 1 ? '' : 's'}</span>
                        </div>
                        <span className="asset-flip-arrow">→</span>
                        <input
                          value={renames[slot.id] ?? slot.id}
                          aria-label={`New name for ${slot.id}`}
                          onChange={(e) => setRenames((current) => ({ ...current, [slot.id]: e.target.value }))}
                        />
                        <span className={'asset-flip-match ' + (duplicate ? 'bad' : matched ? 'ok' : 'keep')}>
                          {duplicate ? 'Duplicate' : matched ? <><Icon icon={Check} size={12} /> {matched.name}</> : 'Keep current'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="asset-flip-section-head">
                <div><strong>2. Bulk upload replacements</strong><span>PNG, JPG, JPEG, or WebP</span></div>
              </div>
              <button
                type="button"
                className="asset-flip-drop"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); void addFiles(Array.from(e.dataTransfer.files)) }}
              >
                <Icon icon={Upload} size={22} />
                <strong>{reading ? 'Reading images…' : uploads.length ? 'Choose a different batch' : 'Choose or drop all replacement images'}</strong>
                <span>Matching files are replaced; unmatched assets keep their current image.</span>
              </button>
              <input
                ref={inputRef}
                hidden
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                onChange={(e) => { void addFiles(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = '' }}
              />

              <div className="asset-flip-summary">
                <span className="ok"><strong>{matchedCount}</strong> matched</span>
                <span className="keep"><strong>{analysis.missing.length}</strong> unchanged / walang flip</span>
                <span className={analysis.extra.length ? 'warn' : 'ok'}><strong>{analysis.extra.length}</strong> extra / sobra</span>
              </div>
              {!!uploads.length && !!analysis.missing.length && <div className="asset-flip-alert keep"><strong>Keeping current artwork:</strong> {analysis.missing.join(', ')}</div>}
              {!!analysis.extra.length && <div className="asset-flip-alert warn"><strong>Extra (ignored):</strong> {analysis.extra.map((file) => file.name).join(', ')}</div>}
              {!!analysis.duplicate.length && <div className="asset-flip-alert error"><strong>Duplicate matches:</strong> {analysis.duplicate.join(', ')}. Keep only one extension/version of each name.</div>}
              {!!unsupported.length && <div className="asset-flip-alert warn"><strong>Unsupported (ignored):</strong> {unsupported.join(', ')}</div>}
              {!!renameErrors.length && <div className="asset-flip-alert error">{renameErrors.join(' ')}</div>}
            </>
          )}
        </div>
        <div className="asset-flip-foot">
          <span className="hint">The source playable is never changed.</span>
          <span className="spacer" />
          <button onClick={props.onClose}>Cancel</button>
          <button disabled={!source || creating} onClick={() => void copyOnly()}>
            <Icon icon={Copy} size={14} /> {creating ? 'Creating…' : 'Copy only'}
          </button>
          <button className="primary" disabled={!ready} onClick={() => void create()}>
            <Icon icon={Copy} size={14} /> {creating ? 'Creating…' : 'Copy with asset options'}
          </button>
        </div>
      </div>
    </div>
  )
}
