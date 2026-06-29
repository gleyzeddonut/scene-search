import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Meta } from './meta'

const tmp = () => mkdtempSync(join(tmpdir(), 'meta-'))

describe('Meta', () => {
  it('persists genres + gender overrides and survives a reload', () => {
    const dir = tmp()
    const m = new Meta(dir)
    m.set('/x/a.pdf', { genres: ['Comedy', 'Drama'], genders: { JEN: 'female', DAVE: 'male' } })
    expect(m.genres('/x/a.pdf')).toEqual(['Comedy', 'Drama'])
    expect(m.gender('/x/a.pdf', 'JEN')).toBe('female')
    expect(m.gender('/x/a.pdf', 'NOBODY')).toBeUndefined()
    expect(m.allGenres()).toEqual(['Comedy', 'Drama'])

    // a fresh instance reads the same meta.json from disk
    const m2 = new Meta(dir)
    expect(m2.gender('/x/a.pdf', 'DAVE')).toBe('male')
  })

  it('rename moves a script’s metadata to the new path', () => {
    const m = new Meta(tmp())
    m.set('/x/old.pdf', { genres: ['Thriller'], genders: {} })
    m.rename('/x/old.pdf', '/x/new.pdf')
    expect(m.genres('/x/new.pdf')).toEqual(['Thriller'])
    expect(m.genres('/x/old.pdf')).toEqual([])
  })

  it('clearing all genres + genders drops the entry', () => {
    const m = new Meta(tmp())
    m.set('/x/a.pdf', { genres: ['Comedy'], genders: {} })
    m.set('/x/a.pdf', { genres: [], genders: {} })
    expect(m.get('/x/a.pdf')).toBeUndefined()
    expect(m.allGenres()).toEqual([])
  })
})
