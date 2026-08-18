// Project Settings drawer — project-level config that isn't element/scene props:
// identity (name/client/MIP/size/store URLs), Audio (event SFX + background music,
// formerly the "Sound" modal), Languages (locales), and Variants. Opened from the
// ≡ App menu and from the no-selection Inspector.

import { useEffect, useState } from 'react'
import { addVariant, assignProjectGroup, patchMeta, removeVariant, renameVariant, refreshScene, setBgm, setSfxBinding, useEditorState } from '../store'
import { setActiveVariant } from '../variantMode'
import { listGroups } from '../projectGroups'
import { projectsInGroup } from '../projects'
import { fileBaseName, mipName, todayLabel } from '../mipName'
import { Checkbox, Chips, ColorField, Drawer, NumField, Row, Select, Slider } from '../ui'
import { Check, Icon, Play, X } from '../icons'
import { AssetPicker } from './AssetPicker'
import { getEditLocale, setEditLocale } from '../locale'

// Events the runtime fires are marked ✓; the rest await game templates that emit them.
const EVENTS: { key: string; label: string; wired?: boolean }[] = [
  { key: 'gameStart', label: 'Game start', wired: true },
  { key: 'correct', label: 'Correct move', wired: true },
  { key: 'wrong', label: 'Wrong move', wired: true },
  { key: 'gameWin', label: 'Game win', wired: true },
  { key: 'ctaClick', label: 'CTA click / endscene tap', wired: true },
  { key: 'endscene', label: 'Endscene shown', wired: true },
  { key: 'flip', label: 'Card / page flip', wired: true },
  { key: 'lastPage', label: 'Flipbook reaches its last page', wired: true },
  { key: 'tap', label: 'Tap' },
  { key: 'drag', label: 'Drag / scratch (loops while held)', wired: true },
  { key: 'release', label: 'Release / slide back (hold gauge)', wired: true },
  { key: 'pop', label: 'Pop' },
  { key: 'collect', label: 'Collect' },
  { key: 'merge', label: 'Merge' },
  { key: 'round', label: 'Round' },
  { key: 'gameLose', label: 'Game lose' },
]

