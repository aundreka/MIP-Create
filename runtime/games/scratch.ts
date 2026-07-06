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
  let scratching = false
  let ro: ResizeObserver | null = null
  let winCb: (() => void) | null = null
  let completeCb: (() => void) | null = null
  let lastPt: { x: number; y: number } | null = null
  let moves = 0
  let coverImg: HTMLImageElement | null = null
  let coverReady = false
  // Reveal-image sizing. 'stretch' fills the whole card (matches the cover). 'fit'
  // shows the image at its natural aspect and lets it be freely positioned/scaled
  // (edited by double-clicking the card on the editor canvas) — these three values
  // are the saved transform, mirrored 1:1 by the editor's reveal overlay.
  let fitMode: 'stretch' | 'fit' = 'stretch'
  let revealScale = 1
  let revealX = 0
  let revealY = 0
  // Reveal zone: only clearing WITHIN this rectangle counts toward the win threshold.
  // Scratching anywhere outside it never contributes. Normalized 0..1 of the card;
  // defaults to the whole card (no gating, so existing cards are unchanged).
  let zoneX = 0
  let zoneY = 0
  let zoneW = 1
  let zoneH = 1

  const fillCover = (): void => {
    const w = canvas.width
    const h = canvas.height
    c2d.globalCompositeOperation = 'source-over'
    c2d.clearRect(0, 0, w, h)
    if (coverImg && coverReady) {
      // The cover ALWAYS fills the whole card — `fit` only governs the reveal.
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
    const w = Math.max(2, Math.round(ctx.root.clientWidth))
    const h = Math.max(2, Math.round(ctx.root.clientHeight))
    if (w === canvas.width && h === canvas.height) return
    canvas.width = w
    canvas.height = h
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    ctx.root.style.borderRadius = Math.round(Math.min(w, h) * 0.055) + 'px'
    lastPt = null
    if (!won) fillCover()
  }

  const erodeAt = (x: number, y: number): void => {
    c2d.globalCompositeOperation = 'destination-out'
    // Must be fully opaque — destination-out uses the source alpha to determine
    // how much to erase; a semi-transparent fill would leave ghost opacity behind.
    c2d.fillStyle = '#000'
    c2d.strokeStyle = '#000'
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

  // Fraction of the reveal ZONE that has been scratched clear (alpha < 128). Pixels
  // outside the zone are ignored entirely, so scratching there can never trip the
  // threshold. Sampled at 64×64 so a small zone still has enough pixels to measure.
  const measure = (): number => {
    const S = 64
    const o = document.createElement('canvas')
    o.width = S
    o.height = S
    const oc = o.getContext('2d')!
    oc.drawImage(canvas, 0, 0, S, S)
    const data = oc.getImageData(0, 0, S, S).data
    const x0 = Math.max(0, Math.floor(zoneX * S))
    const y0 = Math.max(0, Math.floor(zoneY * S))
    const x1 = Math.min(S, Math.ceil((zoneX + zoneW) * S))
    const y1 = Math.min(S, Math.ceil((zoneY + zoneH) * S))
    let clear = 0
    let total = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        total++
        if (data[(y * S + x) * 4 + 3] < 128) clear++
      }
    }
    return total > 0 ? clear / total : 0
  }

  const reveal = (): void => {
    if (won) return
    won = true
    if (winCb) winCb() // fires immediately at win — for SFX that should not be delayed
    ctx.sfx.loopStop?.('drag') // stop the scratching loop on win
    canvas.style.pointerEvents = 'none'
    // Fade the cover away smoothly instead of clearing it instantly. The prize sits
    // beneath the canvas, so fading the canvas opacity to 0 dissolves into the reveal.
    canvas.style.transition = 'opacity 450ms ease'
    requestAnimationFrame(() => {
      canvas.style.opacity = '0'
    })
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      c2d.globalCompositeOperation = 'source-over'
      c2d.clearRect(0, 0, canvas.width, canvas.height)
      completeCb?.() // win SFX fires centrally on completion (stage revealOnWin)
    }
    canvas.addEventListener('transitionend', finish, { once: true })
    window.setTimeout(finish, 650) // fallback if transitionend never fires
  }

  return {
    mount(c, params) {
      ctx = c
      coverColor = str(params.coverColor, '#9aa3b2')
      threshold = Math.max(0.2, Math.min(0.95, num(params.threshold, 0.6)))
      fitMode = str(params.fit, 'stretch') === 'fit' ? 'fit' : 'stretch'
      revealScale = Math.max(0.05, num(params.revealScale, 1))
      revealX = num(params.revealX, 0)
      revealY = num(params.revealY, 0)
      zoneX = Math.max(0, Math.min(1, num(params.zoneX, 0) / 100))
      zoneY = Math.max(0, Math.min(1, num(params.zoneY, 0) / 100))
      zoneW = Math.max(0.02, Math.min(1 - zoneX, num(params.zoneW, 100) / 100))
      zoneH = Math.max(0.02, Math.min(1 - zoneY, num(params.zoneH, 100) / 100))
      const label = str(params.label, 'YOU WIN!')
      const prizeSrc = ctx.assets.src(str(params.prize, ''))
      const coverSrc = ctx.assets.src(str(params.cover, ''))
      const cursorMode = str(params.cursor, 'inherit')
      const cursorAssetSrc = ctx.assets.src(str(params.cursorAsset, ''))
      const shadowBlur = num(params.shadowBlur, 0)
      const shadowX = num(params.shadowX, 0)
      const shadowY = num(params.shadowY, 4)
      const shadowColor = str(params.shadowColor, 'rgba(0,0,0,0.45)')
      ctx.root.style.touchAction = 'none'
      ctx.root.style.overflow = 'hidden'

      prize = document.createElement('div')
      prize.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;' +
        'background:#13203f;color:#fff;font-weight:800;text-align:center;' +
        'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;'
      if (prizeSrc) {
        if (fitMode === 'fit') {
          // Natural-aspect reveal, positioned/scaled by the saved transform; the card
          // clips the overflow. The editor's reveal overlay renders this identically.
          const img = document.createElement('img')
          img.src = prizeSrc
          img.draggable = false
          img.style.cssText =
            'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;' +
            `transform-origin:center center;transform:translate(${revealX}%,${revealY}%) scale(${revealScale});`
          prize.appendChild(img)
        } else {
          // 'stretch' fills the whole card, matching the cover edge-to-edge.
          prize.style.background = `#13203f center/100% 100% no-repeat url("${prizeSrc}")`
        }
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
      canvas.draggable = false
      canvas.style.cssText =
        'position:absolute;inset:0;touch-action:none;' +
        'user-select:none;-webkit-user-select:none;-webkit-user-drag:none;' +
        '-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;'
      canvas.addEventListener('dragstart', (e) => e.preventDefault())
      if (cursorMode === 'custom' && cursorAssetSrc) {
        canvas.style.cursor = `url("${cursorAssetSrc}") 16 16, crosshair`
      } else if (cursorMode !== 'inherit') {
        canvas.style.cursor = cursorMode === 'default' ? 'default' : cursorMode === 'pointer' ? 'pointer' : 'crosshair'
      }
      if (shadowBlur > 0 || shadowX !== 0 || shadowY !== 0) {
        canvas.style.filter = `drop-shadow(${shadowX}px ${shadowY}px ${shadowBlur}px ${shadowColor})`
      }
      ctx.root.appendChild(canvas)
      c2d = canvas.getContext('2d')!
      sizeCanvas()
      ro = new ResizeObserver(() => sizeCanvas())
      ro.observe(ctx.root)
    },
    start() {
      if (started) return
      started = true

      const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
        const r = canvas.getBoundingClientRect()
        return {
          x: ((clientX - r.left) / Math.max(1, r.width)) * canvas.width,
          y: ((clientY - r.top) / Math.max(1, r.height)) * canvas.height,
        }
      }
      const onScratchMove = (clientX: number, clientY: number): void => {
        if (won) return
        const p = toCanvas(clientX, clientY)
        erodeAt(p.x, p.y)
        if ((moves++ & 7) === 0 && measure() >= threshold) reveal()
      }
      const onScratchEnd = (): void => {
        scratching = false
        ctx.sfx.loopStop?.('drag')
        lastPt = null
        if (!won && measure() >= threshold) reveal()
      }

      // Touch events — primary path on mobile. MRAID/AppLovin reliably delivers
      // these even on the first interaction, unlike synthesized pointer events.
      // NOTE: we do NOT call e.preventDefault() here. Scrolling is already blocked
      // by `touch-action: none` on the parent (.pa-el-anim), so preventDefault() is
      // redundant — and on Android Chrome it prevents the touchstart from being
      // counted as a user activation for audio, breaking SFX on Android.
      // The pointerdown handler guards against double-handling via pointerType check.
      let touchActive = false
      canvas.addEventListener('touchstart', (e) => {
        if (won) return
        touchActive = true
        scratching = true
        ctx.sfx.loopStart?.('drag')
        lastPt = null
        const t = e.changedTouches[0]
        const p = toCanvas(t.clientX, t.clientY)
        erodeAt(p.x, p.y)
        const onMove = (ev: TouchEvent): void => {
          ev.preventDefault() // prevent scroll/pan fighting the scratch gesture
          const t2 = ev.changedTouches[0]
          onScratchMove(t2.clientX, t2.clientY)
        }
        const onEnd = (): void => {
          canvas.removeEventListener('touchmove', onMove)
          canvas.removeEventListener('touchend', onEnd)
          canvas.removeEventListener('touchcancel', onEnd)
          touchActive = false
          onScratchEnd()
        }
        canvas.addEventListener('touchmove', onMove, { passive: false })
        canvas.addEventListener('touchend', onEnd)
        canvas.addEventListener('touchcancel', onEnd)
      }, { passive: true })

      // Pointer events — fallback for mouse / pen (desktop). Skipped when a touch
      // gesture is already active (touchstart has already handled it).
      canvas.addEventListener('pointerdown', (e) => {
        if (won || touchActive || e.pointerType === 'touch') return
        e.preventDefault() // prevent native drag-start on the canvas element
        try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
        scratching = true
        ctx.sfx.loopStart?.('drag')
        lastPt = null
        const p = toCanvas(e.clientX, e.clientY)
        erodeAt(p.x, p.y)
        const onMove = (ev: PointerEvent): void => onScratchMove(ev.clientX, ev.clientY)
        const onUp = (): void => {
          canvas.removeEventListener('pointermove', onMove)
          canvas.removeEventListener('pointerup', onUp)
          canvas.removeEventListener('pointercancel', onUp)
          onScratchEnd()
        }
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerup', onUp)
        canvas.addEventListener('pointercancel', onUp)
      })
    },
    relayout: sizeCanvas,
    getHint(): HintMove | null {
      if (won || scratching) return null
      const r = canvas.getBoundingClientRect()
      const y = r.top + r.height / 2
      return { from: { x: r.left + r.width * 0.22, y }, to: { x: r.left + r.width * 0.78, y }, kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      ro?.disconnect()
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
    { key: 'zoneX', label: 'Reveal zone left (%)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'zoneY', label: 'Reveal zone top (%)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'zoneW', label: 'Reveal zone width (%)', type: 'number', min: 2, max: 100, step: 1 },
    { key: 'zoneH', label: 'Reveal zone height (%)', type: 'number', min: 2, max: 100, step: 1 },
    { key: 'fit', label: 'Reveal image sizing', type: 'select', options: ['stretch', 'fit'] },
    { key: 'cursor', label: 'Cursor style', type: 'select', options: ['inherit', 'crosshair', 'default', 'pointer', 'custom'] },
    { key: 'shadowBlur', label: 'Shadow blur', type: 'number', min: 0, max: 60, step: 1 },
    { key: 'shadowX', label: 'Shadow offset X', type: 'number', min: -40, max: 40, step: 1 },
    { key: 'shadowY', label: 'Shadow offset Y', type: 'number', min: -40, max: 40, step: 1 },
    { key: 'shadowColor', label: 'Shadow color', type: 'color' },
  ],
  assetSlots: [
    { key: 'prize', label: 'Prize image (revealed)' },
    { key: 'cover', label: 'Cover image (scratched off)' },
    { key: 'cursorAsset', label: 'Custom cursor image (32×32 recommended)' },
  ],
  // revealScale/X/Y are edited by double-clicking the card on the canvas (no inspector
  // field) — they only apply when fit = 'fit'.
  defaultParams: { label: 'YOU WIN!', coverColor: '#9aa3b2', threshold: 0.6, zoneX: 0, zoneY: 0, zoneW: 100, zoneH: 100, fit: 'stretch', revealScale: 1, revealX: 0, revealY: 0, prize: '', cover: '', cursor: 'inherit', cursorAsset: '', shadowBlur: 0, shadowX: 0, shadowY: 4, shadowColor: '#000000' },
  // Zig-zag scratch motion across the card (the editable hint's starting route).
  defaultHandguide: {
    nodes: [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.46 },
      { x: 0.2, y: 0.62 },
      { x: 0.8, y: 0.8 },
    ],
    periodMs: 1900,
  },
  create: createScratch,
}
