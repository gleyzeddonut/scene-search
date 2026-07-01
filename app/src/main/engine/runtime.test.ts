import { describe, it, expect } from 'vitest'
import { sceneWordCount, estimateSeconds, estimateScene, longestSpeech, sceneMonologue } from './runtime'
import type { SceneBlock } from './types'
const words = (n: number) => Array.from({ length: n }, (_, i) => 'w' + i).join(' ')

describe('runtime', () => {
  it('counts words', () => {
    expect(sceneWordCount([['A', 'one two three'], ['B', 'four five']])).toBe(5)
  })
  it('estimates seconds at 130 wpm', () => {
    expect(estimateSeconds(130)).toBe(60)
    expect(estimateSeconds(0)).toBe(0)
  })
  it('estimateScene uses dialogue, falling back to action when there is none', () => {
    const dlg: [string, string][] = [['A', 'one two three four']]
    const blocks: SceneBlock[] = [
      { type: 'cue', who: 'A', text: 'one two three four' },
      { type: 'action', text: 'ten more action words here that should not be counted' }
    ]
    // has dialogue → counts only the 4 dialogue words (action ignored)
    expect(estimateScene(dlg, blocks)).toBe(estimateSeconds(4))
    // action-only scene → estimate from the action, NOT 0
    const actionOnly: SceneBlock[] = [{ type: 'action', text: 'one two three four five six' }]
    expect(estimateScene([], actionOnly)).toBe(estimateSeconds(6))
    expect(estimateScene([], actionOnly)).toBeGreaterThan(0)
  })
  it('a one-word line does not read 0:00 when the scene has action', () => {
    // "Molly?" is 1 word → estimateSeconds(1) rounds to 0; the action must rescue it
    const oneWord: [string, string][] = [['A', 'Molly?']]
    const blocks: SceneBlock[] = [
      { type: 'action', text: 'The light dimly flashes as she pushes the heavy door open and steps inside' },
      { type: 'cue', who: 'A', text: 'Molly?' }
    ]
    expect(estimateSeconds(1)).toBe(0) // confirm the rounding that caused the bug
    expect(estimateScene(oneWord, blocks)).toBeGreaterThan(0) // rescued by the full content
  })
  it('longestSpeech: biggest single-character speech; tiny interjections pass', () => {
    const b: SceneBlock[] = [
      { type: 'cue', who: 'A', text: 'one two three four five six seven' }, // 7
      { type: 'action', text: 'a beat' }, // action within a speech is fine
      { type: 'cue', who: 'B', text: 'Go on.' }, // 2-word interjection → passes
      { type: 'cue', who: 'A', text: 'eight nine ten' }, // +3 → A run = 10
      { type: 'cue', who: 'B', text: 'a much longer reply here that keeps going' } // >3 → new run
    ]
    expect(longestSpeech(b)).toEqual({ who: 'A', words: 10 })
  })
  it('longestSpeech: a substantial interruption breaks the run', () => {
    const b: SceneBlock[] = [
      { type: 'cue', who: 'A', text: 'one two three' },
      { type: 'cue', who: 'B', text: 'this is a real interruption line' }, // 6 words > 3 → breaks
      { type: 'cue', who: 'A', text: 'four five' }
    ]
    expect(longestSpeech(b)).toEqual({ who: 'B', words: 6 }) // A's runs are 3 & 2; B's line wins
  })
  it('sceneMonologue: one voice carrying the scene qualifies', () => {
    const b: SceneBlock[] = [
      { type: 'cue', who: 'A', text: words(70) }, // ~32s
      { type: 'cue', who: 'B', text: 'I see what you mean there' } // one real reply is allowed
    ]
    expect(sceneMonologue(b)).toEqual({ who: 'A', seconds: estimateSeconds(70) })
  })
  it('sceneMonologue: a back-and-forth conversation does not (Breakup Season case)', () => {
    const b: SceneBlock[] = [
      { type: 'cue', who: 'A', text: words(70) }, // still the longest turn
      { type: 'cue', who: 'B', text: 'that is one real line here' },
      { type: 'cue', who: 'C', text: 'and here is another real line' },
      { type: 'cue', who: 'B', text: 'plus a third substantial reply now' }
    ]
    expect(sceneMonologue(b)).toBeNull() // 3 substantial replies → a conversation, not a monologue
  })
  it('sceneMonologue: too short is not a monologue', () => {
    expect(sceneMonologue([{ type: 'cue', who: 'A', text: words(20) }])).toBeNull()
  })
})
