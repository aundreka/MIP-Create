import { useMemo, useState } from 'react'
import {
  applovinOpen,
  applovinProbe,
  applovinUpload,
  applovinWaitForLinks,
  canApplovin,
  type ApplovinFile,
  type ProjectData,
} from '../bridge'
import { matchPreviewLinks, PREVIEW_LINK_MARK, readLastLinks, saveLastLinks, type FileLink } from '../applovinLinks'
import { buildDeliveryFiles } from '../deliver'
import { fetchRuntimeSrc } from '../export'
import { Copy, Icon, Upload } from '../icons'
import { currentProjectId, loadProjectPreview } from '../projects'
import { getState } from '../store'
import { Modal, Row, Toggle } from '../ui'

interface UploadSource {
  id: string
  label: string
  data: ProjectData
}

interface UploadBuildResult {
  files: ApplovinFile[]
  skipped: string[]
}

async function buildProjectUploadFiles(source: UploadSource, sip: boolean, runtimeSrc: string, variantIds?: string[]): Promise<UploadBuildResult> {
  const { project, assets } = source.data
  const built = await buildDeliveryFiles(project, assets, { label: source.label, variants: true, variantIds, sip, runtimeSrc })
  return { files: built.files.map((f) => ({ name: f.name, text: f.text, iteration: f.iteration })), skipped: built.skipped }
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text)
}

