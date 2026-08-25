import { describe, expect, it } from 'vitest'
import type { SceneElement } from '../runtime/scene'
import { assignComboSlot, comboCandidates, comboLayers, comboMembers, comboOptionLabel, comboSlotSummary, setCanvasVisible } from './comboSlots'

function el(id: string, extra: Partial<SceneElement> = {}): SceneElement {
  return { id, type: 'image', name: id, x: 0, y: 0, anchor: 'center', zIndex: 1, mode: 'fit', ...extra } as SceneElement
}

const GAME = 'combo-1'

describe('combo slot assignment', () => {
  it('fills an empty slot with one patch', () => {
    const a = el('a')
    const edits = assignComboSlot({ nextId: 'a', current: undefined, role: 'option', gameId: GAME, question: 1, choice: 2, elements: [a] })
    expect(edits).toHaveLength(1)
    expect(edits[0]).toEqual({
      id: 'a',
      patch: { comboRole: { gameId: GAME, role: 'option', question: 1, choice: 2, showOnCanvas: undefined }, basketItem: undefined, drag: undefined },
    })
  })

  it('frees the previous holder so a slot is never double-booked', () => {
    const a = el('a', { comboRole: { gameId: GAME, role: 'option', question: 1, choice: 1 } })
    const b = el('b')
    const edits = assignComboSlot({ nextId: 'b', current: a, role: 'option', gameId: GAME, question: 1, choice: 1, elements: [a, b] })
    expect(edits.map((e) => e.id)).toEqual(['a', 'b'])
    expect(edits[0].patch.comboRole).toBeUndefined()
    expect(edits[1].patch.comboRole?.choice).toBe(1)
  })

  it('moves an element that already sits in another slot instead of cloning it', () => {
    // 'a' is Q1 option 1; putting it in Q2 option 2 must leave it in exactly one slot.
    const a = el('a', { comboRole: { gameId: GAME, role: 'option', question: 1, choice: 1 } })
    const edits = assignComboSlot({ nextId: 'a', current: undefined, role: 'option', gameId: GAME, question: 2, choice: 2, elements: [a] })
    expect(edits).toHaveLength(1)
    expect(edits[0].patch.comboRole).toMatchObject({ question: 2, choice: 2 })
  })

  it('releases a slot when given an empty id', () => {
    const a = el('a', { comboRole: { gameId: GAME, role: 'title', question: 3 } })
    const edits = assignComboSlot({ nextId: '', current: a, role: 'title', gameId: GAME, question: 3, elements: [a] })
    expect(edits).toEqual([{ id: 'a', patch: { comboRole: undefined } }])
  })

  it('is a no-op when the slot already holds that element', () => {
    const a = el('a', { comboRole: { gameId: GAME, role: 'anchor' } })
    expect(assignComboSlot({ nextId: 'a', current: a, role: 'anchor', gameId: GAME, elements: [a] })).toEqual([])
  })

  it('carries a layer’s canvas visibility across a move but never onto a non-layer', () => {
    const shown = el('shown', { comboRole: { gameId: GAME, role: 'layer', question: 1, choice: 1, showOnCanvas: true } })
    const moved = assignComboSlot({ nextId: 'shown', current: undefined, role: 'layer', gameId: GAME, question: 2, choice: 1, elements: [shown] })
    expect(moved[0].patch.comboRole?.showOnCanvas).toBe(true)

    // Re-purposed as an option, the layer-only flag must not tag along.
    const repurposed = assignComboSlot({ nextId: 'shown', current: undefined, role: 'option', gameId: GAME, question: 2, choice: 1, elements: [shown] })
    expect(repurposed[0].patch.comboRole?.showOnCanvas).toBeUndefined()
  })

  it('clears the competing drag models when it claims an element', () => {
    const a = el('a', { basketItem: { gameId: 'basket-1' }, drag: { group: 'a' } })
    const edits = assignComboSlot({ nextId: 'a', current: undefined, role: 'option', gameId: GAME, question: 1, choice: 1, elements: [a] })
    expect(edits[0].patch.basketItem).toBeUndefined()
    expect(edits[0].patch.drag).toBeUndefined()
    expect('basketItem' in edits[0].patch).toBe(true)
  })
})

describe('combo layer visibility', () => {
  it('toggles a layer on and drops the flag entirely when off', () => {
    const l = el('l', { comboRole: { gameId: GAME, role: 'layer', question: 1, choice: 1 } })
    expect(setCanvasVisible(l, true).patch.comboRole?.showOnCanvas).toBe(true)
    // Off is stored as absent rather than false, so it never bloats saved projects.
    expect(setCanvasVisible(l, false).patch.comboRole?.showOnCanvas).toBeUndefined()
  })

  it('keeps the rest of the role intact while toggling', () => {
    const l = el('l', { comboRole: { gameId: GAME, role: 'layer', question: 4, choice: 2 } })
    expect(setCanvasVisible(l, true).patch.comboRole).toMatchObject({ gameId: GAME, role: 'layer', question: 4, choice: 2 })
  })
})

