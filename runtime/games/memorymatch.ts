// Memory Match (MIP-02): a flip-to-match grid where matched pairs DISAPPEAR
// (leaving an empty space) and their symbol lights up in a tracker row. Flip two
// cards — a same-symbol pair vanishes and lights its symbol; a mismatch flips
// back. The grid (rows × cols) is independent of the pair count: every symbol is
// guaranteed on the board at least twice, and any leftover cells are filled with
// random symbols — those extras can still match each other. The goal is lighting
// every SYMBOL, not clearing every card: all symbols lit = win, even with cards
// left on the board.
//
// Every cell shows a shared cover (image or colour) face-down and, when flipped,
// a shared face background under the cell's pair image. Cover/face/pair images
// are assumed the SAME size, so both faces render at exactly the cell rect
// (background-size 100% 100%, same radius) — nothing leaks during the 3D flip.
// Pair images land on random cells (two cells per image, deterministic rng).
//
// The tracker row shows one symbol per pair: a custom "unlit" image (or the pair
// image, dimmed) swapped for a custom "lit" image (or the pair image, full) when
// matched. Its edge (top/bottom), size, spacing and x/y offset are all params.
//
// SFX: 'flip' plays on every player flip; 'correct'/'wrong' on resolve.
//
// Hints: getHint() is pair-aware — it points at one card of a fresh pair, and
// once the player flips a card it points at that card's partner. The same logic
// drives the editable hand-guide's 'match' mode: the game keeps data-mm-hint="1"
// on the card the player should tap next, and the stage's hand follows it.

import type { GameContext, GameModule, GameTemplate, HintMove } from './types'
import { mulberry32, num, str } from './types'

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#f97316', '#06b6d4']

interface Card {
  el: HTMLDivElement
  inner: HTMLDivElement
  back: HTMLDivElement
  front: HTMLDivElement
  pairId: number
  matched: boolean
  flipped: boolean
  gone: boolean
}

interface TrackerItem {
  el: HTMLDivElement
  unlit: HTMLDivElement
  lit: HTMLDivElement
}

// Progress saved across page reloads — some containers (AppLovin) reload the
// creative on orientation change. Restored only on the FIRST mount after a page
// load (in-page remounts, e.g. a preview restart, deal a fresh random board) and
// only while fresh (TTL), so a new impression never inherits an old game.
interface SavedGame {
  seed: number
  lit: number[] // pair ids whose symbol is lit
  removed: number[] // dealt-order indices of cards already off the board
  t: number
}
const SAVE_TTL_MS = 30_000

