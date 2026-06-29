import { describe, it, expect } from 'vitest'
import { parseScenes } from './parser'

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
