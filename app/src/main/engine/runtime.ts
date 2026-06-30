import type { SceneBlock } from './types'

const WPM = 130
const wc = (text: string) => text.split(/\s+/).filter(Boolean).length

export function sceneWordCount(lines: [string, string][]): number {
  return lines.reduce((n, [, text]) => n + wc(text), 0)
}

export function estimateSeconds(words: number): number {
  return Math.round((words / WPM) * 60)
}

// Scene runtime estimate: from the spoken dialogue, but fall back to the action when a
// scene has no dialogue — so an action-only scene reads as ~its length, not 0:00.
export function estimateScene(lines: [string, string][], blocks: SceneBlock[]): number {
  const dialogue = sceneWordCount(lines)
  if (dialogue > 0) return estimateSeconds(dialogue)
  return estimateSeconds(blocks.reduce((n, b) => n + wc(b.text), 0))
}
