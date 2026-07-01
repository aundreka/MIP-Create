// Command registry for the Cmd/Ctrl+K palette. Every command only invokes
// existing exported store actions (or App overlay openers) — no new mutation
// paths, so it can't break transactions/history.

import type { LucideIcon } from './icons'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Clapperboard,
  Copy,
  Folder,
  FolderOpen,
  Gamepad2,
  MousePointerClick,
  Play,
  Plus,
  RectangleHorizontal,
  Redo2,
  Smartphone,
  Star,
  Sun,
  Trash2,
  Settings,
  Trophy,
  Type,
  Undo2,
  Upload,
} from './icons'
import {
  addElement,
  addScene,
  alignSelected,
  bringToFront,
  copyStyle,
  duplicateSelected,
  getState,
  groupSelected,
  pasteStyle,
  redo,
  removeSelected,
  sendToBack,
  setOrientation,
  undo,
  ungroupSelected,
} from './store'
import { makeBar, makeCta, makeGame, makeRect, makeText } from './factories'
import { toggleTheme } from './theme'

export interface Command {
  id: string
  title: string
  hint?: string
  icon?: LucideIcon
  run: () => void
}

export interface AppCommandActions {
  openPreview: () => void
  openExport: () => void
  openFigma: () => void
  openProjectSettings: () => void
  openTemplates: () => void
  openHome: () => void
  openQuizFunnel: () => void
  openQa: () => void
  openTeam: () => void
  openShare: () => void
  openGenerateMip: () => void
}

export function buildCommands(a: AppCommandActions): Command[] {
  const eachSelected = (fn: (id: string) => void): void => getState().selectedIds.forEach(fn)
  return [
    { id: 'undo', title: 'Undo', hint: 'Ctrl+Z', icon: Undo2, run: undo },
    { id: 'redo', title: 'Redo', hint: 'Ctrl+Shift+Z', icon: Redo2, run: redo },
    { id: 'duplicate', title: 'Duplicate selection', hint: 'Ctrl+D', icon: Copy, run: duplicateSelected },
    { id: 'delete', title: 'Delete selection', hint: 'Del', icon: Trash2, run: removeSelected },
    { id: 'group', title: 'Group selection', hint: 'Ctrl+G', icon: Folder, run: groupSelected },
    { id: 'ungroup', title: 'Ungroup selection', hint: 'Ctrl+Shift+G', icon: FolderOpen, run: ungroupSelected },
    { id: 'front', title: 'Bring to front', icon: ArrowUpToLine, run: () => eachSelected(bringToFront) },
    { id: 'back', title: 'Send to back', icon: ArrowDownToLine, run: () => eachSelected(sendToBack) },
    { id: 'copy-style', title: 'Copy style', run: copyStyle },
    { id: 'paste-style', title: 'Paste style', run: pasteStyle },
    { id: 'align-left', title: 'Align left', icon: AlignStartVertical, run: () => alignSelected('left') },
    { id: 'align-center-h', title: 'Align center (horizontal)', icon: AlignCenterVertical, run: () => alignSelected('centerH') },
    { id: 'align-right', title: 'Align right', icon: AlignEndVertical, run: () => alignSelected('right') },
    { id: 'align-top', title: 'Align top', icon: AlignStartHorizontal, run: () => alignSelected('top') },
    { id: 'align-middle-v', title: 'Align center (vertical)', icon: AlignCenterHorizontal, run: () => alignSelected('middleV') },
    { id: 'align-bottom', title: 'Align bottom', icon: AlignEndHorizontal, run: () => alignSelected('bottom') },
    { id: 'add-text', title: 'Add text', icon: Type, run: () => addElement(makeText()) },
    { id: 'add-rect', title: 'Add rectangle', icon: RectangleHorizontal, run: () => addElement(makeRect()) },
    { id: 'add-cta', title: 'Add CTA button', icon: MousePointerClick, run: () => addElement(makeCta()) },
    { id: 'add-bar', title: 'Add header / footer bar', icon: RectangleHorizontal, run: () => addElement(makeBar()) },
    { id: 'add-game', title: 'Add mini-game', icon: Gamepad2, run: () => addElement(makeGame()) },
    { id: 'scene-game', title: 'Add game scene', icon: Gamepad2, run: () => addScene('game') },
    { id: 'scene-overlay', title: 'Add overlay scene', icon: Trophy, run: () => addScene('overlay') },
    { id: 'scene-end', title: 'Add endscene', icon: Clapperboard, run: () => addScene('endscene') },
    { id: 'orient-portrait', title: 'Orientation: Portrait', run: () => setOrientation('portrait') },
    { id: 'orient-landscape', title: 'Orientation: Landscape', run: () => setOrientation('landscape') },
    { id: 'theme', title: 'Toggle light / dark theme', icon: Sun, run: () => toggleTheme() },
    { id: 'preview', title: 'Preview the ad', icon: Play, run: a.openPreview },
    { id: 'export', title: 'Export playable…', icon: Upload, run: a.openExport },
    { id: 'settings', title: 'Project settings…', icon: Settings, run: a.openProjectSettings },
    { id: 'templates', title: 'Templates…', run: a.openTemplates },
    { id: 'quizfunnel', title: 'Quiz / survey funnel…', run: a.openQuizFunnel },
    { id: 'genmip', title: 'Generate MIP…', hint: 'logo + product → scaffold', icon: Star, run: a.openGenerateMip },
    { id: 'qa', title: 'QA consistency check…', hint: 'compare MIPs', run: a.openQa },
    { id: 'team', title: 'Team library (cloud)…', hint: 'publish / browse MIPs', icon: Upload, run: a.openTeam },
    { id: 'share', title: 'Share / import a MIP by code…', hint: 'send or receive a project', icon: Upload, run: a.openShare },
    { id: 'figma', title: 'Import from Figma…', run: a.openFigma },
    { id: 'home', title: 'Projects / Home…', icon: Smartphone, run: a.openHome },
  ]
}
