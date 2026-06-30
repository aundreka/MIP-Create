// MIP generator wizard. Upload the (always-supplied) logo + product, pick a game
// type, and it scaffolds a complete editable MIP with coded-SVG art + a coded
// MRAID end card. No idea/design generation — this is for spinning up a structured
// implementation when there's no mockup; everything is editable afterward.

import { useState } from 'react'
import { importImage } from '../bridge'
import { createProject } from '../projects'
import { GAME_TEMPLATES } from '../../runtime/games/registry'
import { extractTheme } from '../brandTheme'
import { buildMip, type UploadAsset } from '../mipGen'
import { DEFAULT_THEME, type BgStyle, type Theme } from '../svgAssets'
import { ColorField, Modal, Select, Toggle } from '../ui'
import { Icon, Upload } from '../icons'

export function GenerateMip(props: { onClose: () => void }): JSX.Element {
  const [name, setName] = useState('New MIP')
  const [logo, setLogo] = useState<UploadAsset & { preview: string }>()
  const [product, setProduct] = useState<UploadAsset & { preview: string }>()
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME)
  const [gameId, setGameId] = useState(GAME_TEMPLATES[0]?.id ?? 'scratch')
  const [bgStyle, setBgStyle] = useState<BgStyle>('gradient')
  const [decor, setDecor] = useState(true)
  const [endDate, setEndDate] = useState(false)
  const [endTimer, setEndTimer] = useState(true)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Theme>): void => setTheme((t) => ({ ...t, ...patch }))

  const pickLogo = async (): Promise<void> => {
    const img = await importImage()
    if (!img) return
    setLogo({ src: img.src, w: img.w, h: img.h, preview: img.src })
    setTheme(await extractTheme(img.src))
  }
  const pickProduct = async (): Promise<void> => {
    const img = await importImage()
    if (img) setProduct({ src: img.src, w: img.w, h: img.h, preview: img.src })
  }

  const generate = async (): Promise<void> => {
    setBusy(true)
    try {
      const { project, assets } = buildMip({
        name: name.trim() || 'New MIP',
        theme,
        gameId,
        bgStyle,
        logo: logo && { src: logo.src, w: logo.w, h: logo.h },
        product: product && { src: product.src, w: product.w, h: product.h },
        decor,
        endscene: { dynamicDate: endDate, timer: endTimer, badge: decor },
      })
      await createProject({ project, assets })
      props.onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Generate MIP" onClose={props.onClose} size="lg">
      <div className="quiz-gen">
        <div className="quiz-gen-left">
          <div className="group-title">Brand assets (always supplied)</div>
          <div className="genmip-uploads">
            <button className="genmip-up" onClick={() => void pickLogo()} style={logo ? { backgroundImage: `url("${logo.preview}")` } : undefined}>
              {!logo && <><Icon icon={Upload} size={16} /> Logo</>}
            </button>
            <button className="genmip-up" onClick={() => void pickProduct()} style={product ? { backgroundImage: `url("${product.preview}")` } : undefined}>
              {!product && <><Icon icon={Upload} size={16} /> Product</>}
            </button>
          </div>
          <label className="field">
            <span>MIP name</span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="field">
            <span>Game type</span>
            <Select value={gameId} onChange={setGameId} options={GAME_TEMPLATES.map((t) => ({ value: t.id, label: t.label }))} />
          </div>
          <div className="field">
            <span>Background</span>
            <Select value={bgStyle} onChange={(v) => setBgStyle(v as BgStyle)} options={[
              { value: 'gradient', label: 'Gradient' },
              { value: 'pattern', label: 'Dot pattern' },
              { value: 'rays', label: 'Rays' },
              { value: 'solid', label: 'Solid' },
            ]} />
          </div>
        </div>

        <div className="quiz-gen-right">
          <div className="group-title">Brand colors {logo ? '(from logo)' : ''}</div>
          <ColorField label="Primary" value={theme.primary} onChange={(c) => set({ primary: c ?? theme.primary })} />
          <ColorField label="Secondary" value={theme.secondary} onChange={(c) => set({ secondary: c ?? theme.secondary })} />
          <ColorField label="Accent (CTA)" value={theme.accent} onChange={(c) => set({ accent: c ?? theme.accent })} />
          <div className="group-title">End card</div>
          <div className="hint pad">Always: product (animated) + pulsing CTA, wrapped as an MRAID end card.</div>
          <Toggle label="Countdown timer" checked={endTimer} onChange={setEndTimer} />
          <Toggle label="Dynamic date (“Offer ends …”)" checked={endDate} onChange={setEndDate} />
          <Toggle label="Decorative WIN badge" checked={decor} onChange={setDecor} />
        </div>
      </div>

      <div className="quiz-gen-foot">
        <span className="hint">Scaffolds a game scene + coded end card. Everything is editable after — this only sets up structure, not the creative idea.</span>
        <button className="primary" disabled={busy} onClick={generate}>{busy ? 'Generating…' : 'Generate MIP'}</button>
      </div>
    </Modal>
  )
}
