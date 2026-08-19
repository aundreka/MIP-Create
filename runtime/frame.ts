// Editor render surface (inside an <iframe>). Two modes:
//   pa:render — render a SINGLE scene (the editor canvas: static, posts back
//               element rects/metrics for the selection overlay).
//   pa:play   — play the whole PROJECT flow (the preview overlay: interactive,
//               transitions between scenes).

import { computeMetrics, metrics, setDesign, setVAlign } from './responsive'
import { mountHeader } from './header'
import { headerAllowedFor } from './scene'
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
// The pinned band on the CANVAS (pa:render). The flow mode mounts its own inside
// playProject, so this is only ever used for the single-scene render — it lets the
// editor compose against the real header and drag it into place. Re-created whenever
// the config or the scene's own header visibility changes.
let header: ReturnType<typeof mountHeader> | null = null
let headerKey = ''

function size(): { w: number; h: number } {
  return { w: Math.max(1, window.innerWidth), h: Math.max(1, window.innerHeight) }
}
function post(msg: unknown): void {
  window.parent.postMessage(msg, '*')
}

function headerRect(): FrameRect | undefined {
  const band = header ? document.querySelector<HTMLElement>('.pa-header') : null
  if (!band || band.style.display === 'none') return undefined
  const r = band.getBoundingClientRect()
  return { id: '__header', type: 'header', x: r.left, y: r.top, w: r.width, h: r.height }
}

// The canvas header follows the scene it is rendering: the project's config, but only on
// scenes that actually show it (endscenes need showHeader, hideHeader always wins).
function syncHeader(next: Scene): void {
  const cfg = headerAllowedFor(next) ? next.meta.header : undefined
  const key = cfg ? JSON.stringify(cfg) : ''
  if (key !== headerKey) {
    headerKey = key
    header?.destroy()
    // Same clip lock the flow mode gives the band (see StageHandle.endsceneClip), so the
    // canvas composes against the position and size the export will actually render.
    header = cfg ? mountHeader(document.body, cfg, () => stage?.endsceneClip() ?? null) : null
  }
  // This scene's own placement (SceneDef.header) rides on top of the project layout —
  // applied separately so editing it doesn't rebuild the band.
  header?.setSceneLayout(next.headerOverride ?? null)
  header?.relayout()
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
  post({ type: 'pa:layout', metrics: metrics(), rects, mediaMs, header: headerRect() })
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
  syncHeader(next)
  if (stage && stage.update(next, assets)) {
    stage.startGames(interactive)
    header?.relayout() // the band rides THIS scene's card — re-read it now the stage holds it
    requestAnimationFrame(postLayout)
    return
  }
  if (stage) stage.destroy()
  stage = buildScene(next, assets, { mount: document.body })
  stage.layoutAll()
  stage.startGames(interactive)
  if (lastSeek.ms != null) stage.seekTimeline(lastSeek.ms, lastSeek.playing)
  // syncHeader ran before this stage existed, so the band was laid out against the
  // previous scene's card (or none at all).
  header?.relayout()
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
  header?.destroy() // the flow mounts (and owns) its own band
  header = null
  headerKey = ''
  setDesign(project.meta.baseW || 1080, project.meta.baseH || 1920)
  setVAlign(project.meta.vAlign)
  computeMetrics(size().w, size().h)
  manager = playProject(project, assets, { mount: document.body, interactive: true })
}

function relayout(): void {
  computeMetrics(size().w, size().h)
  header?.relayout()
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
