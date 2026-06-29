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

describe('Engine.moveAll', () => {
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
