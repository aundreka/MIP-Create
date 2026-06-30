// "Select 1 Model and 1 Song" → generate. Two distinct pools: pick one MODEL
// (a photo) and one SONG (an album cover); each fills its slot. Once both are
// chosen, tap/swipe to generate — a circular % runs, then the result reveals (a
// supplied video, else a card composited from the two picks). Fires gameWin.
//
// Drag-and-drop: drop your model photos into "Model photos", your covers into
// "Song covers", and (optionally) the finished clip into "Result video".

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num, str } from './types'

const center = (el: HTMLElement): Pt => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function createSongmix(): GameModule {
  let ctx: GameContext
  let accent = '#7c3aed'
  let prompt = 'Select 1 Model and 1 Song'
  let genLabel = 'Tap to generate'
  let cols = 3
  let models: string[] = []
  let songs: string[] = []
  let resultSrc = ''
  let resultIsVideo = false

  let stage: 'model' | 'song' | 'gen' | 'done' = 'model'
  let modelPick = ''
  let songPick = ''
  let started = false
  let completeCb: (() => void) | null = null

  let promptEl: HTMLDivElement
  let coachEl: HTMLDivElement
  let modelSlot: HTMLDivElement
  let songSlot: HTMLDivElement
  let plusEl: HTMLDivElement
  let big: HTMLDivElement
  const thumbs: HTMLDivElement[] = []

  const slotCss = (filled: boolean): string =>
    `position:absolute;box-sizing:border-box;border-radius:18px;display:flex;align-items:center;justify-content:center;` +
    `color:rgba(255,255,255,.5);font-weight:800;background:center/cover no-repeat;` +
    (filled ? '' : 'border:2px dashed rgba(255,255,255,.4);')

  const fillSlot = (slot: HTMLDivElement, src: string): void => {
    slot.style.cssText = slotCss(true) + (slot === modelSlot ? leftSlotPos() : rightSlotPos())
    slot.style.backgroundImage = `url("${src}")`
    slot.textContent = ''
  }

  // positions are filled in by layout(); kept as fns so fillSlot can reuse them
  let leftSlotPos = (): string => ''
  let rightSlotPos = (): string => ''

  const clearThumbs = (): void => {
    thumbs.forEach((t) => t.remove())
    thumbs.length = 0
  }

  const renderThumbs = (list: string[]): void => {
    clearThumbs()
    list.forEach((src) => {
      const el = document.createElement('div')
      el.style.cssText = `position:absolute;box-sizing:border-box;border-radius:16px;cursor:pointer;background:#33405e center/cover no-repeat;box-shadow:0 8px 20px rgba(0,0,0,.35);`
      if (src) el.style.backgroundImage = `url("${src}")`
      big.appendChild(el)
      thumbs.push(el)
    })
    layoutThumbs()
    if (started) thumbs.forEach((el, i) => el.addEventListener('pointerdown', () => choose(i)))
  }

  const choose = (i: number): void => {
    const src = (stage === 'model' ? models : songs)[i] ?? ''
    ctx.sfx.play('correct')
    if (stage === 'model') {
      modelPick = src
      fillSlot(modelSlot, src)
      stage = 'song'
      coachEl.textContent = 'Tap a song'
      renderThumbs(songs)
    } else if (stage === 'song') {
      songPick = src
      fillSlot(songSlot, src)
      stage = 'gen'
      coachEl.textContent = genLabel
      showGenerate()
    }
  }

  const showGenerate = (): void => {
    clearThumbs()
    big.innerHTML = ''
    const btn = document.createElement('div')
    btn.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.7);font-weight:700;font-size:${(ctx.root.clientWidth || 300) * 0.05}px;cursor:pointer;`
    btn.textContent = genLabel
    big.appendChild(btn)
    big.style.cursor = 'pointer'
    if (started) big.addEventListener('pointerdown', generate, { once: true })
  }

  const generate = (): void => {
    if (stage !== 'gen') return
    stage = 'done'
    ctx.sfx.play('gameStart')
    big.innerHTML = ''
    big.style.cursor = 'default'
    const sz = Math.min(big.clientWidth, big.clientHeight) * 0.42
    const wrap = document.createElement('div')
    wrap.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${sz}px;height:${sz}px;`
    const ring = document.createElement('div')
    ring.style.cssText = `position:absolute;inset:0;border-radius:50%;-webkit-mask:radial-gradient(circle,transparent 58%,#000 59%);mask:radial-gradient(circle,transparent 58%,#000 59%);`
    const label = document.createElement('div')
    label.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:${sz * 0.2}px;`
    wrap.appendChild(ring)
    wrap.appendChild(label)
    big.appendChild(wrap)
    const dur = 2400
    const t0 = performance.now()
    const tick = (now: number): void => {
      const p = Math.min(1, (now - t0) / dur)
      ring.style.background = `conic-gradient(${accent} ${p * 360}deg, rgba(255,255,255,.16) ${p * 360}deg)`
      label.textContent = Math.round(p * 100) + '%'
      if (p < 1) requestAnimationFrame(tick)
      else reveal()
    }
    requestAnimationFrame(tick)
  }

  const reveal = (): void => {
    big.innerHTML = ''
    ctx.sfx.play('gameWin')
    if (resultSrc) {
      const node = document.createElement(resultIsVideo ? 'video' : 'img') as HTMLImageElement & HTMLVideoElement
      node.src = resultSrc
      node.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:18px;'
      if (resultIsVideo) {
        node.autoplay = true
        node.loop = true
        node.muted = true
        node.setAttribute('playsinline', '')
        void node.play?.().catch(() => {})
      }
      big.appendChild(node)
    } else {
      // fallback: composite the two picks
      for (const src of [modelPick, songPick]) {
        const half = document.createElement('div')
        half.style.cssText = `position:absolute;left:0;width:100%;height:50%;background:${src ? `center/cover no-repeat url("${src}")` : '#2a3450'};`
        half.style.top = src === modelPick ? '0' : '50%'
        big.appendChild(half)
      }
    }
    window.setTimeout(() => completeCb?.(), 900)
  }

  const layoutThumbs = (): void => {
    if (!thumbs.length) return
    const bw = big.clientWidth
    const bh = big.clientHeight
    const gap = bw * 0.04
    const rows = Math.ceil(thumbs.length / cols)
    const tw = (bw - gap * (cols - 1)) / cols
    const th = (bh - gap * (rows - 1)) / rows
    const sz = Math.min(tw, th)
    const usedW = sz * Math.min(cols, thumbs.length) + gap * (Math.min(cols, thumbs.length) - 1)
    const x0 = (bw - usedW) / 2
    thumbs.forEach((el, i) => {
      const r = Math.floor(i / cols)
      const c = i % cols
      el.style.width = sz + 'px'
      el.style.height = sz + 'px'
      el.style.left = x0 + c * (sz + gap) + 'px'
      el.style.top = r * (sz + gap) + 'px'
    })
  }

  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    promptEl.style.cssText = `position:absolute;left:4%;right:4%;top:2%;text-align:center;color:#fff;font-weight:800;text-shadow:0 2px 6px rgba(0,0,0,.4);font-size:${w * 0.06}px;`
    coachEl.style.cssText = `position:absolute;left:4%;right:4%;top:11%;text-align:center;color:rgba(255,255,255,.7);font-size:${w * 0.04}px;`
    const ssz = w * 0.3
    const gap = w * 0.12
    const x0 = (w - (ssz * 2 + gap)) / 2
    const sy = h * 0.16
    leftSlotPos = () => `left:${x0}px;top:${sy}px;width:${ssz}px;height:${ssz}px;font-size:${ssz * 0.4}px;`
    rightSlotPos = () => `left:${x0 + ssz + gap}px;top:${sy}px;width:${ssz}px;height:${ssz}px;font-size:${ssz * 0.4}px;`
    modelSlot.style.cssText = slotCss(!!modelPick) + leftSlotPos()
    if (modelPick) modelSlot.style.backgroundImage = `url("${modelPick}")`
    songSlot.style.cssText = slotCss(!!songPick) + rightSlotPos()
    if (songPick) songSlot.style.backgroundImage = `url("${songPick}")`
    plusEl.style.cssText = `position:absolute;left:50%;top:${sy + ssz / 2}px;transform:translate(-50%,-50%);color:#fff;font-weight:800;font-size:${w * 0.07}px;`
    const bigCursor = big.style.cursor
    big.style.cssText = `position:absolute;left:6%;width:88%;top:${h * 0.36}px;height:${h * 0.5}px;border-radius:24px;border:2px dashed rgba(255,255,255,.35);overflow:hidden;`
    big.style.cursor = bigCursor
    layoutThumbs()
  }

  return {
    mount(c, params) {
      ctx = c
      accent = str(params.accent, '#7c3aed')
      prompt = str(params.prompt, 'Select 1 Model and 1 Song')
      genLabel = str(params.genLabel, 'Tap to generate')
      cols = Math.max(2, Math.min(4, num(params.cols, 3)))
      const mIds = Array.isArray(params.models) ? (params.models as string[]) : []
      const sIds = Array.isArray(params.songs) ? (params.songs as string[]) : []
      models = Array.from({ length: Math.max(2, Math.min(6, num(params.modelCount, 3))) }, (_, i) => ctx.assets.src(mIds[i]))
      songs = Array.from({ length: Math.max(2, Math.min(6, num(params.songCount, 3))) }, (_, i) => ctx.assets.src(sIds[i]))
      const r = ctx.assets.src(params.result as string)
      resultSrc = r
      resultIsVideo = !!r && /^data:video|\.mp4|\.webm/i.test(r)

      ctx.root.style.touchAction = 'none'
      ctx.root.style.position = 'relative'
      promptEl = document.createElement('div')
      promptEl.textContent = prompt
      coachEl = document.createElement('div')
      coachEl.textContent = 'Tap a model'
      modelSlot = document.createElement('div')
      songSlot = document.createElement('div')
      modelSlot.textContent = '+'
      songSlot.textContent = '+'
      plusEl = document.createElement('div')
      plusEl.textContent = '+'
      big = document.createElement('div')
      ctx.root.append(promptEl, coachEl, modelSlot, plusEl, songSlot, big)
      layout()
      renderThumbs(models)
    },
    start() {
      if (started) return
      started = true
      thumbs.forEach((el, i) => el.addEventListener('pointerdown', () => choose(i)))
      if (stage === 'gen') big.addEventListener('pointerdown', generate, { once: true })
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (stage === 'model' || stage === 'song') {
        const t = thumbs[0]
        if (t) {
          const p = center(t)
          return { from: p, to: p, kind: 'tap' }
        }
      } else if (stage === 'gen') {
        const p = center(big)
        return { from: p, to: p, kind: 'tap' }
      }
      return null
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
      thumbs.length = 0
    },
  }
}

