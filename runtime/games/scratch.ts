// Scratch game: erase the cover (canvas destination-out) to reveal the prize
// underneath; win at a threshold of scratched area. Hint = drag across.

import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { num, str } from './types'

export function createScratch(): GameModule {
  let ctx: GameContext
  let coverColor = '#9aa3b2'
  let threshold = 0.6
  let canvas: HTMLCanvasElement
  let c2d: CanvasRenderingContext2D
  let prize: HTMLDivElement
  let started = false
  let won = false
  let completeCb: (() => void) | null = null
  let lastPt: { x: number; y: number } | null = null
  let moves = 0
  let coverImg: HTMLImageElement | null = null
  let coverReady = false

  const fillCover = (): void => {
    const w = canvas.width
    const h = canvas.height
    c2d.globalCompositeOperation = 'source-over'
    c2d.clearRect(0, 0, w, h)
    if (coverImg && coverReady) {
      c2d.drawImage(coverImg, 0, 0, w, h)
      return
    }
    c2d.fillStyle = coverColor
    c2d.fillRect(0, 0, w, h)
    c2d.fillStyle = 'rgba(255,255,255,0.85)'
    c2d.font = `${Math.round(Math.min(w, h) * 0.07)}px -apple-system, Segoe UI, sans-serif`
    c2d.textAlign = 'center'
    c2d.textBaseline = 'middle'
    c2d.fillText('Scratch to reveal', w / 2, h / 2)
  }

  const sizeCanvas = (): void => {
    const w = Math.max(2, ctx.root.clientWidth)
    const h = Math.max(2, ctx.root.clientHeight)
    canvas.width = w
    canvas.height = h
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    if (!won) fillCover()
  }

  const erodeAt = (x: number, y: number): void => {
    c2d.globalCompositeOperation = 'destination-out'
    const r = Math.max(14, Math.min(canvas.width, canvas.height) * 0.09)
    if (lastPt) {
      c2d.lineWidth = r * 2
      c2d.lineCap = 'round'
      c2d.beginPath()
      c2d.moveTo(lastPt.x, lastPt.y)
      c2d.lineTo(x, y)
      c2d.stroke()
    }
    c2d.beginPath()
    c2d.arc(x, y, r, 0, Math.PI * 2)
    c2d.fill()
    lastPt = { x, y }
  }

  const measure = (): number => {
    const o = document.createElement('canvas')
    o.width = 32
    o.height = 32
    const oc = o.getContext('2d')!
    oc.drawImage(canvas, 0, 0, 32, 32)
    const data = oc.getImageData(0, 0, 32, 32).data
    let clear = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] < 128) clear++
    return clear / (32 * 32)
  }

  const reveal = (): void => {
    won = true
    c2d.globalCompositeOperation = 'source-over'
    c2d.clearRect(0, 0, canvas.width, canvas.height)
    canvas.style.pointerEvents = 'none'
    completeCb?.() // win SFX fires centrally on completion (stage revealOnWin)
  }

  return {
    mount(c, params) {
      ctx = c
      coverColor = str(params.coverColor, '#9aa3b2')
      threshold = Math.max(0.2, Math.min(0.95, num(params.threshold, 0.6)))
      const label = str(params.label, 'YOU WIN!')
      const prizeSrc = ctx.assets.src(str(params.prize, ''))
      const coverSrc = ctx.assets.src(str(params.cover, ''))
      ctx.root.style.touchAction = 'none'
      ctx.root.style.borderRadius = '16px'
      ctx.root.style.overflow = 'hidden'

      prize = document.createElement('div')
      prize.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'background:#13203f;color:#fff;font-weight:800;text-align:center;'
      if (prizeSrc) {
        prize.style.background = `#13203f center/contain no-repeat url("${prizeSrc}")`
      } else {
        const span = document.createElement('div')
        span.textContent = label
        span.style.cssText = 'font-size:min(12vw,64px);padding:8%;'
        prize.appendChild(span)
      }
      ctx.root.appendChild(prize)

      if (coverSrc) {
        coverImg = new Image()
        coverImg.onload = () => {
          coverReady = true
          if (!won) fillCover()
        }
        coverImg.src = coverSrc
      }

      canvas = document.createElement('canvas')
      canvas.style.cssText = 'position:absolute;inset:0;cursor:crosshair;'
      ctx.root.appendChild(canvas)
      c2d = canvas.getContext('2d')!
      sizeCanvas()
    },
    start() {
      if (started) return
      started = true
      canvas.addEventListener('pointerdown', (e) => {
        if (won) return
        canvas.setPointerCapture(e.pointerId)
        const r = canvas.getBoundingClientRect()
        lastPt = null
        erodeAt(e.clientX - r.left, e.clientY - r.top)
        const move = (ev: PointerEvent): void => {
          erodeAt(ev.clientX - r.left, ev.clientY - r.top)
          if ((moves++ & 7) === 0 && measure() >= threshold) reveal()
        }
        const up = (): void => {
          canvas.removeEventListener('pointermove', move)
          canvas.removeEventListener('pointerup', up)
          lastPt = null
          if (!won && measure() >= threshold) reveal()
        }
        canvas.addEventListener('pointermove', move)
        canvas.addEventListener('pointerup', up)
      })
    },
    relayout: sizeCanvas,
    getHint(): HintMove | null {
      if (won) return null
      const r = canvas.getBoundingClientRect()
      const y = r.top + r.height / 2
      return { from: { x: r.left + r.width * 0.22, y }, to: { x: r.left + r.width * 0.78, y }, kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      ctx.root.innerHTML = ''
    },
  }
}

export const SCRATCH_TEMPLATE: GameTemplate = {
  id: 'scratch',
  label: 'Scratch card',
  paramFields: [
    { key: 'label', label: 'Reveal text (if no prize image)', type: 'text' },
    { key: 'coverColor', label: 'Cover color (if no cover image)', type: 'color' },
    { key: 'threshold', label: 'Reveal at', type: 'number', min: 0.3, max: 0.9, step: 0.05 },
  ],
  assetSlots: [
    { key: 'prize', label: 'Prize image (revealed)' },
    { key: 'cover', label: 'Cover image (scratched off)' },
  ],
  defaultParams: { label: 'YOU WIN!', coverColor: '#9aa3b2', threshold: 0.6, prize: '', cover: '' },
  create: createScratch,
}
