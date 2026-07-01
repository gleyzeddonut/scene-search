import { describe, it, expect } from 'vitest'
import { sceneWordCount, estimateSeconds, estimateScene, sceneMonologue } from './runtime'
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
  it('sceneMonologue: one speaker for ≥30s qualifies (action beats are fine)', () => {
    const b: SceneBlock[] = [
      { type: 'cue', who: 'A', text: words(40) },
      { type: 'action', text: 'she paces the room' },
      { type: 'cue', who: 'A', text: words(30) } // same speaker, 70 words total → ~32s
    ]
    expect(sceneMonologue(b)).toEqual({ who: 'A', seconds: estimateSeconds(70) })
  })
  it('sceneMonologue: a second speaker disqualifies it — even a one-word reply', () => {
    const b: SceneBlock[] = [
      { type: 'cue', who: 'A', text: words(70) },
      { type: 'cue', who: 'B', text: 'Okay.' } // any second voice → not a monologue
    ]
    expect(sceneMonologue(b)).toBeNull()
  })
  it('sceneMonologue: one speaker but too short is not a monologue', () => {
    expect(sceneMonologue([{ type: 'cue', who: 'A', text: words(20) }])).toBeNull()
  })
})
