// Thought whacker: every authored thought appears once inside a randomly chosen
// spawn zone. Tapping swaps it to one shared whack image. Clearing the whole
// wave or reaching the configurable duration wins the game.

import type { GameContext, GameModule, GameTemplate, HintMove, Pt } from './types'
import { num } from './types'
import { elementHintPoint } from '../hint'

interface SpawnZone {
  x: number
  y: number
  w: number
  h: number
}

type ThoughtState = 'pending' | 'active' | 'whacked' | 'gone'

interface ThoughtTarget {
  shell: HTMLDivElement
  bubble: HTMLDivElement
  dots: [HTMLDivElement, HTMLDivElement]
  index: number
  x: number
  y: number
  state: ThoughtState
  generation: number
  positioned: boolean
}

const DEFAULT_ZONE: SpawnZone = { x: 8, y: 8, w: 84, h: 62 }
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

function imageIds(value: unknown): string[] {
  return Array.isArray(value) ? value.map((id) => (typeof id === 'string' ? id : '')) : []
}

export function normalizeThoughtSpawnZones(value: unknown): SpawnZone[] {
  if (!Array.isArray(value)) return [DEFAULT_ZONE]
  const zones = value
    .map((raw): SpawnZone | null => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Partial<SpawnZone>
      const x = clamp(Number(r.x) || 0, 0, 100)
      const y = clamp(Number(r.y) || 0, 0, 100)
      const w = clamp(Number(r.w) || 0, 1, 100 - x)
      const h = clamp(Number(r.h) || 0, 1, 100 - y)
      return { x, y, w, h }
    })
    .filter((zone): zone is SpawnZone => !!zone)
  return zones.length ? zones : [DEFAULT_ZONE]
}

