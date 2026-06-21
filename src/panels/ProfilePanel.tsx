// Profile — per-user settings stored on this computer. Holds the Figma personal
// access token so it never has to be re-entered (the Figma import reads it from
// here). Token lives in localStorage; nothing is sent anywhere except Figma's API
// during an import.

import { useState } from 'react'
import { getToken, setToken } from '../figma'
import { Check, Icon } from '../icons'
import { Modal } from '../ui'

export function ProfilePanel(props: { onClose: () => void }): JSX.Element {
  const [token, setTok] = useState(getToken())
  const update = (v: string): void => {
    setTok(v)
    setToken(v)
  }

  return (
    <Modal title="Profile" onClose={props.onClose} size="md">
      <div className="group-title">Figma access</div>
      <label className="field">
        <span>
          Personal access token:{' '}
          <a href="https://www.figma.com/developers/api#access-tokens" target="_blank" rel="noreferrer">
            Figma → Settings → Security → personal access tokens
          </a>
        </span>
        <input type="password" value={token} placeholder="figd_…" onChange={(e) => update(e.target.value)} />
      </label>
      {token ? (
        <div className="sfx-row">
          <span className="saved-note">
            <Icon icon={Check} size={12} strokeWidth={3} /> saved on this computer; Figma import won’t ask again
          </span>
          <span className="spacer" />
          <button onClick={() => update('')}>Clear</button>
        </div>
      ) : (
        <div className="hint pad">Paste your token once here; the Figma import will use it automatically.</div>
      )}

      <div className="hint pad">
        Stored only in this browser/app (localStorage). It’s sent solely to Figma’s API when you import a frame. If your
        token ever leaks, regenerate it in Figma, which instantly invalidates the old one.
      </div>
    </Modal>
  )
}
