import { describe, it, expect } from 'vitest'
import { buildMip } from './mipGen'
import { DEFAULT_THEME } from './svgAssets'

describe('buildMip', () => {
  const opts = {
    name: 'TestMIP',
    theme: DEFAULT_THEME,
    gameId: 'scratch',
    bgStyle: 'gradient' as const,
    logo: { src: 'logo', w: 200, h: 100 },
    product: { src: 'prod', w: 100, h: 100 },
    decor: true,
    endscene: { dynamicDate: false, timer: true, badge: true },
  }

  it('scaffolds a game scene + a coded endscene', () => {
    const { project } = buildMip(opts)
    expect(project.scenes).toHaveLength(2)
    expect(project.scenes[0].kind).toBe('game')
    expect(project.scenes[1].kind).toBe('endscene')
    expect(project.meta.name).toBe('TestMIP')
  })

  it('fills the product into product-like game slots and generates the rest', () => {
    const { project, assets } = buildMip(opts)
    const game = project.scenes[0].elements.find((e) => e.type === 'game-mount')!
    const params = game.game!.params as Record<string, unknown>
    // scratch: prize (product-like) uses the product; cover is a generated SVG asset
    const prizeId = params.prize as string
    expect(assets[prizeId].src).toBe('prod')
    const coverId = params.cover as string
    expect(assets[coverId].src.startsWith('data:image/svg+xml,')).toBe(true)
  })

  it('end card has a pulsing CTA + the product, and a timer when requested', () => {
    const { project } = buildMip(opts)
    const end = project.scenes[1]
    expect(end.elements.some((e) => e.type === 'cta' && e.cta?.pulse)).toBe(true)
    expect(end.elements.some((e) => e.type === 'image' && e.name === 'Product' && e.animations?.loop)).toBe(true)
    expect(end.elements.some((e) => e.type === 'countdown')).toBe(true)
    expect(end.advance.on).toBe('manual')
  })
})
