// Project Settings drawer — project-level config that isn't element/scene props:
// identity (name/client/MIP/size/store URLs), Audio (event SFX + background music,
// formerly the "Sound" modal), Languages (locales), and Variants. Opened from the
// ≡ App menu and from the no-selection Inspector.

import { useEffect, useState } from 'react'
import { addVariant, assignProjectGroup, patchMeta, removeVariant, renameVariant, refreshScene, setBgm, setSfxBinding, useEditorState } from '../store'
import { setActiveVariant } from '../variantMode'
import { listGroups } from '../projectGroups'
import { projectsInGroup } from '../projects'
import { fileBaseName, isSip, mipFolderName, mipName, subconceptToken } from '../mipName'
import type { Subconcept } from '../mipName'
import { Accordion, Checkbox, Chips, ColorField, Drawer, Help, NumField, Row, Select, Slider } from '../ui'
import { Icon, Play, X } from '../icons'
import { AssetPicker } from './AssetPicker'
import { GithubSettings } from './GithubSettings'
import { endcardScenes, sipScene } from '../sip'
import { getEditLocale, setEditLocale } from '../locale'
import { importCsv } from '../bridge'
import { DEFAULT_PROMO_CALENDAR, calendarRange, labelForDate, parsePromoCsv, validatePromoCalendar } from '../promoCalendar'
import { setPreviewDate, todayKey, usePreviewDate } from '../uiState'

