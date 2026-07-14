// Export modal — optimize assets, see the live size budget + blur warnings,
// pick networks, and download single-file playables (zip where required).

import { useEffect, useMemo, useState } from 'react'
import {
  blurWarnings,
  buildBaseHtml,
  buildOutputs,
  downloadBlob,
  fetchRuntimeSrc,
  fmtBytes,
  MAX_BYTES,
  NETWORKS,
  processAssetsAutoFit,
  pruneAssets,
  transformForNetwork,
  DEFAULT_MEDIA,
  type AssetReport,
  type MediaDefaults,
} from '../export'
import { preflightNetwork, type PreflightResult } from '../preflight'
import { lintEngagement, type EngagementFinding } from '../qa/engagement'
import { setAssetCompress, useEditorState } from '../store'
import { applyVariant, stripVariants } from '../variants'
import { fileBaseName } from '../mipName'
import { applovinOpen, applovinProbe, applovinUpload, canApplovin, compressHtmlScript, type ApplovinFile } from '../bridge'
import { Modal, NumField, Slider, Toggle } from '../ui'
import { AlertTriangle, Check, Icon } from '../icons'
import { FlowPreview } from '../preview/FlowPreview'
import type { Project } from '../../runtime/scene'
import type { AssetMap, CompressProfile } from '../../runtime/types'

/** Compact ffmpeg knobs for one profile (global default or per-asset). */
function CompressFields(props: { kind: 'video' | 'audio'; value: CompressProfile; onChange: (p: CompressProfile) => void }): JSX.Element {
  const v = props.value
  const up = (patch: Partial<CompressProfile>): void => {
    const next: Record<string, unknown> = { ...v, ...patch }
    for (const k of Object.keys(next)) {
      const x = next[k]
      if (x === undefined || x === '' || (typeof x === 'number' && Number.isNaN(x))) delete next[k]
    }
    props.onChange(next as CompressProfile)
  }
  return (
    <div className="compress-fields">
      {props.kind === 'video' && (
        <div className="grid2">
          <NumField label="Max width (px)" value={v.scale ?? 720} min={16} step={2} onChange={(n) => up({ scale: n })} />
          <NumField label="CRF (0–51)" value={v.crf ?? 28} min={0} max={51} step={1} onChange={(n) => up({ crf: n })} />
          <label className="field">
            <span>Max bitrate</span>
            <input className="text-input" value={v.maxrate ?? ''} placeholder="536k" onChange={(e) => up({ maxrate: e.target.value || undefined })} />
          </label>
          <label className="field">
            <span>Buffer</span>
            <input className="text-input" value={v.bufsize ?? ''} placeholder="1000k" onChange={(e) => up({ bufsize: e.target.value || undefined })} />
          </label>
        </div>
      )}
      <div className="grid2">
        <NumField label="Audio (kbps)" value={v.audioKbps ?? 96} min={16} max={320} step={2} onChange={(n) => up({ audioKbps: n })} />
        <NumField label="Trim to (sec, 0=keep)" value={v.durationS ?? 0} min={0} step={1} onChange={(n) => up({ durationS: n > 0 ? n : undefined })} />
      </div>
    </div>
  )
}

const slug = (s: string): string => s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'variant'