export function createMemoryMatch(): GameModule {
  let ctx: GameContext
  let pairCount = 5
  let cols = 4
  let rows = 3
  let gapPx = 8
  let radius = 12
  let aspect = 0.75
  let flipMs = 400
  let winDelayMs = 1000
  let trackerPos: 'top' | 'bottom' | 'off' = 'top'
  let trackerSize = 34
  let trackerGap = 18
  let trackerShiftX = 0
  let trackerShiftY = 0
  let coverOpaque = true // false = transparent cover fill (no colour/shadow leaking past transparent art)
  let faceOpaque = true
  const cards: Card[] = []
  const tracker: TrackerItem[] = []
  let trackerRow: HTMLDivElement | null = null
  let first: Card | null = null
  let busy = false
  let started = false
  let done = false
  const lit: boolean[] = [] // per-pair: symbol already lit in the tracker
  let litCount = 0
  let seed = 0 // board shuffle seed — random per game, persisted so reloads rebuild the same board

  const saveKey = (): string => 'pa:mm:' + (ctx.elementId ?? '0')
  const saveState = (): void => {
    try {
      const s: SavedGame = {
        seed,
        lit: lit.flatMap((v, i) => (v ? [i] : [])),
        removed: cards.flatMap((c, i) => (c.matched || c.gone ? [i] : [])),
        t: Date.now(),
      }
      window.sessionStorage.setItem(saveKey(), JSON.stringify(s))
    } catch { /* storage unavailable — progress just won't survive a reload */ }
  }
  const loadState = (): SavedGame | null => {
    try {
      const raw = window.sessionStorage.getItem(saveKey())
      if (!raw) return null
      const s = JSON.parse(raw) as SavedGame
      if (typeof s.seed !== 'number' || !Array.isArray(s.lit) || !Array.isArray(s.removed)) return null
      if (Date.now() - (s.t ?? 0) > SAVE_TTL_MS) return null
      return s
    } catch {
      return null
    }
  }
  const clearState = (): void => {
    try {
      window.sessionStorage.removeItem(saveKey())
    } catch { /* */ }
  }
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null
  const timers: number[] = []
  const later = (fn: () => void, ms: number): void => {
    timers.push(window.setTimeout(fn, ms))
  }

  // --- hint target (shared by getHint() and the handguide 'match' mode) -------
  // If a card is flipped, a face-down card of the same symbol; otherwise the
  // first face-down card that still has a face-down partner — preferring pairs
  // whose symbol is not lit yet (extras of a lit symbol don't progress the game).
  // The chosen card carries data-mm-hint="1".
  const hintCard = (): Card | null => {
    if (done) return null
    if (first) {
      const partner = cards.find((c) => c !== first && !c.matched && !c.flipped && c.pairId === first!.pairId)
      if (partner) return partner
    }
    const pick = (needUnlit: boolean): Card | null => {
      for (const c of cards) {
        if (c.matched || c.flipped) continue
        if (needUnlit && lit[c.pairId]) continue
        const partner = cards.find((o) => o !== c && o.pairId === c.pairId && !o.matched && !o.flipped)
        if (partner) return c
      }
      return null
    }
    return pick(true) ?? pick(false)
  }
  const markHint = (): void => {
    const target = hintCard()
    for (const c of cards) {
      if (c === target) c.el.dataset.mmHint = '1'
      else delete c.el.dataset.mmHint
    }
  }

  // --- layout ------------------------------------------------------------------
  // All px params (gap, radius, tracker size/spacing/offsets, shadows) are DESIGN
  // px and get multiplied by the stage scale every layout, so the whole minigame
  // scales as one unit with the rest of the ad at any viewport size or zoom —
  // proportions to everything else never change (AppLovin resizes/zooms freely).
  const layout = (): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const k = ctx.scale?.() ?? 1 // screen px per design px
    const rows = Math.ceil(cards.length / cols)
    const gap = Math.max(0, gapPx * k)
    const symSz = trackerSize * k

    // Reserve a band for the tracker row (its own size + breathing room).
    const band = trackerPos === 'off' ? 0 : symSz + Math.max(8 * k, symSz * 0.35)
    const gridTop = trackerPos === 'top' ? band : 0
    const gridH = h - band

    // Cards keep the cover's aspect (w/h) so same-size art never distorts/leaks.
    const cw = Math.min((w - gap * (cols - 1)) / cols, ((gridH - gap * (rows - 1)) / rows) * aspect)
    const ch = cw / aspect
    const x0 = (w - (cw * cols + gap * (cols - 1))) / 2
    const y0 = gridTop + (gridH - (ch * rows + gap * (rows - 1))) / 2
    const lastRowCount = cards.length - (rows - 1) * cols
    const rad = radius * k + 'px'
    const shadow = `0 ${4 * k}px ${10 * k}px rgba(0,0,0,.3)`
    cards.forEach((card, i) => {
      const r = Math.floor(i / cols)
      const inRow = r === rows - 1 ? lastRowCount : cols
      const c = i % cols
      const rowX0 = x0 + ((cols - inRow) * (cw + gap)) / 2 // center a partial last row
      card.el.style.width = cw + 'px'
      card.el.style.height = ch + 'px'
      card.el.style.left = rowX0 + c * (cw + gap) + 'px'
      card.el.style.top = y0 + r * (ch + gap) + 'px'
      for (const face of [card.back, card.front]) {
        face.style.borderRadius = rad
        face.style.fontSize = cw * 0.4 + 'px'
      }
      // Shadows only under opaque fills — on a transparent fill the rectangular
      // shadow would outline the cell and leak past the actual card art.
      card.back.style.boxShadow = coverOpaque ? shadow : 'none'
      card.front.style.boxShadow = faceOpaque ? shadow : 'none'
    })

    if (trackerRow) {
      trackerRow.style.gap = trackerGap * k + 'px'
      trackerRow.style.left = '50%'
      trackerRow.style.top = trackerPos === 'bottom' ? '' : trackerShiftY * k + (band - symSz) / 2 + 'px'
      trackerRow.style.bottom = trackerPos === 'bottom' ? -trackerShiftY * k + (band - symSz) / 2 + 'px' : ''
      trackerRow.style.transform = `translateX(calc(-50% + ${trackerShiftX * k}px))`
      for (const t of tracker) {
        t.el.style.width = symSz + 'px'
        t.el.style.height = symSz + 'px'
      }
    }
  }

  // --- play --------------------------------------------------------------------
  // The 3D flip machinery (preserve-3d + rotateY layers) is armed ONLY for the
  // animation, then dropped: a persistently 3D-transformed element rasterizes
  // once at a fixed resolution, so when the host page zooms or scales the ad
  // (AppLovin preview, landscape letterboxing) the cached texture is stretched
  // and the card turns BLURRY. At rest a card is plain 2D DOM (one face visible,
  // no transforms), which the browser re-renders crisp at any scale.
  const setFlipped = (c: Card, on: boolean): void => {
    c.flipped = on
    // arm: build the two-sided 3D state matching the current visual. Perspective
    // and backface-visibility are applied HERE (not statically) — WebKit promotes
    // backface-hidden elements to composited layers even at rest, which is
    // exactly the fixed-resolution rasterization that blurs on zoom.
    c.el.style.perspective = (c.el.clientWidth || 100) * 5.5 + 'px'
    c.inner.style.transition = 'none'
    c.inner.style.transformStyle = 'preserve-3d'
    for (const f of [c.back, c.front]) {
      f.style.setProperty('backface-visibility', 'hidden')
      f.style.setProperty('-webkit-backface-visibility', 'hidden')
      f.style.visibility = ''
    }
    c.front.style.transform = 'rotateY(180deg)'
    c.inner.style.transform = on ? 'rotateY(0deg)' : 'rotateY(180deg)'
    void c.inner.offsetWidth // commit the start state before animating
    c.inner.style.transition = `transform ${flipMs}ms cubic-bezier(.4,.2,.2,1)`
    c.inner.style.transform = on ? 'rotateY(180deg)' : 'rotateY(0deg)'
    // settle: back to flat DOM with only the landing face visible and every
    // compositing hint removed, so the card re-renders crisp at any scale
    later(() => {
      if (c.flipped !== on || c.gone) return // superseded by a newer flip / vanish
      c.el.style.perspective = ''
      c.inner.style.transition = 'none'
      c.inner.style.transformStyle = ''
      c.inner.style.transform = 'none'
      c.front.style.transform = 'none'
      for (const f of [c.back, c.front]) {
        f.style.removeProperty('backface-visibility')
        f.style.removeProperty('-webkit-backface-visibility')
      }
      c.back.style.visibility = on ? 'hidden' : ''
      c.front.style.visibility = on ? '' : 'hidden'
    }, flipMs)
  }

  const lightSymbol = (pid: number): void => {
    const t = tracker[pid]
    if (!t) return
    t.unlit.style.opacity = '0'
    t.lit.style.opacity = '1'
    // Bouncy pop: leap up with an overshoot, squash back, rebound, settle.
    // WAAPI so it composites over the row layout without reflow; the simple
    // scale-pop transition stays as the fallback where animate() is missing.
    if (typeof t.el.animate === 'function') {
      t.el.animate(
        [
          { transform: 'scale(1) translateY(0)' },
          { transform: 'scale(1.55) translateY(-22%)', offset: 0.28 },
          { transform: 'scale(0.84) translateY(4%)', offset: 0.55 },
          { transform: 'scale(1.18) translateY(-8%)', offset: 0.76 },
          { transform: 'scale(0.96) translateY(0)', offset: 0.9 },
          { transform: 'scale(1) translateY(0)' },
        ],
        { duration: 700, easing: 'ease-in-out' },
      )
    } else {
      t.el.style.transform = 'scale(1.35)'
      later(() => (t.el.style.transform = 'scale(1)'), 220)
    }
  }

  // Mismatched cards shake side-to-side (a quick decaying "no" wiggle) while
  // still face-up, before flipping back. Skipped where animate() is missing.
  const shake = (c: Card): void => {
    if (typeof c.el.animate !== 'function') return
    c.el.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-6%) rotate(-1.5deg)' },
        { transform: 'translateX(5%) rotate(1.2deg)' },
        { transform: 'translateX(-3%) rotate(-0.8deg)' },
        { transform: 'translateX(2%) rotate(0.5deg)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 320, easing: 'ease-in-out' },
    )
  }

  // Matched cards leave with a pop: swell up with a small lift, then spiral
  // away — shrinking, twisting apart (each card of the pair spins the opposite
  // way) and drifting upward while fading. Falls back to a simple shrink+fade
  // where animate() is unavailable.
  const vanish = (c: Card, dir: 1 | -1): void => {
    c.gone = true
    c.el.style.pointerEvents = 'none'
    if (typeof c.el.animate === 'function') {
      const a = c.el.animate(
        [
          { transform: 'scale(1) rotate(0deg) translateY(0)', opacity: 1 },
          { transform: 'scale(1.15) rotate(0deg) translateY(-6%)', opacity: 1, offset: 0.3 },
          { transform: `scale(0.55) rotate(${10 * dir}deg) translateY(-14%)`, opacity: 0.7, offset: 0.65 },
          { transform: `scale(0.05) rotate(${26 * dir}deg) translateY(-42%)`, opacity: 0 },
        ],
        { duration: 520, easing: 'cubic-bezier(.5,-.15,.55,1)', fill: 'forwards' },
      )
      a.onfinish = () => {
        // Land the final state inline and CANCEL the animation: a forwards-filled
        // animation keeps a live compositor layer on the card forever.
        c.el.style.opacity = '0'
        c.el.style.visibility = 'hidden'
        a.cancel()
      }
    } else {
      c.el.style.transition = 'transform .3s ease, opacity .3s ease'
      c.el.style.transform = 'scale(.6)'
      c.el.style.opacity = '0'
    }
  }

  const resolvePair = (a: Card, b: Card): void => {
    if (a.pairId === b.pairId) {
      a.matched = b.matched = true
      first = null
      busy = false
      markHint()
      // The pair-found sound, symbol light-up and vanish all wait for the second
      // card's flip to settle — the reward lands when the face is visible, not on
      // the click. (Safe from a timer: the sfx manager primes audio on the first
      // gesture, so delayed plays aren't blocked on iOS.)
      later(() => {
        ctx.sfx.play('correct')
        if (!lit[a.pairId]) {
          lit[a.pairId] = true
          litCount++
          lightSymbol(a.pairId)
        }
        saveState() // progress survives a rotation-forced page reload
        // Let the player see the pair, then the cards disappear (empty space stays).
        later(() => {
          vanish(a, 1)
          vanish(b, -1)
        }, 250)
        if (litCount >= pairCount && !done) {
          done = true
          clearState() // a finished game never restores — the next view deals fresh
          markHint()
          winCb?.()
          // Once the last pair has left, the unpicked leftovers follow it off
          // the board, one after another.
          later(() => {
            let n = 0
            for (const c of cards) {
              if (c.gone || c.matched) continue
              const i = n++
              later(() => vanish(c, i % 2 === 0 ? 1 : -1), i * 70)
            }
          }, 800)
          later(() => completeCb?.(), winDelayMs)
        }
      }, flipMs)
    } else {
      // The mismatch sound also waits for the flip; the pair shakes its head
      // side-to-side, then turns back.
      later(() => {
        ctx.sfx.play('wrong')
        shake(a)
        shake(b)
        later(() => {
          setFlipped(a, false)
          setFlipped(b, false)
          first = null
          busy = false
          markHint()
        }, 350)
      }, flipMs)
    }
  }

  const tap = (c: Card): void => {
    if (done || busy || c.matched || c.flipped || c.gone) return
    ctx.sfx.play('flip')
    setFlipped(c, true)
    if (!first) {
      first = c
      markHint()
    } else {
      busy = true
      resolvePair(first, c)
    }
  }

  return {
    mount(c, params) {
      ctx = c
      pairCount = Math.max(2, Math.min(10, num(params.pairs, 5)))
      cols = Math.max(2, Math.min(6, num(params.cols, 4)))
      rows = Math.max(2, Math.min(8, num(params.rows, 3)))
      gapPx = num(params.gap, 8)
      radius = num(params.radius, 12)
      aspect = Math.max(0.3, Math.min(3, num(params.cardAspect, 0.75)))
      flipMs = Math.max(120, num(params.flipMs, 400))
      winDelayMs = Math.max(0, num(params.winDelayMs, 1000)) // 0 = advance the instant the last symbol lights
      const tp = str(params.tracker, 'top')
      trackerPos = tp === 'bottom' || tp === 'off' ? tp : 'top'
      trackerSize = Math.max(10, num(params.trackerSize, 34))
      trackerGap = Math.max(0, num(params.trackerGap, 18))
      trackerShiftX = num(params.trackerShiftX, 0)
      trackerShiftY = num(params.trackerShiftY, 0)
      const coverImg = ctx.assets.src(params.cover as string)
      const coverColor = str(params.coverColor, '#f26430')
      const faceImg = ctx.assets.src(params.face as string)
      const faceColor = str(params.faceColor, '#ffffff')
      coverOpaque = str(params.coverFill, 'color') !== 'transparent'
      faceOpaque = str(params.faceFill, 'color') !== 'transparent'
      const images = Array.isArray(params.images) ? (params.images as string[]) : []
      const unlitImgs = Array.isArray(params.symbolsUnlit) ? (params.symbolsUnlit as string[]) : []
      const litImgs = Array.isArray(params.symbolsLit) ? (params.symbolsLit as string[]) : []
      ctx.root.style.touchAction = 'none'

      // A page reload (AppLovin rotates = reloads) restores the saved game; an
      // in-page remount (preview restart, replaying the scene) deals fresh. The
      // window marker below dies with the page, telling the two apart.
      const W = window as unknown as Record<string, unknown>
      const onceKey = '__paMmSeen:' + (ctx.elementId ?? '0')
      const firstMountThisPage = !W[onceKey]
      W[onceKey] = true
      let restored = firstMountThisPage ? loadState() : null
      if (restored && restored.lit.length >= pairCount) restored = null // finished game → fresh board

      // Board = rows × cols, independent of the pair count: every symbol lands on
      // the board twice (guaranteed findable), and leftover cells get random
      // symbols — extras can still pair up. Never smaller than one pair of each.
      // The shuffle runs on a per-game RANDOM seed (not the host's fixed rng, which
      // dealt the identical board every load); the seed is saved so a reload mid-
      // game rebuilds the exact same layout before progress is re-applied.
      seed = restored?.seed ?? Math.floor(Math.random() * 0xffffffff)
      const rng = mulberry32(seed)
      const cardCount = Math.max(cols * rows, pairCount * 2)
      const order: number[] = []
      for (let i = 0; i < pairCount; i++) order.push(i, i)
      while (order.length < cardCount) order.push(Math.floor(rng() * pairCount))
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }

      // Both faces paint edge-to-edge (100% 100%, same radius) so equal-size
      // cover/face/pair art can never leak past the cell during the flip. Radius,
      // shadow, font and perspective are applied per-layout (they scale with the
      // stage). A 'transparent' fill leaves only the art itself — no colour block
      // or shadow bleeding past transparent regions of the image.
      // No backface-visibility here — setFlipped() adds/removes it around the
      // animation; statically it forces a composited layer (blurry on zoom).
      const faceCss =
        'position:absolute;inset:0;background-repeat:no-repeat;background-size:100% 100%;' +
        'display:flex;align-items:center;justify-content:center;overflow:hidden;'
      for (const pid of order) {
        const el = document.createElement('div')
        el.dataset.mmCard = '1'
        el.style.cssText = 'position:absolute;box-sizing:border-box;cursor:pointer;'
        const inner = document.createElement('div')
        inner.style.cssText = 'position:relative;width:100%;height:100%;' // flat at rest; setFlipped arms the 3D flip
        const back = document.createElement('div') // cover — shown face-down
        back.style.cssText = faceCss + 'color:rgba(255,255,255,.9);font-weight:800;'
        if (coverOpaque) back.style.background = coverColor
        if (coverImg) {
          back.style.backgroundImage = `url("${coverImg}")`
          back.style.backgroundSize = '100% 100%'
        } else if (coverOpaque) back.textContent = '?'
        const front = document.createElement('div') // face background + pair image — hidden until flipped
        front.style.cssText = faceCss + 'visibility:hidden;font-weight:800;color:#fff;'
        if (faceOpaque) front.style.background = faceColor
        if (faceImg) {
          front.style.backgroundImage = `url("${faceImg}")`
          front.style.backgroundSize = '100% 100%'
        }
        const img = images[pid] ? ctx.assets.src(images[pid]) : ''
        if (img) {
          const pic = document.createElement('div')
          // no own radius — the front face clips it (overflow:hidden + radius)
          pic.style.cssText = `position:absolute;inset:0;background:url("${img}") no-repeat;background-size:100% 100%;`
          front.appendChild(pic)
        } else {
          front.style.background = PALETTE[pid % PALETTE.length]
          front.textContent = String(pid + 1)
        }
        inner.appendChild(back)
        inner.appendChild(front)
        el.appendChild(inner)
        ctx.root.appendChild(el)
        cards.push({ el, inner, back, front, pairId: pid, matched: false, flipped: false, gone: false })
      }

      // Tracker row — one symbol per pair, unlit until its pair is matched.
      if (trackerPos !== 'off') {
        trackerRow = document.createElement('div')
        trackerRow.style.cssText = 'position:absolute;display:flex;align-items:center;pointer-events:none;'
        for (let pid = 0; pid < pairCount; pid++) {
          const cell = document.createElement('div')
          cell.style.cssText = 'position:relative;flex:0 0 auto;transition:transform .22s ease;'
          const pairImg = images[pid] ? ctx.assets.src(images[pid]) : ''
          const mk = (src: string, fallback: string): HTMLDivElement => {
            const d = document.createElement('div')
            d.style.cssText = 'position:absolute;inset:0;transition:opacity .25s ease;background-repeat:no-repeat;background-size:contain;background-position:center;'
            if (src) d.style.backgroundImage = `url("${src}")`
            else d.style.cssText += fallback
            return d
          }
          const unlitSrc = unlitImgs[pid] ? ctx.assets.src(unlitImgs[pid]) : pairImg
          const litSrc = litImgs[pid] ? ctx.assets.src(litImgs[pid]) : pairImg
          const unlit = mk(unlitSrc, `border-radius:50%;background:${PALETTE[pid % PALETTE.length]};`)
          // No custom unlit image: dim the pair image (or dot) until it lights up.
          if (!unlitImgs[pid]) unlit.style.filter = 'grayscale(1) brightness(.55)'
          if (!unlitImgs[pid]) unlit.style.opacity = '.45'
          const lit = mk(litSrc, `border-radius:50%;background:${PALETTE[pid % PALETTE.length]};box-shadow:0 0 12px ${PALETTE[pid % PALETTE.length]};`)
          lit.style.opacity = '0'
          cell.appendChild(unlit)
          cell.appendChild(lit)
          trackerRow.appendChild(cell)
          tracker.push({ el: cell, unlit, lit })
        }
        ctx.root.appendChild(trackerRow)
      }

      // Re-apply saved progress: lit symbols light silently, removed cards are
      // simply absent (no animations — the player already saw them).
      if (restored) {
        for (const pid of restored.lit) {
          if (pid >= 0 && pid < pairCount && !lit[pid]) {
            lit[pid] = true
            litCount++
            const t = tracker[pid]
            if (t) {
              t.unlit.style.opacity = '0'
              t.lit.style.opacity = '1'
            }
          }
        }
        for (const i of restored.removed) {
          const c = cards[i]
          if (!c) continue
          c.matched = true
          c.gone = true
          c.el.style.pointerEvents = 'none'
          c.el.style.opacity = '0'
          c.el.style.visibility = 'hidden'
        }
      }
      saveState() // persist the (possibly fresh) seed so a rotate right away rebuilds this board

      layout()
      markHint()
    },
    start() {
      if (started) return
      started = true
      cards.forEach((c) => c.el.addEventListener('pointerdown', () => tap(c)))
    },
    relayout: layout,
    getHint(): HintMove | null {
      const target = hintCard()
      if (!target) return null
      // Aim at the lower part of the card, not the center — the cover art's
      // text/logo sits mid-card and the hand must not hide it.
      const r = target.el.getBoundingClientRect()
      const p = { x: r.left + r.width / 2, y: r.top + r.height * 0.85 }
      return { from: p, to: p, kind: 'tap' }
    },
    onComplete(cb) {
      completeCb = cb
    },
    onWin(cb) {
      winCb = cb
    },
    destroy() {
      timers.forEach((t) => window.clearTimeout(t))
      timers.length = 0
      ctx.root.innerHTML = ''
      cards.length = 0
      tracker.length = 0
      trackerRow = null
      first = null
    },
  }
}

