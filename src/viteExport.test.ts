import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { Project } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import { buildViteProjectCollectionZip, buildViteProjectZip, extractMediaFiles } from './viteExport'

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
      { folderName: 'MIP1 - SCRATCH', project: project('Playable One', 'MIP1'), assets: assets('AAA') },
      { folderName: 'MIP2', project: project('Playable Two', 'MIP2'), assets: assets('BBB') },
    ])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())

    expect(Object.keys(zip.files)).toContain('project/MIP1 - SCRATCH/package.json')
    expect(Object.keys(zip.files)).toContain('project/MIP1 - SCRATCH/src/project.json')
    expect(Object.keys(zip.files)).toContain('project/MIP2/package.json')
    expect(Object.keys(zip.files)).toContain('project/MIP2/src/assets.json')

    const second = JSON.parse(await zip.file('project/MIP2/src/project.json')!.async('string')) as Project
    expect(second.meta.mip).toBe('MIP2')
  })

  it('extracts images, audio and fonts but keeps HTML cards and their host refs inline', () => {
    const card = `data:text/html;base64,${btoa('<video src=""></video><script>v.src=parent.PA_ASSETS["card__p"].src</script>')}`
    const { assets: out, files } = extractMediaFiles({
      logo: { src: `data:image/webp;base64,${btoa('webp')}`, w: 1, h: 1 },
      'sfx f/click': { src: `data:audio/mpeg;base64,${btoa('mp3')}`, w: 0, h: 0, kind: 'audio' },
      Poppins: { src: `data:font/ttf;base64,${btoa('ttf')}`, w: 0, h: 0, kind: 'font' },
      card: { src: card, w: 1, h: 1, kind: 'html' },
      card__p: { src: `data:video/mp4;base64,${btoa('mp4')}`, w: 1, h: 1, kind: 'video' },
      remote: { src: 'https://cdn.example.com/a.png', w: 1, h: 1 },
    })

    expect(files.map((f) => f.path).sort()).toEqual(['public/media/Poppins.ttf', 'public/media/logo.webp', 'public/media/sfx_f_click.mp3'])
    expect(out.logo.src).toBe('media/logo.webp')
    expect(out['sfx f/click'].src).toBe('media/sfx_f_click.mp3')
    expect(new TextDecoder().decode(files.find((f) => f.path.endsWith('logo.webp'))!.data as Uint8Array)).toBe('webp')
    expect(out.card.src).toBe(card)
    expect(out.card__p.src.startsWith('data:video/mp4')).toBe(true)
    expect(out.remote.src).toBe('https://cdn.example.com/a.png')
  })
})
