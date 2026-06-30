// Left tool rail — Figma-style vertical insert icons. Click a tool to drop that
// element at the canvas center (and select it). One distinct lucide icon per tool
// so they're easy to tell apart at a glance.

import { importImage, importImages } from '../bridge'
import { makeBackground, makeBar, makeChoice, makeCountdownTimer, makeCta, makeDynamicDate, makeEndcardBlock, makeEndsceneVideo, makeGame, makeHeaderBlock, makeImage, makeRect, makeText, makeUnboxing } from '../factories'
import { addAsset, addElement, addElements, addGameHint, clearSelection, getState, nextId } from '../store'
import { Tooltip } from '../ui'
import {
  CalendarDays,
  Film,
  Frame,
  Gamepad2,
  Gift,
  Heading,
  Icon,
  ImageIcon,
  LayoutTemplate,
  ListChecks,
  type LucideIcon,
  MousePointer2,
  MousePointerClick,
  PanelTop,
  Square,
  Timer,
  Type,
  Wallpaper,
} from '../icons'

function Tool(props: { title: string; onClick: () => void; active?: boolean; icon: LucideIcon }): JSX.Element {
  return (
    <Tooltip label={props.title} side="right">
      <button className={'tool' + (props.active ? ' active' : '')} aria-label={props.title} onClick={props.onClick}>
        <Icon icon={props.icon} size={21} />
      </button>
    </Tooltip>
  )
}

async function insertImage(kind: 'image' | 'background'): Promise<void> {
  // Background is a single full-bleed fill; images can be uploaded in a batch.
  if (kind === 'background') {
    const img = await importImage()
    if (!img) return
    addAsset(img.id, { src: img.src, w: img.w, h: img.h })
    addElement(makeBackground(img.id, img.name))
    return
  }
  const imgs = await importImages()
  if (!imgs.length) return
  const taken = new Set(Object.keys(getState().assets))
  for (const img of imgs) {
    let aid = img.id || nextId('img')
    if (taken.has(aid)) aid = nextId('img')
    taken.add(aid)
    addAsset(aid, { src: img.src, w: img.w, h: img.h })
    addElement(makeImage(aid, img.name, img.w, img.h))
  }
}

export function ToolRail(props: { onFigma: () => void }): JSX.Element {
  return (
    <div className="tool-rail">
      <Tool title="Select" active icon={MousePointer2} onClick={() => clearSelection()} />

      <div className="rail-sep" />

      {/* static elements */}
      <Tool title="Text" icon={Type} onClick={() => addElement(makeText())} />
      <Tool title="Image" icon={ImageIcon} onClick={() => void insertImage('image')} />
      <Tool title="Background" icon={Wallpaper} onClick={() => void insertImage('background')} />
      <Tool title="Bar / banner" icon={PanelTop} onClick={() => addElement(makeBar())} />
      <Tool title="Rectangle" icon={Square} onClick={() => addElement(makeRect())} />
      <Tool title="Button / CTA" icon={MousePointerClick} onClick={() => addElement(makeCta())} />
      <Tool title="Answer choice (quiz/survey)" icon={ListChecks} onClick={() => addElement(makeChoice())} />

      <div className="rail-sep" />

      {/* interactive / dynamic */}
      <Tool title="Mini-game" icon={Gamepad2} onClick={() => { const g = makeGame(); addElement(g); addGameHint(g.id) }} />
      <Tool title="Mystery Box grid" icon={Gift} onClick={() => addElement(makeUnboxing())} />
      <Tool title="Video endscene" icon={Film} onClick={() => addElement(makeEndsceneVideo())} />
      <Tool title="Countdown" icon={Timer} onClick={() => addElement(makeCountdownTimer())} />
      <Tool title="Dynamic date" icon={CalendarDays} onClick={() => addElement(makeDynamicDate())} />

      <div className="rail-sep" />

      {/* composite blocks */}
      <Tool title="Header block" icon={Heading} onClick={() => addElements(makeHeaderBlock())} />
      <Tool title="Endcard block" icon={LayoutTemplate} onClick={() => addElements(makeEndcardBlock())} />

      <div className="rail-sep" />

      {/* import from Figma — add a frame as a new scene (or replace the project) */}
      <Tool title="Import from Figma" icon={Frame} onClick={props.onFigma} />
    </div>
  )
}
