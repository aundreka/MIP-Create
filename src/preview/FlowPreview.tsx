// Flow preview — a storyboard of every scene (live static thumbnails) with the
// transition + advance rule shown between them, plus an optional full-flow player
// that runs the project with transitions in motion. Both run the real runtime in
// an <iframe>, so this is a faithful preview of what will be exported. Used by the
// export modal (fed the optimized assets) and reusable elsewhere.

import { Fragment, useEffect, useRef, useState } from 'react'
import type { Project, Scene, SceneDef, Transition } from '../../runtime/scene'
import type { AssetMap } from '../../runtime/types'
import { ChevronRight, Icon, LayoutGrid, Play, RotateCcw, SCENE_KIND_ICON, Star, X } from '../icons'

function toScene(project: Project, def: SceneDef): Scene {
  return { meta: { ...project.meta, bgMatchColor: def.bgColor !== undefined ? def.bgColor : project.meta.bgMatchColor }, elements: def.elements, kind: def.kind, overlay: def.overlay }
}

function advanceLabel(project: Project, def: SceneDef): string {
  const r = def.advance
  const base =
    r.on === 'gameWin' ? 'on game win' : r.on === 'timer' ? `after ${r.delayMs ?? 2000}ms` : r.on === 'tap' ? 'on tap' : 'stays (manual)'
  if (r.on === 'manual') return base
  const idx = project.scenes.findIndex((s) => s.id === def.id)
  const nextId = project.scenes[idx + 1]?.id
  if (r.to && r.to !== nextId) return `${base} → ${project.scenes.find((s) => s.id === r.to)?.name ?? '?'}`
  if (!nextId) return `${base} → end`
  return base
}

function transLabel(t?: Transition): string {
  if (!t || t.type === 'none') return 'cut'
  return `${t.type.replace('slide-', 'slide ')} · ${t.durationMs}ms`
}

// One scene, rendered statically (pa:render) and scaled down to a thumbnail.
function SceneThumb(props: { project: Project; def: SceneDef; assets: AssetMap; h: number }): JSX.Element {
  const { project, def, assets, h } = props
  const ref = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const aspect = (project.meta.baseW || 1080) / (project.meta.baseH || 1920)
  const IH = 600
  const IW = Math.round(IH * aspect)
  const scale = h / IH
  const post = (): void => {
    ref.current?.contentWindow?.postMessage({ type: 'pa:render', scene: toScene(project, def), assets, interactive: false }, '*')
  }
  useEffect(() => {
    if (ready.current) post()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, assets, def])
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.source === ref.current?.contentWindow && (e.data as { type?: string })?.type === 'pa:ready') {
        ready.current = true
        post()
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="flow-thumb" style={{ width: IW * scale, height: h }}>
      <iframe
        ref={ref}
        src="./runtime-frame.html"
        title={def.name}
        onLoad={post}
        style={{ width: IW, height: IH, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none' }}
      />
    </div>
  )
}

// The whole project flow, interactive, with transitions in motion.
function FlowPlayer(props: { project: Project; assets: AssetMap; replayKey: number; w: number; h: number; maxW: number; maxH: number }): JSX.Element {
  const { project, assets, replayKey, w, h, maxW, maxH } = props
  const ref = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const post = (): void => {
    ref.current?.contentWindow?.postMessage({ type: 'pa:play', project, assets }, '*')
  }
  useEffect(() => {
    if (ready.current) post()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, assets, replayKey])
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.source === ref.current?.contentWindow && (e.data as { type?: string })?.type === 'pa:ready') {
        ready.current = true
        post()
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const scale = Math.min(maxW / w, maxH / h, 1)
  return (
    <div className="device-shell" style={{ width: w * scale, height: h * scale }}>
      <iframe ref={ref} title="flow" onLoad={post} style={{ width: w, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }} src="./runtime-frame.html" />
    </div>
  )
}

export function FlowPreview(props: { project: Project; assets: AssetMap }): JSX.Element {
  const { project, assets } = props
  const [playing, setPlaying] = useState(false)
  const [replay, setReplay] = useState(0)
  const w = project.meta.baseW || 1080
  const h = project.meta.baseH || 1920

  return (
    <div className="flow-preview">
      <div className="flow-strip">
        {project.scenes.map((def, i) => (
          <Fragment key={def.id}>
            {i > 0 && (
              <div className="flow-trans" title="transition into this scene">
                <span className="flow-arrow">
                  <Icon icon={ChevronRight} size={16} />
                </span>
                <span className="flow-trans-label">{transLabel(def.transition)}</span>
              </div>
            )}
            <div className={'flow-card' + (def.id === project.startSceneId ? ' start' : '')}>
              <SceneThumb project={project} def={def} assets={assets} h={150} />
              <div className="flow-card-meta">
                <span className="flow-name">
                  {def.id === project.startSceneId && (
                    <span className="flow-star">
                      <Icon icon={Star} size={11} fill="currentColor" />
                    </span>
                  )}
                  <Icon icon={SCENE_KIND_ICON[def.kind ?? 'custom'] ?? LayoutGrid} size={12} /> {def.name}
                </span>
                <span className="flow-adv">{advanceLabel(project, def)}</span>
              </div>
            </div>
          </Fragment>
        ))}
      </div>
      <div className="flow-actions">
        {!playing ? (
          <button onClick={() => { setPlaying(true); setReplay((r) => r + 1) }}>
            <Icon icon={Play} size={14} /> Play full flow with transitions
          </button>
        ) : (
          <>
            <button onClick={() => setReplay((r) => r + 1)}>
              <Icon icon={RotateCcw} size={14} /> Replay
            </button>
            <button onClick={() => setPlaying(false)}>
              <Icon icon={X} size={14} /> Stop
            </button>
            <span className="hint">Tap inside the frame to advance scenes / play games.</span>
          </>
        )}
      </div>
      {playing && (
        <div className="flow-player">
          <FlowPlayer project={project} assets={assets} replayKey={replay} w={w} h={h} maxW={300} maxH={520} />
        </div>
      )}
    </div>
  )
}
