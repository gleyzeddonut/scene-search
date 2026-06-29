import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Library, canonicalKey } from './library'

const fixture = (n: string) => fileURLToPath(new URL(`./__fixtures__/${n}`, import.meta.url))

const FDX_DOC =
  '<?xml version="1.0"?><FinalDraft><Content>' +
  '<Paragraph Type="Scene Heading"><Text>EXT. PARK - DAY</Text></Paragraph>' +
  '<Paragraph Type="Character"><Text>SAM</Text></Paragraph>' +
  '<Paragraph Type="Dialogue"><Text>Over here.</Text></Paragraph>' +
  '</Content></FinalDraft>'

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
    writeFileSync(join(d, 'bad.txt'), SCRIPT) // .txt routes through _extract, which we make throw
    const lib = new Library()
    ;(lib as any)._extract = async (p: string) => {
      if (p.endsWith('bad.txt')) throw new Error('boom')
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

// Every format indexed together — each routed to the right parser, no interference.
describe('format dispatch', () => {
  it('parses fountain, fdx, txt, pdf and docx side by side', async () => {
    const d = tmp()
    writeFileSync(join(d, 'a.fountain'), 'INT. DINER - DAY\n\nNEIL\nCoffee.\n')
    writeFileSync(join(d, 'b.txt'), 'INT. OFFICE - DAY\n\nBOSS\nSit.\n')
    writeFileSync(join(d, 'c.fdx'), FDX_DOC)
    copyFileSync(fixture('scene.pdf'), join(d, 'd.pdf'))
    copyFileSync(fixture('scene.docx'), join(d, 'e.docx'))

    const lib = new Library()
    await lib.reindex([d])
    expect(lib.scriptCount()).toBe(5)

    const rows = lib.query({})
    const headingOf = (name: string) => rows.find((r) => r.script_name === name)?.heading
    expect(headingOf('a.fountain')).toBe('INT. DINER - DAY')
    expect(headingOf('b.txt')).toBe('INT. OFFICE - DAY')
    expect(headingOf('c.fdx')).toBe('EXT. PARK - DAY')
    expect(headingOf('d.pdf')).toContain('WHEELHOUSE')
    expect(headingOf('e.docx')).toContain('OFFICE')

    // characters didn't bleed between files
    const cuesOf = (name: string) => {
      const r = rows.find((x) => x.script_name === name)!
      return lib.getScene(r.script_path, r.scene_index)!.characters.map((c) => c.name)
    }
    expect(cuesOf('a.fountain')).toEqual(['NEIL'])
    expect(cuesOf('c.fdx')).toEqual(['SAM'])
  })

  it('empty/garbage files of every format yield 0 scenes without crashing', async () => {
    const d = tmp()
    for (const ext of ['fountain', 'fdx', 'txt']) writeFileSync(join(d, `junk.${ext}`), 'not a script at all')
    writeFileSync(join(d, 'empty.fountain'), '')
    const lib = new Library()
    await lib.reindex([d])
    expect(lib.sceneCount()).toBe(0)
    expect(lib.scriptCount()).toBe(0)
  })
})
