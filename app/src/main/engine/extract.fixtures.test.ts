import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { extractPaginated } from './extract'

const fix = (n: string) => fileURLToPath(new URL(`./__fixtures__/${n}`, import.meta.url))

describe('extract real PDF/DOCX in Node', () => {
  it('pdfjs extracts PDF text', async () => {
    const t = await extractPaginated(fix('scene.pdf'))
    expect(t).toContain('INT. WHEELHOUSE')
    expect(t).toContain('NORA')
  })
  it('mammoth extracts DOCX text', async () => {
    const t = await extractPaginated(fix('scene.docx'))
    expect(t).toContain('INT. OFFICE')
    expect(t).toContain('MICHAEL')
  })
})
