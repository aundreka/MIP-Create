import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { injectAnimStyles } from '../anim'
import { COMBO_OFF_CLASS } from './combo'
import '../catch.css'

/** The shared "hidden without touching inline display/opacity" class. layoutRec rewrites
 * both of those properties on every layout pass, so an inline hide would be dropped by
 * the next resize; this is a class instead. It is combo's export only because combo
 * needed it first — the rule (stage.ts) is generic. */
const OFF_CLASS = COMBO_OFF_CLASS

/** Full opacity for an item whose copy has been caught. A class with !important for the
 * same reason: the point is to OVERRIDE the resting opacity layoutRec keeps rewriting
 * from the element's own value. Defined in stage.ts alongside .pa-combo-off. */
const CAUGHT_CLASS = 'pa-catch-caught'

interface Drop {
  id: number
  x: number
  y: number
  speed: number
  angle: number
  imgSrc: string
  imgIdx: number
  captured: boolean
  /** Logical size of the falling copy. Width and height are tracked separately so a
   * copy of a placed element keeps that element's aspect instead of being squared off
   * into a box and letterboxed inside it. */
  w: number
  h: number
  el?: HTMLElement
}

/**
 * A placed element standing in for one falling item — a shoe in the row along the top.
 *
 * It plays two parts at once, which is the whole point of assigning elements rather than
 * bare images: its art is what falls, AND it is that item's tick-list entry, sitting at
 * whatever opacity the author gave it until one of its copies is caught. Its position,
 * size, crop and animation stay entirely its own, edited on the canvas.
 */
interface ItemEl {
  el: HTMLElement
  /** 1-based, from the panel. Order on the board, not scene order. */
  index: number
  /** The art the falling copies are made of. */
  src: string
  caught: boolean
  /** Inline transition layoutRec left on it, handed back on destroy. */
  restTransition: string
  /** The check mark stamped over it once caught, if there is one to stamp. */
  check: HTMLElement | null
}

