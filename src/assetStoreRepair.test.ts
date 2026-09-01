// A `pa-assets` database that exists at some version but has NO object store is
// silently fatal: `indexedDB.open` succeeds so nothing reports an error, yet every
// transaction throws NotFoundError — reads return nothing and writes fail forever,
// blanking every image in the editor. It is left behind by an upgrade interrupted
// mid-flight. openDb() must detect and repair it.
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'

/** Create `pa-assets` at v1 with no object store, the way a broken upgrade does. */
function makeStorelessDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pa-assets', 1)
    req.onupgradeneeded = () => {
      /* deliberately create no object store */
    }
    req.onsuccess = () => {
      req.result.close()
      resolve()
    }
    req.onerror = () => reject(new Error('setup open failed'))
  })
}

describe('assetStore recovery from a store-less database', { timeout: 30_000 }, () => {
  it('repairs the missing object store and round-trips bytes', async () => {
    await makeStorelessDb()
    const { getAssetBytes, putAssetBytes } = await import('./assetStore')
    expect(await putAssetBytes('p1', { a: 'data:img' })).toBe(true)
    expect((await getAssetBytes('p1', ['a'])).a).toBe('data:img')
  })
})
