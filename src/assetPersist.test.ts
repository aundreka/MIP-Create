// Asset bytes are split between localStorage (metadata) and IndexedDB (the data
// URLs). These cover the seam: a project must come back with its images intact
// across a reload, INCLUDING when IndexedDB refuses the write — historically the
// stripped bundle was stored before the IDB write was confirmed, so a refusal
// erased the only remaining copy and every image opened as a blank box.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const IMG = 'data:image/png;base64,AAAA'

const makeProject = async (): Promise<{ project: never; assets: never }> => {
  const store = await import('./store')
  return {
    project: store.blankProject().project as never,
    assets: { a1: { id: 'a1', kind: 'image', src: IMG, w: 10, h: 10 } } as never,
  }
}

/** Reload the app against the same localStorage + IndexedDB and open `id`. */
async function reopen(id: string): Promise<string | undefined> {
  vi.resetModules()
  const projects = await import('./projects')
  const store = await import('./store')
  await projects.openProject(id)
  return store.getState().assets.a1?.src
}

describe('project asset persistence', { timeout: 30_000 }, () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('keeps asset bytes across a save and reopen', async () => {
    const projects = await import('./projects')
    const id = await projects.createProject(await makeProject())
    await projects.saveCurrent()
    expect(await reopen(id)).toBe(IMG)
  })

  it('stores only metadata in localStorage once the bytes reach IndexedDB', async () => {
    const projects = await import('./projects')
    const id = await projects.createProject(await makeProject())
    await projects.saveCurrent()
    const raw = JSON.parse(localStorage.getItem('pa:proj:' + id) as string) as { assets: Record<string, { src: string }> }
    expect(raw.assets.a1.src).toBe('') // bytes live in IDB, not the 5MB slot
  })

  it('falls back to inline bytes when IndexedDB refuses the write', async () => {
    const assetStore = await import('./assetStore')
    const spy = vi.spyOn(assetStore, 'putAssetBytes').mockResolvedValue(false)
    const projects = await import('./projects')
    const id = await projects.createProject(await makeProject())
    await projects.saveCurrent()
    const raw = JSON.parse(localStorage.getItem('pa:proj:' + id) as string) as { assets: Record<string, { src: string }> }
    expect(raw.assets.a1.src).toBe(IMG) // NOT stripped — IDB never took them
    spy.mockRestore()
    expect(await reopen(id)).toBe(IMG)
  })

  it('a metadata-only re-save never strips bytes that are still inline', async () => {
    const assetStore = await import('./assetStore')
    const spy = vi.spyOn(assetStore, 'putAssetBytes').mockResolvedValue(false)
    const projects = await import('./projects')
    const id = await projects.createProject(await makeProject())
    await projects.saveCurrent()
    spy.mockRestore()
    projects.renameProject(id, 'renamed') // re-saves the slot it just read back
    expect(await reopen(id)).toBe(IMG)
  })
})
