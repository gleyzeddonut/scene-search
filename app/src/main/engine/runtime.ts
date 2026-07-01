import type { SceneBlock } from './types'

const WPM = 130
const wc = (text: string) => text.split(/\s+/).filter(Boolean).length

export function sceneWordCount(lines: [string, string][]): number {
  return lines.reduce((n, [, text]) => n + wc(text), 0)
}

export function estimateSeconds(words: number): number {
  return Math.round((words / WPM) * 60)
}

// Scene runtime estimate: from the spoken dialogue. Falls back to the whole scene's
// word count (dialogue + action) when there's no dialogue OR when the dialogue is so
// short it rounds to 0 seconds (a one-word line like "Damn.") — so a scene with real
// content never reads 0:00.
export function estimateScene(lines: [string, string][], blocks: SceneBlock[]): number {
  const est = estimateSeconds(sceneWordCount(lines))
  if (est > 0) return est
  const words = blocks.reduce((n, b) => n + wc(b.text), 0)
  return words > 0 ? Math.max(1, estimateSeconds(words)) : 0 // any real content → at least 0:01
}

// a scene "has a monologue" when one character speaks uninterrupted for this long
export const MONOLOGUE_MIN_SECONDS = 30
const INTERJECTION_MAX_WORDS = 3 // another character's ≤3-word line ("Go on.") doesn't break it
const MONOLOGUE_MAX_OTHER_LINES = 1 // a monologue is one voice; more real replies = a conversation

// The longest uninterrupted speech by a single character in a scene: their consecutive
// dialogue, where action beats and tiny interjections from others pass through, but a
// substantial line from another character ends the run. Returns the speaker + word count.
export function longestSpeech(blocks: SceneBlock[]): { who: string; words: number } {
  let best = { who: '', words: 0 }
  let curWho = ''
  let curWords = 0
  for (const b of blocks) {
    if (b.type !== 'cue') continue // action within a speech is fine
    const w = wc(b.text)
    if (b.who === curWho) {
      curWords += w
    } else if (curWho && w <= INTERJECTION_MAX_WORDS) {
      continue // tiny interjection from another character — passes without breaking
    } else {
      curWho = b.who
      curWords = w
    }
    if (curWords > best.words) best = { who: curWho, words: curWords }
  }
  return best
}

// A scene counts as a monologue only when one character both delivers a long speech
// (≥ MONOLOGUE_MIN_SECONDS) AND carries the scene — i.e. the other characters barely
// reply (≤ MONOLOGUE_MAX_OTHER_LINES substantial lines). This rejects dialogue-heavy
// scenes where someone merely has the longest turn in a back-and-forth. Returns the
// monologue { who, seconds }, or null when the scene doesn't qualify.
export function sceneMonologue(blocks: SceneBlock[]): { who: string; seconds: number } | null {
  const sp = longestSpeech(blocks)
  const seconds = estimateSeconds(sp.words)
  if (seconds < MONOLOGUE_MIN_SECONDS) return null
  let otherLines = 0
  for (const b of blocks)
    if (b.type === 'cue' && b.who !== sp.who && wc(b.text) > INTERJECTION_MAX_WORDS) otherLines++
  return otherLines <= MONOLOGUE_MAX_OTHER_LINES ? { who: sp.who, seconds } : null
}
