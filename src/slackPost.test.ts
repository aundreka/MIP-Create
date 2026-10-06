import { describe, expect, it } from 'vitest'
import { dottedDate, joinList, kindPhrase, slackHeadline, slackPostHtml, slackPostText, themeFromProjectName } from './slackPost'

const AL = 'http://playable.applovindemo.com/Preview/?&thm=al&h=memowrite_sip_1.html&n=MIP7%20SIP'
const base = {
  date: '2026-09-29',
  client: 'Memowrite',
  theme: 'Halloween',
  mips: ['MIP7', 'MIP8'],
  mentions: "Sirs and Ma'ams @Anthony Castor",
}

describe('slackHeadline', () => {
  it('writes the delivery headline', () => {
    const got = slackHeadline({ ...base, kinds: ['sip', 'sip'], links: [] })
    expect(got).toBe('2026.09.29 - Memowrite - Halloween SIPs (MIP7 and MIP8)')
  })

  it('collapses the slots a project has not filled in', () => {
    expect(slackHeadline({ date: '2026-09-29', kinds: ['mip'], mips: [], links: [], mentions: '' })).toBe('2026.09.29 - MIP')
  })

  it('names both kinds when the batch mixes them', () => {
    const got = slackHeadline({ ...base, mips: ['MIP7'], kinds: ['mip', 'sip'], links: [] })
    expect(got).toBe('2026.09.29 - Memowrite - Halloween MIP and SIP (MIP7)')
  })
})

describe('kindPhrase', () => {
  it('pluralizes per kind and counts a variant as a MIP', () => {
    expect(kindPhrase(['sip'])).toBe('SIP')
    expect(kindPhrase(['sip', 'sip'])).toBe('SIPs')
    expect(kindPhrase(['mip', 'variant'])).toBe('MIPs')
    expect(kindPhrase(['mip', 'sip', 'sip'])).toBe('MIP and SIPs')
    expect(kindPhrase([])).toBe('MIP')
  })
})

describe('dottedDate', () => {
  it('reads any Y-M-D and falls back to today', () => {
    expect(dottedDate('2026-09-29')).toBe('2026.09.29')
    expect(dottedDate('20260929')).toBe('2026.09.29')
    expect(dottedDate('')).toMatch(/^\d{4}\.\d{2}\.\d{2}$/)
  })
})

describe('joinList', () => {
  it('reads as a sentence and drops repeats', () => {
    expect(joinList(['MIP7'])).toBe('MIP7')
    expect(joinList(['MIP7', 'MIP8'])).toBe('MIP7 and MIP8')
    expect(joinList(['MIP7', 'MIP8', 'MIP9'])).toBe('MIP7, MIP8 and MIP9')
    expect(joinList(['MIP7', 'MIP7', ''])).toBe('MIP7')
  })
})

describe('themeFromProjectName', () => {
  it('leaves the theme once the client and dates are gone', () => {
    expect(themeFromProjectName('Memowrite 2026-09 Halloween', 'Memowrite')).toBe('Halloween')
    expect(themeFromProjectName('memowrite - halloween', 'Memowrite')).toBe('halloween')
    expect(themeFromProjectName('', 'Memowrite')).toBe('')
  })
})

describe('the copied post', () => {
  it('embeds the link in the word "Applovin" and keeps the three lines', () => {
    const input = { ...base, kinds: ['sip' as const, 'sip' as const], links: [{ label: 'MIP7 SIP', url: AL }] }
    expect(slackPostHtml(input)).toBe(
      '<div>2026.09.29 - Memowrite - Halloween SIPs (MIP7 and MIP8)</div>' +
        `<div><a href="${AL.replace(/&/g, '&amp;')}">Applovin</a></div>` +
        "<div>Sirs and Ma'ams @Anthony Castor</div>",
    )
  })

  it('spells the URL out in the plain-text flavour', () => {
    const got = slackPostText({ ...base, kinds: ['sip'], links: [{ label: 'MIP7 SIP', url: AL }] })
    expect(got.split('\n')[1]).toBe(`Applovin - ${AL}`)
  })

  it('labels each link when the batch sent more than one file', () => {
    const got = slackPostText({
      ...base,
      kinds: ['sip', 'sip'],
      links: [
        { label: 'MIP7 SIP', url: 'http://a/1' },
        { label: 'MIP8 SIP', url: 'http://a/2' },
      ],
    })
    expect(got.split('\n').slice(1, 3)).toEqual(['MIP7 SIP - Applovin - http://a/1', 'MIP8 SIP - Applovin - http://a/2'])
  })
})
