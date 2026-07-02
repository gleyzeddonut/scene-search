export type SceneBlock = { type: 'action'; text: string } | { type: 'cue'; who: string; text: string }

export interface LayoutLine {
  text: string
  x: number // left edge of the line, in PDF points
  y: number // text baseline, in PDF points measured DOWN from the page top (matches the viewer's FitH origin)
  page: number
}

export interface Scene {
  heading: string
  index: number
  page: number
  topY?: number // heading baseline, points from the page TOP (layout parse only) — scroll target
  characters: string[]
  lines: [string, string][]
  blocks: SceneBlock[]
}

export interface SceneMatch {
  script_path: string
  script_name: string
  heading: string
  page: number
  top?: number // scroll target within the page (PDF points), when known
  char_count: number
  characters: string[]
  pairing: string | null
  scene_index: number
  est_seconds: number
  added?: number // file creation/added time (ms epoch)
  monologue?: { who: string; seconds: number; scene: number } | null // biggest solo speech + its scene index
}

export interface Folders {
  roots: string[]
  ignored: string[]
}
