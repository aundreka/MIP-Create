// MIP generator. Given a game type + the (always-supplied) logo & product images
// + a brand theme, it scaffolds a complete, fully-editable MIP: a game scene
// (coded-SVG background + logo + the game with its asset slots filled) and a coded
// MRAID end card (product with animations + pulsing CTA + optional date/timer/
// decor). No external image API — surrounding art is procedural SVG.

import type { GameMountConfig, Project, SceneDef, SceneElement } from '../runtime/scene'
import type { AssetMap } from '../runtime/types'
import { getTemplate } from '../runtime/games/registry'
import { nextId } from './store'
import { svgBackground, svgBadge, svgCard, svgTile, type BgStyle, type Theme } from './svgAssets'

export interface UploadAsset {
  src: string
  w: number
  h: number
}
export interface MipGenOptions {
  name: string
  theme: Theme
  gameId: string
  bgStyle: BgStyle
  logo?: UploadAsset
  product?: UploadAsset
  decor: boolean
  endscene: { dynamicDate: boolean; timer: boolean; badge: boolean }
}

const PRODUCT_SLOT = /prize|product|reward|win|gift|item|hero|character|object/i

export function buildMip(opts: MipGenOptions): { project: Project; assets: AssetMap } {
  const baseW = 1080
  const baseH = 1920
  const cx = baseW / 2
  const { theme } = opts
  const assets: AssetMap = {}
  const add = (a: { src: string; w: number; h: number }): string => {
    const id = nextId('gen')
    assets[id] = { src: a.src, w: a.w, h: a.h }
    return id
  }
  const logoId = opts.logo ? add(opts.logo) : undefined
  const productId = opts.product ? add(opts.product) : undefined

  const bg = (): SceneElement => ({
    id: nextId('bg'),
    type: 'background',
    name: 'Background',
    assetId: add(svgBackground(theme, opts.bgStyle, baseW, baseH)),
    x: cx,
    y: baseH / 2,
    anchor: 'center',
    zIndex: 0,
    mode: 'extend',
    background: { objectFit: 'cover' },
  })
  const logoEl = (y: number, h: number): SceneElement | null =>
    logoId ? { id: nextId('logo'), type: 'image', name: 'Logo', assetId: logoId, x: cx, y, w: Math.round((opts.logo!.w / opts.logo!.h) * h), h, anchor: 'center', zIndex: 30, mode: 'fit' } : null

  // ---- game scene ----------------------------------------------------------
  const tpl = getTemplate(opts.gameId)
  const params: Record<string, unknown> = { ...(tpl?.defaultParams ?? {}) }
  for (const slot of tpl?.assetSlots ?? []) {
    if (slot.accept && slot.accept !== 'image') continue
    const wantsProduct = PRODUCT_SLOT.test(slot.key) || PRODUCT_SLOT.test(slot.label)
    if (slot.list) {
      const n = Math.max(2, Math.min(8, Number(params[slot.countParam ?? '']) || 4))
      params[slot.key] = Array.from({ length: n }, (_, i) => (wantsProduct && productId ? productId : add(svgTile(theme, i))))
    } else {
      params[slot.key] = wantsProduct && productId ? productId : add(svgCard(theme))
    }
  }
  const game: GameMountConfig = { templateId: opts.gameId, params, hintEnabled: true, hintIdleMs: 4000 }
  const gameScene: SceneDef = {
    id: nextId('scene'),
    name: 'Game',
    kind: 'game',
    bgColor: theme.bg1,
    advance: { on: 'gameWin', delayMs: 600 },
    transition: { type: 'fade', durationMs: 300 },
    elements: [
      bg(),
      ...(logoEl(Math.round(baseH * 0.08), 120) ? [logoEl(Math.round(baseH * 0.08), 120)!] : []),
      { id: nextId('text'), type: 'text', name: 'Title', x: cx, y: Math.round(baseH * 0.16), w: Math.round(baseW * 0.86), anchor: 'center', zIndex: 30, mode: 'fit', text: { value: 'Tap to play!', fontSizePx: 64, fontWeight: 800, color: theme.ink, align: 'center', maxWidthPx: Math.round(baseW * 0.86) } },
      { id: nextId('game'), type: 'game-mount', name: tpl?.label ?? 'Mini-game', x: cx, y: Math.round(baseH * 0.56), w: Math.round(baseW * 0.92), h: Math.round(baseH * 0.56), anchor: 'center', zIndex: 10, mode: 'fit', game },
    ],
  }

  // ---- coded MRAID end card -------------------------------------------------
  const endEls: SceneElement[] = [bg()]
  const endLogo = logoEl(Math.round(baseH * 0.1), 110)
  if (endLogo) endEls.push(endLogo)
  if (opts.endscene.dynamicDate) {
    endEls.push({ id: nextId('date'), type: 'countdown', name: 'Dynamic date', x: cx, y: Math.round(baseH * 0.2), anchor: 'center', zIndex: 30, mode: 'fit', text: { value: '', fontSizePx: 52, fontWeight: 700, color: theme.ink, align: 'center' }, countdown: { mode: 'dynamic', dynamicDays: 3, format: 'Offer ends {date}', dateStyle: 'short' } })
  }
  if (opts.endscene.timer) {
    endEls.push({ id: nextId('timer'), type: 'countdown', name: 'Countdown', x: cx, y: Math.round(baseH * 0.27), anchor: 'center', zIndex: 30, mode: 'fit', text: { value: '', fontSizePx: 84, fontWeight: 800, color: theme.primary, align: 'center' }, countdown: { mode: 'dynamic', dynamicDays: 1, format: '{hh}:{mm}:{ss}' } })
  }
  if (opts.endscene.badge) {
    const badge = svgBadge(theme, 'WIN')
    endEls.push({ id: nextId('badge'), type: 'image', name: 'Badge', assetId: add(badge), x: Math.round(baseW * 0.78), y: Math.round(baseH * 0.4), w: 260, h: 260, anchor: 'center', zIndex: 35, mode: 'fit', rotation: 12, animations: { loop: { preset: 'pulse', durationMs: 1400, delayMs: 0, easing: 'ease-in-out', iterations: 'infinite' } } })
  }
  if (productId) {
    // product with animations (always, per the coded-endcard recipe)
    endEls.push({ id: nextId('prod'), type: 'image', name: 'Product', assetId: productId, x: cx, y: Math.round(baseH * 0.45), w: Math.round((opts.product!.w / opts.product!.h) * Math.round(baseH * 0.34)), h: Math.round(baseH * 0.34), anchor: 'center', zIndex: 32, mode: 'fit', animations: { entrance: { preset: 'pop', durationMs: 500, delayMs: 120, easing: 'ease-out', trigger: 'onMount' }, loop: { preset: 'float', durationMs: 2600, delayMs: 0, easing: 'ease-in-out', iterations: 'infinite' } } })
  }
  endEls.push({ id: nextId('text'), type: 'text', name: 'Headline', x: cx, y: Math.round(baseH * 0.68), w: Math.round(baseW * 0.86), anchor: 'center', zIndex: 33, mode: 'fit', text: { value: `Get ${opts.name}`, fontSizePx: 84, fontWeight: 800, color: theme.ink, align: 'center', maxWidthPx: Math.round(baseW * 0.86) } })
  // pulsing CTA
  endEls.push({ id: nextId('cta'), type: 'cta', name: 'CTA', x: cx, y: Math.round(baseH * 0.82), w: Math.round(baseW * 0.8), h: 170, anchor: 'center', zIndex: 40, mode: 'fit', cta: { pulse: 'strong' }, text: { value: 'PLAY NOW', fontSizePx: 60, fontWeight: 800, color: '#ffffff' }, box: { bgColor: theme.accent, radiusPx: 85 } })

  const endScene: SceneDef = {
    id: nextId('scene'),
    name: 'End card',
    kind: 'endscene', // coded → wrapped as an MRAID click-through end card by the runtime
    bgColor: theme.bg1,
    advance: { on: 'manual' },
    transition: { type: 'fade', durationMs: 300 },
    elements: endEls,
  }

  const project: Project = {
    meta: {
      schemaVersion: 1,
      name: opts.name,
      clickUrl: { ios: 'https://apps.apple.com/app/id000000000', android: 'https://play.google.com/store/apps/details?id=com.example.app' },
      baseW,
      baseH,
      bgMatchColor: theme.bg1,
    },
    scenes: [gameScene, endScene],
    startSceneId: gameScene.id,
  }
  return { project, assets }
}
