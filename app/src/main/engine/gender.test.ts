import { describe, it, expect } from 'vitest'
import { guessGender, scenePairing } from './gender'

describe('gender', () => {
  it('reads the names table', () => {
    expect(guessGender('JOHN')).toBe('male')
    expect(guessGender('MARY')).toBe('female')
  })
  it('falls back to role words', () => {
    expect(guessGender('WAITRESS')).toBe('female')
    expect(guessGender('OLD MAN')).toBe('male')
  })
  it('skips leading titles to read the given name', () => {
    expect(guessGender('DR. DAVID DELUCA')).toBe('male')
    expect(guessGender('DR. GRANT LEVI')).toBe('male')
    expect(guessGender('SGT. MARIA LOPEZ')).toBe('female')
    expect(guessGender('MR. SMITH')).toBe('male') // gendered title still backstops a non-name
  })
  it('still resolves a bare title-word cue the names table covers', () => {
    // these are in the names table; the title-skip must not drop them to unknown
    expect(guessGender('DOCTOR')).toBe('male')
    expect(guessGender('NANA')).toBe('female')
    expect(guessGender('CAPTAIN')).toBe('male')
    expect(guessGender('JUDGE')).toBe('male')
  })
  it('unknown when no signal', () => {
    expect(guessGender('ZZQX')).toBe('unknown')
    expect(guessGender('DR. WHO')).toBe('unknown') // "WHO" isn't a name and "DR" carries no gender
  })
  it('pairs two-person scenes', () => {
    expect(scenePairing(['JOHN', 'MARY'])).toBe('MW')
    expect(scenePairing(['JOHN', 'MIKE'])).toBe('MM')
    expect(scenePairing(['MARY', 'EVE'])).toBe('WW')
    expect(scenePairing(['JOHN', 'ZZQX'])).toBe('has_unknown') // one known, one unknown
    expect(scenePairing(['JOHN'])).toBe(null)
    expect(scenePairing(['JOHN', 'MIKE', 'MARY'])).toBe(null) // mixed 3-hander, no clean pairing
  })
  it('ignores unknown-gender characters when pairing (M+M+U counts as M+M)', () => {
    expect(scenePairing(['JOHN', 'MIKE', 'ZZQX'])).toBe('MM') // two men + one unknown → M+M
    expect(scenePairing(['MARY', 'EVE', 'ZZQX'])).toBe('WW')
    expect(scenePairing(['JOHN', 'MARY', 'ZZQX'])).toBe('MW')
    expect(scenePairing(['ZZQX', 'QXZZ'])).toBe('has_unknown') // both unknown
  })
})
