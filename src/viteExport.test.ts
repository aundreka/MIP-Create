import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import { buildViteProjectCollectionZip, buildViteProjectZip } from './viteExport'

function project(name: string, mip?: string): Project {
  return {
    meta: {
      schemaVersion: 1,
      name,
      mip,
      clickUrl: { ios: '', android: '' },
      baseW: 1080,
      baseH: 1920,
    },
    scenes: [{
      id: 'scene1',
      name: 'Scene 1',
      kind: 'game',
      advance: { on: 'manual' },
      elements: [],
    }],
    startSceneId: 'scene1',
  }
}

const assets = (label: string): AssetMap => ({
  hero: {
    src: `data:image/png;base64,${label}`,
    w: 10,
    h: 10,
  },
})

describe('viteExport', () => {
  it('builds a single playable Vite zip', async () => {
    const blob = await buildViteProjectZip(project('Playable One', 'MIP1'), assets('AAA'))
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())

    expect(Object.keys(zip.files)).toContain('package.json')
    expect(Object.keys(zip.files)).toContain('src/project.json')
    expect(Object.keys(zip.files)).toContain('src/assets.json')

    const saved = JSON.parse(await zip.file('src/project.json')!.async('string')) as Project
    expect(saved.meta.name).toBe('Playable One')
  })

  it('ships the MRAID guard in index.html and the ready gate in main.ts', async () => {
    const blob = await buildViteProjectZip(project('Playable One', 'MIP1'), assets('AAA'))
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())

    const html = await zip.file('index.html')!.async('string')
    expect(html).toContain('<script src="mraid.js"></script>')
    expect(html).toMatch(/window\.isMraidUsable\(mraid\)/)
    expect(html).toMatch(/mraid\.open\(clickTarget\)/)

    // This export builds its own bundle, so it carries the gate in source: boot() must not
    // run while the container reports loading.
    const main = await zip.file('src/main.ts')!.async('string')
    expect(main).toMatch(/if \(mraid\.getState\(\) === 'loading'\)/)
    expect(main).toMatch(/mraid\.addEventListener\('ready', startCreative\)/)
    expect(main.indexOf('startCreative')).toBeLessThan(main.indexOf('boot(project'))
  })

  it('builds a grouped zip with one Vite repo per MIP folder', async () => {
    const blob = await buildViteProjectCollectionZip('project', [
      { folderName: 'mip1', project: project('Playable One', 'MIP1'), assets: assets('AAA') },
      { folderName: 'mip2', project: project('Playable Two', 'MIP2'), assets: assets('BBB') },
    ])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())

    expect(Object.keys(zip.files)).toContain('project/mip1/package.json')
    expect(Object.keys(zip.files)).toContain('project/mip1/src/project.json')
    expect(Object.keys(zip.files)).toContain('project/mip2/package.json')
    expect(Object.keys(zip.files)).toContain('project/mip2/src/assets.json')

    const second = JSON.parse(await zip.file('project/mip2/src/project.json')!.async('string')) as Project
    expect(second.meta.mip).toBe('MIP2')
  })
})
