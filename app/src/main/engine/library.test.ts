import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Library, canonicalKey } from './library'

const SCRIPT = 'INT. DINER - DAY\n\nNEIL\nCoffee.\n\nEADY\nSure.\n\nEXT. STREET - NIGHT\n\nVINCE\nHi.\n'
const tmp = () => mkdtempSync(join(tmpdir(), 'lib-'))

describe('Library', () => {
  it('indexes scripts and scenes', async () => {
    const d = tmp(); writeFileSync(join(d, 'a.fountain'), SCRIPT)
    const lib = new Library()
    await lib.reindex([d])
    expect(lib.scriptCount()).toBe(1)
    expect(lib.sceneCount()).toBe(2)
  })
  it('query filters by char count', async () => {
    const d = tmp(); writeFileSync(join(d, 'a.fountain'), SCRIPT)
    const lib = new Library(); await lib.reindex([d])
    const two = lib.query({ minChars: 2, maxChars: 2 })
    expect(two.map((m) => m.heading)).toEqual(['INT. DINER - DAY'])
    expect(two[0].scene_index).toBe(1)
  })
  it('getScene returns content blocks', async () => {
    const d = tmp(); writeFileSync(join(d, 'a.fountain'), 'INT. OFFICE - DAY\n\nMICHAEL\nSit.\n')
    const lib = new Library(); await lib.reindex([d])
    const m = lib.query({ minChars: 1 })[0]
    const s = lib.getScene(m.script_path, m.scene_index)!
    expect(s.lines[0]).toEqual({ who: 'MICHAEL', text: 'Sit.' })
  })
  it('folds re-download copies', async () => {
    const d = tmp()
    writeFileSync(join(d, 'Wedding.fountain'), SCRIPT)
    writeFileSync(join(d, 'Wedding (1).fountain'), SCRIPT)
    const lib = new Library(); await lib.reindex([d])
    expect(lib.scriptCount()).toBe(2)
    const rows = lib.query({ minChars: 1 })
    expect(rows.length).toBe(2)
    expect(rows.every((r) => !r.script_name.includes('(1)'))).toBe(true)
  })
  it('survives one bad file', async () => {
    const d = tmp()
    writeFileSync(join(d, 'good.fountain'), SCRIPT)
    writeFileSync(join(d, 'bad.pdf'), 'x') // pdf routes through _extract, which we make throw
    const lib = new Library()
    ;(lib as any)._extract = async (p: string) => {
      if (p.endsWith('bad.pdf')) throw new Error('boom')
      return SCRIPT
    }
    await lib.reindex([d])
    expect(lib.scriptCount()).toBe(1)
  })
  it('addFile detects duplicates and rejects non-scripts', async () => {
    const d = tmp(); const f = join(d, 'x.fountain'); writeFileSync(f, SCRIPT)
    const lib = new Library()
    expect(await lib.addFile(f)).toBe('added')
    expect(await lib.addFile(f)).toBe('exists')
    const n = join(d, 'note.md'); writeFileSync(n, 'hi')
    expect(await lib.addFile(n)).toBe('not_script')
  })
  it('canonicalKey strips copy suffixes', () => {
    expect(canonicalKey('Heat (1).pdf')).toBe('heat.pdf')
    expect(canonicalKey('Heat copy.pdf')).toBe('heat.pdf')
  })
})
