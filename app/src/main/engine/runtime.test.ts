import { describe, it, expect } from 'vitest'
import { sceneWordCount, estimateSeconds } from './runtime'

describe('runtime', () => {
  it('counts words', () => {
    expect(sceneWordCount([['A', 'one two three'], ['B', 'four five']])).toBe(5)
  })
  it('estimates seconds at 130 wpm', () => {
    expect(estimateSeconds(130)).toBe(60)
    expect(estimateSeconds(0)).toBe(0)
  })
})
