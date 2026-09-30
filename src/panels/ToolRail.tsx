// Left tool rail — insert tools. The three everyday ones (text, image, background)
// are one click; the rest sit in labelled group menus. Click a tool to drop that
// element at the canvas center (and select it).

import { importImage, importImages } from '../bridge'
import { insertDynamicHoliday, makeBackground, makeBar, makeButton, makeChoice, makeConfetti, makeCountdownTimer, makeCta, makeDynamicDate, makeEndcardBlock, makeEndsceneVideo, makeGame, makeHeaderBlock, makeImage, makeRect, makeText, makeUnboxing } from '../factories'
import { useRef, useState } from 'react'
import { addAsset, addElement, addElements, addGameHint, getState, nextId } from '../store'
import { Tooltip } from '../ui'
import { CalendarDays, Gamepad2, Icon, ImageIcon, LayoutTemplate, type LucideIcon, MousePointerClick, Square, Type, Wallpaper } from '../icons'
import { ContextMenu } from './ContextMenu'

function Tool(props: { title: string; onClick: () => void; icon: LucideIcon }): JSX.Element {
  return (
    <Tooltip label={props.title} side="right">
      <button className="tool" aria-label={props.title} onClick={props.onClick}>
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

type ToolItem = { label: string; run: () => void }

// A rail button that opens a labelled list of related tools to its right. The
// corner tick marks it as a group, so the rail stays short enough for a laptop
// screen and every tool is found by name, not by guessing an icon.
function ToolGroup(props: { title: string; icon: LucideIcon; items: ToolItem[] }): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <Tooltip label={props.title} side="right">
        <button
          ref={ref}
          className={'tool tool-group' + (pos ? ' active' : '')}
          aria-label={props.title}
          aria-haspopup="menu"
          aria-expanded={!!pos}
          onClick={() => {
            const r = ref.current?.getBoundingClientRect()
            if (r) setPos(pos ? null : { x: r.right + 6, y: r.top })
          }}
        >
          <Icon icon={props.icon} size={21} />
        </button>
      </Tooltip>
      {pos && <ContextMenu x={pos.x} y={pos.y} items={props.items.map((it) => ({ label: it.label, onClick: it.run }))} onClose={() => setPos(null)} />}
    </>
  )
}

export function ToolRail(): JSX.Element {
  return (
    <div className="tool-rail">
      <Tool title="Text" icon={Type} onClick={() => addElement(makeText())} />
      <Tool title="Image" icon={ImageIcon} onClick={() => void insertImage('image')} />
      <Tool title="Background image" icon={Wallpaper} onClick={() => void insertImage('background')} />
      <ToolGroup
        title="Shapes"
        icon={Square}
        items={[
          { label: 'Rectangle', run: () => addElement(makeRect()) },
          { label: 'Bar / banner', run: () => addElement(makeBar()) },
        ]}
      />
      <ToolGroup
        title="Buttons"
        icon={MousePointerClick}
        items={[
          { label: 'CTA button (opens the store)', run: () => addElement(makeCta()) },
          { label: 'Button (goes to a screen)', run: () => addElement(makeButton()) },
          { label: 'Answer choice (quiz / survey)', run: () => addElement(makeChoice()) },
        ]}
      />
      <ToolGroup
        title="Game & effects"
        icon={Gamepad2}
        items={[
          { label: 'Mini-game', run: () => { const g = makeGame(); addElement(g); addGameHint(g.id) } },
          { label: 'Mystery box grid', run: () => addElement(makeUnboxing()) },
          { label: 'Confetti', run: () => addElement(makeConfetti()) },
          { label: 'Video end card', run: () => addElement(makeEndsceneVideo()) },
        ]}
      />
      <ToolGroup
        title="Dynamic text"
        icon={CalendarDays}
        items={[
          { label: 'Countdown', run: () => addElement(makeCountdownTimer()) },
          { label: 'Dynamic date', run: () => addElement(makeDynamicDate()) },
          // Drops BOTH states — the promo label and its no-promo fallback — and seeds
          // the promo calendar when the MIP has none.
          { label: 'Dynamic holiday', run: () => insertDynamicHoliday(addElements) },
        ]}
      />
      <ToolGroup
        title="Blocks"
        icon={LayoutTemplate}
        items={[
          { label: 'Header block', run: () => addElements(makeHeaderBlock()) },
          { label: 'End card block', run: () => addElements(makeEndcardBlock()) },
        ]}
      />
    </div>
  )
}
