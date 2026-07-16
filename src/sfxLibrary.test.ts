// inlineProjectSfx makes a loaded project's audio self-contained: built-in SFX that
// were stored with a non-portable Vite bundle URL (so imported/shared projects lost
// their sound) are re-inlined from the local build to a data: URL. Assets that are
// already data URLs, or aren't audio, are left alone.

import { describe, it, expect } from 'vitest'
import { inlineProjectSfx } from './sfxLibrary'
import type { AssetMap } from '../runtime/types'

describe('inlineProjectSfx', () => {
  it('returns null when every audio asset is already a data URL', async () => {
    const assets: AssetMap = {
      snd: { src: 'data:audio/wav;base64,AAAA', w: 0, h: 0, kind: 'audio' },
      pic: { src: '/assets/img-abc.png', w: 10, h: 10, kind: 'image' }, // non-audio, ignored
    }
    expect(await inlineProjectSfx(assets)).toBeNull()
  })

  it('does not touch non-audio assets even with a bundle URL', async () => {
    const assets: AssetMap = { pic: { src: '/assets/sfx/notreally.png', w: 4, h: 4, kind: 'image' } }
    expect(await inlineProjectSfx(assets)).toBeNull()
  })

  it('re-inlines a built-in synth SFX stored as a bundle URL to a data URL', async () => {
    // 'sfx_tap' → built-in synth id 'tap' → rendered inline locally (no network).
    const assets: AssetMap = { sfx_tap: { src: '/assets/sfx/tap-9f8e7d.wav', w: 0, h: 0, kind: 'audio' } }
    const changed = await inlineProjectSfx(assets)
    expect(changed).not.toBeNull()
    expect(changed!.sfx_tap.src.startsWith('data:audio')).toBe(true)
    expect(changed!.sfx_tap.kind).toBe('audio') // metadata preserved
  })
})
