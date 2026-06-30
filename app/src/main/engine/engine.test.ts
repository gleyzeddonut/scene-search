import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Engine reads app.getPath('userData'); point it at a per-test temp dir.
const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }))

import { Engine } from './engine'
import { PARSER_VERSION } from './parser'

const SCRIPT = 'INT. DINER - DAY\n\nNEIL\nCoffee.\n\nEADY\nSure.\n'

// seed a persisted index built by parser version `v`, return its dir
function seed(v: number): string {
  h.userData = mkdtempSync(join(tmpdir(), 'scripty-ud-'))
  const dir = join(h.userData, 'scripty')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ parserVersion: v, scripts: [], scenes: [] }))
  return dir
}

describe('Engine.add parser-version stamp', () => {
  // bug: a drag-add used to stamp the index "current" even while it was stale,
  // silently cancelling a pending parser upgrade on the next launch
  it('keeps a stale (old-parser) index marked stale when a file is added', async () => {
    const dir = seed(0) // 0 !== PARSER_VERSION → Engine computes stale = true
    const eng = new Engine()
    const f = join(h.userData, 'new.fountain'); writeFileSync(f, SCRIPT)
    expect((await eng.add(f)).result).toBe('added')
    const saved = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf-8'))
    expect(saved.parserVersion).toBe(0) // NOT bumped → the upgrade still happens next launch
  })

  it('stamps the current version when the index is already current', async () => {
    const dir = seed(PARSER_VERSION)
    const eng = new Engine()
    const f = join(h.userData, 'new.fountain'); writeFileSync(f, SCRIPT)
    expect((await eng.add(f)).result).toBe('added')
    const saved = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf-8'))
    expect(saved.parserVersion).toBe(PARSER_VERSION)
  })
})

describe('Engine medium', () => {
  it('auto-tags a clearly-named commercial, leaves a feature untagged, and honors override', async () => {
    seed(PARSER_VERSION)
    const eng = new Engine()
    const com = join(h.userData, 'Acme_Commercial_Sides.fountain')
    const film = join(h.userData, 'feature.fountain')
    writeFileSync(com, 'INT. KITCHEN - DAY\n\nMOM\nTry Acme.\n\nKID\nYum!\n')
    writeFileSync(film, 'INT. OFFICE - DAY\n\nBOSS\nI took a commercial flight.\n\nWORKER\nOk.\n')
    await eng.add(com)
    await eng.add(film)
    // named commercial → guessed Commercial; the feature's prose "commercial" → untagged
    expect(eng.scenes({ mediums: ['Commercial'] }).scenes.every((s) => s.script_path === com)).toBe(true)
    expect(eng.scenes({ mediums: ['Commercial'] }).scenes.length).toBeGreaterThan(0)
    expect(eng.getMeta(film).medium).toBe('') // untagged
    // a ":30 COMMERCIAL" timing label (space before the colon) is also detected
    const spot = join(h.userData, 'spot.fountain')
    writeFileSync(spot, 'INT. KITCHEN - DAY\n\nANNCR\nThis is a :30 COMMERCIAL for soap.\n\nVO\nBuy now.\n')
    await eng.add(spot)
    expect(eng.getMeta(spot).medium).toBe('Commercial')
    // a manual override puts the feature under Film
    eng.setMeta(film, { genres: [], genders: {}, medium: 'Film' })
    expect(eng.getMeta(film).medium).toBe('Film')
    expect(eng.scenes({ mediums: ['Film'] }).scenes.every((s) => s.script_path === film)).toBe(true)
  })
})

describe('Engine medium clear + rename re-guess', () => {
  it('lets None clear an auto-guessed Commercial (sentinel suppresses the guess)', async () => {
    seed(PARSER_VERSION)
    const eng = new Engine()
    const f = join(h.userData, 'Acme_Commercial_Sides.fountain')
    writeFileSync(f, 'INT. SET - DAY\n\nMOM\nTry Acme.\n\nKID\nYum!\n')
    await eng.add(f)
    expect(eng.getMeta(f).medium).toBe('Commercial') // auto-guessed
    eng.setMedium(f, '') // user picks None
    expect(eng.getMeta(f).medium).toBe('') // stays cleared, doesn't revert to the guess
    expect(eng.scenes({ mediums: ['Commercial'] }).scenes.length).toBe(0) // gone from the filter
  })

  it('re-guesses the medium for the new filename on rename', async () => {
    seed(PARSER_VERSION)
    const eng = new Engine()
    const d = mkdtempSync(join(tmpdir(), 'rn-'))
    const f = join(d, 'Wawa Commercial Sides.fountain')
    writeFileSync(f, 'INT. STORE - DAY\n\nCLERK\nHi.\n\nCUST\nHello.\n')
    await eng.add(f)
    expect(eng.getMeta(f).medium).toBe('Commercial') // from the filename
    const r = await eng.rename(f, 'Wawa Sides') // drop "Commercial" from the name
    expect(r.ok).toBe(true)
    expect(eng.getMeta(r.path!).medium).toBe('') // no longer guessed Commercial
  })
})

