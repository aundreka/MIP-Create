import { describe, expect, it } from 'vitest'
import { matchPreviewLinks } from './applovinLinks'

const link = (h: string, n: string): string => `http://playable.applovindemo.com/Preview/?&thm=al&h=${h}&n=${encodeURIComponent(n)}`
const MIP = 'wolt_acslanot_mip_20260924_03_emily_game_scratch_human_dd_unique'
const SIP = 'wolt_acslanot_sip_20260924_03_emily_product_carousel_human_dd_unique'

describe('matchPreviewLinks', () => {
  it('reads the link format the upload page prints', () => {
    const got = matchPreviewLinks([{ name: `${MIP}.html`, iteration: 'mip3' }], [
      'http://167.99.227.249/sip-generator/',
      link(`${MIP}_1790524032.html`, 'mip3'),
    ])
    expect(got[0].link).toBe(link(`${MIP}_1790524032.html`, 'mip3'))
  })

  it('pairs by iteration name, then by file name, regardless of page order', () => {
    const files = [
      { name: `${MIP}.html`, iteration: 'MIP3' },
      { name: `${SIP}.html`, iteration: 'renamed by site' },
    ]
    const got = matchPreviewLinks(files, [link(`${SIP}_2.html`, 'something else'), link(`${MIP}_1.html`, 'mip3')])
    expect(got.map((f) => f.link)).toEqual([link(`${MIP}_1.html`, 'mip3'), link(`${SIP}_2.html`, 'something else')])
  })

  it('leaves a file without a link when the page shows none for it', () => {
    const got = matchPreviewLinks([{ name: `${MIP}.html`, iteration: 'mip3' }], ['http://example.com/'])
    expect(got[0].link).toBeUndefined()
  })
})
