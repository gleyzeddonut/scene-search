import { describe, it, expect } from 'vitest'
import { parseScenes, parseLayout, parseScenesHeadingless } from './parser'
import type { LayoutLine } from './types'

describe('parseLayout', () => {
  it('classifies elements by indentation', () => {
    const L = (text: string, x: number): LayoutLine => ({ text, x, y: 0, page: 1 })
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
    const L = (text: string, x: number): LayoutLine => ({ text, x, y: 0, page: 1 })
    const s = parseLayout([L('INT. ROOM - DAY', 72), L('BANG! THE DOOR SLAMS.', 72), L('JOHN', 216), L('Run.', 144)])
    expect(s[0].characters).toEqual(['JOHN']) // not "BANG" etc.
  })
  it('does not treat time-cuts or a quoted dialogue line at the cue indent as a cue', () => {
    const L = (text: string, x: number): LayoutLine => ({ text, x, y: 0, page: 1 })
    const s = parseLayout([
      L('INT. ROOM - DAY', 72),
      L('MOMENTS LATER', 216), // a time cut sitting at the cue indent — not a character
      L('She crosses the room.', 144),
      L('JOHN', 216),
      L('WHO LOVES AND PRACTICES LYING!”', 216), // a quoted line of dialogue, not a cue
      L('Real line.', 144)
    ])
    expect(s[0].characters).toEqual(['JOHN'])
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
  it('keeps time-cuts and scene markers out of the character list', () => {
    const s = parseScenes(
      'INT. BAR - NIGHT\n\nNYLES\nHi.\n\nMOMENTS LATER\nSarah enters.\n\nDARLA\nHey.\n\nEND SC 1\n'
    )[0]
    expect(s.characters).toEqual(['NYLES', 'DARLA']) // no MOMENTS LATER / END SC 1
  })
  it('keeps a real character whose name collides with an artifact word (PAGE)', () => {
    const s = parseScenes('INT. ROOM - DAY\n\nPAGE\nIt’s just the drugs, relax.\n')[0]
    expect(s.characters).toEqual(['PAGE']) // "PAGE" the name survives; only "PAGE 3 OF 4" is dropped
  })
  it('strips fused gutter scene numbers but keeps real location numbers and story-days', () => {
    const headings = (h: string) => parseScenes(`${h}\n\nBOB\nHi.\n`)[0].heading
    // fused onto a word/paren with no space → gutter number, stripped
    expect(headings('INT. HOUSE - CLOSE ON MODERN DAY TONYA100')).toBe('INT. HOUSE - CLOSE ON MODERN DAY TONYA')
    expect(headings('EXT. RANCH -- DUTTON CEMETERY -- DAY (YD11)5')).toBe('EXT. RANCH -- DUTTON CEMETERY -- DAY (YD11)')
    expect(headings('INT. POLICE STATION - MEETING ROOM - DAY41 *')).toBe('INT. POLICE STATION - MEETING ROOM - DAY')
    // space-separated trailing numbers are kept: real location numbers, years, AND
    // TV story-day labels (which a gutter number is indistinguishable from)
    expect(headings('INT. AIR FORCE ONE - DALLAS, 1963')).toBe('INT. AIR FORCE ONE - DALLAS, 1963')
    expect(headings('INT. STUDIO 54 - NIGHT')).toBe('INT. STUDIO 54 - NIGHT')
    expect(headings('INT. KITCHEN - DAY 3')).toBe('INT. KITCHEN - DAY 3')
    // a standalone letter+digit unit label is kept (B is preceded by a space)
    expect(headings('INT. STORAGE ROOM B2')).toBe('INT. STORAGE ROOM B2')
  })
})

describe('parseScenesHeadingless (sides with no slug line)', () => {
  it('recovers a single scene from dialogue with no scene heading', () => {
    const s = parseScenesHeadingless('GLORIA\nBum bum bum... death.\n\nALEX\nStop.\n\nSAM\nWho shuffled?\n')
    expect(s).toHaveLength(1)
    expect(s[0].characters).toEqual(['GLORIA', 'ALEX', 'SAM'])
  })
  it('returns nothing for prose with no real dialogue (a journal, a transcript)', () => {
    // caps-y labels that look cue-ish but aren't names — must not become a scene
    expect(parseScenesHeadingless('ISBN 978-1-7773737-0-2\nwww.example.org\n\nDA Y 8 1\nLife is full of distractions.\n')).toEqual([])
    expect(parseScenesHeadingless('Just a paragraph of ordinary prose with no script structure at all.')).toEqual([])
  })
})
