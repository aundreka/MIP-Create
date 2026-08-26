import { describe, expect, it } from 'vitest'
import type { SceneElement } from '../runtime/scene'
import { assignComboSlot } from './comboSlots'
import {
  assignCarouselSlot,
  carouselCandidates,
  carouselSlotFor,
  carouselWired,
  carouselMembers,
  carouselOptionLabel,
  carouselSlotSummary,
  setCarouselCanvasVisible,
} from './carouselSlots'

function el(id: string, extra: Partial<SceneElement> = {}): SceneElement {
  return { id, type: 'image', name: id, x: 0, y: 0, anchor: 'center', zIndex: 1, mode: 'fit', ...extra } as SceneElement
}

const GAME = 'carousel-1'

describe('carousel slot assignment', () => {
  it('fills an empty slot with one patch', () => {
    const a = el('a')
    const edits = assignCarouselSlot({ nextId: 'a', current: undefined, role: 'label', gameId: GAME, choice: 2, elements: [a] })
    expect(edits).toHaveLength(1)
    expect(edits[0]).toEqual({
      id: 'a',
      patch: {
        carouselRole: { gameId: GAME, role: 'label', choice: 2, showOnCanvas: undefined },
        comboRole: undefined,
        basketItem: undefined,
        drag: undefined,
      },
    })
  })

  it('frees the previous holder so a slot is never double-booked', () => {
    const a = el('a', { carouselRole: { gameId: GAME, role: 'label', choice: 1 } })
    const b = el('b')
    const edits = assignCarouselSlot({ nextId: 'b', current: a, role: 'label', gameId: GAME, choice: 1, elements: [a, b] })
    expect(edits.map((e) => e.id)).toEqual(['a', 'b'])
    expect(edits[0].patch.carouselRole).toBeUndefined()
    expect(edits[1].patch.carouselRole?.choice).toBe(1)
  })

  it('moves an element that already labels another choice instead of cloning it', () => {
    const a = el('a', { carouselRole: { gameId: GAME, role: 'label', choice: 1 } })
    const edits = assignCarouselSlot({ nextId: 'a', current: undefined, role: 'label', gameId: GAME, choice: 3, elements: [a] })
    expect(edits).toHaveLength(1)
    expect(edits[0].patch.carouselRole).toMatchObject({ choice: 3 })
  })

  it('releases a slot when given an empty id', () => {
    const a = el('a', { carouselRole: { gameId: GAME, role: 'label', choice: 2 } })
    const edits = assignCarouselSlot({ nextId: '', current: a, role: 'label', gameId: GAME, choice: 2, elements: [a] })
    expect(edits).toEqual([{ id: 'a', patch: { carouselRole: undefined } }])
  })

  it('does nothing when the element is already in that slot', () => {
    const a = el('a', { carouselRole: { gameId: GAME, role: 'label', choice: 1 } })
    expect(assignCarouselSlot({ nextId: 'a', current: a, role: 'label', gameId: GAME, choice: 1, elements: [a] })).toEqual([])
  })

  it('keeps a label’s canvas-visibility flag when it moves slot', () => {
    const a = el('a', { carouselRole: { gameId: GAME, role: 'label', choice: 1, showOnCanvas: true } })
    const edits = assignCarouselSlot({ nextId: 'a', current: undefined, role: 'label', gameId: GAME, choice: 4, elements: [a] })
    expect(edits[0].patch.carouselRole?.showOnCanvas).toBe(true)
  })

  it('is exclusive with the other board roles — an element does one job', () => {
    const a = el('a', { comboRole: { gameId: 'combo-1', role: 'layer', question: 1, choice: 1 }, drag: { group: 'x' } } as Partial<SceneElement>)
    const edits = assignCarouselSlot({ nextId: 'a', current: undefined, role: 'label', gameId: GAME, choice: 1, elements: [a] })
    expect(edits[0].patch.comboRole).toBeUndefined()
    expect(edits[0].patch.drag).toBeUndefined()
    expect(edits[0].patch.basketItem).toBeUndefined()
    // ...and the other way round: taking it into a combo board drops the label role.
    const b = el('b', { carouselRole: { gameId: GAME, role: 'label', choice: 1 } })
    const back = assignComboSlot({ nextId: 'b', current: undefined, role: 'layer', gameId: 'combo-1', question: 1, choice: 1, elements: [b] })
    expect(back[0].patch.carouselRole).toBeUndefined()
  })

  it('claims labels tagged with no game named, as a single-game scene produces', () => {
    const a = el('a', { carouselRole: { role: 'label', choice: 1 } })
    const b = el('b', { carouselRole: { gameId: 'other', role: 'label', choice: 1 } })
    expect(carouselMembers([a, b], GAME).map((e) => e.id)).toEqual(['a'])
    expect(carouselSlotFor([a, b], GAME, 'label', 1)?.id).toBe('a')
  })

  it('keeps a game mount, a background and a hint hand out of the candidates', () => {
    const list = [el('img'), el('g', { type: 'game-mount' }), el('bg', { type: 'background' }), el('h', { type: 'handguide' })]
    expect(carouselCandidates(list).map((e) => e.id)).toEqual(['img'])
  })

  it('says in the dropdown what an element is already doing', () => {
    expect(carouselOptionLabel(el('plain'))).toBe('plain')
    expect(carouselOptionLabel(el('a', { carouselRole: { role: 'label', choice: 3 } }))).toBe('a — label 3')
    expect(carouselOptionLabel(el('c', { carouselRole: { role: 'choice', choice: 1 } }))).toBe('c — choice 1')
    expect(carouselOptionLabel(el('r', { carouselRole: { role: 'reveal', choice: 2 } }))).toBe('r — reveal 2')
    expect(carouselOptionLabel(el('b', { comboRole: { role: 'layer', question: 1, choice: 1 } }))).toBe('b — in a combo board')
    expect(carouselSlotSummary({ role: 'choice', choice: 1 })).toBe('choice 1 in the row')
    expect(carouselSlotSummary({ role: 'label', choice: 2 })).toBe('the label for choice 2')
    expect(carouselSlotSummary({ role: 'reveal', choice: 3 })).toBe('the art shown while choice 3 is selected')
  })

  it('keeps the three roles apart on the same choice', () => {
    // A choice, its label and its reveal are separate slots — assigning one must not
    // displace the others.
    const art = el('art', { carouselRole: { gameId: GAME, role: 'choice', choice: 1 } })
    const lab = el('lab', { carouselRole: { gameId: GAME, role: 'label', choice: 1 } })
    const list = [art, lab, el('rev')]
    expect(carouselSlotFor(list, GAME, 'choice', 1)?.id).toBe('art')
    expect(carouselSlotFor(list, GAME, 'label', 1)?.id).toBe('lab')
    const edits = assignCarouselSlot({ nextId: 'rev', current: undefined, role: 'reveal', gameId: GAME, choice: 1, elements: list })
    expect(edits).toHaveLength(1)
    expect(edits[0].patch.carouselRole).toMatchObject({ role: 'reveal', choice: 1 })
  })

  it('counts the row from what is actually wired up', () => {
    // The panel must never offer fewer rows than there are live assignments — a project
    // edited down by mistake would otherwise hide them.
    const list = [
      el('a', { carouselRole: { gameId: GAME, role: 'choice', choice: 1 } }),
      el('b', { carouselRole: { gameId: GAME, role: 'choice', choice: 4 } }),
      el('c', { carouselRole: { gameId: 'other', role: 'choice', choice: 9 } }),
    ]
    expect(carouselWired(list, GAME)).toBe(4)
    expect(carouselWired([], GAME)).toBe(0)
  })

  it('stores a hidden label as absent rather than false, to keep projects lean', () => {
    const a = el('a', { carouselRole: { gameId: GAME, role: 'label', choice: 1, showOnCanvas: true } })
    expect(setCarouselCanvasVisible(a, false).patch.carouselRole?.showOnCanvas).toBeUndefined()
    expect(setCarouselCanvasVisible(a, true).patch.carouselRole?.showOnCanvas).toBe(true)
    // The slot itself survives the toggle.
    expect(setCarouselCanvasVisible(a, false).patch.carouselRole?.choice).toBe(1)
  })
})
