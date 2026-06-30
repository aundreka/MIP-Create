// Mystery-box grid — two-tap reveal (wins) / one-tap in-place reveal (losses).
//
// Win flow:  tap box → flies to center → tap again → lid off + product rises → game-complete
// Lose flow: tap box → lid flies off in place → product rises in cell → stays open, others still clickable
//
// All pixel calculations use offsetWidth/offsetHeight/offsetLeft/offsetTop (design-space)
// instead of getBoundingClientRect (screen-space) so the mechanic is zoom/scale invariant.

import type { SceneElement, UnboxPiece, UnboxingConfig } from '../scene'
import type { RuntimeCtx } from '../types'

// ── helpers ─────────────────────────────────────────────────────────────────

function mkImg(src: string): HTMLImageElement {
  const img = document.createElement('img')
  img.alt = ''
  img.draggable = false
  img.src = src
  img.style.cssText = 'width:100%;height:auto;display:block;pointer-events:none;'
  return img
}

function applyPieceCss(div: HTMLElement, piece: UnboxPiece, zIndex: number): void {
  const x = piece.x ?? 50, y = piece.y ?? 50, w = piece.w ?? 100, r = piece.rotation ?? 0
  div.style.cssText = [
    'position:absolute;',
    `left:${x - w / 2}%;`,
    `top:${y}%;`,
    `width:${w}%;`,
    `transform:translateY(-50%) rotate(${r}deg);`,
    `z-index:${zIndex};`,
    'pointer-events:none;',
  ].join('')
}

function buildClosed(container: HTMLElement, cfg: UnboxingConfig, ctx: RuntimeCtx): void {
  const layers: Array<{ piece: UnboxPiece | undefined; z: number; role: string }> = [
    { piece: cfg.back, z: 1, role: 'back' },
    { piece: cfg.front, z: 3, role: 'front' },
    { piece: cfg.top, z: 4, role: 'lid' },
  ]
  for (const { piece, z, role } of layers) {
    if (!piece?.assetId) continue
    const div = document.createElement('div')
    div.dataset.piece = role
    applyPieceCss(div, piece, z)
    div.appendChild(mkImg(ctx.src(piece.assetId) ?? ''))
    container.appendChild(div)
  }
}

function animateLid(lidEl: HTMLElement, piece: UnboxPiece, parentW: number, parentH: number): void {
  const x = piece.x ?? 50, y = piece.y ?? 20
  const endX = piece.endX ?? 60, endY = piece.endY ?? -35
  const dx = (endX - x) / 100 * parentW
  const dy = (endY - y) / 100 * parentH
  const r0 = piece.rotation ?? 0
  const r1 = piece.endRotation ?? -35
  const s1 = piece.endScale ?? 1
  const o1 = piece.endOpacity ?? 0
  const dur = piece.durationMs ?? 700
  const delay = piece.delayMs ?? 0
  lidEl.animate(
    [
      { transform: `translateY(-50%) rotate(${r0}deg)`, opacity: '1' },
      { transform: `translateY(-50%) translate(${dx}px,${dy}px) rotate(${r1}deg) scale(${s1})`, opacity: String(o1) },
    ],
    { duration: dur, delay, fill: 'forwards', easing: 'cubic-bezier(0.4,0,0.2,1)' },
  )
}

