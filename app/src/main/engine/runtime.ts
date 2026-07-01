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

// a monologue is a scene where only one person speaks, for at least this long
export const MONOLOGUE_MIN_SECONDS = 30

// A scene is a monologue when exactly one character speaks (a second speaker
// disqualifies it) and their dialogue runs ≥ MONOLOGUE_MIN_SECONDS. Returns the
// monologue { who, seconds }, or null.
export function sceneMonologue(blocks: SceneBlock[]): { who: string; seconds: number } | null {
  let who = ''
  let words = 0
  for (const b of blocks) {
    if (b.type !== 'cue') continue // action doesn't count as speaking
    if (who && b.who !== who) return null // a second voice → not a monologue
    who = b.who
    words += wc(b.text)
  }
  if (!who) return null
  const seconds = estimateSeconds(words)
  return seconds >= MONOLOGUE_MIN_SECONDS ? { who, seconds } : null
}