export const MEMORYMATCH_TEMPLATE: GameTemplate = {
  id: 'memorymatch',
  label: 'Memory match (pairs vanish + symbol tracker)',
  paramFields: [
    { key: 'pairs', label: 'Pairs (symbols to find)', type: 'number', min: 2, max: 10, step: 1 },
    { key: 'cols', label: 'Grid columns', type: 'number', min: 2, max: 6, step: 1 },
    { key: 'rows', label: 'Grid rows', type: 'number', min: 2, max: 8, step: 1 },
    { key: 'gap', label: 'Card gap (px)', type: 'number', min: 0, max: 40, step: 1 },
    { key: 'cardAspect', label: 'Card aspect (w/h)', type: 'number', min: 0.3, max: 3, step: 0.05 },
    { key: 'radius', label: 'Corner radius', type: 'number', min: 0, max: 40, step: 1 },
    { key: 'flipMs', label: 'Flip speed (ms)', type: 'number', min: 150, max: 1200, step: 50 },
    { key: 'winDelayMs', label: 'Win delay after last pair (ms)', type: 'number', min: 0, max: 5000, step: 100 },
    { key: 'coverFill', label: 'Cover fill', type: 'select', options: ['color', 'transparent'] },
    { key: 'coverColor', label: 'Cover colour (no image)', type: 'color' },
    { key: 'faceFill', label: 'Face fill', type: 'select', options: ['color', 'transparent'] },
    { key: 'faceColor', label: 'Face colour (no image)', type: 'color' },
    { key: 'tracker', label: 'Symbol tracker', type: 'select', options: ['top', 'bottom', 'off'] },
    { key: 'trackerSize', label: 'Symbol size (px)', type: 'number', min: 10, max: 120, step: 1 },
    { key: 'trackerGap', label: 'Symbol spacing (px)', type: 'number', min: 0, max: 80, step: 1 },
    { key: 'trackerShiftX', label: 'Symbols shift X (px)', type: 'number', min: -400, max: 400, step: 1 },
    { key: 'trackerShiftY', label: 'Symbols shift Y (px)', type: 'number', min: -400, max: 400, step: 1 },
  ],
  assetSlots: [
    { key: 'images', label: 'Pair image', list: true, countParam: 'pairs' },
    { key: 'cover', label: 'Card cover (shared)' },
    { key: 'face', label: 'Flipped card background (shared)' },
    { key: 'symbolsUnlit', label: 'Tracker symbol — unlit', list: true, countParam: 'pairs' },
    { key: 'symbolsLit', label: 'Tracker symbol — lit', list: true, countParam: 'pairs' },
    { key: 'handImage', label: 'Hint hand image (optional)' },
  ],
  defaultParams: {
    pairs: 5,
    cols: 4,
    rows: 3,
    gap: 8,
    cardAspect: 0.75,
    radius: 12,
    flipMs: 400,
    winDelayMs: 1000,
    coverFill: 'color',
    coverColor: '#f26430',
    faceFill: 'color',
    faceColor: '#ffffff',
    tracker: 'top',
    trackerSize: 34,
    trackerGap: 18,
    trackerShiftX: 0,
    trackerShiftY: 0,
    images: [],
    cover: '',
    face: '',
    handImage: '',
    symbolsUnlit: [],
    symbolsLit: [],
  },
  // Pair-aware hand: follows the game's suggested card (one of a pair, then its
  // partner once the player flips the first).
  defaultHandguide: { mode: 'match', nodes: [{ x: 0.5, y: 0.45 }], periodMs: 900 },
  create: createMemoryMatch,
}
