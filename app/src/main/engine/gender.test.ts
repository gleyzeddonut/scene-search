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
  it('unknown when no signal', () => {
    expect(guessGender('ZZQX')).toBe('unknown')
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