export function createCatch(): GameModule {
  let ctx: GameContext
  let root: HTMLElement
  let dropsContainer: HTMLDivElement
  // The box's front layer (role 'boxfront'), and the styles it had before the game
  // borrowed it — restored on destroy so the editor canvas gets its element back intact.
  let boxFrontEl: HTMLElement | null = null
  let boxFrontRestPointer = ''
  let boxFrontRestZ = ''
  // The elements assigned role 'soften', and the patch riding over each (syncSoften).
  let softenEls: HTMLElement[] = []
  // Item index (1-based) → the element standing in for that product once it is in the box.
  // The author placed each one inside the box on the canvas; play hides them until caught.
  const collectedEls = new Map<number, { el: HTMLElement; restZ: string; restClip: string }>()
  let softenPatches: { el: HTMLElement; patch: HTMLElement }[] = []
  let softenBlurPx = 0
  let softenOpacity = 1
  let drops: Drop[] = []
  
  let scoreMode: string
  let need: number
  let speedParam: number
  let spawnMs: number
  let randomizeAngle: boolean
  let randomAngleList: number[] = [0, 45, -45, 90]
  let visibleFirstRender: boolean
  let basketLocked: boolean
  let catchDepth = 0
  let placeMs = 220
  let itemTypes: number = 0
  let showCaughtItemsPreview: boolean = false
  let itemImages: string[] = []
  let popupImages: string[] = []
  let popupConfigs: any[] = []
  let requireUnique: boolean = true
  /** How many times more likely a still-missing item is to be thrown than one already
   * collected. 1 = a flat random draw. */
  let uncaughtBias: number = 4

  let done = false
  let caught = 0
  let basketX = 540
  let lastTime = 0
  let rafRef = 0
  let spawnTimer = 0
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null
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
  let caughtItemZIndex = 1

  // Falling items assigned as PLACED ELEMENTS (see CatchRoleConfig in scene.ts). When
  // any are assigned they replace the asset slots entirely: the board is the row the
  // author arranged on the canvas, and `itemImages` is only the older image-slot path.
  let itemEls: ItemEl[] = []
  let checkEl: HTMLElement | null = null
  let checkCanvasShown = false
  /**
   * A placed element used as the box, instead of the game's own basket rig.
   *
   * Where the author dropped it is where it stays: the game only ever moves it
   * sideways, and the height it was placed at IS the catch line — so the line is set by
   * dragging a picture around the canvas rather than by an offset measured from the
   * footer. Its measured box is cached rather than read every frame; `basketHomeX` is
   * its resting centre in logical units, which the sideways drag is an offset from.
   */
  let basketEl: HTMLElement | null = null
  let basketHomeX = 540
  let basketHomeSet = false
  /** The box's measured geometry in pa-root px: top edge, and size. */
  let basketTopPx = 0
  let basketWPx = 0
  let basketHPx = 0
  // The products collected so far, in the order they landed. They stay in the box for the
  // rest of the game and are re-laid out as a group each time one arrives (see stackCaught).
  let caughtInBox: { el: HTMLElement; w: number; h: number; angle: number }[] = []
  let autoStack = true
  let basketRestPointer = ''
  let basketRestZ = ''
  /** How much bigger a falling copy is than the placed element it comes from. The row
   * entries are tick-list sized; the things that fall are not. */
  let itemFallScale = 2
  let caughtFadeMs = 260
  let checkScale = 1
  let checkOffsetX = 0
  let checkOffsetY = 0
  let checkFadeMs = 260
  let checkFrom = 0.5

  let frontBasket: HTMLDivElement | null = null
  let backBasket: HTMLDivElement | null = null
  let basketDragTarget: HTMLDivElement | null = null
  let dragAttachedBasket: HTMLDivElement | null = null
  let basketStartDrag: ((e: PointerEvent) => void) | null = null
  // Capture-phase pick-up for a PLACED box (see attachDrag). Held so destroy can drop it.
  let rootDragDown: ((e: PointerEvent) => void) | null = null
  let rootDragOn: HTMLElement | null = null
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
  // ---- placed item elements --------------------------------------------------
  /**
   * The art a placed element is showing, so a falling copy can be made of it.
   *
   * A plain image element is a real <img> (see elements/image.ts); a masked container, a
   * button or a bar paints its picture as a CSS background instead, so both are read.
   */
  const artSrcOf = (el: HTMLElement): string => {
    const img = el.querySelector('img')
    const src = img?.getAttribute('src') ?? ''
    if (src) return src
    for (const node of [el.querySelector('.pa-el-anim'), el] as (HTMLElement | null)[]) {
      const bg = node?.style.backgroundImage || ''
      const match = /url\((['"]?)(.*?)\1\)/.exec(bg)
      if (match?.[2]) return match[2]
    }
    return ''
  }

  /**
   * Claim the elements the panel assigned to this game.
   *
   * Same first-come claim the rest of the family uses: an element addressed to another
   * catch game is not ours, and an unaddressed one is taken by whoever gets there first,
   * so two catch games in one scene can't fight over the same shoe.
   */
  const collectSceneItems = (): void => {
    const stageRoot = root.closest('.pa-root')
    if (!stageRoot) return
    for (const el of Array.from(stageRoot.querySelectorAll<HTMLElement>('[data-catch-role]'))) {
      const wanted = el.dataset.catchGameId
      if (wanted ? wanted !== ctx.elementId : !!el.dataset.catchClaimedBy) continue
      if (el.dataset.catchRole === 'item') {
        el.dataset.catchClaimedBy = ctx.elementId ?? 'catch'
        itemEls.push({
          el,
          index: Math.max(1, Math.round(Number(el.dataset.catchIndex) || itemEls.length + 1)),
          src: artSrcOf(el),
          caught: false,
          restTransition: el.style.transition,
          check: null,
        })
      } else if (el.dataset.catchRole === 'box' && !basketEl) {
        // One box per game — a second assignment would be two things to drag with one
        // finger. The first one tagged wins, as everywhere else in this family.
        el.dataset.catchClaimedBy = ctx.elementId ?? 'catch'
        basketEl = el
        basketRestPointer = el.style.pointerEvents
        basketRestZ = el.style.zIndex
      } else if (el.dataset.catchRole === 'boxfront' && !boxFrontEl) {
        // The box's front layer. It never catches anything and never takes the drag —
        // it only rides along with the box and paints over the falling items.
        el.dataset.catchClaimedBy = ctx.elementId ?? 'catch'
        boxFrontEl = el
        boxFrontRestPointer = el.style.pointerEvents
        boxFrontRestZ = el.style.zIndex
        el.style.pointerEvents = 'none'
      } else if (el.dataset.catchRole === 'collected') {
        // One per item, addressed by that item's number. It keeps its own art and the place
        // the author put it; the game only shows or hides it, and slides it with the box.
        const idx = Math.max(1, Math.round(Number(el.dataset.catchIndex) || 1))
        if (!collectedEls.has(idx)) {
          el.dataset.catchClaimedBy = ctx.elementId ?? 'catch'
          collectedEls.set(idx, { el, restZ: el.style.zIndex, restClip: el.style.clipPath })
        }
      } else if (el.dataset.catchRole === 'soften') {
        // Any number of these. They keep their own art and their own layer — the game only
        // reads where they are, so it can soften whatever is falling behind them.
        el.dataset.catchClaimedBy = ctx.elementId ?? 'catch'
        softenEls.push(el)
      } else if (el.dataset.catchRole === 'check' && !checkEl) {
        // One check mark for the whole board — it is copied onto each item as that item
        // is caught, so a five-item board needs one assignment rather than five.
        el.dataset.catchClaimedBy = ctx.elementId ?? 'catch'
        checkEl = el
        checkCanvasShown = el.dataset.catchCanvasShow === '1'
      }
    }
    itemEls.sort((a, b) => a.index - b.index)
  }

  /**
   * The logical size a copy of item `idx` falls at.
   *
   * With placed elements the base is the element's own size on the canvas — so the board
   * is sized by dragging the row around rather than by typing numbers — multiplied by
   * `itemFallScale`, because a tick-list icon is not the size a thing should fall at.
   * `offsetWidth` is the element's laid-out CSS width (logical x the stage scale) and
   * ignores transforms, so an idle wobble on the row can't resize what falls.
   */
  const fallSize = (idx: number): { w: number; h: number } => {
    const item = itemEls[idx]
    const currentScale = s() || 1
    if (item) {
      const w = item.el.offsetWidth / currentScale
      const h = item.el.offsetHeight / currentScale
      if (w > 0 && h > 0) return { w: w * itemFallScale, h: h * itemFallScale }
    }
    const sz = itemSizes[idx % itemSizes.length] || 120
    return { w: sz, h: sz }
  }

  /** The box's catching width in logical units — the placed element's own width when
   * there is one, else the basket rig's number. */
  const basketW = (): number => (basketEl ? basketWPx / (s() || 1) : frontBasketLogicalW)

  /** The box's catching HEIGHT in logical units, the same way round as basketW: the placed
   * element's own height when there is one, else the basket rig's number. What the
   * collection stands in is one or the other — the rig has no `basketHPx`, which is what
   * used to leave its caught products unplaced. */
  const basketH = (): number => (basketEl ? basketHPx / (s() || 1) : frontBasketLogicalH)

  // How the box holds what it has collected: a margin either side, a floor to stand the
  // bottom row on, and a ceiling — the share of the box's height the collection may fill
  // before the products have to get smaller.
  const STACK_PAD_X = 0.07
  const STACK_FLOOR = 0.9
  const STACK_MAX_H = 0.72
  const STACK_GAP = 0.02
  const STACK_BASE = 0.75

  /**
   * Stand the collected products IN the box.
   *
   * They fill it the way a box being packed fills: a row along the floor, and when that row
   * is full the next one stacks on top of it. Products keep their size as long as the
   * collection fits under the ceiling; once it doesn't, everything shrinks by one shared
   * factor and repacks, so the box takes more without anything spilling over its sides.
   *
   * Laid out as a GROUP every time one arrives, and again on every layout pass, because the
   * fit depends on the whole set and on the box's size on screen. Nothing is ever removed:
   * what the box has collected stays collected.
   *
   * The alternative is the manual path — caught Xs/Ys/scales typed per item — which places
   * each product exactly where the author says. That is what `caughtStack: 'Manual'` keeps;
   * here the box does its own arranging.
   */
  const stackCaught = (): void => {
    if (!caughtInBox.length) return
    const scale = s() || 1
    // Through basketW/basketH, so this works for BOTH kinds of box: a placed element with
    // its measured size, and the built-in rig with its authored one. Reading basketWPx
    // directly left every rig board's products unplaced — stacked at the container's
    // origin, behind the basket art, which reads as them vanishing on the way in.
    const boxW = basketW() * scale
    const boxH = basketH() * scale
    if (!(boxW > 0) || !(boxH > 0)) return
    const innerW = boxW * (1 - 2 * STACK_PAD_X)
    const gap = innerW * STACK_GAP
    const natural = caughtInBox.map((c) => ({ w: c.w * scale, h: c.h * scale }))
    const authored = caughtItemScales[0]
    const base = authored && authored > 0 ? authored : STACK_BASE
    const ceiling = boxH * STACK_MAX_H

    // Pack left to right, wrapping when the row is full. Rows are returned bottom-first.
    const pack = (k: number): number[][] => {
      const rows: number[][] = []
      let row: number[] = []
      let width = 0
      natural.forEach((d, i) => {
        const w = d.w * k
        if (row.length && width + gap + w > innerW) {
          rows.push(row)
          row = []
          width = 0
        }
        width += (row.length ? gap : 0) + w
        row.push(i)
      })
      if (row.length) rows.push(row)
      return rows
    }
    const stackHeight = (rows: number[][], k: number): number =>
      rows.reduce((n, r) => n + Math.max(...r.map((i) => natural[i].h)) * k, 0) + gap * (rows.length - 1)

    // Shrink until the whole collection fits under the ceiling. Bounded: a box given a
    // hundred products ends with tiny ones rather than with a hung frame.
    let k = base
    let rows = pack(k)
    for (let pass = 0; pass < 24 && stackHeight(rows, k) > ceiling; pass++) {
      k *= 0.88
      rows = pack(k)
    }

    // Bottom row on the floor, each next row resting on the one below.
    let bottom = boxH * STACK_FLOOR
    for (const row of rows) {
      const rowH = Math.max(...row.map((i) => natural[i].h)) * k
      const rowW = row.reduce((n, i) => n + natural[i].w * k, 0) + gap * (row.length - 1)
      let x = (boxW - rowW) / 2
      for (const i of row) {
        const c = caughtInBox[i]
        const w = natural[i].w * k
        const h = natural[i].h * k
        c.el.style.width = `${w}px`
        c.el.style.height = `${h}px`
        c.el.style.left = `${x}px`
        c.el.style.top = `${bottom - h}px` // products of different heights share a baseline
        c.el.style.transform = c.angle ? `rotate(${c.angle}deg)` : ''
        c.el.style.transformOrigin = 'bottom center'
        x += w + gap
      }
      bottom -= rowH + gap
    }
  }

  /**
   * Turn a falling copy into its place in the box.
   *
   * Swapping one for the other in a single frame reads as the product blinking out and a
   * different one blinking in. So the two are cross-dissolved instead: the copy flies from
   * wherever it was caught to the place's own box — travelling and resizing into it — while
   * it fades out and the place fades in underneath. What the player sees is the product
   * settling into the box.
   *
   * The copy carries the movement because it is the game's own element and nothing else
   * writes to it. The place only takes an opacity transition: its position, size and
   * transform belong to the layout, which rewrites them on any layout pass, and a flight
   * animated on those would fight it.
   *
   * `placeMs` of 0 is the instant swap, for a board that wants it.
   */
  const morphIntoPlace = (copy: HTMLElement, place: HTMLElement): void => {
    if (placeMs > 0) place.style.transition = `opacity ${placeMs}ms ease`
    place.classList.remove(OFF_CLASS)
    clipCollected() // bounded to the box from the frame it appears
    if (placeMs <= 0 || !paRoot) {
      copy.remove()
      return
    }
    window.setTimeout(() => {
      place.style.transition = ''
    }, placeMs + 60)

    const rootRect = paRoot.getBoundingClientRect()
    const zoom = rootRect.width > 0 && paRoot.offsetWidth > 0 ? rootRect.width / paRoot.offsetWidth : 1
    const pr = place.getBoundingClientRect()
    const br = basketEl?.getBoundingClientRect()
    if (pr.width > 0 && pr.height > 0) {
      // Bring the copy inside the box before it sets off.
      //
      // It is caught the moment it touches the rim, which the hit test allows with part of
      // it still past the box's side — so a copy can begin its flight overhanging the box.
      // Clipping that overhang was worse than the problem: a product still ABOVE the box got
      // a slice taken off it, which reads as the box cutting into something it has not even
      // caught yet. So it is moved instead — shrunk if it is wider than the box, then
      // centred between the walls, which is the one position that always fits. The flight
      // interpolates linearly from there to a place that is itself inside the box, so every
      // frame in between is inside too, with nothing clipped and nothing hanging over.
      if (br && br.width > 0) {
        const boxLeft = (br.left - rootRect.left) / zoom
        const boxW = br.width / zoom
        const w = parseFloat(copy.style.width) || 0
        const h = parseFloat(copy.style.height) || 0
        if (w > 0) {
          const k = w > boxW ? boxW / w : 1
          const top = parseFloat(copy.style.top) || 0
          copy.style.width = `${w * k}px`
          copy.style.height = `${h * k}px`
          copy.style.left = `${boxLeft + (boxW - w * k) / 2}px`
          copy.style.top = `${top + (h - h * k) / 2}px` // shrink about its own middle
        }
      }
      copy.style.transition = `left ${placeMs}ms ease-in, top ${placeMs}ms ease-in, width ${placeMs}ms ease-in, height ${placeMs}ms ease-in, opacity ${placeMs}ms ease-in`
      // Two frames: one for the transition to be in effect, one for the new values to be a
      // change FROM something rather than the values it was born with.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          copy.style.left = `${(pr.left - rootRect.left) / zoom}px`
          copy.style.top = `${(pr.top - rootRect.top) / zoom}px`
          copy.style.width = `${pr.width / zoom}px`
          copy.style.height = `${pr.height / zoom}px`
          copy.style.opacity = '0'
        }),
      )
    }
    window.setTimeout(() => copy.remove(), placeMs + 60)
  }

  /**
   * A `clip-path` that trims `r` to the box `b`, in the element's own px.
   *
   * Sides and floor only — the top inset is -100%, pushing that edge of the clip a full
   * height clear, because standing proud of the rim is what a box full of products looks
   * like. The other three are NOT clamped at zero: a negative inset simply means the element
   * does not reach that edge and nothing is cut there, and leaving them signed keeps the
   * numbers a linear function of where the element is — which is what lets a product FLYING
   * into the box animate its own clip along the way instead of snapping.
   */
  const boxInset = (r: DOMRect, b: DOMRect, zoom: number): string =>
    `inset(-100% ${(r.right - b.right) / zoom}px ${(r.bottom - b.bottom) / zoom}px ${(b.left - r.left) / zoom}px)`

  /**
   * Keep what the box holds INSIDE the box.
   *
   * A product's place is an ordinary placed element living in pa-root, not a child of the
   * box, so nothing bounds it to the box's edges: art that reaches past the rim simply
   * paints over whatever is outside. Each one is therefore clipped to the box — on three
   * sides. The TOP is left open, because standing proud of the rim is what a box full of
   * products looks like; it is the sides and the floor that must hold.
   *
   * Measured in screen px and converted to the element's own space by the pa-root zoom, the
   * way every other cross-element measurement here works. The clip does not need redoing as
   * the box is dragged: a product travels with it on the same slide, so the two keep exactly
   * the same relative geometry. Only a layout pass can change it.
   */
  const clipCollected = (): void => {
    if (!paRoot || !basketEl || !collectedEls.size) return
    const rootRect = paRoot.getBoundingClientRect()
    const zoom = rootRect.width > 0 && paRoot.offsetWidth > 0 ? rootRect.width / paRoot.offsetWidth : 1
    const b = basketEl.getBoundingClientRect()
    if (b.width <= 0 || b.height <= 0) return
    for (const { el } of collectedEls.values()) {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      el.style.clipPath = boxInset(r, b, zoom)
    }
  }

  /**
   * The scale a caught item is actually drawn at.
   *
   * It is INSIDE the box now, so it cannot be wider than the box — the authored "Caught
   * Scales" number is a starting point, capped here to whatever fits. Measured on the
   * width the item really occupies, which for a rotated one is its rotated bounding box,
   * because that is the part that hangs over the sides. Everything is in physical px, the
   * units the caught item is laid out in.
   *
   * This is only the SIZE half of staying inside the box: an authored X offset can push a
   * perfectly-fitting item out sideways, so the caught-items layer is clipped to the box's
   * width as well (see clipCaught).
   */
  const fitCaughtScale = (scale: number, wPx: number, hPx: number, angleDeg: number, currentScale: number): number => {
    const boxWPx = basketW() * currentScale
    if (!(boxWPx > 0) || !(wPx > 0)) return scale
    const rad = (angleDeg * Math.PI) / 180
    const spanPx = Math.abs(wPx * Math.cos(rad)) + Math.abs(hPx * Math.sin(rad))
    if (!(spanPx > 0)) return scale
    return spanPx * scale > boxWPx ? boxWPx / spanPx : scale
  }

  /**
   * Clip the caught-items layer to the box's own width.
   *
   * The layer is the full size of the box, so `inset(… 0 … 0)` cuts exactly at its left
   * and right edges. The top and bottom insets are NEGATIVE, which pushes those edges of
   * the clip out of the way: items are meant to stand proud of the box's top rim — a
   * negative "Caught Ys" is how you get a shoe poking out — and only sideways overflow is
   * unwanted. `overflow-x: hidden` cannot express that: CSS promotes the other axis to
   * `auto` as soon as one is hidden, which would clip the top and add a scrollport.
   */
  const clipCaught = (el: HTMLElement): void => {
    el.style.clipPath = 'inset(-100% 0px -100% 0px)'
  }

  /**
   * Soften the falling items where they pass behind an assigned element.
   *
   * One patch per element the author gave the 'soften' role, laid over that element's box
   * INSIDE dropsContainer and carrying a backdrop filter. A backdrop filter reworks
   * whatever is painted behind it, and `isolation: isolate` on dropsContainer keeps that
   * "behind" to the falling items alone — the backdrop art and everything else in the
   * scene sit outside this stacking context and come through untouched. `blur()` softens
   * the copy passing through and `opacity()` thins it, so the element's own art reads
   * cleanly over the traffic behind it.
   *
   * Which elements get this is an assignment rather than a rule about types: only the
   * author knows which of their art needs the help. An element with a picture is also
   * MASKED with it, so the effect follows the art instead of hazing a rectangle around it;
   * one without (a text block, a plain box) takes the whole rect, which is what it draws.
   *
   * The placed ITEMS come in without being assigned. The row is the board — each entry
   * dimmed until one of its copies is caught, then lit — and it is read constantly while
   * copies of those same items rain past behind it. Needing it wired up by hand would be a
   * step that is right every time, so the game takes it.
   *
   * Only elements ABOVE the drops do anything — softening behind something the drops
   * already pass under would change nothing visible. Where backdrop-filter is unsupported
   * the patch is an empty, transparent, non-interactive div: the effect is skipped and
   * nothing else changes.
   */
  const syncSoften = (): void => {
    const keep = new Map<HTMLElement, HTMLElement>()
    if (paRoot && dropsContainer && (softenBlurPx > 0 || softenOpacity < 1)) {
      dropsContainer.style.isolation = 'isolate'
      const dropsZ = Number(dropsContainer.style.zIndex)
      for (const el of new Set([...itemEls.map((i) => i.el), ...softenEls])) {
        const z = Number(getComputedStyle(el).zIndex)
        if (Number.isFinite(z) && Number.isFinite(dropsZ) && z <= dropsZ) continue
        keep.set(el, softenPatches.find((p) => p.el === el)?.patch ?? makeSoftenPatch(el))
      }
    }
    for (const { el, patch } of softenPatches) if (keep.get(el) !== patch) patch.remove()
    softenPatches = [...keep].map(([el, patch]) => ({ el, patch }))
    if (!softenPatches.length && dropsContainer) dropsContainer.style.isolation = ''
  }

  const makeSoftenPatch = (el: HTMLElement): HTMLElement => {
    const patch = document.createElement('div')
    patch.dataset.id = `catch_soften_${el.dataset.id ?? ''}`
    patch.style.position = 'absolute'
    patch.style.pointerEvents = 'none'
    // Above every drop whatever order they were spawned in: a backdrop filter only sees
    // what is painted BEHIND it, and drops keep arriving after this patch was appended.
    patch.style.zIndex = '1'
    const filter = [softenBlurPx > 0 ? `blur(${softenBlurPx}px)` : '', softenOpacity < 1 ? `opacity(${softenOpacity})` : ''].filter(Boolean).join(' ')
    patch.style.backdropFilter = filter
    patch.style.setProperty('-webkit-backdrop-filter', filter)
    // Follow the art when there is art to follow. Mirror how the element draws its picture
    // so the mask lands on the same pixels.
    const src = artSrcOf(el)
    if (src) {
      const img = el.querySelector('img')
      const fit = img ? getComputedStyle(img).objectFit : 'contain'
      const size = fit === 'cover' ? 'cover' : fit === 'fill' ? '100% 100%' : 'contain'
      for (const prop of ['mask-image', '-webkit-mask-image']) patch.style.setProperty(prop, `url("${src}")`)
      for (const prop of ['mask-size', '-webkit-mask-size']) patch.style.setProperty(prop, size)
      for (const prop of ['mask-repeat', '-webkit-mask-repeat']) patch.style.setProperty(prop, 'no-repeat')
      for (const prop of ['mask-position', '-webkit-mask-position']) patch.style.setProperty(prop, 'center')
    }
    dropsContainer.appendChild(patch)
    return patch
  }

  /** Place the patches outside the frame loop — on mount and on every layout pass — so
   * they are already over their elements before the first frame runs. */
  const placeSoften = (): void => {
    if (!paRoot || !softenPatches.length) return
    const r = paRoot.getBoundingClientRect()
    layoutSoften(r, r.width > 0 && paRoot.offsetWidth > 0 ? r.width / paRoot.offsetWidth : 1)
  }

  /** Park each patch over its element, in dropsContainer's own px. Elements move — with
   * the viewport, and with whatever entrance or loop they are running — so this rides the
   * frame loop rather than being set once. */
  const layoutSoften = (paRootRect: DOMRect, zoom: number): void => {
    for (const { el, patch } of softenPatches) {
      const r = el.getBoundingClientRect()
      patch.style.left = `${(r.left - paRootRect.left) / zoom}px`
      patch.style.top = `${(r.top - paRootRect.top) / zoom}px`
      patch.style.width = `${r.width / zoom}px`
      patch.style.height = `${r.height / zoom}px`
    }
  }

  /**
   * Re-measure the placed box.
   *
   * The sideways drag rides on the CSS `translate` PROPERTY, which composes before the
   * positional `transform` layoutRec owns — so it has to be lifted for the measurement
   * or the box's resting place would drift by however far it has been dragged. Its
   * resting centre is sampled once, in logical units, which do not change with the
   * viewport; the pixel geometry is re-read on every layout pass, which does.
   */
  const measureBasket = (): void => {
    if (!basketEl || !paRoot) return
    const held = basketEl.style.translate
    basketEl.style.translate = ''
    const rootRect = paRoot.getBoundingClientRect()
    const zoom = rootRect.width > 0 && paRoot.offsetWidth > 0 ? rootRect.width / paRoot.offsetWidth : 1
    const br = basketEl.getBoundingClientRect()
    basketEl.style.translate = held
    if (br.width <= 0 || br.height <= 0) return
    basketWPx = br.width / zoom
    basketHPx = br.height / zoom
    basketTopPx = (br.top - rootRect.top) / zoom
    // The box's resting centre, in the DESIGN space every other coordinate here speaks:
    // 540 is the middle of the 1080-wide column, whatever the viewport is doing around it.
    // The drops, the hit test and the clamp all read basketX that way.
    //
    // It used to be measured from pa-root's LEFT EDGE instead. In portrait the two agree
    // exactly — the stage is width-driven, so the column and the viewport are the same
    // width — and the mistake was invisible. In landscape the scale is height-driven, the
    // column is letterboxed inside a much wider stage, and the two diverge by half that
    // difference: the box jumped to the left and the catch line moved with it.
    //
    // `br` was taken with the slide lifted, so this is always where the LAYOUT has just put
    // the box — which is the point of re-reading it on every pass. A resize or a rotation
    // re-lays the element out, and a home captured once would leave the slide measured from
    // a place the box no longer sits: it would jump, and a big enough error would take it
    // off screen entirely. What is preserved across the change is how far the PLAYER has
    // dragged it from home, so the box stays where they left it and simply rescales.
    const home = 540 + ((br.left + br.width / 2 - rootRect.left) / zoom - paRoot.offsetWidth / 2) / (s() || 1)
    const dragged = basketHomeSet ? basketX - basketHomeX : 0
    basketHomeSet = true
    basketHomeX = home
    const halfW = basketWPx / (s() || 1) / 2
    basketX = Math.max(halfW, Math.min(1080 - halfW, home + dragged))
  }

  /** Slide the box to wherever the finger has taken it — sideways only. The `translate`
   * property, not `transform`: layoutRec rewrites the element's transform on every
   * layout pass, and translate composes with it instead of fighting it. */
  const moveBasketEl = (currentScale: number): void => {
    if (!basketEl) return
    const slide = `${(basketX - basketHomeX) * currentScale}px`
    basketEl.style.translate = slide
    // The front layer is part of the box, so it takes the same slide — placed over the
    // box on the canvas, it stays over it however far the finger drags. So does everything
    // the box has collected: those products are in it, and they travel with it.
    if (boxFrontEl) boxFrontEl.style.translate = slide
    for (const { el } of collectedEls.values()) el.style.translate = slide
  }

  /** Where a stamped check mark sits: over the centre of its item, plus the authored
   * offset. Re-run on every layout pass, since the row moves with the screen. */
  const placeCheck = (item: ItemEl): void => {
    const el = item.check
    if (!el || !checkEl || !paRoot) return
    const rootRect = paRoot.getBoundingClientRect()
    // The editor canvas draws pa-root at a zoom; the item rect is in screen px and the
    // stamp is positioned in pa-root's own px, so one has to be converted to the other.
    const zoom = rootRect.width > 0 && paRoot.offsetWidth > 0 ? rootRect.width / paRoot.offsetWidth : 1
    const ir = item.el.getBoundingClientRect()
    const currentScale = s()
    const w = checkEl.offsetWidth * checkScale
    const h = checkEl.offsetHeight * checkScale
    const cx = (ir.left + ir.width / 2 - rootRect.left) / zoom + checkOffsetX * currentScale
    const cy = (ir.top + ir.height / 2 - rootRect.top) / zoom + checkOffsetY * currentScale
    el.style.width = `${w}px`
    el.style.height = `${h}px`
    el.style.left = `${cx - w / 2}px`
    el.style.top = `${cy - h / 2}px`
  }

  const layoutChecks = (): void => {
    for (const item of itemEls) if (item.check) placeCheck(item)
  }

  /**
   * Layer the falling items — and with them the box and its front.
   *
   * The rule is flat: the drops go BEHIND every placed element, in front of the backdrop
   * and the box and nothing else. The box, because the items have to fall in front of the
   * thing catching them; the backdrop, because under it they are not visible at all, which
   * is the whole reason it is an exception.
   *
   * WHAT COUNTS AS THE BACKDROP: a `background` element when the scene has one, and
   * otherwise the lowest-layered element there is. Plenty of scenes never use the
   * background type — the backdrop is just a full-bleed image sitting at the bottom of the
   * stack — and treating that as ordinary content would push the drops down behind it,
   * where nothing can be seen.
   *
   * The box, the drops and the front are one rig and are placed as one, just above the
   * backdrop and below all content:
   *
   *   backdrop  <  box  <  drops  <  box front  <  every other element
   *
   * A box authored ABOVE the content is lowered to join them. That has to happen — the
   * drops cannot be both in front of a box on layer 20 and behind a title on layer 4 — and
   * of the two, the author's flat rule wins. Its authored layer is restored on destroy.
   *
   * Three of those bands rarely fit in the integers the author left, so the rig is ordered
   * physically instead: the box is moved to just before dropsContainer, dropsContainer is
   * already the last thing appended to the scene, and the front is moved after it. Equal
   * layers then resolve in exactly that order. Elements at `auto` (no layer of their own)
   * are skipped — they stack in DOM order, all of them before the rig.
   *
   * Read off what is actually on screen rather than fixed at a number, so it holds for
   * whatever z-indexes the author used, and re-applied on relayout because an inspector
   * edit can move an element's layer under a live preview.
   */
  const applyDropsZ = (): void => {
    if (!paRoot || !dropsContainer) return
    // No placed box means the game builds its own two-part basket rig (backBasket z:30,
    // frontBasket z:32) out of uploaded images. Those are not scene elements and their
    // layers are fixed, so the drops keep the one slot between them — that sandwich IS
    // the falling-into-the-basket look, and dropping them to the back of the scene would
    // put them behind the basket's own back art.
    if (!basketEl) {
      dropsContainer.style.zIndex = '31'
      return
    }
    const layerOf = (el: HTMLElement): number => Number(getComputedStyle(el).zIndex)
    // Everything that is not part of the rig: the scene the drops have to stay behind.
    const scene = Array.from(paRoot.querySelectorAll<HTMLElement>('.pa-el'))
      .filter((el) => el !== basketEl && el !== boxFrontEl)
      .map((el) => ({ el, z: layerOf(el) }))
      .filter((e) => Number.isFinite(e.z))

    const tagged = scene.filter((e) => e.el.classList.contains('pa-el--background'))
    const backdrop = tagged.length
      ? Math.max(...tagged.map((e) => e.z))
      : scene.length
        ? Math.min(...scene.map((e) => e.z))
        : 0
    const content = scene.filter((e) => !e.el.classList.contains('pa-el--background') && e.z > backdrop)
    const z = content.length ? Math.max(backdrop, Math.min(...content.map((e) => e.z)) - 1) : backdrop
    dropsContainer.style.zIndex = String(z)

    // Bring the box down onto the rig's layer if it was authored above it, and put it
    // immediately before the drops so it paints under them and over the backdrop.
    if (layerOf(basketEl) > z) {
      basketEl.style.zIndex = String(z)
      if (basketEl.nextElementSibling !== dropsContainer) paRoot.insertBefore(basketEl, dropsContainer)
    }
    // What the box has collected, and its front, ride the drops: same layer, ordered after
    // them in the DOM, so the products stand in front of the falling traffic and the front
    // wall paints over both — and all of it still sits under anything the author put above
    // the box. Among themselves the products keep the author's own layering, which is what
    // makes a stack of them read as a pile.
    const collected = [...collectedEls.values()]
      .map(({ el, restZ }) => ({ el, z: Number(restZ) }))
      .sort((a, b) => (Number.isFinite(a.z) ? a.z : 0) - (Number.isFinite(b.z) ? b.z : 0))
      .map((c) => c.el)
    const tail = [...collected, ...(boxFrontEl ? [boxFrontEl] : [])]
    for (const el of tail) el.style.zIndex = String(z)
    // Only re-order when it is actually wrong: moving a node restarts any CSS animation on
    // it, and this runs on every layout pass.
    const kids = paRoot.children
    const inPlace = tail.every((el, i) => kids[kids.length - tail.length + i] === el)
    if (!inPlace) for (const el of tail) paRoot.appendChild(el)
  }

  /** Copy the assigned check mark onto a caught item. The element itself never appears
   * in play — these stamps are what the player sees — so one placed mark serves every
   * item on the board, and each stamp stays for good once it lands. */
  const stampCheck = (item: ItemEl): void => {
    if (!checkEl || !paRoot || item.check) return
    const src = artSrcOf(checkEl)
    if (!src) return
    const el = document.createElement('div')
    el.dataset.id = `catch_check_${item.index}`
    el.style.position = 'absolute'
    el.style.pointerEvents = 'none'
    el.style.backgroundImage = `url("${src}")`
    el.style.backgroundSize = 'contain'
    el.style.backgroundPosition = 'center'
    el.style.backgroundRepeat = 'no-repeat'
    // Above its item, and above whatever the check mark was placed over on the canvas —
    // a mark that lands behind the shoe it is marking is not a mark.
    const checkZ = Number(getComputedStyle(checkEl).zIndex)
    const itemZ = Number(getComputedStyle(item.el).zIndex)
    el.style.zIndex = String(Math.max(Number.isFinite(checkZ) ? checkZ : 0, (Number.isFinite(itemZ) ? itemZ : 0) + 1))
    el.style.opacity = '0'
    if (checkFrom !== 1) el.style.scale = String(checkFrom)
    paRoot.appendChild(el)
    item.check = el
    placeCheck(item)
    // Flush the start values so the browser has something to animate FROM; without this
    // they collapse into one style recalc with the end values and nothing runs.
    void el.offsetWidth
    if (checkFadeMs > 0) el.style.transition = `opacity ${checkFadeMs}ms ease, scale ${checkFadeMs}ms cubic-bezier(.34,1.4,.5,1)`
    el.style.opacity = '1'
    el.style.scale = '1'
  }

  /** Tick item `idx` off the row: full opacity, and the check mark stamped on top. */
  const markItemCaught = (idx: number): void => {
    const item = itemEls[idx]
    if (!item || item.caught) return
    item.caught = true
    // A class, because layoutRec rewrites the element's inline opacity from its authored
    // value on every layout pass; the transition rides inline, where nothing else writes.
    item.el.style.transition = caughtFadeMs > 0 ? `opacity ${caughtFadeMs}ms ease` : ''
    item.el.classList.add(CAUGHT_CLASS)
    stampCheck(item)
  }

  const createDropElement = (drop: Drop) => {
    const currentScale = s()
    const el = document.createElement('div')
    el.style.position = 'absolute'
    el.style.width = `${drop.w * currentScale}px`
    el.style.height = `${drop.h * currentScale}px`
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

  /**
   * Which item to drop next.
   *
   * Uniformly at random, the end of a collect-one-of-each board drags: with four of five
   * collected the missing one comes up one throw in five, and the player spends the last
   * third of the game watching shoes they already have. So an item still missing is
   * weighted `uncaughtBias` times as heavily as one already collected — with four of
   * five in, at the default the missing one comes up half the time instead of a fifth.
   *
   * Weighted, not forced: collected items keep a weight of 1 rather than dropping to
   * zero, so the board stays unpredictable and never turns into a queue. `uncaughtBias`
   * of 1 is the old uniform draw, and a count-total board (where nothing is ever
   * "missing") is uniform either way.
   */
  const pickItemIdx = (): number => {
    const n = itemImages.length
    if (n <= 0) return 0
    if (!requireUnique || itemTypes <= 0 || uncaughtBias <= 1) return Math.floor(ctx.rng() * n)
    const weights: number[] = []
    let total = 0
    for (let i = 0; i < n; i++) {
      const w = uniqueItemSpots.has(String(i)) ? 1 : uncaughtBias
      weights.push(w)
      total += w
    }
    let r = ctx.rng() * total
    for (let i = 0; i < n; i++) {
      r -= weights[i]
      if (r < 0) return i
    }
    return n - 1
  }

  const spawn = () => {
    if (done || (!gameActive && !visibleFirstRender)) return
    
    // Pick an image (favouring the ones still missing) and the size that goes with it.
    const imgIdx = itemImages.length > 0 ? pickItemIdx() : 0
    const imgSrc = itemImages.length > 0 ? itemImages[imgIdx] : ''
    const { w, h } = fallSize(imgIdx)

    const minX = w / 2
    const maxX = 1080 - w / 2
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
    const drop: Drop = { id: Date.now() + Math.random(), x, y: -h, speed, angle, imgSrc, imgIdx, captured: false, w, h }
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
    // Grouped with the frame's other measurements, ahead of every write below: reading a
    // rect after a style write is what forces a second layout pass mid-frame.
    if (softenPatches.length) {
      const zoom = paRootRect.width > 0 && paRoot.offsetWidth > 0 ? paRootRect.width / paRoot.offsetWidth : 1
      layoutSoften(paRootRect, zoom)
    }

    // Where the box's bottom edge sits, in pa-root px. A placed box keeps the height it
    // was dropped at on the canvas; the built-in rig stands on the footer bar.
    const basketBottom = basketEl ? basketTopPx + basketHPx : footerTop - paRootRect.top

    // Hit detection line (the rim of the basket). The rig keeps its own: it catches about
    // 20% deep into the basket, which is what makes a shoe look like it drops in.
    const basketScreenY = basketEl
      ? basketTopPx + basketHPx * catchDepth
      : basketBottom - (frontBasketLogicalH * 0.8 * currentScale) - (frontBasketOffsetY * currentScale)

    // Counted per CATCH, not per frame: two items can cross the rim on the same frame
    // (they do routinely once the spawn interval is short), and scoring that as one
    // left the ledger of caught items ahead of the score — on a collect-one-of-each
    // board, permanently one short of the win.
    let caughtThisFrame = 0
    
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]
      if (d.captured) continue
      
      const prevY = d.y * currentScale
      
      d.y += d.speed * dt
      const newY = d.y * currentScale
      
      // Hit detection: item crossed the basket line this frame. A placed box that has
      // not been measured yet has no line to cross — catching against it would score
      // items off the top of the screen.
      // `d.y` is the copy's CENTRE, so a line drawn at the rim is only reached once half the
      // product is already inside it. Lifting the line by half the copy's height puts the
      // crossing on its BOTTOM EDGE instead: at the default depth of 0 it is caught the
      // instant it touches the box, with none of it past the rim. Per drop, because copies
      // fall at their own sizes.
      const catchLine = basketEl ? basketScreenY - (d.h * currentScale) / 2 : basketScreenY
      if (gameActive && (!basketEl || basketHPx > 0) && prevY < catchLine && newY >= catchLine) {
        // item screen X relative to pa-root center
        const item_screen_x = (d.x - 540) * currentScale
        const basket_screen_x = (basketX + (basketEl ? 0 : frontBasketOffsetX) - 540) * currentScale

        const hit = Math.abs(item_screen_x - basket_screen_x) < (basketW() / 2 + d.w * 0.3) * currentScale
        if (hit) {
          d.captured = true
          
          if (requireUnique && itemTypes > 0 && uniqueItemSpots.has(String(d.imgIdx))) {
            // Already collected. Acknowledge the catch and drop the falling copy.
            ctx.sfx.play('catch')
            const existingEl = uniqueItemSpots.get(String(d.imgIdx))!
            // A loose copy the box packed itself gets a nudge. A PLACED product does not:
            // scaling it up is what pushed it out past the box's rim, and it sits exactly
            // where the author put it — growing it, even for a moment, is the one thing it
            // must not do.
            if (!collectedEls.get(d.imgIdx + 1) || collectedEls.get(d.imgIdx + 1)!.el !== existingEl) {
              const originalTransform = existingEl.style.transform
              existingEl.style.transition = 'transform 0.15s ease-out'
              existingEl.style.transform = `${originalTransform} scale(1.3)`
              setTimeout(() => {
                existingEl.style.transform = originalTransform
                setTimeout(() => { existingEl.style.transition = '' }, 150)
              }, 150)
            }
            if (d.el && d.el.parentNode) d.el.parentNode.removeChild(d.el)
            continue
          }

          caughtThisFrame++
          
          // Attach caught item to basket
          if (d.el && caughtItemsContainer) {
            const physW = d.w * currentScale
            const cIdx = itemTypes > 0 ? d.imgIdx : caught
            const angle = caughtItemAngles.length > 0 ? (caughtItemAngles[cIdx % caughtItemAngles.length] ?? d.angle) : d.angle

            const place = collectedEls.get(d.imgIdx + 1)
            if (place) {
              // The author gave this product a place in the box: the falling copy turns into
              // it. Nothing is laid out — the element is already exactly where they put it,
              // at the size and angle they gave it, layered against its neighbours the way
              // they stacked them. The copy STAYS in the drops layer for its flight: that is
              // the space its position is expressed in, and moving it into the box first
              // would reinterpret every coordinate against the box's own origin.
              morphIntoPlace(d.el, place.el)
            } else {
              // No place assigned, so the product itself goes in the box — from here on it
              // is positioned in the box's own space.
              caughtItemsContainer.appendChild(d.el)
              d.el.style.width = physW + 'px'
              d.el.style.height = d.h * currentScale + 'px'
              d.el.style.opacity = '1'
              d.el.style.zIndex = `${caughtItemZIndex}`
              if (autoStack) {
                // The box arranges this one itself: it joins what is already in there and
                // the whole row is re-fitted around it.
                caughtInBox.push({ el: d.el, w: d.w, h: d.h, angle })
                stackCaught()
              } else {
                const defaultOffsetX = (item_screen_x - basket_screen_x) / currentScale
                const offsetX = caughtItemXs.length > 0 ? (caughtItemXs[cIdx % caughtItemXs.length] ?? defaultOffsetX) : defaultOffsetX
                const offsetY = caughtItemYs.length > 0 ? (caughtItemYs[cIdx % caughtItemYs.length] ?? (ctx.rng() * 20 - 10)) : (ctx.rng() * 20 - 10)
                const scale = caughtItemScales.length > 0 ? (caughtItemScales[cIdx % caughtItemScales.length] ?? 0.7) : 0.7
                d.el.style.left = `${(basketW() / 2) * currentScale + offsetX * currentScale - physW / 2}px`
                d.el.style.top = `${offsetY * currentScale}px`
                d.el.style.transform = `rotate(${angle}deg) scale(${fitCaughtScale(scale, physW, d.h * currentScale, angle, currentScale)})`
                d.el.style.transformOrigin = 'bottom center'
              }
            }

            if (requireUnique && itemTypes > 0) {
              // A second catch of the same product bounces whatever is standing for it —
              // its place in the box when it has one, else the copy that landed.
              uniqueItemSpots.set(String(d.imgIdx), place ? place.el : d.el)
              
              const pIdx = d.imgIdx
              const pConfig = popupConfigs.length > pIdx ? popupConfigs[pIdx] : null
              if ((pConfig?.trigger ?? 'unique') === 'unique') showCatchEffect(pIdx, currentScale, paRootRect)
            }

            const anyIdx = itemTypes > 0 ? d.imgIdx : caught
            const anyConfig = popupConfigs.length > anyIdx ? popupConfigs[anyIdx] : null
            if (anyConfig?.trigger === 'any') showCatchEffect(anyIdx, currentScale, paRootRect)

            // Tick this item off the row the author placed: it comes up to full opacity
            // and takes the check mark. Second and later catches of the same item are a
            // no-op, so a count-total board can't re-stamp one.
            markItemCaught(d.imgIdx)
          }
          continue
        }
      }
      
      // Update position (physical px relative to dropsContainer which is on pa-root)
      if (d.el && !d.captured) {
        const physW = d.w * currentScale
        const physH = d.h * currentScale
        const physX = paRootCenterX - paRootRect.left + (d.x - 540) * currentScale - physW / 2
        const physY = d.y * currentScale - physH / 2
        d.el.style.left = `${physX}px`
        d.el.style.top = `${physY}px`
        d.el.style.width = `${physW}px`
        d.el.style.height = `${physH}px`
      }
      
      // Cleanup offscreen (past bottom of logical screen)
      if (d.y > 1920 + d.h + 100) {
        if (d.el && d.el.parentNode) d.el.parentNode.removeChild(d.el)
        drops.splice(i, 1)
      }
    }

    if (caughtThisFrame > 0) {
      caught += caughtThisFrame
      // Two beats, because they are two different events for the player. 'catch' is ANY
      // catch — it fires for a duplicate too, from the branch above, so a thud can play
      // whenever something lands. 'correct' is a catch that COUNTS: a new item on a
      // collect-one-of-each board, every catch on a count-total one. Bind one, the other
      // or both. One sound per frame however many landed together, so a double catch is
      // a catch rather than a flam.
      ctx.sfx.play('catch')
      ctx.sfx.play('correct')
      updateScoreUI()
      if (caught >= need) {
        done = true
        stopSpawning()
        // Swallowed by the host on purpose: the win sound is timed centrally so it can
        // line up with the win ANIMATION, the same as every other template.
        ctx.sfx.play('gameWin')
        winCb?.()
        completeCb?.()
      }
    }
    moveBasketEl(currentScale)
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
      backBasket.style.top = `${basketBottom - backBasketPhysicalH - (backBasketOffsetY * currentScale)}px`
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
      // Measured against the STAGE, not the window: in landscape the design column is
      // letterboxed inside a wider viewport, so the window's middle is not the column's and
      // the box slid away from the finger.
      const rootRect = paRoot?.getBoundingClientRect()
      const zoom = rootRect && rootRect.width > 0 && paRoot && paRoot.offsetWidth > 0 ? rootRect.width / paRoot.offsetWidth : 1
      const fromCentre = rootRect && paRoot ? (e.clientX - rootRect.left) / zoom - paRoot.offsetWidth / 2 : e.clientX - window.innerWidth / 2
      const lx = 540 + fromCentre / currentScale
      // Keep the box on screen, whichever kind it is.
      const halfW = basketW() / 2
      basketX = Math.max(halfW, Math.min(1080 - halfW, lx))
      // Follow the finger on the same frame rather than waiting for the next tick: a
      // placed box is an ordinary element, and a frame of lag on it is visible.
      moveBasketEl(currentScale)
    }
    const end = () => {
      active = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    const startDrag = (e: PointerEvent) => {
      if (active) return // one press, one drag — the box is never grabbed twice over
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
    if (dragTarget === basketEl && paRoot) {
      // A PLACED box paints on the rig's layer, low in the scene, so it is not necessarily
      // the element under the finger: an interactive neighbour above it — the game's own
      // mount, a panel, anything the author left tappable — swallows a pointerdown aimed at
      // the box and the drag never starts. Hit testing on pa-root in the CAPTURE phase
      // decouples where the box PAINTS from where it is GRABBED: a press inside its box
      // starts the drag wherever it sits in the stack.
      //
      // Controls keep their taps. A press that landed on a CTA, button or choice is left
      // alone even where it overlaps the box, so an ad's click-out can never be eaten by
      // the game.
      if (rootDragDown && rootDragOn) rootDragOn.removeEventListener('pointerdown', rootDragDown, true)
      const onRootDown = (e: PointerEvent): void => {
        if (!basketEl) return
        const target = e.target as HTMLElement | null
        if (target?.closest?.('[data-type="cta"],[data-type="button"],[data-type="choice"]')) return
        const r = basketEl.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return
        startDrag(e)
      }
      paRoot.addEventListener('pointerdown', onRootDown, true)
      rootDragDown = onRootDown
      rootDragOn = paRoot
    } else {
      dragTarget.addEventListener('pointerdown', startDrag)
    }
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

  /**
   * A comma-separated list of numbers from a text param.
   *
   * Blank entries are dropped, which is the whole point: an EMPTY field has to come back as
   * an empty list. Splitting '' on ',' gives [''], and Number('') is 0, so every unset list
   * used to arrive as [0] — a length of one, which is what the `length > 0` checks read as
   * "the author typed something". Caught items took scale 0 and vanished the moment they
   * landed; item sizes came out 0; random angles lost their spread. All of them have a
   * fallback for the empty case that could never fire.
   */
  const parseNumList = (strValue: unknown): number[] =>
    String(strValue ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '')
      .map(Number)
      .filter((n) => !isNaN(n))

  return {
    mount(c, params) {
      gameParams = params
      ctx = c
      root = ctx.root

      itemTypes = Number(params.itemTypes ?? 3)
      requireUnique = params.requireUnique !== false
      uncaughtBias = Math.max(1, Math.min(20, Number(params.uncaughtBias ?? 4)))
      need = (requireUnique && itemTypes > 0) ? itemTypes : Number(params.catches ?? 5)
      itemFallScale = Math.max(0.05, Math.min(20, Number(params.itemFallScale ?? 2)))
      caughtFadeMs = Math.max(0, Math.min(3000, Number(params.caughtFadeMs ?? 260)))
      checkScale = Math.max(0.05, Math.min(10, Number(params.checkScale ?? 1)))
      checkOffsetX = Number(params.checkOffsetX ?? 0)
      checkOffsetY = Number(params.checkOffsetY ?? 0)
      checkFadeMs = Math.max(0, Math.min(3000, Number(params.checkFadeMs ?? 260)))
      checkFrom = Math.max(0, Math.min(3, Number(params.checkFrom ?? 0.5)))
      scoreMode = String(params.scoreMode ?? 'Increment')
      speedParam = Number(params.speed ?? 0.55)
      spawnMs = Number(params.spawnMs ?? 900)
      randomizeAngle = !!params.randomizeAngle
      randomAngleList = parseNumList(params.randomAngles)
      if (randomAngleList.length === 0) randomAngleList = [0, 45, -45, 90]
      visibleFirstRender = !!params.visibleFirstRender
      spawnOnMove = !!params.spawnOnMove
      basketLocked = params.basketLocked === 'Locked'
      // How far a falling copy must sink past the box's rim before it counts as caught, as
      // a share of the box's height. 0 — the default — catches it the moment it TOUCHES the
      // rim, so a product that turns into its place in the box never appears to pass through
      // the box on the way in.
      catchDepth = Math.max(0, Math.min(1, Number(params.catchDepth ?? 0)))
      placeMs = Math.max(0, Number(params.placeMs ?? 220) || 0)
      showCaughtItemsPreview = !!params.showCaughtItemsPreview

      const ids = Array.isArray(params.itemImages) ? (params.itemImages as string[]) : (params.itemImage ? [String(params.itemImage)] : [])
      itemImages = ids.map((id) => ctx.assets.src(id)).filter(Boolean)

      // Elements assigned on the canvas WIN over the image slots: once there is a row of
      // placed items, that row is the board — how many item types there are, what falls,
      // and how many catches it takes to win all follow from it, so the count can't
      // drift out of step with what the player can see.
      collectSceneItems()
      // A front with no box to ride is not a role, it is a leftover — usually the box slot
      // being cleared while the front stayed assigned. Hand it straight back rather than
      // holding a claim on it and silently keeping its pointer events off.
      if (boxFrontEl && !basketEl) {
        boxFrontEl.style.pointerEvents = boxFrontRestPointer
        delete boxFrontEl.dataset.catchClaimedBy
        boxFrontEl = null
      }
      if (itemEls.length > 0) {
        itemImages = itemEls.map((i) => i.src)
        itemTypes = itemEls.length
        if (requireUnique) need = itemEls.length
      }

      itemSizes = parseNumList(params.itemSizes)
      if (itemSizes.length === 0) itemSizes = [120]
      
      caughtItemXs = parseNumList(params.caughtItemXs)
      caughtItemYs = parseNumList(params.caughtItemYs)
      caughtItemAngles = parseNumList(params.caughtItemAngles)
      caughtItemScales = parseNumList(params.caughtItemScales)
      caughtItemZIndex = Number(params.caughtItemZIndex ?? 1)
      // 'Auto' is the box collecting products — it arranges what it holds itself. 'Manual'
      // is the older per-item offset lists, for a board placed by hand.
      autoStack = String(params.caughtStack ?? 'Auto') !== 'Manual'
      softenBlurPx = Math.max(0, Number(params.softenBlurPx ?? 6) || 0)
      softenOpacity = Math.min(1, Math.max(0, Number(params.softenOpacity ?? 0.4)))
      
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
      // Whatever the author left visible while positioning it, the check mark itself is
      // never on screen in play — what the player sees are the copies stamped on caught
      // items. The row of items, by contrast, is the board: it stays exactly as placed.
      checkEl?.classList.add(OFF_CLASS)
      // The places in the box start empty. Only play hides them: on the editor canvas the
      // game never starts, so they stay visible and placeable inside the box.
      for (const { el } of collectedEls.values()) el.classList.add(OFF_CLASS)
      
      paRoot = root.closest('.pa-root') as HTMLElement | null
      if (!paRoot) {
        paRoot = root.parentElement
      }

      // Create dropsContainer on pa-root so items span the full screen. Its layer is the
      // backdrop's (see applyDropsZ) — the falling items rain BEHIND everything placed.
      if (paRoot) {
        dropsContainer = document.createElement('div')
        dropsContainer.dataset.id = 'catch_drops'
        dropsContainer.style.position = 'absolute'
        dropsContainer.style.left = '0'
        dropsContainer.style.top = '0'
        dropsContainer.style.width = '100%'
        dropsContainer.style.height = '100%'
        dropsContainer.style.overflow = 'visible'
        dropsContainer.style.pointerEvents = 'none'
        paRoot.appendChild(dropsContainer)
        applyDropsZ()
        syncSoften() // whether an assigned element is above the drops depends on the layer just set
        placeSoften()
      }
      // Before the first frame, so the catch line is the box's real height and not the
      // top of the screen — relayout() may not have run yet.
      measureBasket()
      
      
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
      applyDropsZ() // an element's layer can change under a live editor preview
      if (autoStack) stackCaught() // the row's fit depends on the box's size on screen
      clipCollected() // and so does how far each placed product reaches past the rim
      syncSoften() // so can whether an assigned element still sits above the drops
      placeSoften()

      // A placed box replaces the whole internal rig: no basket div is built, the caught
      // items hang inside the element itself, and it is the element the finger drags.
      if (paRoot && basketEl) {
        measureBasket()
        if (!caughtItemsContainer) {
          caughtItemsContainer = document.createElement('div')
          caughtItemsContainer.style.position = 'absolute'
          caughtItemsContainer.style.left = '0'
          caughtItemsContainer.style.top = '0'
          caughtItemsContainer.style.width = '100%'
          caughtItemsContainer.style.height = '100%'
          caughtItemsContainer.style.pointerEvents = 'none'
          // Relative to the box's own art, which sits at z-index auto inside it: a
          // positive number stacks the caught items in FRONT of the picture, zero or
          // less tucks them BEHIND it, which is what puts a shoe inside an open box.
          caughtItemsContainer.style.zIndex = `${caughtItemZIndex}`
          clipCaught(caughtItemsContainer)
          basketEl.appendChild(caughtItemsContainer)
        }
        basketDragTarget = basketEl as HTMLDivElement
        attachDrag()
        moveBasketEl(s())
      }

      // Create baskets if needed
      if (paRoot && !frontBasket && !basketEl) {
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
        clipCaught(caughtItemsContainer)
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

      if (paRoot && (frontBasket || basketEl)) {
        const currentScale = s()
        // Compute vertical position now that elements are injected in the DOM.
        // A placed box stands where it was placed; the internal rig stands on the footer.
        const footerBar = paRoot.querySelector('[data-id="basket_bar"]') as HTMLElement | null
        const paRootRect = paRoot.getBoundingClientRect()
        const basketBottom = basketEl ? basketTopPx + basketHPx : (footerBar ? footerBar.getBoundingClientRect().top : paRootRect.bottom) - paRootRect.top

        if (frontBasket) {
          frontBasket.style.left = '50%'
          frontBasket.style.width = (frontBasketLogicalW * currentScale) + 'px'
          frontBasket.style.height = (frontBasketLogicalH * currentScale) + 'px'
          frontBasket.style.marginLeft = `-${(frontBasketLogicalW / 2) * currentScale}px`
          const fx = basketX + frontBasketOffsetX
          frontBasket.style.transform = `translateX(${(fx - 540) * currentScale}px)`
          const frontBasketPhysicalH = frontBasketLogicalH * currentScale
          frontBasket.style.top = `${basketBottom - frontBasketPhysicalH - (frontBasketOffsetY * currentScale)}px`
          frontBasket.style.bottom = ''
        }
        
        if (backBasket) {
          backBasket.style.left = '50%'
          backBasket.style.width = (backBasketLogicalW * currentScale) + 'px'
          backBasket.style.height = (backBasketLogicalH * currentScale) + 'px'
          backBasket.style.marginLeft = `-${(backBasketLogicalW / 2) * currentScale}px`
          const bx = basketLocked ? basketX + backBasketOffsetX : 540 + backBasketOffsetX
          backBasket.style.transform = `translateX(${(bx - 540) * currentScale}px)`
          const backBasketPhysicalH = backBasketLogicalH * currentScale
          backBasket.style.top = `${basketBottom - backBasketPhysicalH - (backBasketOffsetY * currentScale)}px`
          backBasket.style.bottom = ''
        }
        
        // Also render preview items if needed
        if (showCaughtItemsPreview && caughtItemsContainer && caughtItemsContainer.childElementCount <= 0) {
          const numItems = itemTypes > 0 ? itemTypes : Math.max(1, caughtItemXs.length)
          for (let i = 0; i < numItems; i++) {
            const el = document.createElement('div')
            el.style.position = 'absolute'
            const { w, h } = fallSize(i)
            const physW = w * currentScale
            el.style.width = physW + 'px'
            el.style.height = h * currentScale + 'px'
            
            const defaultOffsetX = 0
            const offsetX = caughtItemXs.length > 0 ? (caughtItemXs[i % caughtItemXs.length] ?? defaultOffsetX) : defaultOffsetX
            const offsetY = caughtItemYs.length > 0 ? (caughtItemYs[i % caughtItemYs.length] ?? -5) : -5
            const angle = caughtItemAngles.length > 0 ? (caughtItemAngles[i % caughtItemAngles.length] ?? 0) : 0
            const scale = caughtItemScales.length > 0 ? (caughtItemScales[i % caughtItemScales.length] ?? 0.7) : 0.7
            
            el.style.left = `${(frontBasketLogicalW / 2) * currentScale + offsetX * currentScale - physW / 2}px`
            el.style.top = `${offsetY * currentScale}px`
            // Same cap as a real catch, so the preview shows what will actually land.
            el.style.transform = `rotate(${angle}deg) scale(${fitCaughtScale(scale, physW, h * currentScale, angle, currentScale)})`
            el.style.transformOrigin = 'bottom center'
            el.style.opacity = '1'
            el.style.zIndex = `${caughtItemZIndex}`
            
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
      
      // The row moves with the screen, so the marks stamped on it move too.
      layoutChecks()

      // Update UI on layout (e.g. initial render)
      updateScoreUI()
    },
    getHint(): HintMove | null {
      const box = basketEl ?? frontBasket
      if (done || !drops.length || !box || !paRoot) return null
      // Get the lowest uncaptured drop
      const lowest = drops.reduce((a, b) => (!b.captured && b.y > a.y ? b : a))
      if (lowest.captured) return null
      
      const from: Pt = { x: 0, y: 0 }
      const r = box.getBoundingClientRect()
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
    onWin(cb) {
      winCb = cb
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
      softenPatches = [] // they are dropsContainer's children — removed with it above
      if (dragAttachedBasket && basketStartDrag) {
        dragAttachedBasket.removeEventListener('pointerdown', basketStartDrag)
        dragAttachedBasket = null
        basketStartDrag = null
      }
      if (rootDragDown && rootDragOn) {
        rootDragOn.removeEventListener('pointerdown', rootDragDown, true)
        rootDragDown = null
        rootDragOn = null
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
      for (const item of itemEls) {
        item.check?.remove()
        item.check = null
        item.caught = false
        item.el.classList.remove(CAUGHT_CLASS)
        item.el.style.transition = item.restTransition
        delete item.el.dataset.catchClaimedBy
      }
      itemEls = []
      if (basketEl) {
        // The box is an ordinary placed element: hand back everything play wrote on it
        // and it is exactly where the author left it.
        caughtItemsContainer?.remove()
        basketEl.style.translate = ''
        basketEl.style.pointerEvents = basketRestPointer
        basketEl.style.zIndex = basketRestZ // applyDropsZ may have lowered it onto the rig
        basketEl.style.touchAction = ''
        delete basketEl.dataset.catchClaimedBy
        basketEl = null
        basketHomeSet = false
      }
      caughtInBox = [] // the collected products live inside the box; it takes them with it
      for (const { el, restZ, restClip } of collectedEls.values()) {
        // Put each place in the box back as it was found: shown, unslid, unclipped, on its
        // own layer.
        el.classList.remove(OFF_CLASS)
        el.style.translate = ''
        el.style.zIndex = restZ
        el.style.clipPath = restClip
        delete el.dataset.catchClaimedBy
      }
      collectedEls.clear()
      for (const el of softenEls) delete el.dataset.catchClaimedBy
      softenEls = []
      if (boxFrontEl) {
        // Same deal for the front layer — including the layer it was authored with, since
        // applyDropsZ overwrote it. Its place in the DOM is not restored: paint order among
        // absolutely-positioned elements is decided by z-index, which it has back.
        boxFrontEl.style.translate = ''
        boxFrontEl.style.zIndex = boxFrontRestZ
        boxFrontEl.style.pointerEvents = boxFrontRestPointer
        delete boxFrontEl.dataset.catchClaimedBy
        boxFrontEl = null
      }
      caughtItemsContainer = null
      if (checkEl) {
        // Put the canvas back as it was found: a check the author had shown stays shown,
        // one they had hidden stays hidden.
        if (checkCanvasShown) checkEl.classList.remove(OFF_CLASS)
        else checkEl.classList.add(OFF_CLASS)
        delete checkEl.dataset.catchClaimedBy
        checkEl = null
      }
      uniqueItemSpots.clear()
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
    { key: 'uncaughtBias', label: 'Favour uncollected items (1 = pure random)', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'itemSizes', label: 'Item Sizes (comma separated px)', type: 'text' },
    { key: 'itemFallScale', label: 'Falling size vs placed size', type: 'number', min: 0.05, max: 20, step: 0.1 },
    { key: 'caughtFadeMs', label: 'Caught item fades to full over (ms)', type: 'number', min: 0, max: 3000, step: 20 },
    { key: 'checkScale', label: 'Check mark scale', type: 'number', min: 0.05, max: 10, step: 0.05 },
    { key: 'checkOffsetX', label: 'Check mark offset X (px)', type: 'number', min: -2000, max: 2000, step: 5 },
    { key: 'checkOffsetY', label: 'Check mark offset Y (px)', type: 'number', min: -2000, max: 2000, step: 5 },
    { key: 'checkFadeMs', label: 'Check mark appears over (ms)', type: 'number', min: 0, max: 3000, step: 20 },
    { key: 'checkFrom', label: 'Check mark grows from (1 = no growth)', type: 'number', min: 0, max: 3, step: 0.05 },
    { key: 'frontBasketWidth', label: 'Front Basket Width (px)', type: 'number', min: 50, max: 3000, step: 10 },
    { key: 'frontBasketHeight', label: 'Front Basket Height (px)', type: 'number', min: 50, max: 3000, step: 10 },
    { key: 'frontBasketOffsetX', label: 'Front Basket Horizontal Offset (px)', type: 'number', min: -2000, max: 2000, step: 10 },
    { key: 'frontBasketOffsetY', label: 'Front Basket Vertical Offset (px)', type: 'number', min: -2000, max: 2000, step: 10 },
    { key: 'backBasketWidth', label: 'Back Basket Width (px)', type: 'number', min: 50, max: 3000, step: 10 },
    { key: 'backBasketHeight', label: 'Back Basket Height (px)', type: 'number', min: 50, max: 3000, step: 10 },
    { key: 'backBasketOffsetX', label: 'Back Basket Horizontal Offset (px)', type: 'number', min: -2000, max: 2000, step: 10 },
    { key: 'backBasketOffsetY', label: 'Back Basket Vertical Offset (px)', type: 'number', min: -2000, max: 2000, step: 10 },
    { key: 'basketLocked', label: 'Basket Lock', type: 'select', options: ['Locked', 'Unlocked'] },
    { key: 'catchDepth', label: 'Catch depth (0 = on touch)', type: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'placeMs', label: 'Turn into place (ms)', type: 'number', min: 0, max: 2000, step: 20 },
    { key: 'caughtStack', label: 'Caught items', type: 'select', options: ['Auto', 'Manual'] },
    { key: 'caughtItemXs', label: 'Caught Xs (px, comma sep)', type: 'text' },
    { key: 'caughtItemYs', label: 'Caught Ys (px, comma sep)', type: 'text' },
    { key: 'caughtItemAngles', label: 'Caught Angles (deg, comma sep)', type: 'text' },
    { key: 'caughtItemScales', label: 'Caught Scales (comma sep, e.g. 0.7)', type: 'text' },
    { key: 'caughtItemZIndex', label: 'Caught Z-Index (relative to basket)', type: 'number', min: -10, max: 10, step: 1 },
    { key: 'softenBlurPx', label: 'Soften: blur (px)', type: 'number', min: 0, max: 40, step: 1 },
    { key: 'softenOpacity', label: 'Soften: opacity (0-1)', type: 'number', min: 0, max: 1, step: 0.05 },
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
    // An item still missing is thrown this many times as often as one already collected,
    // so the last of a set doesn't take a dozen throws to turn up. 1 = a flat draw.
    uncaughtBias: 4,
    itemSizes: '120',
    // Placed-element items (assigned on the canvas, see CatchRoleConfig). A falling copy
    // is this many times the size of the row entry it comes from; the entry itself sits
    // at whatever opacity the author gave it and goes to full opacity when caught.
    itemFallScale: 2, caughtFadeMs: 260,
    // The one check mark, stamped over the centre of each item as it is caught.
    checkScale: 1, checkOffsetX: 0, checkOffsetY: 0, checkFadeMs: 260, checkFrom: 0.5,
    
    frontBasketWidth: 300, frontBasketHeight: 150, frontBasketOffsetX: 0, frontBasketOffsetY: 0,
    backBasketWidth: 300, backBasketHeight: 150, backBasketOffsetX: 0, backBasketOffsetY: 0,
    frontBasketImage: '', backBasketImage: '',
    basketLocked: 'Locked', catchDepth: 0, placeMs: 220,
    caughtStack: 'Auto', caughtItemXs: '', caughtItemYs: '', caughtItemAngles: '', caughtItemScales: '', caughtItemZIndex: 1, softenBlurPx: 6, softenOpacity: 0.4,
    showCaughtItemsPreview: false, popupConfigs: '[]'
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
