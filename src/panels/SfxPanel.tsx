// Sound panel — maps ad events to audio clips and sets background music. Audio is
// silent on load and only plays after the first tap (ad-container autoplay rules);
// the ▶ test button here plays inside your click so you can audition a clip.

import { setBgm, setSfxBinding, useEditorState } from '../store'
import { Modal, Slider } from '../ui'
import { Check, Icon, Play } from '../icons'
import { AssetPicker } from './AssetPicker'

// The events the runtime currently fires are marked ✓; the rest are available for
// future game templates and won't fire until a game emits them.
const EVENTS: { key: string; label: string; wired?: boolean }[] = [
  { key: 'gameStart', label: 'Game start', wired: true },
  { key: 'correct', label: 'Correct move', wired: true },
  { key: 'wrong', label: 'Wrong move', wired: true },
  { key: 'gameWin', label: 'Game win', wired: true },
  { key: 'ctaClick', label: 'CTA click / endscene tap', wired: true },
  { key: 'endscene', label: 'Endscene shown', wired: true },
  { key: 'tap', label: 'Tap' },
  { key: 'pop', label: 'Pop' },
  { key: 'collect', label: 'Collect' },
  { key: 'merge', label: 'Merge' },
  { key: 'round', label: 'Round' },
  { key: 'gameLose', label: 'Game lose' },
]

export function SfxPanel(props: { onClose: () => void }): JSX.Element {
  const { project, assets } = useEditorState()
  const bindingFor = (event: string): string | undefined => project.sfx?.find((b) => b.event === event)?.assetId
  const bgm = project.bgm

  const test = (assetId?: string): void => {
    if (!assetId) return
    const a = assets[assetId]
    if (!a) return
    const el = new Audio(a.src)
    el.volume = 0.9
    void el.play().catch(() => {})
  }

  return (
    <Modal title="Sound" onClose={props.onClose} size="md">
      <div className="group-title">Background music</div>
      <div className="sfx-row">
        <AssetPicker accept="audio" allowNone value={bgm?.assetId} onChange={(id) => setBgm(id, bgm?.volume)} />
        <span className="sfx-name">{bgm?.assetId ? assets[bgm.assetId]?.src ? bgm.assetId : '(missing)' : 'None (loops once unlocked)'}</span>
        <button className="sfx-test" title="Test" disabled={!bgm?.assetId} onClick={() => test(bgm?.assetId)}>
          <Icon icon={Play} size={13} />
        </button>
      </div>
      {bgm?.assetId && (
        <Slider label="Music volume" value={Math.round((bgm.volume ?? 0.5) * 100)} min={0} max={100} suffix="%" onChange={(n) => setBgm(bgm.assetId, n / 100)} />
      )}

      <div className="group-title">Event sounds</div>
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

      <div className="hint pad">
        Sound is muted until the player’s first tap (ad networks block autoplay). Endscene clips also un-mute on that first
        tap. Volume + mute follow the ad container (MRAID). “soon” events are ready for game templates that emit them.
      </div>
    </Modal>
  )
}
