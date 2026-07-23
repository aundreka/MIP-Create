import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { injectAnimStyles } from '../anim'
import '../catch.css'

interface Drop {
  id: number
  x: number
  y: number
  speed: number
  angle: number
  imgSrc: string
  imgIdx: number
  captured: boolean
  sz: number
  el?: HTMLElement
}

export function createCatch(): GameModule {
  let ctx: GameContext
  let root: HTMLElement
  let dropsContainer: HTMLDivElement
  let drops: Drop[] = []
  
  let scoreMode: string
  let need: number
  let speedParam: number
  let spawnMs: number
  let randomizeAngle: boolean
  let randomAngleList: number[] = [0, 45, -45, 90]
  let visibleFirstRender: boolean
  let basketLocked: boolean
  let itemTypes: number = 0
  let showCaughtItemsPreview: boolean = false
  let itemImages: string[] = []
  let popupImages: string[] = []
  let popupConfigs: any[] = []
  let requireUnique: boolean = true

  let done = false
  let caught = 0
  let basketX = 540
  let lastTime = 0
  let rafRef = 0
  let spawnTimer = 0
  let completeCb: (() => void) | null = null
  let gameActive = true
  let spawnOnMove = false
  let hasMoved = false
  let gameParams: Record<string, unknown> = {}
  let lastSpawnLane = -1
  let visibilityHandler: (() => void) | null = null

  const uniqueItemSpots = new Map<string, HTMLElement>()

  let frontBasketLogicalW = 300
  let frontBasketLogicalH = 150
  let frontBasketOffsetY = 0
  let frontBasketOffsetX = 0
  
  let backBasketLogicalW = 300
  let backBasketLogicalH = 150
  let backBasketOffsetY = 0
  let backBasketOffsetX = 0
  
  let itemSizes: number[] = [120]
  
  let caughtItemXs: number[] = []
  let caughtItemYs: number[] = []
  let caughtItemAngles: number[] = []
  let caughtItemScales: number[] = []
  let caughtItemZIndexes: number[] = [1]
  let caughtItemUseItemSizes: boolean[] = []

  let frontBasket: HTMLDivElement | null = null
  let backBasket: HTMLDivElement | null = null
  let basketDragTarget: HTMLDivElement | null = null
  let dragAttachedBasket: HTMLDivElement | null = null
  let basketStartDrag: ((e: PointerEvent) => void) | null = null
  let caughtItemsContainer: HTMLDivElement | null = null
  let frontBasketAssetIdStr = ''
  let backBasketAssetIdStr = ''
  let paRoot: HTMLElement | null = null

  const s = (): number => ctx.scale?.() ?? 1

  const displayScore = () => scoreMode === 'Decrement' ? Math.max(0, need - caught) : caught

  const updateScoreUI = () => {
    if (!paRoot) return
    const scoreCounter = paRoot.querySelector('[data-id="score_counter"]') as HTMLElement | null
    if (scoreCounter) {
      const inner = scoreCounter.querySelector('.pa-text-inner')
      if (inner) {
        inner.textContent = `${displayScore()}`
      } else {
        scoreCounter.textContent = `${displayScore()}`
      }
    }
  }

  const stopSpawning = () => {
    window.clearInterval(spawnTimer)
    spawnTimer = 0
  }

  const shouldSpawnNow = () => !done && !document.hidden && (!spawnOnMove || hasMoved)

  const startSpawning = (spawnImmediately = false) => {
    if (!shouldSpawnNow() || spawnTimer) return
    spawnTimer = window.setInterval(spawn, spawnMs)
    if (spawnImmediately) spawn()
  }

  const stopAnimation = () => {
    cancelAnimationFrame(rafRef)
    rafRef = 0
  }

  const startAnimation = () => {
    if (done || rafRef) return
    lastTime = performance.now()
    rafRef = requestAnimationFrame(tick)
  }

  const handleVisibilityChange = () => {
    if (document.hidden) {
      stopSpawning()
      stopAnimation()
      return
    }

    startAnimation()
    startSpawning(true)
  }
  const createDropElement = (drop: Drop) => {
    const currentScale = s()
    const physicalItemSz = drop.sz * currentScale
    const el = document.createElement('div')
    el.style.position = 'absolute'
    el.style.width = `${physicalItemSz}px`
    el.style.height = `${physicalItemSz}px`
    el.style.pointerEvents = 'none'

    el.style.transform = `rotate(${drop.angle}deg)`
    el.style.willChange = 'transform, top, left'

    if (drop.imgSrc) {
      const img = document.createElement('img')
      img.src = drop.imgSrc
      img.style.width = '100%'
      img.style.height = '100%'
      img.style.objectFit = 'contain'
      img.draggable = false
      el.appendChild(img)
    } else {
      const circle = document.createElement('div')
      circle.style.width = '100%'
      circle.style.height = '100%'
      circle.style.borderRadius = '50%'
      circle.style.backgroundColor = '#f43f5e'
      circle.style.boxShadow = '0 10px 15px -3px rgb(0 0 0 / 0.1)'
      el.appendChild(circle)
    }

    drop.el = el
    dropsContainer.appendChild(el)
    drops.push(drop)
  }

  const spawn = () => {
    if (done || (!gameActive && !visibleFirstRender)) return
    
    // Pick an image and a size (using the same random index if sizes array matches length, or just random)
    let imgIdx = itemImages.length > 0 ? Math.floor(ctx.rng() * itemImages.length) : 0
    let szIdx = imgIdx % itemSizes.length
    const imgSrc = itemImages.length > 0 ? itemImages[imgIdx] : ''
    const sz = itemSizes[szIdx] || 120

    const minX = sz / 2
    const maxX = 1080 - sz / 2
    const lanes: Array<[number, number]> = [
      [minX, 360],
      [360, 720],
      [720, maxX],
    ].map(([a, b]) => [Math.max(minX, a), Math.min(maxX, b)] as [number, number])
      .filter(([a, b]) => b > a)

    let laneIdx = Math.floor(ctx.rng() * lanes.length)
    if (lanes.length > 1 && laneIdx === lastSpawnLane) {
      laneIdx = (laneIdx + 1 + Math.floor(ctx.rng() * (lanes.length - 1))) % lanes.length
    }
    lastSpawnLane = laneIdx

    const [laneMin, laneMax] = lanes[laneIdx] ?? [minX, maxX]
    let x = laneMin + ctx.rng() * (laneMax - laneMin)

    if (!gameActive && visibleFirstRender) {
      // Force x to be on the left or right edge
      const isLeft = ctx.rng() > 0.5
      x = isLeft ? minX : maxX // strictly to the edges
    }

    const angle = randomizeAngle && randomAngleList.length > 0 ? randomAngleList[Math.floor(ctx.rng() * randomAngleList.length)] : 0
    const speed = speedParam * 1920 + (ctx.rng() * 200 - 100)
    
    // y is in logical pa-root coordinates (0 = top of pa-root)
    const drop: Drop = { id: Date.now() + Math.random(), x, y: -sz, speed, angle, imgSrc, imgIdx, captured: false, sz }
    createDropElement(drop)
  }

  const tick = (t: number) => {
    if (done) return
    const dt = Math.min(64, t - lastTime) / 1000
    lastTime = t
    
    const footerBar = document.querySelector('[data-id="basket_bar"]') as HTMLElement | null
    const currentScale = s()
    
    if (!paRoot) {
      rafRef = requestAnimationFrame(tick)
      return
    }

    const paRootRect = paRoot.getBoundingClientRect()
    // Fallback to the bottom of pa-root if basket_bar is not found
    const footerTop = footerBar ? footerBar.getBoundingClientRect().top : paRootRect.bottom
    const paRootCenterX = paRootRect.left + paRootRect.width / 2

    // Hit detection line (the rim of the basket). 
    // The bottom of the basket is at footerTop, so we subtract height to get the rim.
    // We catch when it's about 20% deep into the basket, so we subtract 0.8 * height.
    const basketScreenY = footerTop - paRootRect.top - (frontBasketLogicalH * 0.8 * currentScale) - (frontBasketOffsetY * currentScale)

    let anyCaught = false
    
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]
      if (d.captured) continue
      
      const prevY = d.y * currentScale
      
      d.y += d.speed * dt
      const newY = d.y * currentScale
      
      // Hit detection: item crossed the basket line this frame
      if (gameActive && prevY < basketScreenY && newY >= basketScreenY) {
        // item screen X relative to pa-root center
        const item_screen_x = (d.x - 540) * currentScale
        const basket_screen_x = (basketX + frontBasketOffsetX - 540) * currentScale
        
        const scale = 1
        
        const hit = Math.abs(item_screen_x - basket_screen_x) < (frontBasketLogicalW / 2 + d.sz * scale * 0.3) * currentScale
        if (hit) {
          d.captured = true
          
          if (requireUnique && itemTypes > 0 && uniqueItemSpots.has(d.imgSrc)) {
            // Duplicate caught! Animate existing and destroy falling item
            ctx.sfx.play('catch')
            const existingEl = uniqueItemSpots.get(d.imgSrc)!
            const originalTransform = existingEl.style.transform
            existingEl.style.transition = 'transform 0.15s ease-out'
            // Append scale(1.3) to existing transform (which might contain rotate/scale)
            existingEl.style.transform = `${originalTransform} scale(1.3)`
            setTimeout(() => {
              existingEl.style.transform = originalTransform
              setTimeout(() => { existingEl.style.transition = '' }, 150)
            }, 150)
            
            if (d.el && d.el.parentNode) d.el.parentNode.removeChild(d.el)
            continue
          }

          anyCaught = true
          
          // Attach caught item to basket
          if (d.el && caughtItemsContainer) {
            caughtItemsContainer.appendChild(d.el)
            const physicalItemSz = d.sz * currentScale
            d.el.style.width = physicalItemSz + 'px'
            d.el.style.height = physicalItemSz + 'px'
            
            const defaultOffsetX = (item_screen_x - basket_screen_x) / currentScale
            const cIdx = itemTypes > 0 ? d.imgIdx : caught
            
            const offsetX = caughtItemXs.length > 0 ? (caughtItemXs[cIdx % caughtItemXs.length] ?? defaultOffsetX) : defaultOffsetX
            const offsetY = caughtItemYs.length > 0 ? (caughtItemYs[cIdx % caughtItemYs.length] ?? (ctx.rng() * 20 - 10)) : (ctx.rng() * 20 - 10)
            const angle = caughtItemAngles.length > 0 ? (caughtItemAngles[cIdx % caughtItemAngles.length] ?? d.angle) : d.angle
            const authoredScale = caughtItemScales.length > 0 ? (caughtItemScales[cIdx % caughtItemScales.length] ?? 0.7) : 0.7
            const useItemSize = caughtItemUseItemSizes.length > 0 ? (caughtItemUseItemSizes[cIdx % caughtItemUseItemSizes.length] ?? false) : false
            const scale = useItemSize ? 1 : authoredScale
            const zIndex = caughtItemZIndexes.length > 0 ? (caughtItemZIndexes[cIdx % caughtItemZIndexes.length] ?? 1) : 1

            d.el.style.left = `${(frontBasketLogicalW / 2) * currentScale + offsetX * currentScale - physicalItemSz / 2}px`
            d.el.style.top = `${offsetY * currentScale}px`
            d.el.style.transform = `rotate(${angle}deg) scale(${scale})`
            d.el.style.transformOrigin = 'bottom center'
            d.el.style.opacity = '1'
            d.el.style.zIndex = `${zIndex}`

            if (requireUnique && itemTypes > 0) {
              uniqueItemSpots.set(d.imgSrc, d.el)
              
              const pIdx = d.imgIdx
              const pConfig = popupConfigs.length > pIdx ? popupConfigs[pIdx] : null
              if ((pConfig?.trigger ?? 'unique') === 'unique') showCatchEffect(pIdx, currentScale, paRootRect)
            }

            const anyIdx = itemTypes > 0 ? d.imgIdx : caught
            const anyConfig = popupConfigs.length > anyIdx ? popupConfigs[anyIdx] : null
            if (anyConfig?.trigger === 'any') showCatchEffect(anyIdx, currentScale, paRootRect)
          }
          continue
        }
      }
      
      // Update position (physical px relative to dropsContainer which is on pa-root)
      if (d.el && !d.captured) {
        const physicalItemSz = d.sz * currentScale
        const physX = paRootCenterX - paRootRect.left + (d.x - 540) * currentScale - physicalItemSz / 2
        const physY = d.y * currentScale - physicalItemSz / 2
        d.el.style.left = `${physX}px`
        d.el.style.top = `${physY}px`
        d.el.style.width = `${physicalItemSz}px`
        d.el.style.height = `${physicalItemSz}px`
      }
      
      // Cleanup offscreen (past bottom of logical screen)
      if (d.y > 1920 + d.sz + 100) {
        if (d.el && d.el.parentNode) d.el.parentNode.removeChild(d.el)
        drops.splice(i, 1)
      }
    }

    if (anyCaught) {
      caught++
      ctx.sfx.play('catch')
      updateScoreUI()
      if (caught >= need) {
        done = true
        stopSpawning()
        ctx.sfx.play('win')
        completeCb?.()
      }
    }
    if (frontBasket) {
      frontBasket.style.width = (frontBasketLogicalW * currentScale) + 'px'
      frontBasket.style.height = (frontBasketLogicalH * currentScale) + 'px'
      const frontBasketPhysicalH = frontBasketLogicalH * currentScale
      frontBasket.style.top = `${footerTop - paRootRect.top - frontBasketPhysicalH - (frontBasketOffsetY * currentScale)}px`
      frontBasket.style.bottom = ''
      frontBasket.style.marginLeft = `-${(frontBasketLogicalW / 2) * currentScale}px`
      const fx = basketX + frontBasketOffsetX
      frontBasket.style.transform = `translateX(${(fx - 540) * currentScale}px)`
    }
    
    if (backBasket) {
      backBasket.style.width = (backBasketLogicalW * currentScale) + 'px'
      backBasket.style.height = (backBasketLogicalH * currentScale) + 'px'
      const backBasketPhysicalH = backBasketLogicalH * currentScale
      backBasket.style.top = `${footerTop - paRootRect.top - backBasketPhysicalH - (backBasketOffsetY * currentScale)}px`
      backBasket.style.bottom = ''
      backBasket.style.marginLeft = `-${(backBasketLogicalW / 2) * currentScale}px`
      const bx = basketLocked ? basketX + backBasketOffsetX : 540 + backBasketOffsetX
      backBasket.style.transform = `translateX(${(bx - 540) * currentScale}px)`
    }
    
    rafRef = requestAnimationFrame(tick)
  }

  const attachDrag = () => {
    const dragTarget = basketDragTarget
    if (!dragTarget || dragAttachedBasket === dragTarget) return
    if (dragAttachedBasket && basketStartDrag) {
      dragAttachedBasket.removeEventListener('pointerdown', basketStartDrag)
    }

    let active = false
    const onMove = (e: PointerEvent) => {
      if (!active) return
      const currentScale = s()
      const physicalOffsetFromCenter = e.clientX - window.innerWidth / 2
      let lx = 540 + (physicalOffsetFromCenter / currentScale)
      // Constrain basketX based on frontBasket width
      basketX = Math.max(frontBasketLogicalW / 2, Math.min(1080 - frontBasketLogicalW / 2, lx))
    }
    const end = () => {
      active = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    const startDrag = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      active = true
      
      if (!gameActive) {
        gameActive = true
      }
      
      if (!hasMoved) {
        hasMoved = true
        ctx.sfx.play('basketStart')
        if (paRoot) paRoot.classList.add('has-interacted')
        if (spawnOnMove) {
          startSpawning(true)
        }
      }
      
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
      onMove(e)
    }
    
    dragTarget.style.touchAction = 'none'
    dragTarget.style.pointerEvents = 'auto'
    dragTarget.addEventListener('pointerdown', startDrag)
    dragAttachedBasket = dragTarget
    basketStartDrag = startDrag
  }

  const showCatchEffect = (idx: number, currentScale: number, paRootRect: DOMRect): void => {
    const pAssetId = popupImages.length > 0 ? popupImages[idx % popupImages.length] : ''
    const pConfig = popupConfigs.length > idx ? popupConfigs[idx] : null
    const pSrc = pAssetId ? ctx.assets.src(pAssetId) : ''
    if (!pAssetId || !paRoot || !pSrc) return

    const pEl = document.createElement('div')
    pEl.dataset.id = `popup_image_${idx + 1}`
    pEl.style.position = 'absolute'
    pEl.style.pointerEvents = 'none'
    pEl.style.zIndex = (pConfig?.zIndex ?? 10000).toString()

    const cx = pConfig?.x ?? 540
    const cy = pConfig?.y ?? 960
    const w = pConfig?.w ?? 400
    const h = pConfig?.h ?? 400
    const scale = pConfig?.scale ?? 1.0
    const angle = pConfig?.angle ?? 0
    const pw = w * scale * currentScale
    const ph = h * scale * currentScale
    const rootRect = root.getBoundingClientRect()
    const rootCenterX = rootRect.left + rootRect.width / 2

    pEl.style.width = pw + 'px'
    pEl.style.height = ph + 'px'
    pEl.style.left = (rootCenterX - paRootRect.left + (cx - 540) * currentScale - pw / 2) + 'px'
    pEl.style.top = (cy * currentScale - ph / 2) + 'px'
    pEl.style.backgroundImage = `url("${pSrc}")`
    pEl.style.backgroundSize = 'contain'
    pEl.style.backgroundPosition = 'center'
    pEl.style.backgroundRepeat = 'no-repeat'
    pEl.style.opacity = (pConfig?.opacity ?? 1).toString()
    if (angle) pEl.style.transform = `rotate(${angle}deg)`

    const anim = pConfig?.anim
    if (anim && anim !== 'none') {
      const duration = Number(pConfig?.durationMs ?? 600)
      const delay = Number(pConfig?.delayMs ?? 0)
      const easing = String(pConfig?.easing ?? 'cubic-bezier(0.34, 1.56, 0.64, 1)')
      const iterations = pConfig?.iterations ?? 1
      pEl.style.animation = `pa-${anim} ${duration}ms ${easing} ${delay}ms ${iterations} both`
    }

    paRoot.appendChild(pEl)
  }

  const parseNumList = (strValue: unknown): number[] => {
    return String(strValue ?? '').split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
  }

  const parseBoolList = (strValue: unknown): boolean[] => {
    return String(strValue ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).map(s => s === '1' || s === 'true' || s === 'yes')
  }

  return {
    mount(c, params) {
      gameParams = params
      ctx = c
      root = ctx.root

      itemTypes = Number(params.itemTypes ?? 3)
      requireUnique = params.requireUnique !== false
      need = (requireUnique && itemTypes > 0) ? itemTypes : Number(params.catches ?? 5)
      scoreMode = String(params.scoreMode ?? 'Increment')
      speedParam = Number(params.speed ?? 0.55)
      spawnMs = Number(params.spawnMs ?? 900)
      randomizeAngle = !!params.randomizeAngle
      randomAngleList = parseNumList(params.randomAngles)
      if (randomAngleList.length === 0) randomAngleList = [0, 45, -45, 90]
      visibleFirstRender = !!params.visibleFirstRender
      spawnOnMove = !!params.spawnOnMove
      basketLocked = params.basketLocked === 'Locked'
      showCaughtItemsPreview = !!params.showCaughtItemsPreview

      const ids = Array.isArray(params.itemImages) ? (params.itemImages as string[]) : (params.itemImage ? [String(params.itemImage)] : [])
      itemImages = ids.map((id) => ctx.assets.src(id)).filter(Boolean)

      itemSizes = parseNumList(params.itemSizes)
      if (itemSizes.length === 0) itemSizes = [120]
      
      caughtItemXs = parseNumList(params.caughtItemXs)
      caughtItemYs = parseNumList(params.caughtItemYs)
      caughtItemAngles = parseNumList(params.caughtItemAngles)
      caughtItemScales = parseNumList(params.caughtItemScales)
      caughtItemZIndexes = parseNumList(params.caughtItemZIndexes)
      if (caughtItemZIndexes.length === 0) {
        const legacyZIndex = Number(params.caughtItemZIndex ?? 1)
        caughtItemZIndexes = Number.isFinite(legacyZIndex) ? [legacyZIndex] : [1]
      }
      caughtItemUseItemSizes = parseBoolList(params.caughtItemUseItemSizes)
      
      frontBasketLogicalW = Number(params.frontBasketWidth ?? params.basketWidth ?? 300)
      frontBasketLogicalH = Number(params.frontBasketHeight ?? params.basketHeight ?? 150)
      frontBasketOffsetX = Number(params.frontBasketOffsetX ?? 0)
      frontBasketOffsetY = Number(params.frontBasketOffsetY ?? params.basketOffsetY ?? 0)
      frontBasketAssetIdStr = params.frontBasketImage ? String(params.frontBasketImage) : (params.basketImage ? String(params.basketImage) : (params.basketAssetId ? String(params.basketAssetId) : ''))

      backBasketLogicalW = Number(params.backBasketWidth ?? 300)
      backBasketLogicalH = Number(params.backBasketHeight ?? 150)
      backBasketOffsetX = Number(params.backBasketOffsetX ?? 0)
      backBasketOffsetY = Number(params.backBasketOffsetY ?? 0)
      backBasketAssetIdStr = params.backBasketImage ? String(params.backBasketImage) : ''

      popupImages = (Array.isArray(params.popupImages) ? params.popupImages : []).map(a => String(a))
      try {
        popupConfigs = JSON.parse(String(params.popupConfigs || '[]'))
      } catch (e) {
        popupConfigs = []
      }

      paRoot = root.closest('.pa-root') as HTMLElement | null
      if (!paRoot) paRoot = root.parentElement
      
      // Note: Basket DOM creation is deferred to relayout() because paRoot 
      // is not reliably available during mount() before injection.

      updateScoreUI()
      injectAnimStyles()
    },
    start() {
      gameActive = !visibleFirstRender
      
      paRoot = root.closest('.pa-root') as HTMLElement | null
      if (!paRoot) {
        paRoot = root.parentElement
      }

      // Create dropsContainer on pa-root so items span the full screen
      // z-index 31 = behind basket (z:32) but in front of CTA (z:30)
      if (paRoot) {
        dropsContainer = document.createElement('div')
        dropsContainer.style.position = 'absolute'
        dropsContainer.style.left = '0'
        dropsContainer.style.top = '0'
        dropsContainer.style.width = '100%'
        dropsContainer.style.height = '100%'
        dropsContainer.style.overflow = 'visible'
        dropsContainer.style.pointerEvents = 'none'
        dropsContainer.style.zIndex = '31'
        paRoot.appendChild(dropsContainer)
      }
      
      
      hasMoved = false
      if (!spawnOnMove) {
        startSpawning(true)
      }
      startAnimation()
      visibilityHandler = handleVisibilityChange
      document.addEventListener('visibilitychange', visibilityHandler)
    },
    relayout() {
      // Find paRoot if we haven't already
      if (!paRoot) paRoot = root.closest('.pa-root') as HTMLElement | null
      if (!paRoot) paRoot = root.parentElement

      // Create baskets if needed
      if (paRoot && !frontBasket) {
        frontBasket = document.createElement('div')
        frontBasket.dataset.id = 'basket'
        frontBasket.style.position = 'fixed'
        frontBasket.style.zIndex = '32'
        frontBasket.style.pointerEvents = 'none'
        frontBasket.style.overflow = 'visible'
        paRoot.appendChild(frontBasket)
        
        caughtItemsContainer = document.createElement('div')
        caughtItemsContainer.style.position = 'absolute'
        caughtItemsContainer.style.left = '0'
        caughtItemsContainer.style.top = '0'
        caughtItemsContainer.style.width = '100%'
        caughtItemsContainer.style.height = '100%'
        caughtItemsContainer.style.zIndex = '0'
        caughtItemsContainer.style.pointerEvents = 'none'
        frontBasket.appendChild(caughtItemsContainer)

        const frontImgLayer = document.createElement('div')
        frontImgLayer.dataset.id = 'basket_drag_target'
        frontImgLayer.style.position = 'absolute'
        frontImgLayer.style.left = '0'
        frontImgLayer.style.top = '0'
        frontImgLayer.style.width = '100%'
        frontImgLayer.style.height = '100%'
        
        if (frontBasketAssetIdStr) {
          frontImgLayer.style.backgroundImage = `url(${ctx.assets.src(frontBasketAssetIdStr)})`
          frontImgLayer.style.backgroundSize = '100% 100%'
          frontImgLayer.style.backgroundPosition = 'center bottom'
          frontImgLayer.style.backgroundRepeat = 'no-repeat'
        } else if (!backBasketAssetIdStr) {
          // Fallback placeholder rectangle if no image is set at all
          frontImgLayer.style.background = 'linear-gradient(#a16207,#7c4a12)'
          frontImgLayer.style.border = '3px solid #5a3410'
          frontImgLayer.style.borderRadius = '0 0 16px 16px'
        }
        
        frontImgLayer.style.zIndex = '1'
        frontImgLayer.style.pointerEvents = 'auto'
        frontBasket.appendChild(frontImgLayer)
        basketDragTarget = frontImgLayer
        attachDrag()
      }

      if (paRoot && backBasketAssetIdStr && !backBasket) {
        backBasket = document.createElement('div')
        backBasket.dataset.id = 'back_basket'
        backBasket.style.position = 'fixed'
        backBasket.style.zIndex = '30'
        backBasket.style.pointerEvents = 'none'
        backBasket.style.overflow = 'visible'
        paRoot.appendChild(backBasket)
        
        const backImgLayer = document.createElement('div')
        backImgLayer.style.position = 'absolute'
        backImgLayer.style.left = '0'
        backImgLayer.style.top = '0'
        backImgLayer.style.width = '100%'
        backImgLayer.style.height = '100%'
        
        backImgLayer.style.backgroundImage = `url(${ctx.assets.src(backBasketAssetIdStr)})`
        backImgLayer.style.backgroundSize = '100% 100%'
        backImgLayer.style.backgroundPosition = 'center bottom'
        backImgLayer.style.backgroundRepeat = 'no-repeat'
        
        backImgLayer.style.zIndex = '1'
        backImgLayer.style.pointerEvents = 'none'
        backBasket.appendChild(backImgLayer)
      }

      if (paRoot && frontBasket) {
        const currentScale = s()
        frontBasket.style.left = '50%'
        frontBasket.style.width = (frontBasketLogicalW * currentScale) + 'px'
        frontBasket.style.height = (frontBasketLogicalH * currentScale) + 'px'
        frontBasket.style.marginLeft = `-${(frontBasketLogicalW / 2) * currentScale}px`
        const fx = basketX + frontBasketOffsetX
        frontBasket.style.transform = `translateX(${(fx - 540) * currentScale}px)`
        
        // Compute vertical position now that elements are injected in the DOM
        const footerBar = paRoot.querySelector('[data-id="basket_bar"]') as HTMLElement | null
        const paRootRect = paRoot.getBoundingClientRect()
        const footerTop = footerBar ? footerBar.getBoundingClientRect().top : paRootRect.bottom
        const frontBasketPhysicalH = frontBasketLogicalH * currentScale
        frontBasket.style.top = `${footerTop - paRootRect.top - frontBasketPhysicalH - (frontBasketOffsetY * currentScale)}px`
        frontBasket.style.bottom = ''
        
        if (backBasket) {
          backBasket.style.left = '50%'
          backBasket.style.width = (backBasketLogicalW * currentScale) + 'px'
          backBasket.style.height = (backBasketLogicalH * currentScale) + 'px'
          backBasket.style.marginLeft = `-${(backBasketLogicalW / 2) * currentScale}px`
          const bx = basketLocked ? basketX + backBasketOffsetX : 540 + backBasketOffsetX
          backBasket.style.transform = `translateX(${(bx - 540) * currentScale}px)`
          const backBasketPhysicalH = backBasketLogicalH * currentScale
          backBasket.style.top = `${footerTop - paRootRect.top - backBasketPhysicalH - (backBasketOffsetY * currentScale)}px`
          backBasket.style.bottom = ''
        }
        
        // Also render preview items if needed
        if (showCaughtItemsPreview && caughtItemsContainer && caughtItemsContainer.childElementCount <= 0) {
          const previewIndex = Number(gameParams.caughtItemPreviewIndex)
          const previewIndexes = parseNumList(gameParams.caughtItemPreviewIndexes).map((idx) => Math.floor(idx))
          const layoutCount = Math.max(1, caughtItemXs.length, caughtItemYs.length, caughtItemAngles.length, caughtItemScales.length, caughtItemZIndexes.length, caughtItemUseItemSizes.length)
          const numItems = itemTypes > 0 ? Math.max(itemTypes, layoutCount) : layoutCount
          const previewMode = String(gameParams.caughtItemPreviewMode ?? 'all')
          const selectedPreviewItems = previewIndexes.length > 0 ? previewIndexes : (Number.isFinite(previewIndex) ? [previewIndex] : [])
          const previewItems = previewMode === 'selected' && selectedPreviewItems.length > 0 ? selectedPreviewItems.map((idx) => Math.max(0, Math.min(numItems - 1, idx))) : Array.from({ length: numItems }, (_, idx) => idx)
          for (const i of previewItems) {
            const el = document.createElement('div')
            el.style.position = 'absolute'
            const sz = itemSizes[i % itemSizes.length] || 120
            const physicalItemSz = sz * currentScale
            el.style.width = physicalItemSz + 'px'
            el.style.height = physicalItemSz + 'px'
            
            const defaultOffsetX = 0
            const offsetX = caughtItemXs.length > 0 ? (caughtItemXs[i % caughtItemXs.length] ?? defaultOffsetX) : defaultOffsetX
            const offsetY = caughtItemYs.length > 0 ? (caughtItemYs[i % caughtItemYs.length] ?? -5) : -5
            const angle = caughtItemAngles.length > 0 ? (caughtItemAngles[i % caughtItemAngles.length] ?? 0) : 0
            const authoredScale = caughtItemScales.length > 0 ? (caughtItemScales[i % caughtItemScales.length] ?? 0.7) : 0.7
            const useItemSize = caughtItemUseItemSizes.length > 0 ? (caughtItemUseItemSizes[i % caughtItemUseItemSizes.length] ?? false) : false
            const scale = useItemSize ? 1 : authoredScale
            const zIndex = caughtItemZIndexes.length > 0 ? (caughtItemZIndexes[i % caughtItemZIndexes.length] ?? 1) : 1
            
            el.style.left = `${(frontBasketLogicalW / 2) * currentScale + offsetX * currentScale - physicalItemSz / 2}px`
            el.style.top = `${offsetY * currentScale}px`
            el.style.transform = `rotate(${angle}deg) scale(${scale})`
            el.style.transformOrigin = 'bottom center'
            el.style.opacity = '1'
            el.style.zIndex = `${zIndex}`
            
            const src = itemImages.length > 0 ? itemImages[i % itemImages.length] : ''
            if (src) {
              const img = document.createElement('img')
              img.src = src
              img.style.width = '100%'
              img.style.height = '100%'
              img.style.objectFit = 'contain'
              img.draggable = false
              el.appendChild(img)
            }
            caughtItemsContainer.appendChild(el)
          }
        }
        
        // Render popup preview if toggle is true
        let showPopupPreview = !!gameParams.showPopupPreview
        if (showPopupPreview && itemTypes > 0) {
          // Clear old ones first
          paRoot.querySelectorAll('[data-id^="popup_image_"]').forEach(el => el.remove())

          const numItems = itemTypes
          for (let i = 0; i < numItems; i++) {
            const pAssetId = popupImages.length > 0 ? popupImages[i % popupImages.length] : ''
            const pConfig = popupConfigs.length > i ? popupConfigs[i] : null
            const pSrc = pAssetId ? ctx.assets.src(pAssetId) : ''
            
            if (pAssetId && paRoot && pSrc) {
              const pEl = document.createElement('div')
              pEl.dataset.id = `popup_image_${i + 1}`
              pEl.style.position = 'absolute'
              pEl.style.pointerEvents = 'none'
              pEl.style.zIndex = (pConfig?.zIndex ?? 10000).toString()
              
              const cx = pConfig?.x ?? 540
              const cy = pConfig?.y ?? 960
              const w = pConfig?.w ?? 400
              const h = pConfig?.h ?? 400
              const scale = pConfig?.scale ?? 1.0
              const angle = pConfig?.angle ?? 0
              
              const pw = w * scale * currentScale
              const ph = h * scale * currentScale
              
              const rootRect = root.getBoundingClientRect()
              const zoomX = paRootRect.width / (paRoot.offsetWidth || 1080)
              const logicalRootCenterX = (rootRect.left + rootRect.width / 2 - paRootRect.left) / zoomX
              
              pEl.style.width = pw + 'px'
              pEl.style.height = ph + 'px'
              pEl.style.left = (logicalRootCenterX + (cx - 540) * currentScale - pw / 2) + 'px'
              pEl.style.top = (cy * currentScale - ph / 2) + 'px'
              
              pEl.style.backgroundImage = `url("${pSrc}")`
              pEl.style.backgroundSize = 'contain'
              pEl.style.backgroundPosition = 'center'
              pEl.style.backgroundRepeat = 'no-repeat'
              pEl.style.opacity = (pConfig?.opacity ?? 1).toString()
              
              if (angle) pEl.style.transform = `rotate(${angle}deg)`
              
              paRoot.appendChild(pEl)
            }
          }
        }
      }
      
      // Update UI on layout (e.g. initial render)
      updateScoreUI()
    },
    getHint(): HintMove | null {
      if (done || !drops.length || !frontBasket || !paRoot) return null
      // Get the lowest uncaptured drop
      const lowest = drops.reduce((a, b) => (!b.captured && b.y > a.y ? b : a))
      if (lowest.captured) return null
      
      const from: Pt = { x: 0, y: 0 }
      const r = frontBasket.getBoundingClientRect()
      const paRootRect = paRoot.getBoundingClientRect()
      
      from.x = r.left + r.width / 2
      from.y = r.top + r.height / 2
      
      // Calculate where the basket needs to move to catch it
      const currentScale = s()
      const item_screen_x = paRootRect.left + paRootRect.width / 2 + (lowest.x - 540) * currentScale
      
      return { from, to: { x: item_screen_x, y: from.y }, kind: 'slide' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    destroy() {
      stopSpawning()
      stopAnimation()
      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler)
        visibilityHandler = null
      }
      if (dropsContainer && dropsContainer.parentNode) {
        dropsContainer.parentNode.removeChild(dropsContainer)
      }
      if (dragAttachedBasket && basketStartDrag) {
        dragAttachedBasket.removeEventListener('pointerdown', basketStartDrag)
        dragAttachedBasket = null
        basketStartDrag = null
      }
      if (frontBasket && frontBasket.parentNode) {
        frontBasket.parentNode.removeChild(frontBasket)
        frontBasket = null
      }
      basketDragTarget = null
      if (backBasket && backBasket.parentNode) {
        backBasket.parentNode.removeChild(backBasket)
        backBasket = null
      }
    },
  }
}