export function createThoughtWhack(): GameModule {
  let ctx: GameContext
  let thoughtCount = 3
  let roundMs = 5000
  let spawnStaggerMs = 90
  let whackedHoldMs = 180
  let fadeMs = 360
  let respawnMs = 1000
  let thoughtSizePct = 24
  let whackScale = 1
  let hintHandScale = 0.9
  let tailColor = '#f7f2e9'
  let tailLargePct = 18
  let tailSmallPct = 11
  let subjectX = 50
  let subjectY = 88
  let thoughtImages: string[] = []
  let whackImage = ''
  let zones: SpawnZone[] = [DEFAULT_ZONE]

  const targets: ThoughtTarget[] = []
  const timers = new Set<number>()
  let roundTimer = 0
  let started = false
  let clockStarted = false
  let done = false
  let wave = 0
  let completeCb: (() => void) | null = null
  let winCb: (() => void) | null = null

  const later = (fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
    return id
  }

  const clearTimers = (): void => {
    window.clearTimeout(roundTimer)
    roundTimer = 0
    for (const id of timers) window.clearTimeout(id)
    timers.clear()
  }

  const thoughtSize = (): number => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    return Math.max(30, Math.min(w, h) * (thoughtSizePct / 100))
  }

  const layoutTarget = (target: ThoughtTarget): void => {
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const size = thoughtSize()
    const left = clamp((target.x / 100) * w - size / 2, 0, Math.max(0, w - size))
    const top = clamp((target.y / 100) * h - size / 2, 0, Math.max(0, h - size))

    // The shell fills the game so its children can share one coordinate space;
    // pin its animation origin to this thought so the spawn pop happens in place.
    target.shell.style.transformOrigin = `${target.x}% ${target.y}%`

    target.bubble.style.width = `${size}px`
    target.bubble.style.height = `${size}px`
    target.bubble.style.left = `${left}px`
    target.bubble.style.top = `${top}px`
    target.bubble.style.fontSize = `${size * 0.62}px`

    const bx = left + size / 2
    const by = top + size / 2
    // The subject itself stays a normal scene element. This authored marker is
    // only its anchor point; both trailing circles always rotate toward it.
    const dx = (subjectX / 100) * w - bx
    const dy = (subjectY / 100) * h - by
    const distance = Math.hypot(dx, dy) || 1
    const ux = dx / distance
    const uy = dy / distance
    const dotSizes = [size * (tailLargePct / 100), size * (tailSmallPct / 100)]
    const distances = [size * 0.72, size * 1.02]
    target.dots.forEach((dot, i) => {
      const dotSize = dotSizes[i]
      dot.style.width = `${dotSize}px`
      dot.style.height = `${dotSize}px`
      dot.style.left = `${bx + ux * distances[i] - dotSize / 2}px`
      dot.style.top = `${by + uy * distances[i] - dotSize / 2}px`
      dot.style.background = tailColor
    })
  }

  const layout = (): void => targets.forEach(layoutTarget)

  const boundsAt = (point: Pt): { left: number; top: number; right: number; bottom: number } => {
    const size = thoughtSize()
    const w = ctx.root.clientWidth || 300
    const h = ctx.root.clientHeight || 400
    const left = clamp((point.x / 100) * w - size / 2, 0, Math.max(0, w - size))
    const top = clamp((point.y / 100) * h - size / 2, 0, Math.max(0, h - size))
    const bx = left + size / 2
    const by = top + size / 2
    const dx = (subjectX / 100) * w - bx
    const dy = (subjectY / 100) * h - by
    const distance = Math.hypot(dx, dy) || 1
    const ux = dx / distance
    const uy = dy / distance
    let minX = left
    let minY = top
    let maxX = left + size
    let maxY = top + size
    const dotSizes = [size * (tailLargePct / 100), size * (tailSmallPct / 100)]
    const dotDistances = [size * 0.72, size * 1.02]
    for (let i = 0; i < dotSizes.length; i++) {
      const r = dotSizes[i] / 2
      const cx = bx + ux * dotDistances[i]
      const cy = by + uy * dotDistances[i]
      minX = Math.min(minX, cx - r)
      minY = Math.min(minY, cy - r)
      maxX = Math.max(maxX, cx + r)
      maxY = Math.max(maxY, cy + r)
    }
    const pad = Math.max(4, size * 0.06)
    return { left: minX - pad, top: minY - pad, right: maxX + pad, bottom: maxY + pad }
  }

  const overlaps = (a: ReturnType<typeof boundsAt>, b: ReturnType<typeof boundsAt>): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

  const choosePoint = (placed: ThoughtTarget[]): Pt | null => {
    const occupied = placed.filter((target) => target.positioned).map((target) => boundsAt(target))
    const fits = (point: Pt): boolean => {
      const bounds = boundsAt(point)
      return occupied.every((other) => !overlaps(bounds, other))
    }
    for (let attempt = 0; attempt < 180; attempt++) {
      const zone = zones[Math.floor(ctx.rng() * zones.length)] ?? DEFAULT_ZONE
      const point = { x: zone.x + ctx.rng() * zone.w, y: zone.y + ctx.rng() * zone.h }
      if (fits(point)) return point
    }
    // A deterministic scan catches narrow zones that random sampling may miss.
    for (const zone of zones) {
      for (let row = 0; row <= 12; row++) {
        for (let col = 0; col <= 12; col++) {
          const point = { x: zone.x + (zone.w * col) / 12, y: zone.y + (zone.h * row) / 12 }
          if (fits(point)) return point
        }
      }
    }
    return null
  }

  const spawnWhenSpaceIsFree = (target: ThoughtTarget, waveId: number, delayMs: number): void => {
    const attempt = (): void => {
      if (done || wave !== waveId) return
      // Keep the old position reserved until its whack graphic has completely
      // faded. This also prevents this target from respawning on top of itself.
      if (target.positioned) {
        spawnWhenSpaceIsFree(target, waveId, 100)
        return
      }
      const blockers = targets.filter((candidate) => candidate !== target && candidate.positioned)
      const point = choosePoint(blockers)
      if (!point) {
        spawnWhenSpaceIsFree(target, waveId, 100)
        return
      }
      target.x = point.x
      target.y = point.y
      target.positioned = true
      spawn(target, true)
    }
    if (delayMs > 0) later(attempt, delayMs)
    else attempt()
  }

  const paintThought = (target: ThoughtTarget): void => {
    const src = ctx.assets.src(thoughtImages[target.index] ?? '')
    target.bubble.style.backgroundImage = src ? `url("${src}")` : ''
    target.bubble.textContent = src ? '' : '💭'
    target.bubble.style.transform = 'scale(1)'
    target.bubble.setAttribute('aria-label', `Whack thought ${target.index + 1}`)
  }

  const spawn = (target: ThoughtTarget, animate: boolean): void => {
    if (done) return
    target.generation++
    target.state = 'active'
    target.shell.dataset.twState = 'active'
    target.shell.style.opacity = '1'
    target.shell.style.transform = animate ? 'scale(.2)' : 'scale(1)'
    target.bubble.style.pointerEvents = started ? 'auto' : 'none'
    paintThought(target)
    layoutTarget(target)
    if (!animate) return
    const generation = target.generation
    later(() => {
      if (done || target.generation !== generation) return
      target.shell.style.transform = 'scale(1)'
      ctx.sfx.play('thoughtSpawn')
    }, 16)
  }

  const beginWave = (): void => {
    if (done) return
    const thisWave = ++wave
    const placed: ThoughtTarget[] = []
    targets.forEach((target, i) => {
      target.generation++
      target.state = 'pending'
      target.positioned = false
      target.shell.dataset.twState = 'pending'
      target.shell.style.opacity = '0'
      target.bubble.style.pointerEvents = 'none'
      const point = choosePoint(placed)
      if (point) {
        target.x = point.x
        target.y = point.y
        target.positioned = true
        placed.push(target)
        later(() => {
          if (!done && wave === thisWave) spawn(target, true)
        }, i * spawnStaggerMs)
      } else {
        spawnWhenSpaceIsFree(target, thisWave, i * spawnStaggerMs + 100)
      }
    })
  }

  const win = (completeDelayMs = whackedHoldMs + fadeMs): void => {
    if (done) return
    done = true
    window.clearTimeout(roundTimer)
    roundTimer = 0
    targets.forEach((target) => (target.bubble.style.pointerEvents = 'none'))
    ctx.sfx.play('gameWin')
    winCb?.()
    if (completeDelayMs <= 0) completeCb?.()
    else later(() => completeCb?.(), completeDelayMs)
  }

  const startClock = (): void => {
    if (done || clockStarted) return
    clockStarted = true
    roundTimer = window.setTimeout(() => {
      if (!done) win(0)
    }, roundMs)
  }

  const whack = (target: ThoughtTarget): void => {
    if (done || target.state !== 'active') return
    target.generation++
    target.state = 'whacked'
    target.shell.dataset.twState = 'whacked'
    target.bubble.style.pointerEvents = 'none'
    const src = ctx.assets.src(whackImage)
    target.bubble.style.backgroundImage = src ? `url("${src}")` : ''
    target.bubble.textContent = src ? '' : '💥'
    target.bubble.style.transform = `scale(${whackScale})`
    ctx.sfx.play('thoughtWhack')

    const thisWave = wave
    const generation = target.generation
    later(() => {
      if (target.generation !== generation) return
      target.shell.style.opacity = '0'
      target.state = 'gone'
      target.shell.dataset.twState = 'gone'
    }, whackedHoldMs)
    later(() => {
      if (target.generation !== generation) return
      target.positioned = false
    }, whackedHoldMs + fadeMs)
    const cleared = targets.every((candidate) => candidate.state === 'whacked' || candidate.state === 'gone')
    if (cleared) {
      win()
      return
    }
    later(() => {
      if (done || wave !== thisWave || target.generation !== generation) return
      spawnWhenSpaceIsFree(target, thisWave, 0)
    }, respawnMs)
  }

  return {
    mount(c, params) {
      ctx = c
      thoughtCount = Math.round(clamp(num(params.thoughtCount, 3), 1, 10))
      roundMs = clamp(num(params.roundSeconds, 5), 1, 60) * 1000
      spawnStaggerMs = clamp(num(params.spawnStaggerMs, 90), 0, 1000)
      whackedHoldMs = clamp(num(params.whackedHoldMs, 180), 0, 3000)
      fadeMs = clamp(num(params.fadeMs, 360), 80, 3000)
      respawnMs = clamp(num(params.respawnMs, 1000), 100, 10_000)
      thoughtSizePct = clamp(num(params.thoughtSizePct, 24), 5, 60)
      whackScale = clamp(num(params.whackScale, 1), 0.2, 3)
      hintHandScale = clamp(num(params.hintHandScale, 0.9), 0.25, 3)
      tailColor = typeof params.tailColor === 'string' ? params.tailColor : '#f7f2e9'
      tailLargePct = clamp(num(params.tailLargePct, 18), 3, 50)
      tailSmallPct = clamp(num(params.tailSmallPct, 11), 2, 40)
      subjectX = clamp(num(params.subjectX, 50), 0, 100)
      subjectY = clamp(num(params.subjectY, 88), 0, 100)
      thoughtImages = imageIds(params.thoughtImages)
      whackImage = typeof params.whackImage === 'string' ? params.whackImage : ''
      zones = normalizeThoughtSpawnZones(params.spawnZones)

      ctx.root.style.position = 'relative'
      ctx.root.style.overflow = 'hidden'
      ctx.root.style.touchAction = 'none'
      ctx.root.style.userSelect = 'none'

      for (let i = 0; i < thoughtCount; i++) {
        const shell = document.createElement('div')
        shell.dataset.twTarget = String(i)
        shell.style.cssText = `position:absolute;inset:0;pointer-events:none;opacity:1;transform-origin:center;transition:opacity ${fadeMs}ms ease,transform 260ms cubic-bezier(.2,1.35,.4,1);`

        const dot1 = document.createElement('div')
        const dot2 = document.createElement('div')
        ;[dot1, dot2].forEach((dot, dotIndex) => {
          dot.dataset.twTail = String(dotIndex + 1)
          dot.style.cssText = 'position:absolute;border-radius:50%;pointer-events:none;box-shadow:0 2px 5px rgba(0,0,0,.16);'
          shell.appendChild(dot)
        })

        const bubble = document.createElement('div')
        bubble.dataset.twThought = String(i)
        bubble.setAttribute('role', 'button')
        bubble.style.cssText =
          'position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background-position:center;background-size:contain;background-repeat:no-repeat;cursor:pointer;pointer-events:none;transition:transform 150ms cubic-bezier(.2,1.5,.4,1);filter:drop-shadow(0 3px 4px rgba(0,0,0,.2));-webkit-tap-highlight-color:transparent;'
        shell.appendChild(bubble)
        ctx.root.appendChild(shell)
        targets.push({ shell, bubble, dots: [dot1, dot2], index: i, x: 50, y: 35, state: 'gone', generation: 0, positioned: false })
      }

      const placed: ThoughtTarget[] = []
      for (const target of targets) {
        const point = choosePoint(placed)
        if (point) {
          target.x = point.x
          target.y = point.y
          target.positioned = true
          placed.push(target)
          spawn(target, false)
        } else {
          target.state = 'pending'
          target.shell.dataset.twState = 'pending'
          target.shell.style.opacity = '0'
        }
      }
      layout()
    },

    start() {
      if (started) return
      started = true
      targets.forEach((target) => target.bubble.addEventListener('pointerdown', () => whack(target)))
      ctx.root.addEventListener('pointerdown', startClock, true)
      ctx.root.addEventListener('touchstart', startClock, { capture: true, passive: true })
      beginWave()
    },

    relayout: layout,

    getHint(): HintMove | null {
      if (done) return null
      const target = targets.find((t) => t.state === 'active')
      if (!target) return null
      const p = elementHintPoint(target.bubble, 0.65)
      return { from: p, to: p, kind: 'tap', scale: hintHandScale, targetYRatio: 0.65 }
    },

    getHintTarget(): HTMLElement | null {
      return targets.find((target) => target.state === 'active')?.bubble ?? null
    },

    onComplete(cb) {
      completeCb = cb
    },

    onWin(cb) {
      winCb = cb
    },

    destroy() {
      done = true
      clearTimers()
      ctx.root.removeEventListener('pointerdown', startClock, true)
      ctx.root.removeEventListener('touchstart', startClock, true)
      ctx.root.innerHTML = ''
      targets.length = 0
    },
  }
}

