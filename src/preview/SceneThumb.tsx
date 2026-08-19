// A single scene rendered statically (pa:render) in an isolated iframe, as a
// thumbnail. Re-renders only when its own SceneDef identity, the asset map, or its
// size changes. Two modes: "contain" (default, height-driven, letterboxed) and
// "cover" (given a width, fills the box and crops — anchored to the top).

import { useEffect, useMemo, useRef } from 'react'
import { headerAllowedFor } from '../../runtime/scene'
import type { Project, Scene, SceneDef } from '../../runtime/scene'
import type { AssetMap } from '../../runtime/types'
import { sceneAssets } from '../export'

function toScene(project: Project, def: SceneDef): Scene {
  return {
    meta: { ...project.meta, bgMatchColor: def.bgColor !== undefined ? def.bgColor : project.meta.bgMatchColor },
    elements: def.elements,
    overlay: def.overlay,
    // Resolved here rather than by passing `kind` through: a thumbnail deliberately
    // renders overlay scenes without their dim, so only the header decision travels.
    hideHeader: !headerAllowedFor(def),
  }
}

export function SceneThumb(props: { project: Project; def: SceneDef; assets: AssetMap; h: number; w?: number; cover?: boolean }): JSX.Element {
  const { project, def, assets, h } = props
  const ref = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const aspect = (project.meta.baseW || 1080) / (project.meta.baseH || 1920)
  const IH = 600
  const IW = Math.round(IH * aspect)
  // Only the assets this one scene uses — a thumbnail must not decode every
  // image/video in the whole project (multiplied across every card = OOM).
  const thumbAssets = useMemo(() => sceneAssets(def, assets), [def, assets])
  const post = (): void => {
    ref.current?.contentWindow?.postMessage({ type: 'pa:render', scene: toScene(project, def), assets: thumbAssets, interactive: false }, '*')
  }
  useEffect(() => {
    if (ready.current) post()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, assets, props.w, props.h])
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

  // Cover: fill the box (crop), anchored to the top — renders the iframe at the
  // covering pixel size so the runtime fills it with no letterboxing.
  if (props.cover && props.w) {
    const s = Math.max(props.w / IW, props.h / IH)
    const cw = Math.round(IW * s)
    const ch = Math.round(IH * s)
    return (
      <div className="scene-thumb-mini" style={{ width: props.w, height: props.h, position: 'relative', overflow: 'hidden' }}>
        <iframe
          ref={ref}
          src="./runtime-frame.html"
          title={def.name}
          onLoad={post}
          tabIndex={-1}
          style={{ width: cw, height: ch, border: 0, position: 'absolute', left: Math.round((props.w - cw) / 2), top: 0, pointerEvents: 'none' }}
        />
      </div>
    )
  }

  const scale = h / IH
  return (
    <div className="scene-thumb-mini" style={{ width: IW * scale, height: h }}>
      <iframe
        ref={ref}
        src="./runtime-frame.html"
        title={def.name}
        onLoad={post}
        tabIndex={-1}
        style={{ width: IW, height: IH, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none' }}
      />
    </div>
  )
}
