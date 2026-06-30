import { describe, it, expect } from 'vitest'
import { checkClient } from './consistency'
import type { StyleProfile } from './fingerprint'

const prov = (projectId: string) => ({ projectId, sceneId: '', sceneName: '' })
const scal = (projectId: string, value: string) => ({ value, prov: prov(projectId) })
const sp = (id: string, over: Partial<StyleProfile> = {}): StyleProfile => ({
  projectId: id,
  name: id,
  client: 'Acme',
  mip: id,
  mipVersion: '',
  baseSize: '1080x1920',
  ctaFont: scal(id, 'Montserrat / 800'),
  ctaPulse: scal(id, 'medium'),
  entrancePreset: null,
  avgEntranceMs: null,
  hasBgm: false,
  fonts: {},
  palette: {},
  sfxEvents: {},
  transitions: {},
  gameTemplates: {},
  ...over,
})

describe('checkClient', () => {
  it('flags the MIP that diverges from the majority canvas size', () => {
    const findings = checkClient([sp('a'), sp('b'), sp('c', { baseSize: '1080x1350' })])
    const base = findings.find((f) => f.category === 'base-size')
    expect(base).toBeTruthy()
    expect(base?.projectId).toBe('c')
    expect(base?.severity).toBe('error')
  })

  it('reports nothing when all MIPs agree', () => {
    expect(checkClient([sp('a'), sp('b')])).toHaveLength(0)
  })

  it('needs at least two MIPs to compare', () => {
    expect(checkClient([sp('a')])).toHaveLength(0)
  })
})
