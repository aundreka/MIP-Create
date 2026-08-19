import { describe, it, expect } from 'vitest'
import { projectHeaderOffset, prune, sceneHeaderOffset, sceneOffsetOf } from './headerLayout'

describe('header placement targets', () => {
  it('writes a scene placement into the portrait slot', () => {
    expect(sceneHeaderOffset(undefined, false, 0, 640)).toEqual({ offsetYPx: 640 })
  })

  it('writes into the landscape slot without touching the portrait one', () => {
    expect(sceneHeaderOffset({ offsetYPx: 200 }, true, 0, 700)).toEqual({ offsetYPx: 200, landscape: { offsetYPx: 700 } })
  })

  it('keeps other authored fields when only the offsets move', () => {
    expect(sceneHeaderOffset({ heightPx: 200, offsetYPx: 10 }, false, 30, 400)).toEqual({ heightPx: 200, offsetXPx: 30, offsetYPx: 400 })
  })

  it('drops back to the project layout when nothing is left', () => {
    expect(sceneHeaderOffset({ offsetYPx: 640 }, false, 0, 0)).toBeUndefined()
    // …but a scene that also resized the band keeps that.
    expect(sceneHeaderOffset({ heightPx: 200, offsetYPx: 640 }, false, 0, 0)).toEqual({ heightPx: 200 })
  })

  it('clears an emptied landscape slot but keeps the portrait placement', () => {
    expect(sceneHeaderOffset({ offsetYPx: 300, landscape: { offsetYPx: 700 } }, true, 0, 0)).toEqual({ offsetYPx: 300 })
  })

  it('patches the project header per orientation', () => {
    expect(projectHeaderOffset({}, false, 0, 120)).toEqual({ offsetXPx: undefined, offsetYPx: 120 })
    expect(projectHeaderOffset({ landscape: { heightPx: 80 } }, true, 0, 60)).toEqual({ landscape: { heightPx: 80, offsetYPx: 60 } })
  })

  it('reads the placement in force for an orientation', () => {
    const scene = { offsetYPx: 300, landscape: { offsetYPx: 700 } }
    expect(sceneOffsetOf(scene, false)).toEqual({ x: undefined, y: 300 })
    expect(sceneOffsetOf(scene, true)).toEqual({ x: undefined, y: 700 })
    expect(sceneOffsetOf(undefined, true)).toEqual({ x: undefined, y: undefined })
  })

  it('prunes empty objects away entirely', () => {
    expect(prune({ a: undefined })).toBeUndefined()
    expect(prune({ a: 1, b: undefined })).toEqual({ a: 1 })
    expect(prune({ a: {} })).toBeUndefined()
  })
})
