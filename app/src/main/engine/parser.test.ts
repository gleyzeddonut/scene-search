import { describe, it, expect } from 'vitest'
import { parseScenes, parseLayout, parseScenesHeadingless, parseColonDialogue } from './parser'
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
  it('finds dialogue when the dialogue column outnumbers the action margin (dialogue-heavy sides)', () => {
    const L = (text: string, x: number): LayoutLine => ({ text, x, y: 0, page: 1 })
    // sides excerpts are mostly dialogue: the dialogue column (x=185) dominates the
    // action margin (x=114), so a purely frequency-based base margin lands on the
    // dialogue column and every spoken line reads as indent-0 action
    const lines = [L("INT. SKYLAR'S ROOM -- NIGHT", 114), L('Will and Skylar lie in bed.', 114), L('She gets up.', 114)]
    for (let i = 0; i < 13; i++) {
      lines.push(L(i % 2 ? 'WILL' : 'SKYLAR', 303))
      lines.push(L('Come with me to California.', 185))
      lines.push(L('I want you to come with me.', 185))
    }
    const s = parseLayout(lines)
    expect(s).toHaveLength(1)
    expect(s[0].characters).toEqual(['SKYLAR', 'WILL'])
    expect(s[0].lines).toHaveLength(13)
  })
  it('supports digit-named characters at the cue indent ("3", "1-2")', () => {
    const L = (text: string, x: number): LayoutLine => ({ text, x, y: 0, page: 1 })
    const s = parseLayout([
      L('INT. 3’S BEDROOM - NIGHT', 108),
      L('Unkempt apartment bedroom.', 108),
      L('3', 252),
      L('Last time. Get your shit. Get. Out.', 180),
      L('1-2', 252),
      L('Give--', 180),
      L("3 (CONT'D)", 252),
      L('I have nothing left!', 180)
    ])
    expect(s[0].characters).toEqual(['3', '1-2'])
    expect(s[0].lines).toEqual([
      ['3', 'Last time. Get your shit. Get. Out.'],
      ['1-2', 'Give--'],
      ['3', 'I have nothing left!']
    ])
  })
  it('does not treat an ALL-CAPS insert with a phone-number digit run as a character', () => {
    const L = (text: string, x: number): LayoutLine => ({ text, x, y: 0, page: 1 })
    const s = parseLayout([
      L('INT. GARAGE - NIGHT', 108),
      L('JANE', 252),
      L('Hello.', 180),
      L('BURNHAM & ASSOCIATES REALTY 555-0195', 252), // a sign/insert, not a speaker
      L('The sign glows in the dark.', 180),
      L('PORT AUTHORITY INFORMATION OFFICER', 252), // long, but a REAL character
      L('Next in line, please.', 180)
    ])
    expect(s[0].characters).toEqual(['JANE', 'PORT AUTHORITY INFORMATION OFFICER'])
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
  it('recognizes colon-form slugs and slugs glued to FADE IN:', () => {
    // amateur scripts write "INT:" for "INT." and glue the opening transition on
    const s = parseScenes('FADE IN: INT: CAFÉ - EARLY EVENING\n\nDANIELLE\nEnjoy! Next.\n\nEXT: PARKING LOT - NIGHT\n\nSETH\nThanks.\n')
    expect(s.map((x) => x.heading)).toEqual(['INT: CAFÉ - EARLY EVENING', 'EXT: PARKING LOT - NIGHT'])
    expect(s[0].characters).toEqual(['DANIELLE'])
    // a cue that merely starts with INT letters is still a cue, not a heading
    expect(parseScenes('INT. ROOM - DAY\n\nINTERN\nCoffee?\n')[0].characters).toEqual(['INTERN'])
  })
  it('keeps time-cuts and scene markers out of the character list', () => {
    const s = parseScenes(
      'INT. BAR - NIGHT\n\nNYLES\nHi.\n\nMOMENTS LATER\nSarah enters.\n\nDARLA\nHey.\n\nEND SC 1\n'
    )[0]
    expect(s.characters).toEqual(['NYLES', 'DARLA']) // no MOMENTS LATER / END SC 1
  })
  it('keeps bare scene/episode labels out of the character list', () => {
    const s = parseScenes('INT. STAGE - DAY\n\nSC 1\nJune enters, nervous.\n\nTRINA\nHi there.\n\nEPISODE 47\nAn ad plays on the TV.\n')[0]
    expect(s.characters).toEqual(['TRINA']) // not SC 1 / EPISODE 47
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

describe('mid-scene sides (dialogue before the first heading)', () => {
  it('parseScenes recovers a pre-heading excerpt as a synthetic leading scene', () => {
    const s = parseScenes(
      'ANGELA\nYou have a call at 11.\n\nTOMMY\nCancel it.\n\nANGELA\nYes sir.\n\nINT. OFFICE - DAY\n\nRace tidies his desk.\n'
    )
    expect(s.map((x) => x.heading)).toEqual(['SCENE 1', 'INT. OFFICE - DAY'])
    expect(s[0].characters).toEqual(['ANGELA', 'TOMMY'])
    expect(s.map((x) => x.index)).toEqual([1, 2])
  })
  it('parseScenes does not turn a title page into a scene', () => {
    const s = parseScenes('My Great Script\nby Someone\n\nINT. ROOM - DAY\n\nBOB\nHi.\n')
    expect(s.map((x) => x.heading)).toEqual(['INT. ROOM - DAY'])
    // a production title page reads as up-to-two fake cue/dialogue pairs (the show
    // title and a draft label, each "speaking" the text below) — still not a scene
    const t = parseScenes(
      'SERVANT\nEpisode 305 “Tiger” Written by Henry Chaisson\n\nPRODUCTION NOTES\nApril 7, 2021\n\nINT. CELLAR - LATER\n\nLEANNE\nHello.\n'
    )
    expect(t.map((x) => x.heading)).toEqual(['INT. CELLAR - LATER'])
  })
  it('parseLayout recovers a pre-heading excerpt as a synthetic leading scene', () => {
    const L = (text: string, x: number): LayoutLine => ({ text, x, y: 0, page: 1 })
    const s = parseLayout([
      L('ANGELA', 245), L('You have a call at 11.', 173),
      L('TOMMY', 245), L('Cancel it.', 173),
      L('ANGELA', 245), L('Yes sir.', 173),
      L('Tommy walks off set.', 108),
      L('INT. OFFICE - DAY', 108),
      L('Race tidies his desk.', 108)
    ])
    expect(s.map((x) => x.heading)).toEqual(['SCENE 1', 'INT. OFFICE - DAY'])
    expect(s[0].characters).toEqual(['ANGELA', 'TOMMY'])
    expect(s[0].lines).toHaveLength(3)
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

describe('parseColonDialogue (inline "MOM: line" commercials)', () => {
  it('recovers dialogue from inline colon cues, ignoring directions', () => {
    const s = parseColonDialogue(
      'OPEN ON A FAMILY AT A LOOKOUT.\nSFX: Ambient noise.\nMOM: Nature. This is so good.\nDAD: So good.\nCUT TO: THE CAR.\nSAM: What is good, fam?\n'
    )
    expect(s).toHaveLength(1)
    expect(s[0].characters).toEqual(['MOM', 'DAD', 'SAM']) // not SFX (a label) or CUT TO (a transition)
  })
  it('needs a real exchange — a lone colon label is not a scene', () => {
    expect(parseColonDialogue('NOTE: remember to buy milk.\nJust some ordinary prose here.')).toEqual([])
  })
  it('keeps real scene headings when recovering colon dialogue', () => {
    const s = parseColonDialogue(
      'INT. SMALL CONFERENCE ROOM – THURSDAY EVENING\n\nLIAM: You must really love this place, huh?\nCHLOE: I loathe rush-hour. And this place ain’t so bad.\n'
    )
    expect(s.map((x) => x.heading)).toEqual(['INT. SMALL CONFERENCE ROOM – THURSDAY EVENING'])
    expect(s[0].characters).toEqual(['LIAM', 'CHLOE'])
    expect(s[0].lines).toHaveLength(2)
  })
  it('accepts mixed-case colon cues only when the name recurs', () => {
    const s = parseColonDialogue(
      'EXT. PARKING LOT - NIGHT\n\nBrunette: Where am I? Who are you?\nMan: Me? I am the man that’s going to kill you.\nBrunette: You’re going to kill me? Holy shit.\nMan: You’re not afraid?\n'
    )
    expect(s).toHaveLength(1)
    expect(s[0].characters).toEqual(['BRUNETTE', 'MAN'])
    // one-off mixed-case "Label: text" prose lines are not speakers
    expect(
      parseColonDialogue('Warning: do not open the hatch.\nRemember: the code is 4-4-2.\nOrdinary prose follows here.\n')
    ).toEqual([])
  })
})