// Only events the runtime actually fires are shown (wired); the rest are kept here
// for the bindings they may already hold, and reappear once a template emits them.
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
  const endcards = endcardScenes(project)
  const previewDate = usePreviewDate()
  // Last CSV import result — how many rows landed and which lines were unreadable.
  const [csvNote, setCsvNote] = useState<string | null>(null)
  // Which generated name was just copied (flashes "Copied!" for a moment).
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(null), 1200)
    return () => window.clearTimeout(t)
  }, [copied])
  const bgm = project.bgm
  const [localeDraft, setLocaleDraft] = useState(() => (project.meta.locales ?? []).join(', '))
  const bindingFor = (event: string): string | undefined => project.sfx?.find((b) => b.event === event)?.assetId
  const setLocales = (values: string[]): void => {
    const base = (m.defaultLocale || 'en').toLowerCase()
    const seen = new Set<string>()
    const locales = values
      .map((value) => value.trim())
      .filter((value) => {
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

  // The filename's two trailing tokens (subconcept, unique) — shown live under
  // the controls that set them, since the consequence is otherwise tooltip-only.
  const [subTok, uniqTok] = fileBaseName(project).split('_').slice(-2)

  return (
    <Drawer title="Project settings" onClose={props.onClose} width={380}>
      <Accordion id="settings.project" title="Project">
        <Row label="Project">
          <input list="pa-project-names" value={m.projectName ?? ''} placeholder="e.g. Bioma 2026-07 Scratch" onChange={(e) => assignProjectGroup(e.target.value)} />
          <datalist id="pa-project-names">
            {listGroups().map((g) => (
              <option key={g.id} value={g.name} />
            ))}
          </datalist>
        </Row>
        {m.projectId && (
          <div className="hint pad">
            {projectsInGroup(m.projectId).length} MIP{projectsInGroup(m.projectId).length === 1 ? '' : 's'} in this project. Elements toggled “Sync to project” stay identical
            across all of them.
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
        <Row label="Date">
          <input
            type="date"
            title="Used for the MIP name and the export filename's date token"
            value={m.mipDate || m.exportDate || ''}
            onChange={(e) => patchMeta({ mipDate: e.target.value, exportDate: e.target.value })}
          />
        </Row>
        <Row label="Subconcept">
          <Select
            value={subconceptToken(m)}
            options={[
              { value: 'none', label: 'None (…_none_…)' },
              { value: 'dd', label: 'Dynamic date (…_dd_…)' },
              { value: 'dt', label: 'Dynamic time (…_dt_…)' },
              { value: 'dh', label: 'Dynamic holiday (…_dh_…)' },
              { value: 'dtd', label: 'Dynamic date and time (…_dtd_…)' },
            ]}
            onChange={(v) => patchMeta({ subconcept: v as Subconcept })}
          />
        </Row>
        <div className="hint pad">
          Ends the filename …_<b>{subTok}</b>_{uniqTok}
        </div>
        <Checkbox
          label="Unique creative"
          checked={m.unique !== false}
          title="Off names the export …_none instead of …_unique in the last slot"
          onChange={(v) => patchMeta({ unique: v })}
        />
        <div className="hint pad">
          Ends the filename …_{subTok}_<b>{uniqTok}</b>
        </div>
        {isSip(project) && (
          <Row label="SIP format">
            <Select
              value={m.sipFormat ?? 'carousel'}
              options={[
                { value: 'carousel', label: 'Carousel (…_emily_product_carousel_…)' },
                { value: 'card', label: 'Card (…_emily_product_card_…)' },
              ]}
              onChange={(v) => patchMeta({ sipFormat: v as 'carousel' | 'card' })}
            />
          </Row>
        )}
        <Row label="Game name">
          <input
            value={m.gameName ?? ''}
            placeholder={mipFolderName({ ...project, meta: { ...m, gameName: undefined } }).replace(/^MIP\d+( - )?/, '') || 'e.g. Scratch'}
            title="Names the delivery folder, e.g. MIP1 - SCRATCH. Blank uses the mechanic."
            onChange={(e) => patchMeta({ gameName: e.target.value || undefined })}
          />
        </Row>
        {/* The three generated names in one compact click-to-copy block — they were
          three full read-only input rows before, which read as editable and ate
          a third of the section. */}
        <div className="meta-names">
          {(
            [
              ['MIP name', mipName(m)],
              ['Export file', fileBaseName(project)],
              ['Folder', mipFolderName(project)],
            ] as const
          ).map(([label, value]) => (
            <button
              key={label}
              type="button"
              className="meta-name-row"
              title={`${value}\nClick to copy`}
              onClick={() => {
                void navigator.clipboard?.writeText(value)
                setCopied(label)
              }}
            >
              <span>{copied === label ? 'Copied!' : label}</span>
              <code>{value}</code>
            </button>
          ))}
        </div>
        {endcards.length > 1 && (
          <Row label="SIP end card">
            <Select
              value={sipScene(project)?.id ?? endcards[0].id}
              title="The end card Quick SIP, Upload and Push to GitHub cut the SIP from"
              options={endcards.map((s) => ({ value: s.id, label: s.name }))}
              onChange={(v) => patchMeta({ sipSceneId: v })}
            />
          </Row>
        )}
        <Help>
          Client + MIP also group this playable with its siblings for the QA consistency check. Names: auto-named <b>Client + MIP + Date</b>. Export files use{' '}
          <b>client_acslanot_mip_date_mip_emily_game_mechanic_human_subconcept_unique</b>. A MIP with no minigame names the mechanic slot <b>unknown</b>; <b>Subconcept</b> sets the
          second-to-last slot (<b>dd</b> dynamic date / <b>dt</b> dynamic time / <b>dh</b> dynamic holiday / <b>dtd</b> dynamic date and time / <b>none</b>) and clearing{' '}
          <b>Unique creative</b> ends the name in <b>none</b> — so no dynamic date and no promo ends <b>…_none_none</b>, and a dynamic date with a promo ends <b>…_dd_unique</b>. A{' '}
          <b>SIP</b> — one scene, and that scene is an end card — names itself <b>client_acslanot_sip_date_mip_emily_product_carousel_human_none_unique</b>, with <b>SIP format</b>{' '}
          switching <b>carousel</b> ↔ <b>card</b>.
        </Help>
        <div className="grid2">
          <NumField label="Base W" value={m.baseW} suffix="px" onChange={(n) => patchMeta({ baseW: n })} />
          <NumField label="Base H" value={m.baseH} suffix="px" onChange={(n) => patchMeta({ baseH: n })} />
        </div>
        <ColorField label="Background color" value={m.bgMatchColor || '#000000'} onChange={(c) => patchMeta({ bgMatchColor: c ?? '#000000' })} />
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
        <Help>
          On screens taller than the design, <b>Center</b> keeps the content vertically centered (retaining relative size/position) instead of gluing it to the top. Top-pinned
          headers/bars stay pinned either way.
        </Help>
      </Accordion>
      <Accordion id="settings.flow" title="Redirect &amp; flow" defaultOpen={false}>
        <Checkbox
          label="Session timer"
          checked={!!m.sessionTimer}
          title="One countdown for the whole playable, started by the player's first interaction"
          onChange={(v) =>
            patchMeta({
              sessionTimer: v ? { ms: m.sessionTimer?.ms ?? 30000, to: m.sessionTimer?.to || project.scenes[project.scenes.length - 1]?.id || '' } : undefined,
            })
          }
        />
        {m.sessionTimer && (
          <>
            <NumField
              label="Duration"
              value={Math.round(m.sessionTimer.ms / 1000)}
              min={1}
              suffix="s"
              onChange={(n) => patchMeta({ sessionTimer: { ...m.sessionTimer!, ms: Math.max(1, n) * 1000 } })}
            />
            <Row label="Go to scene">
              <Select
                value={m.sessionTimer.to}
                options={project.scenes.map((s) => ({ value: s.id, label: s.name || s.id }))}
                onChange={(v) => patchMeta({ sessionTimer: { ...m.sessionTimer!, to: v } })}
              />
            </Row>
          </>
        )}
        <Help>
          Starts on the player&rsquo;s <b>first interaction</b> and keeps running across every screen — moving between scenes never restarts it. When it runs out the flow jumps to
          the scene above. Nothing is drawn; it&rsquo;s flow logic only, and it does nothing once an end card is reached.
        </Help>

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
            <input value={m.clickUrl.ios} onChange={(e) => patchMeta({ clickUrl: { ios: e.target.value, android: e.target.value } })} />
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
      </Accordion>
      <Accordion id="settings.github" title="GitHub" defaultOpen={false}>
        <GithubSettings />
      </Accordion>
      <Accordion id="settings.audio" title="Audio" defaultOpen={false}>
        <div className="sfx-row">
          <AssetPicker accept="audio" allowNone value={bgm?.assetId} onChange={(id) => setBgm(id, bgm?.volume)} />
          <span className="sfx-name">{bgm?.assetId ? (assets[bgm.assetId]?.src ? bgm.assetId : '(missing)') : 'Background music: none'}</span>
          <button className="sfx-test" title="Test" disabled={!bgm?.assetId} onClick={() => test(bgm?.assetId)}>
            <Icon icon={Play} size={13} />
          </button>
        </div>
        {bgm?.assetId && <Slider label="Music volume" value={Math.round((bgm.volume ?? 0.5) * 100)} min={0} max={100} suffix="%" onChange={(n) => setBgm(bgm.assetId, n / 100)} />}
        <div className="sfx-list">
          {EVENTS.filter((ev) => ev.wired).map((ev) => {
            const id = bindingFor(ev.key)
            return (
              <div className="sfx-row" key={ev.key}>
                <AssetPicker accept="audio" allowNone value={id} onChange={(aid) => setSfxBinding(ev.key, aid)} />
                <span className="sfx-name">{ev.label}</span>
                <button className="sfx-test" title="Test" disabled={!id} onClick={() => test(id)}>
                  <Icon icon={Play} size={13} />
                </button>
              </div>
            )
          })}
        </div>
        <Help>Sound is muted until the player’s first tap (ad networks block autoplay); volume/mute follow the ad container (MRAID).</Help>
      </Accordion>
      <Accordion id="settings.languages" title="Languages" defaultOpen={false}>
        <Row label="Default">
          <input value={m.defaultLocale || 'en'} placeholder="en" onChange={(e) => patchMeta({ defaultLocale: e.target.value.trim() || 'en' })} />
        </Row>
        <Row label="Build languages">
          <input
            value={localeDraft}
            placeholder="es, fr, de"
            onChange={(e) => setLocaleDraft(e.target.value)}
            onBlur={() => setLocales(localeDraft.split(','))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setLocales(localeDraft.split(','))
            }}
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
        <Help>
          Pick common languages above or type any BCP-47 codes. Each selected element exposes language-specific text, assets, and portrait/landscape layouts. The exported playable
          detects the browser language and falls back to the default for anything unset.
        </Help>
      </Accordion>
      <Accordion id="settings.promo" title="Promo calendar" defaultOpen={false}>
        {(() => {
          const calendar = m.promoCalendar ?? []
          const range = calendarRange(calendar)
          const problems = calendar.length ? validatePromoCalendar(calendar) : []
          const shownDay = previewDate ?? todayKey()
          const usesHoliday =
            project.scenes.some((s) => s.elements.some((e) => /\{holiday\}|\{promo\}/.test(e.countdown?.format ?? ''))) || /\{holiday\}|\{promo\}/.test(m.header?.dateFormat ?? '')
          const importCalendar = async (): Promise<void> => {
            const picked = await importCsv()
            if (!picked) return
            const { entries, skipped } = parsePromoCsv(picked.text)
            if (!entries.length) {
              setCsvNote(`${picked.name}: no readable rows — the sheet needs Start Date, End Date and Promo columns.`)
              return
            }
            patchMeta({ promoCalendar: entries })
            setCsvNote(
              `${picked.name}: ${entries.length} periods imported` + (skipped.length ? `, ${skipped.length} row(s) skipped (line ${skipped.map((k) => k.line).join(', ')}).` : '.'),
            )
          }
          return (
            <>
              <Row label="Periods">
                <input value={range ? `${calendar.length} · ${range.first} → ${range.last}` : 'none'} readOnly title="Rows in this MIP's promo calendar" />
              </Row>
              <Row label={`On ${shownDay}`}>
                <input value={labelForDate(calendar, shownDay) || '(no promo)'} readOnly title="What {holiday} renders on the previewed day" />
              </Row>
              <Row label="Preview date">
                <input type="date" value={previewDate ?? ''} onChange={(e) => setPreviewDate(e.target.value || null)} />
              </Row>
              <div className="grid3">
                <button onClick={() => void importCalendar()}>Import CSV…</button>
                <button onClick={() => patchMeta({ promoCalendar: DEFAULT_PROMO_CALENDAR.map((e) => ({ ...e })) })}>Load default</button>
                <button
                  disabled={!calendar.length}
                  onClick={() => {
                    patchMeta({ promoCalendar: undefined })
                    setCsvNote(null)
                  }}
                >
                  Clear
                </button>
              </div>
              {csvNote && <div className="hint pad">{csvNote}</div>}
              {problems.map((pb, i) => (
                <div key={i} className={'hint pad ' + (pb.level === 'error' ? 'bad' : 'warn')}>
                  {pb.message}
                </div>
              ))}
              {usesHoliday && !calendar.length && (
                <div className="hint pad bad">
                  This MIP renders <b>{'{holiday}'}</b> but has no calendar — the label will be empty everywhere. Load the default or import the client's CSV.
                </div>
              )}
              <Help>
                Which sale is running on any given day. A <b>Dynamic holiday</b> element (or a <b>{'{holiday}'}</b> token in any date format, the pinned header included) renders
                the row covering the <b>viewer's own</b> date and re-reads it at local midnight; outside the calendar the label is empty, which is what a “only when there is NO
                promo” element covers. <b>Load default</b> is the 2026–2027 US retail calendar. <b>Import CSV…</b> takes the delivered sheet —{' '}
                <b>Year, Start Date, End Date, Promo, Key Holiday Dates</b> — reading Start/End/Promo. Dates are inclusive <b>YYYY-MM-DD</b>. The calendar is stripped from exports
                that never use the token.
              </Help>
            </>
          )
        })()}
      </Accordion>
      <Accordion id="settings.variants" title="Variants" defaultOpen={false}>
        {(m.variants ?? []).map((v) => (
          <div className="var-row" key={v.id}>
            <input value={v.name} onChange={(e) => renameVariant(v.id, e.target.value)} />
            <span className="hint">
              {v.patches.length} override{v.patches.length === 1 ? '' : 's'}
            </span>
            <button onClick={() => editVariant(v.id)} title="Edit this variant">
              Edit
            </button>
            <button className="icon-btn" title="Delete variant" onClick={() => removeVariant(v.id)}>
              <Icon icon={X} size={13} />
            </button>
          </div>
        ))}
        <button className="wide" onClick={() => editVariant(addVariant(''))}>
          Add variant
        </button>
        <Help>
          A variant is the same MIP with a few overrides (mechanic, win condition, swapped asset, text). Export emits one playable per variant. Languages are separate
          (auto-detected at runtime, not a variant).
        </Help>
      </Accordion>
    </Drawer>
  )
}
