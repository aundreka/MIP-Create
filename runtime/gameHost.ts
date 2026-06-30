// Mounts a game template into the game-mount slot. When interactive, starts the
// game, runs the idle-hint timer (asks the module getHint() and drives the DOM
// hand), and reports completion. Mirrors coinsort's GameScene idle-hint driver.

import { createHand, type Hand } from './hint'
import { getTemplate } from './games/registry'
import { mulberry32, type GameModule } from './games/types'
import type { AssetMap } from './types'

export interface GameHost {
  relayout(): void
  destroy(): void
}

export interface GameHostOptions {
  slot: HTMLElement // the game-layer container (sized)
  handLayer: HTMLElement // runtime root — where the hand is drawn
  templateId: string
  params: Record<string, unknown>
  assets: AssetMap
  interactive: boolean
  hintIdleMs: number
  /** Show the built-in coded hint hand. False when an editable handguide element
   * provides the hint instead, so the two don't both appear. Defaults to true. */
  hint?: boolean
  sfx: (event: string) => void
  sfxLoopStart?: (event: string) => void
  sfxLoopStop?: (event: string) => void
  /** Fires immediately when the game's win condition is met, before any reveal
   * transition. Use for sounds that must play at the win moment. */
  onWin?: () => void
  onComplete: () => void
  /** Navigate to another scene by ID (for games that drive multi-scene flows). */
  navigate?: (sceneId: string) => void
  /** Stable element ID passed through to GameContext. */
  elementId?: string
}

export function createGameHost(opts: GameHostOptions): GameHost | null {
  const tpl = getTemplate(opts.templateId)
  if (!tpl) return null
  const mod: GameModule = tpl.create()

  mod.mount(
    {
      root: opts.slot,
      assets: { src: (id) => (id && opts.assets[id] ? opts.assets[id].src : '') },
      sfx: { play: opts.sfx, loopStart: opts.sfxLoopStart, loopStop: opts.sfxLoopStop },
      rng: mulberry32(123456),
      navigate: opts.navigate,
      elementId: opts.elementId,
    },
    { ...tpl.defaultParams, ...opts.params },
  )

  let hand: Hand | null = null
  let idle = 0
  let destroyed = false

  if (opts.interactive) {
    mod.start()
    opts.sfx('gameStart')
    if (opts.hint !== false) {
      hand = createHand(opts.handLayer)
      let inputActive = false
      const schedule = (): void => {
        window.clearTimeout(idle)
        idle = window.setTimeout(() => {
          if (destroyed || inputActive) return
          const move = mod.getHint()
          if (move) hand!.show(move.from, move.to, move.kind ?? 'slide', move.scale)
        }, opts.hintIdleMs)
      }
      const onStart = (): void => {
        inputActive = true
        hand?.hide()
        schedule()
      }
      const onEnd = (): void => {
        inputActive = false
        schedule()
      }
      // Use capture so these fire even when the game canvas has setPointerCapture.
      // Both pointer and touch events covered — touch events are the primary path
      // in MRAID environments where synthesized pointer events may be suppressed.
      opts.slot.addEventListener('pointerdown', onStart, true)
      opts.slot.addEventListener('pointerup', onEnd, true)
      opts.slot.addEventListener('pointercancel', onEnd, true)
      opts.slot.addEventListener('touchstart', onStart, { capture: true, passive: true })
      opts.slot.addEventListener('touchend', onEnd, { capture: true, passive: true })
      opts.slot.addEventListener('touchcancel', onEnd, { capture: true, passive: true })
      schedule()
    }
    if (opts.onWin) mod.onWin?.(opts.onWin)
    mod.onComplete(() => {
      hand?.hide()
      window.clearTimeout(idle)
      opts.onComplete()
    })
  }

  return {
    relayout: () => mod.relayout(),
    destroy: () => {
      destroyed = true
      window.clearTimeout(idle)
      hand?.destroy()
      mod.destroy()
    },
  }
}