// Animate a product image rising inside `container` (works for both cell and flyEl).
// Returns the Animation so callers can await `.finished`.
function animateProduct(
  container: HTMLElement,
  productSrc: string,
  parentW: number,
  parentH: number,
  px: number, py: number, pw: number,
  spx: number, spy: number,
  dur: number, delay: number,
): Animation | null {
  if (!productSrc) return null
  const productEl = document.createElement('div')
  productEl.dataset.piece = 'product'
  productEl.style.cssText = [
    'position:absolute;',
    `left:${px - pw / 2}%;`,
    `top:${py}%;`,
    `width:${pw}%;`,
    'z-index:2;pointer-events:none;',
  ].join('')
  productEl.appendChild(mkImg(productSrc))
  container.appendChild(productEl)

  const dxProd = (spx - px) / 100 * parentW
  const dyProd = (spy - py) / 100 * parentH
  return productEl.animate(
    [
      { transform: `translateY(-50%) translate(${dxProd}px,${dyProd}px)`, opacity: '0' },
      { transform: 'translateY(-50%)', opacity: '1' },
    ],
    { duration: dur, delay, fill: 'both', easing: 'cubic-bezier(0.34,1.56,0.64,1)' },
  )
}

// ── main ─────────────────────────────────────────────────────────────────────

