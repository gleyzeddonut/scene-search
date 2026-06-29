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
    expect(scenePairing(['JOHN', 'ZZQX'])).toBe('has_unknown')
    expect(scenePairing(['JOHN'])).toBe(null)
    expect(scenePairing(['A', 'B', 'C'])).toBe(null)
  })
})
