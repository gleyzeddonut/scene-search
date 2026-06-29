import { describe, it, expect } from 'vitest'
import { parseFdx, parseFountain } from './formats'

const FDX = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. DINER - DAY</Text></Paragraph>
    <Paragraph Type="Action"><Text>A man sits.</Text></Paragraph>
    <Paragraph Type="Character"><Text>NEIL</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>(tired)</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Coffee.</Text></Paragraph>
    <Paragraph Type="Character"><Text>EADY</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Sure.</Text></Paragraph>
    <Paragraph Type="Scene Heading"><Text>EXT. STREET - NIGHT</Text></Paragraph>
    <Paragraph Type="Character"><Text>VINCE</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Hi.</Text></Paragraph>
  </Content>
</FinalDraft>`

describe('parseFdx', () => {
  it('builds scenes from typed paragraphs', () => {
    const s = parseFdx(FDX)
    expect(s.map((x) => x.heading)).toEqual(['INT. DINER - DAY', 'EXT. STREET - NIGHT'])
    expect(s[0].characters).toEqual(['NEIL', 'EADY'])
    expect(s[0].lines).toEqual([['NEIL', 'Coffee.'], ['EADY', 'Sure.']])
    expect(s[0].blocks[0]).toEqual({ type: 'action', text: 'A man sits.' })
    expect(s[1].lines).toEqual([['VINCE', 'Hi.']])
  })
})

const FOUNTAIN = `INT. DINER - DAY

A man sits.

NEIL
Coffee.

EADY
Sure.

EXT. STREET - NIGHT

VINCE
Hi.
`

describe('parseFountain', () => {
  it('parses standard fountain', () => {
    const s = parseFountain(FOUNTAIN)
    expect(s.map((x) => x.heading)).toEqual(['INT. DINER - DAY', 'EXT. STREET - NIGHT'])
    expect(s[0].characters).toEqual(['NEIL', 'EADY'])
    expect(s[0].lines).toEqual([['NEIL', 'Coffee.'], ['EADY', 'Sure.']])
  })
  it('handles forced headings (.) and characters (@)', () => {
    const s = parseFountain('.FLASHBACK\n\n@nora\nHello.\n')
    expect(s[0].heading).toBe('FLASHBACK')
    expect(s[0].characters).toEqual(['NORA'])
    expect(s[0].lines).toEqual([['NORA', 'Hello.']])
  })
})
