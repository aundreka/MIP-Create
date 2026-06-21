// Left tool rail — Figma-style vertical insert icons. Click a tool to drop that
// element at the canvas center (and select it). Replaces the old +buttons row.

import { importImage, importImages } from '../bridge'
import { makeBackground, makeBar, makeChoice, makeCountdownTimer, makeCta, makeDynamicDate, makeEndcardBlock, makeEndsceneVideo, makeGame, makeHeaderBlock, makeImage, makeRect, makeText } from '../factories'
import { addAsset, addElement, addElements, clearSelection, getState, nextId } from '../store'
import { Tooltip } from '../ui'

function Tool(props: { title: string; onClick: () => void; active?: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <Tooltip label={props.title} side="right">
      <button className={'tool' + (props.active ? ' active' : '')} aria-label={props.title} onClick={props.onClick}>
        {props.children}
      </button>
    </Tooltip>
  )
}

const S = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

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

export function ToolRail(): JSX.Element {
  return (
    <div className="tool-rail">
      <Tool title="Select" active onClick={() => clearSelection()}>
        <svg {...S}>
          <path d="M5 3l6 16 2-7 7-2z" />
        </svg>
      </Tool>

      <div className="rail-sep" />

      {/* static elements */}
      <Tool title="Text" onClick={() => addElement(makeText())}>
        <span style={{ fontWeight: 800, fontSize: 16 }}>T</span>
      </Tool>
      <Tool title="Image" onClick={() => void insertImage('image')}>
        <svg {...S}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9" r="1.6" />
          <path d="M21 16l-5-5L5 20" />
        </svg>
      </Tool>
      <Tool title="Background" onClick={() => void insertImage('background')}>
        <svg {...S}>
          <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" stroke="none" opacity="0.3" />
          <path d="M3 17l5-5 3 3 4-4 6 6" />
          <circle cx="9" cy="8" r="1.4" />
        </svg>
      </Tool>
      <Tool title="Bar / banner" onClick={() => addElement(makeBar())}>
        <svg {...S}>
          <rect x="3" y="9" width="18" height="6" rx="2" fill="currentColor" stroke="none" />
        </svg>
      </Tool>
      <Tool title="Rectangle" onClick={() => addElement(makeRect())}>
        <svg {...S}>
          <rect x="5" y="5" width="14" height="14" rx="2.5" />
        </svg>
      </Tool>
      <Tool title="Button" onClick={() => addElement(makeCta())}>
        <svg {...S}>
          <rect x="3" y="8" width="18" height="8" rx="4" fill="currentColor" stroke="none" />
        </svg>
      </Tool>
      <Tool title="Answer choice (quiz/survey)" onClick={() => addElement(makeChoice())}>
        <svg {...S}>
          <rect x="3" y="6" width="18" height="5" rx="2.5" />
          <rect x="3" y="14" width="18" height="5" rx="2.5" fill="currentColor" stroke="none" opacity="0.35" />
          <path d="M15.5 16.4l1.4 1.4 2.6-2.8" />
        </svg>
      </Tool>

      <div className="rail-sep" />

      {/* interactive / dynamic */}
      <Tool title="Mini-game" onClick={() => addElement(makeGame())}>
        <svg {...S}>
          <rect x="3" y="6" width="18" height="12" rx="3" />
          <circle cx="8" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="16" cy="10" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="16" cy="14" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      </Tool>
      <Tool title="Video endscene" onClick={() => addElement(makeEndsceneVideo())}>
        <svg {...S}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
        </svg>
      </Tool>
      <Tool title="Countdown" onClick={() => addElement(makeCountdownTimer())}>
        <svg {...S}>
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2.5 2.5" />
          <path d="M9 2h6" />
        </svg>
      </Tool>
      <Tool title="Dynamic date" onClick={() => addElement(makeDynamicDate())}>
        <svg {...S}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="8" y1="3" x2="8" y2="6" />
          <line x1="16" y1="3" x2="16" y2="6" />
        </svg>
      </Tool>

      <div className="rail-sep" />

      {/* composite blocks */}
      <Tool title="Header block" onClick={() => addElements(makeHeaderBlock())}>
        <svg {...S}>
          <rect x="3" y="4" width="18" height="5" rx="1.5" fill="currentColor" stroke="none" />
          <line x1="7" y1="14" x2="17" y2="14" />
          <line x1="9" y1="18" x2="15" y2="18" />
        </svg>
      </Tool>
      <Tool title="Endcard block" onClick={() => addElements(makeEndcardBlock())}>
        <svg {...S}>
          <line x1="6" y1="6" x2="18" y2="6" />
          <line x1="8" y1="10" x2="16" y2="10" />
          <rect x="6" y="15" width="12" height="5" rx="2.5" fill="currentColor" stroke="none" />
        </svg>
      </Tool>
    </div>
  )
}
