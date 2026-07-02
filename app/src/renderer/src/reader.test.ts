import { describe, it, expect, vi } from 'vitest'
import { ReaderEngine, ManualGate, readerLines, rankVoices } from './reader'
import type { ReaderLine, ReaderState, Speaker } from './reader'
import type { SceneBlock } from './api'

// a Speaker whose speak() resolves when the test says so — lets tests hold the
// engine mid-line and observe every state transition
function fakeSpeaker() {
  const spoken: string[] = []
  let release: (() => void) | null = null
  const speaker: Speaker = {
    speak(line: ReaderLine) {
      spoken.push(line.who + ':' + line.text)
      return new Promise<void>((r) => (release = r))
    },
    cancel: vi.fn(() => release?.())
  }
  return { speaker, spoken, finishLine: () => release?.() }
}

const BLOCKS: SceneBlock[] = [
  { type: 'action', text: 'A diner at night.' },
  { type: 'cue', who: 'EADY', text: 'Coffee?' },
  { type: 'cue', who: 'NEIL', text: 'Sure. Thanks.' },
  { type: 'action', text: 'She pours.' },
  { type: 'cue', who: 'EADY', text: 'Long day?' },
  { type: 'cue', who: 'NEIL', text: 'The longest.' }
]

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('readerLines', () => {
  it('keeps only dialogue, marking my lines, with block indexes for highlighting', () => {
    const lines = readerLines(BLOCKS, 'NEIL')
    expect(lines).toEqual([
      { index: 1, who: 'EADY', text: 'Coffee?', mine: false },
      { index: 2, who: 'NEIL', text: 'Sure. Thanks.', mine: true },
      { index: 4, who: 'EADY', text: 'Long day?', mine: false },
      { index: 5, who: 'NEIL', text: 'The longest.', mine: true }
    ])
  })
})

describe('rankVoices', () => {
  const v = (name: string, lang = 'en-US', localService = true) =>
    ({ name, lang, localService }) as SpeechSynthesisVoice
  it('prefers Premium/Enhanced, then known-good voices, and never novelty ones', () => {
    const ranked = rankVoices([
      v('Albert'), // novelty — the "insane" robot voice
      v('Zarvox'),
      v('Bubbles'),
      v('Samantha'), // stock quality voice
      v('Tom'),
      v('Ava (Premium)'), // downloaded premium — best available
      v('Zoe (Enhanced)'),
      v('Amélie', 'fr-CA') // wrong language
    ])
    expect(ranked.map((x) => x.name)).toEqual(['Ava (Premium)', 'Zoe (Enhanced)', 'Samantha', 'Tom'])
  })
  it('falls back to non-novelty English voices when nothing is whitelisted', () => {
    const ranked = rankVoices([v('Albert'), v('Whisper'), v('SomeNewVoice')])
    expect(ranked.map((x) => x.name)).toEqual(['SomeNewVoice'])
  })
})

describe('ReaderEngine', () => {
  it('speaks partner lines, waits at mine, and finishes', async () => {
    const { speaker, spoken, finishLine } = fakeSpeaker()
    const gate = new ManualGate()
    const states: ReaderState[] = []
    const eng = new ReaderEngine(readerLines(BLOCKS, 'NEIL'), speaker, gate, (s) => states.push(s))

    eng.start()
    await flush()
    expect(states.at(-1)).toEqual({ status: 'speaking', index: 1 }) // EADY: Coffee?
    expect(spoken).toEqual(['EADY:Coffee?'])

    finishLine() // EADY finishes → my line
    await flush()
    expect(states.at(-1)).toEqual({ status: 'yourLine', index: 2 })
    expect(spoken).toHaveLength(1) // my line is never spoken

    gate.pass() // I deliver it and advance
    await flush()
    expect(states.at(-1)).toEqual({ status: 'speaking', index: 4 })
    expect(spoken).toEqual(['EADY:Coffee?', 'EADY:Long day?'])

    finishLine()
    await flush()
    expect(states.at(-1)).toEqual({ status: 'yourLine', index: 5 })
    gate.pass()
    await flush()
    expect(states.at(-1)).toEqual({ status: 'done', index: null })
  })

  it('stop() cancels mid-speech and nothing further plays', async () => {
    const { speaker, spoken } = fakeSpeaker()
    const gate = new ManualGate()
    const states: ReaderState[] = []
    const eng = new ReaderEngine(readerLines(BLOCKS, 'NEIL'), speaker, gate, (s) => states.push(s))

    eng.start()
    await flush()
    eng.stop() // while EADY is mid-line
    await flush()
    expect(states.at(-1)).toEqual({ status: 'idle', index: null })
    expect(speaker.cancel).toHaveBeenCalled()
    await flush()
    expect(spoken).toEqual(['EADY:Coffee?']) // no further lines
  })

  it('stop() while waiting on my line returns to idle (a passed gate no longer advances)', async () => {
    const { speaker, spoken, finishLine } = fakeSpeaker()
    const gate = new ManualGate()
    const states: ReaderState[] = []
    const eng = new ReaderEngine(readerLines(BLOCKS, 'NEIL'), speaker, gate, (s) => states.push(s))

    eng.start()
    await flush()
    finishLine()
    await flush()
    expect(states.at(-1)?.status).toBe('yourLine')
    eng.stop()
    gate.pass() // late/stale advance after stop must be a no-op
    await flush()
    expect(states.at(-1)).toEqual({ status: 'idle', index: null })
    expect(spoken).toEqual(['EADY:Coffee?'])
  })

  it('start(from) begins at a given line and restarting is safe', async () => {
    const { speaker, spoken, finishLine } = fakeSpeaker()
    const gate = new ManualGate()
    const states: ReaderState[] = []
    const lines = readerLines(BLOCKS, 'NEIL')
    const eng = new ReaderEngine(lines, speaker, gate, (s) => states.push(s))

    eng.start(2) // from EADY: Long day?
    await flush()
    expect(spoken).toEqual(['EADY:Long day?'])
    eng.start() // restart from the top while speaking
    await flush()
    expect(spoken).toEqual(['EADY:Long day?', 'EADY:Coffee?'])
    finishLine()
    await flush()
    expect(states.at(-1)).toEqual({ status: 'yourLine', index: 2 })
  })

  it('a scene where I speak first waits before anything is spoken', async () => {
    const { speaker, spoken } = fakeSpeaker()
    const gate = new ManualGate()
    const states: ReaderState[] = []
    const eng = new ReaderEngine(readerLines(BLOCKS, 'EADY'), speaker, gate, (s) => states.push(s))
    eng.start()
    await flush()
    expect(states.at(-1)).toEqual({ status: 'yourLine', index: 1 })
    expect(spoken).toEqual([])
  })
})
