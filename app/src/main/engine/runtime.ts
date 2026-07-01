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

// a monologue is a scene one voice carries, speaking for at least this long
export const MONOLOGUE_MIN_SECONDS = 30
const INTERJECTION_MAX_WORDS = 3 // a brief reply from the reader ("Go on.") is allowed
// some scripts write a speaker's cue in quotes inline (the boy answers as "WALTER"),
// which the layout can absorb into another character's dialogue — turning a two-hander
// into a fake monologue. A quoted ALL-CAPS name that RECURS is that hidden second voice.
const QUOTED_NAME_RE = /["'“”]([A-Z][A-Z0-9 .'\-]*[A-Z])["'“”]/g

// A scene is a monologue when one character carries it: they speak ≥ MONOLOGUE_MIN_SECONDS
// and nobody else says more than a brief interjection (≤ INTERJECTION_MAX_WORDS) — any real
// line from a second character makes it a conversation. Returns the monologue, or null.
export function sceneMonologue(blocks: SceneBlock[]): { who: string; seconds: number } | null {
  const wordsBy = new Map<string, number>()
  for (const b of blocks) if (b.type === 'cue') wordsBy.set(b.who, (wordsBy.get(b.who) ?? 0) + wc(b.text))
  if (!wordsBy.size) return null
  let who = '' // the character who carries the scene (speaks the most)
  let max = 0
  for (const [n, w] of wordsBy) if (w > max) ((max = w), (who = n))
  const seconds = estimateSeconds(max)
  if (seconds < MONOLOGUE_MIN_SECONDS) return null
  for (const b of blocks)
    if (b.type === 'cue' && b.who !== who && wc(b.text) > INTERJECTION_MAX_WORDS) return null
  // reject a two-hander that got flattened via inline quoted cues (see QUOTED_NAME_RE)
  const quoted = new Map<string, number>()
  for (const b of blocks)
    if (b.type === 'cue')
      for (const m of b.text.matchAll(QUOTED_NAME_RE)) quoted.set(m[1], (quoted.get(m[1]) ?? 0) + 1)
  for (const count of quoted.values()) if (count >= 2) return null
  return { who, seconds }
}