describe('combo drag art', () => {
  it('re-keys which option it belongs to when moved, keeping its canvas visibility', () => {
    const a = el('cue', { comboRole: { gameId: GAME, role: 'dragArt', question: 1, choice: 1, showOnCanvas: true } })
    const moved = assignComboSlot({ nextId: 'cue', current: undefined, role: 'dragArt', gameId: GAME, question: 2, choice: 2, elements: [a] })
    expect(moved[0].patch.comboRole).toMatchObject({ showOnCanvas: true, question: 2, choice: 2 })

    // Canvas visibility is shared by every hidden-by-default kind, so it carries over.
    const asLayer = assignComboSlot({ nextId: 'cue', current: undefined, role: 'layer', gameId: GAME, question: 1, choice: 1, elements: [a] })
    expect(asLayer[0].patch.comboRole?.showOnCanvas).toBe(true)
    const asCaption = assignComboSlot({ nextId: 'cue', current: undefined, role: 'caption', gameId: GAME, question: 1, choice: 3, elements: [a] })
    expect(asCaption[0].patch.comboRole).toMatchObject({ role: 'caption', question: 1, choice: 3, showOnCanvas: true })
  })
})

describe('combo rosters', () => {
  const elements = [
    el('game', { type: 'game-mount' }),
    el('bg', { type: 'background' }),
    el('guide', { type: 'handguide' }),
    el('anchor', { comboRole: { gameId: GAME, role: 'anchor' } }),
    el('opt', { comboRole: { gameId: GAME, role: 'option', question: 1, choice: 1 } }),
    el('lay', { comboRole: { gameId: GAME, role: 'layer', question: 1, choice: 1 } }),
    el('loose', { comboRole: { role: 'title', question: 1 } }),
    el('other', { comboRole: { gameId: 'combo-2', role: 'title', question: 1 } }),
    el('plain'),
  ]

  it('counts an untagged game as ours but never another game’s elements', () => {
    // A single-game scene leaves gameId off, so those still belong to us.
    expect(comboMembers(elements, GAME).map((e) => e.id)).toEqual(['anchor', 'opt', 'lay', 'loose'])
  })

  it('excludes elements that cannot be slots', () => {
    expect(comboCandidates(elements).map((e) => e.id)).not.toContain('game')
    expect(comboCandidates(elements).map((e) => e.id)).not.toContain('bg')
    expect(comboCandidates(elements).map((e) => e.id)).not.toContain('guide')
    expect(comboCandidates(elements).map((e) => e.id)).toContain('plain')
  })

  it('lists only this game’s layers', () => {
    expect(comboLayers(elements, GAME).map((e) => e.id)).toEqual(['lay'])
  })
})

describe('combo labels', () => {
  it('names the slot an element already fills', () => {
    expect(comboOptionLabel(el('Hat'))).toBe('Hat')
    expect(comboOptionLabel(el('Hat', { comboRole: { role: 'anchor' } }))).toBe('Hat — anchor')
    expect(comboOptionLabel(el('Hat', { comboRole: { role: 'title', question: 2 } }))).toBe('Hat — Q2 title')
    expect(comboOptionLabel(el('Hat', { comboRole: { role: 'option', question: 2, choice: 1 } }))).toBe('Hat — Q2 option 1')
    expect(comboOptionLabel(el('Hat', { comboRole: { role: 'layer', question: 3, choice: 2 } }))).toBe('Hat — Q3 layer 2')
    expect(comboOptionLabel(el('Glow', { comboRole: { role: 'dragArt', question: 2, choice: 1 } }))).toBe('Glow — Q2 drag art 1')
    expect(comboOptionLabel(el('Name', { comboRole: { role: 'caption', question: 2, choice: 5 } }))).toBe('Name — Q2 name plate 5')
  })

  it('summarises a role in plain language for the element panel', () => {
    expect(comboSlotSummary({ role: 'anchor' })).toBe('the anchor image')
    expect(comboSlotSummary({ role: 'title', question: 2 })).toBe("question 2's title")
    expect(comboSlotSummary({ role: 'layer', question: 1, choice: 2 })).toBe("question 1's layer for option 2")
    expect(comboSlotSummary({ role: 'option', question: 4, choice: 1 })).toBe('question 4, option 1')
    expect(comboSlotSummary({ role: 'dragArt', question: 3, choice: 2 })).toBe("what question 3's option 2 looks like while dragged")
    expect(comboSlotSummary({ role: 'caption', question: 3, choice: 4 })).toBe("the name plate shown while question 3's option 4 is held")
  })
})
