// Editor render surface (inside an <iframe>). Two modes:
//   pa:render — render a SINGLE scene (the editor canvas: static, posts back
//               element rects/metrics for the selection overlay).
//   pa:play   — play the whole PROJECT flow (the preview overlay: interactive,
//               transitions between scenes).

import { computeMetrics, metrics, setDesign, setVAlign } from './responsive'
import { buildScene, type StageHandle } from './stage'
import { setActiveLocale } from './i18n'
import { playProject, type SceneManager } from './scenes'
import type { Project, Scene } from './scene'
import type { AssetMap } from './types'
import type { FrameRect, ParentToFrame } from './frame-protocol'

let stage: StageHandle | null = null // single-scene (pa:render)
let manager: SceneManager | null = null // project flow (pa:play)
let scene: Scene | null = null
let cachedAssets: AssetMap = {} // last received assets — skipped in pa:render when unchanged
// Last timeline position asked for by the editor's timeline panel. Re-applied after
// every render: a structural edit rebuilds the stage from scratch, and the new stage
// starts with no preview, which would pop timed-out elements back onto the canvas.
let lastSeek: { ms: number | null; playing: boolean } = { ms: null, playing: false }

function size(): { w: number; h: number } {
  return { w: Math.max(1, window.innerWidth), h: Math.max(1, window.innerHeight) }
}
function post(msg: unknown): void {
  window.parent.postMessage(msg, '*')
}

function postLayout(): void {
  if (!stage || !scene) return
  const typeById = new Map(scene.elements.map((e) => [e.id, e.type]))
  const rects: FrameRect[] = []
  for (const node of Array.from(stage.root.querySelectorAll<HTMLElement>('.pa-el'))) {
    const id = node.dataset.id
    if (!id || node.style.display === 'none') continue
    const r = node.getBoundingClientRect()
    rects.push({ id, type: typeById.get(id) ?? 'image', x: r.left, y: r.top, w: r.width, h: r.height })
  }
  let mediaMs = 0
  for (const v of Array.from(document.querySelectorAll('video')))
    if (isFinite(v.duration) && v.duration > 0) mediaMs = Math.max(mediaMs, v.duration * 1000)
  post({ type: 'pa:layout', metrics: metrics(), rects, mediaMs })
}

// Video duration is unknown until metadata lands, which is normally AFTER the layout
// pass above — re-post so the timeline ruler can grow to fit the footage. loadedmetadata
// doesn't bubble, hence the capture-phase listener.
document.addEventListener('loadedmetadata', () => requestAnimationFrame(postLayout), true)

// single-scene render (editor canvas)
function render(next: Scene, assets: AssetMap, interactive: boolean): void {
  if (manager) {
    manager.destroy()
    manager = null
  }
  scene = next
  setDesign(next.meta.baseW || 1080, next.meta.baseH || 1920)
  setVAlign(next.meta.vAlign)
  computeMetrics(size().w, size().h)
  if (stage && stage.update(next, assets)) {
    stage.startGames(interactive)
    requestAnimationFrame(postLayout)
    return
  }
  if (stage) stage.destroy()
  stage = buildScene(next, assets, { mount: document.body })
  stage.layoutAll()
  stage.startGames(interactive)
  if (lastSeek.ms != null) stage.seekTimeline(lastSeek.ms, lastSeek.playing)
  requestAnimationFrame(postLayout)
}

// project flow (preview)
function play(project: Project, assets: AssetMap): void {
  if (stage) {
    stage.destroy()
    stage = null
    scene = null
  }
  if (manager) manager.destroy()
  setDesign(project.meta.baseW || 1080, project.meta.baseH || 1920)
  setVAlign(project.meta.vAlign)
  computeMetrics(size().w, size().h)
  manager = playProject(project, assets, { mount: document.body, interactive: true })
}

function relayout(): void {
  computeMetrics(size().w, size().h)
  if (manager) manager.relayout()
  else if (stage) {
    stage.layoutAll()
    requestAnimationFrame(postLayout)
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as ParentToFrame
  if (!d || typeof d !== 'object') return
  if (d.type === 'pa:render') {
    if (d.assets != null) cachedAssets = d.assets
    setActiveLocale(d.locale ?? null)
    render(d.scene, cachedAssets, d.interactive ?? false)
  } else if (d.type === 'pa:play') {
    setActiveLocale(d.locale ?? null)
    play(d.project, d.assets || {})
  }
  else if (d.type === 'pa:setHidden' && stage) {
    stage.setHidden(d.id, d.hidden)
    requestAnimationFrame(postLayout)
  } else if (d.type === 'pa:seek') {
    lastSeek = { ms: d.ms, playing: !!d.playing }
    stage?.seekTimeline(d.ms, !!d.playing)
  }
})

window.addEventListener('resize', relayout)

post({ type: 'pa:ready' })
