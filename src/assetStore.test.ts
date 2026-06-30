// Verifies the IndexedDB asset-byte store via fake-indexeddb. (The rest of the
// suite runs without IndexedDB, exercising the localStorage fallback path.)
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { copyProjectAssets, deleteProjectAssets, getAssetBytes, idbAvailable, putAssetBytes } from './assetStore'

describe('assetStore (IndexedDB)', () => {
  it('reports available with fake-indexeddb installed', () => {
    expect(idbAvailable()).toBe(true)
  })

  it('round-trips bytes and omits missing ids', async () => {
    await putAssetBytes('rt', { a: 'data:a', b: 'data:b' })
    expect(await getAssetBytes('rt', ['a', 'b', 'nope'])).toEqual({ a: 'data:a', b: 'data:b' })
  })

  it('isolates bytes by project id', async () => {
    await putAssetBytes('iso1', { k: 'one' })
    await putAssetBytes('iso2', { k: 'two' })
    expect((await getAssetBytes('iso1', ['k'])).k).toBe('one')
    expect((await getAssetBytes('iso2', ['k'])).k).toBe('two')
  })

  it('copies bytes under a new project id (duplicate)', async () => {
    await putAssetBytes('src', { a: 'A', b: 'B' })
    await copyProjectAssets('src', 'dst', ['a', 'b'])
    expect(await getAssetBytes('dst', ['a', 'b'])).toEqual({ a: 'A', b: 'B' })
  })

  it('deletes a project’s bytes without touching others', async () => {
    await putAssetBytes('del', { a: 'A' })
    await putAssetBytes('keep', { a: 'K' })
    await deleteProjectAssets('del')
    expect(await getAssetBytes('del', ['a'])).toEqual({})
    expect((await getAssetBytes('keep', ['a'])).a).toBe('K')
  })

  it('putting only some ids never clears the rest (metadata re-save safe)', async () => {
    await putAssetBytes('safe', { a: 'A', b: 'B' })
    await putAssetBytes('safe', {}) // a metadata-only re-save writes nothing
    expect(await getAssetBytes('safe', ['a', 'b'])).toEqual({ a: 'A', b: 'B' })
  })
})