export const THOUGHTWHACK_TEMPLATE: GameTemplate = {
  id: 'thoughtwhack',
  label: 'Thought whacker (spawn zones)',
  defaultHintIdleMs: 800,
  paramFields: [
    { key: 'thoughtCount', label: 'Thought symbols', type: 'number', min: 1, max: 10, step: 1 },
    { key: 'roundSeconds', label: 'Duration after first interaction (seconds)', type: 'number', min: 1, max: 60, step: 1 },
    { key: 'thoughtSizePct', label: 'Thought image size (% of short side)', type: 'number', min: 5, max: 60, step: 1 },
    { key: 'whackScale', label: 'Whack image scale', type: 'number', min: 0.2, max: 3, step: 0.05 },
    { key: 'hintHandScale', label: 'Hint hand scale', type: 'number', min: 0.25, max: 3, step: 0.05 },
    { key: 'spawnStaggerMs', label: 'Thought spawn stagger (ms)', type: 'number', min: 0, max: 1000, step: 10 },
    { key: 'whackedHoldMs', label: 'Whack image hold (ms)', type: 'number', min: 0, max: 3000, step: 20 },
    { key: 'fadeMs', label: 'Fade time (ms)', type: 'number', min: 80, max: 3000, step: 20 },
    { key: 'respawnMs', label: 'Thought respawn delay (ms)', type: 'number', min: 100, max: 10_000, step: 100 },
    { key: 'tailColor', label: 'Trailing bubble colour', type: 'color' },
    { key: 'tailLargePct', label: 'First trailing bubble size (%)', type: 'number', min: 3, max: 50, step: 1 },
    { key: 'tailSmallPct', label: 'Second trailing bubble size (%)', type: 'number', min: 2, max: 40, step: 1 },
  ],
  assetSlots: [
    { key: 'thoughtImages', label: 'Thought bubble symbol', list: true, countParam: 'thoughtCount' },
    { key: 'whackImage', label: 'Shared whack symbol' },
    { key: 'handImage', label: 'Hint hand image (optional)' },
  ],
  defaultParams: {
    thoughtCount: 3,
    roundSeconds: 5,
    thoughtSizePct: 24,
    whackScale: 1,
    hintHandScale: 0.9,
    spawnStaggerMs: 90,
    whackedHoldMs: 180,
    fadeMs: 360,
    respawnMs: 1000,
    tailColor: '#f7f2e9',
    tailLargePct: 18,
    tailSmallPct: 11,
    subjectX: 50,
    subjectY: 88,
    spawnZones: [DEFAULT_ZONE],
    thoughtImages: [],
    whackImage: '',
    handImage: '',
  },
  defaultHandguide: { mode: 'thoughtwhack', nodes: [{ x: 0.5, y: 0.35 }], periodMs: 850 },
  create: createThoughtWhack,
}
