// Reusable image picker backed by the shared asset library. Pick any existing
// asset (placed images, Figma imports, prior uploads), upload a new one, or
// clear. Used for game asset slots and for image/bar/background element fills.

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { importAudio, importHtml, importImages, importVideo } from '../bridge'
import { addAsset, nextId, useEditorState } from '../store'
import { Clapperboard, Icon, type LucideIcon, LayoutGrid, Music, Plus, Upload, Volume2, X } from '../icons'
import { SfxLibrary } from './SfxLibrary'

const GLYPH: Record<string, LucideIcon> = { video: Clapperboard, audio: Volume2, html: LayoutGrid }

export function AssetPicker(props: {
  label?: string
  value?: string
  onChange: (id: string | undefined) => void
  allowNone?: boolean
  accept?: 'image' | 'video' | 'audio' | 'html' | 'media'
}): JSX.Element {
  const { assets } = useEditorState()
  const [open, setOpen] = useState(false)
  const [lib, setLib] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const accept = props.accept ?? 'image'
  // 'media' = images OR videos (e.g. a container's inner content).
  const matches = (k?: string): boolean =>
    accept === 'media' ? k !== 'audio' && k !== 'html' : accept === 'image' ? k !== 'video' && k !== 'audio' : k === accept
  const entries = Object.entries(assets).filter(([, a]) => matches(a.kind))
  const current = props.value ? assets[props.value] : undefined
  const glyphFor = (id: string): LucideIcon | null => GLYPH[assets[id]?.kind ?? 'image'] ?? null

  const toggle = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ left: Math.min(r.left, window.innerWidth - 260), top: r.bottom + 4 })
    setOpen((o) => !o)
  }
  // Once the popup is in the DOM we know its real height, so clamp it into the
  // viewport: flip it above the button when there isn't room below (the picker
  // often sits near the bottom of a long Inspector), then keep it fully on-screen.
  useLayoutEffect(() => {
    if (!open) return
    const btn = btnRef.current
    const pop = popRef.current
    if (!btn || !pop) return
    const r = btn.getBoundingClientRect()
    const m = 8
    const ph = pop.offsetHeight
    const pw = pop.offsetWidth
    let top = r.bottom + 4
    if (top + ph > window.innerHeight - m) {
      const above = r.top - 4 - ph
      top = above >= m ? above : Math.max(m, window.innerHeight - m - ph)
    }
    const left = Math.max(m, Math.min(r.left, window.innerWidth - pw - m))
    setPos((p) => (p.top === top && p.left === left ? p : { top, left }))
  }, [open])
  const upload = async (): Promise<void> => {
    if (accept === 'video') {
      const vid = await importVideo()
      if (!vid) return
      const id = vid.id || nextId('vid')
      addAsset(id, { src: vid.src, w: vid.w, h: vid.h, kind: 'video' })
      props.onChange(id)
      setOpen(false)
      return
    }
    if (accept === 'audio') {
      const aud = await importAudio()
      if (!aud) return
      const id = aud.id || nextId('aud')
      addAsset(id, { src: aud.src, w: 0, h: 0, kind: 'audio' })
      props.onChange(id)
      setOpen(false)
      return
    }
    if (accept === 'html') {
      const h = await importHtml()
      if (!h) return
      const id = h.id || nextId('game')
      addAsset(id, { src: h.src, w: 0, h: 0, kind: 'html' })
      props.onChange(id)
      setOpen(false)
      return
    }
    const imgs = await importImages()
    if (!imgs.length) return
    const taken = new Set(Object.keys(assets))
    let firstId: string | undefined
    for (const img of imgs) {
      let aid = img.id || nextId('img')
      if (taken.has(aid)) aid = nextId('img')
      taken.add(aid)
      addAsset(aid, { src: img.src, w: img.w, h: img.h })
      if (!firstId) firstId = aid
    }
    if (firstId) props.onChange(firstId)
    setOpen(false)
  }
  const uploadVideo = async (): Promise<void> => {
    const vid = await importVideo()
    if (!vid) return
    const id = vid.id || nextId('vid')
    addAsset(id, { src: vid.src, w: vid.w, h: vid.h, kind: 'video' })
    props.onChange(id)
    setOpen(false)
  }
  const noneLabel =
    accept === 'audio' ? 'No audio yet.' : accept === 'video' ? 'No videos yet.' : accept === 'html' ? 'No games yet.' : accept === 'media' ? 'No images/videos yet.' : 'No images yet.'
  const uploadLabel =
    accept === 'audio' ? 'Upload audio…' : accept === 'video' ? 'Upload video…' : accept === 'html' ? 'Upload game .html…' : 'Upload images…'

  return (
    <div className="field assetpick">
      {props.label && <span>{props.label}</span>}
      <button
        ref={btnRef}
        className="asset-thumb"
        onClick={toggle}
        style={current && !current.kind ? { backgroundImage: `url("${current.src}")` } : undefined}
        title={props.value ?? `Pick ${accept}`}
      >
        {current ? (() => { const G = glyphFor(props.value!); return G ? <Icon icon={G} size={18} /> : null })() : <Icon icon={Plus} size={18} />}
      </button>
      {open &&
        createPortal(
          <>
            <div className="pop-backdrop" onClick={() => setOpen(false)} />
            <div ref={popRef} className="asset-pop" style={{ left: pos.left, top: pos.top }}>
              <div className="asset-grid">
                {props.allowNone && (
                  <button className="asset-cell none" title="None" onClick={() => { props.onChange(undefined); setOpen(false) }}>
                    <Icon icon={X} size={16} />
                  </button>
                )}
                {entries.map(([id, a]) => {
                  const G = glyphFor(id)
                  return (
                    <button
                      key={id}
                      className={'asset-cell' + (id === props.value ? ' sel' : '')}
                      style={a.kind ? undefined : { backgroundImage: `url("${a.src}")` }}
                      title={a.kind ? id : `${id} · ${a.w}×${a.h}`}
                      onClick={() => { props.onChange(id); setOpen(false) }}
                    >
                      {G ? <Icon icon={G} size={18} /> : null}
                    </button>
                  )
                })}
                {!entries.length && <div className="hint pad">{noneLabel}</div>}
              </div>
              <button className="wide" onClick={() => void upload()}>
                <Icon icon={Upload} size={14} /> {uploadLabel}
              </button>
              {accept === 'media' && (
                <button className="wide" onClick={() => void uploadVideo()}>
                  <Icon icon={Clapperboard} size={14} /> Upload video…
                </button>
              )}
              {accept === 'audio' && (
                <button className="wide" onClick={() => { setLib(true); setOpen(false) }}>
                  <Icon icon={Music} size={14} /> Sound library…
                </button>
              )}
            </div>
          </>,
          document.body,
        )}
      {lib && (
        <SfxLibrary
          onClose={() => setLib(false)}
          onPick={(aid) => {
            props.onChange(aid)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