describe('Engine remove + re-add', () => {
  it('removes a script and lets the same file be added again', async () => {
    seed(PARSER_VERSION)
    const eng = new Engine()
    const f = join(h.userData, 'r.fountain')
    writeFileSync(f, 'INT. ROOM - DAY\n\nBOB\nHi.\n\nAMY\nYo.\n')
    expect((await eng.add(f)).result).toBe('added')
    expect(eng.scenes({}).scenes.length).toBe(1)
    eng.removeScript(f)
    expect(eng.scenes({}).scenes.length).toBe(0) // gone
    // manually adding the same file again brings it back (re-add un-hides it)
    expect((await eng.add(f)).result).toBe('added')
    expect(eng.scenes({}).scenes.length).toBe(1)
  })
})

describe('Engine partial meta setters', () => {
  it('setGenres and setMedium each preserve the other field', async () => {
    seed(PARSER_VERSION)
    const eng = new Engine()
    const f = join(h.userData, 'a.fountain'); writeFileSync(f, 'INT. ROOM - DAY\n\nJOHN\nHi.\n\nMARY\nYo.\n')
    await eng.add(f)
    // set a gender override + genre, then change medium inline — others must survive
    eng.setMeta(f, { genres: ['Drama'], genders: { JOHN: 'female' } })
    eng.setMedium(f, 'Film')
    expect(eng.getMeta(f).genres).toEqual(['Drama']) // genre kept
    expect(eng.getMeta(f).medium).toBe('Film')
    // now change genres inline — medium + gender override must survive
    eng.setGenres(f, ['Comedy', 'Crime'])
    expect(eng.getMeta(f).genres).toEqual(['Comedy', 'Crime'])
    expect(eng.getMeta(f).medium).toBe('Film')
    expect(eng.scene(f, eng.scenes({}).scenes[0].scene_index).characters.find((c) => c.name === 'JOHN')?.gender).toBe('female')
  })
})

describe('Engine.setMeta', () => {
  it('persists only gender overrides that differ from the guess', async () => {
    seed(PARSER_VERSION)
    const eng = new Engine()
    const f = join(h.userData, 'a.fountain'); writeFileSync(f, 'INT. ROOM - DAY\n\nJOHN\nHi.\n\nMARY\nYo.\n')
    await eng.add(f)
    const metaFile = join(h.userData, 'scripty', 'meta.json')
    // saving the guessed genders (JOHN→male, MARY→female) must store nothing
    eng.setMeta(f, { genres: [], genders: { JOHN: 'male', MARY: 'female' } })
    expect(JSON.parse(readFileSync(metaFile, 'utf-8'))[f]).toBeUndefined()
    // a deliberate change stores just that one override
    eng.setMeta(f, { genres: [], genders: { JOHN: 'male', MARY: 'male' } })
    expect(JSON.parse(readFileSync(metaFile, 'utf-8'))[f].genders).toEqual({ MARY: 'male' })
  })
})

describe('Engine.moveAll', () => {
  it('keeps two same-named scripts both visible after consolidating (no copy-fold)', async () => {
    seed(PARSER_VERSION)
    const eng = new Engine()
    const A = mkdtempSync(join(tmpdir(), 'mvA-'))
    const B = mkdtempSync(join(tmpdir(), 'mvB-'))
    const D = mkdtempSync(join(tmpdir(), 'mvD-'))
    writeFileSync(join(A, 'Sides.fountain'), 'INT. A - DAY\n\nJOHN\nHi.\n')
    writeFileSync(join(B, 'Sides.fountain'), 'INT. B - DAY\n\nMARY\nYo.\n')
    await eng.add(join(A, 'Sides.fountain'))
    await eng.add(join(B, 'Sides.fountain'))
    expect(eng.scenes({}).scenes.length).toBe(2) // both visible before
    expect((await eng.moveAll(D)).moved).toBe(2)
    expect(eng.scenes({}).scenes.length).toBe(2) // and still both after the move
  })

  it('relocates files and carries the index + manual metadata along', async () => {
    seed(PARSER_VERSION)
    const eng = new Engine()
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    const dest = mkdtempSync(join(tmpdir(), 'dest-'))
    const f = join(src, 'show.fountain'); writeFileSync(f, SCRIPT)
    expect((await eng.add(f)).result).toBe('added')
    eng.setMeta(f, { genres: ['Comedy'], genders: { NEIL: 'male' } })

    const r = await eng.moveAll(dest)
    expect(r.moved).toBe(1)

    const moved = join(dest, 'show.fountain')
    expect(existsSync(moved)).toBe(true)
    expect(existsSync(f)).toBe(false)
    // the index now points at the new location
    expect(eng.scenes({}).scenes.every((s) => s.script_path === moved)).toBe(true)
    // and the manual metadata followed the file
    expect(eng.getMeta(moved).genres).toEqual(['Comedy'])
    expect(eng.getMeta(f).genres).toEqual([])
  })
})
