import { useEffect, useMemo, useState } from 'react'
import { applovinOpen, applovinProbe, applovinUpload, applovinWaitForLinks, canApplovin, type ApplovinFile, type ProjectData } from '../bridge'
import { matchPreviewLinks, PREVIEW_LINK_MARK, readLastLinks, saveLastLinks, type FileLink } from '../applovinLinks'
import { buildDeliveryFiles, type DeliveryFile } from '../deliver'
import { fetchRuntimeSrc } from '../export'
import { Copy, Icon, Upload } from '../icons'
import { currentProjectId, listProjects, loadProjectData, loadProjectPreview } from '../projects'
import { allKeys, buildUploadPlan, initialPicks, planRequests, savePicks, selectedCount, type PlanGroup, type PlanSource } from '../uploadPlan'
import { copySlackPost, DEFAULT_MENTIONS, slackPostText, themeFromProjectName, type SlackPostInput } from '../slackPost'
import { getState } from '../store'
import { Checkbox, Modal, Row, Toggle } from '../ui'

/** The id the open (possibly unsaved) playable goes under. */
const CURRENT = 'current'

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text)
}

/** The playables a batch starts from: the ids Home sent, else the open one. */
function initialSources(projectIds?: string[]): PlanSource[] {
  if (!projectIds?.length) {
    const state = getState()
    return [{ id: CURRENT, name: state.project.meta.name || 'Current playable', project: state.project }]
  }
  return projectIds.flatMap((id) => {
    const d = loadProjectData(id)
    return d ? [{ id, name: d.project.meta.name || id, project: d.project }] : []
  })
}

/** Full data (asset bytes included) for one source, ready to build. */
async function sourceData(id: string): Promise<ProjectData | null> {
  if (id === CURRENT) {
    const state = getState()
    return { project: state.project, assets: state.assets, trace: state.trace }
  }
  return loadProjectPreview(id)
}

