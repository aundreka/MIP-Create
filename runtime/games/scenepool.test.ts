import { describe, expect, it } from 'vitest'
import { parseRevealOptions, parseScenePool, pickFromScenePool, pickWeighted, serializeScenePool } from './scenepool'

describe('random win scene pool', () => {
  it('parses ids with optional weights and round-trips', () => {
    const pool = parseScenePool('a, b:3 ,a:9,c:0')
    expect(pool).toEqual([{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }, { id: 'c', weight: 0 }])
    expect(serializeScenePool(pool)).toBe('a,b:3,c:0')
  })

  it('draws by weight and skips zero-weight scenes', () => {
    expect(pickFromScenePool('a,b:3,c:0', () => 0)).toBe('a')
    expect(pickFromScenePool('a,b:3,c:0', () => 0.3)).toBe('b')
    expect(pickFromScenePool('a,b:3,c:0', () => 0.999)).toBe('b')
  })

  it('is empty when nothing is ticked', () => {
    expect(pickFromScenePool('')).toBe('')
    expect(pickFromScenePool(undefined)).toBe('')
    expect(pickFromScenePool('a:0')).toBe('')
  })
})

describe('random reveals', () => {
  it('parses options, defaulting blanks and weight', () => {
    expect(parseRevealOptions([{ image: 'p1', sceneId: 's1' }, null, { image: 'p2', weight: 'x' }, { text: 't', weight: -2 }])).toEqual([
      { image: 'p1', text: '', weight: 1, sceneId: 's1' },
      { image: 'p2', text: '', weight: 1, sceneId: '' },
      { image: '', text: 't', weight: 0, sceneId: '' },
    ])
    expect(parseRevealOptions('nope')).toEqual([])
  })

  it('draws one option by weight; rand 0 (editor) shows the first', () => {
    const opts = parseRevealOptions([{ image: 'a', weight: 1 }, { image: 'b', weight: 3 }])
    expect(pickWeighted(opts, () => 0)?.image).toBe('a')
    expect(pickWeighted(opts, () => 0.5)?.image).toBe('b')
    expect(pickWeighted([], () => 0)).toBeNull()
  })
})
