// Editor render surface (inside an <iframe>). Two modes:
//   pa:render — render a SINGLE scene (the editor canvas: static, posts back
//               element rects/metrics for the selection overlay).
//   pa:play   — play the whole PROJECT flow (the preview overlay: interactive,
//               transitions between scenes).

import { computeMetrics, metrics, setDesign } from './responsive'
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
  post({ type: 'pa:layout', metrics: metrics(), rects })
}

// single-scene render (editor canvas)
function render(next: Scene, assets: AssetMap, interactive: boolean): void {
  if (manager) {
    manager.destroy()
    manager = null
  }
  scene = next
  setDesign(next.meta.baseW || 1080, next.meta.baseH || 1920)
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
  }
})

window.addEventListener('resize', relayout)

post({ type: 'pa:ready' })