export function ProjectSettings(props: { onClose: () => void }): JSX.Element {
  const { project, assets } = useEditorState()
  const m = project.meta
  const bgm = project.bgm
  const [localeDraft, setLocaleDraft] = useState(() => (project.meta.locales ?? []).join(', '))
  const bindingFor = (event: string): string | undefined => project.sfx?.find((b) => b.event === event)?.assetId
  const setLocales = (values: string[]): void => {
    const base = (m.defaultLocale || 'en').toLowerCase()
    const seen = new Set<string>()
    const locales = values.map((value) => value.trim()).filter((value) => {
      const key = value.toLowerCase()
      if (!key || key === base || seen.has(key)) return false
      seen.add(key)
      return true
    })
    patchMeta({ locales })
    setLocaleDraft(locales.join(', '))
    const active = getEditLocale()
    if (active && !locales.includes(active)) setEditLocale(null)
  }

  // Give the MIP a fixed date the first time it has a Client/MIP identity, so its
  // canonical name carries one. Stays editable below.
  useEffect(() => {
    if ((m.mipDate ?? '').trim() === '' && ((m.client ?? '').trim() !== '' || (m.mip ?? '').trim() !== '')) {
      patchMeta({ mipDate: todayLabel() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const test = (assetId?: string): void => {
    if (!assetId) return
    const a = assets[assetId]
    if (!a) return
    const el = new Audio(a.src)
    el.volume = 0.9
    void el.play().catch(() => {})
  }
  // Editing a variant happens on the canvas, so close the drawer when entering one.
  const editVariant = (id: string): void => {
    setActiveVariant(id)
    refreshScene()
    props.onClose()
  }

  return (
    <Drawer title="Project settings" onClose={props.onClose} width={380}>
      <div className="group-title">Project</div>
      <Row label="Project">
        <input
          list="pa-project-names"
          value={m.projectName ?? ''}
          placeholder="e.g. Bioma 2026-07 Scratch"
          onChange={(e) => assignProjectGroup(e.target.value)}
        />
        <datalist id="pa-project-names">
          {listGroups().map((g) => (
            <option key={g.id} value={g.name} />
          ))}
        </datalist>
      </Row>
      {m.projectId && (
        <div className="hint pad">
          {projectsInGroup(m.projectId).length} MIP{projectsInGroup(m.projectId).length === 1 ? '' : 's'} in this project. Elements
          toggled “Sync to project” stay identical across all of them.
        </div>
      )}
      <div className="grid2">
        <Row label="Client">
          <input value={m.client ?? ''} placeholder="e.g. Bioma" onChange={(e) => patchMeta({ client: e.target.value })} />
        </Row>
        <Row label="MIP">
          <input value={m.mip ?? ''} placeholder="e.g. MIP3" onChange={(e) => patchMeta({ mip: e.target.value })} />
        </Row>
      </div>
      <Row label="Export date">
        <input type="date" value={m.exportDate ?? ''} onChange={(e) => patchMeta({ exportDate: e.target.value })} />
      </Row>
      <Row label="Date">
        <input type="date" value={m.mipDate ?? ''} onChange={(e) => patchMeta({ mipDate: e.target.value })} />
      </Row>
      <Row label="MIP name">
        <input value={mipName(m)} readOnly title="Auto-named from Client + MIP + Date" />
      </Row>
      <Checkbox
        label="Unique creative"
        checked={m.unique !== false}
        title="Off names the export …_human_none instead of …_human_unique"
        onChange={(v) => patchMeta({ unique: v })}
      />
      <Row label="Export file">
        <input value={fileBaseName(project)} readOnly title="Export filename stem" />
      </Row>
      <div className="hint pad">Auto-named <b>Client + MIP + Date</b>. Export files use <b>client_acslanot_mip_date_mip_emily_game_mechanic_human_unique</b>. A MIP with no minigame names the mechanic slot <b>unknown</b>; clearing <b>Unique creative</b> ends the name in <b>none</b>.</div>
      <div className="grid2">
        <NumField label="Base W" value={m.baseW} suffix="px" onChange={(n) => patchMeta({ baseW: n })} />
        <NumField label="Base H" value={m.baseH} suffix="px" onChange={(n) => patchMeta({ baseH: n })} />
      </div>
      <ColorField label="Background colour" value={m.bgMatchColor || '#000000'} onChange={(c) => patchMeta({ bgMatchColor: c ?? '#000000' })} />
      <Row label="Vertical align">
        <Select
          value={m.vAlign ?? 'top'}
          options={[
            { value: 'top', label: 'Top (spare space at bottom)' },
            { value: 'center', label: 'Center (spare space top + bottom)' },
          ]}
          onChange={(v) => patchMeta({ vAlign: v === 'center' ? 'center' : undefined })}
        />
      </Row>
      <div className="hint pad">On screens taller than the design, <b>Center</b> keeps the content vertically centered (retaining relative size/position) instead of gluing it to the top. Top-pinned headers/bars stay pinned either way.</div>
      <Row label="CTA redirect">
        <Select
          value={m.clickUrlMode ?? 'store'}
          options={[
            { value: 'store', label: 'App stores (iOS + Android)' },
            { value: 'single', label: 'Single URL' },
            { value: 'none', label: 'None (about:blank)' },
          ]}
          onChange={(v) => patchMeta({ clickUrlMode: v as 'store' | 'single' | 'none' })}
        />
      </Row>
      {(m.clickUrlMode ?? 'store') === 'store' && (
        <>
          <Row label="iOS store URL">
            <input value={m.clickUrl.ios} onChange={(e) => patchMeta({ clickUrl: { ...m.clickUrl, ios: e.target.value } })} />
          </Row>
          <Row label="Android store URL">
            <input value={m.clickUrl.android} onChange={(e) => patchMeta({ clickUrl: { ...m.clickUrl, android: e.target.value } })} />
          </Row>
        </>
      )}
      {(m.clickUrlMode ?? 'store') === 'single' && (
        <Row label="Redirect URL">
          <input
            value={m.clickUrl.ios}
            onChange={(e) => patchMeta({ clickUrl: { ios: e.target.value, android: e.target.value } })}
          />
        </Row>
      )}
      <Row label="Cursor">
        <Select
          value={m.cursor ?? 'default'}
          options={[
            { value: 'default', label: 'Default' },
            { value: 'none', label: 'Hidden' },
            { value: 'pointer', label: 'Pointer (hand)' },
            { value: 'crosshair', label: 'Crosshair' },
          ]}
          onChange={(v) => patchMeta({ cursor: v as 'default' | 'none' | 'pointer' | 'crosshair' })}
        />
      </Row>
      <div className="hint pad">Client + MIP group this playable for the QA consistency check.</div>
      <div className="hint pad">The pinned header (date or countdown) is customized from the <b>header</b> button in the top toolbar.</div>

      <div className="group-title">Audio</div>
      <div className="sfx-row">
        <AssetPicker accept="audio" allowNone value={bgm?.assetId} onChange={(id) => setBgm(id, bgm?.volume)} />
        <span className="sfx-name">{bgm?.assetId ? (assets[bgm.assetId]?.src ? bgm.assetId : '(missing)') : 'Background music: none'}</span>
        <button className="sfx-test" title="Test" disabled={!bgm?.assetId} onClick={() => test(bgm?.assetId)}>
          <Icon icon={Play} size={13} />
        </button>
      </div>
      {bgm?.assetId && (
        <Slider label="Music volume" value={Math.round((bgm.volume ?? 0.5) * 100)} min={0} max={100} suffix="%" onChange={(n) => setBgm(bgm.assetId, n / 100)} />
      )}
      <div className="sfx-list">
        {EVENTS.map((ev) => {
          const id = bindingFor(ev.key)
          return (
            <div className="sfx-row" key={ev.key}>
              <AssetPicker accept="audio" allowNone value={id} onChange={(aid) => setSfxBinding(ev.key, aid)} />
              <span className="sfx-name">
                {ev.label} {ev.wired ? <em className="sfx-on"><Icon icon={Check} size={12} strokeWidth={3} /></em> : <em className="sfx-off">soon</em>}
              </span>
              <button className="sfx-test" title="Test" disabled={!id} onClick={() => test(id)}>
                <Icon icon={Play} size={13} />
              </button>
            </div>
          )
        })}
      </div>
      <div className="hint pad">Sound is muted until the player’s first tap (ad networks block autoplay); volume/mute follow the ad container (MRAID). “soon” events await game templates that emit them.</div>

      <div className="group-title">Languages</div>
      <Row label="Default">
        <input value={m.defaultLocale || 'en'} placeholder="en" onChange={(e) => patchMeta({ defaultLocale: e.target.value.trim() || 'en' })} />
      </Row>
      <Row label="Build languages">
        <input
          value={localeDraft}
          placeholder="es, fr, de"
          onChange={(e) => setLocaleDraft(e.target.value)}
          onBlur={() => setLocales(localeDraft.split(','))}
          onKeyDown={(e) => { if (e.key === 'Enter') setLocales(localeDraft.split(',')) }}
        />
      </Row>
      <Chips
        items={[
          ['es', 'Spanish'],
          ['de', 'German'],
          ['ar', 'Arabic'],
          ['fr', 'French'],
          ['pt-BR', 'Portuguese (BR)'],
          ['ja', 'Japanese'],
          ['ko', 'Korean'],
          ['zh-CN', 'Chinese (Simplified)'],
        ].map(([locale, label]) => ({
          key: locale,
          label,
          active: (m.locales ?? []).includes(locale),
          onClick: () => setLocales((m.locales ?? []).includes(locale) ? (m.locales ?? []).filter((item) => item !== locale) : [...(m.locales ?? []), locale]),
        }))}
      />
      <div className="hint pad">
        Pick common languages above or type any BCP-47 codes. Each selected element exposes language-specific text, assets, and
        portrait/landscape layouts. The exported playable detects the browser language and falls back to the default for anything unset.
      </div>

      <div className="group-title">Variants</div>
      {(m.variants ?? []).map((v) => (
        <div className="var-row" key={v.id}>
          <input value={v.name} onChange={(e) => renameVariant(v.id, e.target.value)} />
          <span className="hint">{v.patches.length} override{v.patches.length === 1 ? '' : 's'}</span>
          <button onClick={() => editVariant(v.id)} title="Edit this variant">Edit</button>
          <button className="icon-btn" title="Delete variant" onClick={() => removeVariant(v.id)}>
            <Icon icon={X} size={13} />
          </button>
        </div>
      ))}
      <button className="wide" onClick={() => editVariant(addVariant(''))}>
        Add variant
      </button>
      <div className="hint pad">
        A variant is the same MIP with a few overrides (mechanic, win condition, swapped asset, text). Export emits one playable per
        variant. Languages are separate (auto-detected at runtime, not a variant).
      </div>
    </Drawer>
  )
}
