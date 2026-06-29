import { describe, it, expect } from 'vitest'
import { parseScenes, parseLayout } from './parser'
import type { LayoutLine } from './types'

describe('parseLayout', () => {
  it('classifies elements by indentation', () => {
    const L = (text: string, x: number): LayoutLine => ({ text, x, page: 1 })
    const s = parseLayout([
      L('INT. ROOM - DAY', 72),
      L('A man enters.', 72),
      L('JOHN', 216),
      L('Hello there.', 144),
      L('She leaves.', 72)
    ])
    expect(s).toHaveLength(1)
    expect(s[0].heading).toBe('INT. ROOM - DAY')
    expect(s[0].characters).toEqual(['JOHN'])
    expect(s[0].lines).toEqual([['JOHN', 'Hello there.']])
    expect(s[0].blocks).toEqual([
      { type: 'action', text: 'A man enters.' },
      { type: 'cue', who: 'JOHN', text: 'Hello there.' },
      { type: 'action', text: 'She leaves.' }
    ])
  })
  it('does not treat a flush-left ALL-CAPS action line as a character cue', () => {
    const L = (text: string, x: number): LayoutLine => ({ text, x, page: 1 })
    const s = parseLayout([L('INT. ROOM - DAY', 72), L('BANG! THE DOOR SLAMS.', 72), L('JOHN', 216), L('Run.', 144)])
    expect(s[0].characters).toEqual(['JOHN']) // not "BANG" etc.
  })
})

describe('parseScenes', () => {
  it('detects scenes and characters', () => {
    const s = parseScenes('INT. DINER - DAY\n\nNEIL\nCoffee.\n\nEADY\nSure.\n\nEXT. STREET - NIGHT\n\nVINCE\nHi.\n')
    expect(s.map((x) => x.heading)).toEqual(['INT. DINER - DAY', 'EXT. STREET - NIGHT'])
    expect(s[0].characters).toEqual(['NEIL', 'EADY'])
  })
  it('captures dialogue lines', () => {
    const s = parseScenes('INT. ROOM - DAY\n\nJOHN\nHello there.\n\nMARY\nGo away,\nplease.\n')[0]
    expect(s.lines).toEqual([['JOHN', 'Hello there.'], ['MARY', 'Go away, please.']])
  })
  it('captures action + cue blocks in order', () => {
    const s = parseScenes('INT. ROOM - DAY\n\nA man enters and sits.\n\nJOHN\nHello there.\n\nShe looks away.\n')[0]
    expect(s.blocks).toEqual([
      { type: 'action', text: 'A man enters and sits.' },
      { type: 'cue', who: 'JOHN', text: 'Hello there.' },
      { type: 'action', text: 'She looks away.' }
    ])
  })
  it('handles numbered headings and empty text', () => {
    expect(parseScenes('')).toEqual([])
    expect(parseScenes('12  INT. OFFICE - DAY\n\nBOB\nHi.\n')[0].heading).toBe('INT. OFFICE - DAY')
  })
  it('handles a leading scene-number column (production scripts)', () => {
    const s = parseScenes('SC. 5.A5 EXT. TURNER’S STOOP - DAY\n\nNORA\nHi.\n\n5.12 INT. CELLAR - LATER\n\nSAM\nYo.\n')
    expect(s.map((x) => x.heading)).toEqual(['EXT. TURNER’S STOOP - DAY', 'INT. CELLAR - LATER'])
  })
})
