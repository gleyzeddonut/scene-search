import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractPaginated, isRepeatWatermark, cleanLayout } from './extract'
import type { LayoutLine } from './types'

const d = mkdtempSync(join(tmpdir(), 'scripty-'))

describe('extract', () => {
  it('reads plaintext / fountain', async () => {
    const p = join(d, 'a.fountain')
    writeFileSync(p, 'INT. ROOM - DAY\n\nBOB\nHi.\n')
    expect(await extractPaginated(p)).toContain('INT. ROOM')
  })
  it('reads fdx Text nodes', async () => {
    const p = join(d, 'a.fdx')
    writeFileSync(
      p,
      '<?xml version="1.0"?><FinalDraft><Content>' +
        '<Paragraph Type="Scene Heading"><Text>INT. OFFICE - DAY</Text></Paragraph>' +
        '<Paragraph Type="Character"><Text>MICHAEL</Text></Paragraph>' +
        '<Paragraph Type="Dialogue"><Text>Sit.</Text></Paragraph>' +
        '</Content></FinalDraft>'
    )
    const t = await extractPaginated(p)
    expect(t).toContain('INT. OFFICE - DAY')
    expect(t).toContain('MICHAEL')
  })
  it('throws for unsupported extension', async () => {
    const p = join(d, 'a.xyz')
    writeFileSync(p, 'nope')
    await expect(extractPaginated(p)).rejects.toThrow()
  })
})

describe('isRepeatWatermark', () => {
  it('flags a tiled actor-ID / date stamp', () => {
    expect(
      isRepeatWatermark(
        'AM - 827559 - Jan 10, 2026 10:45 AM - 827559 - Jan 10, 2026 10:45 AM - 827559 - Jan 10, 2026 10:45 AM'
      )
    ).toBe(true)
    expect(isRepeatWatermark('ESSICA ALBANO-JESSICA ALBANO-JESSICA ALBANO-JESSICA A')).toBe(true)
  })
  it('leaves real prose alone', () => {
    expect(isRepeatWatermark('Look I’m just gonna be straight with you. This is a nice event.')).toBe(false)
    expect(isRepeatWatermark('No no no please stop')).toBe(false) // short + emphatic, not a stamp
    expect(isRepeatWatermark('INT. BOUTIQUE - NIGHT')).toBe(false)
  })
  it('does not flag emphatic sentence-case dialogue that repeats a word', () => {
    // these repeat a 4+ letter word but read as prose (lowercase, no digits) → kept
    expect(isRepeatWatermark('Stop lying. Stop lying. Stop lying to me right now please!')).toBe(false)
    expect(isRepeatWatermark("Please stop stop stop stop, you're really hurting me badly.")).toBe(false)
  })
})

describe('cleanLayout', () => {
  const L = (text: string, x: number, page: number): LayoutLine => ({ text, x, page })

  it('captures a BEGIN-SCENE delimiter as a heading when no slug is present', () => {
    const out = cleanLayout([L('BEGIN SCENE 1:', 25, 1), L('NICOLE', 250, 1), L('Hey everyone.', 180, 1)])
    expect(out[0].text).toBe('SCENE 1')
  })

  it('de-glues an END-SCENE marker fused onto a character cue', () => {
    const out = cleanLayout([L('MOIRAEND SCENE 1', 250, 1)])
    expect(out.map((l) => l.text)).toEqual(['MOIRA'])
  })

  it('does not treat "begin/end scene N" embedded in prose as a marker', () => {
    const out = cleanLayout([
      L('They begin scene 3 of the play-within-a-play.', 108, 1),
      L('We end scene 4 and break for lunch.', 108, 1)
    ])
    // prose on both sides of the phrase → left untouched, no synthetic heading
    expect(out.map((l) => l.text)).toEqual([
      'They begin scene 3 of the play-within-a-play.',
      'We end scene 4 and break for lunch.'
    ])
  })

  it('drops a BEGIN-SCENE marker that is redundant next to a real slug', () => {
    const out = cleanLayout([
      L('INT. BOUTIQUE - NIGHT', 108, 3),
      L('JENNY', 252, 3),
      L('BEGIN SCENE 2', 35, 3),
      L('Look I’m just gonna be straight', 180, 3)
    ])
    expect(out.map((l) => l.text)).toEqual([
      'INT. BOUTIQUE - NIGHT',
      'JENNY',
      'Look I’m just gonna be straight'
    ])
  })

  it('strips the Actors Access / Breakdown Services sides footer (even when glued)', () => {
    const out = cleanLayout([
      L('SHANE', 252, 1),
      L('Pooping. Sides by Breakdown Services - Actors Access 1/6', 180, 1),
      L('4 SCENES Sides by Breakdown Services - Actors Access', 30, 1)
    ])
    // footer text removed from every line; the residual "4 SCENES" is harmless
    // (the parser's non-cue guard keeps it out of the character list)
    expect(out.map((l) => l.text)).toEqual(['SHANE', 'Pooping.', '4 SCENES'])
  })

  it('removes gutter/page numbers and repeated running headers', () => {
    const header = 'Tires - Ep. 303 - White Production Draft - 12.19.25'
    const out = cleanLayout([
      L(header + ' 10.', 110, 2),
      L('JENNY', 252, 2),
      L('17 17', 54, 3),
      L(header + ' 18.', 110, 3),
      L('KILAH', 252, 3),
      L(header + ' 19.', 110, 4),
      L('Real action line here.', 108, 4)
    ])
    const texts = out.map((l) => l.text)
    expect(texts).toEqual(['JENNY', 'KILAH', 'Real action line here.'])
  })

  it('keeps a coincidentally-repeated real line on a short doc, drops only furniture', () => {
    // a recurring line that doesn't read like a production slug must survive (≤3-page
    // docs use a 2-page threshold, so without the furniture gate this would vanish)
    const content = cleanLayout([
      L('I will meet you at 7 tonight, okay', 180, 1),
      L('I will meet you at 7 tonight, okay', 180, 2)
    ])
    expect(content.map((l) => l.text)).toEqual([
      'I will meet you at 7 tonight, okay',
      'I will meet you at 7 tonight, okay'
    ])
    // a real production footer recurring across the same two pages is still removed
    const footer = cleanLayout([
      L('Wedding - Blue Revision - 3/4/25', 110, 1),
      L('NORA', 250, 1),
      L('Wedding - Blue Revision - 3/4/25', 110, 2)
    ])
    expect(footer.map((l) => l.text)).toEqual(['NORA'])
  })

  it('does not promote a BEGIN marker that sits right before the next real slug', () => {
    const out = cleanLayout([
      L('INT. ROOM A - DAY', 108, 1),
      ...Array.from({ length: 8 }, (_, i) => L(`Some action ${i}.`, 108, 1)),
      L('BEGIN SCENE 2', 35, 1), // redundant: INT. ROOM B is its real heading
      L('INT. ROOM B - DAY', 108, 1)
    ])
    expect(out.filter((l) => /^SCENE \d/.test(l.text))).toEqual([]) // no synthetic heading
    expect(out.filter((l) => /^INT\./.test(l.text)).map((l) => l.text)).toEqual([
      'INT. ROOM A - DAY',
      'INT. ROOM B - DAY'
    ])
  })

  it('leaves a real line that merely mentions the casting platform intact', () => {
    const out = cleanLayout([L("You still don't have Actors Access yet?", 180, 1)])
    expect(out.map((l) => l.text)).toEqual(["You still don't have Actors Access yet?"])
  })
})
