// Scrollable page ("long image") MIP: one tall picture rendered at full slot
// width; the player scrolls down through it. A CTA floats pinned near the bottom
// of the screen the whole way (CSS position:sticky) and "lands" at its authored
// spot near the end of the page when the scroll reaches it. Tapping the CTA
// fires the real store click-through (same ordering as the cta element).
// Scrolling works three ways: native overflow scroll (wheel + touch pan-y),
// plus a pointer-drag fallback with momentum for ad webviews that suppress
// native touch scrolling (a pointercancel means native scroll took over, so the
// fallback stands down and never double-scrolls).

import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { num, str } from './types'
import { triggerCTA, notifyGameClose } from '../networks'

export function createScroll(): GameModule {
  let ctx: GameContext
  let scroller: HTMLDivElement
  let content: HTMLDivElement
  let img: HTMLImageElement | null = null
  let placeholder: HTMLDivElement | null = null
  let ctaWrap: HTMLDivElement
  let btn: HTMLButtonElement
  let ctaImg: HTMLImageElement | null = null

  let ctaWidthPct = 56
  let ctaHeightPx = 150
  let ctaXPct = 50
  let landPct = 98
  let floatPx = 36
  let completeAt = 95

  let started = false
  let done = false
  let completeCb: (() => void) | null = null
  let momentumRaf = 0

  const s = (): number => ctx.scale?.() ?? 1

  // Page height in screen px: the image at 100% width keeps its aspect; without
  // an image a placeholder ~2.5 screens tall demos the scroll.
  const pageH = (): number => {
    const vw = Math.max(1, scroller.clientWidth)
    if (img && img.naturalWidth > 0) return (vw / img.naturalWidth) * img.naturalHeight
    return Math.max(1, scroller.clientHeight) * 2.5
  }

  const ctaH = (): number => {
    if (ctaImg && ctaImg.naturalWidth > 0) {
      const w = Math.max(1, scroller.clientWidth) * (ctaWidthPct / 100)
      return w * (ctaImg.naturalHeight / ctaImg.naturalWidth)
    }
    return ctaHeightPx * s()
  }

  const layout = (): void => {
    const ph = pageH()
    const ch = ctaH()
    if (placeholder) placeholder.style.height = ph.toFixed(1) + 'px'
    // The CTA wrapper is the only other in-flow child after the page content, so
    // a negative top margin places its flow position (= landing spot) with its
    // BOTTOM at landPct% of the page. sticky floats it near the screen bottom
    // until the scroll brings that flow position into view.
    const landBottom = Math.min(ph, Math.max(ch, (landPct / 100) * ph))
    ctaWrap.style.height = ch.toFixed(1) + 'px'
    ctaWrap.style.marginTop = (landBottom - ch - ph).toFixed(1) + 'px'
    ctaWrap.style.bottom = (floatPx * s()).toFixed(1) + 'px'
    btn.style.width = ctaWidthPct + '%'
    btn.style.left = ctaXPct + '%'
    if (!ctaImg) btn.style.fontSize = Math.round(ch * 0.42) + 'px'
  }

  const checkComplete = (): void => {
    if (done || !started || completeAt <= 0) return
    const max = scroller.scrollHeight - scroller.clientHeight
    if (max <= 0) return
    if (scroller.scrollTop / max >= completeAt / 100 - 0.001) {
      done = true
      completeCb?.()
    }
  }

  // Pointer-drag scrolling fallback. scrollTop is set ABSOLUTELY from the
  // gesture's start so it agrees with (never doubles) any native pan that also
  // runs; native taking over fires pointercancel, which stands this down.
  const attachDrag = (): void => {
    let startY = 0
    let startTop = 0
    let lastY = 0
    let lastT = 0
    let vel = 0
    let active = false
    const stopMomentum = (): void => {
      if (momentumRaf) window.cancelAnimationFrame(momentumRaf)
      momentumRaf = 0
    }
    const onMove = (e: PointerEvent): void => {
      if (!active) return
      const now = performance.now()
      const dt = Math.max(1, now - lastT)
      vel = ((lastY - e.clientY) / dt) * 16.7 // px per frame
      lastY = e.clientY
      lastT = now
      scroller.scrollTop = startTop + (startY - e.clientY)
    }
    const end = (cancelled: boolean): void => {
      if (!active) return
      active = false
      scroller.removeEventListener('pointermove', onMove)
      if (cancelled) return // native scroll owns the gesture (and its momentum)
      const decay = (): void => {
        vel *= 0.95
        if (Math.abs(vel) < 0.2) return
        scroller.scrollTop += vel
        momentumRaf = window.requestAnimationFrame(decay)
      }
      if (Math.abs(vel) > 1) momentumRaf = window.requestAnimationFrame(decay)
    }
    scroller.addEventListener('pointerdown', (e) => {
      stopMomentum()
      active = true
      startY = lastY = e.clientY
      startTop = scroller.scrollTop
      lastT = performance.now()
      vel = 0
      scroller.addEventListener('pointermove', onMove)
    })
    scroller.addEventListener('pointerup', () => end(false))
    scroller.addEventListener('pointercancel', () => end(true))
  }

  return {
    mount(c, params) {
      ctx = c
      ctaWidthPct = Math.max(10, Math.min(100, num(params.ctaWidth, 56)))
      ctaHeightPx = Math.max(40, num(params.ctaHeight, 150))
      ctaXPct = Math.max(0, Math.min(100, num(params.ctaX, 50)))
      landPct = Math.max(0, Math.min(100, num(params.ctaLand, 98)))
      floatPx = Math.max(0, num(params.ctaFloat, 36))
      completeAt = Math.max(0, Math.min(100, num(params.completeAt, 95)))
      const bg = str(params.bgColor, '#000000')

      scroller = document.createElement('div')
      // overflow stays hidden until start() so the editor canvas shows a static
      // preview (the CTA still floats at its sticky spot — same as first paint).
      scroller.style.cssText = `position:absolute;inset:0;overflow:hidden;background:${bg};`
      content = document.createElement('div')
      content.style.cssText = 'position:relative;width:100%;'

      const src = ctx.assets.src(typeof params.image === 'string' ? params.image : undefined)
      if (src) {
        img = document.createElement('img')
        img.draggable = false
        img.style.cssText = 'display:block;width:100%;height:auto;user-select:none;-webkit-user-drag:none;pointer-events:none;'
        img.addEventListener('load', layout)
        img.src = src
        content.appendChild(img)
      } else {
        placeholder = document.createElement('div')
        placeholder.style.cssText =
          'display:flex;align-items:flex-start;justify-content:center;padding-top:40%;box-sizing:border-box;' +
          'background:linear-gradient(180deg,#3a7bd5,#1b2a4a 45%,#0b1220);color:#ffffffaa;font:600 16px -apple-system,Segoe UI,sans-serif;'
        placeholder.textContent = 'Add a page image (Inspector → Game → Page image)'
        content.appendChild(placeholder)
      }

      ctaWrap = document.createElement('div')
      ctaWrap.style.cssText = 'position:sticky;width:100%;pointer-events:none;z-index:2;'
      btn = document.createElement('button')
      btn.type = 'button'
      btn.style.cssText =
        'position:absolute;top:0;height:100%;transform:translateX(-50%);pointer-events:auto;cursor:pointer;' +
        'display:block;padding:0;margin:0;border:0;background:transparent;'
      const ctaSrc = ctx.assets.src(typeof params.ctaImage === 'string' ? params.ctaImage : undefined)
      if (ctaSrc) {
        ctaImg = document.createElement('img')
        ctaImg.draggable = false
        ctaImg.style.cssText = 'display:block;width:100%;height:100%;user-select:none;-webkit-user-drag:none;'
        ctaImg.addEventListener('load', layout)
        ctaImg.src = ctaSrc
        btn.appendChild(ctaImg)
      } else {
        btn.textContent = str(params.ctaText, 'SHOP NOW')
        btn.style.background = str(params.ctaColor, '#16a34a')
        btn.style.color = str(params.ctaTextColor, '#ffffff')
        btn.style.borderRadius = '999px'
        btn.style.fontWeight = '800'
        btn.style.fontFamily = '-apple-system,Segoe UI,sans-serif'
      }
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation()
        ctx.sfx.play('ctaClick')
        notifyGameClose()
        triggerCTA()
      })
      // Gentle steady pulse (same spirit as the cta element's medium pulse).
      btn.animate?.(
        [{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.05)' }, { transform: 'translateX(-50%) scale(1)' }],
        { duration: 1200, iterations: Infinity, easing: 'ease-in-out' },
      )
      ctaWrap.appendChild(btn)
      content.appendChild(ctaWrap)
      scroller.appendChild(content)
      ctx.root.appendChild(scroller)
      layout()
    },
    start() {
      if (started) return
      started = true
      scroller.style.overflowY = 'auto'
      scroller.style.overflowX = 'hidden'
      scroller.style.touchAction = 'pan-y'
      scroller.style.overscrollBehavior = 'contain'
      ;(scroller.style as unknown as Record<string, string>).webkitOverflowScrolling = 'touch'
      scroller.addEventListener('scroll', checkComplete, { passive: true })
      attachDrag()
    },
    relayout: layout,
    getHint(): HintMove | null {
      if (done) return null
      if (scroller.scrollHeight <= scroller.clientHeight + 2) return null
      const r = scroller.getBoundingClientRect()
      const w = r.width || scroller.clientWidth
      const h = r.height || scroller.clientHeight
      const x = r.left + w / 2
      // Drag up = scroll down: start low, slide toward the top.
      return { from: { x, y: r.top + h * 0.68 }, to: { x, y: r.top + h * 0.32 }, kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      if (momentumRaf) window.cancelAnimationFrame(momentumRaf)
      ctx.root.innerHTML = ''
    },
  }
}