export function ExportModal(props: { onClose: () => void }): JSX.Element {
  const { project, assets } = useEditorState()
  const [optimize, setOptimize] = useState(true)
  const [quality, setQuality] = useState(82)
  const [vid, setVid] = useState<CompressProfile>(() => {
    try { return { ...DEFAULT_MEDIA.video, ...JSON.parse(localStorage.getItem('pa:vidCompress') || '{}') } } catch { return { ...DEFAULT_MEDIA.video } }
  })
  const [aud, setAud] = useState<CompressProfile>(() => {
    try { return { ...DEFAULT_MEDIA.audio, ...JSON.parse(localStorage.getItem('pa:audCompress') || '{}') } } catch { return { ...DEFAULT_MEDIA.audio } }
  })
  const [openRow, setOpenRow] = useState<string | null>(null)
  const media = useMemo<MediaDefaults>(() => ({ video: vid, audio: aud }), [vid, aud])
  const hasVideo = useMemo(() => Object.values(assets).some((a) => a.kind === 'video'), [assets])
  const hasAudio = useMemo(() => Object.values(assets).some((a) => a.kind === 'audio'), [assets])
  useEffect(() => {
    localStorage.setItem('pa:vidCompress', JSON.stringify(vid))
    localStorage.setItem('pa:audCompress', JSON.stringify(aud))
  }, [vid, aud])
  const [nets, setNets] = useState<Set<string>>(() => new Set(['AppLovin']))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [report, setReport] = useState<AssetReport[]>([])
  const [proc, setProc] = useState<AssetMap>(assets)
  const [baseBytes, setBaseBytes] = useState(0)
  const [warns, setWarns] = useState<string[]>([])
  const [autoQ, setAutoQ] = useState<number | null>(null)
  const [srcBusy, setSrcBusy] = useState(false)
  const variants = project.meta.variants ?? []
  const [selVars, setSelVars] = useState<Set<string>>(() => new Set(variants.map((v) => v.id)))
  const [alUrl, setAlUrl] = useState(() => localStorage.getItem('pa:applovinUrl') || 'http://167.99.227.249/wp-login.php?redirect_to=%2F')
  const [alAddText, setAlAddText] = useState(() => localStorage.getItem('pa:applovinAdd') || 'Add Another Upload')
  const [alUploadText, setAlUploadText] = useState(() => localStorage.getItem('pa:applovinUpload') || 'Upload')
  const [alSubmit, setAlSubmit] = useState(false)
  const [alAdvanced, setAlAdvanced] = useState(false)
  const [alBusy, setAlBusy] = useState(false)
  const [alStatus, setAlStatus] = useState<string | null>(null)
  const alSelectors = { addButtonText: alAddText, uploadButtonText: alUploadText }
  // Shared runtime snapshot: set by the preview effect, reused by doExportAll so
  // both compute sizes with the same runtime binary (avoids a 0.5 MB gap when the
  // runtime is rebuilt between the preview run and the export click).
  const [previewRuntimeSrc, setPreviewRuntimeSrc] = useState<string | null>(null)

  // recompute size/optimization preview when options change
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setErr(null)
    void (async () => {
      try {
        const runtimeSrc = await fetchRuntimeSrc()
        if (cancelled) return
        // Use the stripped project (no variants JSON) so the size displayed here
        // matches the base export exactly — variants are stripped at export time too.
        const stripped = stripVariants(project)
        const { assets: out, report, quality: usedQ } = await processAssetsAutoFit(
          pruneAssets(stripped, assets), optimize, quality / 100, media, stripped, runtimeSrc,
        )
        if (cancelled) return
        const { baseBytes } = buildOutputs(stripped, out, [{ name: 'base', tag: 'base' }], runtimeSrc)
        setPreviewRuntimeSrc(runtimeSrc)
        setProc(out)
        setReport(report)
        setBaseBytes(baseBytes)
        setAutoQ(Math.round(usedQ * 100) < quality ? Math.round(usedQ * 100) : null)
        setWarns(blurWarnings(project, out))
      } catch (e) {
        if (!cancelled) setErr('Could not process assets (compression may have failed): ' + String(e))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [assets, project, optimize, quality, media])

  const pct = Math.min(100, (baseBytes / MAX_BYTES) * 100)
  const over = baseBytes > MAX_BYTES

  // Per-network preflight on the actual output HTML (rejection-class checks).
  const preflights = useMemo<PreflightResult[]>(() => {
    if (busy) return []
    // Use the same stripped project + preview runtime as doExport so the per-network
    // byte counts here match the files that will actually be downloaded.
    const stripped = stripVariants(project)
    const base = buildBaseHtml(stripped, proc, previewRuntimeSrc ?? undefined)
    return NETWORKS.filter((n) => nets.has(n.name)).map((n) => {
      const html = transformForNetwork(base, n)
      return preflightNetwork(n, html, new Blob([html]).size, stripped)
    })
  }, [project, proc, nets, busy, previewRuntimeSrc])
  const preflightErrors = preflights.reduce((s, p) => s + p.errors, 0)
  // Single-MIP engagement review (is this ready to ship?) — folded into export.
  const review = useMemo<EngagementFinding[]>(() => lintEngagement(project, assets), [project, assets])
  const reviewErrors = review.filter((f) => f.severity === 'error').length
  const blockingErrors = preflightErrors + reviewErrors
  const confirmIfBlocked = (): boolean =>
    blockingErrors === 0 || confirm(`Review found ${blockingErrors} blocking issue(s) (network-rejection or no-interaction). Export anyway?`)

  // Export one project (base or a variant) for the selected networks.
  const exportOne = async (proj: Project, name: string, runtimeSrc: string): Promise<void> => {
    // Create `named` first so processAssetsAutoFit's checkBytes uses the EXACT
    // project that buildOutputs will use — eliminates any project-JSON discrepancy.
    const named: Project = { ...proj, meta: { ...proj.meta, name } }
    const { assets: out } = await processAssetsAutoFit(pruneAssets(proj, assets), optimize, quality / 100, media, named, runtimeSrc)
    const { outputs } = buildOutputs(named, out, NETWORKS.filter((n) => nets.has(n.name)), runtimeSrc)
    for (const o of outputs) downloadBlob(o.filename, await o.make())
  }

  // The exported file is always named "<Client>_<MIP>" — nothing else (no date,
  // no free-text rename). Variant files append "_<variant>" below.
  const baseName = fileBaseName(project.meta)
  const doExportAll = async (): Promise<void> => {
    if (!confirmIfBlocked()) return
    setBusy(true)
    try {
      const runtimeSrc = previewRuntimeSrc ?? await fetchRuntimeSrc()
      // Base: reuse proc (already compressed + measured) — no second processAssetsAutoFit.
      const stripped = stripVariants(project)
      const namedBase: Project = { ...stripped, meta: { ...stripped.meta, name: baseName } }
      const { outputs: baseOuts } = buildOutputs(namedBase, proc, NETWORKS.filter((n) => nets.has(n.name)), runtimeSrc)
      for (const o of baseOuts) downloadBlob(o.filename, await o.make())
      // Variants: re-process (different asset sets possible via patches).
      for (const v of variants.filter((x) => selVars.has(x.id))) await exportOne(applyVariant(project, v), `${baseName}_${slug(v.name)}`, runtimeSrc)
    } finally {
      setBusy(false)
    }
  }

  // Build the AppLovin HTML for base + selected variants, for the auto-uploader.
  const buildUploadBatch = async (): Promise<ApplovinFile[]> => {
    const al = NETWORKS.find((n) => n.name === 'AppLovin') ?? NETWORKS[0]
    const runtimeSrc = previewRuntimeSrc ?? await fetchRuntimeSrc()
    const out: ApplovinFile[] = []
    // Base: reuse proc (already compressed + measured).
    const stripped = stripVariants(project)
    const namedBase: Project = { ...stripped, meta: { ...stripped.meta, name: baseName } }
    const { outputs: baseOuts } = buildOutputs(namedBase, proc, [al], runtimeSrc)
    const baseO = baseOuts[0]
    if (!baseO || baseO.over) {
      if (baseO?.over) alert(`${baseName} is ${fmtBytes(baseO.bytes)}, over the 5MB limit; skipped.`)
    } else {
      out.push({ name: baseO.filename, text: await (await baseO.make()).text(), iteration: project.meta.mip || baseName })
    }
    // Variants: re-process (may have different asset sets via patches).
    const oneVariant = async (proj: Project, name: string, iteration: string): Promise<void> => {
      const named: Project = { ...proj, meta: { ...proj.meta, name } }
      const { assets: a } = await processAssetsAutoFit(pruneAssets(proj, assets), optimize, quality / 100, media, named, runtimeSrc)
      const { outputs } = buildOutputs(named, a, [al], runtimeSrc)
      const o = outputs[0]
      if (!o || o.over) {
        if (o?.over) alert(`${name} is ${fmtBytes(o.bytes)}, over the 5MB limit; skipped.`)
        return
      }
      out.push({ name: o.filename, text: await (await o.make()).text(), iteration })
    }
    for (const v of variants.filter((x) => selVars.has(x.id))) await oneVariant(applyVariant(project, v), `${baseName}_${slug(v.name)}`, v.name)
    return out
  }

  const doApplovin = async (): Promise<void> => {
    if (!confirmIfBlocked()) return
    setAlBusy(true)
    setAlStatus('Building playables…')
    try {
      const files = await buildUploadBatch()
      if (!files.length) {
        setAlStatus('Nothing to upload (all over budget?).')
        return
      }
      setAlStatus('Filling the upload form…')
      const r = await applovinUpload({ url: alUrl, files, submit: alSubmit, ...alSelectors })
      setAlStatus(r.ok ? `Filled ${r.files} file(s)${r.submitted ? ' and submitted.' : '. Review the window and click Upload.'}` : 'Error: ' + r.error)
    } catch (e) {
      setAlStatus('Error: ' + (e as Error).message)
    } finally {
      setAlBusy(false)
    }
  }

  // Non-destructive selector check against the open page.
  const doProbe = async (): Promise<void> => {
    setAlStatus('Detecting form…')
    const p = await applovinProbe({ url: alUrl, ...alSelectors })
    if (!p.ok) {
      setAlStatus('Detect failed: ' + (p.error ?? 'open the page first'))
      return
    }
    const ok = p.fileInputs && p.addButton
    setAlStatus(
      `${ok ? '✓' : '⚠'} ${p.title || p.url}: ${p.fileInputs} file input(s), ${p.textInputs} name field(s); ` +
        `Add button ${p.addButton ? '✓' : '✗'}, Upload button ${p.uploadButton ? '✓' : '✗'}.` +
        (ok ? '' : ' Open the Upload File page, or adjust the selectors below.'),
    )
  }

  const doExport = async (): Promise<void> => {
    if (!confirmIfBlocked()) return
    setBusy(true)
    setErr(null)
    try {
      const selected = NETWORKS.filter((n) => nets.has(n.name))
      // Reuse the preview runtime and stripped project so the downloaded file is
      // byte-for-byte what the modal measured (no variants JSON, same runtime binary).
      const runtimeSrc = previewRuntimeSrc ?? await fetchRuntimeSrc()
      const stripped = stripVariants(project)
      const named: Project = { ...stripped, meta: { ...stripped.meta, name: baseName } }
      const { outputs } = buildOutputs(named, proc, selected, runtimeSrc)
      for (const o of outputs) {
        let blob = await o.make()
        // Safety net: if the output is still over 5 MB, run it through the Python
        // compression script (strips any remaining fonts/WAV, recompresses WebP).
        // No-ops silently in the browser or when Python is not installed.
        if (o.over && !o.filename.endsWith('.zip')) {
          try {
            const html = await blob.text()
            const compressed = await compressHtmlScript(html)
            if (compressed) {
              const cb = new Blob([compressed], { type: 'text/html' })
              if (cb.size < blob.size) blob = cb
            }
          } catch { /* keep original */ }
        }
        downloadBlob(o.filename, blob)
      }
    } catch (e) {
      setErr('Export failed: ' + String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Export playable" onClose={props.onClose} size="md">
      {err && (
        <div className="warn-line" role="alert">
          <Icon icon={AlertTriangle} size={13} /> {err}
        </div>
      )}

      {/* flow preview — scenes + transitions of what you're exporting */}
      <div className="group-title">Flow · {project.scenes.length} {project.scenes.length === 1 ? 'scene' : 'scenes'}</div>
      <FlowPreview project={project} assets={proc} />

      {/* size meter */}
      <div className="size-meter">
        <div className="size-row">
          <span>Estimated size</span>
          <strong className={over ? 'danger' : ''}>
            {busy ? '…' : fmtBytes(baseBytes)} / 5 MB
          </strong>
        </div>
        <div className="bar-track">
          <div className={'bar-fill' + (over ? ' over' : '')} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <Toggle label="Optimize assets (WebP · end card · audio)" checked={optimize} onChange={setOptimize} />
      {optimize && <Slider label="Quality" value={quality} min={50} max={100} suffix="%" onChange={setQuality} />}
      {optimize && autoQ !== null && (
        <div className="hint pad">Auto-compressed images to {autoQ}% quality to fit 5 MB.</div>
      )}

      {/* video/audio compression (ffmpeg, desktop) */}
      {optimize && hasVideo && (
        <>
          <div className="group-title">Video compression</div>
          <CompressFields kind="video" value={vid} onChange={setVid} />
        </>
      )}
      {optimize && hasAudio && (
        <>
          <div className="group-title">Audio compression</div>
          <CompressFields kind="audio" value={aud} onChange={setAud} />
        </>
      )}
      {optimize && (hasVideo || hasAudio) && (
        <div className="hint pad">
          Re-encoded on export with ffmpeg (desktop). Lower CRF = sharper but bigger; Max bitrate caps peaks (e.g. <b>536k</b>);
          Trim cuts length. These are the defaults; give any clip its own recipe below.
        </div>
      )}

      {/* assets */}
      <div className="group-title">Assets ({report.length})</div>
      <div className="asset-list">
        {report.map((r) => {
          const a = assets[r.id]
          const isMedia = a?.kind === 'video' || a?.kind === 'audio'
          const has = !!a?.compress && Object.keys(a.compress).length > 0
          return (
            <div className="asset-row-wrap" key={r.id}>
              <div className="asset-row">
                <span className="a-id">{r.id}</span>
                <span className="a-dim">{r.w}×{r.h}</span>
                <span className="a-bytes">{fmtBytes(r.bytes)}</span>
                {r.optimized && <span className="a-tag ok">{isMedia ? a.kind : 'webp'}</span>}
                {r.remote && <span className="a-tag warn">remote</span>}
                {isMedia && (
                  <button type="button" className={'a-tag btn' + (has ? ' on' : '')} onClick={() => setOpenRow(openRow === r.id ? null : r.id)} title="Per-asset compression">
                    {has ? 'custom ⚙' : '⚙'}
                  </button>
                )}
              </div>
              {isMedia && openRow === r.id && (
                <div className="asset-compress">
                  <CompressFields kind={a.kind === 'audio' ? 'audio' : 'video'} value={a.compress ?? {}} onChange={(p) => setAssetCompress(r.id, p)} />
                  {has && (
                    <button type="button" className="link-btn" onClick={() => setAssetCompress(r.id, undefined)}>
                      Reset to default
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {!report.length && <div className="hint pad">No image/audio assets; chrome-only playable.</div>}
      </div>

      {/* warnings */}
      {warns.map((w, i) => (
        <div className="warn-line" key={i}>
          <Icon icon={AlertTriangle} size={13} /> {w}
        </div>
      ))}

      {/* networks */}
      <div className="group-title">Ad networks</div>
      <div className="net-grid">
        {NETWORKS.map((n) => (
          <button
            key={n.name}
            type="button"
            className={'net-chip' + (nets.has(n.name) ? ' on' : '')}
            aria-pressed={nets.has(n.name)}
            onClick={() => {
              const next = new Set(nets)
              next.has(n.name) ? next.delete(n.name) : next.add(n.name)
              setNets(next)
            }}
          >
            {n.name}
            {n.zip && <em> .zip</em>}
          </button>
        ))}
      </div>

      {/* review — single-MIP engagement check (folded-in QA gate) */}
      <div className="group-title">Review</div>
      {review.length > 0 ? (
        <div className="preflight">
          {review.map((f) => (
            <div className={'preflight-line ' + f.severity} key={f.id}>
              {f.sceneName ? <b>{f.sceneName}: </b> : null}
              {f.message}
            </div>
          ))}
        </div>
      ) : (
        <div className="preflight-line info">No engagement issues found.</div>
      )}

      {/* preflight — rejection-class checks per selected network */}
      {preflights.length > 0 && (
        <div className="preflight">
          {preflights.map((p) => (
            <div className="preflight-net" key={p.tag}>
              <div className="preflight-head">
                {p.errors ? (
                  <span className="pf-badge err"><Icon icon={AlertTriangle} size={12} /> {p.errors}</span>
                ) : p.warns ? (
                  <span className="pf-badge warn"><Icon icon={AlertTriangle} size={12} /> {p.warns}</span>
                ) : (
                  <span className="pf-badge ok"><Icon icon={Check} size={12} strokeWidth={3} /></span>
                )}
                <b>{p.net}</b>
                <span className="hint">{fmtBytes(p.bytes)} / {fmtBytes(p.max)}</span>
              </div>
              {p.findings.map((f, i) => (
                <div className={'preflight-line ' + f.level} key={i}>{f.message}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      <button className="primary wide" disabled={busy || !nets.size} onClick={() => void doExport()}>
        Export {nets.size} {nets.size === 1 ? 'file' : 'files'}
      </button>
      <div className="hint pad">
        Single self-contained HTML per network (zipped where the network requires it). Exports download to your browser; the
        desktop app saves to disk. Preflight above flags rejection-class issues per network before you ship.
      </div>

      {variants.length > 0 && (
        <>
          <div className="group-title">Variants ({variants.length})</div>
          <div className="net-grid">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={'net-chip' + (selVars.has(v.id) ? ' on' : '')}
                aria-pressed={selVars.has(v.id)}
                onClick={() => {
                  const next = new Set(selVars)
                  next.has(v.id) ? next.delete(v.id) : next.add(v.id)
                  setSelVars(next)
                }}
              >
                {v.name}
              </button>
            ))}
          </div>
          <button className="primary wide" disabled={busy || !nets.size} onClick={() => void doExportAll()}>
            Export base + {selVars.size} {selVars.size === 1 ? 'variant' : 'variants'} × {nets.size} {nets.size === 1 ? 'network' : 'networks'}
          </button>
          <div className="hint pad">Emits one playable per variant per selected network, named “{baseName}_variant_network”. Languages stay inside each file (auto-detected at runtime).</div>
        </>
      )}

      <div className="group-title">Developer export</div>
      <button
        className="wide"
        disabled={srcBusy}
        onClick={() => {
          setSrcBusy(true)
          void import('../viteExport')
            .then((m) => m.exportViteProject(project, assets))
            .finally(() => setSrcBusy(false))
        }}
      >
        {srcBusy ? 'Building…' : 'Download Vite project (source).zip'}
      </button>
      <div className="hint pad">
        A runnable Vite + TypeScript repo with the full runtime source, your project and assets. Devs run <b>npm install</b> then{' '}
        <b>npm run dev</b> and edit <b>src/runtime/games/</b> to customize gameplay mechanics. Optional; not needed for ad delivery.
      </div>

      {canApplovin && (
        <>
          <div className="group-title">Upload to AppLovin</div>
          <label className="field">
            <span>Upload site URL</span>
            <input
              className="text-input"
              value={alUrl}
              onChange={(e) => {
                setAlUrl(e.target.value)
                localStorage.setItem('pa:applovinUrl', e.target.value)
              }}
            />
          </label>
          <Toggle label="Submit automatically (otherwise it fills the form and you click Upload)" checked={alSubmit} onChange={setAlSubmit} />
          <div className="grid2">
            <button onClick={() => void applovinOpen(alUrl)}>Open / log in</button>
            <button onClick={() => void doProbe()}>Detect form</button>
          </div>
          <button className="primary wide" disabled={alBusy} onClick={() => void doApplovin()}>
            {alBusy ? 'Filling…' : `Auto-fill upload form (${1 + (variants.length ? selVars.size : 0)})`}
          </button>
          {alStatus && <div className="figma-status">{alStatus}</div>}
          <button className="link-btn" onClick={() => setAlAdvanced((v) => !v)}>{alAdvanced ? 'Hide' : 'Form selectors'}</button>
          {alAdvanced && (
            <div className="grid2">
              <label className="field">
                <span>“Add row” button text</span>
                <input className="text-input" value={alAddText} onChange={(e) => { setAlAddText(e.target.value); localStorage.setItem('pa:applovinAdd', e.target.value) }} />
              </label>
              <label className="field">
                <span>“Upload” button text</span>
                <input className="text-input" value={alUploadText} onChange={(e) => { setAlUploadText(e.target.value); localStorage.setItem('pa:applovinUpload', e.target.value) }} />
              </label>
            </div>
          )}
          <div className="hint pad">
            First click <b>Open / log in</b>, sign in and open the <b>Upload File</b> page. Use <b>Detect form</b> to confirm the
            page matches (file inputs + buttons); adjust the selectors if not. Then <b>Auto-fill</b> drops your base + selected
            variants into the batch form (one row each; Iteration Name = variant). Review and click Upload, or enable auto-submit.
            Uploads the AppLovin (MRAID) build of each.
          </div>
        </>
      )}
    </Modal>
  )
}