export const SONGMIX_TEMPLATE: GameTemplate = {
  id: 'songmix',
  label: 'Select model + song → video',
  paramFields: [
    { key: 'modelCount', label: 'Model choices', type: 'number', min: 2, max: 6, step: 1 },
    { key: 'songCount', label: 'Song choices', type: 'number', min: 2, max: 6, step: 1 },
    { key: 'cols', label: 'Thumbnail columns', type: 'number', min: 2, max: 4, step: 1 },
    { key: 'accent', label: 'Accent color', type: 'color' },
    { key: 'prompt', label: 'Header text', type: 'text' },
    { key: 'genLabel', label: 'Generate prompt', type: 'text' },
  ],
  assetSlots: [
    { key: 'models', label: 'Model photos', list: true, countParam: 'modelCount' },
    { key: 'songs', label: 'Song covers', list: true, countParam: 'songCount' },
    { key: 'result', label: 'Result video (optional)', accept: 'video' },
  ],
  defaultParams: { modelCount: 3, songCount: 3, cols: 3, accent: '#7c3aed', prompt: 'Select 1 Model and 1 Song', genLabel: 'Tap to generate', models: [], songs: [], result: '' },
  // Tap the first model thumbnail (thumb grid fills the panel at ~0.36+ height, upper-left).
  defaultHandguide: {
    nodes: [{ x: 0.2, y: 0.45 }],
  },
  create: createSongmix,
}
