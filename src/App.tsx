import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { EditorCanvas } from './canvas/EditorCanvas'
import { buildCommands } from './commands'
import { ContextToolbar } from './panels/ContextToolbar'
import { Inspector } from './panels/Inspector'
import { Navigator } from './panels/Navigator'
import { StatusBar } from './panels/StatusBar'
import { Timeline } from './panels/Timeline'
import { ToolRail } from './panels/ToolRail'
import { Topbar } from './panels/Topbar'
import { DockPanel } from './ui'
import { currentProjectId, openProject } from './projects'
import { addAsset, addElement, getState, hasElementClip, nextId, pasteElements, selectOnly, setActiveScene } from './store'
import { readImageFile } from './bridge'
import { makeBackground, makeImage } from './factories'

// On-demand surfaces — each becomes its own chunk loaded when first opened, so the
// initial editor (canvas + panels) ships lean (JSZip, the funnel/MIP/SVG builders,
// Supabase, the preview pipeline, etc. stay out of the main bundle).
const CommandPalette = lazy(() => import('./panels/CommandPalette').then((m) => ({ default: m.CommandPalette })))
const ExportModal = lazy(() => import('./panels/ExportModal').then((m) => ({ default: m.ExportModal })))
const FigmaImport = lazy(() => import('./panels/FigmaImport').then((m) => ({ default: m.FigmaImport })))
const ImportBuilt = lazy(() => import('./panels/ImportBuilt').then((m) => ({ default: m.ImportBuilt })))
const ProjectSettings = lazy(() => import('./panels/ProjectSettings').then((m) => ({ default: m.ProjectSettings })))
const TemplatesModal = lazy(() => import('./panels/TemplatesModal').then((m) => ({ default: m.TemplatesModal })))
const QuizFunnel = lazy(() => import('./panels/QuizFunnel').then((m) => ({ default: m.QuizFunnel })))
const GenerateMip = lazy(() => import('./panels/GenerateMip').then((m) => ({ default: m.GenerateMip })))
const HomeScreen = lazy(() => import('./panels/HomeScreen').then((m) => ({ default: m.HomeScreen })))
const ShareModal = lazy(() => import('./panels/ShareModal').then((m) => ({ default: m.ShareModal })))
const ProfilePanel = lazy(() => import('./panels/ProfilePanel').then((m) => ({ default: m.ProfilePanel })))
const QaPanel = lazy(() => import('./panels/QaPanel').then((m) => ({ default: m.QaPanel })))
const QaCheckPanel = lazy(() => import('./panels/QaCheckPanel').then((m) => ({ default: m.QaCheckPanel })))
const PreviewOverlay = lazy(() => import('./preview/PreviewOverlay').then((m) => ({ default: m.PreviewOverlay })))
const UploadModal = lazy(() => import('./panels/UploadModal').then((m) => ({ default: m.UploadModal })))

const clampZoom = (z: number): number => Math.max(0.05, Math.min(3, z)) // matches the canvas wheel-zoom range

