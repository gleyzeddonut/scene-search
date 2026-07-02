import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Settings, saveIndex, loadIndex } from './store'

describe('store', () => {
  it('roots are null until set, then persist', () => {
    const d = mkdtempSync(join(tmpdir(), 'st-'))
    const s = new Settings(join(d, 'settings.json'))
    expect(s.getRoots()).toBe(null)
    s.setRoots(['/a', '/b'])
    expect(new Settings(join(d, 'settings.json')).getRoots()).toEqual(['/a', '/b'])
  })
  it('scalar prefs default when unset, persist, and survive junk values', () => {
    const d = mkdtempSync(join(tmpdir(), 'st-'))
    const p = join(d, 'settings.json')
    const s = new Settings(p)
    expect(s.getNum('monologueMin', 45)).toBe(45)
    expect(s.getBool('autoDownload', true)).toBe(true)
    s.setNum('monologueMin', 60)
    s.setBool('autoDownload', false)
    const re = new Settings(p)
    expect(re.getNum('monologueMin', 45)).toBe(60)
    expect(re.getBool('autoDownload', true)).toBe(false)
    // a hand-edited/corrupt value falls back to the default
    s.setNum('monologueMin', NaN)
    expect(new Settings(p).getNum('monologueMin', 45)).toBe(45)
  })
  it('index round-trips', () => {
    const d = mkdtempSync(join(tmpdir(), 'st-'))
    expect(loadIndex(d)).toBe(null)
    saveIndex(d, { scripts: [{ path: '/a', name: 'a', mtime: 1, sceneCount: 1, pinned: false }], scenes: [] })
    expect(loadIndex(d)!.scripts[0].name).toBe('a')
  })
})
