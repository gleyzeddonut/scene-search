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
  it('query uses the gender resolver so manual overrides drive pairing', async () => {
    const d = tmp(); writeFileSync(join(d, 'a.fountain'), 'INT. ROOM - DAY\n\nALEX\nHi.\n\nSAM\nYo.\n')
    const lib = new Library(); await lib.reindex([d])
    // force ALEX→female, SAM→male, so the (ambiguous) scene becomes a W+M duet
    const genderOf = (_p: string, n: string) => (n === 'ALEX' ? 'female' : 'male')
    const mw = lib.query({ pairing: 'MW' }, genderOf)
    expect(mw.length).toBe(1)
    expect(mw[0].pairing).toBe('MW')
    expect(lib.query({ pairing: 'WW' }, genderOf).length).toBe(0) // not two women
  })

  it('renamePath moves a script and its scenes to the new path in place', async () => {
    const d = tmp(); const f = join(d, 'old.fountain'); writeFileSync(f, SCRIPT)
    const lib = new Library(); await lib.reindex([d])
    const oldPath = lib.query({})[0].script_path
    const idx = lib.query({})[0].scene_index
    const newPath = join(d, 'new.fountain')
    lib.renamePath(oldPath, newPath)
    const rows = lib.query({})
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.script_name === 'new.fountain' && r.script_path === newPath)).toBe(true)
    expect(lib.getScene(newPath, idx)).not.toBeNull() // scene data preserved at the new path
    expect(lib.getScene(oldPath, idx)).toBeNull() // and gone from the old one
  })

  it('canonicalKey strips copy suffixes', () => {
    expect(canonicalKey('Heat (1).pdf')).toBe('heat.pdf')
    expect(canonicalKey('Heat copy.pdf')).toBe('heat.pdf')
  })

  // bug_003 regression: a forced rebuild must not silently unpin a dragged-in
  // script, or the later orphan-cleanup pass would delete it
  it('force rebuild preserves a pinned script through orphan cleanup', async () => {
    const d = tmp(); const f = join(d, 'kept.fountain'); writeFileSync(f, SCRIPT)
    const lib = new Library()
    expect(await lib.addFile(f)).toBe('added') // pins it
    await lib.reindex([d], { force: true })    // re-parses every file (used to drop the pin)
    await lib.reindex([])                       // f no longer in any folder → orphan sweep
    expect(lib.scriptCount()).toBe(1)           // survives only because the pin was kept
  })

  // a parser upgrade must reach files already indexed by the old parser — those
  // files' mtimes don't change, so a normal reindex skips them and only force re-parses
  it('force re-parses unchanged files; a normal reindex skips them', async () => {
    const d = tmp(); const f = join(d, 'a.txt'); writeFileSync(f, SCRIPT)
    const lib = new Library()
    // pretend the "old parser" found one scene
    ;(lib as any)._extract = async () => 'INT. ONE - DAY\n\nA\nHi.\n'
    await lib.reindex([d])
    expect(lib.sceneCount()).toBe(1)

    // "new parser" would find two — but the file on disk is untouched (same mtime)
    ;(lib as any)._extract = async () => 'INT. ONE - DAY\n\nA\nHi.\n\nINT. TWO - DAY\n\nB\nYo.\n'
    await lib.reindex([d]) // incremental: mtime unchanged → skipped
    expect(lib.sceneCount()).toBe(1)

    await lib.reindex([d], { force: true }) // force: re-parse regardless of mtime
    expect(lib.sceneCount()).toBe(2)
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
