// The single write path for header layout. The property under test throughout: a write
// touches exactly ONE scene and ONE orientation, and an opted-in slot is a complete
// snapshot — so nothing edited elsewhere can move it afterwards.

import { describe, it, expect } from 'vitest'
import { ownsSlot, patchSlot, projectLayoutPatch, prune, resolvedLayout, scenesOwning, seedSlot, withOwnSlot, withoutSlot } from './headerLayout'
import type { HeaderConfig } from '../runtime/scene'

const PROJECT: HeaderConfig = { heightPx: 120, fontSizePx: 64, offsetYPx: 20, landscape: { fontSizePx: 40, offsetYPx: 60 } }

describe('scene header slots', () => {
  it('reports which orientations a scene owns', () => {
    expect(ownsSlot(undefined, 'portrait')).toBe(false)
    expect(ownsSlot({ portrait: { offsetYPx: 5 } }, 'portrait')).toBe(true)
    expect(ownsSlot({ portrait: { offsetYPx: 5 } }, 'landscape')).toBe(false)
    expect(ownsSlot({ portrait: {} }, 'portrait')).toBe(false) // an empty slot owns nothing
  })

  it('snapshots the layout the scene shows now, per orientation, defaults included', () => {
    expect(seedSlot(PROJECT, undefined, 'portrait')).toEqual({
      heightPx: 120, fontSizePx: 64, fontWeight: 500, align: 'center', letterSpacingPx: 0, offsetXPx: 0, offsetYPx: 20,
    })
    // Landscape snapshots the LANDSCAPE layout it is showing, not the portrait one.
    expect(seedSlot(PROJECT, undefined, 'landscape')).toMatchObject({ fontSizePx: 40, offsetYPx: 60 })
  })

  it('copies top padding only when set (it re-anchors the text)', () => {
    expect(seedSlot({}, undefined, 'portrait').topPaddingPx).toBeUndefined()
    expect(seedSlot({ topPaddingPx: 30 }, undefined, 'portrait').topPaddingPx).toBe(30)
  })

  it('opting one orientation in leaves the other following the project', () => {
    const next = withOwnSlot(PROJECT, undefined, 'landscape')
    expect(ownsSlot(next, 'landscape')).toBe(true)
    expect(ownsSlot(next, 'portrait')).toBe(false)
  })

  it('a patch lands in one slot only, and seeds it first', () => {
    const next = patchSlot(PROJECT, undefined, 'portrait', { offsetYPx: 640 })!
    expect(next.portrait).toMatchObject({ offsetYPx: 640, fontSizePx: 64, heightPx: 120 }) // full snapshot
    expect(next.landscape).toBeUndefined()
  })

  it('editing one orientation never changes the other', () => {
    const a = patchSlot(PROJECT, undefined, 'portrait', { fontSizePx: 90 })!
    const b = patchSlot(PROJECT, a, 'landscape', { fontSizePx: 30 })!
    expect(b.portrait?.fontSizePx).toBe(90)
    expect(b.landscape?.fontSizePx).toBe(30)
    // …and a later portrait edit leaves landscape alone.
    const c = patchSlot(PROJECT, b, 'portrait', { offsetYPx: 400 })!
    expect(c.landscape).toEqual(b.landscape)
  })

  it('an owned slot ignores later project changes', () => {
    const scene = patchSlot(PROJECT, undefined, 'portrait', { offsetYPx: 640 })
    const movedProject: HeaderConfig = { ...PROJECT, offsetYPx: 999, fontSizePx: 20 }
    const shown = resolvedLayout(movedProject, scene, 'portrait')
    expect(shown.offsetYPx).toBe(640)
    expect(shown.fontSizePx).toBe(64) // the snapshot, not the project's new 20
  })

  it('a scene that owns nothing follows the project, per orientation', () => {
    expect(resolvedLayout(PROJECT, undefined, 'portrait')).toMatchObject({ fontSizePx: 64, offsetYPx: 20 })
    expect(resolvedLayout(PROJECT, undefined, 'landscape')).toMatchObject({ fontSizePx: 40, offsetYPx: 60 })
  })

  it('handing a slot back drops it, and drops the override once neither is owned', () => {
    const both = patchSlot(PROJECT, patchSlot(PROJECT, undefined, 'portrait', { offsetYPx: 1 }), 'landscape', { offsetYPx: 2 })
    const noLs = withoutSlot(both, 'landscape')!
    expect(ownsSlot(noLs, 'portrait')).toBe(true)
    expect(noLs.landscape).toBeUndefined()
    expect(withoutSlot(noLs, 'portrait')).toBeUndefined()
  })

  it('reads a legacy flat override as both orientations until it is migrated', () => {
    const legacy = { offsetYPx: 300, landscape: { offsetYPx: 700 } } as never
    expect(resolvedLayout(PROJECT, legacy, 'portrait').offsetYPx).toBe(300)
    expect(resolvedLayout(PROJECT, legacy, 'landscape').offsetYPx).toBe(700)
  })

  it('patches the project layout into the right orientation', () => {
    expect(projectLayoutPatch(PROJECT, 'portrait', { offsetYPx: 120 })).toEqual({ offsetYPx: 120 })
    expect(projectLayoutPatch(PROJECT, 'landscape', { offsetYPx: 60 })).toEqual({ landscape: { fontSizePx: 40, offsetYPx: 60 } })
  })

  it('counts the scenes a project-level edit cannot move', () => {
    const scenes = [{ header: { portrait: { offsetYPx: 1 } } }, { header: { landscape: { offsetYPx: 2 } } }, {}]
    expect(scenesOwning(scenes, 'portrait')).toBe(1)
    expect(scenesOwning(scenes, 'landscape')).toBe(1)
  })

  it('prunes empties away entirely', () => {
    expect(prune({ a: undefined })).toBeUndefined()
    expect(prune({ a: 1, b: undefined })).toEqual({ a: 1 })
    expect(prune({ a: {} })).toBeUndefined()
  })
})