export function UploadModal(props: { onClose: () => void; projectIds?: string[]; label?: string }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [appLovinOn, setAppLovinOn] = useState(true)
  const [fileServerOn, setFileServerOn] = useState(true)
  const [alUrl, setAlUrl] = useState(() => localStorage.getItem('pa:applovinUrl') || 'http://167.99.227.249/wp-login.php?redirect_to=%2F')
  const [alAddText, setAlAddText] = useState(() => localStorage.getItem('pa:applovinAdd') || 'Add Another Upload')
  const [alUploadText, setAlUploadText] = useState(() => localStorage.getItem('pa:applovinUpload') || 'Upload')
  const [alSubmit, setAlSubmit] = useState(false)
  const [alStatus, setAlStatus] = useState<string | null>(null)
  const [alLink, setAlLink] = useState<string | null>(null)
  // Which of the open playable's variants go up with it (all by default).
  const openVariants = props.projectIds?.length ? [] : (getState().project.meta.variants ?? [])
  const [selVars, setSelVars] = useState<Set<string>>(() => new Set(openVariants.map((v) => v.id)))
  const [includeSip, setIncludeSip] = useState(() => localStorage.getItem('pa:uploadSip') !== 'off')
  const linksKey = props.projectIds?.length ? props.projectIds.join(',') : currentProjectId() ?? 'current'
  const [alLinks, setAlLinks] = useState<FileLink[] | null>(() => readLastLinks(linksKey)?.links ?? null)
  const [alLinksFresh, setAlLinksFresh] = useState(false)
  const [alPage, setAlPage] = useState<string | null>(null)
  const [fuUrl, setFuUrl] = useState(() => localStorage.getItem('pa:fileUploadUrl') || 'http://20.255.60.183/file-upload/')
  const [fuAddText, setFuAddText] = useState(() => localStorage.getItem('pa:fileUploadAdd') || 'Add Another Upload')
  const [fuUploadText, setFuUploadText] = useState(() => localStorage.getItem('pa:fileUploadSubmit') || 'Upload')
  const [fuSubmit, setFuSubmit] = useState(true)
  const [fuStatus, setFuStatus] = useState<string | null>(null)
  const [fuLink, setFuLink] = useState<string | null>(null)
  const [fuPage, setFuPage] = useState<string | null>(null)
  const [fuAdvanced, setFuAdvanced] = useState(false)
  const [alAdvanced, setAlAdvanced] = useState(false)
  const [fuLinkSelector, setFuLinkSelector] = useState(() => localStorage.getItem('pa:fileUploadLinkSelector') || '')
  const [fuLinkFilter, setFuLinkFilter] = useState(() => localStorage.getItem('pa:fileUploadLinkFilter') || '20.255.60.183')

  const title = useMemo(() => {
    if (props.projectIds?.length) {
      return props.projectIds.length === 1 ? `Upload "${props.label || 'playable'}"` : `Bulk Upload ${props.label || 'project'}`
    }
    return 'Upload Current Playable'
  }, [props.label, props.projectIds])

  const summary = useMemo(() => {
    if (props.projectIds?.length) {
      return props.projectIds.length === 1
        ? `Uploads 1 MIP${props.label ? `: ${props.label}` : ''}`
        : `Uploads ${props.projectIds.length} MIPs from ${props.label || 'the selected project'}`
    }
    return 'Uploads the current MIP plus any variants attached to it.'
  }, [props.label, props.projectIds])

  const loadSources = async (): Promise<UploadSource[]> => {
    if (!props.projectIds?.length) {
      const state = getState()
      return [{ id: 'current', label: state.project.meta.name || 'Current playable', data: { project: state.project, assets: state.assets, trace: state.trace } }]
    }
    const loaded = await Promise.all(props.projectIds.map(async (id) => ({ id, data: await loadProjectPreview(id) })))
    return loaded
      .filter((entry): entry is { id: string; data: ProjectData } => !!entry.data)
      .map((entry) => ({ id: entry.id, label: entry.data.project.meta.name || entry.id, data: entry.data }))
  }

  const detectOne = async (
    url: string,
    addButtonText: string,
    uploadButtonText: string,
    setText: (value: string) => void,
  ): Promise<void> => {
    setText('Detecting form...')
    const probe = await applovinProbe({ url, addButtonText, uploadButtonText })
    if (!probe.ok) {
      setText('Detect failed: ' + (probe.error ?? 'open the page first'))
      return
    }
    setText(
      `${probe.title || probe.url}: ${probe.fileInputs || 0} file input(s), ${probe.textInputs || 0} text field(s), ` +
      `add button ${probe.addButton ? 'yes' : 'no'}, upload button ${probe.uploadButton ? 'yes' : 'no'}.`,
    )
  }

  const runUpload = async (): Promise<void> => {
    if (!appLovinOn && !fileServerOn) {
      setStatus('Select at least one upload target.')
      return
    }
    setBusy(true)
    setStatus('Loading selected project data...')
    setAlStatus(null)
    setFuStatus(null)
    setAlLink(null)
    setAlLinksFresh(false)
    setFuLink(null)
    setAlPage(null)
    setFuPage(null)
    try {
      const sources = await loadSources()
      if (!sources.length) throw new Error('No playable data could be loaded.')
      const allFiles: ApplovinFile[] = []
      const skipped: string[] = []
      const runtimeSrc = await fetchRuntimeSrc()
      for (let i = 0; i < sources.length; i++) {
        setStatus(`Building playables ${i + 1}/${sources.length}...`)
        // Variant ticks apply to the open playable only; bulk uploads send every variant.
        const built = await buildProjectUploadFiles(sources[i], includeSip, runtimeSrc, props.projectIds?.length ? undefined : [...selVars])
        allFiles.push(...built.files)
        skipped.push(...built.skipped)
      }
      if (!allFiles.length) {
        setStatus('Nothing to upload. Every output is over the 5 MB limit.')
        return
      }
      setStatus(`Prepared ${allFiles.length} file(s).`)

      if (appLovinOn) {
        setAlStatus('Uploading to AppLovin...')
        const result = await applovinUpload({
          url: alUrl,
          files: allFiles,
          submit: alSubmit,
          addButtonText: alAddText,
          uploadButtonText: alUploadText,
        })
        setAlPage(result.pageUrl ?? null)
        if (!result.ok) {
          setAlStatus('Error: ' + result.error)
        } else {
          setAlStatus(
            `Filled ${result.files || 0} file(s)` +
              (result.submitted ? ' and submitted. Waiting for the preview links...' : '. Click Upload in the AppLovin window; waiting for the preview links...'),
          )
          const wait = await applovinWaitForLinks({ mark: PREVIEW_LINK_MARK, expected: allFiles.length })
          const matched = matchPreviewLinks(allFiles, wait.links ?? [])
          const found = matched.filter((f) => f.link).length
          if (found) {
            setAlLinks(matched)
            setAlLinksFresh(true)
            saveLastLinks(linksKey, matched)
            if (found === 1) copyText(matched.find((f) => f.link)!.link!)
          }
          setAlLink(null)
          setAlStatus(
            found === allFiles.length
              ? `Uploaded. ${found} preview link${found === 1 ? '' : 's'} below${found === 1 ? ' (copied)' : ''}.`
              : found
                ? `Uploaded, but only ${found} of ${allFiles.length} preview links were found.`
                : wait.closed
                  ? 'No link found: the AppLovin window was closed.'
                  : wait.timedOut
                    ? 'No link found within 5 minutes. Check the AppLovin window.'
                    : 'No link found. ' + (wait.error ?? ''),
          )
        }
      }

      if (fileServerOn) {
        setFuStatus('Uploading to file server...')
        const result = await applovinUpload({
          url: fuUrl,
          files: allFiles,
          submit: fuSubmit,
          addButtonText: fuAddText,
          uploadButtonText: fuUploadText,
          resultLinkSelector: fuLinkSelector || undefined,
          resultLinkHrefIncludes: fuLinkFilter || undefined,
          waitForResultMs: fuSubmit ? 3000 : 0,
        })
        setFuStatus(result.ok ? `Uploaded ${result.files || 0} file(s)${result.submitted ? ' and submitted.' : '. Review the window and click Upload.'}` : 'Error: ' + result.error)
        setFuLink(result.link ?? null)
        setFuPage(result.pageUrl ?? null)
      }

      if (skipped.length) {
        setStatus(`Prepared ${allFiles.length} file(s). Skipped ${skipped.length} over-limit output(s).`)
      }
    } catch (e) {
      setStatus('Error: ' + String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  if (!canApplovin) {
    return (
      <Modal title="Upload" onClose={props.onClose} size="sm">
        <div className="hint pad">Upload automation is available in the desktop app only.</div>
      </Modal>
    )
  }

  return (
    <Modal title={title} onClose={props.onClose} size="md">
      <div className="hint pad">{summary}</div>
      <div className="group-title">Targets</div>
      <Toggle label="Upload to AppLovin" checked={appLovinOn} onChange={setAppLovinOn} />
      <Toggle label="Upload to file server" checked={fileServerOn} onChange={setFileServerOn} />
      <Toggle
        label="Include the SIP (end card alone)"
        checked={includeSip}
        onChange={(v) => {
          setIncludeSip(v)
          localStorage.setItem('pa:uploadSip', v ? 'on' : 'off')
        }}
      />

      {openVariants.length > 0 && (
        <>
          <div className="group-title">Variants</div>
          <div className="net-grid">
            {openVariants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={'net-chip' + (selVars.has(v.id) ? ' on' : '')}
                aria-pressed={selVars.has(v.id)}
                onClick={() => {
                  const next = new Set(selVars)
                  if (next.has(v.id)) next.delete(v.id)
                  else next.add(v.id)
                  setSelVars(next)
                }}
              >
                {v.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="group-title">AppLovin</div>
      <Row label="Upload URL">
        <input
          className="text-input"
          value={alUrl}
          onChange={(e) => {
            setAlUrl(e.target.value)
            localStorage.setItem('pa:applovinUrl', e.target.value)
          }}
        />
      </Row>
      <Toggle label="Submit automatically" checked={alSubmit} onChange={setAlSubmit} />
      <div className="grid2">
        <button onClick={() => void applovinOpen(alUrl)}>Open / log in</button>
        <button onClick={() => void detectOne(alUrl, alAddText, alUploadText, setAlStatus)}>Detect form</button>
      </div>
      {alStatus && <div className="figma-status">{alStatus}</div>}
      {alLink && (
        <div className="grid2">
          <input className="text-input" readOnly value={alLink} />
          <button onClick={() => copyText(alLink)}><Icon icon={Copy} size={13} /> Copy link</button>
        </div>
      )}
      {!alLink && alPage && <div className="hint pad">Result page: {alPage}</div>}
      <button className="link-btn" onClick={() => setAlAdvanced((v) => !v)}>{alAdvanced ? 'Hide' : 'Form button text'}</button>
      {alAdvanced && (
        <div className="grid2">
          <label className="field">
            <span>Add row button</span>
            <input className="text-input" value={alAddText} onChange={(e) => { setAlAddText(e.target.value); localStorage.setItem('pa:applovinAdd', e.target.value) }} />
          </label>
          <label className="field">
            <span>Upload button</span>
            <input className="text-input" value={alUploadText} onChange={(e) => { setAlUploadText(e.target.value); localStorage.setItem('pa:applovinUpload', e.target.value) }} />
          </label>
        </div>
      )}
      {alLinks && alLinks.some((f) => f.link) && (
        <>
          <div className="hint pad">{alLinksFresh ? 'Preview links' : 'Last upload\u2019s preview links'}</div>
          {alLinks.map((f) => (
            <Row key={f.name} label={f.iteration || f.name}>
              {f.link ? (
                <div className="grid2">
                  <input className="text-input" readOnly value={f.link} title={f.name} />
                  <span>
                    <button onClick={() => copyText(f.link!)}><Icon icon={Copy} size={13} /> Copy</button>{' '}
                    <button onClick={() => window.open(f.link, '_blank')}>Open</button>
                  </span>
                </div>
              ) : (
                <span className="hint">No link found</span>
              )}
            </Row>
          ))}
          {alLinks.filter((f) => f.link).length > 1 && (
            <button onClick={() => copyText(alLinks.filter((f) => f.link).map((f) => `${f.iteration}: ${f.link}`).join('\n'))}>
              <Icon icon={Copy} size={13} /> Copy all links
            </button>
          )}
        </>
      )}

      <div className="group-title">File Server</div>
      <Row label="Upload URL">
        <input
          className="text-input"
          value={fuUrl}
          onChange={(e) => {
            setFuUrl(e.target.value)
            localStorage.setItem('pa:fileUploadUrl', e.target.value)
          }}
        />
      </Row>
      <Toggle label="Submit automatically" checked={fuSubmit} onChange={setFuSubmit} />
      <div className="grid2">
        <button onClick={() => void applovinOpen(fuUrl)}>Open / log in</button>
        <button onClick={() => void detectOne(fuUrl, fuAddText, fuUploadText, setFuStatus)}>Detect form</button>
      </div>
      {fuStatus && <div className="figma-status">{fuStatus}</div>}
      {fuLink && (
        <div className="grid2">
          <input className="text-input" readOnly value={fuLink} />
          <button onClick={() => copyText(fuLink)}><Icon icon={Copy} size={13} /> Copy link</button>
        </div>
      )}
      {!fuLink && fuPage && <div className="hint pad">Result page: {fuPage}</div>}
      <button className="link-btn" onClick={() => setFuAdvanced((v) => !v)}>{fuAdvanced ? 'Hide' : 'Advanced'}</button>
      {fuAdvanced && (
        <div className="grid2">
          <label className="field">
            <span>Add row button</span>
            <input className="text-input" value={fuAddText} onChange={(e) => { setFuAddText(e.target.value); localStorage.setItem('pa:fileUploadAdd', e.target.value) }} />
          </label>
          <label className="field">
            <span>Upload button</span>
            <input className="text-input" value={fuUploadText} onChange={(e) => { setFuUploadText(e.target.value); localStorage.setItem('pa:fileUploadSubmit', e.target.value) }} />
          </label>
          <label className="field">
            <span>Link selector</span>
            <input
              className="text-input"
              value={fuLinkSelector}
              onChange={(e) => {
                setFuLinkSelector(e.target.value)
                localStorage.setItem('pa:fileUploadLinkSelector', e.target.value)
              }}
              placeholder="a[href*='uploads']"
            />
          </label>
          <label className="field">
            <span>Link contains</span>
            <input
              className="text-input"
              value={fuLinkFilter}
              onChange={(e) => {
                setFuLinkFilter(e.target.value)
                localStorage.setItem('pa:fileUploadLinkFilter', e.target.value)
              }}
              placeholder="20.255.60.183"
            />
          </label>
        </div>
      )}

      <button className="primary wide" disabled={busy || (!appLovinOn && !fileServerOn)} onClick={() => void runUpload()}>
        <Icon icon={Upload} size={14} /> {busy ? 'Uploading...' : 'Build and upload'}
      </button>
      {status && <div className="hint pad">{status}</div>}
    </Modal>
  )
}
