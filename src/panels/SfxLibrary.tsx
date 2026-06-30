// Built-in sound picker. Lists the synthesized SFX palette grouped by category;
// preview any clip, then "Use" adds it to the shared asset library and returns its
// asset id to the caller (an AssetPicker audio slot).

import { importAudio } from '../bridge'
import { addAsset, nextId } from '../store'
import { ensureLibrarySfx, sfxItems, sfxPreviewUrl } from '../sfxLibrary'
import { Icon, Play, Upload } from '../icons'
import { Modal } from '../ui'

export function SfxLibrary(props: { onPick: (assetId: string) => void; onClose: () => void }): JSX.Element {
  const items = sfxItems()
  const groups = [...new Set(items.map((i) => i.group))]
  const audition = (id: string): void => {
    const el = new Audio(sfxPreviewUrl(id))
    el.volume = 0.9
    void el.play().catch(() => {})
  }
  const upload = async (): Promise<void> => {
    const aud = await importAudio()
    if (!aud) return
    const id = aud.id || nextId('aud')
    addAsset(id, { src: aud.src, w: 0, h: 0, kind: 'audio' })
    props.onPick(id)
    props.onClose()
  }
  return (
    <Modal title="Sound library" onClose={props.onClose} size="md">
      <button className="wide" onClick={() => void upload()}>
        <Icon icon={Upload} size={14} /> Upload your own…
      </button>
      {groups.map((g) => (
        <div key={g}>
          <div className="group-title">{g}</div>
          <div className="sfxlib-grid">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <div className="sfxlib-cell" key={i.id}>
                  <button className="sfxlib-play" title="Preview" onClick={() => audition(i.id)}>
                    <Icon icon={Play} size={13} />
                  </button>
                  <span className="sfxlib-name">{i.label}</span>
                  <button
                    className="sfxlib-use"
                    onClick={() => {
                      void ensureLibrarySfx(i.id).then((aid) => {
                        props.onPick(aid)
                        props.onClose()
                      })
                    }}
                  >
                    Use
                  </button>
                </div>
              ))}
          </div>
        </div>
      ))}
      <div className="hint pad">Built-in sounds are added to your asset library and exported with the playable.</div>
    </Modal>
  )
}