export function UploadModal(props: { onClose: () => void; projectIds?: string[]; label?: string }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [appLovinOn, setAppLovinOn] = useState(() => localStorage.getItem('pa:uploadAl') !== 'off')
  // The file server is a second trip through the same window, so it stays off
  // unless asked for — "upload to AppLovin" should be one click and nothing else.
  const [fileServerOn, setFileServerOn] = useState(() => localStorage.getItem('pa:uploadFs') === 'on')
  const [alUrl, setAlUrl] = useState(() => localStorage.getItem('pa:applovinUrl') || 'http://167.99.227.249/wp-login.php?redirect_to=%2F')
  const [alAddText, setAlAddText] = useState(() => localStorage.getItem('pa:applovinAdd') || 'Add Another Upload')
  const [alUploadText, setAlUploadText] = useState(() => localStorage.getItem('pa:applovinUpload') || 'Upload')
  // Clicking Upload on the page is part of the one click, so this is on by default.
  const [alSubmit, setAlSubmit] = useState(() => localStorage.getItem('pa:applovinSubmit') !== 'off')
  const [alStatus, setAlStatus] = useState<string | null>(null)
  const [alPage, setAlPage] = useState<string | null>(null)

  // ---- what to upload: the MIP / variant / SIP ticks, per playable ----------
  // Sources and ticks are seeded together so the remembered ticks are read under
  // the same batch key they will be saved under.
  const [seed] = useState(() => {
    const list = initialSources(props.projectIds)
    const key = list.map((s) => s.id).join(',') || CURRENT
    return { list, key, picks: initialPicks(buildUploadPlan(list), key) }
  })
  const [sources, setSources] = useState<PlanSource[]>(seed.list)
  const [picks, setPicks] = useState<Set<string>>(seed.picks)
  const plan: PlanGroup[] = useMemo(() => buildUploadPlan(sources), [sources])
  const fileCount = selectedCount(plan, picks)
  // Every tick change is a functional update: two clicks in the same tick (the
  // picker, a run of boxes) must not drop the first one's work.
  const remember = setPicks
  const setPicked = (keys: string[], on: boolean): void => {
    remember((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }
  // The ticks are remembered for this batch, so the next upload of the same
  // playables offers the same picks.
  useEffect(() => savePicks(seed.key, picks), [seed.key, picks])
  // Other playables in the library, so one batch can span projects.
  const [addOpen, setAddOpen] = useState(false)
  const inBatch = new Set(sources.map((s) => s.id))
  const addable = listProjects().filter((p) => !inBatch.has(p.id) && !(inBatch.has(CURRENT) && p.id === currentProjectId()))
  const addSource = (id: string): void => {
    const d = loadProjectData(id)
    if (!d) return
    const added: PlanSource = { id, name: d.project.meta.name || id, project: d.project }
    setSources((prev) => (prev.some((s) => s.id === id) ? prev : [...prev, added]))
    // A playable just added goes up whole — tick its rows, leave the rest alone.
    const fresh = allKeys(buildUploadPlan([added]))
    remember((prev) => new Set([...prev, ...fresh]))
  }
  const dropSource = (id: string): void => {
    setSources((prev) => prev.filter((s) => s.id !== id))
    remember((prev) => new Set([...prev].filter((k) => !k.startsWith(id + '|'))))
  }

  const linksKey = props.projectIds?.length ? props.projectIds.join(',') : (currentProjectId() ?? CURRENT)
  const [alLinks, setAlLinks] = useState<FileLink[] | null>(() => readLastLinks(linksKey)?.links ?? null)
  const [alLinksFresh, setAlLinksFresh] = useState(false)
  // What the last run actually built, so the Slack post names the real files.
  const [built, setBuilt] = useState<DeliveryFile[] | null>(null)

  // ---- the Slack post ------------------------------------------------------
  // Headline facts (date, brand, theme) come from a playable that is actually going
  // up — and preferably one with a client, so an unnamed scratch playable at the
  // top of the batch does not blank the line.
  const headMeta = useMemo(() => {
    const metas = plan
      .filter((g) => g.items.some((i) => picks.has(i.key)))
      .map((g) => sources.find((s) => s.id === g.id)?.project.meta)
      .filter((m): m is NonNullable<typeof m> => !!m)
    return metas.find((m) => (m.client ?? '').trim()) ?? metas[0] ?? sources[0]?.project.meta
  }, [plan, picks, sources])
  // Typed theme wins; until then it follows the batch.
  const [themeEdit, setThemeEdit] = useState<string | null>(null)
  const theme = themeEdit ?? themeFromProjectName(headMeta?.projectName || props.label, headMeta?.client)
  const [mentions, setMentions] = useState(() => localStorage.getItem('pa:slackMentions') ?? DEFAULT_MENTIONS)
  const [copied, setCopied] = useState(false)
  const slackInput: SlackPostInput = useMemo(() => {
    const picked = plan.flatMap((g) => g.items.filter((i) => picks.has(i.key)))
    const kinds = built ? built.map((f) => f.kind) : picked.map((i) => i.kind)
    // Only the playables with something ticked get named in "(MIP7 and MIP8)".
    const mips = plan.filter((g) => g.items.some((i) => picks.has(i.key))).map((g) => g.mip)
    return {
      date: headMeta?.exportDate || headMeta?.mipDate,
      client: headMeta?.client,
      theme,
      kinds,
      mips,
      links: (alLinks ?? []).filter((f) => f.link).map((f) => ({ label: f.iteration || f.name, url: f.link! })),
      mentions,
    }
  }, [plan, picks, built, alLinks, theme, mentions, headMeta])
  const slackText = slackPostText(slackInput)

  const title = useMemo(() => {
    if (props.projectIds?.length) {
      return props.projectIds.length === 1 ? `Upload "${props.label || 'playable'}"` : `Upload ${props.label || 'project'}`
    }
    return 'Upload Current Playable'
  }, [props.label, props.projectIds])

  const detectOne = async (url: string, addButtonText: string, uploadButtonText: string, setText: (value: string) => void): Promise<void> => {
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

  // ---- file server (secondary target) --------------------------------------
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

  const runUpload = async (): Promise<void> => {
    if (!appLovinOn && !fileServerOn) {
      setStatus('Select at least one upload target.')
      return
    }
    const requests = planRequests(plan, picks)
    if (!requests.length) {
      setStatus('Nothing ticked. Choose at least one MIP or SIP.')
      return
    }
    setBusy(true)
    setStatus('Building the ticked files...')
    setAlStatus(null)
    setFuStatus(null)
    setAlLinksFresh(false)
    setFuLink(null)
    setAlPage(null)
    setFuPage(null)
    setCopied(false)
    try {
      const runtimeSrc = await fetchRuntimeSrc()
      const delivered: DeliveryFile[] = []
      const skipped: string[] = []
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i]
        const src = sources.find((s) => s.id === req.sourceId)
        setStatus(`Building ${i + 1}/${requests.length}: ${src?.name ?? req.sourceId}...`)
        const data = await sourceData(req.sourceId)
        if (!data) {
          skipped.push(`${src?.name ?? req.sourceId} (could not be loaded)`)
          continue
        }
        const batch = await buildDeliveryFiles(data.project, data.assets, {
          label: src?.name,
          mip: req.mip,
          variants: req.variantIds.length > 0,
          variantIds: req.variantIds,
          sip: req.sip,
          runtimeSrc,
        })
        delivered.push(...batch.files)
        skipped.push(...batch.skipped)
      }
      const allFiles: ApplovinFile[] = delivered.map((f) => ({ name: f.name, text: f.text, iteration: f.iteration }))
      if (!allFiles.length) {
        setStatus('Nothing to upload. ' + (skipped.length ? `Skipped: ${skipped.join(', ')}` : 'Every output is over the 5 MB limit.'))
        return
      }
      setBuilt(delivered)
      setStatus(`Prepared ${allFiles.length} file(s).` + (skipped.length ? ` Skipped ${skipped.length} over-limit output(s): ${skipped.join(', ')}` : ''))

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
        } else if (!result.files) {
          // No file input was filled: almost always the login page rather than the form.
          setAlStatus('No upload form found on the page. Click "Open / log in", sign in to AppLovin, then upload again.')
        } else {
          setAlStatus(
            `Filled ${result.files} file(s)` +
              (result.submitted ? ' and submitted. Waiting for the preview links...' : '. Click Upload in the AppLovin window; waiting for the preview links...'),
          )
          const wait = await applovinWaitForLinks({ mark: PREVIEW_LINK_MARK, expected: allFiles.length })
          const matched = matchPreviewLinks(allFiles, wait.links ?? [])
          const found = matched.filter((f) => f.link).length
          if (found) {
            setAlLinks(matched)
            setAlLinksFresh(true)
            saveLastLinks(linksKey, matched)
          }
          setAlStatus(
            found === allFiles.length
              ? `Uploaded. ${found} preview link${found === 1 ? '' : 's'} below — the Slack post is ready to copy.`
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

  const hasLinks = (alLinks ?? []).some((f) => f.link)

  return (
    <Modal title={title} onClose={props.onClose} size="md">
      <button className="primary wide" disabled={busy || !fileCount} onClick={() => void runUpload()}>
        <Icon icon={Upload} size={14} /> {busy ? 'Uploading...' : `Upload ${fileCount} file${fileCount === 1 ? '' : 's'} to AppLovin`}
      </button>
      {status && <div className="hint pad">{status}</div>}
      {alStatus && <div className="figma-status">{alStatus}</div>}

      <div className="group-title">Files</div>
      <div className="up-plan">
        {plan.map((g) => {
          const keys = g.items.map((i) => i.key)
          const on = keys.filter((k) => picks.has(k)).length
          return (
            <div key={g.id} className="up-group">
              <div className="up-group-head">
                <Checkbox
                  label={<strong>{g.name}</strong>}
                  checked={on === keys.length}
                  onChange={(v) => setPicked(keys, v)}
                  title={on === keys.length ? 'Untick every file of this playable' : 'Tick every file of this playable'}
                />
                <span className="spacer" />
                <span className="hint">
                  {on}/{keys.length}
                </span>
                {sources.length > 1 && (
                  <button className="link-btn" onClick={() => dropSource(g.id)} title="Take this playable out of the batch">
                    Remove
                  </button>
                )}
              </div>
              <div className="up-files">
                {g.items.map((i) => (
                  <Checkbox
                    key={i.key}
                    label={
                      <>
                        {i.label} <span className="hint">{i.fileName}</span>
                      </>
                    }
                    checked={picks.has(i.key)}
                    onChange={(v) => setPicked([i.key], v)}
                    title={i.fileName}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {addable.length > 0 && (
        <>
          <button className="link-btn" onClick={() => setAddOpen((v) => !v)}>
            {addOpen ? 'Hide other playables' : 'Add another playable to this batch'}
          </button>
          {addOpen && (
            <div className="up-add">
              {addable.map((p) => (
                <button key={p.id} onClick={() => addSource(p.id)} title="Add it to this upload">
                  + {p.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {hasLinks && (
        <>
          <div className="group-title">{alLinksFresh ? 'Preview links' : 'Last upload’s preview links'}</div>
          <div className="up-links">
            {(alLinks ?? []).map((f) => (
              <div key={f.name} className="up-link" title={f.name}>
                <span className="up-link-name">{f.iteration || f.name}</span>
                {f.link ? (
                  <>
                    <input className="text-input" readOnly value={f.link} />
                    <button onClick={() => copyText(f.link!)} title="Copy this link">
                      <Icon icon={Copy} size={13} />
                    </button>
                    <button onClick={() => window.open(f.link, '_blank')}>Open</button>
                  </>
                ) : (
                  <span className="hint">No link found</span>
                )}
              </div>
            ))}
          </div>

          <div className="group-title">Slack post</div>
          <Row label="Theme">
            <input className="text-input" value={theme} onChange={(e) => setThemeEdit(e.target.value)} placeholder="Halloween" />
          </Row>
          <Row label="Mentions">
            <input
              className="text-input"
              value={mentions}
              onChange={(e) => {
                setMentions(e.target.value)
                localStorage.setItem('pa:slackMentions', e.target.value)
              }}
            />
          </Row>
          <pre className="up-slack">{slackText}</pre>
          <button
            className="wide"
            onClick={() => {
              void copySlackPost(slackInput).then((ok) => setCopied(ok))
            }}
          >
            <Icon icon={Copy} size={13} /> {copied ? 'Copied — paste into Slack' : 'Copy for Slack'}
          </button>
          <div className="hint pad">Pasted into Slack, the word “Applovin” carries the preview link. A plain-text paste spells the link out instead.</div>
        </>
      )}

      <div className="group-title">Targets</div>
      <Toggle
        label="AppLovin"
        checked={appLovinOn}
        onChange={(v) => {
          setAppLovinOn(v)
          localStorage.setItem('pa:uploadAl', v ? 'on' : 'off')
        }}
      />
      <Toggle
        label="File server"
        checked={fileServerOn}
        onChange={(v) => {
          setFileServerOn(v)
          localStorage.setItem('pa:uploadFs', v ? 'on' : 'off')
        }}
      />

      {appLovinOn && (
        <>
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
          <Toggle
            label="Click Upload on the page automatically"
            checked={alSubmit}
            onChange={(v) => {
              setAlSubmit(v)
              localStorage.setItem('pa:applovinSubmit', v ? 'on' : 'off')
            }}
          />
          <div className="grid2">
            <button onClick={() => void applovinOpen(alUrl)}>Open / log in</button>
            <button onClick={() => void detectOne(alUrl, alAddText, alUploadText, setAlStatus)}>Detect form</button>
          </div>
          {!hasLinks && alPage && <div className="hint pad">Result page: {alPage}</div>}
          <button className="link-btn" onClick={() => setAlAdvanced((v) => !v)}>
            {alAdvanced ? 'Hide' : 'Form button text'}
          </button>
          {alAdvanced && (
            <div className="grid2">
              <label className="field">
                <span>Add row button</span>
                <input
                  className="text-input"
                  value={alAddText}
                  onChange={(e) => {
                    setAlAddText(e.target.value)
                    localStorage.setItem('pa:applovinAdd', e.target.value)
                  }}
                />
              </label>
              <label className="field">
                <span>Upload button</span>
                <input
                  className="text-input"
                  value={alUploadText}
                  onChange={(e) => {
                    setAlUploadText(e.target.value)
                    localStorage.setItem('pa:applovinUpload', e.target.value)
                  }}
                />
              </label>
            </div>
          )}
        </>
      )}

      {fileServerOn && (
        <>
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
              <button onClick={() => copyText(fuLink)}>
                <Icon icon={Copy} size={13} /> Copy link
              </button>
            </div>
          )}
          {!fuLink && fuPage && <div className="hint pad">Result page: {fuPage}</div>}
          <button className="link-btn" onClick={() => setFuAdvanced((v) => !v)}>
            {fuAdvanced ? 'Hide' : 'Advanced'}
          </button>
          {fuAdvanced && (
            <div className="grid2">
              <label className="field">
                <span>Add row button</span>
                <input
                  className="text-input"
                  value={fuAddText}
                  onChange={(e) => {
                    setFuAddText(e.target.value)
                    localStorage.setItem('pa:fileUploadAdd', e.target.value)
                  }}
                />
              </label>
              <label className="field">
                <span>Upload button</span>
                <input
                  className="text-input"
                  value={fuUploadText}
                  onChange={(e) => {
                    setFuUploadText(e.target.value)
                    localStorage.setItem('pa:fileUploadSubmit', e.target.value)
                  }}
                />
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
        </>
      )}
    </Modal>
  )
}