export function createUnboxingContent(el: SceneElement, ctx: RuntimeCtx): HTMLDivElement {
  const cfg = el.unboxing ?? {}
  const cols = Math.max(1, cfg.cols ?? 2)
  const rows = Math.max(1, cfg.rows ?? 2)
  const count = cols * rows
  const cfgColGap = cfg.colGap ?? 24
  const cfgRowGap = cfg.rowGap ?? 24
  const selectMs = cfg.selectMs ?? 450
  const tapHintMs = cfg.tapHintMs ?? 300

  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:relative;width:100%;height:100%;'
  let selectedCellIdx = -1

  // ── container background ─────────────────────────────────────────────────
  let bgEl: HTMLImageElement | null = null
  if (cfg.bgAssetId) {
    bgEl = mkImg(ctx.src(cfg.bgAssetId) ?? '')
    bgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;'
    wrap.appendChild(bgEl)
  }

  const colGapPct = (el.w ?? 0) > 0 ? cfgColGap / el.w! * 100 : 0
  const rowGapPct = (el.h ?? 0) > 0 ? cfgRowGap / el.h! * 100 : 0

  if (bgEl) {
    const bgXPct = (el.w ?? 0) > 0 ? (cfg.bgX ?? 0) / el.w! * 100 : 0
    const bgYPct = (el.h ?? 0) > 0 ? (cfg.bgY ?? 0) / el.h! * 100 : 0
    bgEl.style.transform = `scale(${cfg.bgScale ?? 1}) translate(${bgXPct}%,${bgYPct}%)`
  }

  // ── grid cells ───────────────────────────────────────────────────────────
  const grid = document.createElement('div')
  grid.style.cssText = [
    'position:absolute;inset:0;z-index:1;',
    `display:grid;grid-template-columns:repeat(${cols},1fr);`,
    `grid-template-rows:repeat(${rows},1fr);`,
    `gap:${rowGapPct}% ${colGapPct}%;`,
    `padding:${colGapPct / 2}% ${colGapPct / 2}%;`,
  ].join('')

  const cells: HTMLDivElement[] = []
  for (let i = 0; i < count; i++) {
    const cell = document.createElement('div')
    cell.style.cssText = 'cursor:pointer;position:relative;overflow:visible;'
    buildClosed(cell, cfg, ctx)
    grid.appendChild(cell)
    cells.push(cell)
  }
  wrap.appendChild(grid)

  // ── flying box (win path only) ────────────────────────────────────────────
  const flyEl = document.createElement('div')
  flyEl.style.cssText = 'position:absolute;z-index:2;display:none;cursor:pointer;overflow:visible;'
  wrap.appendChild(flyEl)

  // ── state machine ────────────────────────────────────────────────────────
  type State = 'idle' | 'flying' | 'centered' | 'revealed'
  let state: State = 'idle'

  function reset(): void {
    state = 'idle'
    flyEl.style.display = 'none'
    flyEl.innerHTML = ''
    for (const c of cells) {
      for (const a of c.getAnimations()) a.cancel()
      c.style.opacity = '1'
      c.style.pointerEvents = 'auto'
    }
  }

  // Pre-determine all cell outcomes at mount time so the win distribution
  // matches winChance exactly and at least one win is guaranteed.
  const resolvedOutcomes: boolean[] = (() => {
    const hasLose = !!cfg.loseAssetId
    if (cfg.cells) return Array.from({ length: count }, (_, i) => cfg.cells![i] !== 'lose')
    if (!hasLose || !cfg.randomize) return Array(count).fill(true)
    const winCount = Math.max(1, Math.round(count * (cfg.winChance ?? 50) / 100))
    const outcomes = Array(count).fill(false)
    const indices = Array.from({ length: count }, (_, i) => i)
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]]
    }
    for (let i = 0; i < winCount; i++) outcomes[indices[i]] = true
    return outcomes
  })()

  function resolveWin(idx: number): boolean {
    return resolvedOutcomes[idx]
  }

  // ── lose path: reveal in place inside the grid cell ───────────────────────
  function revealLoseInPlace(idx: number): void {
    state = 'revealed'
    const cell = cells[idx]
    cell.style.pointerEvents = 'none'
    cell.style.cursor = 'default'

    // SFX fires immediately so lose feedback isn't confused with the next click
    for (const b of el.sfx ?? []) {
      if (!b.assetId) continue
      if (b.event === 'onReveal' || b.event === 'onLose') ctx.emit('sfx-asset', b.assetId, b.volume ?? 1)
    }
    ctx.emit('sfx', 'gameLose')

    const cellW = cell.offsetWidth
    const cellH = cell.offsetHeight

    const lidEl = cell.querySelector<HTMLElement>('[data-piece="lid"]')
    if (lidEl && cfg.top) animateLid(lidEl, cfg.top, cellW, cellH)

    const productSrc = ctx.src(cfg.loseAssetId) ?? ''
    const px  = cfg.loseProductX  ?? cfg.productX  ?? 50
    const py  = cfg.loseProductY  ?? cfg.productY  ?? 28
    const pw  = cfg.loseProductW  ?? cfg.productW  ?? 65
    const spx = cfg.loseProductStartX ?? cfg.productStartX ?? px
    const spy = cfg.loseProductStartY ?? cfg.productStartY ?? 120
    const anim = animateProduct(cell, productSrc, cellW, cellH,
      px, py, pw, spx, spy,
      cfg.productDurationMs ?? 900, cfg.productDelayMs ?? 160)

    const afterReveal = (): void => {
      state = 'idle'
    }

    if (anim) {
      anim.finished.then(afterReveal).catch(() => {})
    } else {
      const lidDur = (cfg.top?.durationMs ?? 700) + (cfg.top?.delayMs ?? 0)
      setTimeout(afterReveal, lidDur)
    }
  }

  // ── win path: fly to center, tap again to reveal ──────────────────────────
  function reveal(): void {
    if (state !== 'centered') return
    state = 'revealed'

    for (const b of el.sfx ?? []) {
      if (!b.assetId) continue
      if (b.event === 'onReveal' || b.event === 'onWin') ctx.emit('sfx-asset', b.assetId, b.volume ?? 1)
    }

    const parentW = flyEl.offsetWidth
    const parentH = flyEl.offsetHeight

    const lidEl = flyEl.querySelector<HTMLElement>('[data-piece="lid"]')
    if (lidEl && cfg.top) animateLid(lidEl, cfg.top, parentW, parentH)

    const productSrc = ctx.src(cfg.winAssetId) ?? ''
    const px  = cfg.productX  ?? 50
    const py  = cfg.productY  ?? 28
    const pw  = cfg.productW  ?? 65
    const spx = cfg.productStartX ?? px
    const spy = cfg.productStartY ?? 120
    const anim = animateProduct(flyEl, productSrc, parentW, parentH,
      px, py, pw, spx, spy,
      cfg.productDurationMs ?? 900, cfg.productDelayMs ?? 160)

    if (anim) {
      anim.finished.then(() => {
        ctx.emit('sfx', 'gameWin')
        ctx.emit('game-complete')
      }).catch(() => {})
    } else {
      const lidDur = (cfg.top?.durationMs ?? 700) + (cfg.top?.delayMs ?? 0)
      setTimeout(() => {
        ctx.emit('sfx', 'gameWin')
        ctx.emit('game-complete')
      }, lidDur)
    }

    if (cfg.revealSyncElementId && cfg.revealSyncAssetId) {
      const newSrc = ctx.src(cfg.revealSyncAssetId)
      if (newSrc) {
        const targetImg = document.querySelector<HTMLImageElement>(
          `[data-id="${cfg.revealSyncElementId}"] img`
        )
        if (targetImg) {
          targetImg.src = newSrc
          targetImg.style.width = '100%'
          targetImg.style.height = '100%'
          targetImg.style.objectFit = 'contain'
        }
      }
    }
  }

  function selectCell(idx: number): void {
    if (state !== 'idle') return

    const isWin = resolveWin(idx)
    selectedCellIdx = idx

    if (!isWin) {
      revealLoseInPlace(idx)
      return
    }

    // Win: fly selected box to center
    state = 'flying'

    const centerSize = cfg.centerSize ?? 65
    const ew = el.w ?? 1, eh = el.h ?? 1
    const tXpct = (100 - centerSize) / 2 + (cfg.centerX ?? 0) / ew * 100
    const tYpct = (100 - (ew / eh) * centerSize) / 2 + (cfg.centerY ?? 0) / eh * 100
    const tWpct = centerSize
    const tHpct = (ew / eh) * centerSize

    flyEl.style.left = `${tXpct}%`
    flyEl.style.top = `${tYpct}%`
    flyEl.style.width = `${tWpct}%`
    flyEl.style.height = `${tHpct}%`
    flyEl.style.display = 'block'
    flyEl.innerHTML = ''
    buildClosed(flyEl, cfg, ctx)

    const wrapW = wrap.offsetWidth
    const wrapH = wrap.offsetHeight
    const tW = tWpct / 100 * wrapW
    const tH = tHpct / 100 * wrapH
    const tX = tXpct / 100 * wrapW
    const tY = tYpct / 100 * wrapH

    const cell = cells[idx]
    const cellCx = cell.offsetLeft + cell.offsetWidth / 2
    const cellCy = cell.offsetTop + cell.offsetHeight / 2
    const flyCx = tX + tW / 2
    const flyCy = tY + tH / 2
    const startScale = Math.min(cell.offsetWidth / tW, cell.offsetHeight / tH)
    const dx = cellCx - flyCx
    const dy = cellCy - flyCy

    for (const c of cells) {
      c.style.pointerEvents = 'none'
      c.animate([{ opacity: '1' }, { opacity: '0' }], { duration: 250, fill: 'forwards' })
    }

    const flyAnim = flyEl.animate(
      [
        { transform: `translate(${dx}px,${dy}px) scale(${startScale})` },
        { transform: 'translate(0,0) scale(1)' },
      ],
      { duration: selectMs, fill: 'forwards', easing: 'cubic-bezier(0.4,0,0.2,1)' },
    )

    flyAnim.finished.then(() => {
      state = 'centered'
      setTimeout(() => {
        if (state === 'centered') flyEl.style.cursor = 'pointer'
      }, tapHintMs)
    }).catch(() => {})
  }

  // ── event wiring ─────────────────────────────────────────────────────────
  cells.forEach((c, i) => c.addEventListener('click', () => selectCell(i)))
  flyEl.addEventListener('click', () => {
    if (state === 'centered') reveal()
    else if (state === 'revealed') reset()
  })

  return wrap
}

export function applyUnboxingImages(_wrap: HTMLElement, _el: SceneElement, _ctx: RuntimeCtx): void {
  // Force-remount on any config change (stage.ts JSON comparison) handles refresh.
}
