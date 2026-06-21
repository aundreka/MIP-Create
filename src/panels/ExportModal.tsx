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
import { Modal, Slider, Toggle } from '../ui'
import { AlertTriangle, Icon } from '../icons'
import { FlowPreview } from '../preview/FlowPreview'
import type { AssetMap } from '../../runtime/types'

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
    </Modal>
  )
}
