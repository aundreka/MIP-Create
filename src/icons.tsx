// Single icon import site. Keeps the icon language unified (lucide line icons,
// matching the tool rail's 1.8-stroke SVGs) and tree-shaking effective — every
// consumer imports from here, never from 'lucide-react' directly.

import type { LucideIcon } from 'lucide-react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Columns2,
  Contrast,
  Copy,
  Diamond,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Frame,
  Gamepad2,
  Gift,
  GripVertical,
  Hand,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  ListChecks,
  Lock,
  LockOpen,
  Film,
  CalendarDays,
  Heading,
  PanelTop,
  MousePointer2,
  Square,
  Wallpaper,
  Menu,
  Minus,
  Moon,
  MousePointerClick,
  Music,
  PartyPopper,
  Pencil,
  Pipette,
  Play,
  Plus,
  RectangleHorizontal,
  RotateCcw,
  Save,
  ScanSearch,
  Search,
  Settings,
  Smartphone,
  SquareMousePointer,
  Star,
  Sun,
  Timer,
  Trash2,
  Trophy,
  Type,
  Undo2,
  Redo2,
  Upload,
  User,
  Volume2,
  X,
} from 'lucide-react'

export type { LucideIcon }

export {
  AlignCenterHorizontal,
  Columns2,
  Layers,
  ScanSearch,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Contrast,
  Copy,
  Diamond,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Frame,
  Gamepad2,
  Gift,
  GripVertical,
  Hand,
  ImageIcon,
  LayoutGrid,
  LayoutTemplate,
  ListChecks,
  Lock,
  LockOpen,
  Film,
  CalendarDays,
  Heading,
  PanelTop,
  MousePointer2,
  Square,
  Wallpaper,
  Menu,
  Minus,
  Moon,
  MousePointerClick,
  Music,
  PartyPopper,
  Pencil,
  Pipette,
  Play,
  Plus,
  RectangleHorizontal,
  RotateCcw,
  Save,
  Search,
  Settings,
  Smartphone,
  SquareMousePointer,
  Star,
  Sun,
  Timer,
  Trash2,
  Trophy,
  Type,
  Undo2,
  Redo2,
  Upload,
  User,
  Volume2,
  X,
}

// Thin wrapper so callers don't repeat size/stroke and we can theme centrally.
export function Icon(props: {
  icon: LucideIcon
  size?: number
  strokeWidth?: number
  className?: string
  title?: string
  fill?: string
}): JSX.Element {
  const I = props.icon
  return (
    <I
      size={props.size ?? 16}
      strokeWidth={props.strokeWidth ?? 1.8}
      className={props.className}
      fill={props.fill ?? 'none'}
      aria-hidden={props.title ? undefined : true}
      aria-label={props.title}
    />
  )
}

// De-duplicated scene-kind map (was triplicated in ScenesStrip/PreviewOverlay/FlowPreview).
export const SCENE_KIND_ICON: Record<string, LucideIcon> = {
  game: Gamepad2,
  overlay: Trophy,
  endscene: Clapperboard,
  // legacy
  win: Trophy,
  custom: LayoutGrid,
}

// De-duplicated layer-type map (was in LayersPanel).
export const LAYER_TYPE_ICON: Record<string, LucideIcon> = {
  background: ImageIcon,
  bar: RectangleHorizontal,
  image: ImageIcon,
  text: Type,
  cta: MousePointerClick,
  button: SquareMousePointer,
  handguide: Hand,
  countdown: Timer,
  dim: Contrast,
  'game-mount': Gamepad2,
  endscene: Clapperboard,
}
