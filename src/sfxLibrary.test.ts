// inlineProjectSfx makes a loaded project's audio self-contained: built-in SFX that
// were stored with a non-portable Vite bundle URL (so imported/shared projects lost
// their sound) are re-inlined from the local build to a data: URL. Assets that are
// already data URLs, or aren't audio, are left alone.

import { describe, it, expect } from 'vitest'
import { inlineProjectSfx, sfxAssetSrc, sfxPreviewUrl } from './sfxLibrary'
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

  // A built-in SFX needs NO stored bytes to be recovered — its `sfx_<id>` key is
  // enough to re-render/re-inline it from the local build. Skipping empty-src
  // entries meant an asset whose bytes were lost (see the IndexedDB byte-store
  // bug fixed in projects.ts) stayed silent forever, even though it was trivially
  // recoverable. That is what "some SFX stopped working" looks like.
  it('recovers a built-in synth SFX whose bytes were lost (empty src)', async () => {
    const assets: AssetMap = { sfx_tap: { src: '', w: 0, h: 0, kind: 'audio' } }
    const changed = await inlineProjectSfx(assets)
    expect(changed).not.toBeNull()
    expect(changed!.sfx_tap.src.startsWith('data:audio')).toBe(true)
  })

  it('leaves a lost NON-built-in audio asset alone (nothing to recover it from)', async () => {
    const assets: AssetMap = { up_1: { src: '', w: 0, h: 0, kind: 'audio' } }
    expect(await inlineProjectSfx(assets)).toBeNull()
  })
})

// sfxPreviewUrl returns a CONTENT-HASHED bundle URL for recorded clips, which dies
// on the next build/deploy. Seeding an asset with one is what silenced the scratch
// loop, so the two must stay distinct: sfxAssetSrc is the persistence-grade one.
describe('sfxAssetSrc', () => {
  it('gives a synth clip a self-contained data URL', () => {
    expect(sfxAssetSrc('tap').startsWith('data:audio')).toBe(true)
  })

  it('matches sfxPreviewUrl for synth clips (both already inline)', () => {
    expect(sfxAssetSrc('tap')).toBe(sfxPreviewUrl('tap'))
  })

  it('never returns an empty src for a known recorded clip', () => {
    expect(sfxAssetSrc('f_scratch')).not.toBe('')
  })
})
