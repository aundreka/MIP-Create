// Game template registry — maps a templateId to its definition. Add new games
// (Pass 5: merge, spin-wheel, box, drag, bubbles, ...) here.

import type { GameTemplate } from './types'
import { MATCH_TEMPLATE } from './match'
import { SCRATCH_TEMPLATE } from './scratch'
import { SCRATCH_GRID_TEMPLATE } from './scratch_grid'
import { SPIN_TEMPLATE } from './spin'
import { PICK_TEMPLATE } from './pick'
import { DRAG_TEMPLATE } from './drag'
import { BUBBLES_TEMPLATE } from './bubbles'
import { FLIPMATCH_TEMPLATE } from './flipmatch'
import { MEMORYMATCH_TEMPLATE } from './memorymatch'
import { SORT_TEMPLATE } from './sort'
import { SLIDER_TEMPLATE } from './slider'
import { SPINCATCH_TEMPLATE } from './spincatch'
import { WHACK_TEMPLATE } from './whack'
import { MERGE_TEMPLATE } from './merge'
import { CATCH_TEMPLATE } from './catch'
import { RECIPE_TEMPLATE } from './recipe'
import { BINGO_TEMPLATE } from './bingo'
import { SWIPE_TEMPLATE } from './swipe'
import { SLOTS_TEMPLATE } from './slots'
import { CONVEYOR_TEMPLATE } from './conveyor'
import { VENDING_TEMPLATE } from './vending'
import { WORD_TEMPLATE } from './word'
import { SONGMIX_TEMPLATE } from './songmix'
import { EMBED_TEMPLATE } from './embed'

export const GAME_TEMPLATES: GameTemplate[] = [
  FLIPMATCH_TEMPLATE,
  MEMORYMATCH_TEMPLATE,
  MATCH_TEMPLATE,
  SORT_TEMPLATE,
  MERGE_TEMPLATE,
  SCRATCH_TEMPLATE,
  SCRATCH_GRID_TEMPLATE,
  SPIN_TEMPLATE,
  SPINCATCH_TEMPLATE,
  SLOTS_TEMPLATE,
  PICK_TEMPLATE,
  VENDING_TEMPLATE,
  DRAG_TEMPLATE,
  CATCH_TEMPLATE,
  BUBBLES_TEMPLATE,
  SLIDER_TEMPLATE,
  SWIPE_TEMPLATE,
  WHACK_TEMPLATE,
  CONVEYOR_TEMPLATE,
  RECIPE_TEMPLATE,
  BINGO_TEMPLATE,
  WORD_TEMPLATE,
  SONGMIX_TEMPLATE,
  EMBED_TEMPLATE,
]

export function getTemplate(id: string | undefined): GameTemplate | undefined {
  return GAME_TEMPLATES.find((t) => t.id === id)
}

// Dev-time contract check for contributed mechanics — surfaces a malformed
// registration in the console. Stripped from production builds (the `if (false)`
// branch and its import are dead-code-eliminated), so it costs the runtime
// bundle nothing. CI should call validateRegistry(GAME_TEMPLATES) directly.
if (import.meta.env?.DEV) {
  void import('./validate').then(({ validateRegistry }) => {
    const errs = validateRegistry(GAME_TEMPLATES)
    if (errs.length) console.warn('[games] registry contract errors:\n - ' + errs.join('\n - '))
  })
}