export const SCROLL_TEMPLATE: GameTemplate = {
  id: 'scroll',
  label: 'Scrollable page (image + floating CTA)',
  paramFields: [
    { key: 'ctaText', label: 'CTA text (no image)', type: 'text' },
    { key: 'ctaColor', label: 'CTA color (no image)', type: 'color' },
    { key: 'ctaTextColor', label: 'CTA text color', type: 'color' },
    { key: 'ctaWidth', label: 'CTA width (% of screen)', type: 'number', min: 10, max: 100, step: 1 },
    { key: 'ctaHeight', label: 'CTA height (design px, no image)', type: 'number', min: 40, max: 400, step: 2 },
    { key: 'ctaX', label: 'CTA horizontal center (%)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'ctaLand', label: 'CTA lands at (% down the page)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'ctaFloat', label: 'Float gap from bottom (design px)', type: 'number', min: 0, max: 300, step: 2 },
    { key: 'completeAt', label: 'Win at scroll depth (%, 0 = off)', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'bgColor', label: 'Background color', type: 'color' },
  ],
  assetSlots: [
    { key: 'image', label: 'Page image (tall)' },
    { key: 'ctaImage', label: 'CTA image (optional)' },
  ],
  defaultParams: {
    image: '',
    ctaImage: '',
    ctaText: 'SHOP NOW',
    ctaColor: '#16a34a',
    ctaTextColor: '#ffffff',
    ctaWidth: 56,
    ctaHeight: 150,
    ctaX: 50,
    ctaLand: 98,
    ctaFloat: 36,
    completeAt: 95,
    bgColor: '#000000',
  },
  // Drag up (scroll down): start in the lower half, slide toward the top.
  defaultHandguide: {
    nodes: [
      { x: 0.5, y: 0.68 },
      { x: 0.5, y: 0.32 },
    ],
    periodMs: 1500,
  },
  create: createScroll,
}
