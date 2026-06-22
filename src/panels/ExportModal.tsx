// Export modal — optimize assets, see the live size budget + blur warnings,
// pick networks, and download single-file playables (zip where required).

import { useEffect, useState } from 'react'
import {
  blurWarnings,
  buildOutputs,
  downloadBlob,
  fmtBytes,
  MAX_BYTES,
  NETWORKS,
  processAssets,
  pruneAssets,
  type AssetReport,
} from '../export'
import { useEditorState } from '../store'
import { applyVariant, stripVariants } from '../variants'
import { applovinOpen, applovinUpload, canApplovin, type ApplovinFile } from '../bridge'
import { Modal, Slider, Toggle } from '../ui'
import { AlertTriangle, Icon } from '../icons'
import { FlowPreview } from '../preview/FlowPreview'
import type { Project } from '../../runtime/scene'
import type { AssetMap } from '../../runtime/types'

const slug = (s: string): string => s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'variant'

export function ExportModal(props: { onClose: () => void }): JSX.Element {
  const { project, assets } = useEditorState()
  const [optimize, setOptimize] = useState(true)
  const [quality, setQuality] = useState(82)
  const [nets, setNets] = useState<Set<string>>(() => new Set(['AppLovin']))
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<AssetReport[]>([])
  const [proc, setProc] = useState<AssetMap>(assets)
  const [baseBytes, setBaseBytes] = useState(0)
  const [warns, setWarns] = useState<string[]>([])
  const [srcBusy, setSrcBusy] = useState(false)
  const variants = project.meta.variants ?? []
  const [selVars, setSelVars] = useState<Set<string>>(() => new Set(variants.map((v) => v.id)))
  const [alUrl, setAlUrl] = useState(() => localStorage.getItem('pa:applovinUrl') || 'http://167.99.227.249/wp-login.php?redirect_to=%2F')
  const [alSubmit, setAlSubmit] = useState(false)
  const [alBusy, setAlBusy] = useState(false)
  const [alStatus, setAlStatus] = useState<string | null>(null)

  // recompute size/optimization preview when options change
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    void (async () => {
      const { assets: out, report } = await processAssets(pruneAssets(project, assets), optimize, quality / 100)
      if (cancelled) return
      const { baseBytes } = buildOutputs(project, out, [{ name: 'base', tag: 'base' }])
      setProc(out)
      setReport(report)
      setBaseBytes(baseBytes)
      setWarns(blurWarnings(project, out))
      setBusy(false)
    })()
    return () => {
      cancelled = true
    }
  }, [assets, project, optimize, quality])

  const pct = Math.min(100, (baseBytes / MAX_BYTES) * 100)
  const over = baseBytes > MAX_BYTES

  // Export one project (base or a variant) for the selected networks.
  const exportOne = async (proj: Project, name: string): Promise<void> => {
    const { assets: out } = await processAssets(pruneAssets(proj, assets), optimize, quality / 100)
    const named: Project = { ...proj, meta: { ...proj.meta, name } }
    const { outputs } = buildOutputs(named, out, NETWORKS.filter((n) => nets.has(n.name)))
    for (const o of outputs) {
      if (o.over) {
        alert(`${o.net} (${name}) is ${fmtBytes(o.bytes)}, over the 5MB limit. Optimize assets or shrink the endcard.`)
        continue
      }
      downloadBlob(o.filename, await o.make())
    }
  }

  const baseName = project.meta.name || 'playable'
  const doExportAll = async (): Promise<void> => {
    setBusy(true)
    try {
      await exportOne(stripVariants(project), baseName)
      for (const v of variants.filter((x) => selVars.has(x.id))) await exportOne(applyVariant(project, v), `${baseName}_${slug(v.name)}`)
    } finally {
      setBusy(false)
    }
  }

  // Build the AppLovin HTML for base + selected variants, for the auto-uploader.
  const buildUploadBatch = async (): Promise<ApplovinFile[]> => {
    const al = NETWORKS.find((n) => n.name === 'AppLovin') ?? NETWORKS[0]
    const out: ApplovinFile[] = []
    const one = async (proj: Project, name: string, iteration: string): Promise<void> => {
      const { assets: a } = await processAssets(pruneAssets(proj, assets), optimize, quality / 100)
      const named: Project = { ...proj, meta: { ...proj.meta, name } }
      const { outputs } = buildOutputs(named, a, [al])
      const o = outputs[0]
      if (!o || o.over) {
        if (o?.over) alert(`${name} is ${fmtBytes(o.bytes)}, over the 5MB limit — skipped.`)
        return
      }
      out.push({ name: o.filename, text: await (await o.make()).text(), iteration })
    }
    await one(stripVariants(project), baseName, project.meta.mip || baseName)
    for (const v of variants.filter((x) => selVars.has(x.id))) await one(applyVariant(project, v), `${baseName}_${slug(v.name)}`, v.name)
    return out
  }

  const doApplovin = async (): Promise<void> => {
    setAlBusy(true)
    setAlStatus('Building playables…')
    try {
      const files = await buildUploadBatch()
      if (!files.length) {
        setAlStatus('Nothing to upload (all over budget?).')
        return
      }
      setAlStatus('Filling the upload form…')
      const r = await applovinUpload({ url: alUrl, files, submit: alSubmit })
      setAlStatus(r.ok ? `Filled ${r.files} file(s)${r.submitted ? ' and submitted.' : ' — review the window and click Upload.'}` : 'Error: ' + r.error)
    } catch (e) {
      setAlStatus('Error: ' + (e as Error).message)
    } finally {
      setAlBusy(false)
    }
  }

  const doExport = async (): Promise<void> => {
    const selected = NETWORKS.filter((n) => nets.has(n.name))
    const { outputs } = buildOutputs(project, proc, selected)
    for (const o of outputs) {
      if (o.over) {
        alert(`${o.net} is ${fmtBytes(o.bytes)}, over the 5MB limit. Optimize assets or shrink the endcard.`)
        continue
      }
      downloadBlob(o.filename, await o.make())
    }
  }

  return (
    <Modal title="Export playable" onClose={props.onClose} size="md">
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

      <Toggle label="Optimize images → WebP" checked={optimize} onChange={setOptimize} />
      {optimize && <Slider label="Quality" value={quality} min={50} max={100} suffix="%" onChange={setQuality} />}

      {/* assets */}
      <div className="group-title">Assets ({report.length})</div>
      <div className="asset-list">
        {report.map((r) => (
          <div className="asset-row" key={r.id}>
            <span className="a-id">{r.id}</span>
            <span className="a-dim">{r.w}×{r.h}</span>
            <span className="a-bytes">{fmtBytes(r.bytes)}</span>
            {r.optimized && <span className="a-tag ok">webp</span>}
            {r.remote && <span className="a-tag warn">remote</span>}
          </div>
        ))}
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

      <button className="primary wide" disabled={busy || !nets.size} onClick={() => void doExport()}>
        Export {nets.size} {nets.size === 1 ? 'file' : 'files'}
      </button>
      <div className="hint pad">Single self-contained HTML per network (zipped where the network requires it). Exports download to your browser; the desktop app saves to disk.</div>

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
        <b>npm run dev</b> and edit <b>src/runtime/games/</b> to customize gameplay mechanics. Optional — not needed for ad delivery.
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
            <button className="primary" disabled={alBusy} onClick={() => void doApplovin()}>
              {alBusy ? 'Filling…' : `Auto-fill (${1 + (variants.length ? selVars.size : 0)})`}
            </button>
          </div>
          {alStatus && <div className="figma-status">{alStatus}</div>}
          <div className="hint pad">
            First click <b>Open / log in</b>, sign in and open the <b>Upload File</b> page. Then <b>Auto-fill</b> drops your base +
            selected variants into the batch form (one row each; Iteration Name = variant). Review and click Upload, or enable
            auto-submit. Uploads the AppLovin (MRAID) build of each.
          </div>
        </>
      )}
    </Modal>
  )
}