export const CATCH_TEMPLATE: GameTemplate = {
  id: 'catch',
  label: 'Catch (drag basket)',
  paramFields: [
    { key: 'catches', label: 'Catches to win', type: 'number', min: 1, max: 50, step: 1 },
    { key: 'speed', label: 'Fall speed (screens/sec)', type: 'number', min: 0.2, max: 3.0, step: 0.05 },
    { key: 'spawnMs', label: 'Spawn interval (ms)', type: 'number', min: 100, max: 10000, step: 50 },
    { key: 'randomizeAngle', label: 'Randomize fall angle', type: 'boolean' },
    { key: 'randomAngles', label: 'Random angles (deg, comma sep)', type: 'text' },
    { key: 'visibleFirstRender', label: 'Display falling item at the side', type: 'boolean' },
    { key: 'spawnOnMove', label: 'Start spawning on first move', type: 'boolean' },
    { key: 'scoreMode', label: 'Scoring Mode', type: 'select', options: ['Increment', 'Decrement'] },
    { key: 'requireUnique', label: 'Require 1 of each unique item', type: 'boolean' },
    { key: 'itemTypes', label: 'Unique item types', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'itemSizes', label: 'Item Sizes (comma separated px)', type: 'text' },
    { key: 'frontBasketWidth', label: 'Front Basket Width (px)', type: 'number', min: 50, max: 3000, step: 10 },
    { key: 'frontBasketHeight', label: 'Front Basket Height (px)', type: 'number', min: 50, max: 3000, step: 10 },
    { key: 'frontBasketOffsetX', label: 'Front Basket Horizontal Offset (px)', type: 'number', min: -2000, max: 2000, step: 10 },
    { key: 'frontBasketOffsetY', label: 'Front Basket Vertical Offset (px)', type: 'number', min: -2000, max: 2000, step: 10 },
    { key: 'backBasketWidth', label: 'Back Basket Width (px)', type: 'number', min: 50, max: 3000, step: 10 },
    { key: 'backBasketHeight', label: 'Back Basket Height (px)', type: 'number', min: 50, max: 3000, step: 10 },
    { key: 'backBasketOffsetX', label: 'Back Basket Horizontal Offset (px)', type: 'number', min: -2000, max: 2000, step: 10 },
    { key: 'backBasketOffsetY', label: 'Back Basket Vertical Offset (px)', type: 'number', min: -2000, max: 2000, step: 10 },
    { key: 'basketLocked', label: 'Basket Lock', type: 'select', options: ['Locked', 'Unlocked'] },
    { key: 'caughtItemXs', label: 'Caught Xs (px, comma sep)', type: 'text' },
    { key: 'caughtItemYs', label: 'Caught Ys (px, comma sep)', type: 'text' },
    { key: 'caughtItemAngles', label: 'Caught Angles (deg, comma sep)', type: 'text' },
    { key: 'caughtItemScales', label: 'Caught Scales (comma sep, e.g. 0.7)', type: 'text' },
    { key: 'caughtItemZIndexes', label: 'Caught Layers (comma sep)', type: 'text' },
    { key: 'caughtItemUseItemSizes', label: 'Caught Use Item Sizes (1/0 comma sep)', type: 'text' },
    { key: 'caughtItemPreviewIndexes', label: 'Caught Preview Indexes', type: 'text' },
    { key: 'caughtItemPreviewIndex', label: 'Caught Preview Index', type: 'number', min: 0, max: 50, step: 1 },
    { key: 'caughtItemPreviewMode', label: 'Caught Preview Mode', type: 'select', options: ['all', 'selected'] },
    { key: 'showCaughtItemsPreview', label: 'Preview caught items (Editor only)', type: 'boolean' },
    { key: 'showPopupPreview', label: 'Preview popups (Editor only)', type: 'boolean' },
  ],
  assetSlots: [
    { key: 'itemImages', label: 'Falling item images', list: true, countParam: 'itemTypes' },
    { key: 'popupImages', label: 'Popup Images (1 per unique item)', list: true, countParam: 'itemTypes' },
    { key: 'frontBasketImage', label: 'Front Basket Image', accept: 'image' },
    { key: 'backBasketImage', label: 'Back Basket Image', accept: 'image' },
  ],
  defaultParams: {
    catches: 5, speed: 0.55, spawnMs: 900,
    randomizeAngle: false, randomAngles: '0, 45, -45, 90', visibleFirstRender: false, spawnOnMove: false,
    scoreMode: 'Increment', requireUnique: true, itemTypes: 3,
    itemSizes: '120', 
    frontBasketWidth: 300, frontBasketHeight: 150, frontBasketOffsetX: 0, frontBasketOffsetY: 0,
    backBasketWidth: 300, backBasketHeight: 150, backBasketOffsetX: 0, backBasketOffsetY: 0,
    frontBasketImage: '', backBasketImage: '',
    basketLocked: 'Locked',
    caughtItemXs: '', caughtItemYs: '', caughtItemAngles: '', caughtItemScales: '', caughtItemZIndexes: '1', caughtItemUseItemSizes: '0', caughtItemZIndex: 1,
    showCaughtItemsPreview: false, caughtItemPreviewMode: 'all', popupConfigs: '[]'
  },
  defaultHandguide: {
    nodes: [
      { x: 0.3, y: 0.85 },
      { x: 0.7, y: 0.85 },
    ],
    periodMs: 1700,
  },
  create: createCatch,
}
