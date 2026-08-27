// Project templates — the fix for per-dev MIP drift. Save the whole project
// (chrome, CTA, pulse, SFX, scene flow) + its assets as a portable
// `.playable-template.zip`; importing one starts a new MIP from that locked
// baseline. Also ships a couple of built-in multi-scene starters so a new
// playable begins as game → win → endscene rather than a blank canvas.

import JSZip from 'jszip'
import type { Project, ProjectMeta, SceneDef, SceneElement } from '../runtime/scene'
import type { AssetEntry, AssetMap } from '../runtime/types'
import type { ProjectData } from './bridge'
import { GAME_TEMPLATES } from '../runtime/games/registry'
import { sfxPreviewUrl } from './sfxLibrary'

const sfxAsset = (id: string): AssetEntry => ({ src: sfxPreviewUrl(id), w: 0, h: 0, kind: 'audio' })

const VERSION = 1

// ---- .playable-template.zip I/O -------------------------------------------
export async function buildTemplateZip(data: ProjectData, name: string): Promise<Blob> {
  const zip = new JSZip()
  zip.file('template.json', JSON.stringify({ version: VERSION, name, project: data.project, assets: data.assets }))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export async function readTemplateZip(file: File): Promise<ProjectData | null> {
  try {
    const zip = await JSZip.loadAsync(file)
    const entry = zip.file('template.json')
    if (!entry) return null
    const m = JSON.parse(await entry.async('string')) as { project?: Project; assets?: AssetMap }
    if (m?.project?.scenes) return { project: m.project, assets: m.assets ?? {} }
    return null
  } catch {
    return null
  }
}

// ---- built-in starters -----------------------------------------------------
function meta(name: string): ProjectMeta {
  return {
    schemaVersion: 1,
    name,
    clickUrl: { ios: 'https://apps.apple.com/app/id000000000', android: 'https://play.google.com/store/apps/details?id=com.example.app' },
    baseW: 1080,
    baseH: 1920,
    bgMatchColor: '#101a33',
  }
}
const C = 540
const headerBlock = (gid: string): SceneElement[] => [
  { id: gid + '_bar', type: 'bar', name: 'Header bar', x: C, y: 0, h: 170, anchor: 'top', zIndex: 10, mode: 'extend', pin: 'top', bar: { color: '#1b2a4a' }, groupId: gid },
  { id: gid + '_logo', type: 'text', name: 'Brand', x: C, y: 88, anchor: 'center', zIndex: 11, mode: 'fit', text: { value: 'BRAND', fontSizePx: 64, fontWeight: 800, color: '#ffffff', align: 'center' }, groupId: gid },
]
const cta = (id: string, y: number, showOnWin?: boolean): SceneElement => ({
  id,
  type: 'cta',
  name: 'CTA button',
  x: C,
  y,
  w: 600,
  h: 160,
  anchor: 'center',
  zIndex: 30,
  mode: 'fit',
  hidden: showOnWin,
  showOnWin,
  cta: { pulse: 'medium' },
  text: { value: 'PLAY NOW', fontSizePx: 66, fontWeight: 800, color: '#ffffff' },
  box: { bgColor: '#16a34a', radiusPx: 80, shadow: 'soft' },
  animations: showOnWin ? { entrance: { preset: 'pop', durationMs: 420, delayMs: 0, easing: 'ease-out', trigger: 'onGameWin' } } : undefined,
})
const winScene = (): SceneDef => ({
  id: 'win',
  name: 'Win',
  kind: 'overlay',
  advance: { on: 'timer', delayMs: 1400 },
  transition: { type: 'fade', durationMs: 300 },
  elements: [
    { id: 'win_dim', type: 'dim', name: 'Dim', x: C, y: 960, anchor: 'center', zIndex: 50, mode: 'fit', dim: { color: '#0a1024', alpha: 0.72 }, sfx: [{ event: 'sceneEnter', assetId: 'sfx_f_correctBright' }] },
    { id: 'win_txt', type: 'text', name: 'Congrats', x: C, y: 820, anchor: 'center', zIndex: 51, mode: 'fit', text: { value: 'You won!', fontSizePx: 130, fontWeight: 800, color: '#ffffff', align: 'center' }, animations: { entrance: { preset: 'pop', durationMs: 450, delayMs: 0, easing: 'ease-out', trigger: 'onMount' } } },
  ],
})
const endScene = (): SceneDef => ({
  id: 'end',
  name: 'Endscene',
  kind: 'endscene',
  advance: { on: 'manual' },
  transition: { type: 'fade', durationMs: 350 },
  elements: [
    { id: 'end_video', type: 'endscene', name: 'Endscene video', x: C, y: 960, w: 1080, h: 1920, anchor: 'center', zIndex: 1, mode: 'extend', endscene: { objectFit: 'cover', bgColor: '#000000', loop: true }, sfx: [{ event: 'sceneEnter', assetId: 'sfx_f_winJingle' }] },
    { id: 'end_title', type: 'text', name: 'Endscene title', x: C, y: 560, anchor: 'center', zIndex: 11, mode: 'fit', text: { value: 'Get the app!', fontSizePx: 120, fontWeight: 800, color: '#ffffff', align: 'center' } },
    cta('end_cta', 1150),
  ],
})

export interface Starter {
  id: string
  label: string
  description: string
  build: () => ProjectData
}

export const STARTERS: Starter[] = [
  {
    id: 'classic',
    label: 'Match → Win → Endscene',
    description: 'Header + match game, win overlay, then a video endscene with CTA.',
    build: () => ({
      assets: {
        sfx_f_correctBright: sfxAsset('f_correctBright'),
        sfx_f_winJingle: sfxAsset('f_winJingle'),
      },
      project: {
        meta: meta('New playable'),
        startSceneId: 'game',
        scenes: [
          {
            id: 'game',
            name: 'Game',
            kind: 'game',
            advance: { on: 'gameWin', delayMs: 400 },
            transition: { type: 'fade', durationMs: 250 },
            elements: [
              ...headerBlock('hdr'),
              { id: 'game_title', type: 'text', name: 'Prompt', x: C, y: 320, anchor: 'center', zIndex: 12, mode: 'fit', text: { value: 'Match the pairs!', fontSizePx: 72, fontWeight: 800, color: '#ffffff', align: 'center' } },
              { id: 'game_mount', type: 'game-mount', name: 'Mini-game', x: C, y: 1080, w: 980, h: 1100, anchor: 'center', zIndex: 5, mode: 'fit', game: { templateId: 'match', params: { count: 4, images: [] }, hintEnabled: true, hintIdleMs: 4000 } },
            ],
          },
          winScene(),
          endScene(),
        ],
      },
    }),
  },
  {
    id: 'spin',
    label: 'Spin & win → Endscene',
    description: 'Header + spin wheel; winning advances straight to the endscene CTA.',
    build: () => ({
      assets: {
        sfx_f_winJingle: sfxAsset('f_winJingle'),
      },
      project: {
        meta: meta('Spin playable'),
        startSceneId: 'game',
        scenes: [
          {
            id: 'game',
            name: 'Spin',
            kind: 'game',
            advance: { on: 'gameWin', delayMs: 600 },
            transition: { type: 'slide-left', durationMs: 350 },
            elements: [
              ...headerBlock('hdr'),
              { id: 'spin_title', type: 'text', name: 'Prompt', x: C, y: 340, anchor: 'center', zIndex: 12, mode: 'fit', text: { value: 'Spin to win!', fontSizePx: 84, fontWeight: 800, color: '#ffffff', align: 'center' } },
              { id: 'spin_mount', type: 'game-mount', name: 'Spin wheel', x: C, y: 1080, w: 980, h: 1100, anchor: 'center', zIndex: 5, mode: 'fit', game: { templateId: 'spin', params: { segments: 6, winIndex: 0, turns: 4 }, hintEnabled: true, hintIdleMs: 3500 } },
            ],
          },
          endScene(),
        ],
      },
    }),
  },
]

// One Starter per registered mini-game — a ready game → win → endscene flow built
// around that template's defaults. Lets the home screen offer "create from a game
// template" for every preexisting game, not just the two hand-authored starters.
export function gameTemplateStarters(): Starter[] {
  return GAME_TEMPLATES.map((t) => ({
    id: 'game:' + t.id,
    label: t.label,
    description: `Start a game → win → endscene flow with the ${t.label} mini-game.`,
    build: (): ProjectData => {
      const isScratch = t.id === 'scratch' || t.id === 'scratch_grid'
      const isCatch = t.id === 'catch'
      // A progress bar is a strip near the top, not a play area — the shared square
      // mount below would render it as an enormous pill. See addGameScene.
      const isBar = t.id === 'progressbar'
      const mount = isBar ? { y: 230, w: 864, h: 58 } : { y: 1080, w: 980, h: 1100 }
      const catchElements: SceneElement[] = isCatch ? [
        // headerScale: sized by one transform with an unrounded anchor, the way the pinned
        // date band is (header.ts). A score sits inside artwork, where a half-pixel of layout
        // rounding reads as the number creeping out of its badge as the screen resizes.
        { id: 'score_counter', type: 'text', name: 'Score Counter', x: C, y: 150, anchor: 'center', zIndex: 13, mode: 'fit', headerScale: true, text: { value: '0', fontSizePx: 48, fontWeight: 800, color: '#ffffff', align: 'center' } },
        { id: 'basket_bar', type: 'bar', name: 'Footer bar', x: C, y: 1920, h: 170, anchor: 'bottom', zIndex: 10, mode: 'extend', pin: 'bottom', bar: { color: '#1b2a4a' } },
      ] : []
      return {
        assets: {
          sfx_f_correctBright: sfxAsset('f_correctBright'),
          sfx_f_winJingle: sfxAsset('f_winJingle'),
          ...(isScratch ? { sfx_f_scratch: sfxAsset('f_scratch') } : {}),
        },
        project: {
          meta: meta(t.label),
          startSceneId: 'game',
          scenes: [
            {
              id: 'game',
              name: t.label,
              kind: 'game',
              advance: { on: 'gameWin', delayMs: 400 },
              transition: { type: 'fade', durationMs: 250 },
              elements: [
                ...headerBlock('hdr'),
                { id: 'game_title', type: 'text', name: 'Prompt', x: C, y: 320, anchor: 'center', zIndex: 12, mode: 'fit', text: { value: isCatch ? 'Catch them all!' : 'Tap to play!', fontSizePx: 72, fontWeight: 800, color: '#ffffff', align: 'center' } },
                ...catchElements,
                { id: 'game_mount', type: 'game-mount', name: t.label, x: C, y: mount.y, w: mount.w, h: mount.h, anchor: 'center', zIndex: 5, mode: 'fit', game: { templateId: t.id, params: { ...t.defaultParams }, hintEnabled: true, hintIdleMs: t.defaultHintIdleMs ?? 4000 }, sfx: isScratch ? [{ event: 'whileScratching', assetId: 'sfx_f_scratch' }, { event: 'onReveal', assetId: 'sfx_f_correctBright' }] : undefined },
              ],
            },
            ...(isScratch ? [] : [winScene()]),
            endScene(),
          ],
        },
      }
    },
  }))
}
