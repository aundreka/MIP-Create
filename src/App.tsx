import { useEffect, useMemo, useState } from 'react'
import { EditorCanvas } from './canvas/EditorCanvas'
import { CommandPalette } from './panels/CommandPalette'
import { buildCommands } from './commands'
import { Inspector } from './panels/Inspector'
import { LayersPanel } from './panels/LayersPanel'
import { ExportModal } from './panels/ExportModal'
import { FigmaImport } from './panels/FigmaImport'
import { SfxPanel } from './panels/SfxPanel'
import { TemplatesModal } from './panels/TemplatesModal'
import { QuizFunnel } from './panels/QuizFunnel'
import { HomeScreen } from './panels/HomeScreen'
import { ProfilePanel } from './panels/ProfilePanel'
import { QaPanel } from './panels/QaPanel'
import { ScenesStrip } from './panels/ScenesStrip'
import { ToolRail } from './panels/ToolRail'
import { Topbar } from './panels/Topbar'
import { PreviewOverlay } from './preview/PreviewOverlay'
import { currentProjectId, openProject } from './projects'
import { selectOnly, setActiveScene } from './store'

const clampZoom = (z: number): number => Math.max(0.1, Math.min(3, z))

export function App(): JSX.Element {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [fitSignal, setFitSignal] = useState(0)
  const [preview, setPreview] = useState(() => location.hash.toLowerCase().includes('preview'))
  const [previewScene, setPreviewScene] = useState<string | null>(null)
  const [figma, setFigma] = useState(() => location.hash.toLowerCase().includes('figma'))
  const [sfx, setSfx] = useState(() => location.hash.toLowerCase().includes('sfx'))
  const [templates, setTemplates] = useState(() => location.hash.toLowerCase().includes('templates'))
  const [quiz, setQuiz] = useState(() => location.hash.toLowerCase().includes('quiz'))
  const [home, setHome] = useState(() => location.hash.toLowerCase().includes('home'))
  const [profile, setProfile] = useState(() => location.hash.toLowerCase().includes('profile'))
  const [exportOpen, setExportOpen] = useState(() => location.hash.toLowerCase().includes('export'))
  const [qa, setQa] = useState(() => location.hash.toLowerCase().includes('qa'))
  const [cmdK, setCmdK] = useState(false)

  // Deep-link from a QA finding to the offending project/scene/element.
  const qaNavigate = (projectId: string, sceneId?: string, elementId?: string): void => {
    if (projectId !== currentProjectId()) openProject(projectId)
    if (sceneId) setActiveScene(sceneId)
    if (elementId) selectOnly(elementId)
  }

  const commands = useMemo(
    () =>
      buildCommands({
        openPreview: () => { setPreviewScene(null); setPreview(true) },
        openExport: () => setExportOpen(true),
        openFigma: () => setFigma(true),
        openSfx: () => setSfx(true),
        openTemplates: () => setTemplates(true),
        openHome: () => setHome(true),
        openQuizFunnel: () => setQuiz(true),
        openQa: () => setQa(true),
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

  return (
    <div className="app">
      <Topbar
        zoom={zoom}
        onZoom={(z) => setZoom(clampZoom(z))}
        onFit={() => setFitSignal((n) => n + 1)}
        onPreview={() => { setPreviewScene(null); setPreview(true) }}
        onFigma={() => setFigma(true)}
        onSfx={() => setSfx(true)}
        onTemplates={() => setTemplates(true)}
        onHome={() => setHome(true)}
        onExport={() => setExportOpen(true)}
        onQuizFunnel={() => setQuiz(true)}
        onQa={() => setQa(true)}
      />
      <ScenesStrip onPreviewScene={(id) => { setPreviewScene(id); setPreview(true) }} />
      <div className="body">
        <ToolRail />
        <LayersPanel />
        <EditorCanvas zoom={zoom} pan={pan} setZoom={(z) => setZoom(clampZoom(z))} setPan={setPan} fitSignal={fitSignal} />
        <Inspector />
      </div>
      {preview && <PreviewOverlay onClose={() => setPreview(false)} initialScene={previewScene} />}
      {figma && <FigmaImport onClose={() => setFigma(false)} />}
      {sfx && <SfxPanel onClose={() => setSfx(false)} />}
      {templates && <TemplatesModal onClose={() => setTemplates(false)} />}
      {quiz && <QuizFunnel onClose={() => setQuiz(false)} />}
      {home && <HomeScreen onClose={() => setHome(false)} onProfile={() => setProfile(true)} />}
      {profile && <ProfilePanel onClose={() => setProfile(false)} />}
      {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}
      {qa && <QaPanel onClose={() => setQa(false)} onNavigate={qaNavigate} />}
      {cmdK && <CommandPalette commands={commands} onClose={() => setCmdK(false)} />}
    </div>
  )
}
