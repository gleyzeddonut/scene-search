import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractPaginated } from './extract'

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
