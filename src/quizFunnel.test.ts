import { describe, it, expect } from 'vitest'
import { parseQuizText } from './quizFunnel'

describe('parseQuizText', () => {
  it('splits questions on blank lines and strips bullets', () => {
    const qs = parseQuizText('What is X?\n- A\n- B\n\nWhat is Y?\n- C\n- D')
    expect(qs).toHaveLength(2)
    expect(qs[0].question).toBe('What is X?')
    expect(qs[0].options.map((o) => o.label)).toEqual(['A', 'B'])
  })
  it('marks the correct option via a leading or trailing *', () => {
    const qs = parseQuizText('Q?\n* Right\n- Wrong')
    expect(qs[0].options[0]).toEqual({ label: 'Right', correct: true })
    expect(qs[0].options[1].correct).toBe(false)
    expect(parseQuizText('Q?\nRight *\nWrong')[0].options[0].correct).toBe(true)
  })
  it('strips A. / B) answer prefixes', () => {
    const qs = parseQuizText('Q?\nA. First\nB) Second')
    expect(qs[0].options.map((o) => o.label)).toEqual(['First', 'Second'])
  })
  it('reads an image: line and skips a pasted Continue label', () => {
    const qs = parseQuizText('Q?\nimage: http://x/y.png\n- A\nContinue')
    expect(qs[0].image).toBe('http://x/y.png')
    expect(qs[0].options.map((o) => o.label)).toEqual(['A'])
  })
  it('drops a block with no options', () => {
    expect(parseQuizText('Just one line')).toHaveLength(0)
  })
})
