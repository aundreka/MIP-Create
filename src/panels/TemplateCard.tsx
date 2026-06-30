// A single game-template card in the Home menu: a live (lazy) preview of the
// template, its label, the client/MIP usage log, and an inline "tag" form to
// record a new usage. Clicking the preview creates a new project from it.

import { useEffect, useRef, useState } from 'react'
import type { ProjectData } from '../bridge'
import type { Starter } from '../templates'
import { SceneThumb } from '../preview/SceneThumb'
import { addUsage, brandsFor, removeUsage, usagesFor, type Usage } from '../templateUsage'
import { Gamepad2, Icon, Plus, X } from '../icons'

export function TemplateCard(props: {
  starter: Starter
  data: ProjectData
  onUse: () => void
  onUsageChange?: () => void
  activeBrand?: string | null
  onBrand?: (brand: string) => void
}): JSX.Element {
  const { starter, data } = props
  const ref = useRef<HTMLButtonElement>(null)
  const [show, setShow] = useState(false)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [usages, setUsages] = useState<Usage[]>(() => usagesFor(starter.id))
  const [brands, setBrands] = useState<string[]>(() => brandsFor(starter.id))
  const [tagging, setTagging] = useState(false)
  const [client, setClient] = useState('')
  const [mip, setMip] = useState('')

  // Mount the live preview only when the card scrolls near the viewport.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setShow(true)
          io.disconnect()
        }
      },
      { rootMargin: '160px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Measure the preview box so the thumbnail can fill (cover) it.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const sync = (): void => {
    setUsages(usagesFor(starter.id))
    setBrands(brandsFor(starter.id))
    props.onUsageChange?.()
  }
  const add = (): void => {
    if (!client.trim() && !mip.trim()) return
    addUsage(starter.id, client, mip)
    setClient('')
    setMip('')
    setTagging(false)
    sync()
  }
  const del = (id: string): void => {
    removeUsage(id)
    sync()
  }

  const scene = data.project.scenes[0]
  return (
    <div className="tpl-card2">
      <button ref={ref} className="tpl-preview" onClick={props.onUse} title={starter.description}>
        {show && scene && size ? (
          <SceneThumb project={data.project} def={scene} assets={data.assets} h={size.h} w={size.w} cover />
        ) : (
          <Icon icon={Gamepad2} size={26} />
        )}
      </button>
      <div className="tpl-name2">{starter.label}</div>
      {brands.length > 0 && (
        <div className="tpl-brands">
          {brands.map((b) => (
            <button
              key={b}
              className={'tpl-brand' + (props.activeBrand?.toLowerCase() === b.toLowerCase() ? ' on' : '')}
              onClick={() => props.onBrand?.(b)}
              title={`Filter by brand: ${b}`}
            >
              {b}
            </button>
          ))}
        </div>
      )}
      <div className="tpl-uses">
        {usages.map((u) => (
          <span key={u.id} className="tpl-use" title="Remove">
            {[u.client, u.mip].filter(Boolean).join(' · ') || '·'}
            <button className="tpl-use-x" onClick={() => del(u.id)}>
              <Icon icon={X} size={10} />
            </button>
          </span>
        ))}
        {!tagging && (
          <button className="tpl-tag" onClick={() => setTagging(true)} title="Tag a brand / MIP that used this template">
            <Icon icon={Plus} size={11} /> brand
          </button>
        )}
      </div>
      {tagging && (
        <div className="tpl-tagform">
          <input value={client} placeholder="Brand" autoFocus onChange={(e) => setClient(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <input value={mip} placeholder="MIP (optional)" onChange={(e) => setMip(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="primary" onClick={add}>Add</button>
        </div>
      )}
    </div>
  )
}
