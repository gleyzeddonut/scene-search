const WPM = 130

export function sceneWordCount(lines: [string, string][]): number {
  return lines.reduce((n, [, text]) => n + text.split(/\s+/).filter(Boolean).length, 0)
}

export function estimateSeconds(words: number): number {
  return Math.round((words / WPM) * 60)
}