export function App(): JSX.Element {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [fitSignal, setFitSignal] = useState(0)
  const [preview, setPreview] = useState(() => location.hash.toLowerCase().includes('preview'))
  const [previewScene, setPreviewScene] = useState<string | null>(null)
  const [figma, setFigma] = useState(() => location.hash.toLowerCase().includes('figma'))
  const [importBuilt, setImportBuilt] = useState(false)
  const [settings, setSettings] = useState(() => location.hash.toLowerCase().includes('settings'))
  const [templates, setTemplates] = useState(() => location.hash.toLowerCase().includes('templates'))
  const [quiz, setQuiz] = useState(() => location.hash.toLowerCase().includes('quiz'))
  const [genMip, setGenMip] = useState(false)
  // Home is a top-level route (not an overlay): the app lands here, and the editor
  // mounts only once a project is opened. An editor deep-link (#preview/#export/#qa/
  // #sel=… etc.) skips Home and boots straight into the editor surface it names.
  const [home, setHome] = useState(() => !/preview|export|qa|settings|templates|quiz|figma|sel=/.test(location.hash.toLowerCase()))
  const [homeTab, setHomeTab] = useState<'projects' | 'team'>(() => (location.hash.toLowerCase().includes('team') ? 'team' : 'projects'))
  const [profile, setProfile] = useState(() => location.hash.toLowerCase().includes('profile'))
  const [exportOpen, setExportOpen] = useState(() => location.hash.toLowerCase().includes('export'))
  const [qa, setQa] = useState(() => location.hash.toLowerCase().includes('qa') && !location.hash.toLowerCase().includes('qacheck'))
  const [qaCheck, setQaCheck] = useState(() => location.hash.toLowerCase().includes('qacheck'))
  // Share / import by code. A '#share=<code>' deep link opens the modal with the
  // code prefilled so a recipient can import straight from a pasted link.
  const shareCode = useMemo(() => /share=([a-z0-9]+)/i.exec(location.hash)?.[1] ?? '', [])
  const [share, setShare] = useState(() => location.hash.toLowerCase().includes('share='))
  // Set when Home shares one specific playable (its card's share button) rather than
  // whatever project is open — null means the modal shows both send and receive.
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string } | null>(null)
  const closeShare = (): void => { setShare(false); setShareTarget(null) }
  const [cmdK, setCmdK] = useState(false)
  const [quickExportBusy, setQuickExportBusy] = useState(false)
  const [quickViteExportBusy, setQuickViteExportBusy] = useState(false)
  const [quickProjectViteExportBusy, setQuickProjectViteExportBusy] = useState(false)
  const [uploadRequest, setUploadRequest] = useState<{ projectIds?: string[]; label?: string } | null>(null)

  // Deep-link from a QA finding to the offending project/scene/element.
  const qaNavigate = async (projectId: string, sceneId?: string, elementId?: string): Promise<void> => {
    if (projectId !== currentProjectId()) await openProject(projectId)
    if (sceneId) setActiveScene(sceneId)
    if (elementId) selectOnly(elementId)
  }

  const commands = useMemo(
    () =>
      buildCommands({
        openPreview: () => { setPreviewScene(null); setPreview(true) },
        openExport: () => setExportOpen(true),
        openFigma: () => setFigma(true),
        openProjectSettings: () => setSettings(true),
        openTemplates: () => setTemplates(true),
        openHome: () => setHome(true),
        openQuizFunnel: () => setQuiz(true),
        openQa: () => setQa(true),
        openQaCheck: () => setQaCheck(true),
        openTeam: () => { setHomeTab('team'); setHome(true) },
        openShare: () => setShare(true),
        openGenerateMip: () => setGenMip(true),
      }),
    [],
  )

  // Cmd/Ctrl+K opens the command palette (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        const t = e.target as HTMLElement
        const tag = t?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        setCmdK((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const doQuickExport = async (): Promise<void> => {
    setQuickExportBusy(true)
    try {
      const mod = await import('./quickExport')
      await mod.quickExportCurrent(true)
    } catch (e) {
      alert('Quick export failed: ' + String(e))
    } finally {
      setQuickExportBusy(false)
    }
  }

  const doQuickViteExport = async (): Promise<void> => {
    setQuickViteExportBusy(true)
    try {
      const mod = await import('./viteExport')
      const { project, assets } = getState()
      await mod.exportViteProject(project, assets)
    } catch (e) {
      alert('Quick Vite export failed: ' + String(e))
    } finally {
      setQuickViteExportBusy(false)
    }
  }

  const doQuickProjectViteExport = async (): Promise<void> => {
    setQuickProjectViteExportBusy(true)
    try {
      const mod = await import('./viteExport')
      await mod.exportViteProjectGroup()
    } catch (e) {
      alert('Quick project Vite export failed: ' + String(e))
    } finally {
      setQuickProjectViteExportBusy(false)
    }
  }

  // Paste straight from Figma: Copy as PNG (or Copy as SVG) on a frame, then Ctrl+V
  // here drops it in — a full-screen-aspect image becomes the scene background, a
  // smaller one a placed image. No token / API / rate limit.
  useEffect(() => {
    const place = (src: string, w: number, h: number, kind: string): void => {
      const id = nextId(kind)
      addAsset(id, { src, w, h })
      const m = getState().scene.meta
      const fullScreen = Math.abs(w / h - m.baseW / m.baseH) / (m.baseW / m.baseH) < 0.18
      addElement(fullScreen ? makeBackground(id, 'Pasted screen') : makeImage(id, 'Pasted image', w, h))
    }
    const svgSize = (svg: string): { w: number; h: number } => {
      const w = /\bwidth="([\d.]+)/.exec(svg)
      const h = /\bheight="([\d.]+)/.exec(svg)
      if (w && h) return { w: +w[1], h: +h[1] }
      const vb = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(svg)
      return vb ? { w: +vb[1], h: +vb[2] } : { w: 600, h: 600 }
    }
    const onPaste = (e: ClipboardEvent): void => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      const dt = e.clipboardData
      if (!dt) return
      const imgItem = Array.from(dt.items).find((i) => i.type.startsWith('image/'))
      if (imgItem) {
        const file = imgItem.getAsFile()
        if (file) {
          e.preventDefault()
          void readImageFile(file).then((img) => img && place(img.src, img.w, img.h, 'paste'))
        }
        return
      }
      const txt = dt.getData('text/plain') || dt.getData('text/html')
      if (txt && txt.trim().startsWith('<svg')) {
        e.preventDefault()
        const svg = txt.trim()
        const { w, h } = svgSize(svg)
        place('data:image/svg+xml,' + encodeURIComponent(svg), w, h, 'svg')
        return
      }
      // No actionable OS image/svg → paste copied editor elements (works across
      // scenes; OS images always take precedence so Figma paste still works).
      if (hasElementClip()) {
        e.preventDefault()
        pasteElements()
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  return (
    <div className="app">
      {home ? (
        // Home route — the editor is unmounted behind it (its state lives in the
        // module-level store, so nothing is lost). Opening a project enters the editor.
        <Suspense fallback={null}>
          <HomeScreen onClose={() => setHome(false)} initialTab={homeTab} onProfile={() => setProfile(true)} onGenerate={() => { setHome(false); setGenMip(true) }} onQuizFunnel={() => { setHome(false); setQuiz(true) }} onImportBuilt={() => { setHome(false); setImportBuilt(true) }} onShare={() => setShare(true)} onShareProject={(id, name) => { setShareTarget({ id, name }); setShare(true) }} onUploadProject={(projectIds, label) => setUploadRequest({ projectIds, label })} onQaCheck={() => setQaCheck(true)} />
        </Suspense>
      ) : (
        <>
          <Topbar
            zoom={zoom}
            onZoom={(z) => setZoom(clampZoom(z))}
            onFit={() => setFitSignal((n) => n + 1)}
            onPreview={() => { setPreviewScene(null); setPreview(true) }}
            onSaveTemplate={() => setTemplates(true)}
            onHome={() => { setHomeTab('projects'); setHome(true) }}
            onProfile={() => setProfile(true)}
            onProjectSettings={() => setSettings(true)}
            onQuickExport={() => void doQuickExport()}
            quickExportBusy={quickExportBusy}
            onQuickViteExport={() => void doQuickViteExport()}
            quickViteExportBusy={quickViteExportBusy}
            onQuickProjectViteExport={() => void doQuickProjectViteExport()}
            quickProjectViteExportBusy={quickProjectViteExportBusy}
            onExport={() => setExportOpen(true)}
            onUpload={() => setUploadRequest({})}
            onQa={() => setQa(true)}
            onQaCheck={() => setQaCheck(true)}
            onShare={() => setShare(true)}
          />
          <div className="body">
            <ToolRail onFigma={() => setFigma(true)} />
            <DockPanel id="nav" side="left" defaultWidth={224} min={170} max={420}>
              <Navigator onPreviewScene={(id) => { setPreviewScene(id); setPreview(true) }} />
            </DockPanel>
            <div className="canvas-col">
              <ContextToolbar />
              <EditorCanvas zoom={zoom} pan={pan} setZoom={(z) => setZoom(clampZoom(z))} setPan={setPan} fitSignal={fitSignal} />
              <Timeline />
            </div>
            <DockPanel id="inspector" side="right" defaultWidth={286} min={240} max={520}>
              <Inspector onProjectSettings={() => setSettings(true)} />
            </DockPanel>
          </div>
          <StatusBar zoom={zoom} />
        </>
      )}
      <Suspense fallback={null}>
        {preview && <PreviewOverlay onClose={() => setPreview(false)} initialScene={previewScene} />}
        {figma && <FigmaImport onClose={() => setFigma(false)} />}
        {importBuilt && <ImportBuilt onClose={() => setImportBuilt(false)} />}
        {settings && <ProjectSettings onClose={() => setSettings(false)} />}
        {templates && <TemplatesModal onClose={() => setTemplates(false)} />}
        {quiz && <QuizFunnel onClose={() => setQuiz(false)} />}
        {genMip && <GenerateMip onClose={() => setGenMip(false)} onQaCheck={() => { setGenMip(false); setHome(false); setQaCheck(true) }} />}
        {profile && <ProfilePanel onClose={() => setProfile(false)} />}
        {exportOpen && <ExportModal onClose={() => setExportOpen(false)} onQaCheck={() => setQaCheck(true)} />}
        {uploadRequest && <UploadModal onClose={() => setUploadRequest(null)} projectIds={uploadRequest.projectIds} label={uploadRequest.label} />}
        {qa && <QaPanel onClose={() => setQa(false)} onNavigate={qaNavigate} />}
        {qaCheck && <QaCheckPanel onClose={() => setQaCheck(false)} />}
        {share && <ShareModal initialCode={shareCode} target={shareTarget ?? undefined} onClose={closeShare} onImported={() => { closeShare(); setHome(false) }} />}
        {cmdK && <CommandPalette commands={commands} onClose={() => setCmdK(false)} />}
      </Suspense>
    </div>
  )
}
